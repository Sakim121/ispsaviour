// ISP SAVIOUR 2.0 - shared runtime config.
// Include with <script src="config.js"></script> BEFORE auth.js and any
// inline script that uses BACKEND_URL. Reads the backend's URL from
// localStorage (set once on the login page, or later from Settings) so
// deploying this app never requires editing any file - just tell it
// where your backend lives, once, from the UI.

window.ISP_BACKEND_URL = localStorage.getItem('isp_backend_url') || 'http://localhost:5000';

function ispSetBackendUrl(url) {
  url = (url || '').trim().replace(/\/+$/, '');
  if (!url) return;
  localStorage.setItem('isp_backend_url', url);
  window.ISP_BACKEND_URL = url;
}
