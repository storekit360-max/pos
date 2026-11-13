'use strict';

// Install before the application scripts so syntax and startup errors are
// reported in the window instead of leaving a blank white screen.
(() => {
  let reported = false;
  function show(message) {
    if (reported) return;
    reported = true;
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = `<div class="login"><div class="card"><h2>Could not load POS</h2><p class="mut">${String(message || 'An unknown startup error occurred.').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p><p>Close the app and start it again. If this keeps happening, share this message with support.</p><button class="btn btn-p" onclick="location.reload()">Retry</button></div></div>`;
  }

  window.addEventListener('error', event => {
    // Resource errors do not bubble with useful detail through ErrorEvent.
    if (event.target && event.target !== window) {
      const file = event.target.src || event.target.href || 'an application resource';
      show(`Could not load ${file}`);
      return;
    }
    const where = event.filename ? ` (${event.filename}:${event.lineno || 0})` : '';
    show(`${event.message || 'A script failed to run'}${where}`);
  }, true);

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    show(reason && reason.message ? reason.message : String(reason || 'An asynchronous startup operation failed.'));
  });
})();
