/**
 * Real-time SSE (Server-Sent Events) Client
 */
class CosmicLiveStream {
  constructor(eventId, onUpdate) {
    this.eventId = eventId;
    this.onUpdate = onUpdate;
    this.eventSource = null;
    this.connect();
  }

  connect() {
    if (!this.eventId) return;

    this.eventSource = new EventSource(`/api/events/${this.eventId}/live-stream`);

    this.eventSource.addEventListener('registration_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (this.onUpdate) this.onUpdate('registration', data);
      } catch (err) {}
    });

    this.eventSource.addEventListener('capacity_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (this.onUpdate) this.onUpdate('capacity', data);
      } catch (err) {}
    });

    this.eventSource.addEventListener('seat_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (this.onUpdate) this.onUpdate('seat', data);
      } catch (err) {}
    });

    this.eventSource.addEventListener('check_in_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (this.onUpdate) this.onUpdate('check_in', data);
      } catch (err) {}
    });

    this.eventSource.onerror = () => {
      // Reconnection handled automatically by browser
    };
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

window.CosmicLiveStream = CosmicLiveStream;
