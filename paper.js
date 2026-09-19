(function () {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let preference = true;
  try { preference = localStorage.getItem('lendwiseMotion') !== 'off'; } catch { /* The account screen handles unavailable storage. */ }
  function apply() { document.documentElement.dataset.motion = preference && !reduced.matches ? 'on' : 'off'; }
  function setEnabled(value) {
    preference = Boolean(value); apply();
    try { localStorage.setItem('lendwiseMotion', preference ? 'on' : 'off'); } catch { /* Session preference still works. */ }
  }
  reduced.addEventListener('change', apply);
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled || !preference || reduced.matches) return;
    button.classList.remove('ink-tap');
    requestAnimationFrame(() => {
      if (!button.isConnected) return;
      button.classList.add('ink-tap');
      setTimeout(() => button.classList.remove('ink-tap'), 260);
    });
  });
  // Keep the two page bookmarks accurate for mouse and keyboard navigation.
  function bookmark() {
    document.querySelectorAll('.sidebar a.nav-item').forEach(link => {
      const active = link.getAttribute('href') === (location.hash === '#borrowers' ? '#borrowers' : '#overview');
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    });
  }
  window.addEventListener('hashchange', bookmark);
  window.PaperUI = { enabled: () => preference, setEnabled, reset: () => { preference = true; apply(); } };
  apply(); bookmark();
})();
