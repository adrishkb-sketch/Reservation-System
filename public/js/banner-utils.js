/**
 * Ultra-Fast Modern SVG Banner Generator & Image Optimizers
 * Zero external latency, crisp vector rendering, instant load time (<1ms)
 */
(function() {
  const PALETTES = [
    { from: '#1e1b4b', via: '#312e81', to: '#4338ca', accent: '#6366f1', glow: '#818cf8' }, // Indigo Deep
    { from: '#1e1b4b', via: '#4c1d95', to: '#6d28d9', accent: '#8b5cf6', glow: '#a78bfa' }, // Purple Royal
    { from: '#0f172a', via: '#164e63', to: '#0e7490', accent: '#06b6d4', glow: '#22d3ee' }, // Cyan Tech
    { from: '#064e3b', via: '#047857', to: '#059669', accent: '#10b981', glow: '#34d399' }, // Emerald Neo
    { from: '#4a044e', via: '#701a75', to: '#86198f', accent: '#d946ef', glow: '#f0abfc' }, // Magenta Cyber
  ];

  function getPalette(idOrName) {
    let hash = 0;
    const str = String(idOrName || 'event');
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % PALETTES.length;
    return PALETTES[idx];
  }

  function getFastBanner(title, id) {
    const p = getPalette(id || title);
    const cleanTitle = (title || 'College Event').replace(/[<>&"]/g, '');
    
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${p.from}" />
          <stop offset="50%" stop-color="${p.via}" />
          <stop offset="100%" stop-color="${p.to}" />
        </linearGradient>
        <radialGradient id="glow1" cx="20%" cy="30%" r="50%">
          <stop offset="0%" stop-color="${p.accent}" stop-opacity="0.55" />
          <stop offset="100%" stop-color="${p.from}" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="glow2" cx="85%" cy="75%" r="60%">
          <stop offset="0%" stop-color="${p.glow}" stop-opacity="0.4" />
          <stop offset="100%" stop-color="${p.to}" stop-opacity="0" />
        </radialGradient>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255, 255, 255, 0.05)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" />
      <rect width="100%" height="100%" fill="url(#grid)" />
      <circle cx="250" cy="200" r="350" fill="url(#glow1)" />
      <circle cx="950" cy="450" r="400" fill="url(#glow2)" />
      
      <!-- Tech Grid Ornaments -->
      <g stroke="rgba(255, 255, 255, 0.12)" stroke-width="1.5" fill="none">
        <circle cx="1050" cy="150" r="80" stroke-dasharray="8 6" />
        <circle cx="1050" cy="150" r="140" stroke-dasharray="4 8" />
        <circle cx="1050" cy="150" r="200" />
        <polygon points="120,480 180,440 240,480 240,550 180,590 120,550" />
      </g>
      
      <!-- Card Badge -->
      <rect x="80" y="80" width="180" height="38" rx="19" fill="rgba(255, 255, 255, 0.15)" stroke="rgba(255, 255, 255, 0.25)" stroke-width="1.5" />
      <text x="170" y="105" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" text-anchor="middle" letter-spacing="1">CAMPUS PASS</text>
      
      <!-- Title -->
      <text x="80" y="320" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="52" font-weight="800" letter-spacing="-0.5">${cleanTitle}</text>
      <text x="80" y="380" fill="rgba(255, 255, 255, 0.75)" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="500">Official Campus Event &amp; Reservation</text>
    </svg>`;

    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function resolveBannerUrl(bannerUrl, eventName, eventId) {
    if (!bannerUrl || bannerUrl.includes('unsplash.com')) {
      return getFastBanner(eventName, eventId);
    }
    return bannerUrl;
  }

  window.getFastBanner = getFastBanner;
  window.resolveBannerUrl = resolveBannerUrl;
})();
