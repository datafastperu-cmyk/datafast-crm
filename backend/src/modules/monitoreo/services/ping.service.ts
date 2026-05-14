import { Injectable, Logger } from '@nestjs/common';
import { exec }               from 'child_process';
import { promisify }          from 'util';
import * as net               from 'net';
import * as os                from 'os';

const execAsync = promisify(exec);

export interface PingResult {
  ip:        string;
  alive:     boolean;
  latencyMs: number | null;
  lossPerct: number;
  min:       number | null;
  max:       number | null;
  avg:       number | null;
  stddev:    number | null;
}

@Injectable()
export class PingService {
  private readonly logger  = new Logger(PingService.name);
  private readonly isLinux = os.platform() === 'linux';
  private readonly isDarwin = os.platform() === 'darwin';

  // ────────────────────────────────────────────────────────────
  // PING CON ICMP (requiere privileges en algunos sistemas)
  // Fallback a TCP port check si ICMP no está disponible.
  // ────────────────────────────────────────────────────────────
  async ping(
    ip:          string,
    count:       number = 4,
    timeoutMs:   number = 3000,
    retries:     number = 1,
  ): Promise<PingResult> {
    // Intentar primero con ICMP ping del sistema
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.icmpPing(ip, count, timeoutMs);
        if (result.alive || attempt === retries) return result;
        // Si no responde y hay más reintentos, esperar 500ms
        await this.sleep(500);
      } catch (err) {
        this.logger.debug(`ICMP ping falló para ${ip}: ${err.message} — intentando TCP`);
        // Si ICMP falla (permisos), usar TCP
        try {
          return await this.tcpPing(ip, timeoutMs);
        } catch {
          // Si ambos fallan, considerar offline
        }
      }
    }

    return {
      ip, alive: false, latencyMs: null,
      lossPerct: 100, min: null, max: null, avg: null, stddev: null,
    };
  }

  // ── Ping masivo para múltiples IPs en paralelo ────────────
  async pingBulk(
    ips:       string[],
    count:     number = 3,
    timeoutMs: number = 3000,
    concurrency: number = 10,
  ): Promise<Map<string, PingResult>> {
    const results = new Map<string, PingResult>();

    // Procesar en lotes para no saturar el sistema
    for (let i = 0; i < ips.length; i += concurrency) {
      const batch = ips.slice(i, i + concurrency);

      const batchResults = await Promise.allSettled(
        batch.map((ip) => this.ping(ip, count, timeoutMs)),
      );

      batch.forEach((ip, idx) => {
        const r = batchResults[idx];
        if (r.status === 'fulfilled') {
          results.set(ip, r.value);
        } else {
          results.set(ip, {
            ip, alive: false, latencyMs: null,
            lossPerct: 100, min: null, max: null, avg: null, stddev: null,
          });
        }
      });

      // Pequeña pausa entre lotes para no saturar la red
      if (i + concurrency < ips.length) {
        await this.sleep(100);
      }
    }

    return results;
  }

  // ── ICMP Ping via comando del sistema ────────────────────
  private async icmpPing(
    ip:        string,
    count:     number,
    timeoutMs: number,
  ): Promise<PingResult> {
    const timeoutSec = Math.ceil(timeoutMs / 1000);
    let cmd: string;

    if (this.isLinux) {
      // Linux: -W timeout en segundos, -c count
      cmd = `ping -c ${count} -W ${timeoutSec} -q ${ip} 2>&1`;
    } else if (this.isDarwin) {
      // macOS: -t timeout, -c count
      cmd = `ping -c ${count} -t ${timeoutSec} -q ${ip} 2>&1`;
    } else {
      // Windows: -n count, -w timeout_ms
      cmd = `ping -n ${count} -w ${timeoutMs} ${ip} 2>&1`;
    }

    const { stdout } = await execAsync(cmd, { timeout: (timeoutMs + 2000) * count });

    return this.parsePingOutput(ip, stdout);
  }

  // ── Parsear salida del comando ping ──────────────────────
  private parsePingOutput(ip: string, output: string): PingResult {
    const lossMatch = output.match(/(\d+(?:\.\d+)?)%\s*(?:packet\s*)?loss/i);
    const lossPerct = lossMatch ? parseFloat(lossMatch[1]) : 100;
    const alive     = lossPerct < 100;

    // Parsear estadísticas: min/avg/max/stddev
    const statsMatch = output.match(
      /(?:min\/avg\/max(?:\/mdev|\/stddev)?)\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)(?:\/([\d.]+))?/i,
    );

    if (statsMatch) {
      return {
        ip, alive, lossPerct,
        min:       parseFloat(statsMatch[1]),
        avg:       parseFloat(statsMatch[2]),
        max:       parseFloat(statsMatch[3]),
        stddev:    statsMatch[4] ? parseFloat(statsMatch[4]) : null,
        latencyMs: parseFloat(statsMatch[2]),
      };
    }

    // Si no hay estadísticas pero sí hay respuesta
    const timeMatch = output.match(/time[=<]([\d.]+)\s*ms/i);
    const latency   = timeMatch ? parseFloat(timeMatch[1]) : null;

    return {
      ip, alive, lossPerct,
      latencyMs: latency, min: latency, max: latency, avg: latency, stddev: null,
    };
  }

  // ── TCP Ping como alternativa a ICMP ────────────────────
  private async tcpPing(ip: string, timeoutMs: number): Promise<PingResult> {
    // Probar puertos comunes: 80, 443, 22, 8728 (RouterOS API)
    const ports = [80, 443, 22, 8728, 8729];

    for (const port of ports) {
      try {
        const latency = await this.tcpConnect(ip, port, timeoutMs);
        return {
          ip, alive: true, latencyMs: latency,
          lossPerct: 0, min: latency, max: latency, avg: latency, stddev: null,
        };
      } catch { /* probar siguiente puerto */ }
    }

    return {
      ip, alive: false, latencyMs: null,
      lossPerct: 100, min: null, max: null, avg: null, stddev: null,
    };
  }

  private tcpConnect(ip: string, port: number, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const inicio  = Date.now();
      const socket  = new net.Socket();

      socket.setTimeout(timeoutMs);

      socket.connect(port, ip, () => {
        const latency = Date.now() - inicio;
        socket.destroy();
        resolve(latency);
      });

      socket.on('timeout', () => { socket.destroy(); reject(new Error('TCP timeout')); });
      socket.on('error',   (err) => { socket.destroy(); reject(err); });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
