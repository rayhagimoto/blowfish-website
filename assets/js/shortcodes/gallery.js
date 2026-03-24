(function () {
  'use strict';

  var GAP = 12;
  var FADE_DURATION = 2000;
  var STAGGER_MS = 200;
  var BATCH_WAIT_MS = 50;
  var ALBUM_MIN_THUMB_HEIGHT = 120;
  var ALBUM_PREVIEW_THUMB_HEIGHT = 300;
  var ANIM_DURATION = 800;
  var ALBUM_TEXT_START_DELAY_MS = 0;
  var ALBUM_OVERLAY_ANIM_MS = 800;
  var ALBUM_OVERLAY_LEAD_MS = 400;
  var MASONRY_LOAD_BATCH_SIZE = 6;
  var MASONRY_PRELOAD_PX = 180;
  var MASONRY_UNLOCK_TRIGGER_PX = 180;
  var LB_RAPID_NAV_MS = 135;
  var LB_FOCUS_SETTLE_MS = 200;
  var LB_FULL_IDLE_MS = 1200;
  var LB_OPEN_FROM_THUMB_MS = 420;
  var LB_SWIPE_COMMIT_RATIO = 0.12;
  var LB_TIER_NONE = 0;
  var LB_TIER_SMALL = 1;
  var LB_TIER_MEDIUM = 2;
  var LB_TIER_FIT = 3;
  var LB_TIER_FULL = 4;

  // ── Responsive column count ────────────────────────────────────────────────
  function getColCount() {
    var w = window.innerWidth;
    if (w < 640) return 2;
    if (w < 768) return 2;
    if (w < 1024) return 3;
    if (w < 1280) return 4;
    return 5;
  }

  function getAlbumPreviewCount() {
    var w = window.innerWidth;
    if (w < 768) return 2;
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
  var currentLBItems = [];
  var lbLoadToken = 0;
  var lbTierToken = 0;
  var lbSettleTimer = null;
  var lbFullIdleTimer = null;
  var lbLastNavAt = 0;
  var lbFocusFromZoom = false;
  var lbSwipeCommitted = false;
  var lbOverlayImg = null;
  var lbMetaTitle = null;
  var lbMetaDesc = null;
  var lbMetaDetails = null;
  var lbDisplayedTier = LB_TIER_NONE;

  function isMobileLightboxViewport() {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches
      || navigator.maxTouchPoints > 0;
  }

  function normalizeLbUrl(url) {
    return (url || '').split('?')[0];
  }

  function getPreviewTierMap(item) {
    var mediumPixels = (item && item.lightboxMediumW > 0 && item.lightboxMediumH > 0)
      ? (item.lightboxMediumW * item.lightboxMediumH)
      : ((item && item.mediumW > 0 && item.mediumH > 0) ? (item.mediumW * item.mediumH) : 0);
    var fitPixels = (item && item.lightboxFitW > 0 && item.lightboxFitH > 0) ? (item.lightboxFitW * item.lightboxFitH) : 0;
    var fitIsHighest = fitPixels >= mediumPixels;
    return {
      medium: fitIsHighest ? LB_TIER_MEDIUM : LB_TIER_FIT,
      fit: fitIsHighest ? LB_TIER_FIT : LB_TIER_MEDIUM,
    };
  }

  function getLbTierForUrl(item, url) {
    var nUrl = normalizeLbUrl(url);
    if (!item || !nUrl) return LB_TIER_NONE;
    if (normalizeLbUrl(item.fullSrc) === nUrl) return LB_TIER_FULL;
    if (normalizeLbUrl(item.src) === nUrl) return LB_TIER_SMALL;
    var previewTiers = getPreviewTierMap(item);
    if (normalizeLbUrl(item.lightboxMediumSrc) === nUrl) return previewTiers.medium;
    if (normalizeLbUrl(item.mediumSrc) === nUrl) return previewTiers.medium;
    if (normalizeLbUrl(item.lightboxFitSrc) === nUrl) return previewTiers.fit;
    return LB_TIER_NONE;
  }

  function setLbLogicalSrcForTier(item, tier) {
    if (!lbImg) return;
    if (tier >= LB_TIER_FULL) {
      lbImg.dataset.logicalSrc = 'full';
      return;
    }
    if (tier <= LB_TIER_SMALL) {
      lbImg.dataset.logicalSrc = 'small';
      return;
    }
    var previewTiers = getPreviewTierMap(item);
    if (tier === previewTiers.fit) {
      lbImg.dataset.logicalSrc = 'fit';
      return;
    }
    lbImg.dataset.logicalSrc = 'medium';
  }
  var pageScrollLock = null;

  function lockPageScrollForLightbox() {
    if (pageScrollLock) return;
    var scrollY = window.scrollY || window.pageYOffset || 0;
    var bodyStyle = document.body.style;
    pageScrollLock = {
      scrollY: scrollY,
      bodyOverflow: bodyStyle.overflow,
      bodyPosition: bodyStyle.position,
      bodyTop: bodyStyle.top,
      bodyWidth: bodyStyle.width,
      bodyTouchAction: bodyStyle.touchAction,
    };
    bodyStyle.overflow = 'hidden';
    bodyStyle.position = 'fixed';
    bodyStyle.top = '-' + scrollY + 'px';
    bodyStyle.width = '100%';
    bodyStyle.touchAction = 'none';
  }

  function unlockPageScrollForLightbox() {
    if (!pageScrollLock) return;
    var lock = pageScrollLock;
    pageScrollLock = null;
    var bodyStyle = document.body.style;
    bodyStyle.overflow = lock.bodyOverflow || '';
    bodyStyle.position = lock.bodyPosition || '';
    bodyStyle.top = lock.bodyTop || '';
    bodyStyle.width = lock.bodyWidth || '';
    bodyStyle.touchAction = lock.bodyTouchAction || '';
    window.scrollTo(0, lock.scrollY || 0);
  }

  function getLightboxPreviewSrc(item) {
    if (!item) return '';
    return item.lightboxFitSrc
      || item.lightboxMediumSrc
      || item.lightboxSmallSrc
      || item.mediumSrc
      || item.src
      || item.fullSrc
      || '';
  }

  function wrapLbIndex(i) {
    var n = currentLBItems.length;
    if (!n) return 0;
    return (i + n) % n;
  }

  function clearLbSchedulers() {
    clearTimeout(lbSettleTimer);
    clearTimeout(lbFullIdleTimer);
    lbSettleTimer = null;
    lbFullIdleTimer = null;
  }

  function prefetchAroundIndex(index) {
    if (!currentLBItems.length) return;
    var n = currentLBItems.length;
    function pre(url) {
      if (!url) return;
      var im = new Image();
      im.src = url;
    }
    [1, 2, 3, 4, 5, -1, -2, -3, -4, -5].forEach(function (d) {
      var it = currentLBItems[wrapLbIndex(index + d)];
      if (!it) return;
      pre(it.lightboxSmallSrc || it.src);
    });
    [-1, 1].forEach(function (d) {
      var it = currentLBItems[wrapLbIndex(index + d)];
      if (!it) return;
      pre(it.lightboxMediumSrc || it.mediumSrc);
      pre(it.lightboxFitSrc);
    });
  }

  function prefetchNeighborFullOnZoom(index) {
    [-1, 1].forEach(function (d) {
      var it = currentLBItems[wrapLbIndex(index + d)];
      if (it && it.fullSrc) {
        var im = new Image();
        im.src = it.fullSrc;
      }
    });
  }

  var lbCrossfadeImpl = null;
  var lbPromoteFullImpl = null;

  function promoteCurrentToFull(reason) {
    if (typeof lbPromoteFullImpl === 'function') lbPromoteFullImpl(reason);
  }

  function buildLightbox() {
    var prefersTouchInput = isMobileLightboxViewport();
    var useTouchMode = null;
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
      'position:relative', 'overflow:hidden',
    ].join(';');

    var lbCarousel = document.createElement('div');
    lbCarousel.style.cssText = [
      'flex:1', 'min-height:0', 'width:100%',
      'position:relative', 'overflow:hidden',
      'display:flex', 'align-items:center', 'justify-content:center',
      'touch-action:none',
    ].join(';');

    var lbTrack = document.createElement('div');
    lbTrack.style.cssText = [
      'display:flex', 'flex-direction:row',
      'height:100%', 'align-items:center', 'will-change:transform',
    ].join(';');

    function makeSlot() {
      var slot = document.createElement('div');
      slot.style.cssText = [
        'flex:0 0 auto', 'height:100%',
        'display:flex', 'align-items:center', 'justify-content:center',
        'box-sizing:border-box',
      ].join(';');
      return slot;
    }

    var slotPrev = makeSlot();
    var slotCur = makeSlot();
    var slotNext = makeSlot();

    var imgPrev = document.createElement('img');
    var imgNext = document.createElement('img');
    [imgPrev, imgNext].forEach(function (im) {
      im.style.cssText = [
        'max-width:90vw', 'max-height:calc(90vh - 80px)',
        'object-fit:contain', 'user-select:none', 'pointer-events:none',
      ].join(';');
      im.draggable = false;
    });

    var lbStack = document.createElement('div');
    lbStack.style.cssText = [
      'position:relative',
      'width:90vw', 'height:calc(90vh - 80px)',
      'display:inline-block',
      'margin:0 auto',
      'transform-origin:center',
    ].join(';');

    var lbBase = document.createElement('img');
    var lbOverlay = document.createElement('img');
    lbBase.style.cssText = [
      'display:block', 'width:100%', 'height:100%',
      'object-fit:contain', 'object-position:center center',
      'user-select:none', 'pointer-events:none',
    ].join(';');
    lbOverlay.style.cssText = [
      'position:absolute', 'left:0', 'top:0',
      'width:100%', 'height:100%',
      'object-fit:contain', 'object-position:center center', 'opacity:0',
      'pointer-events:none', 'transition:opacity 0.22s ease',
    ].join(';');
    lbBase.draggable = false;
    lbOverlay.draggable = false;

    lbStack.appendChild(lbBase);
    lbStack.appendChild(lbOverlay);
    slotPrev.appendChild(imgPrev);
    slotCur.appendChild(lbStack);
    slotNext.appendChild(imgNext);
    lbTrack.appendChild(slotPrev);
    lbTrack.appendChild(slotCur);
    lbTrack.appendChild(slotNext);
    lbCarousel.appendChild(lbTrack);
    imgWrap.appendChild(lbCarousel);

    var slotW = 0;
    var swipeOffset = 0;
    var swipeActive = false;
    var swipeStartX = 0;
    var swipeStartOff = 0;
    var swipeSuppressClick = false;

    function setTrackOffset(px, animated) {
      lbTrack.style.transition = animated ? 'transform 0.28s cubic-bezier(0.22,1,0.36,1)' : 'none';
      lbTrack.style.transform = 'translateX(' + px + 'px)';
    }

    function syncCarouselWidths() {
      slotW = lbCarousel.clientWidth || window.innerWidth;
      [slotPrev, slotCur, slotNext].forEach(function (s) {
        s.style.width = slotW + 'px';
        s.style.flexBasis = slotW + 'px';
      });
      lbTrack.style.width = slotW * 3 + 'px';
      setTrackOffset(-slotW + swipeOffset, false);
    }

    function syncStackFrameForItem(item) {
      if (!item) return;
      var maxW = window.innerWidth * 0.9;
      var maxH = (window.innerHeight * 0.9) - 80;
      var srcW = item.fitW || item.lightboxFitW || item.w || 1;
      var srcH = item.fitH || item.lightboxFitH || item.h || 1;
      if (!srcW || !srcH) return;
      var fitScale = Math.min(maxW / srcW, maxH / srcH);
      fitScale = Math.min(1, Math.max(fitScale, 0.0001));
      lbStack.style.width = Math.max(1, Math.round(srcW * fitScale)) + 'px';
      lbStack.style.height = Math.max(1, Math.round(srcH * fitScale)) + 'px';
    }

    var help = document.createElement('div');
    help.style.cssText = [
      'position:absolute',
      'right:1.5rem', 'bottom:5.5rem',
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
    var leftClickIcon = '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSJjdXJyZW50Q29sb3IiIGQ9Ik0xMyA5VjEuMDdBOC4wMSA4LjAxIDAgMCAxIDE5Ljc1IDdjLjE2LjY0LjI1IDEuMzEuMjUgMnptNC42Ni0yYy0uNDgtMS4zNS0xLjQzLTIuNS0yLjY2LTMuMTlWN3pNNiAxNXYtMmgxMnYyYzAgMS41OS0uNjMgMy4xMi0xLjc2IDQuMjRBNS45NyA1Ljk3IDAgMCAxIDEyIDIxYTUuOTcgNS45NyAwIDAgMS00LjI0LTEuNzZBNS45NyA1Ljk3IDAgMCAxIDYgMTVtLTIgMGMwIDIuMTIuODQgNC4xNiAyLjM0IDUuNjZTOS44OCAyMyAxMiAyM3M0LjE2LS44NCA1LjY2LTIuMzRTMjAgMTcuMTIgMjAgMTV2LTRINHptNy02VjEuMDdDNy4wNiAxLjU2IDQgNC45MiA0IDl6Ii8+PC9zdmc+" alt="" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-right:0.2rem;width:12px;height:12px;filter:brightness(0) invert(1)"/>';
    var scrollIcon = '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSJjdXJyZW50Q29sb3IiIGQ9Ik0xMSAxLjA3QzcuMDUgMS41NiA0IDQuOTIgNCA5aDdWNy43M2MtLjYtLjM0LTEtLjk5LTEtMS43M1Y0YzAtLjc0LjQtMS4zOSAxLTEuNzN6TTEzIDlWNy43M2MuNi0uMzQgMS0uOTkgMS0xLjczVjRjMC0uNzQtLjQtMS4zOS0xLTEuNzN2LTEuMmMzLjk0LjQ5IDcgMy44NSA3IDcuOTN6bS05IDZjMCAyLjEyLjg0IDQuMTYgMi4zNCA1LjY2UzkuODggMjMgMTIgMjNzNC4xNi0uODQgNS42Ni0yLjM0UzIwIDE3LjEyIDIwIDE1di00SDR6bTktOVY0YzAtLjU1LS40NS0xLTEtMXMtMSAuNDUtMSAxdjJjMCAuNTUuNDUgMSAxIDFzMS0uNDUgMS0xIi8+PC9zdmc+" alt="" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-right:0.2rem;width:12px;height:12px;filter:brightness(0) invert(1)"/>';
    help.innerHTML = [
      '<div>Z toggle fit</div>',
      '<div>' + scrollIcon + 'zoom +/- 5%</div>',
      '<div>' + leftClickIcon + 'hold + drag pan</div>',
    ].join('');

    var metaPanel = document.createElement('div');
    metaPanel.style.cssText = [
      'position:absolute', 'left:0', 'right:0', 'bottom:0',
      'padding:0.75rem 1.5rem 1.25rem',
      'box-sizing:border-box',
      'text-align:left', 'pointer-events:none',
      'z-index:2',
      'opacity:1', 'transition:opacity 0.25s ease',
      'background:linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.35) 55%, transparent 100%)',
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
    overlay.appendChild(metaPanel);

    function makeBtn(html, posCSS) {
      var b = document.createElement('button');
      b.innerHTML = html;
      b.style.cssText = [
        'position:absolute', posCSS,
        'background:rgba(255,255,255,0.1)', 'border:none', 'color:white',
        'cursor:pointer', 'border-radius:0.5rem',
        'transition:opacity 0.2s,background 0.2s',
        'opacity:0.7', 'z-index:4',
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
    var miniMap = document.createElement('div');
    miniMap.style.cssText = [
      'position:absolute',
      'top:1.25rem', 'right:5.5rem',
      'width:176px', 'height:110px',
      'border:2px solid rgba(255,255,255,0.95)',
      'border-radius:0.4rem',
      'background:rgba(0,0,0,0.7)',
      'overflow:hidden',
      'z-index:2',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity 0.18s ease',
    ].join(';');
    var miniImg = document.createElement('img');
    miniImg.style.cssText = [
      'position:absolute', 'inset:0',
      'width:100%', 'height:100%',
      'object-fit:contain',
      'user-select:none',
    ].join(';');
    var miniViewport = document.createElement('div');
    miniViewport.style.cssText = [
      'position:absolute',
      'border:2px solid rgba(255,255,255,0.95)',
      'box-sizing:border-box',
      'background:rgba(255,255,255,0.06)',
      'box-shadow:0 0 0 1px rgba(0,0,0,0.45) inset',
    ].join(';');
    miniMap.appendChild(miniImg);
    miniMap.appendChild(miniViewport);

    overlay.appendChild(imgWrap);
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    overlay.appendChild(closeBtn);
    overlay.appendChild(help);
    overlay.appendChild(miniMap);
    document.body.appendChild(overlay);

    var scale = 1, tx = 0, ty = 0;
    var fitMode = true;
    var dragging = false, dragX = 0, dragY = 0, startTx = 0, startTy = 0;
    var dragMoved = false;
    var pinchDist = null;
    var swiped = false;
    var suppressImageTap = false;
    var pinchStartScale = 1;
    var pinchStartTx = 0, pinchStartTy = 0;
    var helpTimer = null;
    var miniTimer = null;
    var mobileChromeTimer = null;
    var swipeStartY = 0;
    var swipeIntent = null;
    var pullOffsetY = 0;

    function setMobileChromeVisible(visible, autoHide) {
      if (!useTouchMode) {
        closeBtn.style.opacity = '0.7';
        closeBtn.style.pointerEvents = 'auto';
        metaPanel.style.opacity = '1';
        return;
      }
      clearTimeout(mobileChromeTimer);
      closeBtn.style.opacity = visible ? '1' : '0';
      closeBtn.style.pointerEvents = visible ? 'auto' : 'none';
      metaPanel.style.opacity = visible ? '1' : '0';
      if (visible && autoHide) {
        mobileChromeTimer = setTimeout(function () {
          if (!useTouchMode) return;
          setMobileChromeVisible(false, false);
        }, 1800);
      }
    }

    function noteMobileInteraction() {
      if (!useTouchMode) return;
      setMobileChromeVisible(true, true);
    }

    function setInteractionMode(nextTouchMode) {
      nextTouchMode = !!nextTouchMode;
      if (useTouchMode === nextTouchMode) return;
      useTouchMode = nextTouchMode;
      dragging = false;
      dragMoved = false;
      swiped = false;
      pinchDist = null;
      suppressImageTap = false;
      prevBtn.style.display = useTouchMode ? 'none' : '';
      nextBtn.style.display = useTouchMode ? 'none' : '';
      closeBtn.style.display = '';
      help.style.display = useTouchMode ? 'none' : '';
      miniMap.style.display = useTouchMode ? 'none' : '';
      if (useTouchMode) {
        clearTimeout(helpTimer);
        clearTimeout(miniTimer);
        clearTimeout(mobileChromeTimer);
        help.style.opacity = '0';
        help.style.transform = 'translateY(6px)';
        miniMap.style.opacity = '0';
        setMobileChromeVisible(true, true);
      } else {
        clearTimeout(mobileChromeTimer);
        setMobileChromeVisible(true, false);
      }
      updateInteractionCursor();
    }

    function updateSideSlotVisibility() {
      var hide = scale > 1 || !fitMode;
      imgPrev.style.opacity = hide ? '0' : '1';
      imgNext.style.opacity = hide ? '0' : '1';
    }

    function updateInteractionCursor() {
      if (dragging) {
        lbStack.style.cursor = 'grabbing';
        return;
      }
      lbStack.style.cursor = (scale > 1) ? 'grab' : 'default';
    }

    function showHelp() {
      if (useTouchMode) return;
      clearTimeout(helpTimer);
      help.style.opacity = '1';
      help.style.transform = 'translateY(0)';
      helpTimer = setTimeout(function () {
        help.style.opacity = '0';
        help.style.transform = 'translateY(6px)';
      }, 2200);
    }

    function getDisplayedRect(containerW, containerH, sourceW, sourceH) {
      if (!containerW || !containerH || !sourceW || !sourceH) {
        return { x: 0, y: 0, w: 0, h: 0 };
      }
      var containerRatio = containerW / containerH;
      var sourceRatio = sourceW / sourceH;
      var outW = 0;
      var outH = 0;
      var outX = 0;
      var outY = 0;
      if (sourceRatio > containerRatio) {
        outW = containerW;
        outH = outW / sourceRatio;
        outY = (containerH - outH) / 2;
      } else {
        outH = containerH;
        outW = outH * sourceRatio;
        outX = (containerW - outW) / 2;
      }
      return { x: outX, y: outY, w: outW, h: outH };
    }

    function showMiniMap() {
      if (useTouchMode) return;
      clearTimeout(miniTimer);
      miniMap.style.opacity = '1';
    }

    function hideMiniMapSoon() {
      if (useTouchMode) return;
      clearTimeout(miniTimer);
      miniTimer = setTimeout(function () {
        if (!dragging) miniMap.style.opacity = '0';
      }, 900);
    }

    function applyXform(animated) {
      lbStack.style.transition = animated ? 'transform 0.2s ease' : 'none';
      lbStack.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      updateMiniMap();
      updateInteractionCursor();
      updateSideSlotVisibility();
    }

    function getFitScale() {
      if (!lbBase.naturalWidth || !lbBase.naturalHeight) return 1;
      var maxW = window.innerWidth * 0.9;
      var maxH = (window.innerHeight * 0.9) - 80;
      var sx = maxW / lbBase.naturalWidth;
      var sy = maxH / lbBase.naturalHeight;
      return Math.min(1, sx, sy);
    }

    function updateMiniMap() {
      if (useTouchMode || !lbBase.naturalWidth || !lbBase.naturalHeight) return;
      var mapW = miniMap.clientWidth;
      var mapH = miniMap.clientHeight;
      var mapRect = getDisplayedRect(mapW, mapH, lbBase.naturalWidth, lbBase.naturalHeight);

      var fitScale = getFitScale();
      var baseW = lbBase.naturalWidth * fitScale;
      var baseH = lbBase.naturalHeight * fitScale;
      var transformedW = baseW * scale;
      var transformedH = baseH * scale;
      var viewportW = lbCarousel.clientWidth;
      var viewportH = lbCarousel.clientHeight;
      if (!transformedW || !transformedH || !viewportW || !viewportH) return;

      var imgLeft = ((viewportW - transformedW) / 2) + tx;
      var imgTop = ((viewportH - transformedH) / 2) + ty;
      var visLeft = Math.max(0, Math.min(transformedW, -imgLeft));
      var visTop = Math.max(0, Math.min(transformedH, -imgTop));
      var visRight = Math.max(0, Math.min(transformedW, viewportW - imgLeft));
      var visBottom = Math.max(0, Math.min(transformedH, viewportH - imgTop));
      var visW = Math.max(0, visRight - visLeft);
      var visH = Math.max(0, visBottom - visTop);

      var normX = visLeft / transformedW;
      var normY = visTop / transformedH;
      var normW = visW / transformedW;
      var normH = visH / transformedH;

      miniViewport.style.left = (mapRect.x + (normX * mapRect.w)) + 'px';
      miniViewport.style.top = (mapRect.y + (normY * mapRect.h)) + 'px';
      miniViewport.style.width = Math.max(2, normW * mapRect.w) + 'px';
      miniViewport.style.height = Math.max(2, normH * mapRect.h) + 'px';
    }

    function crossfadeToUrl(url, tierToken, onDone) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        if (onDone) onDone();
      }
      if (!url || lbBase.src === url) {
        finish();
        return;
      }
      var probe = new Image();
      probe.onload = function () {
        if (tierToken !== lbTierToken) {
          finish();
          return;
        }

        var fadeInHandled = false;
        var finishFadeIn = function () {
          if (fadeInHandled) return;
          fadeInHandled = true;
          if (tierToken !== lbTierToken) {
            finish();
            return;
          }

          lbBase.onload = function () {
            if (tierToken !== lbTierToken) {
              finish();
              return;
            }
            lbOverlay.style.opacity = '0';
            setTimeout(function () {
              if (tierToken !== lbTierToken) {
                finish();
                return;
              }
              lbOverlay.removeAttribute('src');
              finish();
            }, 180);
          };
          lbBase.src = url;
          if (lbBase.complete) lbBase.onload();
        };

        lbOverlay.onload = function () {
          if (tierToken !== lbTierToken) {
            finish();
            return;
          }
          lbOverlay.style.opacity = '0';
          requestAnimationFrame(function () {
            if (tierToken !== lbTierToken) {
              finish();
              return;
            }
            lbOverlay.style.opacity = '1';
            setTimeout(finishFadeIn, 240);
          });
        };
        lbOverlay.onerror = function () {
          if (tierToken !== lbTierToken) {
            finish();
            return;
          }
          finish();
        };
        lbOverlay.src = url;
      };
      probe.onerror = function () {
        finish();
      };
      probe.src = url;
    }

    lbCrossfadeImpl = crossfadeToUrl;

    function promoteFullInternal(reason) {
      clearTimeout(lbSettleTimer);
      clearTimeout(lbFullIdleTimer);
      lbSettleTimer = null;
      lbFullIdleTimer = null;
      if (reason === 'zoom') {
        lbFocusFromZoom = true;
      }
      var item = currentLBItems[currentIdx];
      if (!item || !item.fullSrc) return;
      if (lbBase.dataset.logicalSrc === 'full') return;
      var t = ++lbTierToken;
      crossfadeToUrl(item.fullSrc, t, function () {
        if (t !== lbTierToken) return;
        lbDisplayedTier = LB_TIER_FULL;
        lbBase.dataset.logicalSrc = 'full';
      });
    }

    lbPromoteFullImpl = promoteFullInternal;

    function toggleZoomMode() {
      var fitScale = getFitScale();
      if (fitMode) {
        fitMode = false;
        scale = fitScale > 0 ? (1 / fitScale) : 1;
        if (scale > 1) promoteCurrentToFull('zoom');
        prefetchNeighborFullOnZoom(currentIdx);
      } else {
        fitMode = true;
        scale = 1;
        tx = 0; ty = 0;
        lbFocusFromZoom = false;
      }
      applyXform(true);
    }

    function reset() {
      fitMode = true;
      scale = 1; tx = 0; ty = 0;
      lbFocusFromZoom = false;
      applyXform(true);
    }

    function refreshNeighborSlotImgs() {
      if (!currentLBItems.length) return;
      var p = currentLBItems[wrapLbIndex(currentIdx - 1)];
      var n = currentLBItems[wrapLbIndex(currentIdx + 1)];
      imgPrev.src = (p.src || p.mediumSrc || '');
      imgNext.src = (n.src || n.mediumSrc || '');
    }

    setInteractionMode(prefersTouchInput);

    overlay.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') setInteractionMode(true);
      else if (e.pointerType === 'mouse') setInteractionMode(false);
    });

    overlay.addEventListener('wheel', function (e) {
      setInteractionMode(false);
      e.preventDefault();
      showHelp();
      showMiniMap();
      fitMode = false;
      var unitDivisor = e.deltaMode === 1 ? 1 : 100;
      var units = e.deltaY / unitDivisor;
      if (!isFinite(units) || units === 0) {
        units = e.deltaY > 0 ? 1 : -1;
      }
      scale = Math.min(8, Math.max(1, scale * Math.pow(1.05, -units)));
      if (scale === 1) {
        tx = 0;
        ty = 0;
        fitMode = true;
        lbFocusFromZoom = false;
      } else {
        promoteCurrentToFull('zoom');
        prefetchNeighborFullOnZoom(currentIdx);
      }
      applyXform(false);
      hideMiniMapSoon();
    }, { passive: false });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target === imgWrap || e.target === lbCarousel) {
        if (useTouchMode) {
          noteMobileInteraction();
          return;
        }
        if (scale > 1) reset(); else closeLB();
      }
    });

    lbStack.addEventListener('mousedown', function (e) {
      setInteractionMode(false);
      if (e.button !== 0 || scale <= 1) return;
      e.preventDefault();
      showHelp();
      showMiniMap();
      dragging = true;
      dragMoved = false;
      dragX = e.clientX; dragY = e.clientY;
      startTx = tx; startTy = ty;
      lbStack.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      if (Math.abs(e.clientX - dragX) > 2 || Math.abs(e.clientY - dragY) > 2) dragMoved = true;
      tx = startTx + (e.clientX - dragX);
      ty = startTy + (e.clientY - dragY);
      applyXform(false);
    });
    window.addEventListener('mouseup', function () {
      if (dragging) {
        dragging = false;
        applyXform(false);
        hideMiniMapSoon();
      }
    });

    lbCarousel.addEventListener('touchstart', function (e) {
      showHelp();
      noteMobileInteraction();
      if (e.touches.length === 2) {
        pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        pinchStartScale = scale;
        pinchStartTx = tx;
        pinchStartTy = ty;
        swipeActive = false;
        dragging = false;
        e.preventDefault();
        return;
      }
      if (e.touches.length !== 1) return;
      if (scale > 1 || !fitMode) {
        dragging = true;
        dragX = e.touches[0].clientX;
        dragY = e.touches[0].clientY;
        startTx = tx;
        startTy = ty;
        e.preventDefault();
        return;
      }
      swipeActive = true;
      swipeStartX = e.touches[0].clientX;
      swipeStartY = e.touches[0].clientY;
      swipeStartOff = swipeOffset;
      swipeIntent = null;
      pullOffsetY = 0;
      imgWrap.style.transition = 'none';
      imgWrap.style.transform = '';
      lbTrack.style.transition = 'none';
      e.preventDefault();
    }, { passive: false });

    lbCarousel.addEventListener('touchmove', function (e) {
      noteMobileInteraction();
      if (e.touches.length === 2 && pinchDist !== null) {
        var d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        fitMode = false;
        scale = Math.min(8, Math.max(1, pinchStartScale * (d / pinchDist)));
        if (scale > 1) {
          promoteCurrentToFull('zoom');
          prefetchNeighborFullOnZoom(currentIdx);
          tx = pinchStartTx;
          ty = pinchStartTy;
        } else {
          fitMode = true;
          tx = 0;
          ty = 0;
          lbFocusFromZoom = false;
        }
        applyXform(false);
        e.preventDefault();
        return;
      }
      if (dragging && e.touches.length === 1) {
        noteMobileInteraction();
        tx = startTx + (e.touches[0].clientX - dragX);
        ty = startTy + (e.touches[0].clientY - dragY);
        applyXform(false);
        e.preventDefault();
        return;
      }
      if (!swipeActive || scale > 1 || !fitMode) return;
      if (e.touches.length !== 1) return;
      var dx = e.touches[0].clientX - swipeStartX;
      var dy = e.touches[0].clientY - swipeStartY;
      if (swipeIntent === null) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          swipeIntent = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
        }
      }
      if (swipeIntent === 'vertical') {
        noteMobileInteraction();
        pullOffsetY = Math.max(0, dy);
        imgWrap.style.transform = pullOffsetY > 0 ? ('translateY(' + Math.round(pullOffsetY * 0.35) + 'px)') : '';
      } else {
        swipeOffset = swipeStartOff + dx;
        setTrackOffset(-slotW + swipeOffset, false);
      }
      e.preventDefault();
    }, { passive: false });

    function finishSwipe() {
      if (!swipeActive) return;
      swipeActive = false;
      if (swipeIntent === 'vertical') {
        var closeThreshold = Math.max(80, Math.floor(window.innerHeight * 0.12));
        var shouldClose = pullOffsetY > closeThreshold && scale <= 1 && fitMode;
        imgWrap.style.transition = 'transform 0.18s ease';
        imgWrap.style.transform = '';
        swipeIntent = null;
        pullOffsetY = 0;
        if (shouldClose) {
          closeLB();
          return;
        }
        return;
      }
      swipeIntent = null;
      pullOffsetY = 0;
      var threshold = Math.max(48, slotW * LB_SWIPE_COMMIT_RATIO);
      if (swipeOffset < -threshold) {
        swipeSuppressClick = true;
        setTimeout(function () { swipeSuppressClick = false; }, 350);
        swipeOffset = 0;
        setTrackOffset(-slotW, true);
        lbSwipeCommitted = true;
        navigate(1);
        return;
      }
      if (swipeOffset > threshold) {
        swipeSuppressClick = true;
        setTimeout(function () { swipeSuppressClick = false; }, 350);
        swipeOffset = 0;
        setTrackOffset(-slotW, true);
        lbSwipeCommitted = true;
        navigate(-1);
        return;
      }
      swipeOffset = 0;
      setTrackOffset(-slotW, true);
    }

    lbCarousel.addEventListener('touchend', function () {
      finishSwipe();
      pinchDist = null;
      dragging = false;
      swiped = false;
    });
    lbCarousel.addEventListener('touchcancel', function () {
      finishSwipe();
      pinchDist = null;
      dragging = false;
      swiped = false;
    });

    overlay.addEventListener('touchstart', function () {
      setInteractionMode(true);
      showHelp();
      noteMobileInteraction();
    }, { passive: true });

    overlay.addEventListener('touchmove', function (e) {
      // Keep gestures contained to the lightbox; don't let page scroll behind it.
      if (lb && lb.style.display !== 'none') e.preventDefault();
    }, { passive: false });

    lbStack.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (swipeSuppressClick) return;
      showHelp();
      if (useTouchMode) {
        if (suppressImageTap) return;
        noteMobileInteraction();
        return;
      }
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      // Desktop click by itself does nothing; pan is left-click + drag.
    });
    lbBase.addEventListener('load', function () {
      miniImg.src = lbBase.src;
      updateMiniMap();
    });
    updateInteractionCursor();
    updateSideSlotVisibility();

    prevBtn.addEventListener('click',  function (e) { e.stopPropagation(); showHelp(); navigate(-1); });
    nextBtn.addEventListener('click',  function (e) { e.stopPropagation(); showHelp(); navigate(1); });
    closeBtn.addEventListener('click', function (e) { e.stopPropagation(); showHelp(); closeLB(); });

    window.addEventListener('resize', function () {
      if (!lb || lb.style.display === 'none') return;
      syncCarouselWidths();
      if (currentLBItems[currentIdx]) syncStackFrameForItem(currentLBItems[currentIdx]);
      applyXform(false);
    });

    lbImg = lbBase;
    lbOverlayImg = lbOverlay;
    lbReset = reset;
    lbToggleZoomMode = toggleZoomMode;
    lbShowHelp = showHelp;
    lbMetaTitle = metaTitle;
    lbMetaDesc = metaDesc;
    lbMetaDetails = metaDetails;

    overlay._syncCarousel = syncCarouselWidths;
    overlay._syncStackFrameForItem = syncStackFrameForItem;
    overlay._refreshNeighborSlots = refreshNeighborSlotImgs;
    overlay._noteMobileInteraction = noteMobileInteraction;
    overlay._resetSwipeOffset = function () {
      swipeOffset = 0;
      swipeActive = false;
      syncCarouselWidths();
    };
    return overlay;
  }

  function computeLbEndRect(fitW, fitH) {
    var maxW = window.innerWidth * 0.9;
    var maxH = (window.innerHeight * 0.9) - 80;
    var w = fitW > 0 ? fitW : maxW;
    var h = fitH > 0 ? fitH : maxH;
    var s = Math.min(1, maxW / w, maxH / h);
    var dw = w * s;
    var dh = h * s;
    var cx = window.innerWidth / 2;
    var cy = window.innerHeight / 2;
    return {
      left: cx - dw / 2,
      top: cy - dh / 2,
      width: dw,
      height: dh,
    };
  }

  function animateOpenFromThumb(thumbEl, item, done) {
    if (!thumbEl || !item) {
      done();
      return;
    }
    var start = thumbEl.getBoundingClientRect();
    var end = computeLbEndRect(item.fitW || item.lightboxFitW, item.fitH || item.lightboxFitH);
    var fly = document.createElement('img');
    fly.src = thumbEl.currentSrc || thumbEl.src || item.src || '';
    fly.style.cssText = [
      'position:fixed', 'left:' + start.left + 'px', 'top:' + start.top + 'px',
      'width:' + start.width + 'px', 'height:' + start.height + 'px',
      'object-fit:cover', 'z-index:10001', 'margin:0', 'padding:0',
      'border-radius:0.5rem', 'box-shadow:0 8px 32px rgba(0,0,0,0.45)',
      'transition:all ' + LB_OPEN_FROM_THUMB_MS + 'ms cubic-bezier(0.22,1,0.36,1)',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(fly);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        fly.style.left = end.left + 'px';
        fly.style.top = end.top + 'px';
        fly.style.width = end.width + 'px';
        fly.style.height = end.height + 'px';
        fly.style.objectFit = 'contain';
        fly.style.borderRadius = '0';
      });
    });
    setTimeout(function () {
      fly.remove();
      done();
    }, LB_OPEN_FROM_THUMB_MS + 20);
  }

  function openLB(index, itemSet, thumbEl) {
    currentLBItems = itemSet || allItems;
    currentIdx = index;
    if (!lb) lb = buildLightbox();
    lbLastNavAt = 0;
    lbSwipeCommitted = false;
    lockPageScrollForLightbox();
    lb.style.display = 'flex';
    requestAnimationFrame(function () {
      lb.style.opacity = '1';
      if (lb._syncCarousel) lb._syncCarousel();
      if (lb._noteMobileInteraction) lb._noteMobileInteraction();
    });
    if (thumbEl) {
      var item = currentLBItems[currentIdx];
      var seedSrc = thumbEl.currentSrc || thumbEl.src || item.src || '';
      animateOpenFromThumb(thumbEl, item, function () {
        showLBImage(currentIdx, { skipRapid: true, afterThumbAnim: true, seedSrc: seedSrc });
        prefetchAroundIndex(currentIdx);
      });
    } else {
      showLBImage(currentIdx, {});
      prefetchAroundIndex(currentIdx);
    }
  }

  function closeLB() {
    lb.style.opacity = '0';
    setTimeout(function () {
      lb.style.display = 'none';
      unlockPageScrollForLightbox();
      lbReset();
      clearLbSchedulers();
      lbFocusFromZoom = false;
    }, 300);
  }

  function navigate(dir) {
    currentIdx = wrapLbIndex(currentIdx + dir);
    var opts = {};
    if (lbSwipeCommitted) {
      opts.forceScan = true;
      lbSwipeCommitted = false;
    }
    showLBImage(currentIdx, opts);
    prefetchAroundIndex(currentIdx);
  }

  function showLBImage(index, opts) {
    opts = opts || {};
    var item = currentLBItems[index];
    if (!item || !lb) return;
    clearLbSchedulers();
    var loadTok = ++lbLoadToken;
    ++lbTierToken;
    var tierTok = lbTierToken;
    lbDisplayedTier = LB_TIER_NONE;
    lbReset();
    if (lb._resetSwipeOffset) lb._resetSwipeOffset();
    if (lb._syncCarousel) lb._syncCarousel();
    if (lb._refreshNeighborSlots) lb._refreshNeighborSlots();

    lbLastNavAt = performance.now();

    function getOrderedSourcesForItem(currentItem) {
      var ordered = [
        currentItem.lightboxSmallSrc || currentItem.src,
        currentItem.lightboxMediumSrc || currentItem.mediumSrc,
        currentItem.lightboxFitSrc,
        currentItem.fullSrc,
      ];
      var seen = {};
      return ordered.filter(function (url) {
        var normalized = normalizeLbUrl(url);
        if (!normalized || seen[normalized]) return false;
        seen[normalized] = true;
        return true;
      });
    }

    function runSequentialTierUpgrades(sources, startIdx) {
      function loadStep(i) {
        if (i >= sources.length) return;
        if (loadTok !== lbLoadToken || tierTok !== lbTierToken) return;
        var nextUrl = sources[i];
        var nextTier = getLbTierForUrl(item, nextUrl);
        if (!nextUrl || nextTier <= lbDisplayedTier) {
          loadStep(i + 1);
          return;
        }
        var probe = new Image();
        probe.onload = function () {
          if (loadTok !== lbLoadToken || tierTok !== lbTierToken) return;
          if (typeof lbCrossfadeImpl !== 'function') {
            loadStep(i + 1);
            return;
          }
          lbCrossfadeImpl(nextUrl, tierTok, function () {
            if (loadTok !== lbLoadToken || tierTok !== lbTierToken) return;
            lbDisplayedTier = Math.max(lbDisplayedTier, nextTier);
            setLbLogicalSrcForTier(item, nextTier);
            loadStep(i + 1);
          });
        };
        probe.onerror = function () {
          if (loadTok !== lbLoadToken || tierTok !== lbTierToken) return;
          loadStep(i + 1);
        };
        probe.src = nextUrl;
      }
      loadStep(startIdx);
    }

    var tierSources = getOrderedSourcesForItem(item);
    var initialUrl = tierSources[0] || item.fullSrc || '';
    var seedUrl = opts.seedSrc || '';
    var startIdx = 1;
    if (lb._syncStackFrameForItem) lb._syncStackFrameForItem(item);

    if (lbOverlayImg) {
      lbOverlayImg.style.opacity = '0';
      lbOverlayImg.removeAttribute('src');
    }
    if (lbImg) {
      var initialTier = getLbTierForUrl(item, initialUrl);
      var normalizedInitial = normalizeLbUrl(initialUrl);
      var normalizedSeed = normalizeLbUrl(seedUrl);
      var deferSequenceToOnload = false;
      if (seedUrl && normalizedSeed) {
        var seedTier = getLbTierForUrl(item, seedUrl);
        if (seedTier <= LB_TIER_NONE) seedTier = LB_TIER_SMALL;
        lbImg.onload = null;
        lbImg.style.transition = 'none';
        lbImg.style.opacity = '1';
        lbImg.src = seedUrl;
        lbDisplayedTier = Math.max(lbDisplayedTier, seedTier);
        setLbLogicalSrcForTier(item, seedTier);
        if (normalizedSeed === normalizedInitial) startIdx = 1;
        else startIdx = 0;
      } else {
        deferSequenceToOnload = true;
        lbImg.style.transition = 'opacity 0.18s ease';
        lbImg.style.opacity = '0';
        setLbLogicalSrcForTier(item, initialTier || LB_TIER_SMALL);
        lbImg.onload = function () {
          if (loadTok !== lbLoadToken) return;
          lbImg.style.opacity = '1';
          lbDisplayedTier = Math.max(lbDisplayedTier, initialTier || LB_TIER_SMALL);
          runSequentialTierUpgrades(tierSources, 1);
        };
        lbImg.src = initialUrl;
        if (lbImg.complete) lbImg.onload();
      }
      if (!deferSequenceToOnload) {
        runSequentialTierUpgrades(tierSources, startIdx);
      }
    }

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

    // Full-res now participates in the fixed progressive sequence:
    // small -> medium -> fit -> full for both desktop and mobile.
  }

  function preloadNeighbors(index) {
    prefetchAroundIndex(index);
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
    // Sort each album's items by filename, then stable index.
    Object.keys(map).forEach(function (k) {
      map[k].sort(function (a, b) {
        var nameCmp = a.fileName.localeCompare(b.fileName);
        if (nameCmp !== 0) return nameCmp;
        return a.index - b.index;
      });
    });
    return map;
  }

  function getSortedAlbumNames(albums) {
    var names = Object.keys(albums);
    return names.sort(function (a, b) {
      var itemsA = albums[a] || [];
      var itemsB = albums[b] || [];
      var firstA = itemsA.length ? itemsA[0].fileName : '';
      var firstB = itemsB.length ? itemsB[0].fileName : '';
      var firstCmp = firstA.localeCompare(firstB);
      if (firstCmp !== 0) return firstCmp;
      return a.localeCompare(b);
    });
  }

  // ── Album view helpers ────────────────────────────────────────────────
  function getPageBgColor() {
    var bg = getComputedStyle(document.body).backgroundColor;
    return bg || 'rgb(0,0,0)';
  }

  function updateAlbumRowFades(viewport, leftFade, rightFade) {
    var maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    var hasOverflow = maxScroll > 1;
    if (!hasOverflow) {
      leftFade.style.opacity = '0';
      rightFade.style.opacity = '0';
      return;
    }

    leftFade.style.opacity = viewport.scrollLeft > 1 ? '1' : '0';
    rightFade.style.opacity = viewport.scrollLeft < (maxScroll - 1) ? '1' : '0';
  }

  function makeAlbumDragScrollable(viewport) {
    var pointerDown = false;
    var startX = 0;
    var startScrollLeft = 0;
    var dragged = false;

    viewport.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      pointerDown = true;
      dragged = false;
      startX = e.clientX;
      startScrollLeft = viewport.scrollLeft;
      viewport.style.cursor = 'grabbing';
      viewport.setPointerCapture(e.pointerId);
    });

    viewport.addEventListener('pointermove', function (e) {
      if (!pointerDown) return;
      var deltaX = e.clientX - startX;
      if (Math.abs(deltaX) > 3) dragged = true;
      if (dragged) {
        viewport.scrollLeft = startScrollLeft - deltaX;
        e.preventDefault();
      }
    });

    function endDrag() {
      if (!pointerDown) return;
      pointerDown = false;
      viewport.style.cursor = viewport.classList.contains('is-scrollable') ? 'grab' : 'default';
      if (dragged) {
        viewport.dataset.suppressClick = '1';
        setTimeout(function () {
          viewport.dataset.suppressClick = '0';
        }, 0);
      }
    }

    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
    viewport.addEventListener('pointerleave', endDrag);
    viewport.addEventListener('click', function (e) {
      if (viewport.dataset.suppressClick === '1') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  function buildAlbumOverviewView() {
    var albums = getAlbums();
    var names = getSortedAlbumNames(albums);
    var pageBg = getPageBgColor();

    var wrap = document.createElement('div');
    wrap.className = 'album-overview';
    wrap.style.setProperty('--album-thumb-height', ALBUM_PREVIEW_THUMB_HEIGHT + 'px');
    wrap.style.setProperty('--album-fade-color', pageBg);

    var rows = [];
    names.forEach(function (name) {
      var items = albums[name] || [];
      if (!items.length) return;

      var row = document.createElement('section');
      row.className = 'album-overview-row';

      var title = document.createElement('a');
      title.className = 'album-overview-title';
      title.href = window.location.pathname + '?album=' + encodeURIComponent(name);
      title.textContent = name;
      title.addEventListener('click', function (e) {
        e.preventDefault();
        showAlbumDetail(name, { animated: false, pushHistory: true });
      });

      var count = document.createElement('div');
      count.className = 'album-overview-count';
      count.textContent = items.length + ' photos';

      var shell = document.createElement('div');
      shell.className = 'album-overview-track-shell';

      var viewport = document.createElement('div');
      viewport.className = 'album-overview-track';

      var leftFade = document.createElement('div');
      leftFade.className = 'album-overview-fade album-overview-fade-left';

      var rightFade = document.createElement('div');
      rightFade.className = 'album-overview-fade album-overview-fade-right';

      var thumbs = [];
      var thumbAspects = [];
      items.forEach(function (item, idx) {
        var thumbBtn = document.createElement('button');
        thumbBtn.type = 'button';
        thumbBtn.className = 'album-overview-thumb';
        thumbBtn.setAttribute('aria-label', 'Open photo ' + (idx + 1) + ' in ' + name);

        var thumbImg = document.createElement('img');
        thumbImg.src = item.mediumSrc || item.src;
        thumbImg.alt = item.meta.title || ('Photo ' + (idx + 1));
        thumbImg.loading = 'lazy';

        thumbBtn.addEventListener('click', function () {
          openLB(idx, items, thumbImg);
        });

        thumbBtn.appendChild(thumbImg);
        viewport.appendChild(thumbBtn);
        thumbs.push(thumbBtn);
        thumbAspects.push((item.w > 0 && item.h > 0) ? (item.w / item.h) : (4 / 3));
      });

      viewport.addEventListener('scroll', function () {
        updateAlbumRowFades(viewport, leftFade, rightFade);
      }, { passive: true });
      makeAlbumDragScrollable(viewport);

      shell.appendChild(viewport);
      shell.appendChild(leftFade);
      shell.appendChild(rightFade);
      row.appendChild(title);
      row.appendChild(count);
      row.appendChild(shell);
      wrap.appendChild(row);

      rows.push({
        viewport: viewport,
        thumbs: thumbs,
        thumbAspects: thumbAspects,
        leftFade: leftFade,
        rightFade: rightFade,
        count: items.length,
      });
    });

    function applyRowSizing() {
      var thumbHeight = Math.min(ALBUM_PREVIEW_THUMB_HEIGHT, Math.max(140, Math.floor(window.innerWidth * 0.6)));
      wrap.style.setProperty('--album-thumb-height', thumbHeight + 'px');
      rows.forEach(function (row) {
        row.thumbs.forEach(function (thumb, idx) {
          var aspect = row.thumbAspects[idx] || (4 / 3);
          var thumbW = Math.max(72, Math.round(aspect * thumbHeight));
          thumb.style.flexBasis = thumbW + 'px';
          thumb.style.width = thumbW + 'px';
        });

        var hasOverflow = (row.viewport.scrollWidth - row.viewport.clientWidth) > 1;
        row.viewport.classList.toggle('is-scrollable', hasOverflow);
        row.viewport.style.cursor = hasOverflow ? 'grab' : 'default';
        updateAlbumRowFades(row.viewport, row.leftFade, row.rightFade);
      });
    }

    wrap._applyRowSizing = applyRowSizing;
    requestAnimationFrame(applyRowSizing);
    return wrap;
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
    if (viewMode === 'albums' && albumViewEl) return;
    viewMode = 'albums';
    updateToggleBtn();
    clearAlbumOverlays();
    setContainerModeWidth('albums');
    container.style.display = 'none';
    container.style.opacity = '0';

    if (albumViewEl) albumViewEl.remove();
    albumViewEl = buildAlbumOverviewView();
    albumViewEl.style.opacity = '0';
    container.parentNode.insertBefore(albumViewEl, container.nextSibling);
    requestAnimationFrame(function () {
      if (!albumViewEl) return;
      albumViewEl.style.opacity = '1';
      if (albumViewEl._applyRowSizing) albumViewEl._applyRowSizing();
    });
  }

  // ── Album → Masonry animation ─────────────────────────────────────────
  function showMasonryView() {
    if (viewMode === 'masonry') return;
    viewMode = 'masonry';
    setContainerModeWidth('masonry');
    clearAlbumOverlays();
    if (albumViewEl) {
      var oldAlbumView = albumViewEl;
      albumViewEl = null;
      oldAlbumView.style.opacity = '0';
      setTimeout(function () { oldAlbumView.remove(); }, 220);
    }
    container.style.display = '';
    container.style.opacity = '1';

    allItems.forEach(function (item) {
      item.el.style.transition = '';
      item.el.style.opacity = '1';
      item.el.style.zIndex = '';
      item.img.style.opacity = '1';
    });

    var cols = getColCount();
    layoutMasonry(container, allItems, cols);

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
      imgEl.src = item.mediumSrc || item.src || item.lightboxFitSrc || item.fullSrc;
      imgEl.loading = 'lazy';
      imgEl.decoding = 'async';
      imgEl.style.cssText = [
        'width:100%', 'border-radius:0.5rem',
        'cursor:pointer', 'display:block',
      ].join(';');
      imgEl.addEventListener('click', function () {
        openLB(i, items, imgEl);
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
      showAlbumView();
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
    var galleryTitle = document.getElementById('gallery-page-title');
    if (galleryTitle) {
      // Ensure the page title scrolls with content on mobile.
      galleryTitle.style.position = 'static';
      galleryTitle.style.top = 'auto';
    }
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowX = 'hidden';

    container.style.position = 'relative';
    setContainerModeWidth('masonry');

    allItems = Array.from(container.querySelectorAll('.gallery-item')).map(function (el, i) {
      el.style.cssText += ';position:absolute;overflow:hidden;border-radius:0.5rem;';
      var img = el.querySelector('img');
      var fullSrc = el.dataset.fullSrc || '';
      var fullPath = fullSrc.split('?')[0];
      var fileName = fullPath.split('/').pop() || ('zzzz-' + i);
      Object.assign(img.style, {
        width: '100%', height: '100%',
        objectFit: 'cover',
        opacity: '0',
        transitionProperty: 'opacity',
        cursor: 'pointer',
      });
      img.addEventListener('click', function () { openLB(i, allItems, img); });
      return {
        el: el,
        img: img,
        src:     el.dataset.src,
        mediumSrc: el.dataset.mediumSrc || el.dataset.src,
        lightboxSmallSrc: el.dataset.src,
        lightboxMediumSrc: el.dataset.lightboxMediumSrc || el.dataset.mediumSrc || el.dataset.src,
        lightboxFitSrc: el.dataset.lightboxFitSrc || el.dataset.mediumSrc || el.dataset.src,
        fullSrc: fullSrc,
        fileName: fileName.toLowerCase(),
        w: +el.dataset.w,
        h: +el.dataset.h,
        mediumW: +el.dataset.mediumW || 0,
        mediumH: +el.dataset.mediumH || 0,
        lightboxSmallW: +el.dataset.lightboxSmallW || 0,
        lightboxSmallH: +el.dataset.lightboxSmallH || 0,
        lightboxMediumW: +el.dataset.lightboxMediumW || +el.dataset.mediumW || 0,
        lightboxMediumH: +el.dataset.lightboxMediumH || +el.dataset.mediumH || 0,
        lightboxFitW: +el.dataset.lightboxFitW || 0,
        lightboxFitH: +el.dataset.lightboxFitH || 0,
        fitW: +el.dataset.lightboxFitW || +el.dataset.mediumW || +el.dataset.w,
        fitH: +el.dataset.lightboxFitH || +el.dataset.mediumH || +el.dataset.h,
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
    }, { rootMargin: '140px' });

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

    function isNearUnlockedBoundary() {
      return (getVisibleBottomInContainer() + MASONRY_UNLOCK_TRIGGER_PX) >= unlockedBottom;
    }

    function pumpUnlockNearViewport() {
      var guard = 0;
      while (guard < 64 && unlockedCount < loadOrder.length && isNearUnlockedBoundary()) {
        if (!unlockNextBatch()) break;
        guard += 1;
      }
    }

    unlockToViewport();
    pumpUnlockNearViewport();

    window.addEventListener('scroll', function () {
      if (viewMode !== 'masonry') return;
      unlockToTargetBottom(getVisibleBottomInContainer() + MASONRY_PRELOAD_PX);
      pumpUnlockNearViewport();
    }, { passive: true });
    window.addEventListener('touchend', function () {
      if (viewMode !== 'masonry') return;
      pumpUnlockNearViewport();
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
          pumpUnlockNearViewport();
        } else if (viewMode === 'albums') {
          if (albumViewEl && albumViewEl._applyRowSizing) {
            albumViewEl._applyRowSizing();
          }
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
