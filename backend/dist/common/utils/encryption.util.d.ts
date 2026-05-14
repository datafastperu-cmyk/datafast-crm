export declare function encrypt(plaintext: string): string;
export declare function decrypt(ciphertext: string): string;
export declare function hashPassword(password: string): Promise<string>;
export declare function comparePassword(password: string, hash: string): Promise<boolean>;
export declare function generateToken(bytes?: number): string;
export declare function generateOtp(digits?: number): string;
