(function () {
  'use strict';

  var GAP = 12;
  var FADE_DURATION = 2000;
  var STAGGER_MS = 200;
  var BATCH_WAIT_MS = 50;
  var ALBUM_PREVIEW_COUNT = 5;
  var ALBUM_THUMB_HEIGHT = 180;
  var ANIM_DURATION = 800;

  // ── Responsive column count ────────────────────────────────────────────────
  function getColCount() {
    var w = window.innerWidth;
    if (w < 640) return 1;
    if (w < 768) return 2;
    if (w < 1024) return 3;
    if (w < 1280) return 4;
    return 5;
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
    });

    container.style.height = Math.max.apply(null, colHeights) + 'px';
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
    document.body.appendChild(overlay);

    // Zoom / pan state
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

    overlay.addEventListener('wheel', function (e) {
      e.preventDefault();
      scale = Math.min(8, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      if (scale === 1) { tx = 0; ty = 0; }
      applyXform(false);
    }, { passive: false });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target === imgWrap) {
        if (scale > 1) reset(); else closeLB();
      }
    });

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

    lbImg = img;
    lbReset = reset;
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
    if (e.key === 'ArrowRight') navigate(1);
    else if (e.key === 'ArrowLeft') navigate(-1);
    else if (e.key === 'Escape') closeLB();
  });

  // ── Album grouping ──────────────────────────────────────────────────────
  var allItems = [];
  var viewMode = 'masonry'; // 'masonry' | 'albums' | 'album-detail'
  var albumViewEl = null;
  var albumDetailEl = null;
  var container = null;
  var toggleBtn = null;

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

  // Compute album layout: cluster points, fan-out targets, row positions
  function computeAlbumLayout() {
    var albums = getAlbums();
    var names = Object.keys(albums).sort();
    var containerWidth = container.offsetWidth;
    var rowH = ALBUM_THUMB_HEIGHT;
    var rowGap = GAP * 2;

    // Map each item to its primary album (first alphabetically)
    var itemPrimaryAlbum = {};
    allItems.forEach(function (item) {
      if (item.meta.albums.length > 0) {
        var sorted = item.meta.albums.slice().sort();
        itemPrimaryAlbum[item.index] = sorted[0];
      }
    });

    var rows = []; // { name, items, y, clusterX, clusterY, fanTargets[] }
    var currentY = 0;

    names.forEach(function (name) {
      var items = albums[name];
      var rowCenterX = containerWidth * 0.25; // cluster toward left-center
      var clusterY = currentY + rowH / 2;

      var fanTargets = {}; // keyed by item.index
      var x = 0;
      items.forEach(function (item, posInAlbum) {
        if (itemPrimaryAlbum[item.index] !== name) return;
        if (posInAlbum < ALBUM_PREVIEW_COUNT) {
          var thumbW = Math.round((item.w / item.h) * rowH);
          fanTargets[item.index] = {
            x: x, y: currentY, w: thumbW, h: rowH,
            visible: true, opacity: 1, rotation: 0,
          };
          x += thumbW + GAP;
        } else {
          fanTargets[item.index] = {
            x: containerWidth + 50, y: currentY,
            w: Math.round((item.w / item.h) * rowH), h: rowH,
            visible: false, opacity: 0, rotation: 0,
          };
        }
      });

      rows.push({
        name: name, items: items, y: currentY, h: rowH,
        clusterX: rowCenterX, clusterY: clusterY,
        fanTargets: fanTargets,
        count: items.length,
      });

      currentY += rowH + rowGap;
    });

    // Items with no album: fade out
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

    return { rows: rows, orphanTargets: orphanTargets, totalHeight: currentY, itemPrimaryAlbum: itemPrimaryAlbum };
  }

  function addAlbumOverlays(layout) {
    var primary = getPrimaryColor();
    var pageBg = getPageBgColor();

    layout.rows.forEach(function (row) {
      // Calculate total width of visible thumbnails
      var totalW = 0;
      var items = row.items;
      for (var i = 0; i < Math.min(ALBUM_PREVIEW_COUNT, items.length); i++) {
        totalW += Math.round((items[i].w / items[i].h) * row.h);
        if (i > 0) totalW += GAP;
      }

      // Gradient overlay — spans the thumbnail area
      var gradient = document.createElement('div');
      gradient.style.cssText = [
        'position:absolute',
        'left:0', 'top:' + row.y + 'px',
        'width:' + totalW + 'px', 'height:' + row.h + 'px',
        'background:linear-gradient(to right, transparent 0%, transparent 30%, ' + pageBg + ' 100%)',
        'z-index:4', 'pointer-events:none',
        'opacity:0', 'transition:opacity 0.5s ease',
      ].join(';');
      container.appendChild(gradient);
      albumOverlays.push(gradient);

      // Label
      var label = document.createElement('div');
      label.style.cssText = [
        'position:absolute',
        'left:0', 'top:' + (row.y + row.h - 40) + 'px',
        'width:' + totalW + 'px', 'height:40px',
        'padding:0 1.25rem', 'box-sizing:border-box',
        'display:flex', 'align-items:center',
        'z-index:5', 'color:white',
        'font-size:1.1rem', 'font-weight:600',
        'background:linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
        'opacity:0', 'transform:translateY(10px)',
        'transition:opacity 0.5s ease, transform 0.5s ease',
        'pointer-events:none',
      ].join(';');
      label.textContent = row.name;
      var countSpan = document.createElement('span');
      countSpan.style.cssText = 'font-weight:400;font-size:0.85rem;opacity:0.6;margin-left:0.5rem;';
      countSpan.textContent = row.count + ' photos';
      label.appendChild(countSpan);
      container.appendChild(label);
      albumOverlays.push(label);

      // Click target (invisible, covers the row)
      var clickTarget = document.createElement('a');
      clickTarget.href = window.location.pathname + '?album=' + encodeURIComponent(row.name);
      clickTarget.style.cssText = [
        'position:absolute',
        'left:0', 'top:' + row.y + 'px',
        'width:' + totalW + 'px', 'height:' + row.h + 'px',
        'z-index:6', 'border-radius:0.5rem',
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
      container.appendChild(clickTarget);
      albumOverlays.push(clickTarget);
    });

    // Trigger the fade-in after a frame
    requestAnimationFrame(function () {
      albumOverlays.forEach(function (el) {
        if (el.style.opacity === '0') {
          el.style.opacity = '1';
          if (el.style.transform) el.style.transform = 'translateY(0)';
        }
      });
    });
  }

  // ── Masonry → Album animation (cluster then fan-out) ──────────────────
  function showAlbumView() {
    if (viewMode === 'albums') return;
    viewMode = 'albums';
    updateToggleBtn();

    var layout = computeAlbumLayout();
    var half = Math.round(ANIM_DURATION / 2);
    var halfS = half + 'ms';
    var fullS = ANIM_DURATION + 'ms';

    // Assign random rotations for the cluster phase
    var rotations = {};
    allItems.forEach(function (item) {
      rotations[item.index] = (Math.random() - 0.5) * 12; // -6 to +6 degrees
    });

    // Phase 1: Cluster — all items animate to their album's cluster point
    container.style.transition = 'height ' + fullS + ' ease-in-out';
    container.style.height = layout.totalHeight + 'px';

    allItems.forEach(function (item) {
      var primaryAlbum = layout.itemPrimaryAlbum[item.index];
      var rot = rotations[item.index];

      if (primaryAlbum) {
        // Find the row for this item
        var row = layout.rows.find(function (r) { return r.name === primaryAlbum; });
        if (row) {
          var thumbW = Math.round((item.w / item.h) * row.h);
          item.el.style.transition = 'left ' + halfS + ' ease-in, top ' + halfS + ' ease-in, width ' + halfS + ' ease-in, height ' + halfS + ' ease-in, transform ' + halfS + ' ease-in';
          item.el.style.left = (row.clusterX - thumbW / 2) + 'px';
          item.el.style.top = row.y + 'px';
          item.el.style.width = thumbW + 'px';
          item.el.style.height = row.h + 'px';
          item.el.style.transform = 'rotate(' + rot + 'deg)';
          item.el.style.zIndex = String(ALBUM_PREVIEW_COUNT - (layout.rows.indexOf(row)));
        }
      } else {
        // Orphan: fade out and slide right
        var ot = layout.orphanTargets[item.index];
        item.el.style.transition = 'left ' + halfS + ' ease-in, top ' + halfS + ' ease-in, opacity ' + halfS + ' ease-in';
        item.el.style.left = ot.x + 'px';
        item.el.style.opacity = '0';
      }
    });

    // Phase 2: Fan-out — after cluster completes
    setTimeout(function () {
      allItems.forEach(function (item) {
        var primaryAlbum = layout.itemPrimaryAlbum[item.index];
        if (!primaryAlbum) return;

        var row = layout.rows.find(function (r) { return r.name === primaryAlbum; });
        if (!row) return;

        var fanTarget = row.fanTargets[item.index];
        if (!fanTarget) return;

        item.el.style.transition = 'left ' + halfS + ' ease-out, top ' + halfS + ' ease-out, width ' + halfS + ' ease-out, height ' + halfS + ' ease-out, transform ' + halfS + ' ease-out, opacity ' + halfS + ' ease-out';
        item.el.style.left = fanTarget.x + 'px';
        item.el.style.top = fanTarget.y + 'px';
        item.el.style.width = fanTarget.w + 'px';
        item.el.style.height = fanTarget.h + 'px';
        item.el.style.transform = 'rotate(0deg)';
        if (!fanTarget.visible) {
          item.el.style.opacity = '0';
        }
      });
    }, half);

    // Phase 3: Add overlays (labels, gradients, click targets) after fan-out
    setTimeout(function () {
      allItems.forEach(function (item) {
        item.el.style.transition = '';
        item.el.style.zIndex = '';
      });
      container.style.transition = '';
      addAlbumOverlays(layout);
    }, ANIM_DURATION + 50);
  }

  // ── Album → Masonry animation ─────────────────────────────────────────
  function showMasonryView() {
    if (viewMode === 'masonry') return;
    viewMode = 'masonry';

    // Remove overlays immediately
    clearAlbumOverlays();

    // Restore hidden items and animate all to masonry positions
    allItems.forEach(function (item) {
      item.el.style.opacity = '';
      item.img.style.opacity = '1';
    });

    var cols = getColCount();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var dur = ANIM_DURATION + 'ms';
        allItems.forEach(function (item) {
          item.el.style.transition = 'left ' + dur + ' ease-in-out, top ' + dur + ' ease-in-out, width ' + dur + ' ease-in-out, height ' + dur + ' ease-in-out, transform ' + dur + ' ease-in-out';
          item.el.style.transform = '';
        });
        container.style.transition = 'height ' + dur + ' ease-in-out';
        layoutMasonry(container, allItems, cols);

        setTimeout(function () {
          allItems.forEach(function (item) {
            item.el.style.transition = '';
          });
          container.style.transition = '';
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

  function showAlbumDetail(albumName) {
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

    setTimeout(function () {
      if (albumDetailEl) albumDetailEl.remove();
      albumDetailEl = buildAlbumDetailView(albumName, items);
      container.parentNode.insertBefore(albumDetailEl, container.nextSibling);
      requestAnimationFrame(function () {
        albumDetailEl.style.opacity = '1';
      });
    }, 300);

    updateToggleBtn();
  }

  function showAlbumViewFromDetail() {
    viewMode = 'albums';

    if (albumDetailEl) {
      albumDetailEl.style.transition = 'opacity 0.3s ease';
      albumDetailEl.style.opacity = '0';
      var el = albumDetailEl;
      setTimeout(function () { el.remove(); }, 300);
      albumDetailEl = null;
    }

    setTimeout(function () {
      if (albumViewEl) albumViewEl.remove();
      albumViewEl = buildAlbumView();
      container.parentNode.insertBefore(albumViewEl, container.nextSibling);
      requestAnimationFrame(function () {
        albumViewEl.style.opacity = '1';
      });
    }, 300);

    if (window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    updateToggleBtn();
  }

  // ── Toggle button ──────────────────────────────────────────────────────
  function createToggleBtn() {
    var btn = document.createElement('button');
    btn.style.cssText = [
      'display:flex', 'align-items:center', 'gap:0.5rem',
      'margin:0 auto 1.5rem', 'padding:0.5rem 1.25rem',
      'background:rgba(255,255,255,0.08)', 'border:1px solid rgba(255,255,255,0.15)',
      'color:rgba(255,255,255,0.8)', 'border-radius:0.5rem',
      'cursor:pointer', 'font-size:0.85rem',
      'transition:background 0.2s,border-color 0.2s',
    ].join(';');
    btn.addEventListener('mouseenter', function () {
      btn.style.background = 'rgba(255,255,255,0.12)';
      btn.style.borderColor = 'rgba(255,255,255,0.25)';
    });
    btn.addEventListener('mouseleave', function () {
      btn.style.background = 'rgba(255,255,255,0.08)';
      btn.style.borderColor = 'rgba(255,255,255,0.15)';
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
      toggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="5" height="5" rx="0.5"/><rect x="1" y="8" width="5" height="7" rx="0.5"/><rect x="8" y="1" width="7" height="7" rx="0.5"/><rect x="8" y="10" width="7" height="5" rx="0.5"/></svg> Albums';
      toggleBtn.style.display = '';
    } else if (viewMode === 'albums') {
      toggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="14" height="4" rx="0.5"/><rect x="1" y="7" width="14" height="4" rx="0.5"/><rect x="1" y="13" width="14" height="2" rx="0.5"/></svg> All Photos';
      toggleBtn.style.display = '';
    } else {
      // album-detail: hide toggle, back button is in the detail view
      toggleBtn.style.display = 'none';
    }
  }

  // ── Main init ──────────────────────────────────────────────────────────────
  function init() {
    container = document.getElementById('masonry-gallery');
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
      toggleBtn = createToggleBtn();
      container.parentNode.insertBefore(toggleBtn, container);
      updateToggleBtn();
    }

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
          item.img.style.opacity = '1';
        };
      });
    }, { rootMargin: '300px' });

    allItems.forEach(function (item) { observer.observe(item.el); });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (viewMode === 'masonry') {
          cols = getColCount();
          layoutMasonry(container, allItems, cols);
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
