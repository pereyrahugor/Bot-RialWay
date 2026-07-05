(function () {
  const PARTICLE_COUNT = 130;
  const MAX_DISTANCE   = 160;
  const SPEED          = 0.45;

  const DARK_LINE_COLOR = 'rgba(0, 153, 255,';
  const DARK_NODE_COLOR = 'rgba(72, 202, 228, 0.75)';
  const LIGHT_LINE_COLOR = 'rgba(37, 99, 235,';
  const LIGHT_NODE_COLOR = 'rgba(0, 120, 212, 0.45)';

  function isDark() {
    return document.documentElement.getAttribute('data-theme') !== 'light';
  }

  function initNeuralBg() {
    const canvas = document.getElementById('neural-bg');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const particles = Array.from({ length: PARTICLE_COUNT }, function () {
      return {
        x:    Math.random() * canvas.width,
        y:    Math.random() * canvas.height,
        vx:   (Math.random() - 0.5) * SPEED,
        vy:   (Math.random() - 0.5) * SPEED,
        size: Math.random() * 1.8 + 0.8,
      };
    });

    let raf;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const dark = isDark();
      const lineColor = dark ? DARK_LINE_COLOR : LIGHT_LINE_COLOR;
      const nodeColor = dark ? DARK_NODE_COLOR : LIGHT_NODE_COLOR;

      for (let i = 0; i < particles.length; i++) {
        particles[i].x += particles[i].vx;
        particles[i].y += particles[i].vy;
        if (particles[i].x < 0 || particles[i].x > canvas.width)  particles[i].vx *= -1;
        if (particles[i].y < 0 || particles[i].y > canvas.height) particles[i].vy *= -1;
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx   = particles[i].x - particles[j].x;
          const dy   = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > MAX_DISTANCE) continue;

          const alpha = (1 - dist / MAX_DISTANCE) * 0.45;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = lineColor + alpha + ')';
          ctx.lineWidth   = 0.6;
          ctx.stroke();
        }
      }

      for (let i = 0; i < particles.length; i++) {
        ctx.beginPath();
        ctx.arc(particles[i].x, particles[i].y, particles[i].size, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    }

    draw();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        draw();
      }
    });

    window.addEventListener('themeChanged', function () {
      // El siguiente frame ya dibuja con el color nuevo
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNeuralBg);
  } else {
    initNeuralBg();
  }
})();
