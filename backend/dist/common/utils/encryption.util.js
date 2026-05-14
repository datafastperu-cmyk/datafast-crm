"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.hashPassword = hashPassword;
exports.comparePassword = comparePassword;
exports.generateToken = generateToken;
exports.generateOtp = generateOtp;
const crypto = require("crypto");
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
function getKey() {
    const hexKey = process.env.ENCRYPTION_KEY;
    if (!hexKey || hexKey.length !== 64) {
        throw new Error('ENCRYPTION_KEY debe ser exactamente 64 caracteres hex (32 bytes)');
    }
    return Buffer.from(hexKey, 'hex');
}
function encrypt(plaintext) {
    if (!plaintext)
        return plaintext;
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
        iv.toString('hex'),
        authTag.toString('hex'),
        encrypted.toString('hex'),
    ].join(':');
}
function decrypt(ciphertext) {
    if (!ciphertext)
        return ciphertext;
    if (!ciphertext.includes(':'))
        return ciphertext;
    try {
        const key = getKey();
        const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const encrypted = Buffer.from(encryptedHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        return decipher.update(encrypted) + decipher.final('utf8');
    }
    catch (error) {
        throw new Error(`Error al descifrar: ${error.message}`);
    }
}
const bcrypt = require("bcryptjs");
async function hashPassword(password) {
    return bcrypt.hash(password, 12);
}
async function comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
}
function generateToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}
function generateOtp(digits = 6) {
    const max = Math.pow(10, digits);
    return crypto.randomInt(0, max).toString().padStart(digits, '0');
}
//# sourceMappingURL=encryption.util.js.map