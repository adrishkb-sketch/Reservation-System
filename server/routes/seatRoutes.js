const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { configureSeatsForEvent, getEventSeatMap } = require('../services/seatService');
const { reassignSeat } = require('../services/registrationEngine');

// Get seat map for event (public/admin)
router.get('/events/:id/seats', (req, res) => {
  try {
    const eventId = req.params.id;
    const seatMap = getEventSeatMap(eventId);
    const event = db.prepare('SELECT id, name, total_physical_seats FROM events WHERE id = ?').get(eventId);

    return res.json({
      totalPhysicalSeats: event ? event.total_physical_seats : 0,
      seats: seatMap
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: Configure seats for event
router.post('/admin/events/:id/seats/configure', requireAdmin, (req, res) => {
  try {
    const eventId = parseInt(req.params.id, 10);
    const { totalPhysicalSeats, bucketAllocations } = req.body;

    if (!totalPhysicalSeats || isNaN(parseInt(totalPhysicalSeats, 10))) {
      return res.status(400).json({ error: 'Please enter a valid number of total physical seats.' });
    }

    if (!Array.isArray(bucketAllocations)) {
      return res.status(400).json({ error: 'Bucket allocations array is required.' });
    }

    const result = configureSeatsForEvent(eventId, parseInt(totalPhysicalSeats, 10), bucketAllocations);

    return res.json({
      success: true,
      message: `Physical seats configured successfully (${result.totalPhysicalSeats} total seats, ${result.assignedCount} mapped to buckets).`,
      result
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Admin: Manual Seat Reassignment
router.post('/admin/events/:id/seats/reassign', requireAdmin, (req, res) => {
  try {
    const eventId = parseInt(req.params.id, 10);
    const { registrationId, targetSeatNumber, forceSwap = false } = req.body;

    if (!registrationId || !targetSeatNumber) {
      return res.status(400).json({ error: 'Student registration ID and target seat number are required.' });
    }

    const result = reassignSeat(eventId, parseInt(registrationId, 10), parseInt(targetSeatNumber, 10), req.admin.id, !!forceSwap);

    if (result.collision) {
      return res.status(200).json({
        collision: true,
        message: `Seat #${result.targetSeatNumber} is currently assigned to ${result.occupantName} (${result.occupantReference}). Are you sure you want to reassign/swap it?`,
        occupantName: result.occupantName,
        occupantReference: result.occupantReference,
        targetSeatNumber: result.targetSeatNumber
      });
    }

    return res.json({
      success: true,
      message: `Seat #${result.newSeatNumber} assigned to ${result.studentName}.`,
      result
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
