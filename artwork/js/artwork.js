/* Artwork — theme switch, image fade-in, and the viewer. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------------------------------------------------------- Theme */
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
    var label = toggle.querySelector('.theme__label');
    label.textContent = dark ? label.dataset.dark : label.dataset.light;
  }
  toggle.addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('artwork-theme', next); } catch (e) {}
    reflectTheme();
  });
  systemDark.addEventListener('change', function () {
    if (!root.getAttribute('data-theme')) reflectTheme();
  });
  reflectTheme();

  /* ------------------------------------------------------- Image fade-in */
  var imgs = document.querySelectorAll('.work__link img, .work__frame img');
  imgs.forEach(function (img) {
    if (img.complete && img.naturalWidth > 0) {
      img.classList.add('is-loaded');
    } else {
      img.addEventListener('load', function () { img.classList.add('is-loaded'); }, { once: true });
      img.addEventListener('error', function () { img.classList.add('is-loaded'); }, { once: true });
    }
  });

  /* ----------------------------------------------------------------- Year */
  var y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());

  /* --------------------------------------------------------------- Viewer */
  var viewer = document.getElementById('viewer');
  if (!viewer || typeof viewer.showModal !== 'function') return; // graceful: links open the image

  var stage   = document.getElementById('viewerStage');
  var vImg    = document.getElementById('viewerImg');
  var vTitle  = document.getElementById('viewerTitle');
  var vDetail = document.getElementById('viewerDetail');
  var vCount  = document.getElementById('viewerCount');
  var btnZoom = document.getElementById('viewerZoom');
  var btnPrev = document.getElementById('viewerPrev');
  var btnNext = document.getElementById('viewerNext');
  var btnClose= document.getElementById('viewerClose');

  var links = Array.prototype.slice.call(document.querySelectorAll('.work__link'));
  var items = links.map(function (a) {
    var li = a.closest('.work');
    var img = a.querySelector('img');
    return {
      src: a.getAttribute('href'),
      w: parseInt(a.dataset.w, 10) || img.naturalWidth,
      h: parseInt(a.dataset.h, 10) || img.naturalHeight,
      alt: img.getAttribute('alt') || '',
      title: li.querySelector('.work__title').textContent,
      detail: li.querySelector('.work__detail').textContent
    };
  });

  var index = 0;
  var opener = null;
  var zoomed = false;

  function preload(i) {
    if (i < 0 || i >= items.length) return;
    var im = new Image();
    im.src = items[i].src;
  }

  function setZoom(on, focusX, focusY) {
    zoomed = !!on;
    stage.classList.toggle('is-zoomed', zoomed);
    btnZoom.setAttribute('aria-pressed', String(zoomed));
    btnZoom.setAttribute('aria-label', zoomed ? 'Fit to screen' : 'Zoom to actual size');
    if (zoomed) {
      var it = items[index];
      // Show real pixels; the file is never upsampled beyond its own size.
      stage.style.setProperty('--natural-w', it.w + 'px');
      stage.style.setProperty('--natural-h', it.h + 'px');
      // Centre on the point that was clicked (fractions of the image), else the middle.
      var fx = typeof focusX === 'number' ? focusX : 0.5;
      var fy = typeof focusY === 'number' ? focusY : 0.5;
      var place = function () {
        var w = vImg.offsetWidth || it.w, h = vImg.offsetHeight || it.h;
        stage.scrollLeft = Math.max(0, w * fx - stage.clientWidth / 2);
        stage.scrollTop  = Math.max(0, h * fy - stage.clientHeight / 2);
      };
      place();                 // layout is forced by reading offsetWidth
      setTimeout(place, 0);    // and once more after the style flush, to be safe
    }
  }

  function show(i, instant) {
    index = (i + items.length) % items.length;
    var it = items[index];
    if (zoomed) setZoom(false);

    var swap = function () {
      vImg.src = it.src;
      vImg.alt = it.alt;
      vImg.width = it.w;
      vImg.height = it.h;
      vTitle.textContent = it.title;
      vDetail.textContent = it.detail;
      vCount.textContent = (index + 1) + ' / ' + items.length;
      var done = function () { vImg.classList.remove('is-switching'); };
      if (vImg.complete) done(); else vImg.addEventListener('load', done, { once: true });
    };

    if (instant || reduceMotion.matches) { swap(); }
    else {
      vImg.classList.add('is-switching');
      setTimeout(swap, 180);
    }
    preload(index + 1);
    preload(index - 1);
  }

  function open(i, fromEl) {
    opener = fromEl || null;
    show(i, true);
    root.classList.add('viewer-open');
    viewer.showModal();
    btnClose.focus({ preventScroll: true });
  }

  function teardown() {
    root.classList.remove('viewer-open');
    setZoom(false);
    vImg.removeAttribute('src');
    if (opener) { opener.focus({ preventScroll: true }); opener = null; }
  }

  function close() {
    if (!viewer.open) return;
    teardown();
    viewer.close();
  }

  // Escape closes the dialog natively; tidy up the same way.
  viewer.addEventListener('close', teardown);

  links.forEach(function (a, i) {
    a.addEventListener('click', function (ev) {
      ev.preventDefault();
      open(i, a);
    });
  });

  btnPrev.addEventListener('click', function () { show(index - 1); });
  btnNext.addEventListener('click', function () { show(index + 1); });
  btnClose.addEventListener('click', close);
  btnZoom.addEventListener('click', function () { setZoom(!zoomed); });

  // Click the picture to zoom into that point; click again to fit.
  // Click the dark surround to close.
  var dragMoved = false;
  stage.addEventListener('click', function (ev) {
    if (dragMoved) { dragMoved = false; return; }
    if (ev.target === vImg) {
      if (zoomed) { setZoom(false); return; }
      var r = vImg.getBoundingClientRect();
      setZoom(true, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
    } else if (!zoomed) {
      close();
    }
  });

  // Drag to pan when zoomed (mouse); touch uses native scrolling.
  var drag = null;
  stage.addEventListener('pointerdown', function (ev) {
    if (!zoomed || ev.pointerType !== 'mouse') return;
    drag = { x: ev.clientX, y: ev.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
    stage.classList.add('is-dragging');
  });
  window.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    stage.scrollLeft = drag.sl - dx;
    stage.scrollTop  = drag.st - dy;
  });
  window.addEventListener('pointerup', function () {
    drag = null;
    stage.classList.remove('is-dragging');
  });

  // Swipe between drawings when fitted (touch).
  var touchStart = null;
  stage.addEventListener('touchstart', function (ev) {
    if (zoomed || ev.touches.length !== 1) { touchStart = null; return; }
    touchStart = { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
  }, { passive: true });
  stage.addEventListener('touchend', function (ev) {
    if (!touchStart) return;
    var dx = ev.changedTouches[0].clientX - touchStart.x;
    var dy = ev.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) show(dx < 0 ? index + 1 : index - 1);
  }, { passive: true });

  viewer.addEventListener('keydown', function (ev) {
    switch (ev.key) {
      case 'ArrowRight': ev.preventDefault(); show(index + 1); break;
      case 'ArrowLeft':  ev.preventDefault(); show(index - 1); break;
      case 'z': case 'Z': setZoom(!zoomed); break;
      case 'Escape': teardown(); break; // the dialog then closes itself
    }
  });

})();
