const crypto = require('crypto');
const config = require('../config');
const db = require('../db');

function createSessionToken(adminId, loginId) {
  const payload = `${adminId}:${loginId}:${Date.now()}`;
  const hmac = crypto.createHmac('sha256', config.SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64');
}

function verifySessionToken(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 4) return null;

    const [adminId, loginId, ts, hmac] = parts;
    const payload = `${adminId}:${loginId}:${ts}`;
    const expectedHmac = crypto.createHmac('sha256', config.SESSION_SECRET).update(payload).digest('hex');

    if (hmac !== expectedHmac) return null;

    // Optional expiry: 7 days
    const ageMs = Date.now() - parseInt(ts, 10);
    if (ageMs > 7 * 24 * 60 * 60 * 1000) return null;

    // Verify admin still exists in db
    const admin = db.prepare('SELECT id, login_id FROM admins WHERE id = ?').get(adminId);
    if (!admin) return null;

    return admin;
  } catch (err) {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const token = req.cookies?.[config.COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');
  const admin = verifySessionToken(token);

  if (!admin) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
  }

  req.admin = admin;
  next();
}

module.exports = {
  createSessionToken,
  verifySessionToken,
  requireAdmin
};
