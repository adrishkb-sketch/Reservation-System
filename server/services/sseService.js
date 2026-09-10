/**
 * Server-Sent Events (SSE) Manager for Live Real-Time Updates
 */

class SseService {
  constructor() {
    this.clients = new Map(); // eventId -> Set of res objects
  }

  subscribe(eventId, res) {
    const id = String(eventId);
    if (!this.clients.has(id)) {
      this.clients.set(id, new Set());
    }
    this.clients.get(id).add(res);

    res.on('close', () => {
      const set = this.clients.get(id);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          this.clients.delete(id);
        }
      }
    });
  }

  broadcast(eventId, type, payload) {
    const id = String(eventId);
    const set = this.clients.get(id);
    if (!set || set.size === 0) return;

    const data = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
    const message = `event: ${type}\ndata: ${data}\n\n`;

    for (const res of set) {
      try {
        res.write(message);
      } catch (err) {
        // Client disconnected
      }
    }
  }
}

module.exports = new SseService();
