(function () {
  'use strict';

  var GAP = 12;
  var FADE_DURATION = 2000;
  var STAGGER_MS = 200;
  var BATCH_WAIT_MS = 50;
  var ALBUM_MIN_THUMB_HEIGHT = 120;
  var ANIM_DURATION = 800;
  var ALBUM_TEXT_START_DELAY_MS = 0;
  var ALBUM_OVERLAY_ANIM_MS = 800;
  var ALBUM_OVERLAY_LEAD_MS = 400;
  var MASONRY_LOAD_BATCH_SIZE = 8;
  var MASONRY_PRELOAD_PX = 260;
  var MASONRY_UNLOCK_TRIGGER_PX = 180;

  // ── Responsive column count ────────────────────────────────────────────────
  function getColCount() {
    var w = window.innerWidth;
    if (w < 640) return 1;
    if (w < 768) return 2;
    if (w < 1024) return 3;
    if (w < 1280) return 4;
    return 5;
  }

  function getAlbumPreviewCount() {
    var w = window.innerWidth;
    if (w < 640) return 2;
    if (w < 1024) return 3;
    if (w < 1440) return 4;
    return 5;
  }

  function fitRowWidthsToContainer(widths, containerWidth) {
    var rowWidth = widths.reduce(function (sum, w) { return sum + w; }, 0);
    if (widths.length > 1) rowWidth += (widths.length - 1) * GAP;
    var overflow = rowWidth - containerWidth;
    while (overflow > 0) {
      var widestIdx = -1;
      var widest = 0;
      widths.forEach(function (w, i) {
        if (w > widest) {
          widest = w;
          widestIdx = i;
        }
      });
      if (widestIdx < 0 || widest <= 1) break;
      widths[widestIdx] -= 1;
      overflow -= 1;
    }
  }

  // ── Theme color ──────────────────────────────────────────────────────────
  function getPrimaryColor() {
    var s = getComputedStyle(document.documentElement);
    var raw = s.getPropertyValue('--color-primary-400').trim();
    return raw ? 'rgb(' + raw + ')' : 'rgb(216,131,41)';
  }

  // ── Masonry layout ─────────────────────────────────────────────────────────
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
      item.bottom = y + h;
    });

    container.style.height = Math.max.apply(null, colHeights) + 'px';
  }

  function computeMasonryTargets(container, items, cols) {
    var containerWidth = container.offsetWidth;
    var colWidth = Math.floor((containerWidth - (cols - 1) * GAP) / cols);
    var colHeights = [];
    var targets = {};
    for (var c = 0; c < cols; c++) colHeights.push(0);

    items.forEach(function (item) {
      var col = colHeights.indexOf(Math.min.apply(null, colHeights));
      var x = col * (colWidth + GAP);
      var y = colHeights[col];
      var h = Math.round((item.h / item.w) * colWidth);
      targets[item.index] = { x: x, y: y, w: colWidth, h: h };
      colHeights[col] += h + GAP;
    });

    return {
      targets: targets,
      totalHeight: Math.max.apply(null, colHeights),
    };
  }

  function sortByPosition(items) {
    return items.slice().sort(function (a, b) {
      return a.y !== b.y ? a.y - b.y : a.x - b.x;
    });
  }

  // ── Metadata rendering helpers ──────────────────────────────────────────
  function isZoomLens(lensName) {
    return /\d+\s*-\s*\d+\s*mm/i.test(lensName);
  }

  function buildMetaDetailsHTML(meta) {
    var parts = [];
    if (meta.date) parts.push(meta.date);
    if (meta.location) parts.push(meta.location);
    if (meta.focalLength && (!meta.lens || isZoomLens(meta.lens))) {
      parts.push(meta.focalLength);
    }
    if (meta.lens) parts.push(meta.lens);
    if (meta.shutter) parts.push(meta.shutter);
    if (meta.iso) parts.push('ISO ' + meta.iso);
    return parts.join(' &nbsp;&middot;&nbsp; ');
  }

  // ── Lightbox ───────────────────────────────────────────────────────────────
  var lb = null;
  var lbImg = null;
  var lbReset = null;
  var lbToggleZoomMode = null;
  var lbShowHelp = null;
  var currentIdx = 0;
  var currentLBItems = []; // the item set the lightbox navigates through

  function buildLightbox() {
    var overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'background:rgba(0,0,0,0.95)',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'opacity:0', 'transition:opacity 0.3s ease',
    ].join(';');

    var imgWrap = document.createElement('div');
    imgWrap.style.cssText = [
      'display:flex', 'align-items:center', 'justify-content:center',
      'flex:1', 'min-height:0', 'width:100%',
    ].join(';');

    var img = document.createElement('img');
    img.style.cssText = [
      'max-width:90vw', 'max-height:calc(90vh - 80px)',
      'object-fit:contain',
      'transform-origin:center',
      'user-select:none',
    ].join(';');

    var help = document.createElement('div');
    help.style.cssText = [
      'position:absolute',
      'right:1.5rem', 'bottom:1.5rem',
      'padding:0.6rem 0.75rem',
      'border-radius:0.5rem',
      'background:rgba(0,0,0,0.55)',
      'color:rgba(255,255,255,0.92)',
      'font-size:0.75rem', 'line-height:1.45',
      'pointer-events:none',
      'opacity:0',
      'transform:translateY(6px)',
      'transition:opacity 0.2s ease, transform 0.2s ease',
      'z-index:3',
      'white-space:nowrap',
    ].join(';');
    var leftClickIcon = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-right:0.2rem"><path d="M12 2c4.2 0 7 2.8 7 7v5c0 4-3 8-7 8s-7-4-7-8V9c0-4.2 2.8-7 7-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 2v8H8.5V7.7C8.5 4.7 10 2.9 12 2z" fill="currentColor" opacity="0.65"/><path d="M12 2v8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    help.innerHTML = [
      '<div>Z toggle fit</div>',
      '<div>' + leftClickIcon + 'zoom</div>',
      '<div>Alt + ' + leftClickIcon + 'zoom out</div>',
      '<div>[scroll] pan</div>',
    ].join('');

    var metaPanel = document.createElement('div');
    metaPanel.style.cssText = [
      'width:100%', 'max-width:90vw',
      'padding:0.75rem 1.5rem', 'box-sizing:border-box',
      'text-align:center', 'flex-shrink:0',
      'transition:opacity 0.2s ease',
    ].join(';');

    var metaTitle = document.createElement('div');
    metaTitle.style.cssText = [
      'font-size:1.0rem', 'font-weight:600',
      'color:rgba(255,255,255,0.95)',
      'line-height:1.4',
    ].join(';');

    var metaDesc = document.createElement('div');
    metaDesc.style.cssText = [
      'font-size:1.0rem', 'font-weight:400',
      'color:rgba(255,255,255,0.75)',
      'line-height:1.4', 'margin-top:0.1rem',
    ].join(';');

    var metaDetails = document.createElement('div');
    metaDetails.style.cssText = [
      'font-size:0.8rem', 'font-weight:400',
      'color:rgba(255,255,255,0.45)',
      'line-height:1.4', 'margin-top:0.35rem',
    ].join(';');

    metaPanel.appendChild(metaTitle);
    metaPanel.appendChild(metaDesc);
    metaPanel.appendChild(metaDetails);
    imgWrap.appendChild(img);

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

    overlay.appendChild(imgWrap);
    overlay.appendChild(metaPanel);
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    overlay.appendChild(closeBtn);
    overlay.appendChild(help);
    document.body.appendChild(overlay);

    // Zoom / pan state
    var scale = 1, tx = 0, ty = 0;
    var fitMode = true; // true => fit-to-window, false => 100% image size mode
    var dragging = false, dragX = 0, dragY = 0, startTx = 0, startTy = 0;
    var dragMoved = false;
    var altHeld = false;
    var pinchDist = null;
    var pinchStartScale = 1;
    var pinchStartTx = 0, pinchStartTy = 0;
    var helpTimer = null;

    function updateInteractionCursor() {
      if (dragging) {
        img.style.cursor = 'grabbing';
        return;
      }
      img.style.cursor = altHeld ? 'zoom-out' : 'zoom-in';
    }

    function showHelp() {
      clearTimeout(helpTimer);
      help.style.opacity = '1';
      help.style.transform = 'translateY(0)';
      helpTimer = setTimeout(function () {
        help.style.opacity = '0';
        help.style.transform = 'translateY(6px)';
      }, 2200);
    }

    function applyXform(animated) {
      img.style.transition = animated ? 'transform 0.2s ease' : 'none';
      img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      updateInteractionCursor();
    }

    function getFitScale() {
      if (!img.naturalWidth || !img.naturalHeight) return 1;
      var maxW = window.innerWidth * 0.9;
      var maxH = (window.innerHeight * 0.9) - 80;
      var sx = maxW / img.naturalWidth;
      var sy = maxH / img.naturalHeight;
      return Math.min(1, sx, sy);
    }

    function toggleZoomMode() {
      var fitScale = getFitScale();
      if (fitMode) {
        fitMode = false;
        scale = fitScale > 0 ? (1 / fitScale) : 1;
      } else {
        fitMode = true;
        scale = 1;
        tx = 0; ty = 0;
      }
      applyXform(true);
    }

    function reset() {
      fitMode = true;
      scale = 1; tx = 0; ty = 0;
      applyXform(true);
    }

    overlay.addEventListener('wheel', function (e) {
      e.preventDefault();
      showHelp();
      if (e.ctrlKey) {
        // Trackpad pinch arrives as ctrl+wheel in most browsers.
        fitMode = false;
        scale = Math.min(8, Math.max(1, scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      } else if (scale > 1) {
        // Scroll wheel pans when zoomed.
        tx -= e.deltaX;
        ty -= e.deltaY;
      }
      applyXform(false);
    }, { passive: false });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target === imgWrap) {
        if (scale > 1) reset(); else closeLB();
      }
    });

    img.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || scale <= 1) return;
      e.preventDefault();
      showHelp();
      dragging = true;
      dragMoved = false;
      dragX = e.clientX; dragY = e.clientY;
      startTx = tx; startTy = ty;
      img.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      if (Math.abs(e.clientX - dragX) > 2 || Math.abs(e.clientY - dragY) > 2) dragMoved = true;
      tx = startTx + (e.clientX - dragX);
      ty = startTy + (e.clientY - dragY);
      applyXform(false);
    });
    window.addEventListener('mouseup', function () {
      if (dragging) { dragging = false; applyXform(false); }
    });
    img.addEventListener('mousemove', function (e) {
      altHeld = !!e.altKey;
      updateInteractionCursor();
    });
    window.addEventListener('keydown', function (e) {
      if (!lb || lb.style.display === 'none') return;
      altHeld = !!e.altKey;
      updateInteractionCursor();
    });
    window.addEventListener('keyup', function (e) {
      if (!lb || lb.style.display === 'none') return;
      altHeld = !!e.altKey;
      updateInteractionCursor();
    });

    overlay.addEventListener('touchstart', function (e) {
      showHelp();
      if (e.touches.length === 2) {
        pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        pinchStartScale = scale;
        pinchStartTx = tx;
        pinchStartTy = ty;
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
        fitMode = false;
        scale = Math.min(8, Math.max(1, pinchStartScale * (d / pinchDist)));
        tx = pinchStartTx;
        ty = pinchStartTy;
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

    img.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showHelp();
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      fitMode = false;
      if (e.altKey) {
        scale = Math.max(1, scale / 1.2);
      } else {
        scale = Math.min(8, scale * 1.2);
      }
      if (scale === 1) {
        tx = 0; ty = 0;
        fitMode = true;
      }
      applyXform(true);
    });
    updateInteractionCursor();

    prevBtn.addEventListener('click',  function (e) { e.stopPropagation(); showHelp(); navigate(-1); });
    nextBtn.addEventListener('click',  function (e) { e.stopPropagation(); showHelp(); navigate(1); });
    closeBtn.addEventListener('click', function (e) { e.stopPropagation(); showHelp(); closeLB(); });

    lbImg = img;
    lbReset = reset;
    lbToggleZoomMode = toggleZoomMode;
    lbShowHelp = showHelp;
    lbMetaTitle = metaTitle;
    lbMetaDesc = metaDesc;
    lbMetaDetails = metaDetails;
    return overlay;
  }

  function openLB(index, itemSet) {
    currentLBItems = itemSet || allItems;
    currentIdx = index;
    if (!lb) lb = buildLightbox();
    document.body.style.overflow = 'hidden';
    lb.style.display = 'flex';
    requestAnimationFrame(function () { lb.style.opacity = '1'; });
    showLBImage(currentIdx);
    preloadNeighbors(currentIdx);
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
    currentIdx = (currentIdx + dir + currentLBItems.length) % currentLBItems.length;
    showLBImage(currentIdx);
    preloadNeighbors(currentIdx);
  }

  var lbMetaTitle = null;
  var lbMetaDesc = null;
  var lbMetaDetails = null;

  function showLBImage(index) {
    lbReset();
    var item = currentLBItems[index];
    lbImg.style.transition = 'opacity 0.2s ease';
    lbImg.style.opacity = '0';
    lbImg.src = item.fullSrc;
    lbImg.onload = function () { lbImg.style.opacity = '1'; };

    if (lbMetaTitle) {
      lbMetaTitle.textContent = item.meta.title || '';
      lbMetaTitle.style.display = item.meta.title ? '' : 'none';
    }
    if (lbMetaDesc) {
      lbMetaDesc.textContent = item.meta.description || '';
      lbMetaDesc.style.display = item.meta.description ? '' : 'none';
    }
    if (lbMetaDetails) {
      var html = buildMetaDetailsHTML(item.meta);
      lbMetaDetails.innerHTML = html;
      lbMetaDetails.style.display = html ? '' : 'none';
    }
  }

  function preloadNeighbors(index) {
    [-1, 1].forEach(function (d) {
      var i = (index + d + currentLBItems.length) % currentLBItems.length;
      var pre = new Image();
      pre.src = currentLBItems[i].fullSrc;
    });
  }

  document.addEventListener('keydown', function (e) {
    if (!lb || lb.style.display === 'none') return;
    if (lbShowHelp) lbShowHelp();
    if (e.key === 'ArrowRight') navigate(1);
    else if (e.key === 'ArrowLeft') navigate(-1);
    else if (e.key === 'Escape') closeLB();
    else if (e.key === 'z' || e.key === 'Z') {
      if (lbToggleZoomMode) lbToggleZoomMode();
    }
  });

  // ── Album grouping ──────────────────────────────────────────────────────
  var allItems = [];
  var viewMode = 'masonry'; // 'masonry' | 'albums' | 'album-detail'
  var albumViewEl = null;
  var albumDetailEl = null;
  var container = null;
  var toggleBtn = null;
  var toggleWrap = null;
  var GROUPED_MAX_WIDTH = '80rem'; // Tailwind max-w-7xl

  function getGroupedMaxWidthPx() {
    if (typeof GROUPED_MAX_WIDTH !== 'string') return 1280;
    if (GROUPED_MAX_WIDTH.slice(-3) === 'rem') {
      var rem = parseFloat(GROUPED_MAX_WIDTH);
      var rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      return Math.round(rem * rootFont);
    }
    var px = parseFloat(GROUPED_MAX_WIDTH);
    return isNaN(px) ? 1280 : Math.round(px);
  }

  function setContainerModeWidth(mode) {
    if (!container) return;
    // Keep container full-width in all modes to avoid pre-animation layout jumps.
    container.style.width = '100%';
    container.style.maxWidth = 'none';
    container.style.marginLeft = 'auto';
    container.style.marginRight = 'auto';
    if (toggleWrap) toggleWrap.style.maxWidth = GROUPED_MAX_WIDTH;
  }

  function getAlbums() {
    var map = {};
    allItems.forEach(function (item) {
      item.meta.albums.forEach(function (album) {
        if (!map[album]) map[album] = [];
        map[album].push(item);
      });
    });
    // Sort each album's items by their original index (filename order)
    Object.keys(map).forEach(function (k) {
      map[k].sort(function (a, b) { return a.index - b.index; });
    });
    return map;
  }

  // ── Album view helpers ────────────────────────────────────────────────
  function getPageBgColor() {
    var bg = getComputedStyle(document.body).backgroundColor;
    return bg || 'rgb(0,0,0)';
  }

  // Overlay elements (labels, gradients, click targets) placed on the masonry container
  var albumOverlays = [];

  function clearAlbumOverlays() {
    albumOverlays.forEach(function (el) { el.remove(); });
    albumOverlays = [];
  }

  function getRowLiveBounds(row) {
    var previewItems = row.previewItems || [];
    if (!previewItems.length) return null;

    var containerRect = container.getBoundingClientRect();
    var minLeft = Infinity;
    var minTop = Infinity;
    var maxRight = -Infinity;
    var maxBottom = -Infinity;

    previewItems.forEach(function (item) {
      var r = item.el.getBoundingClientRect();
      var left = r.left - containerRect.left;
      var top = r.top - containerRect.top;
      var width = r.width;
      var height = r.height;
      if ([left, top, width, height].some(function (v) { return !isFinite(v); })) return;

      minLeft = Math.min(minLeft, left);
      minTop = Math.min(minTop, top);
      maxRight = Math.max(maxRight, left + width);
      maxBottom = Math.max(maxBottom, top + height);
    });

    if (!isFinite(minLeft) || !isFinite(minTop) || !isFinite(maxRight) || !isFinite(maxBottom)) {
      return null;
    }
    return {
      left: minLeft,
      top: minTop,
      width: Math.max(1, maxRight - minLeft),
      height: Math.max(1, maxBottom - minTop),
    };
  }

  // Compute album layout: cluster points, fan-out targets, row positions
  function computeAlbumLayout() {
    var albums = getAlbums();
    var names = Object.keys(albums).sort();
    var containerWidth = container.offsetWidth;
    var boundedWidth = Math.min(containerWidth, getGroupedMaxWidthPx());
    var boundedOffsetX = Math.floor((containerWidth - boundedWidth) / 2);
    var previewCount = getAlbumPreviewCount();
    var rowGap = GAP * 2;

    var albumSizes = {};
    names.forEach(function (name) {
      albumSizes[name] = albums[name].length;
    });

    var itemPrimaryAlbum = {};
    allItems.forEach(function (item) {
      if (item.meta.albums.length > 0) {
        var chosen = item.meta.albums.slice().sort(function (a, b) {
          var countA = albumSizes[a] || 0;
          var countB = albumSizes[b] || 0;
          if (countA !== countB) return countA - countB;
          return a.localeCompare(b);
        })[0];
        itemPrimaryAlbum[item.index] = chosen;
      }
    });

    var rows = [];
    var currentY = 0;

    names.forEach(function (name) {
      var items = albums[name];
      var rowItems = items.filter(function (item) { return itemPrimaryAlbum[item.index] === name; });
      if (rowItems.length === 0) rowItems = items.slice();

      var previewItems = rowItems.slice(0, Math.min(previewCount, rowItems.length));
      var visibleRatios = previewItems.map(function (item) { return item.w / item.h; });
      var ratioSum = visibleRatios.reduce(function (acc, ratio) { return acc + ratio; }, 0);
      var rowH = ALBUM_MIN_THUMB_HEIGHT;
      if (visibleRatios.length > 0 && ratioSum > 0) {
        var availableW = Math.max(1, boundedWidth - (visibleRatios.length - 1) * GAP);
        rowH = Math.max(ALBUM_MIN_THUMB_HEIGHT, Math.floor(availableW / ratioSum));
      }
      var clusterY = currentY + rowH / 2;

      // Pass 1: measure visible thumbnail strip width
      var visibleWidths = [];
      previewItems.forEach(function (item) {
        visibleWidths.push(Math.round((item.w / item.h) * rowH));
      });
      fitRowWidthsToContainer(visibleWidths, boundedWidth);
      var rowWidth = 0;
      visibleWidths.forEach(function (w) { rowWidth += w; });
      if (visibleWidths.length > 1) rowWidth += (visibleWidths.length - 1) * GAP;

      var rowOffsetX = boundedOffsetX + Math.max(0, Math.floor((boundedWidth - rowWidth) / 2));

      // Pass 2: assign fan-out targets using the centered offset
      var fanTargets = {};
      var visibleTargetLeft = null;
      var visibleTargetRight = null;
      var x = 0;
      rowItems.forEach(function (item, posInRow) {
        var thumbW = Math.round((item.w / item.h) * rowH);
        if (posInRow < visibleWidths.length) {
          thumbW = visibleWidths[posInRow];
        }
        if (posInRow < previewCount) {
          var targetX = rowOffsetX + x;
          fanTargets[item.index] = {
            x: targetX, y: currentY, w: thumbW, h: rowH,
            visible: true, opacity: 1, rotation: 0,
          };
          if (visibleTargetLeft === null || targetX < visibleTargetLeft) visibleTargetLeft = targetX;
          if (visibleTargetRight === null || (targetX + thumbW) > visibleTargetRight) visibleTargetRight = targetX + thumbW;
          x += thumbW + GAP;
        } else {
          // Non-preview items move into their album row and fade during travel.
          var hiddenOffset = (posInRow - previewCount) % 5;
          var hiddenX = rowOffsetX + Math.max(0, Math.floor((rowWidth - thumbW) / 2)) + (hiddenOffset - 2) * 4;
          fanTargets[item.index] = {
            x: hiddenX, y: currentY,
            w: thumbW, h: rowH,
            visible: false, opacity: 0, rotation: 0,
          };
        }
      });

      // Single source of truth for overlay geometry: exact visible thumbnail bounds.
      if (visibleTargetLeft !== null && visibleTargetRight !== null) {
        rowOffsetX = visibleTargetLeft;
        rowWidth = visibleTargetRight - visibleTargetLeft;
      }

      rows.push({
        name: name, items: rowItems, y: currentY, h: rowH,
        clusterX: Math.floor(containerWidth / 2),
        clusterY: clusterY,
        fanTargets: fanTargets,
        previewItems: previewItems,
        hiddenItems: rowItems.slice(previewItems.length),
        count: items.length,
        rowOffsetX: rowOffsetX,
        rowWidth: rowWidth,
      });

      currentY += rowH + rowGap;
    });

    var orphanTargets = {};
    allItems.forEach(function (item) {
      if (!(item.index in itemPrimaryAlbum)) {
        orphanTargets[item.index] = {
          x: containerWidth + 50, y: item.y,
          w: parseInt(item.el.style.width) || 100,
          h: parseInt(item.el.style.height) || 100,
          visible: false, opacity: 0, rotation: 0,
        };
      }
    });

    return {
      rows: rows,
      orphanTargets: orphanTargets,
      totalHeight: currentY,
      itemPrimaryAlbum: itemPrimaryAlbum,
      boundedWidth: boundedWidth,
      boundedOffsetX: boundedOffsetX,
    };
  }

  function addAlbumOverlays(layout, options) {
    options = options || {};
    var trackMs = Math.max(0, options.trackMs || 0);
    var primary = getPrimaryColor();
    var pageBg = getPageBgColor();
    var rowOverlayBundles = [];

    layout.rows.forEach(function (row) {
      var ox = row.rowOffsetX;
      var totalW = row.rowWidth;
      var liveBounds = getRowLiveBounds(row);
      var startLeft = liveBounds ? liveBounds.left : ox;
      var startTop = liveBounds ? liveBounds.top : row.y;
      var startWidth = liveBounds ? liveBounds.width : totalW;
      var startHeight = liveBounds ? liveBounds.height : row.h;

      // Gradient overlay — spans the thumbnail area
      var gradient = document.createElement('div');
      gradient.style.cssText = [
        'position:absolute',
        'left:' + startLeft + 'px', 'top:' + startTop + 'px',
        'width:' + startWidth + 'px', 'height:' + startHeight + 'px',
        'background:linear-gradient(to right, transparent 0%, transparent 30%, ' + pageBg + ' 100%)',
        'z-index:4', 'pointer-events:none',
        'opacity:0',
        'transition:opacity ' + ALBUM_OVERLAY_ANIM_MS + 'ms ease-out',
      ].join(';');
      gradient.dataset.overlayRole = 'gradient';
      gradient.dataset.finalLeft = String(ox);
      gradient.dataset.finalTop = String(row.y);
      gradient.dataset.finalWidth = String(totalW);
      gradient.dataset.finalHeight = String(row.h);
      container.appendChild(gradient);
      albumOverlays.push(gradient);

      // Bottom gradient under label text
      var labelGradient = document.createElement('div');
      labelGradient.style.cssText = [
        'position:absolute',
        'left:' + startLeft + 'px', 'top:' + (startTop + startHeight - 40) + 'px',
        'width:' + startWidth + 'px', 'height:40px',
        'opacity:0',
        'z-index:5', 'pointer-events:none',
        'background:linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
        'transition:opacity ' + ALBUM_OVERLAY_ANIM_MS + 'ms ease-out',
      ].join(';');
      labelGradient.dataset.overlayRole = 'label-gradient';
      labelGradient.dataset.finalOpacity = '1';
      labelGradient.dataset.finalLeft = String(ox);
      labelGradient.dataset.finalTop = String(row.y + row.h - 40);
      labelGradient.dataset.finalWidth = String(totalW);
      container.appendChild(labelGradient);
      albumOverlays.push(labelGradient);

      // Label text
      var label = document.createElement('div');
      label.style.cssText = [
        'position:absolute',
        'left:' + startLeft + 'px', 'top:' + (startTop + startHeight - 40) + 'px',
        'width:' + startWidth + 'px', 'height:40px',
        'padding:0 1.25rem', 'box-sizing:border-box',
        'display:flex', 'flex-direction:column', 'justify-content:flex-end',
        'z-index:6', 'color:white',
        'gap:0.15rem',
        'pointer-events:none',
      ].join(';');
      label.dataset.overlayRole = 'label';
      label.dataset.finalLeft = String(ox);
      label.dataset.finalTop = String(row.y + row.h - 40);
      label.dataset.finalWidth = String(totalW);

      var title = document.createElement('div');
      title.style.cssText = [
        'font-size:1.1rem', 'font-weight:600',
        'opacity:0', 'transform:translateY(12px)',
        'transition:opacity ' + ALBUM_OVERLAY_ANIM_MS + 'ms ease-out, transform ' + ALBUM_OVERLAY_ANIM_MS + 'ms ease-out',
      ].join(';');
      title.dataset.overlayRole = 'title';
      title.dataset.finalOpacity = '1';
      title.textContent = row.name;

      var description = document.createElement('div');
      description.style.cssText = [
        'font-weight:400', 'font-size:0.85rem',
        'opacity:0', 'transform:translateY(12px)',
        'transition:opacity ' + ALBUM_OVERLAY_ANIM_MS + 'ms ease-out 0.2s, transform ' + ALBUM_OVERLAY_ANIM_MS + 'ms ease-out 0.2s',
      ].join(';');
      description.dataset.overlayRole = 'description';
      description.dataset.finalOpacity = '0.65';
      description.textContent = row.count + ' photos';

      label.appendChild(title);
      label.appendChild(description);
      container.appendChild(label);
      albumOverlays.push(title);
      albumOverlays.push(description);
      albumOverlays.push(label);

      // Click target (invisible, covers the row)
      var clickTarget = document.createElement('a');
      clickTarget.href = window.location.pathname + '?album=' + encodeURIComponent(row.name);
      clickTarget.style.cssText = [
        'position:absolute',
        'left:' + ox + 'px', 'top:' + row.y + 'px',
        'width:' + totalW + 'px', 'height:' + row.h + 'px',
        'z-index:7', 'border-radius:0.5rem',
        'outline:2px solid transparent',
        'transition:outline 0.2s ease, box-shadow 0.2s ease',
      ].join(';');
      clickTarget.addEventListener('mouseenter', function () {
        clickTarget.style.outline = '2px solid ' + primary;
        clickTarget.style.boxShadow = '0 0 16px ' + primary.replace('rgb', 'rgba').replace(')', ',0.3)');
      });
      clickTarget.addEventListener('mouseleave', function () {
        clickTarget.style.outline = '2px solid transparent';
        clickTarget.style.boxShadow = 'none';
      });
      clickTarget.addEventListener('click', function (e) {
        e.preventDefault();
        showAlbumDetail(row.name, { animated: true, fromRow: row, pushHistory: true });
      });
      container.appendChild(clickTarget);
      albumOverlays.push(clickTarget);

      rowOverlayBundles.push({
        row: row,
        gradient: gradient,
        labelGradient: labelGradient,
        label: label,
        finalLeft: ox,
        finalTop: row.y,
        finalWidth: totalW,
        finalHeight: row.h,
      });
    });

    function applyLiveOverlayGeometry() {
      rowOverlayBundles.forEach(function (bundle) {
        var live = getRowLiveBounds(bundle.row);
        var left = live ? live.left : bundle.finalLeft;
        var top = live ? live.top : bundle.finalTop;
        var width = live ? live.width : bundle.finalWidth;
        var height = live ? live.height : bundle.finalHeight;

        bundle.gradient.style.left = left + 'px';
        bundle.gradient.style.top = top + 'px';
        bundle.gradient.style.width = width + 'px';
        bundle.gradient.style.height = height + 'px';

        bundle.labelGradient.style.left = left + 'px';
        bundle.labelGradient.style.top = (top + height - 40) + 'px';
        bundle.labelGradient.style.width = width + 'px';

        bundle.label.style.left = left + 'px';
        bundle.label.style.top = (top + height - 40) + 'px';
        bundle.label.style.width = width + 'px';
      });
    }

    if (trackMs > 0 && rowOverlayBundles.length) {
      var endAt = performance.now() + trackMs;
      var syncLiveBounds = function () {
        applyLiveOverlayGeometry();
        if (performance.now() < endAt) {
          requestAnimationFrame(syncLiveBounds);
        } else {
          // Snap to final row geometry at the end of movement.
          rowOverlayBundles.forEach(function (bundle) {
            bundle.gradient.style.left = bundle.finalLeft + 'px';
            bundle.gradient.style.top = bundle.finalTop + 'px';
            bundle.gradient.style.width = bundle.finalWidth + 'px';
            bundle.gradient.style.height = bundle.finalHeight + 'px';

            bundle.labelGradient.style.left = bundle.finalLeft + 'px';
            bundle.labelGradient.style.top = (bundle.finalTop + bundle.finalHeight - 40) + 'px';
            bundle.labelGradient.style.width = bundle.finalWidth + 'px';

            bundle.label.style.left = bundle.finalLeft + 'px';
            bundle.label.style.top = (bundle.finalTop + bundle.finalHeight - 40) + 'px';
            bundle.label.style.width = bundle.finalWidth + 'px';
          });
        }
      };
      requestAnimationFrame(syncLiveBounds);
    } else {
      applyLiveOverlayGeometry();
    }

    // Trigger the fade-in after a frame
    requestAnimationFrame(function () {
      // Let thumbnails settle first, then start text slide-in.
      setTimeout(function () {
        albumOverlays.forEach(function (el) {
          if (el.dataset.overlayRole === 'gradient') {
            el.style.opacity = '1';
          } else if (el.dataset.overlayRole === 'label-gradient') {
            el.style.opacity = el.dataset.finalOpacity || '1';
          } else if ((el.dataset.overlayRole === 'title' || el.dataset.overlayRole === 'description') && el.style.opacity === '0') {
            el.style.opacity = el.dataset.finalOpacity || '1';
            el.style.transform = 'translateY(0)';
          }
        });
      }, ALBUM_TEXT_START_DELAY_MS);
    });
  }

  // ── Masonry → Album animation (direct transition) ─────────────────────
  function showAlbumView() {
    if (viewMode === 'albums') return;
    viewMode = 'albums';
    updateToggleBtn();
    setContainerModeWidth('albums');

    container.style.overflow = 'hidden';

    var layout = computeAlbumLayout();
    var dur = ANIM_DURATION + 'ms';

    container.style.transition = 'height ' + dur + ' ease-in-out';
    container.style.height = layout.totalHeight + 'px';

    allItems.forEach(function (item) {
      var primaryAlbum = layout.itemPrimaryAlbum[item.index];
      if (primaryAlbum) {
        var row = layout.rows.find(function (r) { return r.name === primaryAlbum; });
        if (row) {
          var fanTarget = row.fanTargets[item.index];
          if (fanTarget) {
            var moveTransition = 'left ' + dur + ' ease-in-out, top ' + dur + ' ease-in-out, width ' + dur + ' ease-in-out, height ' + dur + ' ease-in-out';
            if (!fanTarget.visible) {
              moveTransition += ', opacity ' + dur + ' ease-in';
            }
            item.el.style.transition = moveTransition;
            item.el.style.left = fanTarget.x + 'px';
            item.el.style.top = fanTarget.y + 'px';
            item.el.style.width = fanTarget.w + 'px';
            item.el.style.height = fanTarget.h + 'px';
            item.el.style.zIndex = fanTarget.visible ? '3' : '1';
            item.el.style.opacity = fanTarget.visible ? '1' : '0';
          }
        }
      } else {
        item.el.style.transition = 'left ' + dur + ' ease-in-out, opacity ' + dur + ' ease-in';
        var ot = layout.orphanTargets[item.index];
        item.el.style.left = (ot ? ot.x : (layout.boundedOffsetX + layout.boundedWidth + 50)) + 'px';
        item.el.style.opacity = '0';
        item.el.style.zIndex = '0';
      }
    });

    // Start overlays slightly before thumbnails finish their move.
    setTimeout(function () {
      addAlbumOverlays(layout, { trackMs: ALBUM_OVERLAY_LEAD_MS + 80 });
    }, Math.max(0, ANIM_DURATION - ALBUM_OVERLAY_LEAD_MS));

    // Cleanup transition styles after item transitions complete.
    setTimeout(function () {
      allItems.forEach(function (item) {
        item.el.style.transition = '';
      });
      container.style.transition = '';
      container.style.overflow = '';
    }, ANIM_DURATION + 80);
  }

  // ── Album → Masonry animation ─────────────────────────────────────────
  function showMasonryView() {
    if (viewMode === 'masonry') return;
    viewMode = 'masonry';
    setContainerModeWidth('masonry');

    var priorAlbumLayout = computeAlbumLayout();
    var hiddenByIndex = {};
    priorAlbumLayout.rows.forEach(function (row) {
      Object.keys(row.fanTargets).forEach(function (key) {
        var target = row.fanTargets[key];
        if (!target.visible) hiddenByIndex[parseInt(key, 10)] = true;
      });
    });
    var hiddenItems = allItems
      .filter(function (item) { return !!hiddenByIndex[item.index]; })
      .sort(function (a, b) { return a.index - b.index; });

    // Remove overlays immediately
    clearAlbumOverlays();

    // Prepare items for return animation
    allItems.forEach(function (item) {
      item.el.style.zIndex = '';
      item.img.style.opacity = '1';
    });

    var cols = getColCount();
    var masonry = computeMasonryTargets(container, allItems, cols);
    var rightEntryX = priorAlbumLayout.boundedOffsetX + priorAlbumLayout.boundedWidth + GAP;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var dur = ANIM_DURATION + 'ms';

        hiddenItems.forEach(function (item) {
          item.el.style.transition = '';
          item.el.style.left = rightEntryX + 'px';
          item.el.style.opacity = '0';
          item.el.style.zIndex = '1';
        });

        void container.offsetWidth;

        allItems.forEach(function (item) {
          var target = masonry.targets[item.index];
          var isHidden = !!hiddenByIndex[item.index];
          if (isHidden) {
            // Hidden album items travel from the right lane while fading in.
            item.el.style.transition =
              'left ' + dur + ' ease-out, ' +
              'top ' + dur + ' ease-out, ' +
              'width ' + dur + ' ease-out, ' +
              'height ' + dur + ' ease-out, ' +
              'transform ' + dur + ' ease-out, ' +
              'opacity ' + dur + ' ease-in';
          } else {
            item.el.style.transition =
              'left ' + dur + ' ease-out, ' +
              'top ' + dur + ' ease-out, ' +
              'width ' + dur + ' ease-out, ' +
              'height ' + dur + ' ease-out, ' +
              'transform ' + dur + ' ease-out';
          }
          item.el.style.transform = '';
          item.el.style.left = target.x + 'px';
          item.el.style.top = target.y + 'px';
          item.el.style.width = target.w + 'px';
          item.el.style.height = target.h + 'px';
          item.el.style.opacity = '1';
        });
        container.style.transition = 'height ' + dur + ' ease-in-out';
        container.style.height = masonry.totalHeight + 'px';

        setTimeout(function () {
          allItems.forEach(function (item) {
            item.el.style.transition = '';
          });
          container.style.transition = '';
          container.style.overflow = '';
        }, ANIM_DURATION + 50);
      });
    });

    if (window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    updateToggleBtn();
  }

  // ── Album detail view ──────────────────────────────────────────────────
  function buildAlbumDetailView(albumName, items) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'max-width:900px;margin:0 auto;padding:0 1rem;opacity:0;transition:opacity 0.4s ease;';

    // Back button + album title
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:1rem;margin-bottom:2rem;';

    var backBtn = document.createElement('button');
    backBtn.innerHTML = '&#8592;';
    backBtn.style.cssText = [
      'background:none', 'border:none', 'color:white',
      'font-size:1.5rem', 'cursor:pointer', 'opacity:0.7',
      'transition:opacity 0.2s',
    ].join(';');
    backBtn.addEventListener('mouseenter', function () { backBtn.style.opacity = '1'; });
    backBtn.addEventListener('mouseleave', function () { backBtn.style.opacity = '0.7'; });
    backBtn.addEventListener('click', function () {
      showAlbumViewFromDetail();
    });

    var title = document.createElement('h2');
    title.textContent = albumName;
    title.style.cssText = 'font-size:1.8rem;font-weight:700;color:white;margin:0;';

    var count = document.createElement('span');
    count.textContent = items.length + ' photos';
    count.style.cssText = 'font-size:0.9rem;color:rgba(255,255,255,0.5);';

    header.appendChild(backBtn);
    header.appendChild(title);
    header.appendChild(count);
    wrap.appendChild(header);

    // Vertical image list
    items.forEach(function (item, i) {
      var card = document.createElement('div');
      card.style.cssText = 'margin-bottom:2.5rem;';

      var imgEl = document.createElement('img');
      imgEl.src = item.fullSrc;
      imgEl.style.cssText = [
        'width:100%', 'border-radius:0.5rem',
        'cursor:pointer', 'display:block',
      ].join(';');
      imgEl.addEventListener('click', function () {
        openLB(i, items);
      });

      card.appendChild(imgEl);

      // Metadata under image
      var meta = document.createElement('div');
      meta.style.cssText = 'padding:0.75rem 0.25rem;';

      if (item.meta.title) {
        var t = document.createElement('div');
        t.textContent = item.meta.title;
        t.style.cssText = 'font-size:1.0rem;font-weight:600;color:rgba(255,255,255,0.95);line-height:1.4;';
        meta.appendChild(t);
      }
      if (item.meta.description) {
        var d = document.createElement('div');
        d.textContent = item.meta.description;
        d.style.cssText = 'font-size:1.0rem;color:rgba(255,255,255,0.75);line-height:1.4;margin-top:0.1rem;';
        meta.appendChild(d);
      }
      var detailsHTML = buildMetaDetailsHTML(item.meta);
      if (detailsHTML) {
        var det = document.createElement('div');
        det.innerHTML = detailsHTML;
        det.style.cssText = 'font-size:0.8rem;color:rgba(255,255,255,0.45);line-height:1.4;margin-top:0.35rem;';
        meta.appendChild(det);
      }

      card.appendChild(meta);
      wrap.appendChild(card);
    });

    return wrap;
  }

  function animateAlbumToDetail(albumName, row) {
    var albums = getAlbums();
    var albumItems = albums[albumName] || [];
    if (!row || albumItems.length === 0) return false;

    var previewItems = row.items.filter(function (item) {
      var t = row.fanTargets[item.index];
      return !!(t && t.visible);
    });
    if (previewItems.length === 0) return false;

    var detailW = Math.max(320, Math.min(900, container.offsetWidth - 32));
    var detailX = Math.floor((container.offsetWidth - detailW) / 2);
    var targetY = 88;
    var previewTargets = {};
    previewItems.forEach(function (item) {
      var h = Math.round((item.h / item.w) * detailW);
      previewTargets[item.index] = { x: detailX, y: targetY, w: detailW, h: h };
      targetY += h + 28;
    });

    var titleEl = null;
    albumOverlays.forEach(function (el) {
      if (el.dataset && el.dataset.overlayRole === 'title' && el.textContent === albumName) {
        titleEl = el;
      }
    });
    var floatingTitle = null;
    if (titleEl) {
      var cRect = container.getBoundingClientRect();
      var tRect = titleEl.getBoundingClientRect();
      floatingTitle = document.createElement('div');
      floatingTitle.textContent = albumName;
      floatingTitle.style.cssText = [
        'position:absolute',
        'left:' + (tRect.left - cRect.left) + 'px',
        'top:' + (tRect.top - cRect.top) + 'px',
        'font-size:1.1rem',
        'font-weight:600',
        'line-height:1.2',
        'color:rgba(255,255,255,0.95)',
        'z-index:20',
        'pointer-events:none',
        'transform-origin:left top',
        'transition:transform ' + ANIM_DURATION + 'ms ease-out, opacity ' + ANIM_DURATION + 'ms ease-out',
      ].join(';');
      container.appendChild(floatingTitle);
      requestAnimationFrame(function () {
        floatingTitle.style.transform = 'translate(' + (detailX - (tRect.left - cRect.left)) + 'px,' + (8 - (tRect.top - cRect.top)) + 'px) scale(1.6)';
        floatingTitle.style.opacity = '1';
      });
    }

    clearAlbumOverlays();
    if (toggleWrap) toggleWrap.style.display = 'none';

    var dur = ANIM_DURATION + 'ms';
    allItems.forEach(function (item) {
      var target = previewTargets[item.index];
      if (target) {
        item.el.style.transition = 'left ' + dur + ' ease-out, top ' + dur + ' ease-out, width ' + dur + ' ease-out, height ' + dur + ' ease-out, opacity ' + dur + ' ease-out';
        item.el.style.left = target.x + 'px';
        item.el.style.top = target.y + 'px';
        item.el.style.width = target.w + 'px';
        item.el.style.height = target.h + 'px';
        item.el.style.opacity = '1';
        item.el.style.zIndex = '12';
      } else {
        item.el.style.transition = 'opacity ' + dur + ' ease-out';
        item.el.style.opacity = '0';
        item.el.style.zIndex = '0';
      }
    });

    setTimeout(function () {
      if (floatingTitle) floatingTitle.remove();
      showAlbumDetail(albumName, { animated: false, pushHistory: false });
    }, ANIM_DURATION + 40);
    return true;
  }

  function showAlbumDetail(albumName, options) {
    options = options || {};
    if (options.pushHistory && window.history.pushState) {
      window.history.pushState(null, '', window.location.pathname + '?album=' + encodeURIComponent(albumName));
    }

    if (options.animated && viewMode === 'albums') {
      var animated = animateAlbumToDetail(albumName, options.fromRow);
      if (animated) return;
    }

    viewMode = 'album-detail';
    var albums = getAlbums();
    var items = albums[albumName] || [];

    // Hide everything else
    container.style.display = 'none';
    if (albumViewEl) {
      albumViewEl.style.transition = 'opacity 0.3s ease';
      albumViewEl.style.opacity = '0';
      var el = albumViewEl;
      setTimeout(function () { el.remove(); }, 300);
      albumViewEl = null;
    }

    if (albumDetailEl) albumDetailEl.remove();
    albumDetailEl = buildAlbumDetailView(albumName, items);
    container.parentNode.insertBefore(albumDetailEl, container.nextSibling);
    requestAnimationFrame(function () {
      albumDetailEl.style.opacity = '1';
    });

    updateToggleBtn();
  }

  function showAlbumViewFromDetail(skipHistory) {
    viewMode = 'albums';

    if (albumDetailEl) {
      albumDetailEl.style.transition = 'opacity 0.3s ease';
      albumDetailEl.style.opacity = '0';
      var el = albumDetailEl;
      setTimeout(function () { el.remove(); }, 300);
      albumDetailEl = null;
    }

    setTimeout(function () {
      // Restore masonry baseline first, then animate into album overview.
      container.style.display = '';
      container.style.opacity = '1';
      clearAlbumOverlays();
      allItems.forEach(function (item) {
        item.el.style.transition = '';
        item.el.style.opacity = '1';
        item.el.style.zIndex = '';
        if (!item.img.src) item.img.src = item.src;
        item.img.style.opacity = '1';
      });

      setContainerModeWidth('masonry');
      var cols = getColCount();
      layoutMasonry(container, allItems, cols);
      viewMode = 'masonry';
      updateToggleBtn();

      requestAnimationFrame(function () {
        showAlbumView();
      });
    }, 300);

    if (!skipHistory && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    updateToggleBtn();
  }

  // ── Toggle button ──────────────────────────────────────────────────────
  function createToggleBtn() {
    var btn = document.createElement('button');
    function getProseTextColor() {
      var prose = document.querySelector('.prose');
      if (prose) {
        var c = getComputedStyle(prose).color;
        if (c) return c;
      }
      return 'rgba(255,255,255,0.82)';
    }

    function applyBaseStyles() {
      btn.style.background = 'transparent';
      btn.style.border = 'none';
      btn.style.color = getProseTextColor();
    }

    btn.style.cssText = [
      'display:flex', 'align-items:center', 'gap:0.5rem',
      'margin:0', 'padding:0.5rem',
      'border-radius:0.5rem',
      'cursor:pointer', 'font-size:0.85rem',
      'line-height:1',
      'transition:background 0.2s,color 0.2s',
      'pointer-events:auto',
    ].join(';');
    btn.setAttribute('type', 'button');
    applyBaseStyles();
    btn.addEventListener('mouseenter', function () {
      btn.style.background = getPrimaryColor();
      btn.style.color = '#ffffff';
    });
    btn.addEventListener('mouseleave', function () {
      applyBaseStyles();
    });
    btn.addEventListener('click', function () {
      if (viewMode === 'masonry') {
        showAlbumView();
      } else {
        showMasonryView();
      }
    });
    return btn;
  }

  function updateToggleBtn() {
    if (!toggleBtn) return;
    if (viewMode === 'masonry') {
      if (toggleWrap) toggleWrap.style.display = 'flex';
      toggleBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="5" height="5" rx="0.5"/><rect x="1" y="8" width="5" height="7" rx="0.5"/><rect x="8" y="1" width="7" height="7" rx="0.5"/><rect x="8" y="10" width="7" height="5" rx="0.5"/></svg>';
      toggleBtn.setAttribute('aria-label', 'Switch to album view');
      toggleBtn.setAttribute('title', 'Albums');
      toggleBtn.style.display = '';
    } else if (viewMode === 'albums') {
      if (toggleWrap) toggleWrap.style.display = 'flex';
      toggleBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="14" height="4" rx="0.5"/><rect x="1" y="7" width="14" height="4" rx="0.5"/><rect x="1" y="13" width="14" height="2" rx="0.5"/></svg>';
      toggleBtn.setAttribute('aria-label', 'Switch to all photos view');
      toggleBtn.setAttribute('title', 'All Photos');
      toggleBtn.style.display = '';
    } else {
      // album-detail: hide toggle, back button is in the detail view
      if (toggleWrap) toggleWrap.style.display = 'none';
      toggleBtn.style.display = 'none';
    }
  }

  // ── Main init ──────────────────────────────────────────────────────────────
  function init() {
    container = document.getElementById('masonry-gallery');
    if (!container) return;

    container.style.position = 'relative';
    setContainerModeWidth('masonry');

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
      img.addEventListener('click', function () { openLB(i, allItems); });
      return {
        el: el,
        img: img,
        src:     el.dataset.src,
        fullSrc: el.dataset.fullSrc,
        w: +el.dataset.w,
        h: +el.dataset.h,
        index: i,
        x: 0, y: 0,
        meta: {
          title:       el.dataset.title || '',
          description: el.dataset.description || '',
          date:        el.dataset.date || '',
          location:    el.dataset.location || '',
          focalLength: el.dataset.focalLength || '',
          lens:        el.dataset.lens || '',
          iso:         el.dataset.iso || '',
          shutter:     el.dataset.shutter || '',
          albums:      el.dataset.albums ? el.dataset.albums.split(',') : [],
        },
      };
    });

    // Check if any items have albums before showing toggle
    var hasAlbums = allItems.some(function (item) { return item.meta.albums.length > 0; });

    if (hasAlbums) {
      toggleWrap = document.createElement('div');
      toggleWrap.style.cssText = [
        'width:100%',
        'max-width:' + GROUPED_MAX_WIDTH,
        'display:flex',
        'justify-content:flex-end',
        'position:sticky',
        'top:1rem',
        'z-index:50',
        'pointer-events:none',
        'margin:0 auto 1.5rem',
      ].join(';');
      toggleBtn = createToggleBtn();
      toggleWrap.appendChild(toggleBtn);
      container.parentNode.insertBefore(toggleWrap, container);
      updateToggleBtn();
    }

    window.addEventListener('popstate', function () {
      if (!hasAlbums) return;
      var params = new URLSearchParams(window.location.search);
      var albumParam = params.get('album');
      if (albumParam) {
        showAlbumDetail(albumParam);
      } else if (viewMode === 'album-detail') {
        // Browser back from detail should animate back to album overview.
        showAlbumViewFromDetail(true);
      }
    });

    // Check for ?album= query param
    var params = new URLSearchParams(window.location.search);
    var albumParam = params.get('album');
    if (albumParam && hasAlbums) {
      // Start in album detail view
      container.style.display = 'none';
      container.style.opacity = '0';
      showAlbumDetail(albumParam);

      // Still need to prep masonry items for lightbox
      allItems.forEach(function (item) {
        item.img.src = item.src;
        item.img.style.opacity = '1';
      });
      return;
    }

    // Normal masonry init
    var cols = getColCount();
    layoutMasonry(container, allItems, cols);
    var fullMasonryHeight = parseFloat(container.style.height) || 0;
    var loadOrder = sortByPosition(allItems);
    var unlockedCount = 0;
    var unlockedBottom = 0;
    var revealOrder = loadOrder.slice();
    var revealCursor = 0;

    allItems.forEach(function (item) {
      item._revealed = item.img.style.opacity === '1';
      item._readyToReveal = false;
      item._loadHandled = false;
      item._loading = false;
      item._observing = false;
    });

    function refreshRevealOrder() {
      revealOrder = sortByPosition(allItems);
      revealCursor = 0;
      while (revealCursor < revealOrder.length && revealOrder[revealCursor]._revealed) {
        revealCursor += 1;
      }
    }

    function drainRevealQueue() {
      var batch = [];
      while (revealCursor < revealOrder.length) {
        var item = revealOrder[revealCursor];
        if (item._revealed) {
          revealCursor += 1;
          continue;
        }
        if (!item._readyToReveal) break;
        batch.push(item);
        revealCursor += 1;
      }
      batch.forEach(function (item, i) {
        item._revealed = true;
        item.img.style.transitionDuration = FADE_DURATION + 'ms';
        item.img.style.transitionDelay = (i * STAGGER_MS) + 'ms';
        item.img.style.opacity = '1';
      });
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var item = allItems.find(function (it) { return it.el === entry.target; });
        if (!item || item._loading) return;
        item._loading = true;
        observer.unobserve(item.el);

        var markReady = function () {
          if (item._loadHandled) return;
          item._loadHandled = true;
          item._readyToReveal = true;
          drainRevealQueue();
        };
        item.img.onload = markReady;
        item.img.onerror = markReady;
        item.img.src = item.src;
        if (item.img.complete) {
          markReady();
        }
      });
    }, { rootMargin: '220px' });

    function getVisibleBottomInContainer() {
      var containerTop = container.getBoundingClientRect().top + window.scrollY;
      return (window.scrollY - containerTop) + window.innerHeight;
    }

    function applyUnlockedHeight() {
      if (unlockedCount >= loadOrder.length) {
        container.style.height = fullMasonryHeight + 'px';
        return;
      }
      var h = Math.max(0, Math.min(fullMasonryHeight, unlockedBottom));
      container.style.height = h + 'px';
    }

    function unlockNextBatch() {
      if (unlockedCount >= loadOrder.length) return false;
      var end = Math.min(loadOrder.length, unlockedCount + MASONRY_LOAD_BATCH_SIZE);
      for (var i = unlockedCount; i < end; i++) {
        var item = loadOrder[i];
        if (!item._observing) {
          observer.observe(item.el);
          item._observing = true;
        }
      }
      unlockedCount = end;
      var last = loadOrder[unlockedCount - 1];
      var lastBottom = (typeof last.bottom === 'number') ? last.bottom : (last.y + (parseFloat(last.el.style.height) || 0));
      unlockedBottom = Math.max(unlockedBottom, lastBottom + GAP);
      applyUnlockedHeight();
      return true;
    }

    function unlockToTargetBottom(targetBottom) {
      var requiredCount = unlockedCount;
      while (requiredCount < loadOrder.length && loadOrder[requiredCount].y <= targetBottom) {
        requiredCount += 1;
      }
      while (unlockedCount < requiredCount) {
        if (!unlockNextBatch()) break;
      }
    }

    function unlockToViewport() {
      unlockToTargetBottom(getVisibleBottomInContainer() + MASONRY_PRELOAD_PX);
    }

    unlockToViewport();

    window.addEventListener('scroll', function () {
      if (viewMode !== 'masonry') return;
      unlockToTargetBottom(getVisibleBottomInContainer() + MASONRY_PRELOAD_PX);
    }, { passive: true });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (viewMode === 'masonry') {
          cols = getColCount();
          layoutMasonry(container, allItems, cols);
          fullMasonryHeight = parseFloat(container.style.height) || fullMasonryHeight;
          loadOrder = sortByPosition(allItems);
          refreshRevealOrder();
          unlockedCount = 0;
          unlockedBottom = 0;
          observer.disconnect();
          allItems.forEach(function (item) { item._observing = false; });
          unlockToViewport();
        } else if (viewMode === 'albums') {
          clearAlbumOverlays();
          container.style.transition = '';
          var layout = computeAlbumLayout();
          container.style.height = layout.totalHeight + 'px';
          allItems.forEach(function (item) {
            var primaryAlbum = layout.itemPrimaryAlbum[item.index];
            if (primaryAlbum) {
              var row = layout.rows.find(function (r) { return r.name === primaryAlbum; });
              var fanTarget = row && row.fanTargets[item.index];
              if (fanTarget) {
                item.el.style.left = fanTarget.x + 'px';
                item.el.style.top = fanTarget.y + 'px';
                item.el.style.width = fanTarget.w + 'px';
                item.el.style.height = fanTarget.h + 'px';
                item.el.style.opacity = fanTarget.visible ? '1' : '0';
                item.el.style.zIndex = fanTarget.visible ? '3' : '1';
              }
            }
          });
          addAlbumOverlays(layout);
        }
      }, 150);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
