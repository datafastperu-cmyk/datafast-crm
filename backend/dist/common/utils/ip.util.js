"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ipToInt = ipToInt;
exports.intToIp = intToIp;
exports.getCidrRange = getCidrRange;
exports.getUsableIps = getUsableIps;
exports.getNextAvailableIp = getNextAvailableIp;
exports.isIpInCidr = isIpInCidr;
exports.isValidIp = isValidIp;
exports.isValidCidr = isValidCidr;
exports.getPoolUsagePercent = getPoolUsagePercent;
function ipToInt(ip) {
    return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}
function intToIp(int) {
    return [
        (int >>> 24) & 255,
        (int >>> 16) & 255,
        (int >>> 8) & 255,
        int & 255,
    ].join('.');
}
function getCidrRange(cidr) {
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
function getUsableIps(cidr) {
    const range = getCidrRange(cidr);
    const firstInt = ipToInt(range.firstUsable);
    const lastInt = ipToInt(range.lastUsable);
    const ips = [];
    for (let i = firstInt; i <= lastInt; i++) {
        ips.push(intToIp(i));
    }
    return ips;
}
function getNextAvailableIp(cidr, usedIps, reservedIps = []) {
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
    return null;
}
function isIpInCidr(ip, cidr) {
    const [network, prefix] = cidr.split('/');
    const prefixLen = parseInt(prefix, 10);
    const mask = (~0 << (32 - prefixLen)) >>> 0;
    return (ipToInt(ip) & mask) === (ipToInt(network) & mask);
}
function isValidIp(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4)
        return false;
    return parts.every((p) => {
        const n = parseInt(p, 10);
        return !isNaN(n) && n >= 0 && n <= 255 && p === n.toString();
    });
}
function isValidCidr(cidr) {
    const [ip, prefix] = cidr.split('/');
    if (!ip || !prefix)
        return false;
    const prefixLen = parseInt(prefix, 10);
    return isValidIp(ip) && prefixLen >= 0 && prefixLen <= 32;
}
function getPoolUsagePercent(cidr, usedCount) {
    const range = getCidrRange(cidr);
    if (range.usableHosts === 0)
        return 100;
    return Math.round((usedCount / range.usableHosts) * 100);
}
//# sourceMappingURL=ip.util.js.map