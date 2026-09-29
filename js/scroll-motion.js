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

  /* Loops are muted, inline, looping MP4s. They are only fetched once they
     approach the viewport, and paused again once they leave it, so a page
     with a dozen robot clips still costs almost nothing while you read. */
  function initLazyVideo() {
    var vids = $$('video[data-lazy-video]');
    if (!vids.length) return;

    function load(v) {
      if (v.dataset.loaded) return;
      v.dataset.loaded = '1';
      $$('source[data-src]', v).forEach(function (s) {
        s.src = s.getAttribute('data-src');
        s.removeAttribute('data-src');
      });
      v.load();
    }

    if (!('IntersectionObserver' in window)) {
      vids.forEach(function (v) { load(v); v.play().catch(function () {}); });
      return;
    }

    // Wider margin for fetching than for playing, so a clip is decoded and
    // ready by the time it is actually on screen.
    var fetchIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { load(e.target); fetchIO.unobserve(e.target); } });
    }, { rootMargin: '600px 0px' });

    var playIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) {
          load(v);
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else if (!v.paused) {
          v.pause();
        }
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
