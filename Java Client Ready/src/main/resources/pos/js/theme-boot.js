'use strict';
// Apply the last known shop theme before the stylesheet paints. The cache is
// only a presentation hint; authenticated cloud data remains authoritative.
(() => {
  let accent = '#f97316', dark = false;
  try {
    const tenant = location.hostname.split('.')[0] || 'main';
    const cached = JSON.parse(localStorage.getItem(`thesmart_pos_theme:${tenant}`) || 'null');
    if (cached && /^#[0-9a-f]{6}$/i.test(cached.accent || '')) accent = cached.accent;
    dark = !!cached?.dark;
  } catch (_) {}
  document.documentElement.style.setProperty('--acc', accent);
  document.documentElement.style.setProperty('--acc2', accent);
  if (dark) document.documentElement.classList.add('dark');
})();