const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../db');
const config = require('../config');
const { requireAdmin } = require('../middleware/auth');
const { generateBucketsFromEligibility, explainGrouping } = require('../services/capacityService');
const { updateBucketCapacity } = require('../services/registrationEngine');
const sseService = require('../services/sseService');

// Multer storage configuration for banners
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `banner-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid image file format. Allowed: JPG, PNG, WebP.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// SSE endpoint for live event updates
router.get('/:id/live-stream', (req, res) => {
  const eventId = req.params.id;
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial ping
  res.write(`event: connected\ndata: ${JSON.stringify({ eventId, connectedAt: new Date().toISOString() })}\n\n`);

  sseService.subscribe(eventId, res);
});

// Public: List all published events
router.get('/public', (req, res) => {
  const events = db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'confirmed') as confirmed_count,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'waiting') as waiting_count,
      (SELECT COALESCE(SUM(capacity), 0) FROM capacity_buckets cb WHERE cb.event_id = e.id) as total_capacity
    FROM events e
    WHERE e.status = 'published'
    ORDER BY e.start_at ASC
  `).all();

  return res.json({ events });
});

// Admin: List all events with all statuses
router.get('/admin/all', requireAdmin, (req, res) => {
  const events = db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'confirmed') as confirmed_count,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'waiting') as waiting_count,
      (SELECT COUNT(*) FROM check_ins ci JOIN registrations r ON ci.registration_id = r.id WHERE r.event_id = e.id) as checked_in_count,
      (SELECT COALESCE(SUM(capacity), 0) FROM capacity_buckets cb WHERE cb.event_id = e.id) as total_capacity
    FROM events e
    ORDER BY e.created_at DESC
  `).all();

  return res.json({ events });
});

// Get single event details with eligibility, grouping, and live capacity breakdown
router.get('/:id', (req, res) => {
  const eventId = req.params.id;
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const eligibility = db.prepare(`
    SELECT department, program, year 
    FROM event_eligibility 
    WHERE event_id = ?
    ORDER BY department ASC, program ASC, year ASC
  `).all(eventId);

  const buckets = db.prepare(`
    SELECT cb.*,
      (SELECT COUNT(*) FROM registrations r WHERE r.capacity_bucket_id = cb.id AND r.status = 'confirmed') as confirmed_count,
      (SELECT COUNT(*) FROM registrations r WHERE r.capacity_bucket_id = cb.id AND r.status = 'waiting') as waiting_count,
      (SELECT COUNT(*) FROM seats s WHERE s.capacity_bucket_id = cb.id) as allocated_seats_count
    FROM capacity_buckets cb
    WHERE cb.event_id = ?
    ORDER BY cb.id ASC
  `).all(eventId);

  const stats = {
    totalCapacity: buckets.reduce((sum, b) => sum + b.capacity, 0),
    totalConfirmed: buckets.reduce((sum, b) => sum + b.confirmed_count, 0),
    totalWaiting: buckets.reduce((sum, b) => sum + b.waiting_count, 0)
  };

  const groupingExplanation = explainGrouping({
    group_dept: event.group_dept,
    group_prog: event.group_prog,
    group_year: event.group_year
  });

  return res.json({
    event,
    eligibility,
    buckets,
    stats,
    groupingExplanation
  });
});

// Admin: Preview capacity buckets before creating/updating
router.post('/preview-buckets', requireAdmin, (req, res) => {
  const { eligibility, groupDept, groupProg, groupYear } = req.body;
  if (!Array.isArray(eligibility) || eligibility.length === 0) {
    return res.status(400).json({ error: 'Please select at least one eligible category combination.' });
  }

  const grouping = {
    group_dept: groupDept ? 1 : 0,
    group_prog: groupProg ? 1 : 0,
    group_year: groupYear ? 1 : 0
  };

  const buckets = generateBucketsFromEligibility(eligibility, grouping);
  const explanation = explainGrouping(grouping);

  return res.json({
    buckets,
    explanation,
    bucketCount: buckets.length
  });
});

// Admin: Create Event
router.post('/', requireAdmin, upload.single('banner'), (req, res) => {
  try {
    const {
      name,
      description,
      startAt,
      endAt,
      status = 'draft',
      groupDept = 0,
      groupProg = 0,
      groupYear = 0,
      totalPhysicalSeats = 0
    } = req.body;

    let eligibility = [];
    if (typeof req.body.eligibility === 'string') {
      eligibility = JSON.parse(req.body.eligibility);
    } else if (Array.isArray(req.body.eligibility)) {
      eligibility = req.body.eligibility;
    }

    let bucketCapacities = {};
    if (typeof req.body.bucketCapacities === 'string') {
      bucketCapacities = JSON.parse(req.body.bucketCapacities);
    } else if (typeof req.body.bucketCapacities === 'object' && req.body.bucketCapacities) {
      bucketCapacities = req.body.bucketCapacities;
    }

    if (!name || !description || !startAt || !endAt) {
      return res.status(400).json({ error: 'Name, description, start time and end time are required.' });
    }

    if (!Array.isArray(eligibility) || eligibility.length === 0) {
      return res.status(400).json({ error: 'Please select at least one eligible combination.' });
    }

    const bannerUrl = req.file ? `/uploads/${req.file.filename}` : (req.body.bannerUrl || null);

    const grouping = {
      group_dept: groupDept == 1 || groupDept === '1' || groupDept === true ? 1 : 0,
      group_prog: groupProg == 1 || groupProg === '1' || groupProg === true ? 1 : 0,
      group_year: groupYear == 1 || groupYear === '1' || groupYear === true ? 1 : 0
    };

    const transaction = db.transaction(() => {
      // 1. Insert Event
      const insertEvent = db.prepare(`
        INSERT INTO events (
          name, description, banner_url, start_at, end_at, status,
          group_dept, group_prog, group_year, total_physical_seats, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);

      const eventResult = insertEvent.run(
        name.trim(),
        description.trim(),
        bannerUrl,
        startAt,
        endAt,
        status,
        grouping.group_dept,
        grouping.group_prog,
        grouping.group_year,
        parseInt(totalPhysicalSeats, 10) || 0
      );

      const eventId = eventResult.lastInsertRowid;

      // 2. Insert Eligibility Matrix
      const insertElig = db.prepare(`
        INSERT INTO event_eligibility (event_id, department, program, year)
        VALUES (?, ?, ?, ?)
      `);

      for (const item of eligibility) {
        insertElig.run(eventId, item.department, item.program, item.year);
      }

      // 3. Generate and Insert Capacity Buckets
      const generatedBuckets = generateBucketsFromEligibility(eligibility, grouping);
      const insertBucket = db.prepare(`
        INSERT INTO capacity_buckets (event_id, bucket_key, display_name, dept, program, year, capacity)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const b of generatedBuckets) {
        const customCap = bucketCapacities[b.bucket_key] !== undefined ? parseInt(bucketCapacities[b.bucket_key], 10) : 0;
        insertBucket.run(
          eventId,
          b.bucket_key,
          b.display_name,
          b.dept,
          b.program,
          b.year,
          isNaN(customCap) ? 0 : Math.max(0, customCap)
        );
      }

      return eventId;
    });

    const eventId = transaction();
    return res.status(201).json({
      success: true,
      message: 'Event created successfully.',
      eventId
    });
  } catch (err) {
    console.error('Error creating event:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Admin: Update Event Details & Status
router.put('/:id', requireAdmin, upload.single('banner'), (req, res) => {
  try {
    const eventId = req.params.id;
    const { name, description, startAt, endAt, status, totalPhysicalSeats } = req.body;

    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    let bannerUrl = existing.banner_url;
    if (req.file) {
      bannerUrl = `/uploads/${req.file.filename}`;
    } else if (req.body.bannerUrl) {
      bannerUrl = req.body.bannerUrl;
    }

    db.prepare(`
      UPDATE events SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        banner_url = ?,
        start_at = COALESCE(?, start_at),
        end_at = COALESCE(?, end_at),
        status = COALESCE(?, status),
        total_physical_seats = COALESCE(?, total_physical_seats),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      description ? description.trim() : null,
      bannerUrl,
      startAt || null,
      endAt || null,
      status || null,
      totalPhysicalSeats !== undefined ? parseInt(totalPhysicalSeats, 10) : null,
      eventId
    );

    sseService.broadcast(eventId, 'event_updated', { eventId, status });

    return res.json({ success: true, message: 'Event updated successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: Update single bucket capacity
router.put('/:id/capacity/:bucketId', requireAdmin, (req, res) => {
  try {
    const { id: eventId, bucketId } = req.params;
    const { capacity } = req.body;

    if (capacity === undefined || isNaN(parseInt(capacity, 10))) {
      return res.status(400).json({ error: 'Valid numerical capacity required.' });
    }

    const result = updateBucketCapacity(eventId, bucketId, parseInt(capacity, 10), req.admin.id);
    return res.json({
      success: true,
      message: `Capacity updated to ${result.newCapacity}. Promoted ${result.promoted.length} waiting students.`,
      result
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Admin: Reconfigure Grouping Switches & Eligibility
router.put('/:id/grouping-and-eligibility', requireAdmin, (req, res) => {
  try {
    const eventId = req.params.id;
    const { eligibility, groupDept, groupProg, groupYear, bucketCapacities } = req.body;

    if (!Array.isArray(eligibility) || eligibility.length === 0) {
      return res.status(400).json({ error: 'At least one eligible category is required.' });
    }

    const grouping = {
      group_dept: groupDept ? 1 : 0,
      group_prog: groupProg ? 1 : 0,
      group_year: groupYear ? 1 : 0
    };

    const transaction = db.transaction(() => {
      // Check if registrations already exist
      const existingRegCount = db.prepare('SELECT COUNT(*) as count FROM registrations WHERE event_id = ?').get(eventId).count;
      
      // Update event grouping switches
      db.prepare(`
        UPDATE events SET group_dept = ?, group_prog = ?, group_year = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(grouping.group_dept, grouping.group_prog, grouping.group_year, eventId);

      // Refresh eligibility table
      db.prepare('DELETE FROM event_eligibility WHERE event_id = ?').run(eventId);
      const insertElig = db.prepare(`
        INSERT INTO event_eligibility (event_id, department, program, year)
        VALUES (?, ?, ?, ?)
      `);
      for (const item of eligibility) {
        insertElig.run(eventId, item.department, item.program, item.year);
      }

      // Generate new buckets
      const newBuckets = generateBucketsFromEligibility(eligibility, grouping);

      if (existingRegCount === 0) {
        // Safe to recreate all capacity buckets
        db.prepare('DELETE FROM capacity_buckets WHERE event_id = ?').run(eventId);
        const insertBucket = db.prepare(`
          INSERT INTO capacity_buckets (event_id, bucket_key, display_name, dept, program, year, capacity)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const b of newBuckets) {
          const cap = bucketCapacities && bucketCapacities[b.bucket_key] !== undefined 
            ? parseInt(bucketCapacities[b.bucket_key], 10) : 0;
          insertBucket.run(eventId, b.bucket_key, b.display_name, b.dept, b.program, b.year, Math.max(0, isNaN(cap) ? 0 : cap));
        }
      } else {
        // Update or insert buckets without losing references for existing registrations
        for (const b of newBuckets) {
          const existingB = db.prepare('SELECT * FROM capacity_buckets WHERE event_id = ? AND bucket_key = ?').get(eventId, b.bucket_key);
          if (existingB) {
            if (bucketCapacities && bucketCapacities[b.bucket_key] !== undefined) {
              const cap = Math.max(0, parseInt(bucketCapacities[b.bucket_key], 10));
              db.prepare('UPDATE capacity_buckets SET display_name = ?, capacity = ? WHERE id = ?').run(b.display_name, cap, existingB.id);
            } else {
              db.prepare('UPDATE capacity_buckets SET display_name = ? WHERE id = ?').run(b.display_name, existingB.id);
            }
          } else {
            const cap = bucketCapacities && bucketCapacities[b.bucket_key] !== undefined 
              ? parseInt(bucketCapacities[b.bucket_key], 10) : 0;
            db.prepare(`
              INSERT INTO capacity_buckets (event_id, bucket_key, display_name, dept, program, year, capacity)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(eventId, b.bucket_key, b.display_name, b.dept, b.program, b.year, Math.max(0, isNaN(cap) ? 0 : cap));
          }
        }
      }
    });

    transaction();
    sseService.broadcast(eventId, 'event_reconfigured', { eventId });
    return res.json({ success: true, message: 'Grouping and eligibility updated successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: Purge / Delete All Events
router.delete('/admin/purge-all', requireAdmin, (req, res) => {
  try {
    const purgeTx = db.transaction(() => {
      db.prepare('DELETE FROM check_ins').run();
      db.prepare('DELETE FROM audit_logs').run();
      db.prepare('DELETE FROM seats').run();
      db.prepare('DELETE FROM registrations').run();
      db.prepare('DELETE FROM capacity_buckets').run();
      db.prepare('DELETE FROM event_eligibility').run();
      db.prepare('DELETE FROM events').run();
    });
    purgeTx();
    return res.json({ success: true, message: 'All events and related records have been deleted.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: Delete single event with full cascade cleanup
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const eventId = req.params.id;
    const deleteTx = db.transaction(() => {
      db.prepare(`DELETE FROM check_ins WHERE registration_id IN (SELECT id FROM registrations WHERE event_id = ?)`).run(eventId);
      db.prepare(`DELETE FROM audit_logs WHERE event_id = ?`).run(eventId);
      db.prepare(`DELETE FROM seats WHERE event_id = ?`).run(eventId);
      db.prepare(`DELETE FROM registrations WHERE event_id = ?`).run(eventId);
      db.prepare(`DELETE FROM capacity_buckets WHERE event_id = ?`).run(eventId);
      db.prepare(`DELETE FROM event_eligibility WHERE event_id = ?`).run(eventId);
      db.prepare(`DELETE FROM events WHERE id = ?`).run(eventId);
    });
    deleteTx();
    return res.json({ success: true, message: 'Event and all associated registrations, seats, and data were deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
