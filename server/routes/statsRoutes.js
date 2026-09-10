const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { getLogsForEvent } = require('../services/auditService');

// Admin global dashboard summary stats
router.get('/dashboard-stats', requireAdmin, (req, res) => {
  try {
    const totalEvents = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
    const publishedEvents = db.prepare('SELECT COUNT(*) as c FROM events WHERE status = \'published\'').get().c;
    const totalConfirmed = db.prepare('SELECT COUNT(*) as c FROM registrations WHERE status = \'confirmed\'').get().c;
    const totalWaiting = db.prepare('SELECT COUNT(*) as c FROM registrations WHERE status = \'waiting\'').get().c;
    const totalCheckedIn = db.prepare('SELECT COUNT(*) as c FROM check_ins').get().c;

    return res.json({
      totalEvents,
      publishedEvents,
      totalConfirmed,
      totalWaiting,
      totalCheckedIn
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin event-specific attendance and analytics breakdown
router.get('/events/:id/stats', requireAdmin, (req, res) => {
  try {
    const eventId = req.params.id;
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const totalConfirmed = db.prepare(`
      SELECT COUNT(*) as c FROM registrations WHERE event_id = ? AND status = 'confirmed'
    `).get(eventId).c;

    const totalWaiting = db.prepare(`
      SELECT COUNT(*) as c FROM registrations WHERE event_id = ? AND status = 'waiting'
    `).get(eventId).c;

    const totalCheckedIn = db.prepare(`
      SELECT COUNT(*) as c FROM check_ins ci 
      JOIN registrations r ON ci.registration_id = r.id 
      WHERE r.event_id = ?
    `).get(eventId).c;

    const notCheckedIn = Math.max(0, totalConfirmed - totalCheckedIn);
    const attendancePercentage = totalConfirmed > 0 ? Math.round((totalCheckedIn / totalConfirmed) * 100) : 0;

    // Breakdown by Department
    const deptBreakdown = db.prepare(`
      SELECT 
        r.department,
        COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) as confirmed,
        COUNT(CASE WHEN r.status = 'waiting' THEN 1 END) as waiting,
        COUNT(ci.id) as checked_in
      FROM registrations r
      LEFT JOIN check_ins ci ON r.id = ci.registration_id
      WHERE r.event_id = ?
      GROUP BY r.department
    `).all(eventId);

    // Breakdown by Program
    const progBreakdown = db.prepare(`
      SELECT 
        r.program,
        COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) as confirmed,
        COUNT(CASE WHEN r.status = 'waiting' THEN 1 END) as waiting,
        COUNT(ci.id) as checked_in
      FROM registrations r
      LEFT JOIN check_ins ci ON r.id = ci.registration_id
      WHERE r.event_id = ?
      GROUP BY r.program
    `).all(eventId);

    // Breakdown by Year
    const yearBreakdown = db.prepare(`
      SELECT 
        r.year,
        COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) as confirmed,
        COUNT(CASE WHEN r.status = 'waiting' THEN 1 END) as waiting,
        COUNT(ci.id) as checked_in
      FROM registrations r
      LEFT JOIN check_ins ci ON r.id = ci.registration_id
      WHERE r.event_id = ?
      GROUP BY r.year
    `).all(eventId);

    // Breakdown by Capacity Bucket
    const bucketBreakdown = db.prepare(`
      SELECT 
        cb.id as bucket_id,
        cb.display_name,
        cb.capacity,
        COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) as confirmed,
        COUNT(CASE WHEN r.status = 'waiting' THEN 1 END) as waiting,
        COUNT(ci.id) as checked_in
      FROM capacity_buckets cb
      LEFT JOIN registrations r ON cb.id = r.capacity_bucket_id
      LEFT JOIN check_ins ci ON r.id = ci.registration_id
      WHERE cb.event_id = ?
      GROUP BY cb.id
    `).all(eventId);

    return res.json({
      event,
      summary: {
        totalConfirmed,
        totalWaiting,
        totalCheckedIn,
        notCheckedIn,
        attendancePercentage
      },
      deptBreakdown,
      progBreakdown,
      yearBreakdown,
      bucketBreakdown
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: Event audit logs
router.get('/events/:id/audit-logs', requireAdmin, (req, res) => {
  try {
    const eventId = req.params.id;
    const logs = getLogsForEvent(eventId, 100);
    return res.json({ logs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: Export CSV
router.get('/events/:id/export-csv', requireAdmin, (req, res) => {
  try {
    const eventId = req.params.id;
    const event = db.prepare('SELECT name FROM events WHERE id = ?').get(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const registrations = db.prepare(`
      SELECT 
        r.reference_code,
        r.name,
        r.email,
        r.phone,
        r.department,
        r.program,
        r.year,
        cb.display_name as bucket_name,
        r.status,
        r.waiting_position,
        s.seat_number,
        ci.checked_in_at,
        r.created_at
      FROM registrations r
      JOIN capacity_buckets cb ON r.capacity_bucket_id = cb.id
      LEFT JOIN seats s ON r.seat_id = s.id
      LEFT JOIN check_ins ci ON r.id = ci.registration_id
      WHERE r.event_id = ?
      ORDER BY 
        CASE WHEN r.status = 'confirmed' THEN 1 WHEN r.status = 'waiting' THEN 2 ELSE 3 END,
        r.waiting_position ASC,
        r.created_at ASC
    `).all(eventId);

    const headers = [
      'Reference Code',
      'Full Name',
      'Email Address',
      'Phone Number',
      'Department',
      'Program',
      'Year',
      'Capacity Pool',
      'Registration Status',
      'Waiting Position',
      'Seat Number',
      'Check-In Status',
      'Checked-In At',
      'Registration Date'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = registrations.map(r => [
      escapeCsv(r.reference_code),
      escapeCsv(r.name),
      escapeCsv(r.email),
      escapeCsv(r.phone),
      escapeCsv(r.department),
      escapeCsv(r.program),
      escapeCsv(r.year),
      escapeCsv(r.bucket_name),
      escapeCsv(r.status.toUpperCase()),
      escapeCsv(r.waiting_position || 'N/A'),
      escapeCsv(r.seat_number || 'N/A'),
      escapeCsv(r.checked_in_at ? 'CHECKED IN' : 'NOT CHECKED IN'),
      escapeCsv(r.checked_in_at || 'N/A'),
      escapeCsv(r.created_at)
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\r\n');
    const safeFilename = `Registrations-${event.name.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    return res.send(csvContent);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
