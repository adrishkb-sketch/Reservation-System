const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const { registerStudent, cancelRegistration, manuallyPromoteStudent } = require('../services/registrationEngine');
const auditService = require('../services/auditService');

const registrationLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
  message: 'Registration rate limit reached. Please wait a moment and try again.'
});

// Public: Student Registration
router.post('/events/:id/register', registrationLimiter, (req, res) => {
  try {
    const eventId = parseInt(req.params.id, 10);
    const { name, email, phone, department, program, year } = req.body;

    const result = registerStudent({
      eventId,
      name,
      email,
      phone,
      department,
      program,
      year
    });

    return res.status(201).json({
      success: true,
      message: result.status === 'confirmed' 
        ? 'Registration confirmed! Digital ticket generated.' 
        : `Added to waiting list (${result.bucketName} — Position #${result.waitingPosition}).`,
      data: result
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Public: Reference Lookup
router.get('/registrations/lookup/:referenceCode', (req, res) => {
  try {
    const referenceCode = (req.params.referenceCode || '').trim().toUpperCase();
    if (!referenceCode) {
      return res.status(400).json({ error: 'Please provide a valid reference code.' });
    }

    const reg = db.prepare(`
      SELECT 
        r.*,
        e.name as event_name,
        e.description as event_description,
        e.banner_url as event_banner,
        e.start_at as event_start,
        e.end_at as event_end,
        e.status as event_status,
        cb.display_name as bucket_display_name,
        s.seat_number,
        ci.checked_in_at
      FROM registrations r
      JOIN events e ON r.event_id = e.id
      JOIN capacity_buckets cb ON r.capacity_bucket_id = cb.id
      LEFT JOIN seats s ON r.seat_id = s.id
      LEFT JOIN check_ins ci ON r.id = ci.registration_id
      WHERE r.reference_code = ?
    `).get(referenceCode);

    if (!reg) {
      return res.status(404).json({ error: `Registration with reference "${referenceCode}" was not found.` });
    }

    return res.json({
      success: true,
      registration: {
        id: reg.id,
        referenceCode: reg.reference_code,
        name: reg.name,
        email: reg.email,
        phone: reg.phone,
        department: reg.department,
        program: reg.program,
        year: reg.year,
        status: reg.status,
        waitingPosition: reg.waiting_position,
        seatNumber: reg.seat_number,
        bucketName: reg.bucket_display_name,
        createdAt: reg.created_at,
        updatedAt: reg.updated_at,
        checkedInAt: reg.checked_in_at,
        isCheckedIn: !!reg.checked_in_at,
        qrTokenHash: reg.qr_token_hash,
        event: {
          id: reg.event_id,
          name: reg.event_name,
          description: reg.event_description,
          bannerUrl: reg.event_banner,
          startAt: reg.event_start,
          endAt: reg.event_end,
          status: reg.event_status
        }
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: List registrations for an event with search & filters
router.get('/admin/events/:id/registrations', requireAdmin, (req, res) => {
  try {
    const eventId = req.params.id;
    const { search, department, program, year, status, bucketId } = req.query;

    let query = `
      SELECT 
        r.*,
        cb.display_name as bucket_name,
        s.seat_number,
        ci.checked_in_at,
        (ci.id IS NOT NULL) as is_checked_in
      FROM registrations r
      JOIN capacity_buckets cb ON r.capacity_bucket_id = cb.id
      LEFT JOIN seats s ON r.seat_id = s.id
      LEFT JOIN check_ins ci ON r.id = ci.registration_id
      WHERE r.event_id = ?
    `;
    const params = [eventId];

    if (search) {
      query += ` AND (r.name LIKE ? OR r.reference_code LIKE ? OR r.email LIKE ? OR r.phone LIKE ?)`;
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }
    if (department) {
      query += ` AND r.department = ?`;
      params.push(department);
    }
    if (program) {
      query += ` AND r.program = ?`;
      params.push(program);
    }
    if (year) {
      query += ` AND r.year = ?`;
      params.push(year);
    }
    if (status) {
      query += ` AND r.status = ?`;
      params.push(status);
    }
    if (bucketId) {
      query += ` AND r.capacity_bucket_id = ?`;
      params.push(bucketId);
    }

    query += ` ORDER BY 
      CASE WHEN r.status = 'confirmed' THEN 1 WHEN r.status = 'waiting' THEN 2 ELSE 3 END,
      r.waiting_position ASC,
      r.created_at DESC
    `;

    const registrations = db.prepare(query).all(...params);
    return res.json({ registrations });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: Manual Promotion
router.post('/admin/events/:id/registrations/:regId/promote', requireAdmin, (req, res) => {
  try {
    const { id: eventId, regId } = req.params;
    const result = manuallyPromoteStudent(eventId, regId, req.admin.id);
    return res.json({
      success: true,
      message: `Student ${result.name} (${result.referenceCode}) promoted to Confirmed (Seat #${result.seatNumber || 'N/A'}).`,
      result
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Admin: Cancel Registration
router.post('/admin/events/:id/registrations/:regId/cancel', requireAdmin, (req, res) => {
  try {
    const { id: eventId, regId } = req.params;
    const { reason } = req.body;
    const result = cancelRegistration(eventId, regId, req.admin.id, reason);
    return res.json({
      success: true,
      message: `Registration ${result.referenceCode} cancelled successfully.`,
      result
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Admin: Edit Student Details
router.put('/admin/events/:id/registrations/:regId/details', requireAdmin, (req, res) => {
  try {
    const { id: eventId, regId } = req.params;
    const { name, email, phone } = req.body;

    const existing = db.prepare('SELECT * FROM registrations WHERE id = ? AND event_id = ?').get(regId, eventId);
    if (!existing) return res.status(404).json({ error: 'Registration not found' });

    const cleanName = name ? name.trim().toUpperCase() : existing.name;
    const cleanEmail = email ? email.trim().toLowerCase() : existing.email;
    const cleanPhone = phone ? phone.trim() : existing.phone;

    db.prepare(`
      UPDATE registrations 
      SET name = ?, email = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(cleanName, cleanEmail, cleanPhone, regId);

    auditService.logAction(
      req.admin.id,
      eventId,
      regId,
      'EDIT_STUDENT_DETAILS',
      { name: existing.name, email: existing.email, phone: existing.phone },
      { name: cleanName, email: cleanEmail, phone: cleanPhone }
    );

    return res.json({ success: true, message: 'Student details updated successfully.' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
