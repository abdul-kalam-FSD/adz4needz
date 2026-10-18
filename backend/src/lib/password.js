import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;
export const MAX_PASSWORD_LENGTH = 200;
// Same minimum that scripts/create-user.js enforces (a test keeps the two in step). Used by the change-password API.
export const MIN_PASSWORD_LENGTH = 10;

// Stored format: scrypt$N$r$p$salt(base64)$hash(base64). Plain passwords are never stored.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAX_MEMORY });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every(Number.isInteger) || n > 2 ** 20 || r > 32 || p > 4) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (expected.length === 0) return false;
  const actual = await scryptAsync(password, salt, expected.length, { N: n, r, p, maxmem: MAX_MEMORY });
  return timingSafeEqual(actual, expected);
}
