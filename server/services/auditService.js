const db = require('../db');

function logAction(adminId, eventId, registrationId, action, previousVal, newVal) {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (admin_id, event_id, registration_id, action, previous_val, new_val, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(
      adminId || null,
      eventId,
      registrationId || null,
      action,
      previousVal !== undefined ? JSON.stringify(previousVal) : null,
      newVal !== undefined ? JSON.stringify(newVal) : null
    );
  } catch (err) {
    console.error('[AuditLog] Error logging action:', err.message);
  }
}

function getLogsForEvent(eventId, limit = 50) {
  return db.prepare(`
    SELECT a.*, adm.login_id as admin_login, r.name as student_name, r.reference_code
    FROM audit_logs a
    LEFT JOIN admins adm ON a.admin_id = adm.id
    LEFT JOIN registrations r ON a.registration_id = r.id
    WHERE a.event_id = ?
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(eventId, limit);
}

module.exports = {
  logAction,
  getLogsForEvent
};
