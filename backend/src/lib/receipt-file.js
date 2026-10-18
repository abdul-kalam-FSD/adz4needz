// Receipt / screenshot file rules. The file's TYPE is decided from its first bytes ("magic numbers"), never from the
// file name or the client's Content-Type header. Only JPEG, PNG and PDF are accepted (no SVG/HTML: they can carry script).
// ASSUMPTION (TL to confirm): phone screenshots are JPEG or PNG; HEIC/WebP are not accepted.
export const RECEIPT_TYPES = {
  'image/jpeg': { ext: 'jpg', inline: true },
  'image/png': { ext: 'png', inline: true },
  'application/pdf': { ext: 'pdf', inline: false } // downloaded, not rendered inside the app's origin
};
export const ALLOWED_RECEIPT_MIME = Object.keys(RECEIPT_TYPES);
export const MAX_RECEIPTS_PER_INSTALMENT = 5; // technical safety limit, TL to confirm

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Returns the detected MIME type, or null when the bytes are not a JPEG / PNG / PDF.
export function sniffReceiptType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (PNG.every((b, i) => buf[i] === b)) return 'image/png';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

// "image/png; charset=x" -> "image/png"; anything else -> ''
export const declaredMime = (header) => (typeof header === 'string' ? header.split(';')[0].trim().toLowerCase() : '');

// Display-only file name: no folders, no control characters, bounded length. It is never used to build a path
// (the stored name is a random UUID chosen by the server).
export function sanitizeFileName(name) {
  let s = typeof name === 'string' ? name : '';
  s = s.split(/[\\/]/).pop();                                   // drop any folder part (also ../ tricks)
  s = s.replace(/[\u0000-\u001F\u007F]/g, '').replace(/[^\p{L}\p{M}\p{N}._\- ()]/gu, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.\s]+/, '');                                  // no hidden / dot-only names
  if (s.length > 100) { const dot = s.lastIndexOf('.'); const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : ''; s = s.slice(0, 100 - ext.length) + ext; }
  return s || 'receipt';
}
