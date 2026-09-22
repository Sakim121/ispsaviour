// ISP SAVIOUR 2.0 - shared auth guard.
// Include with <script src="auth.js"></script> in <head> on every
// protected page. Redirects to login.html if there's no session.
(function () {
  var raw = localStorage.getItem('isp_auth');
  if (!raw) {
    window.location.href = 'login.html';
    return;
  }
  try {
    window.ISP_AUTH = JSON.parse(raw);
    if (!window.ISP_AUTH || !window.ISP_AUTH.token) throw new Error('bad session');
  } catch (e) {
    localStorage.removeItem('isp_auth');
    window.location.href = 'login.html';
  }
})();

// Merge into a fetch() `headers` object to authenticate a write request.
function ispAuthHeaders() {
  return (window.ISP_AUTH && window.ISP_AUTH.token)
    ? { 'Authorization': 'Bearer ' + window.ISP_AUTH.token }
    : {};
}

function ispLogout() {
  localStorage.removeItem('isp_auth');
  window.location.href = 'login.html';
}

// Once the DOM is ready, fill in any elements that want to show the
// logged-in user, and wire up any ".nav-logout" element to actually log out.
document.addEventListener('DOMContentLoaded', function () {
  if (!window.ISP_AUTH) return;
  document.querySelectorAll('[data-user-email]').forEach(function (el) {
    el.textContent = window.ISP_AUTH.email;
  });
  document.querySelectorAll('[data-user-role]').forEach(function (el) {
    el.textContent = window.ISP_AUTH.role;
  });
  document.querySelectorAll('.nav-logout').forEach(function (el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', ispLogout);
  });
});
