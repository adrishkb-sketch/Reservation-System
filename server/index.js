const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const config = require('./config');
const db = require('./db');

const authRoutes = require('./routes/authRoutes');
const eventRoutes = require('./routes/eventRoutes');
const registrationRoutes = require('./routes/registrationRoutes');
const seatRoutes = require('./routes/seatRoutes');
const checkInRoutes = require('./routes/checkInRoutes');
const statsRoutes = require('./routes/statsRoutes');

const app = express();

app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Static assets with caching
app.use('/uploads', express.static(config.UPLOAD_DIR, { maxAge: '1d' }));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api', registrationRoutes);
app.use('/api', seatRoutes);
app.use('/api/admin/check-in', checkInRoutes);
app.use('/api/admin', statsRoutes);

// Auto-seed demo events if table is empty
try {
  const { seedDemoData } = require('./seed');
  seedDemoData();
} catch (err) {
  console.warn('[Seed Auto-Init Warning]', err.message);
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), env: config.NODE_ENV });
});

// Fallback for SPA routing if needed
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }
  if (req.path.startsWith('/admin')) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error occurred.'
  });
});

if (require.main === module) {
  const server = app.listen(config.PORT, () => {
    console.log(`🌌 Cosmic Event Reservation Portal active at http://localhost:${config.PORT}`);
    console.log(`🔑 Admin credentials: ${config.ADMIN_DEFAULT.loginId} / (password configured in env/config)`);
  });
}

module.exports = app;
