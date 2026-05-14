export declare function ipToInt(ip: string): number;
export declare function intToIp(int: number): string;
export declare function getCidrRange(cidr: string): {
    network: string;
    broadcast: string;
    firstUsable: string;
    lastUsable: string;
    totalHosts: number;
    usableHosts: number;
};
export declare function getUsableIps(cidr: string): string[];
export declare function getNextAvailableIp(cidr: string, usedIps: string[], reservedIps?: string[]): string | null;
export declare function isIpInCidr(ip: string, cidr: string): boolean;
export declare function isValidIp(ip: string): boolean;
export declare function isValidCidr(cidr: string): boolean;
export declare function getPoolUsagePercent(cidr: string, usedCount: number): number;
