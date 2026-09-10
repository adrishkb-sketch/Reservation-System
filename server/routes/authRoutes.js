const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { createSessionToken, requireAdmin } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many login attempts. Please try again in 15 minutes.'
});

// Login
router.post('/login', loginLimiter, (req, res) => {
  const { loginId, password } = req.body;

  if (!loginId || !password) {
    return res.status(400).json({ error: 'Please provide both login ID and password.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE login_id = ?').get(loginId.trim());
  if (!admin) {
    return res.status(401).json({ error: 'Invalid login credentials.' });
  }

  const passwordMatch = bcrypt.compareSync(password, admin.password_hash);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'Invalid login credentials.' });
  }

  const token = createSessionToken(admin.id, admin.login_id);

  res.cookie(config.COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  return res.json({
    success: true,
    message: 'Admin login successful.',
    admin: {
      id: admin.id,
      loginId: admin.login_id
    },
    token
  });
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie(config.COOKIE_NAME);
  return res.json({ success: true, message: 'Logged out successfully.' });
});

// Get current session
router.get('/me', requireAdmin, (req, res) => {
  return res.json({
    admin: {
      id: req.admin.id,
      loginId: req.admin.login_id
    }
  });
});

module.exports = router;
