export declare const jwtConfig: (() => {
    secret: string;
    refreshSecret: string;
    expiresIn: string;
    refreshExpiresIn: string;
    issuer: string;
    audience: string;
    blacklistTtl: number;
}) & import("@nestjs/config").ConfigFactoryKeyHost<{
    secret: string;
    refreshSecret: string;
    expiresIn: string;
    refreshExpiresIn: string;
    issuer: string;
    audience: string;
    blacklistTtl: number;
}>;
