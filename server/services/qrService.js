const crypto = require('crypto');
const config = require('../config');

/**
 * Generate an unpredictable reference number.
 * Format: ADR-26-K7X9P2
 */
function generateReferenceCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous 0/O, 1/I
  let randomPart = '';
  const randomBytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    randomPart += chars[randomBytes[i] % chars.length];
  }
  const yearSuffix = new Date().getFullYear().toString().slice(-2);
  return `ADR-${yearSuffix}-${randomPart}`;
}

/**
 * Generate a secure cryptographically signed QR token.
 * Token structure: <referenceCode>.<timestamp>.<hmacSignature>
 */
function generateQrToken(referenceCode) {
  const ts = Date.now().toString(36);
  const data = `${referenceCode}:${ts}`;
  const hmac = crypto.createHmac('sha256', config.SESSION_SECRET).update(data).digest('hex').slice(0, 32);
  return `${referenceCode}.${ts}.${hmac}`;
}

/**
 * Hash token for safe database storage
 */
function hashQrToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Validates token signature and matches with stored hash
 */
function validateQrToken(token, storedHash) {
  if (!token || typeof token !== 'string') return { valid: false, reason: 'Invalid token format' };
  
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'Malformed QR token' };

  const [ref, ts, sig] = parts;
  const data = `${ref}:${ts}`;
  const expectedSig = crypto.createHmac('sha256', config.SESSION_SECRET).update(data).digest('hex').slice(0, 32);
  
  if (sig !== expectedSig) {
    return { valid: false, reason: 'Invalid token signature' };
  }

  const computedHash = hashQrToken(token);
  if (computedHash !== storedHash) {
    return { valid: false, reason: 'Token hash mismatch' };
  }

  return { valid: true, referenceCode: ref };
}

module.exports = {
  generateReferenceCode,
  generateQrToken,
  hashQrToken,
  validateQrToken
};
