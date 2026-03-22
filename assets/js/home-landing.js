(function () {
  "use strict";

  var MAX_BG_WAIT_MS = 1500;
  var BG_REVEAL_DELAY_MS = 120;
  var BG_TO_TEXT_DELAY_MS = 200;
  var BG_TO_RECENT_DELAY_MS = 200;

  function triggerSequence() {
    var body = document.body;
    if (!body) return;

    requestAnimationFrame(function () {
      window.setTimeout(function () {
        body.classList.add("home-landing-bg-visible");

        window.setTimeout(function () {
          body.classList.add("home-landing-text-visible");
        }, BG_TO_TEXT_DELAY_MS);

        window.setTimeout(function () {
          body.classList.add("home-landing-recent-visible");
        }, BG_TO_RECENT_DELAY_MS);
      }, BG_REVEAL_DELAY_MS);
    });
  }

  function withTimeout(promise, timeoutMs) {
    return new Promise(function (resolve) {
      var settled = false;
      var done = function () {
        if (settled) return;
        settled = true;
        resolve();
      };
      window.setTimeout(done, timeoutMs);
      promise.then(done, done);
    });
  }

  function readBackgroundSource(bgEl) {
    if (!bgEl) return "";
    if (bgEl.tagName === "IMG") return bgEl.currentSrc || bgEl.src || "";

    var explicit = bgEl.getAttribute("data-bg-src");
    if (explicit) return explicit;

    var styleVal = bgEl.style && bgEl.style.backgroundImage ? bgEl.style.backgroundImage : "";
    var match = styleVal.match(/url\((['"]?)(.*?)\1\)/i);
    return match && match[2] ? match[2] : "";
  }

  function waitForBackground(bgEl) {
    return new Promise(function (resolve) {
      if (!bgEl) {
        resolve();
        return;
      }

      if (bgEl.tagName === "IMG") {
        if (bgEl.complete && bgEl.naturalWidth > 0) {
          resolve();
          return;
        }
        bgEl.addEventListener("load", resolve, { once: true });
        bgEl.addEventListener("error", resolve, { once: true });
        return;
      }

      var bgSrc = readBackgroundSource(bgEl);
      if (!bgSrc) {
        resolve();
        return;
      }

      var preloader = new Image();
      preloader.onload = resolve;
      preloader.onerror = resolve;
      preloader.src = bgSrc;
    });
  }

  function init() {
    var root = document.querySelector(".home-landing-sequence");
    if (!root) return;

    var body = document.body;
    if (!body) return;
    var textStage = root.querySelector(".home-landing-text-stage");
    if (textStage) {
      var textBlocks = Array.prototype.slice.call(textStage.children || []);
      textBlocks.forEach(function (block) {
        if (block.dataset.homeLandingWrapped === "1") return;
        var inner = document.createElement("span");
        inner.className = "home-landing-line-inner";
        while (block.firstChild) {
          inner.appendChild(block.firstChild);
        }
        block.appendChild(inner);
        block.dataset.homeLandingWrapped = "1";
      });
    }

    var bg = root.querySelector(".home-landing-bg");
    body.classList.add("home-landing-animating");

    withTimeout(waitForBackground(bg), MAX_BG_WAIT_MS).then(function () {
      triggerSequence();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
