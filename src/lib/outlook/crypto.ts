import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for OAuth tokens at rest. Key from MS_TOKEN_ENC_KEY
// (base64, 32 bytes — generate with `openssl rand -base64 32`). The key
// is read lazily so a missing env var only errors when we actually touch
// a token, keeping `next build` green before the integration is set up.
//
// Wire format: base64( iv(12) | authTag(16) | ciphertext ).

function getKey(): Buffer {
  const b64 = process.env.MS_TOKEN_ENC_KEY;
  if (!b64) {
    throw new Error('MS_TOKEN_ENC_KEY is not set — generate one with: openssl rand -base64 32');
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('MS_TOKEN_ENC_KEY must decode to 32 bytes (base64-encoded)');
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptToken(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
