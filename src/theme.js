// Reddit to AI - theme bootstrap. Load synchronously in <head> so the page
// paints in the right theme. `uiTheme` lives in chrome.storage.sync
// ("auto" | "dark" | "light"); localStorage mirrors it for a flash-free read.
(function () {
  const root = document.documentElement;
  const KEY = 'r2ai-ui-theme';

  function apply(theme) {
    if (theme === 'dark' || theme === 'light') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }

  try {
    apply(localStorage.getItem(KEY));
  } catch {
    // localStorage unavailable; storage.sync below still applies the theme.
  }

  if (typeof chrome === 'undefined' || !chrome.storage?.sync) return;

  chrome.storage.sync.get({ uiTheme: 'auto' }, (items) => {
    const theme = items?.uiTheme || 'auto';
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  });

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'sync' || !changes.uiTheme) return;
    const theme = changes.uiTheme.newValue || 'auto';
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  });
})();
