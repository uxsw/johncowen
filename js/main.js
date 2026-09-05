/* John Cowen — portfolio home
   Three things happen here: the theme switch, the contour figure, and the
   scroll reveals. Nothing else. */

(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ------------------------------------------------------------------------
     Theme
     ------------------------------------------------------------------------ */
  var toggle = document.getElementById('themeToggle');
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function currentTheme() {
    var t = root.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return systemDark.matches ? 'dark' : 'light';
  }

  function reflectTheme() {
    var dark = currentTheme() === 'dark';
    toggle.setAttribute('aria-pressed', String(dark));
    toggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    var label = toggle.querySelector('.theme-toggle__label');
    label.textContent = dark ? label.dataset.dark : label.dataset.light;
  }

  function applyTheme(next) {
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
    reflectTheme();
    if (contours) contours.recolor();
  }

  toggle.addEventListener('click', function (ev) {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';

    if (!document.startViewTransition || reduceMotion.matches) {
      applyTheme(next);
      return;
    }

    // Wipe the new theme in from the toggle itself.
    var rect = toggle.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    var r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    var vt = document.startViewTransition(function () { applyTheme(next); });
    vt.ready.then(function () {
      root.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 650, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }, function () { /* transition skipped (e.g. hidden tab); the theme is already applied */ });
    if (vt.finished && vt.finished.catch) vt.finished.catch(function () {});
  });

  systemDark.addEventListener('change', function () {
    if (!root.getAttribute('data-theme')) {
      reflectTheme();
      if (contours) contours.recolor();
    }
  });

  reflectTheme();

  /* ------------------------------------------------------------------------
     Contour figure
     Value-noise field → marching squares → hairline isolines. Slow drift in z.
     ------------------------------------------------------------------------ */
  var contours = (function () {
    var canvas = document.getElementById('contours');
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var frame = canvas.parentNode;

    var seed = Math.floor(Math.random() * 9000) + 1000;
    var seedEl = document.getElementById('figSeed');

    var LEVELS = 14;               // number of isolines
    var ACCENT_LEVEL = 8;          // the one line drawn in accent
    var CELL = 11;                 // CSS px per grid cell
    var SCALE = 0.0042;            // noise frequency
    var SPEED = 0.0030;            // z drift per frame

    var w = 0, h = 0, dpr = 1, cols = 0, rows = 0;
    var field = null;
    var z = seed * 0.37;
    var colors = { line: '#000', accent: '#c00' };
    var running = false, visible = true, rafId = 0;

    if (seedEl) seedEl.textContent = 'Seed ' + seed + ' · ' + LEVELS + ' levels';

    // --- Value noise -------------------------------------------------------
    function hash3(x, y, zz) {
      var n = x * 374761393 + y * 668265263 + zz * 2147483647 + seed * 97;
      n = (n ^ (n >>> 13)) * 1274126177;
      n = n ^ (n >>> 16);
      return (n >>> 0) / 4294967295;
    }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function lerp(a, b, t) { return a + (b - a) * t; }

    function noise3(x, y, zz) {
      var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(zz);
      var xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(zz - zi);
      var c000 = hash3(xi, yi, zi),     c100 = hash3(xi + 1, yi, zi);
      var c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
      var c001 = hash3(xi, yi, zi + 1),     c101 = hash3(xi + 1, yi, zi + 1);
      var c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
      var x00 = lerp(c000, c100, xf), x10 = lerp(c010, c110, xf);
      var x01 = lerp(c001, c101, xf), x11 = lerp(c011, c111, xf);
      var y0 = lerp(x00, x10, yf), y1 = lerp(x01, x11, yf);
      return lerp(y0, y1, zf);
    }

    function fbm(x, y, zz) {
      var v = 0, amp = 0.5, f = 1, sum = 0;
      for (var o = 0; o < 4; o++) {
        v += amp * noise3(x * f, y * f, zz * f);
        sum += amp;
        amp *= 0.5;
        f *= 2.02;
      }
      return v / sum;
    }

    // --- Sizing --------------------------------------------------------------
    function resize() {
      var rect = frame.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      cols = Math.ceil(w / CELL) + 1;
      rows = Math.ceil(h / CELL) + 1;
      field = new Float32Array(cols * rows);
      draw();
    }

    function recolor() {
      var cs = getComputedStyle(root);
      colors.line = cs.getPropertyValue('--line').trim() || colors.line;
      colors.accent = cs.getPropertyValue('--accent').trim() || colors.accent;
      draw();
    }

    // --- Field + marching squares ------------------------------------------
    function sample() {
      // Gentle east-west shear so the field reads like a weather chart, not a blob.
      var i = 0;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var x = c * CELL, y = r * CELL;
          var v = fbm((x + y * 0.25) * SCALE, y * SCALE * 1.15, z);
          // Stretch contrast a little so the levels spread across the frame.
          field[i++] = Math.min(1, Math.max(0, (v - 0.5) * 1.9 + 0.5));
        }
      }
    }

    function interp(p, q, a, b, t) {
      // position along the edge from p to q where value crosses t
      var d = b - a;
      var k = d === 0 ? 0.5 : (t - a) / d;
      return p + (q - p) * k;
    }

    function tracePath(t) {
      ctx.beginPath();
      for (var r = 0; r < rows - 1; r++) {
        for (var c = 0; c < cols - 1; c++) {
          var i = r * cols + c;
          var a = field[i], b = field[i + 1], cc = field[i + cols + 1], d = field[i + cols];
          var idx = (a >= t ? 8 : 0) | (b >= t ? 4 : 0) | (cc >= t ? 2 : 0) | (d >= t ? 1 : 0);
          if (idx === 0 || idx === 15) continue;

          var x0 = c * CELL, y0 = r * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
          // edge midpoints: top, right, bottom, left
          var tx = interp(x0, x1, a, b, t),  ty = y0;
          var rx = x1,                       ry = interp(y0, y1, b, cc, t);
          var bx = interp(x0, x1, d, cc, t), by = y1;
          var lx = x0,                       ly = interp(y0, y1, a, d, t);

          switch (idx) {
            case 1:  case 14: seg(lx, ly, bx, by); break;
            case 2:  case 13: seg(bx, by, rx, ry); break;
            case 3:  case 12: seg(lx, ly, rx, ry); break;
            case 4:  case 11: seg(tx, ty, rx, ry); break;
            case 6:  case 9:  seg(tx, ty, bx, by); break;
            case 7:  case 8:  seg(lx, ly, tx, ty); break;
            case 5: {
              var centre = (a + b + cc + d) / 4;
              if (centre >= t) { seg(lx, ly, tx, ty); seg(bx, by, rx, ry); }
              else             { seg(lx, ly, bx, by); seg(tx, ty, rx, ry); }
              break;
            }
            case 10: {
              var centre2 = (a + b + cc + d) / 4;
              if (centre2 >= t) { seg(tx, ty, rx, ry); seg(lx, ly, bx, by); }
              else              { seg(lx, ly, tx, ty); seg(bx, by, rx, ry); }
              break;
            }
          }
        }
      }
    }

    function seg(ax, ay, bx, by) {
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }

    function draw() {
      if (!field) return;
      sample();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (var l = 1; l <= LEVELS; l++) {
        var t = l / (LEVELS + 1);
        var isAccent = (l === ACCENT_LEVEL);
        ctx.lineWidth = isAccent ? 1.5 : 1;
        ctx.strokeStyle = isAccent ? colors.accent : colors.line;
        ctx.globalAlpha = isAccent ? 1 : (l % 2 === 0 ? 1 : 0.55);
        tracePath(t);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // --- Loop ----------------------------------------------------------------
    function tick() {
      if (!running) return;
      z += SPEED;
      draw();
      rafId = requestAnimationFrame(tick);
    }
    function start() {
      if (running || reduceMotion.matches || !visible || document.hidden) return;
      running = true;
      rafId = requestAnimationFrame(tick);
    }
    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        visible ? start() : stop();
      }, { threshold: 0.05 }).observe(frame);
    }
    document.addEventListener('visibilitychange', function () {
      document.hidden ? stop() : start();
    });
    reduceMotion.addEventListener('change', function () {
      reduceMotion.matches ? stop() : start();
    });

    var ro = new ResizeObserver(function () { resize(); });
    ro.observe(frame);

    recolor();
    resize();
    start();

    return { recolor: recolor };
  })();

  /* ------------------------------------------------------------------------
     Scroll reveals: rows fade up once, then stay.
     ------------------------------------------------------------------------ */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    reveals.forEach(function (el, i) {
      el.style.transitionDelay = ((i % 6) * 40) + 'ms';
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* Footer year */
  var y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
})();
