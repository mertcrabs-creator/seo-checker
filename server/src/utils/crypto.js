import crypto from 'node:crypto';
import { config } from '../config.js';

const ALGO = 'aes-256-gcm';

/** AES-256-GCM: iv(12) | tag(16) | ciphertext -> base64url */
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, config.encryptionKey, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

export function decrypt(payload) {
  const buf = Buffer.from(payload, 'base64url');
  const decipher = crypto.createDecipheriv(ALGO, config.encryptionKey, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
