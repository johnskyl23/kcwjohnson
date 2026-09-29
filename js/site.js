/* ==========================================================================
   site.js
   Page chrome for kcwjohnson.com: navigation, theme, section highlighting,
   the logo marquee, and the footer date stamp.
   ========================================================================== */

(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ----------------------------------------------------------------- theme */

  /* Dark by default — the robot footage reads better on black — but the
     choice is remembered, and an unset visitor follows their OS preference. */
  var THEME_KEY = 'kj-theme';

  function applyTheme(mode) {
    document.documentElement.classList.toggle('theme-light', mode === 'light');
    var meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'light' ? '#ffffff' : '#000000');
  }

  function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
    var initial = stored || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme(initial);

    var btn = $('.theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = document.documentElement.classList.contains('theme-light') ? 'dark' : 'light';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
      btn.setAttribute('aria-label', next === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    });
  }

  /* ------------------------------------------------------------------- nav */

  function initNav() {
    var nav = $('.nav');
    var links = $('.nav__links');
    var menuBtn = $('.nav__menu-btn');
    if (!nav) return;

    var lastY = window.scrollY;

    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      nav.classList.toggle('is-stuck', y > 24);
      // Hide on the way down, reveal on the way up — but never while the
      // mobile menu is open, and never at the very top of the page.
      var menuOpen = links && links.classList.contains('is-open');
      if (!menuOpen && y > 280) {
        nav.classList.toggle('is-hidden', y > lastY + 6);
      } else {
        nav.classList.remove('is-hidden');
      }
      lastY = y;
    }, { passive: true });

    if (menuBtn && links) {
      menuBtn.addEventListener('click', function () {
        var open = links.classList.toggle('is-open');
        menuBtn.setAttribute('aria-expanded', String(open));
        document.body.style.overflow = open ? 'hidden' : '';
      });
      links.addEventListener('click', function (e) {
        if (e.target.tagName !== 'A') return;
        links.classList.remove('is-open');
        menuBtn.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
      window.addEventListener('resize', function () {
        if (window.innerWidth > 940 && links.classList.contains('is-open')) {
          links.classList.remove('is-open');
          menuBtn.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        }
      });
    }
  }

  /* ----------------------------------------------- current section in nav */

  function initSectionSpy() {
    var links = $$('.nav__links a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;

    var map = {};
    var sections = [];
    links.forEach(function (a) {
      var id = a.getAttribute('href').slice(1);
      var sec = document.getElementById(id);
      if (!sec) return;
      map[id] = a;
      sections.push(sec);
    });

    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.intersectionRatio; });
      var bestId = null, best = 0;
      Object.keys(visible).forEach(function (id) {
        if (visible[id] > best) { best = visible[id]; bestId = id; }
      });
      links.forEach(function (a) { a.removeAttribute('aria-current'); });
      if (bestId && map[bestId] && best > 0.02) map[bestId].setAttribute('aria-current', 'true');
    }, { threshold: [0, 0.05, 0.25, 0.5, 0.75, 1] });

    sections.forEach(function (s) { io.observe(s); });
  }

  /* -------------------------------------------------------------- marquee */

  /* Duplicate the track once so the -50% keyframe loops seamlessly. */
  function initMarquee() {
    $$('.marquee__track').forEach(function (track) {
      if (track.dataset.cloned) return;
      track.dataset.cloned = '1';
      track.innerHTML += track.innerHTML;
    });
  }

  /* -------------------------------------------------------- footer stamp */

  function initStamp() {
    var year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    var updated = $('#updated');
    if (updated) {
      var d = new Date(document.lastModified);
      updated.textContent = isNaN(d.getTime())
        ? ''
        : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    }
  }

  /* ------------------------------------------------- de-obfuscate contact */

  /* Addresses are stored split so they are not trivially scraped, then
     reassembled into real mailto: links on load. */
  function initMail() {
    $$('[data-mail]').forEach(function (el) {
      var parts = el.getAttribute('data-mail').split('|');
      if (parts.length !== 2) return;
      var address = parts[0] + '@' + parts[1];
      el.setAttribute('href', 'mailto:' + address);
      if (!el.textContent.trim() || el.hasAttribute('data-mail-text')) el.textContent = address;
    });
  }

  function boot() {
    initTheme();
    initNav();
    initSectionSpy();
    initMarquee();
    initStamp();
    initMail();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
