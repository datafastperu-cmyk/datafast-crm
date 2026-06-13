// ─── Utilidades de IPv4 para gestión de pools ─────────────────

// Convertir IP a número entero
export function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

// Convertir número entero a IP
export function intToIp(int: number): string {
  return [
    (int >>> 24) & 255,
    (int >>> 16) & 255,
    (int >>> 8) & 255,
    int & 255,
  ].join('.');
}

// Calcular rango de IPs usables de una subred CIDR
export function getCidrRange(cidr: string): {
  network: string;
  broadcast: string;
  firstUsable: string;
  lastUsable: string;
  totalHosts: number;
  usableHosts: number;
} {
  const [ip, prefix] = cidr.split('/');
  const prefixLen = parseInt(prefix, 10);
  const mask = (~0 << (32 - prefixLen)) >>> 0;

  const networkInt = ipToInt(ip) & mask;
  const broadcastInt = networkInt | (~mask >>> 0);

  const totalHosts = Math.pow(2, 32 - prefixLen);
  const usableHosts = totalHosts > 2 ? totalHosts - 2 : 0;

  return {
    network: intToIp(networkInt),
    broadcast: intToIp(broadcastInt),
    firstUsable: intToIp(networkInt + 1),
    lastUsable: intToIp(broadcastInt - 1),
    totalHosts,
    usableHosts,
  };
}

// Encontrar la próxima IP disponible que no esté en la lista de usadas
export function getNextAvailableIp(
  cidr: string,
  usedIps: string[],
  reservedIps: string[] = [], // IPs a excluir (gateway, DNS, etc.)
): string | null {
  const range = getCidrRange(cidr);
  const usedSet = new Set([...usedIps, ...reservedIps]);

  const firstInt = ipToInt(range.firstUsable);
  const lastInt = ipToInt(range.lastUsable);

  for (let i = firstInt; i <= lastInt; i++) {
    const ip = intToIp(i);
    if (!usedSet.has(ip)) {
      return ip;
    }
  }

  return null; // Pool exhausto
}

// Verificar si una IP está dentro de un rango CIDR
export function isIpInCidr(ip: string, cidr: string): boolean {
  const [network, prefix] = cidr.split('/');
  const prefixLen = parseInt(prefix, 10);
  const mask = (~0 << (32 - prefixLen)) >>> 0;

  return (ipToInt(ip) & mask) === (ipToInt(network) & mask);
}

// Validar formato de IP
export function isValidIp(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255 && p === n.toString();
  });
}

// Validar formato CIDR — requiere dirección de red correcta (host bits = 0)
export function isValidCidr(cidr: string): boolean {
  const [ip, prefix] = cidr.split('/');
  if (!ip || !prefix) return false;
  const prefixLen = parseInt(prefix, 10);
  if (!isValidIp(ip) || prefixLen < 1 || prefixLen > 30) return false;
  const mask = (~0 << (32 - prefixLen)) >>> 0;
  return ((ipToInt(ip) & mask) >>> 0) === ipToInt(ip);
}

// Calcular porcentaje de uso del pool
export function getPoolUsagePercent(cidr: string, usedCount: number): number {
  const range = getCidrRange(cidr);
  if (range.usableHosts === 0) return 100;
  return Math.round((usedCount / range.usableHosts) * 100);
}
