(function () {
  'use strict';

  var GAP = 12;
  var FADE_DURATION = 2000;
  var STAGGER_MS = 200;
  var BATCH_WAIT_MS = 50; // ms to wait for images to batch before revealing

  // ── Responsive column count ────────────────────────────────────────────────
  function getColCount() {
    var w = window.innerWidth;
    if (w < 640) return 1;
    if (w < 768) return 2;
    if (w < 1024) return 3;
    if (w < 1280) return 4;
    return 5;
  }

  // ── Masonry layout ─────────────────────────────────────────────────────────
  // Uses known aspect ratios (from data-w/data-h) to place items without
  // waiting for images to load. All positions are computed up front.
  function layoutMasonry(container, items, cols) {
    var containerWidth = container.offsetWidth;
    var colWidth = Math.floor((containerWidth - (cols - 1) * GAP) / cols);
    var colHeights = [];
    for (var c = 0; c < cols; c++) colHeights.push(0);

    items.forEach(function (item) {
      var col = colHeights.indexOf(Math.min.apply(null, colHeights));
      var x = col * (colWidth + GAP);
      var y = colHeights[col];
      var h = Math.round((item.h / item.w) * colWidth);

      item.el.style.left   = x + 'px';
      item.el.style.top    = y + 'px';
      item.el.style.width  = colWidth + 'px';
      item.el.style.height = h + 'px';

      colHeights[col] += h + GAP;
      item.x = x;
      item.y = y;
    });

    container.style.height = Math.max.apply(null, colHeights) + 'px';
  }

  // Sort items top-left → bottom-right for stagger ordering
  function sortByPosition(items) {
    return items.slice().sort(function (a, b) {
      return a.y !== b.y ? a.y - b.y : a.x - b.x;
    });
  }

  // ── Lightbox ───────────────────────────────────────────────────────────────
  var lb = null;
  var lbImg = null;
  var lbReset = null;
  var currentIdx = 0;
  var allItems = [];

  function buildLightbox() {
    var overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'background:rgba(0,0,0,0.95)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'opacity:0', 'transition:opacity 0.3s ease',
    ].join(';');

    var img = document.createElement('img');
    img.style.cssText = [
      'max-width:90vw', 'max-height:90vh',
      'object-fit:contain',
      'transform-origin:center',
      'user-select:none',
    ].join(';');

    function makeBtn(html, posCSS) {
      var b = document.createElement('button');
      b.innerHTML = html;
      b.style.cssText = [
        'position:absolute', posCSS,
        'background:rgba(255,255,255,0.1)', 'border:none', 'color:white',
        'cursor:pointer', 'border-radius:0.5rem',
        'transition:opacity 0.2s,background 0.2s',
        'opacity:0.7', 'z-index:1',
      ].join(';');
      b.addEventListener('mouseenter', function () {
        b.style.opacity = '1';
        b.style.background = 'rgba(255,255,255,0.2)';
      });
      b.addEventListener('mouseleave', function () {
        b.style.opacity = '0.7';
        b.style.background = 'rgba(255,255,255,0.1)';
      });
      return b;
    }

    var prevBtn  = makeBtn('&#10094;', 'left:1.5rem;top:50%;transform:translateY(-50%);font-size:2rem;padding:0.75rem 1rem');
    var nextBtn  = makeBtn('&#10095;', 'right:1.5rem;top:50%;transform:translateY(-50%);font-size:2rem;padding:0.75rem 1rem');
    var closeBtn = makeBtn('&#10005;', 'top:1.5rem;right:1.5rem;font-size:1.5rem;padding:0.5rem 0.75rem');

    overlay.appendChild(img);
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);

    // ── Zoom / pan state ───────────────────────────────────────────────────
    var scale = 1, tx = 0, ty = 0;
    var dragging = false, dragX = 0, dragY = 0, startTx = 0, startTy = 0;
    var pinchDist = null;

    function applyXform(animated) {
      img.style.transition = animated ? 'transform 0.2s ease' : 'none';
      img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      img.style.cursor = scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default';
    }

    function reset() {
      scale = 1; tx = 0; ty = 0;
      applyXform(true);
    }

    // Scroll to zoom
    overlay.addEventListener('wheel', function (e) {
      e.preventDefault();
      scale = Math.min(8, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      if (scale === 1) { tx = 0; ty = 0; }
      applyXform(false);
    }, { passive: false });

    // Click background: zoom out if zoomed, close if not
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        if (scale > 1) reset(); else closeLB();
      }
    });

    // Mouse drag to pan
    img.addEventListener('mousedown', function (e) {
      if (scale <= 1) return;
      e.preventDefault();
      dragging = true;
      dragX = e.clientX; dragY = e.clientY;
      startTx = tx; startTy = ty;
      img.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      tx = startTx + (e.clientX - dragX);
      ty = startTy + (e.clientY - dragY);
      applyXform(false);
    });
    window.addEventListener('mouseup', function () {
      if (dragging) { dragging = false; applyXform(false); }
    });

    // Touch: pinch-to-zoom + drag-to-pan
    overlay.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      } else if (scale > 1) {
        dragging = true;
        dragX = e.touches[0].clientX; dragY = e.touches[0].clientY;
        startTx = tx; startTy = ty;
      }
    }, { passive: true });

    overlay.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && pinchDist !== null) {
        var d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        scale = Math.min(8, Math.max(1, scale * d / pinchDist));
        pinchDist = d;
        applyXform(false);
      } else if (dragging) {
        tx = startTx + (e.touches[0].clientX - dragX);
        ty = startTy + (e.touches[0].clientY - dragY);
        applyXform(false);
      }
    }, { passive: true });

    overlay.addEventListener('touchend', function () {
      pinchDist = null; dragging = false;
    });

    prevBtn.addEventListener('click',  function (e) { e.stopPropagation(); navigate(-1); });
    nextBtn.addEventListener('click',  function (e) { e.stopPropagation(); navigate(1); });
    closeBtn.addEventListener('click', function (e) { e.stopPropagation(); closeLB(); });

    lbImg   = img;
    lbReset = reset;
    return overlay;
  }

  function openLB(index) {
    currentIdx = index;
    if (!lb) lb = buildLightbox();
    document.body.style.overflow = 'hidden';
    lb.style.display = 'flex';
    requestAnimationFrame(function () { lb.style.opacity = '1'; });
    showLBImage(index);
    preloadNeighbors(index);
  }

  function closeLB() {
    lb.style.opacity = '0';
    setTimeout(function () {
      lb.style.display = 'none';
      document.body.style.overflow = '';
      lbReset();
    }, 300);
  }

  function navigate(dir) {
    currentIdx = (currentIdx + dir + allItems.length) % allItems.length;
    showLBImage(currentIdx);
    preloadNeighbors(currentIdx);
  }

  function showLBImage(index) {
    lbReset();
    lbImg.style.transition = 'opacity 0.2s ease';
    lbImg.style.opacity = '0';
    lbImg.src = allItems[index].fullSrc;
    lbImg.onload = function () { lbImg.style.opacity = '1'; };
  }

  function preloadNeighbors(index) {
    [-1, 1].forEach(function (d) {
      var i = (index + d + allItems.length) % allItems.length;
      var pre = new Image();
      pre.src = allItems[i].fullSrc;
    });
  }

  document.addEventListener('keydown', function (e) {
    if (!lb || lb.style.display === 'none') return;
    if (e.key === 'ArrowRight') navigate(1);
    else if (e.key === 'ArrowLeft') navigate(-1);
    else if (e.key === 'Escape') closeLB();
  });

  // ── Main init ──────────────────────────────────────────────────────────────
  function init() {
    var container = document.getElementById('masonry-gallery');
    if (!container) return;

    container.style.position = 'relative';

    allItems = Array.from(container.querySelectorAll('.gallery-item')).map(function (el, i) {
      el.style.cssText += ';position:absolute;overflow:hidden;border-radius:0.5rem;';
      var img = el.querySelector('img');
      Object.assign(img.style, {
        width: '100%', height: '100%',
        objectFit: 'cover',
        opacity: '0',
        transitionProperty: 'opacity',
        cursor: 'pointer',
      });
      img.addEventListener('click', function () { openLB(i); });
      return {
        el: el,
        img: img,
        src:     el.dataset.src,
        fullSrc: el.dataset.fullSrc,
        w: +el.dataset.w,
        h: +el.dataset.h,
        index: i,
        x: 0, y: 0,
      };
    });

    var cols = getColCount();
    layoutMasonry(container, allItems, cols);

    // Batch-reveal: collect images that finish loading within BATCH_WAIT_MS
    // of each other, then fade them in staggered by position (top-left → bottom-right).
    var pendingReveal = [];
    var batchTimer = null;

    function flushReveal() {
      var batch = sortByPosition(pendingReveal);
      pendingReveal = [];
      batch.forEach(function (item, i) {
        item.img.style.transitionDuration = FADE_DURATION + 'ms';
        item.img.style.transitionDelay    = (i * STAGGER_MS) + 'ms';
        item.img.style.opacity = '1';
      });
    }

    // IntersectionObserver triggers loading as items enter view (+ 300px margin).
    // Priority is naturally top-to-bottom since upper items enter the observer first.
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var item = allItems.find(function (it) { return it.el === entry.target; });
        if (!item || item._loading) return;
        item._loading = true;
        observer.unobserve(item.el);

        item.img.src = item.src;
        item.img.onload = function () {
          pendingReveal.push(item);
          clearTimeout(batchTimer);
          batchTimer = setTimeout(flushReveal, BATCH_WAIT_MS);
        };
        item.img.onerror = function () {
          // Show broken images immediately rather than hiding them
          item.img.style.opacity = '1';
        };
      });
    }, { rootMargin: '300px' });

    allItems.forEach(function (item) { observer.observe(item.el); });

    // Relayout on resize
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        cols = getColCount();
        layoutMasonry(container, allItems, cols);
      }, 150);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
