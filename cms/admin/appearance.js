const root = document.documentElement;
const systemAppearance = window.matchMedia('(prefers-color-scheme: dark)');

function applyAppearance(dark) {
  root.classList.toggle('dark', dark);
  window.dispatchEvent(new Event('appearancechange'));
}

function loadAppearance() {
  const preference = localStorage.getItem('appearance');
  applyAppearance(preference === 'dark' || (preference !== 'light' &&
    (__SITE_DEFAULT_APPEARANCE__ === 'dark' || (__SITE_AUTO_APPEARANCE__ && systemAppearance.matches))));
}

loadAppearance();
if (__SITE_AUTO_APPEARANCE__) {
  systemAppearance.addEventListener('change', event => {
    if (localStorage.getItem('appearance') === null) applyAppearance(event.matches);
  });
}
window.addEventListener('storage', event => {
  if (event.key === 'appearance' || event.key === null) loadAppearance();
});
