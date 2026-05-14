"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var PingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PingService = void 0;
const common_1 = require("@nestjs/common");
const child_process_1 = require("child_process");
const util_1 = require("util");
const net = require("net");
const os = require("os");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
let PingService = PingService_1 = class PingService {
    constructor() {
        this.logger = new common_1.Logger(PingService_1.name);
        this.isLinux = os.platform() === 'linux';
        this.isDarwin = os.platform() === 'darwin';
    }
    async ping(ip, count = 4, timeoutMs = 3000, retries = 1) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await this.icmpPing(ip, count, timeoutMs);
                if (result.alive || attempt === retries)
                    return result;
                await this.sleep(500);
            }
            catch (err) {
                this.logger.debug(`ICMP ping falló para ${ip}: ${err.message} — intentando TCP`);
                try {
                    return await this.tcpPing(ip, timeoutMs);
                }
                catch {
                }
            }
        }
        return {
            ip, alive: false, latencyMs: null,
            lossPerct: 100, min: null, max: null, avg: null, stddev: null,
        };
    }
    async pingBulk(ips, count = 3, timeoutMs = 3000, concurrency = 10) {
        const results = new Map();
        for (let i = 0; i < ips.length; i += concurrency) {
            const batch = ips.slice(i, i + concurrency);
            const batchResults = await Promise.allSettled(batch.map((ip) => this.ping(ip, count, timeoutMs)));
            batch.forEach((ip, idx) => {
                const r = batchResults[idx];
                if (r.status === 'fulfilled') {
                    results.set(ip, r.value);
                }
                else {
                    results.set(ip, {
                        ip, alive: false, latencyMs: null,
                        lossPerct: 100, min: null, max: null, avg: null, stddev: null,
                    });
                }
            });
            if (i + concurrency < ips.length) {
                await this.sleep(100);
            }
        }
        return results;
    }
    async icmpPing(ip, count, timeoutMs) {
        const timeoutSec = Math.ceil(timeoutMs / 1000);
        let cmd;
        if (this.isLinux) {
            cmd = `ping -c ${count} -W ${timeoutSec} -q ${ip} 2>&1`;
        }
        else if (this.isDarwin) {
            cmd = `ping -c ${count} -t ${timeoutSec} -q ${ip} 2>&1`;
        }
        else {
            cmd = `ping -n ${count} -w ${timeoutMs} ${ip} 2>&1`;
        }
        const { stdout } = await execAsync(cmd, { timeout: (timeoutMs + 2000) * count });
        return this.parsePingOutput(ip, stdout);
    }
    parsePingOutput(ip, output) {
        const lossMatch = output.match(/(\d+(?:\.\d+)?)%\s*(?:packet\s*)?loss/i);
        const lossPerct = lossMatch ? parseFloat(lossMatch[1]) : 100;
        const alive = lossPerct < 100;
        const statsMatch = output.match(/(?:min\/avg\/max(?:\/mdev|\/stddev)?)\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)(?:\/([\d.]+))?/i);
        if (statsMatch) {
            return {
                ip, alive, lossPerct,
                min: parseFloat(statsMatch[1]),
                avg: parseFloat(statsMatch[2]),
                max: parseFloat(statsMatch[3]),
                stddev: statsMatch[4] ? parseFloat(statsMatch[4]) : null,
                latencyMs: parseFloat(statsMatch[2]),
            };
        }
        const timeMatch = output.match(/time[=<]([\d.]+)\s*ms/i);
        const latency = timeMatch ? parseFloat(timeMatch[1]) : null;
        return {
            ip, alive, lossPerct,
            latencyMs: latency, min: latency, max: latency, avg: latency, stddev: null,
        };
    }
    async tcpPing(ip, timeoutMs) {
        const ports = [80, 443, 22, 8728, 8729];
        for (const port of ports) {
            try {
                const latency = await this.tcpConnect(ip, port, timeoutMs);
                return {
                    ip, alive: true, latencyMs: latency,
                    lossPerct: 0, min: latency, max: latency, avg: latency, stddev: null,
                };
            }
            catch { }
        }
        return {
            ip, alive: false, latencyMs: null,
            lossPerct: 100, min: null, max: null, avg: null, stddev: null,
        };
    }
    tcpConnect(ip, port, timeoutMs) {
        return new Promise((resolve, reject) => {
            const inicio = Date.now();
            const socket = new net.Socket();
            socket.setTimeout(timeoutMs);
            socket.connect(port, ip, () => {
                const latency = Date.now() - inicio;
                socket.destroy();
                resolve(latency);
            });
            socket.on('timeout', () => { socket.destroy(); reject(new Error('TCP timeout')); });
            socket.on('error', (err) => { socket.destroy(); reject(err); });
        });
    }
    sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }
};
exports.PingService = PingService;
exports.PingService = PingService = PingService_1 = __decorate([
    (0, common_1.Injectable)()
], PingService);
//# sourceMappingURL=ping.service.js.map