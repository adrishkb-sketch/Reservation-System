const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { validateQrToken } = require('../services/qrService');
const auditService = require('../services/auditService');
const sseService = require('../services/sseService');

router.post('/scan', requireAdmin, (req, res) => {
  try {
    const { token, eventId } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        status: 'INVALID',
        message: 'Invalid or missing QR token format.'
      });
    }

    // Lookup registration by finding hash or reference prefix
    const parts = token.trim().split('.');
    if (parts.length !== 3) {
      return res.status(400).json({
        status: 'INVALID',
        message: 'INVALID / NOT ELIGIBLE FOR ENTRY: Malformed QR ticket.'
      });
    }

    const referenceCode = parts[0];
    const reg = db.prepare(`
      SELECT 
        r.*,
        e.name as event_name,
        cb.display_name as bucket_display_name,
        s.seat_number,
        ci.checked_in_at,
        ci.id as check_in_id
      FROM registrations r
      JOIN events e ON r.event_id = e.id
      JOIN capacity_buckets cb ON r.capacity_bucket_id = cb.id
      LEFT JOIN seats s ON r.seat_id = s.id
      LEFT JOIN check_ins ci ON r.id = ci.registration_id
      WHERE r.reference_code = ?
    `).get(referenceCode);

    if (!reg) {
      return res.status(404).json({
        status: 'INVALID',
        message: 'INVALID / NOT ELIGIBLE FOR ENTRY: Registration record not found.'
      });
    }

    // If eventId provided, verify it matches
    if (eventId && reg.event_id !== parseInt(eventId, 10)) {
      return res.status(400).json({
        status: 'INVALID',
        message: `INVALID: Ticket belongs to a different event ("${reg.event_name}").`
      });
    }

    // Cryptographically validate QR token signature and hash
    const validation = validateQrToken(token.trim(), reg.qr_token_hash);
    if (!validation.valid) {
      return res.status(400).json({
        status: 'INVALID',
        message: `INVALID / NOT ELIGIBLE FOR ENTRY: ${validation.reason}.`
      });
    }

    // Check status
    if (reg.status === 'waiting') {
      return res.status(403).json({
        status: 'WAITING',
        message: 'INVALID / NOT ELIGIBLE FOR ENTRY: Student is on the WAITING LIST.',
        student: {
          name: reg.name,
          referenceCode: reg.reference_code,
          waitingPosition: reg.waiting_position,
          bucket: reg.bucket_display_name
        }
      });
    }

    if (reg.status === 'cancelled') {
      return res.status(403).json({
        status: 'CANCELLED',
        message: 'INVALID / NOT ELIGIBLE FOR ENTRY: Registration has been CANCELLED.',
        student: {
          name: reg.name,
          referenceCode: reg.reference_code
        }
      });
    }

    if (reg.status !== 'confirmed') {
      return res.status(403).json({
        status: 'INVALID',
        message: `INVALID / NOT ELIGIBLE FOR ENTRY: Status is ${reg.status}.`
      });
    }

    // Check if already checked in
    if (reg.check_in_id || reg.checked_in_at) {
      return res.status(409).json({
        status: 'ALREADY_CHECKED_IN',
        message: `ALREADY CHECKED IN at ${new Date(reg.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`,
        student: {
          name: reg.name,
          referenceCode: reg.reference_code,
          department: reg.department,
          program: reg.program,
          year: reg.year,
          seatNumber: reg.seat_number,
          checkedInAt: reg.checked_in_at
        }
      });
    }

    // Atomic check-in recording
    const checkInTx = db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO check_ins (registration_id, checked_in_at, checked_in_by)
        VALUES (?, CURRENT_TIMESTAMP, ?)
      `);
      insert.run(reg.id, req.admin.id);

      auditService.logAction(
        req.admin.id,
        reg.event_id,
        reg.id,
        'QR_CHECK_IN',
        null,
        { reference: reg.reference_code, seat: reg.seat_number }
      );
    });

    checkInTx();

    const checkInTime = new Date().toISOString();

    // Broadcast SSE update
    sseService.broadcast(reg.event_id, 'check_in_update', {
      registrationId: reg.id,
      referenceCode: reg.reference_code,
      studentName: reg.name,
      seatNumber: reg.seat_number,
      checkedInAt: checkInTime
    });

    return res.status(200).json({
      status: 'SUCCESS',
      message: 'CHECK-IN SUCCESSFUL',
      student: {
        name: reg.name,
        referenceCode: reg.reference_code,
        department: reg.department,
        program: reg.program,
        year: reg.year,
        seatNumber: reg.seat_number,
        checkedInAt: checkInTime,
        eventName: reg.event_name
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

module.exports = router;
