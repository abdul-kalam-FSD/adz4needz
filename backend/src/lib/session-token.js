import { randomBytes, createHash } from 'node:crypto';

// The browser gets the random token. The database only stores its SHA-256 hash,
// so a database leak does not give anyone a usable login session.
export const generateToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
