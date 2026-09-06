import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';

const VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const decodeBase64 = (value: string): Buffer => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new Error('invalid base64');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new Error('invalid base64');
  return decoded;
};

export interface PasswordRecord {
  salt: string;
  hash: string;
}

interface SecretPayload {
  v: number;
  iv: string;
  tag: string;
  ciphertext: string;
}

export function parseMasterKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('VB_MASTER_KEY must be strict Base64 for exactly 32 bytes');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== value) {
    throw new Error('VB_MASTER_KEY must be strict Base64 for exactly 32 bytes');
  }
  return key;
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  if (key.length !== KEY_BYTES)
    throw new Error('Encryption key must be 32 bytes');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const payload: SecretPayload = {
    v: VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
  return JSON.stringify(payload);
}

export function decryptSecret(key: Buffer, payload: string): string {
  if (key.length !== KEY_BYTES)
    throw new Error('Encryption key must be 32 bytes');
  let value: SecretPayload;
  try {
    value = JSON.parse(payload) as SecretPayload;
    if (
      value.v !== VERSION ||
      typeof value.iv !== 'string' ||
      typeof value.tag !== 'string' ||
      typeof value.ciphertext !== 'string'
    )
      throw new Error('invalid payload');
    const iv = decodeBase64(value.iv);
    const tag = decodeBase64(value.tag);
    if (iv.length !== IV_BYTES || tag.length !== 16)
      throw new Error('invalid payload');
    const ciphertext = decodeBase64(value.ciphertext);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw new Error('Unable to decrypt secret payload');
  }
}

export function hashPassword(password: string): PasswordRecord {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, HASH_BYTES);
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

export function verifyPassword(
  password: string,
  record: PasswordRecord
): boolean {
  try {
    const salt = Buffer.from(record.salt, 'base64');
    const expected = Buffer.from(record.hash, 'base64');
    if (salt.length !== SALT_BYTES || expected.length !== HASH_BYTES)
      return false;
    const actual = scryptSync(password, salt, HASH_BYTES);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
