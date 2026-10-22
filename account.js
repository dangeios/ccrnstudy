/*
 * account.js — Study Hub accounts + phone↔computer progress sync (Supabase)
 *
 * One file, loaded by every app:   <script src="account.js"></script>
 * (For the CSC/CMC build, inline this file into template.html.)
 *
 * Local-first: apps keep writing localStorage exactly as today. This module only
 * moves a copy of each app's payload to/from the user's own `progress` row and
 * runs the app's EXISTING merge function. Signed-out users stay local-only.
 *
 * ── Quick wiring for an app ──────────────────────────────────────────────
 *   const sync = Account.attach('ccrn-recall', {
 *     getLocal: () => buildSyncPayload(),          // whatever was pushed to jsonbin
 *     setLocal: (merged) => { applySyncPayload(merged); render(); },
 *     merge:    (local, remote) => mergeState(local, remote),   // existing merge, untouched
 *     onStatus: (s) => setBadge(s)   // 'off' | 'saving' | 'saved' | 'synced' | 'error'
 *   });
 *   // after every local save:   sync.changed();
 *   // "Sync now" button:        sync.syncNow();
 *   // badge / account button:   Account.openModal();
 * ─────────────────────────────────────────────────────────────────────────
 */
(function (global) {
  'use strict';

  // ===== CONFIG — paste from Supabase → Project Settings → API ============
  var CONFIG = {
    url: 'https://htdfgvelmsotszvuxqoy.supabase.co',      // e.g. 'https://abcdefghijklmno.supabase.co'
    anonKey: 'sb_publishable_kopDD3QJJQBin1eDM6oqAA_Wq0SN5l5'   // the "anon public" key (or "publishable" key). Safe to embed.
  };
  // =======================================================================

  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  var TABLE = 'progress';
  var PUSH_DELAY_MS = 1200;          // same debounce as the jsonbin version
  var RESYNC_ON_FOCUS_MS = 10000;    // pull again when the tab returns, at most this often
  var KEEPALIVE_LIMIT = 60000;       // browsers cap keepalive bodies at ~64 KB

  var client = null;
  var session = null;
  var readyPromise = null;
  var authListeners = [];
  var apps = {};                     // name -> { opts, timer, dirty, busy, again, lastSync, status }

  // ---------- setup ----------
  function loadSdk() {
    if (global.supabase && global.supabase.createClient) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SDK_URL;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Couldn’t load the sign-in library. Check your connection.')); };
      document.head.appendChild(s);
    });
  }

  function configured() { return !!(CONFIG.url && CONFIG.anonKey); }

  function init(cfg) {
    var wasConfigured = configured();
    if (cfg && cfg.url) CONFIG.url = cfg.url.trim().replace(/\/+$/, '');
    if (cfg && cfg.anonKey) CONFIG.anonKey = cfg.anonKey.trim();
    if (!wasConfigured && configured()) readyPromise = null;   // config arrived after auto-init
    if (readyPromise) return readyPromise;
    if (!configured()) {
      console.info('[Account] No Supabase URL/key set — running local-only.');
      return (readyPromise = Promise.resolve(false));
    }
    readyPromise = loadSdk().then(function () {
      client = global.supabase.createClient(CONFIG.url, CONFIG.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'studyhub-auth'   // one shared session for every app on this origin
        }
      });
      client.auth.onAuthStateChange(function (event, s) {
        var before = currentUserId();
        session = s;
        var after = currentUserId();
        if (before !== after) {
          // Defer: calling Supabase inside this callback can deadlock the auth lock.
          setTimeout(function () { handleUserChange(); }, 0);
        }
      });
      return client.auth.getSession().then(function (r) {
        session = (r && r.data && r.data.session) || null;
        handleUserChange();
        return true;
      });
    }).catch(function (err) {
      console.warn('[Account]', err.message || err);
      readyPromise = null;            // allow a retry when we come back online
      return false;
    });
    return readyPromise;
  }

  function currentUserId() { return session && session.user ? session.user.id : null; }
  function user() { return session ? session.user : null; }

  function handleUserChange() {
    var u = user();
    authListeners.forEach(function (cb) { try { cb(u); } catch (e) { console.error(e); } });
    Object.keys(apps).forEach(function (name) {
      if (u) syncApp(name, 'synced');
      else setStatus(name, 'off');
    });
  }

  function onAuthChange(cb) {
    authListeners.push(cb);
    if (readyPromise) readyPromise.then(function () { cb(user()); });
    return function () { authListeners = authListeners.filter(function (f) { return f !== cb; }); };
  }

  // ---------- auth ----------
  function friendly(err) {
    var m = (err && (err.message || err.error_description)) || String(err || 'Something went wrong.');
    if (/invalid login credentials/i.test(m)) return 'That email and password don’t match an account.';
    if (/already registered|already exists/i.test(m)) return 'An account with that email already exists. Log in instead.';
    if (/password should be at least/i.test(m)) return 'Use a password with at least 6 characters.';
    if (/email not confirmed/i.test(m)) return 'Confirm your email first — check your inbox for the link.';
    if (/unable to validate email|invalid email/i.test(m)) return 'Enter a valid email address.';
    if (/failed to fetch|network/i.test(m)) return 'Can’t reach the server. Check your connection and try again.';
    if (/rate limit/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
    return m;
  }

  function requireClient() {
    return init().then(function (ok) {
      if (!ok || !client) throw new Error(configured()
        ? 'Can’t reach the sign-in service. Check your connection.'
        : 'Accounts aren’t set up yet: add the Supabase URL and key to account.js.');
      return client;
    });
  }

  function signUp(email, password) {
    return requireClient().then(function (c) {
      return c.auth.signUp({ email: email.trim(), password: password });
    }).then(function (r) {
      if (r.error) throw new Error(friendly(r.error));
      return { needsConfirmation: !r.data.session, user: r.data.user };
    });
  }

  function signIn(email, password) {
    return requireClient().then(function (c) {
      return c.auth.signInWithPassword({ email: email.trim(), password: password });
    }).then(function (r) {
      if (r.error) throw new Error(friendly(r.error));
      return r.data.user;
    });
  }

  function signOut() {
    // Push anything pending first so nothing is stranded on this device.
    var pending = Object.keys(apps).filter(function (n) { return apps[n].dirty; });
    return Promise.all(pending.map(function (n) { return syncApp(n, 'saved'); }))
      .catch(function () {})
      .then(function () { return client ? client.auth.signOut() : null; });
  }

  // ---------- data ----------
  function pull(app) {
    var uid = currentUserId();
    if (!uid) return Promise.resolve(null);
    return client.from(TABLE).select('data').eq('user_id', uid).eq('app', app).maybeSingle()
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data ? r.data.data : null;
      });
  }

  function push(app, data) {
    var uid = currentUserId();
    if (!uid) return Promise.resolve(false);
    return client.from(TABLE)
      .upsert({ user_id: uid, app: app, data: data }, { onConflict: 'user_id,app' })
      .then(function (r) { if (r.error) throw r.error; return true; });
  }

  // pull → merge(local, remote) → push. Returns the merged state.
  function sync(app, localState, merge) {
    return pull(app).then(function (remote) {
      var merged = remote ? merge(localState, remote) : localState;
      return push(app, merged).then(function () { return merged; });
    });
  }

  // Fire-and-forget upsert that survives the page closing (used on pagehide).
  function keepalivePush(app, data) {
    var uid = currentUserId();
    if (!uid || !session) return;
    var body = JSON.stringify({ user_id: uid, app: app, data: data });
    try {
      fetch(CONFIG.url + '/rest/v1/' + TABLE + '?on_conflict=user_id,app', {
        method: 'POST',
        keepalive: body.length < KEEPALIVE_LIMIT,
        headers: {
          'apikey': CONFIG.anonKey,
          'Authorization': 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: body
      }).catch(function () {});
    } catch (e) { /* page is going away; next visit re-syncs */ }
  }

  // ---------- per-app auto-sync ----------
  function setStatus(name, s) {
    var a = apps[name];
    if (!a || a.status === s) return;
    a.status = s;
    if (a.opts.onStatus) { try { a.opts.onStatus(s); } catch (e) { console.error(e); } }
  }

  function syncApp(name, doneStatus) {
    var a = apps[name];
    if (!a || !currentUserId() || !client) return Promise.resolve();
    if (a.busy) { a.again = doneStatus || 'saved'; return a.busy; }
    clearTimeout(a.timer); a.timer = null;
    a.dirty = false;
    setStatus(name, 'saving');
    var failed = false;
    a.busy = pull(name).then(function (remote) {
      var local = a.opts.getLocal();                 // read AFTER the await: freshest local state
      var merged = remote ? a.opts.merge(local, remote) : local;
      if (remote) a.opts.setLocal(merged);
      return push(name, merged);
    }).then(function () {
      a.lastSync = Date.now();
      setStatus(name, a.dirty ? 'saving' : (doneStatus || 'synced'));
    }).catch(function (err) {
      console.warn('[Account] sync failed for ' + name + ':', err && err.message || err);
      a.dirty = true;                                // retry on next change / focus / online
      failed = true;
      setStatus(name, 'error');
    }).then(function () {
      a.busy = null;
      if (failed) { a.again = null; return; }
      if (a.again || a.dirty) {
        var next = a.again || 'saved'; a.again = null;
        if (a.dirty) scheduleApp(name); else return syncApp(name, next);
      }
    });
    return a.busy;
  }

  function scheduleApp(name) {
    var a = apps[name];
    clearTimeout(a.timer);
    a.timer = setTimeout(function () { syncApp(name, 'saved'); }, PUSH_DELAY_MS);
  }

  function attach(name, opts) {
    if (!opts || !opts.getLocal || !opts.setLocal || !opts.merge) {
      throw new Error('Account.attach needs getLocal, setLocal and merge');
    }
    apps[name] = { opts: opts, timer: null, dirty: false, busy: null, again: null, lastSync: 0, status: null };
    setStatus(name, 'off');
    init().then(function (ok) { if (ok && user()) syncApp(name, 'synced'); });
    return {
      changed: function () {
        var a = apps[name];
        if (!user()) { setStatus(name, 'off'); return; }
        a.dirty = true;
        setStatus(name, 'saving');
        scheduleApp(name);
      },
      syncNow: function () { return syncApp(name, 'synced'); },
      status: function () { return apps[name].status; }
    };
  }

  function flushAll() {
    Object.keys(apps).forEach(function (name) {
      var a = apps[name];
      if (!a.dirty || !user()) return;
      clearTimeout(a.timer); a.timer = null;
      a.dirty = false;
      keepalivePush(name, a.opts.getLocal());
    });
  }

  function resyncAll() {
    if (!user()) return;
    var now = Date.now();
    Object.keys(apps).forEach(function (name) {
      var a = apps[name];
      if (a.dirty || now - a.lastSync > RESYNC_ON_FOCUS_MS) syncApp(name, 'synced');
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushAll();
    else resyncAll();                                // pick up progress made on the other device
  });
  global.addEventListener('pagehide', flushAll);
  global.addEventListener('online', function () { init().then(resyncAll); });

  // ---------- UI: account modal ----------
  var STATUS_TEXT = { off: 'Off', saving: 'Saving…', saved: 'Saved', synced: 'Synced', error: 'Save failed' };

  var CSS = '' +
    '.sh-acct-back{position:fixed;inset:0;z-index:2147483000;background:rgba(10,20,30,.45);display:flex;align-items:flex-end;justify-content:center;padding:0;}' +
    '@media(min-width:560px){.sh-acct-back{align-items:center;padding:24px;}}' +
    '.sh-acct{--a-bg:#ffffff;--a-fg:#14212b;--a-mut:#5b6b78;--a-line:#d5dde3;--a-acc:#0f6e7a;--a-acc-fg:#fff;--a-err:#b3261e;--a-ok:#1d6b3a;--a-field:#f4f7f9;' +
      'font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--a-fg);background:var(--a-bg);width:100%;max-width:420px;' +
      'border-radius:16px 16px 0 0;padding:22px 22px calc(22px + env(safe-area-inset-bottom,0px));box-shadow:0 10px 40px rgba(0,0,0,.25);box-sizing:border-box;}' +
    '@media(min-width:560px){.sh-acct{border-radius:14px;}}' +
    '@media(prefers-color-scheme:dark){.sh-acct{--a-bg:#16222b;--a-fg:#e6edf2;--a-mut:#9aabb8;--a-line:#2c3c48;--a-acc:#4fb3bf;--a-acc-fg:#08242a;--a-err:#ff8a80;--a-ok:#7fd49b;--a-field:#0f1a21;}}' +
    '.sh-acct *{box-sizing:border-box;}' +
    '.sh-acct h2{font-size:1.2rem;margin:0 0 4px;font-weight:650;}' +
    '.sh-acct p{margin:0 0 14px;color:var(--a-mut);font-size:.92rem;}' +
    '.sh-acct-tabs{display:flex;gap:4px;background:var(--a-field);border-radius:10px;padding:4px;margin:14px 0 16px;}' +
    '.sh-acct-tabs button{flex:1;border:0;background:transparent;color:var(--a-mut);font:inherit;font-size:.92rem;padding:8px;border-radius:7px;cursor:pointer;}' +
    '.sh-acct-tabs button[aria-selected=true]{background:var(--a-bg);color:var(--a-fg);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12);}' +
    '.sh-acct label{display:block;font-size:.85rem;font-weight:600;margin:0 0 4px;}' +
    '.sh-acct input{width:100%;font:inherit;padding:11px 12px;border:1px solid var(--a-line);border-radius:9px;background:var(--a-field);color:var(--a-fg);margin:0 0 12px;}' +
    '.sh-acct input:focus{outline:2px solid var(--a-acc);outline-offset:1px;}' +
    '.sh-acct .sh-acct-primary{width:100%;border:0;border-radius:10px;padding:12px;font:inherit;font-weight:650;background:var(--a-acc);color:var(--a-acc-fg);cursor:pointer;}' +
    '.sh-acct .sh-acct-primary[disabled]{opacity:.6;cursor:default;}' +
    '.sh-acct .sh-acct-ghost{border:1px solid var(--a-line);background:transparent;color:var(--a-fg);border-radius:10px;padding:10px 14px;font:inherit;cursor:pointer;}' +
    '.sh-acct button:focus-visible{outline:2px solid var(--a-acc);outline-offset:2px;}' +
    '.sh-acct-msg{min-height:1.3em;font-size:.88rem;margin:10px 0 0;}' +
    '.sh-acct-msg.err{color:var(--a-err);}.sh-acct-msg.ok{color:var(--a-ok);}' +
    '.sh-acct-who{padding:12px 14px;border:1px solid var(--a-line);border-radius:10px;margin:12px 0 16px;word-break:break-all;}' +
    '.sh-acct-row{display:flex;gap:8px;flex-wrap:wrap;}' +
    '.sh-acct-row>*{flex:1;}' +
    '.sh-acct-close{float:right;border:0;background:transparent;color:var(--a-mut);font-size:1.4rem;line-height:1;cursor:pointer;padding:2px 6px;margin:-6px -8px 0 0;}' +
    '.sh-acct-strip{font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}' +
    '.sh-acct-strip button{font:inherit;border:1px solid currentColor;background:transparent;color:inherit;border-radius:999px;padding:4px 12px;cursor:pointer;opacity:.85;}';

  function injectCss() {
    if (document.getElementById('sh-acct-css')) return;
    var st = document.createElement('style');
    st.id = 'sh-acct-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var openBack = null;

  function closeModal() {
    if (openBack) { openBack.remove(); openBack = null; document.removeEventListener('keydown', escClose); }
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }

  function openModal(mode) {
    injectCss();
    closeModal();
    var back = document.createElement('div');
    back.className = 'sh-acct-back';
    back.addEventListener('click', function (e) { if (e.target === back) closeModal(); });
    var box = document.createElement('div');
    box.className = 'sh-acct';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'sh-acct-title');
    back.appendChild(box);
    document.body.appendChild(back);
    document.addEventListener('keydown', escClose);
    openBack = back;

    function render(tab) {
      var u = user();
      var close = '<button class="sh-acct-close" aria-label="Close">×</button>';
      if (!configured()) {
        box.innerHTML = close + '<h2 id="sh-acct-title">Accounts aren’t set up yet</h2>' +
          '<p>Add your Supabase project URL and anon key to the CONFIG block at the top of account.js. Your progress is still being saved on this device.</p>';
      } else if (u) {
        box.innerHTML = close + '<h2 id="sh-acct-title">Your account</h2>' +
          '<p>Progress in every Study Hub app syncs to this account. Log in with the same email on your phone and computer.</p>' +
          '<div class="sh-acct-who">Signed in as <strong>' + esc(u.email || 'your account') + '</strong></div>' +
          '<div class="sh-acct-row"><button class="sh-acct-primary" data-act="sync">Sync now</button>' +
          '<button class="sh-acct-ghost" data-act="out">Log out</button></div>' +
          '<div class="sh-acct-msg" aria-live="polite"></div>';
      } else {
        tab = tab || mode || 'in';
        var isUp = tab === 'up';
        box.innerHTML = close + '<h2 id="sh-acct-title">Sync across your devices</h2>' +
          '<p>Sign in on your phone and computer with the same account and your progress follows you. Without an account, progress stays on this device only.</p>' +
          '<div class="sh-acct-tabs" role="tablist">' +
          '<button role="tab" data-tab="in" aria-selected="' + !isUp + '">Log in</button>' +
          '<button role="tab" data-tab="up" aria-selected="' + isUp + '">Create account</button></div>' +
          '<form novalidate>' +
          '<label for="sh-acct-email">Email</label>' +
          '<input id="sh-acct-email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" required>' +
          '<label for="sh-acct-pw">Password' + (isUp ? ' (6+ characters)' : '') + '</label>' +
          '<input id="sh-acct-pw" type="password" autocomplete="' + (isUp ? 'new-password' : 'current-password') + '" minlength="6" required>' +
          '<button class="sh-acct-primary" type="submit">' + (isUp ? 'Create account' : 'Log in') + '</button>' +
          '</form><div class="sh-acct-msg" aria-live="polite"></div>';
      }
      wire(tab);
    }

    function wire(tab) {
      var msg = box.querySelector('.sh-acct-msg');
      function say(t, kind) { if (msg) { msg.textContent = t; msg.className = 'sh-acct-msg' + (kind ? ' ' + kind : ''); } }
      box.querySelector('.sh-acct-close').onclick = closeModal;
      box.querySelectorAll('[data-tab]').forEach(function (b) {
        b.onclick = function () { render(b.getAttribute('data-tab')); };
      });
      var form = box.querySelector('form');
      if (form) {
        var email = box.querySelector('#sh-acct-email');
        setTimeout(function () { email.focus(); }, 30);
        form.onsubmit = function (e) {
          e.preventDefault();
          var pw = box.querySelector('#sh-acct-pw').value;
          var btn = form.querySelector('button[type=submit]');
          if (!email.value.trim() || !pw) { say('Enter your email and password.', 'err'); return; }
          btn.disabled = true;
          var isUp = tab === 'up';
          say(isUp ? 'Creating your account…' : 'Logging in…');
          (isUp ? signUp(email.value, pw) : signIn(email.value, pw)).then(function (r) {
            if (isUp && r.needsConfirmation) {
              btn.disabled = false;
              say('Account created. Open the confirmation email, then log in here.', 'ok');
              return;
            }
            render();
            var m = box.querySelector('.sh-acct-msg');
            if (m) { m.textContent = 'Signed in. Syncing your progress…'; m.className = 'sh-acct-msg ok'; }
          }).catch(function (err) {
            btn.disabled = false;
            say(err.message || String(err), 'err');
          });
        };
      }
      var syncBtn = box.querySelector('[data-act=sync]');
      if (syncBtn) syncBtn.onclick = function () {
        var names = Object.keys(apps);
        if (!names.length) { say('Open a study app to sync its progress.', 'ok'); return; }
        syncBtn.disabled = true; say('Syncing…');
        Promise.all(names.map(function (n) { return syncApp(n, 'synced'); })).then(function () {
          syncBtn.disabled = false;
          var failed = names.some(function (n) { return apps[n].status === 'error'; });
          say(failed ? 'Sync failed. Check your connection and try again.' : 'Synced.', failed ? 'err' : 'ok');
        });
      };
      var outBtn = box.querySelector('[data-act=out]');
      if (outBtn) outBtn.onclick = function () {
        outBtn.disabled = true; say('Logging out…');
        signOut().then(function () { render('in'); var m = box.querySelector('.sh-acct-msg'); if (m) { m.textContent = 'Logged out. Progress stays saved on this device.'; m.className = 'sh-acct-msg ok'; } });
      };
    }

    render();
    init().then(function () { if (openBack === back) render(); });
  }

  // "Signed in as …" strip for index.html / ccrn.html
  function mountStrip(el) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return;
    injectCss();
    el.classList.add('sh-acct-strip');
    function draw(u) {
      el.innerHTML = u
        ? '<span>Signed in as <strong>' + esc(u.email || 'your account') + '</strong></span><button type="button">Account</button>'
        : '<span>Progress is saved on this device only.</span><button type="button">Log in to sync</button>';
      el.querySelector('button').onclick = function () { openModal(); };
    }
    draw(user());
    onAuthChange(draw);
    init();
  }

  global.Account = {
    init: init,
    configured: configured,
    onAuthChange: onAuthChange,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    user: user,
    pull: pull,
    push: push,
    sync: sync,
    attach: attach,
    openModal: openModal,
    closeModal: closeModal,
    mountStrip: mountStrip,
    STATUS_TEXT: STATUS_TEXT
  };

  // Start restoring the session as soon as the script loads.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
})(window);