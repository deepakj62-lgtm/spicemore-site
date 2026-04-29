/* Spicemore unified auth overlay.
 * Drop into any page with: <script src="/assets/auth.js" defer></script>
 *
 * Behavior:
 *   - On load, calls /api/auth/me. If 401, blocks page with a sign-in modal.
 *   - On successful login, sets sessionStorage.smtc_auth='true' and
 *     sessionStorage.smtc_attend_auth='true' for backward compat with existing gates.
 *   - If user.mustChangePassword, forces a "Set new password" step before unlocking.
 *   - Adds a small "Sign out" pill in the top-right of authed pages.
 *   - Exposes window.spicemoreAuth = { user, logout(), getUser() }.
 *
 * Vanilla JS, dependency-free, mobile-friendly. Brand color: #2C5F2D (Spicemore green).
 */
(function () {
  if (window.__spicemoreAuthLoaded) return;
  window.__spicemoreAuthLoaded = true;

  var GREEN = '#2C5F2D';
  var GREEN_DARK = '#1F4520';
  var CREAM = '#FAF7F0';

  var state = { user: null };

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'style') n.style.cssText = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  }

  function injectStyles() {
    if ($('sm-auth-styles')) return;
    var css = ''
      + '#sm-auth-overlay{position:fixed;inset:0;z-index:2147483600;background:rgba(20,30,20,0.55);'
      + 'display:flex;align-items:center;justify-content:center;padding:20px;'
      + 'font-family:Poppins,system-ui,-apple-system,Segoe UI,sans-serif;backdrop-filter:blur(4px)}'
      + '#sm-auth-card{background:' + CREAM + ';border-radius:16px;max-width:400px;width:100%;'
      + 'padding:32px 28px;box-shadow:0 20px 60px rgba(0,0,0,0.3);box-sizing:border-box}'
      + '#sm-auth-card h2{margin:0 0 6px;font-family:Syne,Poppins,sans-serif;font-size:22px;color:#1a1a1a;font-weight:700}'
      + '#sm-auth-card .sm-sub{margin:0 0 20px;color:#555;font-size:13px;line-height:1.4}'
      + '#sm-auth-card label{display:block;font-size:12px;color:#444;margin:12px 0 6px;font-weight:500}'
      + '#sm-auth-card input{width:100%;padding:11px 13px;border:1px solid #d4cdbf;border-radius:9px;'
      + 'font-size:14px;font-family:inherit;box-sizing:border-box;background:#fff;outline:none;transition:border-color .15s}'
      + '#sm-auth-card input:focus{border-color:' + GREEN + '}'
      + '#sm-auth-card button.primary{width:100%;margin-top:18px;padding:12px;border:0;border-radius:9px;'
      + 'background:' + GREEN + ';color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .15s}'
      + '#sm-auth-card button.primary:hover{background:' + GREEN_DARK + '}'
      + '#sm-auth-card button.primary:disabled{opacity:.6;cursor:wait}'
      + '#sm-auth-err{display:none;margin-top:10px;color:#b91c1c;font-size:12.5px}'
      + '#sm-auth-logo{font-family:Syne,sans-serif;font-weight:700;color:' + GREEN + ';font-size:14px;'
      + 'letter-spacing:1.5px;margin-bottom:14px;text-transform:uppercase}'
      + '#sm-logout-pill{position:fixed;top:14px;right:14px;z-index:2147483500;background:#fff;'
      + 'border:1px solid #d4cdbf;color:#333;padding:7px 12px;border-radius:999px;font-size:12px;'
      + 'font-family:Poppins,system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.08);'
      + 'display:flex;align-items:center;gap:6px;transition:all .15s}'
      + '#sm-logout-pill:hover{background:' + GREEN + ';color:#fff;border-color:' + GREEN + '}'
      + '#sm-logout-pill .who{color:#666;font-size:11px}'
      + '#sm-logout-pill:hover .who{color:#e6f0e6}'
      + '@media (max-width:480px){#sm-logout-pill .who{display:none}}'
      + '';
    var s = el('style', { id: 'sm-auth-styles' });
    s.textContent = css;
    document.head.appendChild(s);
  }

  function removeOverlay() {
    var ov = $('sm-auth-overlay');
    if (ov) ov.remove();
  }

  function showLoginOverlay() {
    injectStyles();
    removeOverlay();
    var ov = el('div', { id: 'sm-auth-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sign in' });
    ov.innerHTML = ''
      + '<div id="sm-auth-card">'
      + '<div id="sm-auth-logo">SPICEMORE</div>'
      + '<h2>Sign in</h2>'
      + '<p class="sm-sub">Enter your registered mobile number and password.</p>'
      + '<form id="sm-auth-form" autocomplete="on">'
      + '<label for="sm-auth-user">Mobile number</label>'
      + '<input id="sm-auth-user" name="username" type="tel" inputmode="numeric" autocomplete="username" placeholder="10-digit mobile" required />'
      + '<label for="sm-auth-pass">Password</label>'
      + '<input id="sm-auth-pass" name="password" type="password" autocomplete="current-password" required />'
      + '<button class="primary" type="submit">Sign in</button>'
      + '<div id="sm-auth-err"></div>'
      + '</form>'
      + '</div>';
    document.body.appendChild(ov);
    $('sm-auth-user').focus();
    $('sm-auth-form').addEventListener('submit', onLoginSubmit);
  }

  function showChangePasswordOverlay(opts) {
    var voluntary = !!(opts && opts.voluntary);
    injectStyles();
    removeOverlay();
    var ov = el('div', { id: 'sm-auth-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Set new password' });
    var subText = voluntary
      ? 'Choose a new password (at least 6 characters, not your mobile number).'
      : 'Choose a password (at least 6 characters, not your mobile number).';
    var cancelHtml = voluntary ? '<button id="sm-cp-cancel" type="button" class="secondary" style="background:#fff;color:#666;border:1px solid #ddd;margin-top:8px">Cancel</button>' : '';
    ov.innerHTML = ''
      + '<div id="sm-auth-card">'
      + '<div id="sm-auth-logo">SPICEMORE</div>'
      + '<h2>' + (voluntary ? 'Change password' : 'Set a new password') + '</h2>'
      + '<p class="sm-sub">' + subText + '</p>'
      + '<form id="sm-cp-form">'
      + '<label for="sm-cp-cur">Current password</label>'
      + '<input id="sm-cp-cur" type="password" autocomplete="current-password" required />'
      + '<label for="sm-cp-new">New password</label>'
      + '<input id="sm-cp-new" type="password" autocomplete="new-password" minlength="6" required />'
      + '<label for="sm-cp-new2">Confirm new password</label>'
      + '<input id="sm-cp-new2" type="password" autocomplete="new-password" minlength="6" required />'
      + '<button class="primary" type="submit">Update password</button>'
      + cancelHtml
      + '<div id="sm-auth-err"></div>'
      + '</form>'
      + '</div>';
    document.body.appendChild(ov);
    $('sm-cp-cur').focus();
    $('sm-cp-form').addEventListener('submit', onChangePasswordSubmit);
    if (voluntary) {
      $('sm-cp-cancel').addEventListener('click', function () {
        removeOverlay();
        mountLogoutPill();
      });
    }
  }

  function showError(msg) {
    var e = $('sm-auth-err');
    if (!e) return;
    e.textContent = msg;
    e.style.display = 'block';
  }

  function onLoginSubmit(e) {
    e.preventDefault();
    var btn = e.target.querySelector('button.primary');
    var u = $('sm-auth-user').value.trim();
    var p = $('sm-auth-pass').value;
    btn.disabled = true; btn.textContent = 'Signing in...';
    fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (!res.j || !res.j.ok) {
          btn.disabled = false; btn.textContent = 'Sign in';
          showError((res.j && res.j.error) || 'Sign-in failed');
          return;
        }
        onAuthSuccess(res.j.user);
      })
      .catch(function () {
        btn.disabled = false; btn.textContent = 'Sign in';
        showError('Network error. Try again.');
      });
  }

  function onChangePasswordSubmit(e) {
    e.preventDefault();
    var btn = e.target.querySelector('button.primary');
    var cur = $('sm-cp-cur').value;
    var n1 = $('sm-cp-new').value;
    var n2 = $('sm-cp-new2').value;
    if (n1 !== n2) { showError('New passwords do not match'); return; }
    if (n1.length < 6) { showError('New password must be at least 6 characters'); return; }
    if (state.user && n1 === state.user.mobile) { showError('New password cannot equal your mobile number'); return; }
    btn.disabled = true; btn.textContent = 'Updating...';
    fetch('/api/auth/change-password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: cur, newPassword: n1 }),
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (!res.j || !res.j.ok) {
          btn.disabled = false; btn.textContent = 'Update password';
          showError((res.j && res.j.error) || 'Update failed');
          return;
        }
        onAuthSuccess(res.j.user);
      })
      .catch(function () {
        btn.disabled = false; btn.textContent = 'Update password';
        showError('Network error. Try again.');
      });
  }

  function onAuthSuccess(user) {
    state.user = user;
    try {
      sessionStorage.setItem('smtc_auth', 'true');
      sessionStorage.setItem('smtc_attend_auth', 'true');
      if (user && user.name) sessionStorage.setItem('smtc_user', user.name);
    } catch (_) {}
    if (user && user.mustChangePassword) {
      showChangePasswordOverlay();
      return;
    }
    removeOverlay();
    mountLogoutPill();
    document.dispatchEvent(new CustomEvent('spicemore-auth-ready', { detail: { user: user } }));
  }

  function mountLogoutPill() {
    if ($('sm-logout-pill')) return;
    injectStyles();
    var pill = el('div', { id: 'sm-logout-pill' });
    var who = state.user ? (state.user.name || state.user.mobile || '') : '';
    pill.innerHTML =
        '<span class="who">' + escapeHtml(who) + '</span>'
      + '<button id="sm-change-pwd-btn" type="button" title="Change password" style="background:transparent;border:0;color:#666;font:inherit;cursor:pointer;padding:0;text-decoration:underline">Change password</button>'
      + '<span style="color:#ccc">·</span>'
      + '<button id="sm-logout-btn" type="button" title="Sign out" style="background:transparent;border:0;color:#666;font:inherit;cursor:pointer;padding:0;text-decoration:underline">Sign out</button>';
    document.body.appendChild(pill);
    $('sm-change-pwd-btn').addEventListener('click', function () {
      showChangePasswordOverlay({ voluntary: true });
    });
    $('sm-logout-btn').addEventListener('click', logout);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function logout() {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      .catch(function () {})
      .then(function () {
        try {
          sessionStorage.removeItem('smtc_auth');
          sessionStorage.removeItem('smtc_attend_auth');
          sessionStorage.removeItem('smtc_user');
        } catch (_) {}
        location.reload();
      });
  }

  function bootstrap() {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.status === 200 && res.j && res.j.ok) {
          state.user = res.j.user;
          try {
            sessionStorage.setItem('smtc_auth', 'true');
            sessionStorage.setItem('smtc_attend_auth', 'true');
            if (res.j.user && res.j.user.name) sessionStorage.setItem('smtc_user', res.j.user.name);
          } catch (_) {}
          if (res.j.user && res.j.user.mustChangePassword) {
            showChangePasswordOverlay();
          } else {
            mountLogoutPill();
            document.dispatchEvent(new CustomEvent('spicemore-auth-ready', { detail: { user: res.j.user } }));
          }
        } else {
          try {
            sessionStorage.removeItem('smtc_auth');
            sessionStorage.removeItem('smtc_attend_auth');
          } catch (_) {}
          showLoginOverlay();
        }
      })
      .catch(function () {
        showLoginOverlay();
      });
  }

  window.spicemoreAuth = {
    getUser: function () { return state.user; },
    logout: logout,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
