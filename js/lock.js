/* ==========================================================================
   Lock — username and password before the app can be used.

   The first launch asks to set up an account; after that the intro screen
   asks to sign in (js/intro.js shows the form). The password is never
   stored: only a PBKDF2-SHA-256 hash (310,000 iterations, random salt) in
   this browser / desktop profile. Wrong attempts add a growing wait.

   While locked, work that would touch data or the network waits:
   PlootsLock.whenUnlocked(fn) runs fn after sign-in (plugins, the Claude
   bridge, the Kobo auto-reopen use it).

   The app can be locked again from the top bar (Lock) or after a period
   without activity (Account → Auto-lock). Forgetting the password can only
   be solved by resetting, which removes the account and the app's data
   saved on this device.

   This is a lock for this device, not encryption: someone with the app's
   files and the know-how can get past it.
   ========================================================================== */
(function () {
  "use strict";

  var KEY = "ploots-lock";
  var TRIES = "ploots-lock-tries";
  var ITER = 310000;
  var DBS = ["ploots-plugins", "ploots-files"];

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function save(o) { localStorage.setItem(KEY, JSON.stringify(o)); }
  function b64(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
  function unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }

  function derive(password, salt, iter) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iter }, k, 256);
    });
  }
  function same(a, b) {
    a = new Uint8Array(a); b = new Uint8Array(b);
    if (a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }
  function normUser(u) { return String(u || "").trim().toLowerCase(); }

  var unlocked = false, waiters = [], lockListeners = [], unlockListeners = [];

  function tries() { try { return JSON.parse(localStorage.getItem(TRIES) || '{"n":0,"until":0}'); } catch (e) { return { n: 0, until: 0 }; } }
  function setTries(t) { try { localStorage.setItem(TRIES, JSON.stringify(t)); } catch (e) { } }

  var L = window.PlootsLock = {
    configured: function () { var c = load(); return !!(c && c.hash); },
    user: function () { var c = load(); return c ? c.display || c.user : ""; },
    isUnlocked: function () { return unlocked; },
    // Seconds to wait before the next attempt (0 when free).
    waitSeconds: function () { return Math.max(0, Math.ceil((tries().until - Date.now()) / 1000)); },

    setup: function (user, password) {
      if (!normUser(user)) return Promise.reject(new Error("Enter a username."));
      if (String(password).length < 8) return Promise.reject(new Error("Use at least 8 characters for the password."));
      var salt = crypto.getRandomValues(new Uint8Array(16));
      return derive(password, salt, ITER).then(function (h) {
        var c = load() || {};
        save(Object.assign(c, { v: 1, user: normUser(user), display: String(user).trim(), salt: b64(salt), hash: b64(h), iter: ITER, created: c.created || Date.now(), autoLockMin: c.autoLockMin || 0 }));
        setTries({ n: 0, until: 0 });
        return true;
      });
    },

    verify: function (user, password) {
      var c = load();
      if (!c) return Promise.resolve(true);
      var wait = L.waitSeconds();
      if (wait) return Promise.reject(new Error("Too many attempts. Try again in " + wait + " s."));
      return derive(password, unb64(c.salt), c.iter || ITER).then(function (h) {
        var ok = normUser(user) === c.user && same(h, unb64(c.hash));
        var t = tries();
        if (ok) { setTries({ n: 0, until: 0 }); return true; }
        t.n += 1;
        if (t.n >= 3) t.until = Date.now() + Math.min(300, Math.pow(2, t.n - 2) * 5) * 1000;
        setTries(t);
        throw new Error(t.until > Date.now() ? "Wrong username or password. Wait " + L.waitSeconds() + " s." : "Wrong username or password.");
      });
    },

    unlock: function () {
      if (unlocked) return;
      unlocked = true;
      waiters.splice(0).forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
      unlockListeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
      armIdle();
    },
    // Runs once, after the first sign-in (or now when already unlocked).
    whenUnlocked: function (fn) { if (unlocked) fn(); else waiters.push(fn); },
    // Runs after every sign-in, including after a later Lock.
    onUnlock: function (fn) { unlockListeners.push(fn); },

    lock: function () {
      if (!L.configured()) return;
      unlocked = false;
      lockListeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
      if (window.PlootsIntro) window.PlootsIntro.lockScreen();
    },
    onLock: function (fn) { lockListeners.push(fn); },

    autoLockMinutes: function () { var c = load(); return c ? c.autoLockMin || 0 : 0; },
    setAutoLock: function (min) { var c = load(); if (!c) return; c.autoLockMin = +min || 0; save(c); armIdle(); },

    changePassword: function (current, user, next) {
      var c = load();
      return L.verify(c ? c.display || c.user : "", current).then(function () { return L.setup(user || c.display || c.user, next); });
    },
    remove: function (current) {
      var c = load();
      return L.verify(c ? c.display || c.user : "", current).then(function () { localStorage.removeItem(KEY); localStorage.removeItem(TRIES); return true; });
    },

    // Forgot password: remove the account and the app's saved data here.
    reset: function () {
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) { }
      return Promise.all(DBS.map(function (n) { return new Promise(function (res) { var r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; }); }))
        .then(function () { location.reload(); });
    }
  };

  // Auto-lock after a period without mouse / keyboard activity.
  var idleTimer = 0, last = Date.now();
  function armIdle() {
    clearInterval(idleTimer);
    var min = L.autoLockMinutes();
    if (!min || !L.configured()) return;
    last = Date.now();
    idleTimer = setInterval(function () { if (unlocked && Date.now() - last > min * 60000) L.lock(); }, 15000);
  }
  ["mousemove", "mousedown", "keydown", "wheel", "touchstart"].forEach(function (ev) {
    window.addEventListener(ev, function () { last = Date.now(); }, { passive: true, capture: true });
  });

  // Lock button in the top bar (only when an account exists).
  function addLockButton() {
    var right = document.querySelector(".topbar-right");
    if (!right || document.getElementById("appLockBtn")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.id = "appLockBtn";
    b.className = "theme-toggle-btn app-lock-btn";
    b.title = "Lock GIS Consultant Studio";
    b.innerHTML = '<span class="material-symbols-outlined">lock</span>';
    b.addEventListener("click", function () { L.lock(); });
    right.appendChild(b);
    b.hidden = !L.configured();
  }
  L.refreshButton = function () { var b = document.getElementById("appLockBtn"); if (b) b.hidden = !L.configured(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addLockButton); else addLockButton();
})();
