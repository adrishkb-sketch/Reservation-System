const path = require('path');

const isVercel = !!process.env.VERCEL;

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || (isVercel ? 'production' : 'development'),
  SESSION_SECRET: process.env.SESSION_SECRET || 'cosmic_secret_key_adrish_2026_super_secure_vault_token',
  COOKIE_NAME: 'adrish_admin_session',
  ADMIN_DEFAULT: {
    loginId: process.env.ADMIN_LOGIN_ID || 'AdrishRegistrations',
    password: process.env.ADMIN_PASSWORD || 'Adrish_da_real_nigga'
  },
  DB_PATH: process.env.DB_PATH || (isVercel ? path.join('/tmp', 'portal.sqlite') : path.join(__dirname, '..', 'data', 'portal.sqlite')),
  UPLOAD_DIR: isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, '..', 'public', 'uploads'),
  DEPARTMENTS: ['CSE', 'IT', 'CT'],
  PROGRAMS: ['B.Tech', 'M.Tech'],
  YEARS_BY_PROGRAM: {
    'B.Tech': ['1st Year', '2nd Year', '3rd Year', '4th Year'],
    'M.Tech': ['1st Year', '2nd Year']
  }
};
