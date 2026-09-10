/**
 * Unified API Client & Toast Notification System
 */

const API = {
  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `/api${endpoint}`;
    
    const defaultHeaders = {
      'Content-Type': 'application/json'
    };

    if (options.body instanceof FormData) {
      delete defaultHeaders['Content-Type'];
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...defaultHeaders,
          ...options.headers
        },
        credentials: 'include'
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMsg = data.error || data.message || `Request failed with status ${response.status}`;
        throw new Error(errorMsg);
      }

      return data;
    } catch (err) {
      console.error(`[API Error] ${endpoint}:`, err);
      throw err;
    }
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body)
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: body instanceof FormData ? body : JSON.stringify(body)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};

// Toast notification helper
const Toast = {
  init() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  },

  show(message, type = 'info', duration = 4000) {
    const container = this.init();
    const toast = document.createElement('div');
    toast.className = `cosmic-toast toast-${type}`;

    let icon = '✨';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';
    if (type === 'warning') icon = '⚡';

    toast.innerHTML = `<span>${icon}</span><span style="flex-grow: 1;">${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error', 5000); },
  info(msg) { this.show(msg, 'info'); }
};

window.API = API;
window.Toast = Toast;
