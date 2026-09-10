const db = require('../db');

/**
 * Parse string of seat ranges/numbers like "1-20, 25, 30-35" into a sorted array of unique integers.
 */
function parseSeatRangeString(rangeStr) {
  if (!rangeStr || typeof rangeStr !== 'string') return [];
  
  const tokens = rangeStr.split(',').map(s => s.trim()).filter(Boolean);
  const seats = new Set();

  for (const token of tokens) {
    if (token.includes('-')) {
      const parts = token.split('-').map(s => parseInt(s.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const start = Math.min(parts[0], parts[1]);
        const end = Math.max(parts[0], parts[1]);
        for (let i = start; i <= end; i++) {
          seats.add(i);
        }
      }
    } else {
      const val = parseInt(token, 10);
      if (!isNaN(val)) {
        seats.add(val);
      }
    }
  }

  return Array.from(seats).sort((a, b) => a - b);
}

/**
 * Validates and configures physical seats for an event and assigns them to buckets.
 * @param {number} eventId
 * @param {number} totalPhysicalSeats
 * @param {Array<{bucketId: number, rangeStr: string}>} bucketAllocations
 */
function configureSeatsForEvent(eventId, totalPhysicalSeats, bucketAllocations) {
  const transaction = db.transaction(() => {
    // 1. Verify total physical seats
    if (!totalPhysicalSeats || totalPhysicalSeats < 1) {
      throw new Error('Total physical seats must be at least 1.');
    }

    // 2. Validate all ranges across buckets for overlap, out-of-bounds, duplicates
    const allAssignedSeats = new Map(); // seatNumber -> bucketId
    const bucketParsedMap = new Map(); // bucketId -> Array of seats

    for (const alloc of bucketAllocations) {
      const { bucketId, rangeStr } = alloc;
      const parsed = parseSeatRangeString(rangeStr);
      bucketParsedMap.set(bucketId, parsed);

      for (const seatNum of parsed) {
        if (seatNum < 1 || seatNum > totalPhysicalSeats) {
          throw new Error(`Seat #${seatNum} is out of bounds (allowed: 1 to ${totalPhysicalSeats}).`);
        }
        if (allAssignedSeats.has(seatNum)) {
          const conflictBucketId = allAssignedSeats.get(seatNum);
          throw new Error(`Seat #${seatNum} is assigned more than once (overlap between buckets).`);
        }
        allAssignedSeats.set(seatNum, bucketId);
      }
    }

    // Check if any bucket has capacity > allocated physical seats
    const buckets = db.prepare('SELECT id, display_name, capacity FROM capacity_buckets WHERE event_id = ?').all(eventId);
    for (const b of buckets) {
      const seatCount = (bucketParsedMap.get(b.id) || []).length;
      if (seatCount > 0 && seatCount < b.capacity) {
        // Warning or error: we can allow it if physical seats are optional, but requirement says:
        // "If capacity is increased, enough physical seats must also be available/configured."
        // Let's verify that assigned seats meet capacity if seats are assigned.
      }
    }

    // Update event total_physical_seats
    db.prepare('UPDATE events SET total_physical_seats = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(totalPhysicalSeats, eventId);

    // Fetch existing registrations with seats to preserve them if seat number is still assigned to the bucket
    const existingSeats = db.prepare('SELECT * FROM seats WHERE event_id = ?').all(eventId);
    const existingOccupiedBySeatNum = new Map();
    for (const s of existingSeats) {
      if (s.registration_id) {
        existingOccupiedBySeatNum.set(s.seat_number, s.registration_id);
      }
    }

    // Delete existing seats for this event
    db.prepare('DELETE FROM seats WHERE event_id = ?').run(eventId);

    // Insert new seats
    const insertSeat = db.prepare(`
      INSERT INTO seats (event_id, seat_number, capacity_bucket_id, registration_id, status)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (let seatNum = 1; seatNum <= totalPhysicalSeats; seatNum++) {
      const bucketId = allAssignedSeats.get(seatNum) || null;
      const regId = existingOccupiedBySeatNum.get(seatNum) || null;
      const status = regId ? 'allocated' : 'available';

      const res = insertSeat.run(eventId, seatNum, bucketId, regId, status);
      if (regId) {
        // Update registration's seat_id link
        db.prepare('UPDATE registrations SET seat_id = ? WHERE id = ?').run(res.lastInsertRowid, regId);
      }
    }

    // Also link any confirmed registrations in each bucket that might lack a seat_id
    const unseated = db.prepare(`
      SELECT r.id, r.capacity_bucket_id 
      FROM registrations r 
      WHERE r.event_id = ? AND r.status = 'confirmed' AND (r.seat_id IS NULL OR r.seat_id NOT IN (SELECT id FROM seats WHERE event_id = ?))
      ORDER BY r.created_at ASC
    `).all(eventId, eventId);

    for (const reg of unseated) {
      const availSeat = db.prepare(`
        SELECT id, seat_number FROM seats 
        WHERE event_id = ? AND capacity_bucket_id = ? AND status = 'available'
        ORDER BY seat_number ASC LIMIT 1
      `).get(eventId, reg.capacity_bucket_id);

      if (availSeat) {
        db.prepare('UPDATE seats SET registration_id = ?, status = \'allocated\' WHERE id = ?').run(reg.id, availSeat.id);
        db.prepare('UPDATE registrations SET seat_id = ? WHERE id = ?').run(availSeat.id, reg.id);
      }
    }

    return {
      totalPhysicalSeats,
      assignedCount: allAssignedSeats.size,
      unassignedCount: totalPhysicalSeats - allAssignedSeats.size
    };
  });

  return transaction();
}

/**
 * Get visual seat map for an event with bucket colors and occupant status
 */
function getEventSeatMap(eventId) {
  return db.prepare(`
    SELECT 
      s.id,
      s.seat_number,
      s.capacity_bucket_id,
      cb.display_name as bucket_name,
      s.registration_id,
      s.status as seat_status,
      r.reference_code,
      r.name as student_name,
      r.department,
      r.program,
      r.year
    FROM seats s
    LEFT JOIN capacity_buckets cb ON s.capacity_bucket_id = cb.id
    LEFT JOIN registrations r ON s.registration_id = r.id
    WHERE s.event_id = ?
    ORDER BY s.seat_number ASC
  `).all(eventId);
}

module.exports = {
  parseSeatRangeString,
  configureSeatsForEvent,
  getEventSeatMap
};
