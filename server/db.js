const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');

const dataDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(config.UPLOAD_DIR)) {
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
}

const db = new Database(config.DB_PATH);

// Configure SQLite for high concurrency and safety
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 10000');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login_id TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      banner_url TEXT,
      start_at DATETIME NOT NULL,
      end_at DATETIME NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'closed', 'completed', 'cancelled')) DEFAULT 'draft',
      group_dept INTEGER NOT NULL DEFAULT 0,
      group_prog INTEGER NOT NULL DEFAULT 0,
      group_year INTEGER NOT NULL DEFAULT 0,
      total_physical_seats INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_eligibility (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      department TEXT NOT NULL,
      program TEXT NOT NULL,
      year TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      UNIQUE(event_id, department, program, year)
    );

    CREATE TABLE IF NOT EXISTS capacity_buckets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      bucket_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      dept TEXT,
      program TEXT,
      year TEXT,
      capacity INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      UNIQUE(event_id, bucket_key)
    );

    CREATE TABLE IF NOT EXISTS seats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      seat_number INTEGER NOT NULL,
      capacity_bucket_id INTEGER,
      registration_id INTEGER,
      status TEXT NOT NULL CHECK(status IN ('available', 'allocated', 'blocked')) DEFAULT 'available',
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (capacity_bucket_id) REFERENCES capacity_buckets(id) ON DELETE SET NULL,
      UNIQUE(event_id, seat_number)
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      capacity_bucket_id INTEGER NOT NULL,
      reference_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      department TEXT NOT NULL,
      program TEXT NOT NULL,
      year TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('confirmed', 'waiting', 'cancelled')),
      waiting_position INTEGER,
      seat_id INTEGER,
      qr_token_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (capacity_bucket_id) REFERENCES capacity_buckets(id) ON DELETE CASCADE,
      FOREIGN KEY (seat_id) REFERENCES seats(id) ON DELETE SET NULL,
      UNIQUE(event_id, email),
      UNIQUE(event_id, phone)
    );

    CREATE TABLE IF NOT EXISTS check_ins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER UNIQUE NOT NULL,
      checked_in_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      checked_in_by INTEGER,
      FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
      FOREIGN KEY (checked_in_by) REFERENCES admins(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      event_id INTEGER NOT NULL,
      registration_id INTEGER,
      action TEXT NOT NULL,
      previous_val TEXT,
      new_val TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reg_event_bucket ON registrations(event_id, capacity_bucket_id, status);
    CREATE INDEX IF NOT EXISTS idx_reg_ref ON registrations(reference_code);
    CREATE INDEX IF NOT EXISTS idx_seats_event_bucket ON seats(event_id, capacity_bucket_id, status);
  `);

  // Seed default admin if not exists
  const existingAdmin = db.prepare('SELECT * FROM admins WHERE login_id = ?').get(config.ADMIN_DEFAULT.loginId);
  if (!existingAdmin) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(config.ADMIN_DEFAULT.password, salt);
    db.prepare('INSERT INTO admins (login_id, password_hash) VALUES (?, ?)').run(config.ADMIN_DEFAULT.loginId, hash);
    console.log(`[DB] Default admin created: ${config.ADMIN_DEFAULT.loginId}`);
  }
}

initSchema();

module.exports = db;
