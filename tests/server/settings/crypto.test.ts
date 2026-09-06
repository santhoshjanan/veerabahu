import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  hashToken,
  newToken,
  parseMasterKey,
  verifyPassword
} from '$lib/server/settings/crypto';

describe('settings crypto primitives', () => {
  it('round-trips then rejects a tampered secret', () => {
    const key = parseMasterKey(Buffer.alloc(32, 7).toString('base64'));
    const payload = encryptSecret(key, 'private');

    expect(decryptSecret(key, payload)).toBe('private');
    expect(() => decryptSecret(key, payload.slice(0, -1) + 'x')).toThrow();
  });

  it('rejects invalid master-key input', () => {
    expect(() => parseMasterKey('not-base64')).toThrow('VB_MASTER_KEY');
    expect(() => parseMasterKey(Buffer.alloc(31).toString('base64'))).toThrow(
      'VB_MASTER_KEY'
    );
  });

  it('rejects a wrong key and malformed payload', () => {
    const payload = encryptSecret(Buffer.alloc(32, 1), 'secret');
    expect(() => decryptSecret(Buffer.alloc(32, 2), payload)).toThrow();
    expect(() => decryptSecret(Buffer.alloc(32, 1), '{}')).toThrow();
    expect(() => decryptSecret(Buffer.alloc(32, 1), '{"v":2}')).toThrow();
  });

  it('hashes passwords with a salt and verifies only the matching password', () => {
    const record = hashPassword('correct horse battery staple');
    expect(record.salt).not.toBe(record.hash);
    expect(verifyPassword('correct horse battery staple', record)).toBe(true);
    expect(verifyPassword('wrong password', record)).toBe(false);
  });

  it('creates opaque tokens and hashes them deterministically', () => {
    const token = newToken();
    expect(token).not.toBe(newToken());
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(hashToken(token + 'x'));
  });
});
