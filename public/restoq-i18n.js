/* Restoq – oversettelse i nettleseren.
 * Norsk er originalen. På andre språk byttes tekstene ut med ordboka i /i18n/<språk>.json
 * (pluss rettelser fra utviklersiden). Tall og datoer i en tekst erstattes med {0}, {1} … før oppslag,
 * så «3 varer · 2 407 kr» slås opp som «{0} varer · {1} kr». Bare ren tekst endres, aldri HTML.
 * Tekster uten oversettelse meldes til /api/i18n/missing og vises på utviklersiden. */
(function () {
  "use strict";
  var html = document.documentElement;
  var lang = html.getAttribute("lang") || "nb";
  var SKIP = "script,style,noscript,textarea,input,code,pre,.iname,[data-no-translate],[translate='no'],.notranslate";
  var ATTRS = ["placeholder", "aria-label", "title", "alt"];
  var TOKEN = /(?:^|(?<=[\s(«]))(?:man|tir|ons|tor|fre|lør|søn) \d{1,2}\.\d{1,2}\.\d{2}|\d+(?:[   .,:/]\d+)*/g;
  var WD = {
    en: { man: "Mon", tir: "Tue", ons: "Wed", tor: "Thu", fre: "Fri", "lør": "Sat", "søn": "Sun" },
    de: { man: "Mo", tir: "Di", ons: "Mi", tor: "Do", fre: "Fr", "lør": "Sa", "søn": "So" },
    pl: { man: "pon", tir: "wt", ons: "śr", tor: "czw", fre: "pt", "lør": "sob", "søn": "nd" },
    es: { man: "lun", tir: "mar", ons: "mié", tor: "jue", fre: "vie", "lør": "sáb", "søn": "dom" },
  };
  var norm = function (s) { return s.replace(/\s+/g, " ").trim(); };

  function split(text) {
    var vals = [];
    var key = text.replace(TOKEN, function (m) { vals.push(m); return "{" + (vals.length - 1) + "}"; });
    return { key: key, vals: vals };
  }
  function fill(tpl, vals) {
    return tpl.replace(/\{(\d+)\}/g, function (m, i) {
      var v = vals[+i];
      if (v == null) return m;
      var w = /^(man|tir|ons|tor|fre|lør|søn) (.*)$/.exec(v);
      return w && WD[lang] ? WD[lang][w[1]] + " " + w[2] : v;
    });
  }
  var worthy = function (s) {
    if (s.length < 2 || s.length > 400 || !/\p{L}/u.test(s)) return false;
    var letters = s.replace(/[^\p{L}]/gu, "");
    var upper = letters.replace(/[^\p{Lu}]/gu, "");
    if (letters.length <= 4 && upper.length === letters.length) return false; // koder som «SG»
    if (/@|^Restoq$|^rq_/.test(s)) return false; // e-post, merkenavn og nøkler
    return !(letters.length > 3 && upper.length / letters.length > 0.7); // varenavn med store bokstaver er data
  };

  var dict = null, missing = {}, missTimer = 0;
  var orig = new WeakMap(), attrOrig = new WeakMap();

  function one(t) {
    if (dict[t] != null) return dict[t];
    var s = split(t);
    if (s.vals.length && dict[s.key] != null) return fill(dict[s.key], s.vals);
    // Bare tall og datoer («ons 25.11.26»): ukedagen oversettes
    if (s.vals.length && /^[\s{}\d·.,:;()–-]*$/.test(s.key)) { var f = fill(s.key, s.vals); return f !== t ? f : null; }
    return null;
  }
  function lookup(text) {
    var t = norm(text);
    if (!t || !dict) return null;
    var r = one(t);
    if (r != null) return r;
    // Sammensatte linjer («Kjøl · Drikke · telles i») oversettes del for del; varenavn og koder blir stående
    if (t.indexOf(" · ") > -1) {
      var parts = t.split(" · "), hit = false;
      var out = parts.map(function (p) { var x = one(p); if (x != null) { hit = true; return x; } return p; });
      return hit ? out.join(" · ") : null;
    }
    if (worthy(t)) { var s = split(t); missing[s.vals.length ? s.key : t] = 1; queueMissing(); }
    return null;
  }
  function queueMissing() {
    clearTimeout(missTimer);
    missTimer = setTimeout(function () {
      var list = Object.keys(missing).slice(0, 100);
      missing = {};
      if (!list.length) return;
      fetch("/api/i18n/missing", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ lang: lang, strings: list, path: location.pathname + location.hash }) }).catch(function () {});
    }, 3000);
  }

  function apply(root) {
    if (!dict || !root) return;
    var start = root.nodeType === 3 ? root.parentNode : root;
    if (!start || (start.closest && start.closest(SKIP))) return;
    var w = document.createTreeWalker(start, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.nodeValue && n.nodeValue.trim() && !(n.parentElement && n.parentElement.closest(SKIP)) ? 1 : 2; },
    });
    for (var n = w.nextNode(); n; n = w.nextNode()) {
      var cur = norm(n.nodeValue), known = orig.get(n);
      if (known && known.out === cur) continue; // allerede oversatt
      var t = lookup(cur);
      if (t != null && norm(t) !== cur) {
        var lead = n.nodeValue.match(/^\s*/)[0], trail = n.nodeValue.match(/\s*$/)[0];
        n.nodeValue = lead + t + trail;
        orig.set(n, { src: cur, out: norm(t) });
      }
    }
    if (start.nodeType !== 1) return;
    var els = [start].concat(Array.prototype.slice.call(start.querySelectorAll("[placeholder],[aria-label],[title],[alt]")));
    els.forEach(function (el) {
      if (el.closest("[data-no-translate],[translate='no'],.notranslate")) return;
      var st = attrOrig.get(el) || {};
      ATTRS.forEach(function (a) {
        var v = el.getAttribute(a);
        if (!v || !v.trim() || st[a] === v) return;
        var t = lookup(v);
        if (t != null) { el.setAttribute(a, t); st[a] = t; }
      });
      attrOrig.set(el, st);
    });
  }

  function start() {
    apply(document.body);
    html.classList.remove("i18n-wait");
    var pending = [], raf = 0;
    var mo = new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === "characterData") pending.push(m.target);
        else if (m.type === "attributes") pending.push(m.target);
        else m.addedNodes.forEach(function (x) { pending.push(x); });
      });
      if (!raf) raf = requestAnimationFrame(function () {
        raf = 0;
        var roots = pending; pending = [];
        roots.forEach(function (r) { if (r.isConnected) apply(r); });
        mo.takeRecords(); // våre egne endringer skal ikke gi en ny runde
      });
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // Til utviklere og verktøy: alle oversettbare tekster på siden akkurat nå (som nøkler)
  window.restoqI18n = {
    lang: lang,
    collect: function () {
      var out = {};
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.nodeValue && n.nodeValue.trim() && !(n.parentElement && n.parentElement.closest(SKIP)) ? 1 : 2; } });
      var add1 = function (s) { s = norm(s); if (!worthy(s)) return; var x = split(s); out[x.vals.length ? x.key : s] = 1; };
      var add = function (s) { s = norm(s); if (s.indexOf(" · ") > -1) s.split(" · ").forEach(add1); else add1(s); };
      for (var n = w.nextNode(); n; n = w.nextNode()) add(n.nodeValue);
      document.querySelectorAll("[placeholder],[aria-label],[title],[alt]").forEach(function (el) { if (!el.closest("[data-no-translate],[translate='no']")) ATTRS.forEach(function (a) { var v = el.getAttribute(a); if (v) add(v); }); });
      return Object.keys(out);
    },
  };

  if (lang === "nb") return;
  var v = html.getAttribute("data-i18n-v") || "1";
  Promise.all([
    fetch("/i18n/" + lang + ".json?v=" + v).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    fetch("/api/i18n/overrides?lang=" + lang).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
  ]).then(function (res) {
    dict = Object.assign({}, res[0], res[1]);
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  });
})();
