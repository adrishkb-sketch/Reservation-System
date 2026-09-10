/**
 * Subtle Modern Ambient Light Engine
 */
(function() {
  const canvas = document.createElement('canvas');
  canvas.id = 'ambient-canvas';
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.zIndex = '-1';
  canvas.style.pointerEvents = 'none';
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d');
  let width, height;
  let particles = [];
  const COUNT = 35;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    init();
  }

  function init() {
    particles = [];
    const colors = ['rgba(99, 102, 241, 0.15)', 'rgba(139, 92, 246, 0.12)', 'rgba(56, 189, 248, 0.1)'];
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 80 + 30,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -p.r) p.x = width + p.r;
      if (p.x > width + p.r) p.x = -p.r;
      if (p.y < -p.r) p.y = height + p.r;
      if (p.y > height + p.r) p.y = -p.r;

      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      grad.addColorStop(0, p.color);
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
})();
