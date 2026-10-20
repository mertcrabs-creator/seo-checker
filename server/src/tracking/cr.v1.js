/*! CrabRank v1 · CrabsMedia · çerezsiz ziyaretçi analitiği */
(function (w, d) {
  'use strict';
  try {
    if (w.__crabrank || !w.JSON || !d.querySelector || !w.URL) return;
    w.__crabrank = true;

    var nav = w.navigator;
    var script = d.currentScript || d.querySelector('script[data-key][src*="cr.v1.js"]');
    var key = script && script.getAttribute('data-key');
    if (!key || !/^crk_[A-Za-z0-9]{24}$/.test(key)) return;
    // data-api: birinci taraf (first-party) proxy ile kurulumda veri ucu
    var endpoint = script.getAttribute('data-api') || new URL(script.src).origin + '/api/t/e';
    var off = !!nav.webdriver ||
      (script.hasAttribute('data-respect-dnt') && (nav.doNotTrack === '1' || nav.globalPrivacyControl === true));

    var queue = [];
    var timer = 0;
    var cur = null; // { id, ms, sc, vs } — aktif sayfa görüntülemesi
    var firstPv = null;
    var lastPath = null;
    var lastHref = d.referrer;
    var vitals = {};
    var lastCv = {};

    var now = function () { return Date.now(); };
    var visible = function () { return d.visibilityState === 'visible'; };
    var clamp = function (v, max) { return Math.max(0, Math.min(max, Math.round(v))); };
    // Olay dinleyicilerindeki hatalar da yutulur: takip kodu sitenin konsolunu/akışını bozmaz
    var safe = function (fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { /* yoksay */ } }; };

    function rid() {
      var c = 'abcdefghijklmnopqrstuvwxyz0123456789', a = new Uint8Array(12), s = '';
      w.crypto.getRandomValues(a);
      for (var i = 0; i < 12; i++) s += c[a[i] % 36];
      return s;
    }

    // Sorgu dizesi ve parça gönderilmez (e-posta, token gibi kişisel veriler URL'de olabilir)
    function cleanUrl(u) {
      if (!u) return undefined;
      try {
        var x = new URL(u);
        return ((x.origin && x.origin !== 'null' ? x.origin : x.protocol + '//' + x.host) + x.pathname).slice(0, 2000);
      } catch (e) {
        return undefined;
      }
    }

    function timezone() {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return undefined; }
    }

    function flush() {
      clearTimeout(timer);
      timer = 0;
      while (queue.length && !off) {
        var body = JSON.stringify({
          k: key, e: queue.splice(0, 30), w: w.screen ? clamp(w.screen.width, 20000) : undefined,
          tz: timezone(), l: (nav.language || '').slice(0, 35) || undefined,
        });
        var sent = false;
        try { sent = !!(nav.sendBeacon && nav.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }))); } catch (e) { /* yoksay */ }
        if (!sent && w.fetch) {
          try {
            w.fetch(endpoint, { method: 'POST', body: body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } })['catch'](function () {});
          } catch (e) { /* yoksay */ }
        }
      }
    }

    function push(event, delay) {
      if (off) return;
      queue.push(event);
      if (queue.length >= 30 || delay === 0) return flush();
      if (!timer) timer = setTimeout(flush, delay);
    }

    function measureScroll() {
      if (!cur) return;
      var h = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0);
      var pct = h > 0 ? Math.round(Math.min(1, (w.scrollY + w.innerHeight) / h) * 100) : 100;
      if (pct > cur.sc) cur.sc = pct;
    }

    function endPage() {
      if (!cur) return;
      if (cur.vs) {
        cur.ms += now() - cur.vs;
        cur.vs = visible() ? now() : 0;
      }
      push({ t: 'en', id: cur.id, ms: clamp(cur.ms, 14400000), sc: clamp(cur.sc, 100) }, 2000);
    }

    var pageview = safe(function () {
      if (off) return;
      var path = w.location.pathname || '/';
      if (cur && path === lastPath) return; // replaceState / aynı sayfa
      endPage();
      lastPath = path;
      var q = new URLSearchParams(w.location.search);
      var utm = {}, names = { s: 'utm_source', m: 'utm_medium', c: 'utm_campaign', t: 'utm_term' }, hasUtm = false;
      for (var k in names) {
        var v = q.get(names[k]);
        if (v) { utm[k] = v.slice(0, 200); hasUtm = true; }
      }
      var paid = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'dclid'].some(function (p) { return q.has(p); });
      cur = { id: rid(), ms: 0, sc: 0, vs: visible() ? now() : 0 };
      if (!firstPv) firstPv = cur.id;
      push({ t: 'pv', id: cur.id, p: path.slice(0, 500), r: cleanUrl(lastHref), u: hasUtm ? utm : undefined, g: paid || undefined }, 1000);
      lastHref = w.location.origin + path; // SPA geçişlerinde bir sonraki sayfanın referrer'ı
      measureScroll();
    });

    function conversion(kind, name) {
      if (!cur) return;
      var sig = kind + '|' + (name || '');
      if (now() - (lastCv[sig] || 0) < 1500) return;
      lastCv[sig] = now();
      push({ t: 'cv', id: cur.id, k: kind, n: name ? String(name).slice(0, 120) : undefined }, 0);
    }

    // Gerçek kullanıcı Web Vitals (yalnızca ilk/tam sayfa yüklemesi için)
    function sendVitals() {
      if (!firstPv || (vitals.lcp === undefined && vitals.cls === undefined && vitals.inp === undefined)) return;
      push({
        t: 'wv', id: firstPv,
        lcp: vitals.lcp === undefined ? undefined : clamp(vitals.lcp, 120000),
        cls: vitals.cls === undefined ? undefined : Math.min(50, Math.round(vitals.cls * 10000) / 10000),
        inp: vitals.inp === undefined ? undefined : clamp(vitals.inp, 60000),
      }, 2000);
    }

    function observe(type, cb, extra) {
      try {
        var po = new PerformanceObserver(function (list) { list.getEntries().forEach(cb); });
        var opts = { type: type, buffered: true };
        for (var k in extra) opts[k] = extra[k];
        po.observe(opts);
      } catch (e) { /* desteklenmiyor */ }
    }

    observe('largest-contentful-paint', function (en) { vitals.lcp = en.startTime; });
    var clsWin = 0, clsFirst = 0, clsLast = 0;
    observe('layout-shift', function (en) {
      if (en.hadRecentInput) return;
      if (clsWin && en.startTime - clsLast < 1000 && en.startTime - clsFirst < 5000) clsWin += en.value;
      else { clsWin = en.value; clsFirst = en.startTime; }
      clsLast = en.startTime;
      vitals.cls = Math.max(vitals.cls || 0, clsWin);
    });
    observe('event', function (en) { if (en.interactionId) vitals.inp = Math.max(vitals.inp || 0, en.duration); }, { durationThreshold: 40 });
    observe('first-input', function (en) { vitals.inp = Math.max(vitals.inp || 0, en.duration); });

    // Kod eklemeden dönüşümler: telefon, WhatsApp, e-posta, form ve data-crabrank-conversion="ad"
    d.addEventListener('click', safe(function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      var custom = t.closest('[data-crabrank-conversion]');
      if (custom) return conversion('custom', custom.getAttribute('data-crabrank-conversion') || 'custom');
      var a = t.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (/^tel:/i.test(href)) conversion('phone', href.slice(4).replace(/[^\d+]/g, ''));
      else if (/^mailto:/i.test(href)) conversion('email', href.slice(7).split('?')[0]);
      else if (/^whatsapp:|^(https?:)?\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com)(\/|\?|$)/i.test(href)) {
        var m = href.match(/wa\.me\/(\d+)|phone=(\d+)/);
        conversion('whatsapp', m ? m[1] || m[2] : 'whatsapp');
      }
    }), true);

    function formName(f) {
      if (!f || !f.getAttribute) return 'form';
      return f.getAttribute('id') || f.getAttribute('name') || f.getAttribute('aria-label') || cleanUrl(f.getAttribute('action') && new URL(f.getAttribute('action'), w.location.href).href) || 'form';
    }

    // Form alanlarının içeriği asla okunmaz; yalnızca "gönderildi" bilgisi
    d.addEventListener('submit', safe(function (e) {
      var f = e.target;
      if (!f || f.tagName !== 'FORM') return;
      var hint = (f.getAttribute('class') || '') + ' ' + (f.getAttribute('id') || '') + ' ' + (f.getAttribute('action') || '');
      if (f.getAttribute('role') === 'search' || f.querySelector('input[type="search"]') || /search|arama/i.test(hint)) return;
      if (/\bwpcf7-form\b/.test(f.getAttribute('class') || '')) return; // Contact Form 7: başarılı gönderim olayı beklenir
      conversion('form', formName(f));
    }), true);
    d.addEventListener('wpcf7mailsent', safe(function (e) {
      var id = e.detail && e.detail.contactFormId;
      conversion('form', id ? 'cf7-' + id : formName(e.target && e.target.closest ? e.target.closest('form') : null));
    }));

    var ticking = false;
    w.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      w.requestAnimationFrame(safe(function () { ticking = false; measureScroll(); }));
    }, { passive: true });

    var leave = safe(function () { endPage(); sendVitals(); flush(); });
    d.addEventListener('visibilitychange', function () {
      if (!cur) return;
      if (visible()) cur.vs = now();
      else leave();
    });
    w.addEventListener('pagehide', leave);
    w.addEventListener('pageshow', function (e) { if (e.persisted) { lastPath = null; pageview(); } }); // geri/ileri önbelleği

    // Tek sayfa uygulamaları (React, Vue, Next...): adres değişimleri sayfa görüntülemesi sayılır
    ['pushState', 'replaceState'].forEach(function (name) {
      var orig = w.history[name];
      if (typeof orig !== 'function') return;
      w.history[name] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(pageview, 0);
        return r;
      };
    });
    w.addEventListener('popstate', function () { setTimeout(pageview, 0); });

    // Komut arayüzü: crabrank('conversion', 'randevu') · crabrank('optout') · crabrank('optin') · crabrank('pageview')
    var pending = (w.crabrank && w.crabrank.q) || [];
    var api = safe(function (cmd, arg) {
      if (cmd === 'conversion') conversion('custom', arg || 'custom');
      else if (cmd === 'optout') { off = true; queue.length = 0; }
      else if (cmd === 'optin') { off = false; if (!cur) pageview(); }
      else if (cmd === 'pageview') { lastPath = null; pageview(); }
    });
    w.crabrank = api;

    // Önce izin komutları (optout/optin), sonra ilk sayfa görüntüleme, en son diğerleri (ör. erken çağrılan dönüşümler)
    var start = function () {
      var consent = function (c) { return c && (c[0] === 'optout' || c[0] === 'optin'); };
      for (var i = 0; i < pending.length; i++) if (consent(pending[i])) api.apply(null, pending[i]);
      if (!cur) pageview();
      for (var j = 0; j < pending.length; j++) if (!consent(pending[j])) api.apply(null, pending[j]);
    };
    if (d.prerendering) d.addEventListener('prerenderingchange', start, { once: true });
    else start();
  } catch (e) {
    /* takip hiçbir koşulda siteyi bozmaz */
  }
})(window, document);
