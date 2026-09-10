/**
 * Real-time SSE (Server-Sent Events) Client with Serverless Fallback
 * Provides instant live updates on persistent servers, and smart adaptive polling on serverless (Vercel)
 */
class CosmicLiveStream {
  constructor(eventId, onUpdate) {
    this.eventId = eventId;
    this.onUpdate = onUpdate;
    this.eventSource = null;
    this.pollTimer = null;
    this.errorCount = 0;
    this.isServerlessFallback = false;
    this.connect();
  }

  connect() {
    if (!this.eventId) return;

    try {
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
        this.errorCount++;
        // If SSE fails twice (typical on Serverless platforms like Vercel), gracefully switch to silent polling
        if (this.errorCount >= 2 && !this.isServerlessFallback) {
          this.fallbackToPolling();
        }
      };
    } catch (e) {
      this.fallbackToPolling();
    }
  }

  fallbackToPolling() {
    this.isServerlessFallback = true;
    if (this.eventSource) {
      try { this.eventSource.close(); } catch (err) {}
      this.eventSource = null;
    }

    if (this.pollTimer) clearInterval(this.pollTimer);

    // Poll every 8s only when user is actively looking at tab
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && this.onUpdate) {
        this.onUpdate('poll', { timestamp: Date.now() });
      }
    }, 8000);
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

window.CosmicLiveStream = CosmicLiveStream;
