const db = require('./db');
const { generateBucketsFromEligibility } = require('./services/capacityService');
const { configureSeatsForEvent } = require('./services/seatService');
const { registerStudent } = require('./services/registrationEngine');

function seedDemoData() {
  console.log('🌌 Seeding rich cosmic demo events and registrations...');

  const existingCount = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
  if (existingCount > 0) {
    console.log('🌌 Database already has events. Skipping seed.');
    return;
  }

  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // --- EVENT 1: Galactic Code Sprint (Dept + Year Grouping) ---
  const e1Result = db.prepare(`
    INSERT INTO events (name, description, banner_url, start_at, end_at, status, group_dept, group_prog, group_year, total_physical_seats)
    VALUES (?, ?, ?, ?, ?, 'published', 1, 0, 1, 60)
  `).run(
    'Cosmic Hackathon 2026: Galactic Code Sprint',
    'Join the most prestigious interstellar 36-hour hackathon! Build planetary-scale AI systems, quantum simulation tools, and decentralized space networks with cosmic mentors.',
    null,
    nextWeek.toISOString(),
    new Date(nextWeek.getTime() + 36 * 3600 * 1000).toISOString()
  );
  const e1Id = e1Result.lastInsertRowid;

  const elig1 = [
    { department: 'CSE', program: 'B.Tech', year: '1st Year' },
    { department: 'CSE', program: 'B.Tech', year: '2nd Year' },
    { department: 'CSE', program: 'B.Tech', year: '3rd Year' },
    { department: 'IT', program: 'B.Tech', year: '1st Year' },
    { department: 'IT', program: 'B.Tech', year: '2nd Year' },
    { department: 'CT', program: 'B.Tech', year: '1st Year' },
    { department: 'CSE', program: 'M.Tech', year: '1st Year' }
  ];

  const insertElig = db.prepare('INSERT INTO event_eligibility (event_id, department, program, year) VALUES (?, ?, ?, ?)');
  for (const el of elig1) {
    insertElig.run(e1Id, el.department, el.program, el.year);
  }

  const buckets1 = generateBucketsFromEligibility(elig1, { group_dept: 1, group_prog: 0, group_year: 1 });
  const insertBucket = db.prepare('INSERT INTO capacity_buckets (event_id, bucket_key, display_name, dept, program, year, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)');
  
  const bucketMap = new Map();
  for (const b of buckets1) {
    let cap = 8;
    if (b.bucket_key.includes('CSE')) cap = 10;
    if (b.bucket_key.includes('CT')) cap = 5;
    const res = insertBucket.run(e1Id, b.bucket_key, b.display_name, b.dept, b.program, b.year, cap);
    bucketMap.set(b.bucket_key, res.lastInsertRowid);
  }

  // Allocate physical seats for Event 1
  const bucketAllocations1 = [];
  let seatCounter = 1;
  for (const [key, bId] of bucketMap.entries()) {
    const start = seatCounter;
    const end = seatCounter + 9;
    bucketAllocations1.push({ bucketId: bId, rangeStr: `${start}-${end}` });
    seatCounter += 10;
  }
  configureSeatsForEvent(e1Id, 60, bucketAllocations1);

  // Pre-seed some confirmed students for Event 1
  const seedStudents = [
    { name: 'Adrish Kumar Banerjee', email: 'adrish.banerjee@stardust.edu', phone: '+91 98765 43210', department: 'CSE', program: 'B.Tech', year: '3rd Year' },
    { name: 'Aarav Sharma', email: 'aarav.sharma@stardust.edu', phone: '+91 98765 11111', department: 'CSE', program: 'B.Tech', year: '1st Year' },
    { name: 'Priya Mukherjee', email: 'priya.m@stardust.edu', phone: '+91 98765 22222', department: 'IT', program: 'B.Tech', year: '1st Year' },
    { name: 'Rohan Gupta', email: 'rohan.gupta@stardust.edu', phone: '+91 98765 33333', department: 'CSE', program: 'B.Tech', year: '2nd Year' },
    { name: 'Ananya Sen', email: 'ananya.sen@stardust.edu', phone: '+91 98765 44444', department: 'CT', program: 'B.Tech', year: '1st Year' }
  ];

  for (const st of seedStudents) {
    try {
      registerStudent({
        eventId: e1Id,
        ...st
      });
    } catch (e) {
      console.warn('Seed student warning:', e.message);
    }
  }

  // --- EVENT 2: Quantum AI & Nebula Summit (Year-Only Grouping) ---
  const e2Result = db.prepare(`
    INSERT INTO events (name, description, banner_url, start_at, end_at, status, group_dept, group_prog, group_year, total_physical_seats)
    VALUES (?, ?, ?, ?, ?, 'published', 0, 0, 1, 50)
  `).run(
    'Quantum AI & Nebula Space Summit 2026',
    'A landmark symposium covering deep space telemetry, quantum cryptography, and autonomous starship navigation protocols with global aerospace researchers.',
    null,
    nextMonth.toISOString(),
    new Date(nextMonth.getTime() + 8 * 3600 * 1000).toISOString()
  );
  const e2Id = e2Result.lastInsertRowid;

  const elig2 = [
    { department: 'CSE', program: 'B.Tech', year: '2nd Year' },
    { department: 'CSE', program: 'B.Tech', year: '3rd Year' },
    { department: 'CSE', program: 'B.Tech', year: '4th Year' },
    { department: 'IT', program: 'B.Tech', year: '2nd Year' },
    { department: 'IT', program: 'B.Tech', year: '3rd Year' },
    { department: 'IT', program: 'B.Tech', year: '4th Year' },
    { department: 'CT', program: 'B.Tech', year: '3rd Year' },
    { department: 'CT', program: 'B.Tech', year: '4th Year' }
  ];

  for (const el of elig2) {
    insertElig.run(e2Id, el.department, el.program, el.year);
  }

  const buckets2 = generateBucketsFromEligibility(elig2, { group_dept: 0, group_prog: 0, group_year: 1 });
  const bucketMap2 = new Map();
  for (const b of buckets2) {
    const res = insertBucket.run(e2Id, b.bucket_key, b.display_name, b.dept, b.program, b.year, 15);
    bucketMap2.set(b.bucket_key, res.lastInsertRowid);
  }

  const bucketAllocations2 = [
    { bucketId: bucketMap2.get('YEAR:2nd Year'), rangeStr: '1-15' },
    { bucketId: bucketMap2.get('YEAR:3rd Year'), rangeStr: '16-30' },
    { bucketId: bucketMap2.get('YEAR:4th Year'), rangeStr: '31-45' }
  ];
  configureSeatsForEvent(e2Id, 50, bucketAllocations2);

  // --- EVENT 3: Global Pool Cosmic Esports Championship ---
  const e3Result = db.prepare(`
    INSERT INTO events (name, description, banner_url, start_at, end_at, status, group_dept, group_prog, group_year, total_physical_seats)
    VALUES (?, ?, ?, ?, ?, 'published', 0, 0, 0, 40)
  `).run(
    'Intercollegiate Cosmic Gaming Arena',
    'High-octane esports tournament across campus. Open to all engineering departments and years with one unified general capacity pool.',
    null,
    new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString(),
    new Date(now.getTime() + 15 * 24 * 3600 * 1000).toISOString()
  );
  const e3Id = e3Result.lastInsertRowid;

  const elig3 = [
    { department: 'CSE', program: 'B.Tech', year: '1st Year' },
    { department: 'CSE', program: 'B.Tech', year: '2nd Year' },
    { department: 'IT', program: 'B.Tech', year: '1st Year' },
    { department: 'IT', program: 'B.Tech', year: '2nd Year' },
    { department: 'CT', program: 'B.Tech', year: '1st Year' },
    { department: 'CT', program: 'B.Tech', year: '2nd Year' }
  ];

  for (const el of elig3) {
    insertElig.run(e3Id, el.department, el.program, el.year);
  }

  const buckets3 = generateBucketsFromEligibility(elig3, { group_dept: 0, group_prog: 0, group_year: 0 });
  for (const b of buckets3) {
    const res = insertBucket.run(e3Id, b.bucket_key, b.display_name, b.dept, b.program, b.year, 30);
    configureSeatsForEvent(e3Id, 40, [{ bucketId: res.lastInsertRowid, rangeStr: '1-30' }]);
  }

  console.log('🌌 Seed completed successfully! 3 sample cosmic events ready.');
}

if (require.main === module) {
  seedDemoData();
}

module.exports = { seedDemoData };
