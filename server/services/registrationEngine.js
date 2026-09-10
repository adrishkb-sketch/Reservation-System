const db = require('../db');
const { resolveBucketKey } = require('./capacityService');
const { generateReferenceCode, generateQrToken, hashQrToken } = require('./qrService');
const auditService = require('./auditService');
const sseService = require('./sseService');

/**
 * Register a student with strict concurrency safety and transactional isolation.
 */
function registerStudent({ eventId, name, email, phone, department, program, year }) {
  // Normalize & clean
  const cleanName = (name || '').trim().toUpperCase();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPhone = (phone || '').trim();
  const cleanDept = (department || '').trim().toUpperCase();
  const cleanProg = (program || '').trim();
  const cleanYear = (year || '').trim();

  // Basic validations
  if (!cleanName || cleanName.length < 2) {
    throw new Error('Please provide a valid full name.');
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    throw new Error('Please provide a valid email address.');
  }
  const phoneRegex = /^[0-9+\-\s()]{7,16}$/;
  if (!phoneRegex.test(cleanPhone)) {
    throw new Error('Please provide a valid phone number.');
  }

  // Atomic transaction
  const executeRegistration = db.transaction(() => {
    // 1. Fetch event and check status
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) {
      throw new Error('Event not found.');
    }
    if (event.status !== 'published') {
      throw new Error(`Registration is not available (Event status: ${event.status}).`);
    }

    // Check event end date
    const now = new Date();
    if (new Date(event.end_at) < now) {
      throw new Error('This event has already concluded.');
    }

    // 2. Check eligibility combination
    const isEligible = db.prepare(`
      SELECT id FROM event_eligibility 
      WHERE event_id = ? AND department = ? AND program = ? AND year = ?
    `).get(eventId, cleanDept, cleanProg, cleanYear);

    if (!isEligible) {
      throw new Error(`Your category (${cleanDept} • ${cleanProg} • ${cleanYear}) is not eligible for this event.`);
    }

    // 3. Resolve capacity bucket
    const bucketKey = resolveBucketKey(
      { group_dept: event.group_dept, group_prog: event.group_prog, group_year: event.group_year },
      cleanDept,
      cleanProg,
      cleanYear
    );

    const bucket = db.prepare(`
      SELECT * FROM capacity_buckets WHERE event_id = ? AND bucket_key = ?
    `).get(eventId, bucketKey);

    if (!bucket) {
      throw new Error('Capacity pool configuration not found for this eligibility combination.');
    }

    // 4. Duplicate checks (Email or Phone)
    const existing = db.prepare(`
      SELECT id, reference_code, status FROM registrations 
      WHERE event_id = ? AND (email = ? OR phone = ?) AND status != 'cancelled'
    `).get(eventId, cleanEmail, cleanPhone);

    if (existing) {
      throw new Error(`You have already registered for this event (Reference: ${existing.reference_code}, Status: ${existing.status}).`);
    }

    // 5. Count confirmed registrations in this bucket
    const confirmedCount = db.prepare(`
      SELECT COUNT(*) as count FROM registrations 
      WHERE event_id = ? AND capacity_bucket_id = ? AND status = 'confirmed'
    `).get(eventId, bucket.id).count;

    // Generate unique reference & signed QR token
    let referenceCode;
    let isUnique = false;
    while (!isUnique) {
      referenceCode = generateReferenceCode();
      const existingRef = db.prepare('SELECT id FROM registrations WHERE reference_code = ?').get(referenceCode);
      if (!existingRef) isUnique = true;
    }

    const qrToken = generateQrToken(referenceCode);
    const qrTokenHash = hashQrToken(qrToken);

    let status = 'confirmed';
    let waitingPosition = null;
    let seatId = null;
    let assignedSeatNumber = null;

    if (confirmedCount < bucket.capacity) {
      // Confirmed registration
      status = 'confirmed';

      // Find lowest available physical seat for this bucket
      const seat = db.prepare(`
        SELECT id, seat_number FROM seats 
        WHERE event_id = ? AND capacity_bucket_id = ? AND status = 'available'
        ORDER BY seat_number ASC LIMIT 1
      `).get(eventId, bucket.id);

      if (seat) {
        seatId = seat.id;
        assignedSeatNumber = seat.seat_number;
      }
    } else {
      // Waiting list
      status = 'waiting';
      const maxWaiting = db.prepare(`
        SELECT COALESCE(MAX(waiting_position), 0) as max_pos 
        FROM registrations 
        WHERE event_id = ? AND capacity_bucket_id = ? AND status = 'waiting'
      `).get(eventId, bucket.id).max_pos;
      waitingPosition = maxWaiting + 1;
    }

    // Insert registration
    const insertStmt = db.prepare(`
      INSERT INTO registrations (
        event_id, capacity_bucket_id, reference_code, name, email, phone,
        department, program, year, status, waiting_position, seat_id, qr_token_hash,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    const insertResult = insertStmt.run(
      eventId,
      bucket.id,
      referenceCode,
      cleanName,
      cleanEmail,
      cleanPhone,
      cleanDept,
      cleanProg,
      cleanYear,
      status,
      waitingPosition,
      seatId,
      qrTokenHash
    );

    const registrationId = insertResult.lastInsertRowid;

    // If seat was assigned, update seat record
    if (seatId) {
      db.prepare(`
        UPDATE seats SET registration_id = ?, status = 'allocated' WHERE id = ?
      `).run(registrationId, seatId);
    }

    return {
      registrationId,
      referenceCode,
      qrToken,
      status,
      waitingPosition,
      seatNumber: assignedSeatNumber,
      bucketName: bucket.display_name,
      student: {
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        department: cleanDept,
        program: cleanProg,
        year: cleanYear
      }
    };
  });

  const result = executeRegistration();

  // Broadcast real-time update
  sseService.broadcast(eventId, 'registration_update', {
    type: 'new_registration',
    status: result.status,
    bucketName: result.bucketName
  });

  return result;
}

/**
 * Promote waiting students when capacity increases or when a seat becomes free
 */
function promoteWaitingInBucket(eventId, bucketId, seatsToPromoteCount = 1, adminId = null) {
  const waitingStudents = db.prepare(`
    SELECT * FROM registrations 
    WHERE event_id = ? AND capacity_bucket_id = ? AND status = 'waiting'
    ORDER BY waiting_position ASC
    LIMIT ?
  `).all(eventId, bucketId, seatsToPromoteCount);

  const promoted = [];

  for (const student of waitingStudents) {
    // Find lowest available physical seat in this bucket
    const seat = db.prepare(`
      SELECT id, seat_number FROM seats 
      WHERE event_id = ? AND capacity_bucket_id = ? AND status = 'available'
      ORDER BY seat_number ASC LIMIT 1
    `).get(eventId, bucketId);

    const seatId = seat ? seat.id : null;

    db.prepare(`
      UPDATE registrations 
      SET status = 'confirmed', waiting_position = NULL, seat_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(seatId, student.id);

    if (seatId) {
      db.prepare(`
        UPDATE seats SET registration_id = ?, status = 'allocated' WHERE id = ?
      `).run(student.id, seatId);
    }

    auditService.logAction(
      adminId,
      eventId,
      student.id,
      'AUTO_PROMOTED_FROM_WAITING',
      { status: 'waiting', position: student.waiting_position },
      { status: 'confirmed', seatNumber: seat ? seat.seat_number : null }
    );

    promoted.push({
      studentId: student.id,
      referenceCode: student.reference_code,
      name: student.name,
      seatNumber: seat ? seat.seat_number : null
    });
  }

  // Re-sequence remaining waiting list
  resequenceWaitingList(eventId, bucketId);

  return promoted;
}

/**
 * Re-sequence waiting positions to 1, 2, 3...
 */
function resequenceWaitingList(eventId, bucketId) {
  const remainingWaiting = db.prepare(`
    SELECT id FROM registrations 
    WHERE event_id = ? AND capacity_bucket_id = ? AND status = 'waiting'
    ORDER BY waiting_position ASC, created_at ASC
  `).all(eventId, bucketId);

  const updateStmt = db.prepare('UPDATE registrations SET waiting_position = ? WHERE id = ?');
  remainingWaiting.forEach((row, idx) => {
    updateStmt.run(idx + 1, row.id);
  });
}

/**
 * Update capacity of a bucket with safety invariants
 */
function updateBucketCapacity(eventId, bucketId, newCapacity, adminId = null) {
  const transaction = db.transaction(() => {
    const bucket = db.prepare('SELECT * FROM capacity_buckets WHERE id = ? AND event_id = ?').get(bucketId, eventId);
    if (!bucket) {
      throw new Error('Capacity bucket not found.');
    }

    if (newCapacity < 0) {
      throw new Error('Capacity cannot be negative.');
    }

    // Count confirmed students in bucket
    const confirmedCount = db.prepare(`
      SELECT COUNT(*) as count FROM registrations 
      WHERE event_id = ? AND capacity_bucket_id = ? AND status = 'confirmed'
    `).get(eventId, bucketId).count;

    // Safety rule: Never reduce below confirmed count
    if (newCapacity < confirmedCount) {
      throw new Error(`Cannot reduce capacity to ${newCapacity}. There are already ${confirmedCount} confirmed students in "${bucket.display_name}". Minimum allowed capacity is ${confirmedCount}.`);
    }

    const oldCapacity = bucket.capacity;
    db.prepare('UPDATE capacity_buckets SET capacity = ? WHERE id = ?').run(newCapacity, bucketId);

    auditService.logAction(
      adminId,
      eventId,
      null,
      'UPDATE_BUCKET_CAPACITY',
      { bucket: bucket.display_name, capacity: oldCapacity },
      { bucket: bucket.display_name, capacity: newCapacity }
    );

    let promoted = [];
    if (newCapacity > confirmedCount) {
      const seatsAvailable = newCapacity - confirmedCount;
      promoted = promoteWaitingInBucket(eventId, bucketId, seatsAvailable, adminId);
    }

    return {
      bucketId,
      bucketName: bucket.display_name,
      oldCapacity,
      newCapacity,
      confirmedCount,
      promoted
    };
  });

  const result = transaction();

  sseService.broadcast(eventId, 'capacity_update', result);
  return result;
}

/**
 * Cancel a registration (by admin or student)
 */
function cancelRegistration(eventId, registrationId, adminId = null, reason = 'Cancelled by admin') {
  const transaction = db.transaction(() => {
    const reg = db.prepare('SELECT * FROM registrations WHERE id = ? AND event_id = ?').get(registrationId, eventId);
    if (!reg) {
      throw new Error('Registration not found.');
    }
    if (reg.status === 'cancelled') {
      throw new Error('Registration is already cancelled.');
    }

    const previousStatus = reg.status;
    const previousSeatId = reg.seat_id;

    // If seat was assigned, release it
    if (previousSeatId) {
      db.prepare(`
        UPDATE seats SET registration_id = NULL, status = 'available' WHERE id = ?
      `).run(previousSeatId);
    }

    // Update registration status
    db.prepare(`
      UPDATE registrations 
      SET status = 'cancelled', seat_id = NULL, waiting_position = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(registrationId);

    auditService.logAction(
      adminId,
      eventId,
      registrationId,
      'CANCEL_REGISTRATION',
      { status: previousStatus, seatId: previousSeatId, reason },
      { status: 'cancelled' }
    );

    let promoted = [];
    if (previousStatus === 'confirmed') {
      // Promote next waiting student into this bucket
      promoted = promoteWaitingInBucket(eventId, reg.capacity_bucket_id, 1, adminId);
    } else if (previousStatus === 'waiting') {
      // Re-sequence remaining waiting list
      resequenceWaitingList(eventId, reg.capacity_bucket_id);
    }

    return {
      registrationId,
      referenceCode: reg.reference_code,
      studentName: reg.name,
      previousStatus,
      promoted
    };
  });

  const result = transaction();
  sseService.broadcast(eventId, 'registration_update', { type: 'cancellation', ...result });
  return result;
}

/**
 * Manually promote a waiting student
 */
function manuallyPromoteStudent(eventId, registrationId, adminId = null) {
  const transaction = db.transaction(() => {
    const reg = db.prepare('SELECT * FROM registrations WHERE id = ? AND event_id = ?').get(registrationId, eventId);
    if (!reg) throw new Error('Registration not found.');
    if (reg.status !== 'waiting') throw new Error(`Student is currently "${reg.status}", not waiting.`);

    // Find lowest available seat in their bucket or any available seat
    let seat = db.prepare(`
      SELECT id, seat_number FROM seats 
      WHERE event_id = ? AND capacity_bucket_id = ? AND status = 'available'
      ORDER BY seat_number ASC LIMIT 1
    `).get(eventId, reg.capacity_bucket_id);

    if (!seat) {
      // Try any available seat in the event
      seat = db.prepare(`
        SELECT id, seat_number FROM seats 
        WHERE event_id = ? AND status = 'available'
        ORDER BY seat_number ASC LIMIT 1
      `).get(eventId);
    }

    const seatId = seat ? seat.id : null;

    db.prepare(`
      UPDATE registrations 
      SET status = 'confirmed', waiting_position = NULL, seat_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(seatId, reg.id);

    if (seatId) {
      db.prepare(`
        UPDATE seats SET registration_id = ?, status = 'allocated' WHERE id = ?
      `).run(reg.id, seatId);
    }

    // If bucket capacity was less than confirmed count now, optionally adjust capacity
    const confirmedCount = db.prepare(`
      SELECT COUNT(*) as count FROM registrations 
      WHERE event_id = ? AND capacity_bucket_id = ? AND status = 'confirmed'
    `).get(eventId, reg.capacity_bucket_id).count;

    const bucket = db.prepare('SELECT capacity FROM capacity_buckets WHERE id = ?').get(reg.capacity_bucket_id);
    if (bucket && confirmedCount > bucket.capacity) {
      db.prepare('UPDATE capacity_buckets SET capacity = ? WHERE id = ?').run(confirmedCount, reg.capacity_bucket_id);
    }

    resequenceWaitingList(eventId, reg.capacity_bucket_id);

    auditService.logAction(
      adminId,
      eventId,
      reg.id,
      'MANUAL_PROMOTION',
      { status: 'waiting', position: reg.waiting_position },
      { status: 'confirmed', seatNumber: seat ? seat.seat_number : null }
    );

    return {
      registrationId: reg.id,
      referenceCode: reg.reference_code,
      name: reg.name,
      seatNumber: seat ? seat.seat_number : null
    };
  });

  const result = transaction();
  sseService.broadcast(eventId, 'registration_update', { type: 'manual_promotion', ...result });
  return result;
}

/**
 * Manual seat reassignment with collision handling & audit logging
 */
function reassignSeat(eventId, registrationId, targetSeatNumber, adminId = null, forceSwap = false) {
  const transaction = db.transaction(() => {
    const reg = db.prepare(`
      SELECT r.*, s.seat_number as current_seat_number 
      FROM registrations r
      LEFT JOIN seats s ON r.seat_id = s.id
      WHERE r.id = ? AND r.event_id = ?
    `).get(registrationId, eventId);

    if (!reg) throw new Error('Registration not found.');
    if (reg.status !== 'confirmed') throw new Error('Cannot assign physical seat to a non-confirmed registration.');

    const targetSeat = db.prepare('SELECT * FROM seats WHERE event_id = ? AND seat_number = ?').get(eventId, targetSeatNumber);
    if (!targetSeat) throw new Error(`Seat #${targetSeatNumber} does not exist in this event.`);

    if (reg.seat_id === targetSeat.id) {
      return { message: 'Student is already assigned to this seat.', seatNumber: targetSeatNumber };
    }

    const previousSeatNumber = reg.current_seat_number;
    const occupantRegId = targetSeat.registration_id;

    if (occupantRegId && occupantRegId !== registrationId) {
      if (!forceSwap) {
        const occupant = db.prepare('SELECT name, reference_code FROM registrations WHERE id = ?').get(occupantRegId);
        return {
          collision: true,
          occupantName: occupant ? occupant.name : 'Another Student',
          occupantReference: occupant ? occupant.reference_code : 'N/A',
          targetSeatNumber
        };
      }

      // Force swap or displace occupant
      // If current student has a seat, swap occupant to old seat, else unseat occupant
      if (reg.seat_id) {
        // Swap occupant to previous seat
        db.prepare('UPDATE seats SET registration_id = ?, status = \'allocated\' WHERE id = ?')
          .run(occupantRegId, reg.seat_id);
        db.prepare('UPDATE registrations SET seat_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(reg.seat_id, occupantRegId);

        auditService.logAction(
          adminId,
          eventId,
          occupantRegId,
          'SEAT_SWAP_DISPLACED',
          { seatNumber: targetSeatNumber },
          { seatNumber: previousSeatNumber }
        );
      } else {
        // Unseat occupant
        db.prepare('UPDATE registrations SET seat_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(occupantRegId);

        auditService.logAction(
          adminId,
          eventId,
          occupantRegId,
          'SEAT_UNSEATED_BY_REASSIGNMENT',
          { seatNumber: targetSeatNumber },
          { seatNumber: null }
        );
      }
    } else if (reg.seat_id) {
      // Free old seat
      db.prepare('UPDATE seats SET registration_id = NULL, status = \'available\' WHERE id = ?').run(reg.seat_id);
    }

    // Assign target seat to student
    db.prepare('UPDATE seats SET registration_id = ?, status = \'allocated\' WHERE id = ?').run(registrationId, targetSeat.id);
    db.prepare('UPDATE registrations SET seat_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(targetSeat.id, registrationId);

    auditService.logAction(
      adminId,
      eventId,
      registrationId,
      'MANUAL_SEAT_REASSIGNMENT',
      { oldSeatNumber: previousSeatNumber },
      { newSeatNumber: targetSeatNumber }
    );

    return {
      success: true,
      registrationId,
      studentName: reg.name,
      oldSeatNumber: previousSeatNumber,
      newSeatNumber: targetSeatNumber
    };
  });

  const result = transaction();
  if (result.success) {
    sseService.broadcast(eventId, 'seat_update', result);
  }
  return result;
}

module.exports = {
  registerStudent,
  updateBucketCapacity,
  promoteWaitingInBucket,
  cancelRegistration,
  manuallyPromoteStudent,
  reassignSeat,
  resequenceWaitingList
};
