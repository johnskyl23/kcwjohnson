/* ==========================================================================
   scroll-motion.js
   Scroll-driven motion primitives for kcwjohnson.com.

   Everything here is progressive enhancement: with JS disabled (or with
   prefers-reduced-motion) the page is a plain, fully readable document.

   Primitives
   ----------
   [data-reveal]            fade / rise / blur / zoom in when scrolled into view
   [data-reveal-group]      stagger the [data-reveal] children inside
   [data-split]             reveal a headline line-by-line from behind a mask
   [data-parallax="0.18"]   translate the element against scroll
   [data-scroll-scale]      magnify / shrink across the element's scroll range
   [data-scene]             pinned scene whose 0→1 progress drives .frame swaps
   [data-count]             count a number up when it enters the viewport
   [data-lazy-video]        only fetch + play a loop once it is near the viewport
   ========================================================================== */

(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var raf = window.requestAnimationFrame.bind(window);

  /* ---------------------------------------------------------------- utils */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* A single shared rAF loop for every scroll-linked effect.
     A handler returns true to ask for another frame — that is what lets the
     smoothed effects keep easing after the scroll itself has stopped, without
     burning a rAF loop for the whole life of the page. */
  var frameJobs = [];
  var ticking = false;

  function onFrame(fn) { frameJobs.push(fn); }

  function tick() {
    var again = false;
    for (var i = 0; i < frameJobs.length; i++) {
      if (frameJobs[i]() === true) again = true;
    }
    ticking = false;
    if (again) schedule();
  }

  function schedule() {
    if (ticking) return;
    ticking = true;
    raf(tick);
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });

  /* Progress of an element through the viewport.
     0 when its top hits the bottom of the viewport,
     1 when its bottom leaves the top of the viewport. */
  function viewportProgress(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var total = r.height + vh;
    if (total <= 0) return 0;
    return clamp((vh - r.top) / total, 0, 1);
  }

  /* --------------------------------------------------------------- reveals */

  /* True when any part of the element is within `slack` px of the viewport. */
  function nearViewport(el, slack) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    return r.bottom > -slack && r.top < vh + slack;
  }

  function initReveals() {
    var targets = $$('[data-reveal]');
    if (!targets.length) return;

    function show(el) { el.classList.add('is-in'); }

    if (reduced.matches || !('IntersectionObserver' in window)) {
      targets.forEach(show);
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        show(entry.target);
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    targets.forEach(function (el) { io.observe(el); });

    // Anything already on screen at boot is revealed straight away rather than
    // waiting for the observer's first callback — no empty hero on load.
    targets.forEach(function (el) {
      if (nearViewport(el, 0)) { show(el); io.unobserve(el); }
    });

    // Watchdog: if the observer has not delivered for elements that are plainly
    // on screen (some environments throttle it heavily, and a page that never
    // scrolls may never trigger it), reveal them anyway. Content wins.
    setTimeout(function () {
      targets.forEach(function (el) {
        if (!el.classList.contains('is-in') && nearViewport(el, 200)) {
          show(el); io.unobserve(el);
        }
      });
    }, 1200);
  }

  /* Stagger children of a group so they cascade rather than pop together. */
  function initStagger() {
    $$('[data-reveal-group]').forEach(function (group) {
      var step = parseInt(group.getAttribute('data-reveal-group'), 10);
      if (isNaN(step)) step = 90;
      $$('[data-reveal]', group).forEach(function (child, i) {
        child.style.setProperty('--reveal-delay', (i * step) + 'ms');
      });
    });
  }

  /* --------------------------------------------------- headline line split */

  /* Wraps each line of a headline in a masked container so the words slide up
     from behind their own baseline. Re-splits on resize because line breaks
     move. Falls back to the untouched markup when reduced motion is on. */
  function initSplit() {
    var nodes = $$('[data-split]');
    if (!nodes.length || reduced.matches) return;

    nodes.forEach(function (node) {
      if (!node.dataset.splitSource) node.dataset.splitSource = node.innerHTML;
    });

    function split(node) {
      var source = node.dataset.splitSource;
      // Split on explicit <br> first; otherwise treat the whole thing as one line.
      var lines = source.split(/<br\s*\/?>/i);
      node.innerHTML = lines.map(function (line, i) {
        return '<span class="split-line"><span style="--line-delay:' +
               (i * 95) + 'ms">' + line.trim() + '</span></span>';
      }).join('');
    }

    nodes.forEach(split);

    function show(n) {
      n.classList.add('is-in');
      $$('.split-line', n).forEach(function (l) { l.classList.add('is-in'); });
    }

    if (!('IntersectionObserver' in window)) {
      nodes.forEach(show);
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        show(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.2 });
    nodes.forEach(function (n) { io.observe(n); });

    // Same reasoning as initReveals: never leave a masked headline half-risen.
    nodes.forEach(function (n) { if (nearViewport(n, 0)) { show(n); io.unobserve(n); } });
    setTimeout(function () {
      nodes.forEach(function (n) {
        if (!n.classList.contains('is-in') && nearViewport(n, 200)) { show(n); io.unobserve(n); }
      });
    }, 1200);
  }

  /* -------------------------------------------------------------- parallax */

  function initParallax() {
    var items = $$('[data-parallax]');
    if (!items.length || reduced.matches) return;

    var state = items.map(function (el) {
      return {
        el: el,
        depth: parseFloat(el.getAttribute('data-parallax')) || 0.15,
        current: 0
      };
    });

    onFrame(function () {
      var vh = window.innerHeight;
      var settling = false;
      state.forEach(function (s) {
        var r = s.el.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 2) return;   // far offscreen: skip
        var centre = r.top + r.height / 2;
        var offset = (centre - vh / 2) * s.depth;
        s.current = lerp(s.current, offset, 0.16);      // smooth, not sticky
        s.el.style.transform = 'translate3d(0,' + s.current.toFixed(2) + 'px,0)';
        if (Math.abs(offset - s.current) > 0.15) settling = true;
      });
      return settling;   // keep the loop alive until the easing lands
    });
  }

  /* ------------------------------------------------- magnify / shrink ---- */

  /* data-scroll-scale="0.86 1.06"  →  scale runs from 0.86 to 1.06 as the
     element travels through the viewport, easing at both ends so the middle
     of the range sits at rest. */
  function initScrollScale() {
    var items = $$('[data-scroll-scale]');
    if (!items.length || reduced.matches) return;

    var state = items.map(function (el) {
      var parts = (el.getAttribute('data-scroll-scale') || '0.9 1.04').trim().split(/\s+/);
      return {
        el: el,
        from: parseFloat(parts[0]),
        to: parseFloat(parts.length > 1 ? parts[1] : parts[0])
      };
    });

    onFrame(function () {
      var vh = window.innerHeight;
      state.forEach(function (s) {
        var r = s.el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        var p = viewportProgress(s.el);
        s.el.style.setProperty('--scale', lerp(s.from, s.to, p).toFixed(4));
      });
    });
  }

  /* --------------------------------------------------- scrubbed progress -- */

  /* [data-scrub] elements get a --p custom property, 0→1, recomputed every
     frame. CSS does the rest, so a scrubbed animation runs forwards when you
     scroll down and backwards when you scroll up — no keyframes, no library.

       hero    0 at rest → 1 once the element has scrolled its own height away
       pin     0 when a tall section's top hits the viewport top → 1 at its end
       through 0→1 as the viewport's reading line travels down the element   */
  function initScrub() {
    var els = $$('[data-scrub]');
    if (!els.length || reduced.matches) return;

    onFrame(function () {
      var vh = window.innerHeight;
      els.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 2) return;
        var p;
        switch (el.getAttribute('data-scrub')) {
          case 'hero': p = clamp(-r.top / Math.max(r.height, 1), 0, 1); break;
          case 'pin':  p = clamp(-r.top / Math.max(r.height - vh, 1), 0, 1); break;
          default:     p = clamp((vh * 0.6 - r.top) / Math.max(r.height, 1), 0, 1);
        }
        el.style.setProperty('--p', p.toFixed(4));
      });
    });
  }

  /* ------------------------------------------------ word-by-word lighting -- */

  /* A statement is split into words, which then illuminate in sequence as the
     pinned section scrubs past. Splitting happens in JS so the source stays a
     single readable sentence, and so a reduced-motion visitor gets it whole. */
  function initWords() {
    var hosts = $$('[data-words]');
    if (!hosts.length || reduced.matches) return;

    var groups = hosts.map(function (host) {
      var scrub = host.closest('[data-scrub]') || host;
      var words = [];
      host.textContent.trim().split(/\s+/).forEach(function (word, i, all) {
        var span = document.createElement('span');
        span.className = 'w';
        span.textContent = word;
        if (i === 0) host.textContent = '';
        host.appendChild(span);
        if (i < all.length - 1) host.appendChild(document.createTextNode(' '));
        words.push(span);
      });
      return { scrub: scrub, words: words, lit: -1 };
    });

    onFrame(function () {
      groups.forEach(function (g) {
        var p = parseFloat(g.scrub.style.getPropertyValue('--p')) || 0;
        // Leave a little runway at each end so the first and last words are
        // readable rather than flashing past at the boundary.
        var lit = Math.round(clamp((p - 0.08) / 0.62, 0, 1) * g.words.length);
        if (lit === g.lit) return;
        g.lit = lit;
        g.words.forEach(function (w, i) { w.classList.toggle('lit', i < lit); });
      });
    });
  }

  /* --------------------------------------------------- step timeline ------ */

  /* A column of [data-step] entries scrolls past a sticky column of
     [data-visual] panes. Whichever step sits nearest the middle of the screen
     is the active one and selects its visual. */
  function initSteps() {
    var steps = $$('[data-step]');
    if (!steps.length) return;

    var visuals = $$('[data-visual]');
    if (reduced.matches) {
      steps.forEach(function (s) { s.classList.add('is-active'); });
      visuals.forEach(function (v) { v.classList.add('is-active'); });
      return;
    }

    var active = null;

    onFrame(function () {
      var vh = window.innerHeight;
      var best = Infinity, next = active;

      steps.forEach(function (s) {
        var r = s.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        var d = Math.abs(r.top + r.height / 2 - vh / 2);
        if (d < best) { best = d; next = s.getAttribute('data-step'); }
      });

      if (next === active) return;
      active = next;
      steps.forEach(function (s) {
        s.classList.toggle('is-active', s.getAttribute('data-step') === active);
      });
      visuals.forEach(function (v) {
        var on = v.getAttribute('data-visual') === active;
        v.classList.toggle('is-active', on);
        // Only the visible clip should be decoding.
        var vid = v.querySelector('video');
        if (!vid) return;
        if (on) { tryPlay(vid); } else if (!vid.paused) { vid.pause(); }
      });
    });
  }

  /* ------------------------------------------------ scrubbed counters ----- */

  /* Unlike [data-count], which fires once, these are tied to scroll position:
     scroll back up and the number counts back down. */
  function initScrubCounters() {
    var els = $$('[data-scrub-count]');
    if (!els.length) return;

    if (reduced.matches) {
      els.forEach(function (el) { el.textContent = el.getAttribute('data-scrub-count'); });
      return;
    }

    var groups = els.map(function (el) {
      return {
        el: el,
        scrub: el.closest('[data-scrub]') || el,
        target: parseFloat(el.getAttribute('data-scrub-count')),
        dec: parseInt(el.getAttribute('data-decimals') || '0', 10),
        last: null
      };
    });

    onFrame(function () {
      groups.forEach(function (g) {
        var p = parseFloat(g.scrub.style.getPropertyValue('--p')) || 0;
        var t = clamp((p - 0.35) / 0.3, 0, 1);
        var eased = 1 - Math.pow(1 - t, 3);
        var text = (g.target * eased).toFixed(g.dec);
        if (text === g.last) return;
        g.last = text;
        g.el.textContent = text;
      });
    });
  }

  /* ---------------------------------------------------------- pinned scene */

  /* A [data-scene] wrapper is taller than the viewport; its .scene__stage is
     sticky. Scroll progress through the wrapper is written to --p on the
     wrapper and used to activate one .frame at a time. */
  function initScenes() {
    var scenes = $$('[data-scene]');
    if (!scenes.length) return;

    if (reduced.matches) {
      scenes.forEach(function (scene) {
        $$('.frame', scene).forEach(function (f) { f.classList.add('is-active'); });
      });
      return;
    }

    var state = scenes.map(function (scene) {
      return {
        scene: scene,
        frames: $$('.frame', scene),
        steps: $$('[data-step]', scene),
        last: -1
      };
    });

    onFrame(function () {
      var vh = window.innerHeight;
      state.forEach(function (s) {
        var r = s.scene.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;

        // 0 when the scene's top reaches the viewport top,
        // 1 when its bottom reaches the viewport bottom.
        var travel = r.height - vh;
        var p = travel > 0 ? clamp(-r.top / travel, 0, 1) : 0;
        s.scene.style.setProperty('--p', p.toFixed(4));

        if (!s.frames.length) return;
        var idx = clamp(Math.floor(p * s.frames.length), 0, s.frames.length - 1);
        if (idx === s.last) return;
        s.last = idx;
        s.frames.forEach(function (f, i) { f.classList.toggle('is-active', i === idx); });
        s.steps.forEach(function (st, i) { st.classList.toggle('is-active', i === idx); });
      });
    });
  }

  /* ---------------------------------------------------------- number count */

  function initCounters() {
    var nodes = $$('[data-count]');
    if (!nodes.length) return;

    function render(el, value) {
      var dec = parseInt(el.getAttribute('data-decimals') || '0', 10);
      var text = value.toFixed(dec);
      if (el.hasAttribute('data-group')) {
        text = text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }
      el.firstChild ? (el.firstChild.nodeValue = text) : (el.textContent = text);
    }

    if (reduced.matches || !('IntersectionObserver' in window)) {
      nodes.forEach(function (el) { render(el, parseFloat(el.getAttribute('data-count'))); });
      return;
    }

    nodes.forEach(function (el) {
      // Keep the final value as a text node so a trailing unit <span> survives.
      el.insertBefore(document.createTextNode('0'), el.firstChild);
      var strip = el.childNodes[1];
      if (strip && strip.nodeType === 3) strip.nodeValue = '';
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        io.unobserve(el);
        var target = parseFloat(el.getAttribute('data-count'));
        var dur = parseInt(el.getAttribute('data-duration') || '1500', 10);
        var start = performance.now();
        (function step(now) {
          var t = clamp((now - start) / dur, 0, 1);
          var eased = 1 - Math.pow(1 - t, 3);          // easeOutCubic
          render(el, target * eased);
          if (t < 1) raf(step); else render(el, target);
        })(start);
      });
    }, { threshold: 0.5 });

    nodes.forEach(function (el) { io.observe(el); });
  }

  /* ------------------------------------------------------- lazy loop video */

  /* Autoplay is a request, not a guarantee. iOS Low Power Mode and Low Data
     Mode refuse it outright, as does Safari's per-site "Never Auto-Play", and
     a refused <video> renders as a still with a play badge stamped on it.
     So playback is escalated in three steps:

       1. ask to play;
       2. if refused, ask again on the visitor's first interaction — a scroll
          or tap is enough, and one usually arrives within a second or two;
       3. if it is still refused, replace the clip with its animated GIF,
          which no autoplay policy can block.
  */

  var gestureQueue = [];
  var gestureArmed = false;
  var hasInteracted = false;
  var GESTURES = ['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'];

  // Remember that the visitor has interacted at all. A clip that is refused
  // *after* that point must not sit waiting for a gesture that already
  // happened — the first scroll arrives long before the first clip is on
  // screen, so waiting on the next one would strand every video on the page.
  GESTURES.forEach(function (e) {
    window.addEventListener(e, function () { hasInteracted = true; }, { passive: true });
  });

  function armGesture() {
    if (gestureArmed) return;
    gestureArmed = true;
    function fire() {
      GESTURES.forEach(function (e) { window.removeEventListener(e, fire); });
      gestureArmed = false;             // re-armable, so later refusals recover too
      var queued = gestureQueue.slice();
      gestureQueue.length = 0;
      queued.forEach(function (fn) { fn(); });
    }
    GESTURES.forEach(function (e) {
      window.addEventListener(e, fire, { passive: true });
    });
  }

  /* Swap a blocked clip for the GIF that already sits inside it as fallback
     content. Only ever reached when the browser has refused twice. */
  function swapToGif(v) {
    if (v.dataset.gifSwapped) return;
    var src = v.querySelector('img[src*="/gif/"]');
    if (!src) return;                       // hero has no GIF; its poster stands in
    v.dataset.gifSwapped = '1';
    var img = document.createElement('img');
    img.src = src.getAttribute('src');
    img.alt = src.getAttribute('alt') || '';
    img.className = 'gif-fallback';
    img.loading = 'lazy';
    img.decoding = 'async';
    v.replaceWith(img);
  }

  /* Promote a clip's deferred <source data-src> to a real src and start
     fetching. Shared, because both the lazy-viewport loader and the step
     timeline need it and must not each keep their own idea of what is loaded. */
  function loadSources(v) {
    if (!v || v.dataset.loaded) return;
    v.dataset.loaded = '1';
    $$('source[data-src]', v).forEach(function (s) {
      s.src = s.getAttribute('data-src');
      s.removeAttribute('data-src');
    });
    v.load();
  }

  function tryPlay(v) {
    loadSources(v);
    var p;
    try { p = v.play(); } catch (e) { p = null; }
    if (!p || !p.catch) return;

    p.catch(function () {
      var retry = function () {
        var again;
        try { again = v.play(); } catch (e) { again = null; }
        if (again && again.catch) again.catch(function () { swapToGif(v); });
      };
      if (hasInteracted) {
        // Already unlocked as far as the visitor is concerned; the refusal is
        // the browser's own policy. Give it one more go, then fall back.
        setTimeout(retry, 400);
      } else {
        gestureQueue.push(retry);
        armGesture();
      }
    });
  }

  /* Loops are muted, inline, looping MP4s. They are only fetched once they
     approach the viewport, and paused again once they leave it, so a page
     with a dozen robot clips still costs almost nothing while you read. */
  function initLazyVideo() {
    // The hero carries a real autoplay attribute, but gets the same escalation
    // so a refusal there does not leave a play badge over the first screen.
    var hero = $('.hero__bg video');
    if (hero) tryPlay(hero);

    // Clips inside the step timeline are owned by initSteps — all of them are
    // permanently on screen behind the sticky column, so viewport visibility
    // says nothing about which one should be running.
    var vids = $$('video[data-lazy-video]').filter(function (v) {
      return !v.closest('[data-visual]');
    });
    if (!vids.length) return;

    if (!('IntersectionObserver' in window)) {
      vids.forEach(tryPlay);
      return;
    }

    // Wider margin for fetching than for playing, so a clip is decoded and
    // ready by the time it is actually on screen.
    var fetchIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { loadSources(e.target); fetchIO.unobserve(e.target); } });
    }, { rootMargin: '600px 0px' });

    var playIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (!v.isConnected) return;         // already swapped out for a GIF
        if (e.isIntersecting) { tryPlay(v); }
        else if (!v.paused) { v.pause(); }
      });
    }, { threshold: 0.12 });

    vids.forEach(function (v) { fetchIO.observe(v); playIO.observe(v); });
  }

  /* ------------------------------------------------------------- progress */

  function initProgressBar() {
    var bar = $('.progress');
    if (!bar) return;
    onFrame(function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      var p = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
      bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    });
  }

  function initRail() {
    var rails = $$('.rail');
    if (!rails.length) return;
    onFrame(function () {
      var vh = window.innerHeight;
      rails.forEach(function (rail) {
        var fill = $('.rail__fill', rail);
        if (!fill) return;
        var host = rail.parentElement;
        var r = host.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        var p = clamp((vh * 0.55 - r.top) / r.height, 0, 1);
        fill.style.setProperty('--fill', (p * 100).toFixed(2) + '%');
      });
    });
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    initStagger();
    initReveals();
    initSplit();
    initParallax();
    initScrub();          // must run before the things that read --p
    initWords();
    initSteps();
    initScrubCounters();
    initScrollScale();
    initScenes();
    initCounters();
    initLazyVideo();
    initProgressBar();
    initRail();
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Re-run the split when the viewport changes width enough to reflow lines.
  var lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (Math.abs(window.innerWidth - lastW) < 60) return;
    lastW = window.innerWidth;
    schedule();
  }, { passive: true });
})();
