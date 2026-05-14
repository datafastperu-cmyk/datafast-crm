import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey || hexKey.length !== 64) {
    throw new Error('ENCRYPTION_KEY debe ser exactamente 64 caracteres hex (32 bytes)');
  }
  return Buffer.from(hexKey, 'hex');
}

// ─── Cifrar texto (para passwords de routers en BD) ───────────
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Formato: iv:authTag:encrypted (todo en hex)
  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

// ─── Descifrar texto ──────────────────────────────────────────
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ciphertext;

  // Si no tiene el formato esperado, asumir que no está cifrado
  if (!ciphertext.includes(':')) return ciphertext;

  try {
    const key = getKey();
    const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted) + decipher.final('utf8');
  } catch (error) {
    throw new Error(`Error al descifrar: ${error.message}`);
  }
}

// ─── Hash seguro para passwords de usuarios ───────────────────
import * as bcrypt from 'bcryptjs';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── Generar tokens aleatorios ────────────────────────────────
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateOtp(digits = 6): string {
  const max = Math.pow(10, digits);
  return crypto.randomInt(0, max).toString().padStart(digits, '0');
}
