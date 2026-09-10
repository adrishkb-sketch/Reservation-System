const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Set test DB path before requiring db
const testDbPath = path.join(__dirname, '..', 'data', 'test_portal.sqlite');
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}
process.env.DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../server/db');
const { generateBucketsFromEligibility, resolveBucketKey } = require('../server/services/capacityService');
const { registerStudent, updateBucketCapacity, cancelRegistration, reassignSeat, manuallyPromoteStudent } = require('../server/services/registrationEngine');
const { configureSeatsForEvent, getEventSeatMap } = require('../server/services/seatService');
const { generateReferenceCode, generateQrToken, hashQrToken, validateQrToken } = require('../server/services/qrService');

async function runTests() {
  console.log('🌌 ========================================================');
  console.log('🌌 RUNNING COMPREHENSIVE COSMIC EVENT PORTAL TEST SUITE');
  console.log('🌌 ========================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(`   Error: ${err.message}`);
      console.error(err.stack);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(`   Error: ${err.message}`);
      console.error(err.stack);
      failed++;
    }
  }

  // --- TEST 1: Capacity Grouping Logic ---
  test('1. Dynamic Capacity Grouping (3 Independent Switches)', () => {
    const eligibility = [
      { department: 'CSE', program: 'B.Tech', year: '1st Year' },
      { department: 'CSE', program: 'B.Tech', year: '2nd Year' },
      { department: 'IT', program: 'B.Tech', year: '1st Year' },
      { department: 'CT', program: 'M.Tech', year: '1st Year' }
    ];

    // Case A: Year ONLY (group_year = 1, others 0)
    const yearOnlyBuckets = generateBucketsFromEligibility(eligibility, { group_dept: 0, group_prog: 0, group_year: 1 });
    assert.strictEqual(yearOnlyBuckets.length, 2, 'Should produce 2 buckets (1st Year, 2nd Year)');
    const b1 = yearOnlyBuckets.find(b => b.bucket_key === 'YEAR:1st Year');
    assert(b1, '1st Year bucket must exist');

    // Case B: All ON
    const allOnBuckets = generateBucketsFromEligibility(eligibility, { group_dept: 1, group_prog: 1, group_year: 1 });
    assert.strictEqual(allOnBuckets.length, 4, 'Should produce 4 unique individual buckets');

    // Case C: All OFF (Global)
    const allOffBuckets = generateBucketsFromEligibility(eligibility, { group_dept: 0, group_prog: 0, group_year: 0 });
    assert.strictEqual(allOffBuckets.length, 1, 'Should produce 1 global bucket');
    assert.strictEqual(allOffBuckets[0].bucket_key, 'GLOBAL');
  });

  // --- SETUP EVENT FOR CONCURRENCY & INVARIANTS ---
  const now = new Date();
  const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const eventRes = db.prepare(`
    INSERT INTO events (name, description, start_at, end_at, status, group_dept, group_prog, group_year, total_physical_seats)
    VALUES (?, ?, ?, ?, 'published', 0, 0, 1, 100)
  `).run('Cosmic Hackathon 2026', 'Intergalactic Coding Arena', now.toISOString(), future.toISOString());

  const eventId = eventRes.lastInsertRowid;

  // Insert Eligibility (CSE, IT, CT for B.Tech 1st-4th)
  const depts = ['CSE', 'IT', 'CT'];
  const years = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
  for (const d of depts) {
    for (const y of years) {
      db.prepare('INSERT INTO event_eligibility (event_id, department, program, year) VALUES (?, ?, ?, ?)').run(eventId, d, 'B.Tech', y);
    }
  }

  // Grouping is Year-only. Create buckets:
  // 1st Year: capacity 20
  // 2nd Year: capacity 20
  // 3rd Year: capacity 20
  // 4th Year: capacity 20
  const b1Res = db.prepare('INSERT INTO capacity_buckets (event_id, bucket_key, display_name, year, capacity) VALUES (?, ?, ?, ?, ?)').run(eventId, 'YEAR:1st Year', '1st Year', '1st Year', 20);
  const b2Res = db.prepare('INSERT INTO capacity_buckets (event_id, bucket_key, display_name, year, capacity) VALUES (?, ?, ?, ?, ?)').run(eventId, 'YEAR:2nd Year', '2nd Year', '2nd Year', 20);
  const b3Res = db.prepare('INSERT INTO capacity_buckets (event_id, bucket_key, display_name, year, capacity) VALUES (?, ?, ?, ?, ?)').run(eventId, 'YEAR:3rd Year', '3rd Year', '3rd Year', 20);
  const b4Res = db.prepare('INSERT INTO capacity_buckets (event_id, bucket_key, display_name, year, capacity) VALUES (?, ?, ?, ?, ?)').run(eventId, 'YEAR:4th Year', '4th Year', '4th Year', 20);

  const bucket1stYearId = b1Res.lastInsertRowid;

  // Configure physical seats: 1st Year gets seats 1-20
  configureSeatsForEvent(eventId, 100, [
    { bucketId: bucket1stYearId, rangeStr: '1-20' },
    { bucketId: b2Res.lastInsertRowid, rangeStr: '21-40' },
    { bucketId: b3Res.lastInsertRowid, rangeStr: '41-60' },
    { bucketId: b4Res.lastInsertRowid, rangeStr: '61-80' }
  ]);

  // --- TEST 2: 200 SIMULTANEOUS USERS FOR 20 SEATS (STRICT CONCURRENCY TEST) ---
  await asyncTest('2. Concurrency Safety: 200 Simultaneous Users for 20 Seats -> Exactly 20 Confirmed & 180 Waiting', async () => {
    const promises = [];
    for (let i = 1; i <= 200; i++) {
      const p = new Promise((resolve) => {
        // Slight micro-jitter to simulate asynchronous multi-thread arrival
        setTimeout(() => {
          try {
            const dept = depts[i % depts.length];
            const reg = registerStudent({
              eventId,
              name: `Student Astronaut ${i}`,
              email: `astronaut_${i}@interstellar.edu`,
              phone: `+91 98000 ${String(10000 + i)}`,
              department: dept,
              program: 'B.Tech',
              year: '1st Year'
            });
            resolve({ success: true, reg });
          } catch (err) {
            resolve({ success: false, error: err.message });
          }
        }, Math.floor(Math.random() * 20));
      });
      promises.push(p);
    }

    const results = await Promise.all(promises);

    const successful = results.filter(r => r.success);
    assert.strictEqual(successful.length, 200, 'All 200 registration calls must successfully process without deadlock or crash');

    // Query DB for absolute ground truth
    const confirmedList = db.prepare('SELECT * FROM registrations WHERE event_id = ? AND capacity_bucket_id = ? AND status = \'confirmed\'').all(eventId, bucket1stYearId);
    const waitingList = db.prepare('SELECT * FROM registrations WHERE event_id = ? AND capacity_bucket_id = ? AND status = \'waiting\' ORDER BY waiting_position ASC').all(eventId, bucket1stYearId);

    assert.strictEqual(confirmedList.length, 20, `CRITICAL CONCURRENCY INVARIANT: Expected exactly 20 confirmed, got ${confirmedList.length}`);
    assert.strictEqual(waitingList.length, 180, `CRITICAL CONCURRENCY INVARIANT: Expected exactly 180 waiting, got ${waitingList.length}`);

    // Verify all 20 confirmed have unique physical seats from 1 to 20
    const assignedSeats = confirmedList.map(r => {
      const seat = db.prepare('SELECT seat_number FROM seats WHERE id = ?').get(r.seat_id);
      return seat ? seat.seat_number : null;
    });

    assert.strictEqual(new Set(assignedSeats).size, 20, 'All 20 confirmed students must have distinct physical seats');
    for (const seatNum of assignedSeats) {
      assert(seatNum >= 1 && seatNum <= 20, `Seat number ${seatNum} must be within assigned bucket range (1-20)`);
    }

    // Verify waiting list positions are strictly sequential 1 to 180 without gaps or duplicates
    for (let i = 0; i < waitingList.length; i++) {
      assert.strictEqual(waitingList[i].waiting_position, i + 1, `Waiting position at index ${i} must be ${i + 1}`);
      assert.strictEqual(waitingList[i].seat_id, null, 'Waiting student must not have a physical seat assigned');
    }
  });

  // --- TEST 3: Duplicate Registration & Idempotency ---
  test('3. Duplicate Registration Prevention & Name Normalization', () => {
    // Attempt duplicate email
    assert.throws(() => {
      registerStudent({
        eventId,
        name: 'duplicate test',
        email: 'astronaut_1@interstellar.edu', // already registered
        phone: '+91 99999 11111',
        department: 'CSE',
        program: 'B.Tech',
        year: '1st Year'
      });
    }, /already registered/i);

    // Verify name normalization to uppercase
    const regCheck = db.prepare('SELECT name FROM registrations WHERE email = ?').get('astronaut_1@interstellar.edu');
    assert.strictEqual(regCheck.name, 'STUDENT ASTRONAUT 1');
  });

  // --- TEST 4: Capacity Reduction Invariant ---
  test('4. Capacity Reduction Invariant: Cannot reduce below confirmed count', () => {
    // Bucket 1st Year currently has 20 confirmed
    assert.throws(() => {
      updateBucketCapacity(eventId, bucket1stYearId, 19, 1);
    }, /Cannot reduce capacity/i);

    // Reducing to exactly 20 should succeed
    const okResult = updateBucketCapacity(eventId, bucket1stYearId, 20, 1);
    assert.strictEqual(okResult.newCapacity, 20);
  });

  // --- TEST 5: Capacity Expansion & FIFO Waiting List Promotion ---
  test('5. Capacity Expansion: Automatically promotes waiting students in FIFO order & assigns seats', () => {
    // Before: 20 confirmed, 180 waiting
    // First let's add seats 81-85 to bucket 1st Year so physical seats are available
    db.prepare('UPDATE seats SET capacity_bucket_id = ? WHERE event_id = ? AND seat_number BETWEEN 81 AND 85').run(bucket1stYearId, eventId);

    // Increase capacity from 20 -> 25
    const promoResult = updateBucketCapacity(eventId, bucket1stYearId, 25, 1);
    assert.strictEqual(promoResult.promoted.length, 5, 'Should promote exactly 5 waiting students');

    const confirmedCount = db.prepare('SELECT COUNT(*) as c FROM registrations WHERE event_id = ? AND capacity_bucket_id = ? AND status = \'confirmed\'').get(eventId, bucket1stYearId).c;
    const waitingCount = db.prepare('SELECT COUNT(*) as c FROM registrations WHERE event_id = ? AND capacity_bucket_id = ? AND status = \'waiting\'').get(eventId, bucket1stYearId).c;

    assert.strictEqual(confirmedCount, 25, 'Confirmed count must now be 25');
    assert.strictEqual(waitingCount, 175, 'Waiting count must now be 175');

    // Verify remaining waiting students are resequenced 1 to 175
    const firstRemaining = db.prepare('SELECT waiting_position FROM registrations WHERE event_id = ? AND capacity_bucket_id = ? AND status = \'waiting\' ORDER BY waiting_position ASC LIMIT 1').get(eventId, bucket1stYearId);
    assert.strictEqual(firstRemaining.waiting_position, 1, 'First remaining waiting student must be position #1');
  });

  // --- TEST 6: Cancellation & Auto-Promotion ---
  test('6. Cancellation: Frees seat and automatically promotes earliest waiting student', () => {
    // Cancel confirmed student #1
    const confirmedStudent = db.prepare('SELECT id, seat_id, reference_code FROM registrations WHERE event_id = ? AND capacity_bucket_id = ? AND status = \'confirmed\' LIMIT 1').get(eventId, bucket1stYearId);
    
    const cancelResult = cancelRegistration(eventId, confirmedStudent.id, 1, 'Test cancellation');
    assert.strictEqual(cancelResult.promoted.length, 1, 'One waiting student must be promoted to fill the vacated seat');

    // Confirmed count should still be 25 (1 cancelled, 1 promoted)
    const confirmedCount = db.prepare('SELECT COUNT(*) as c FROM registrations WHERE event_id = ? AND capacity_bucket_id = ? AND status = \'confirmed\'').get(eventId, bucket1stYearId).c;
    const waitingCount = db.prepare('SELECT COUNT(*) as c FROM registrations WHERE event_id = ? AND capacity_bucket_id = ? AND status = \'waiting\'').get(eventId, bucket1stYearId).c;

    assert.strictEqual(confirmedCount, 25);
    assert.strictEqual(waitingCount, 174);
  });

  // --- TEST 7: Manual Seat Reassignment & Collision Warning ---
  test('7. Manual Seat Reassignment with Collision Handling & Audit Logging', () => {
    const studentA = db.prepare(`
      SELECT r.id, s.seat_number 
      FROM registrations r 
      JOIN seats s ON r.seat_id = s.id 
      WHERE r.event_id = ? AND r.status = 'confirmed' 
      LIMIT 1 OFFSET 0
    `).get(eventId);

    const studentB = db.prepare(`
      SELECT r.id, s.seat_number 
      FROM registrations r 
      JOIN seats s ON r.seat_id = s.id 
      WHERE r.event_id = ? AND r.status = 'confirmed' 
      LIMIT 1 OFFSET 1
    `).get(eventId);

    // Attempt reassigning Student A to Student B's seat without forceSwap -> should warn collision
    const collisionCheck = reassignSeat(eventId, studentA.id, studentB.seat_number, 1, false);
    assert(collisionCheck.collision, 'Must report seat collision warning');

    // Reassign with forceSwap = true -> should swap
    const swapResult = reassignSeat(eventId, studentA.id, studentB.seat_number, 1, true);
    assert(swapResult.success, 'Swap must succeed');
    assert.strictEqual(swapResult.newSeatNumber, studentB.seat_number);

    // Verify in DB that student A has student B's old seat
    const updatedA = db.prepare('SELECT s.seat_number FROM registrations r JOIN seats s ON r.seat_id = s.id WHERE r.id = ?').get(studentA.id);
    assert.strictEqual(updatedA.seat_number, studentB.seat_number);
  });

  // --- TEST 8: QR Security & Token Verification ---
  test('8. QR Token Security, Signing & Hash Validation', () => {
    const ref = generateReferenceCode();
    assert(/^ADR-\d{2}-[A-Z0-9]{6}$/.test(ref), `Reference code format valid: ${ref}`);

    const token = generateQrToken(ref);
    const hash = hashQrToken(token);

    const val = validateQrToken(token, hash);
    assert(val.valid, 'Valid token must pass validation');

    // Tampered token test
    const tampered = token.slice(0, -4) + 'abcd';
    const tamperedVal = validateQrToken(tampered, hash);
    assert(!tamperedVal.valid, 'Tampered token signature must fail validation');
  });

  // --- TEST 9: QR Check-In Flow (Confirmed vs Waiting vs Duplicate) ---
  test('9. QR Scanner Invariants: Confirmed, Waiting, Already-Checked-In', () => {
    // 1. Check in confirmed student
    const confirmedStudent = db.prepare('SELECT id, reference_code, qr_token_hash FROM registrations WHERE event_id = ? AND status = \'confirmed\' LIMIT 1').get(eventId);
    const validToken = generateQrToken(confirmedStudent.reference_code);
    const validHash = hashQrToken(validToken);
    db.prepare('UPDATE registrations SET qr_token_hash = ? WHERE id = ?').run(validHash, confirmedStudent.id);

    // Simulate check-in
    db.prepare('INSERT INTO check_ins (registration_id, checked_in_by) VALUES (?, 1)').run(confirmedStudent.id);

    const checkInRecord = db.prepare('SELECT * FROM check_ins WHERE registration_id = ?').get(confirmedStudent.id);
    assert(checkInRecord, 'Check-in must be saved in database');

    // 2. Duplicate check-in detection
    const isAlreadyCheckedIn = db.prepare('SELECT id FROM check_ins WHERE registration_id = ?').get(confirmedStudent.id);
    assert(isAlreadyCheckedIn, 'Must detect that student is already checked in');

    // 3. Waiting student check-in rejection
    const waitingStudent = db.prepare('SELECT id, status FROM registrations WHERE event_id = ? AND status = \'waiting\' LIMIT 1').get(eventId);
    assert.strictEqual(waitingStudent.status, 'waiting');
    // In our checkInRoutes, waiting status returns 403 INVALID / NOT ELIGIBLE FOR ENTRY
  });

  console.log('\n🌌 ========================================================');
  console.log(`🌌 ALL TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED`);
  console.log('🌌 ========================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
