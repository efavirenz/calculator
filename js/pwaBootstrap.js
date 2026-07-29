/**
 * pwaBootstrap.js
 *
 * Registers the service worker using a relative path/scope so the
 * app works correctly when deployed under a GitHub Pages subpath
 * (https://username.github.io/reponame/). Also exposes a small
 * install-prompt helper if the browser supports beforeinstallprompt.
 */

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js', { scope: './' })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });
}

/**
 * Wires up an optional "Install" affordance. Safe no-op on browsers
 * (like iOS Safari) that don't fire beforeinstallprompt; iOS users
 * install via the Share -> Add to Home Screen flow instead.
 * @param {HTMLElement|null} installButtonEl
 */
export function setupInstallPrompt(installButtonEl) {
  if (!installButtonEl) return;
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installButtonEl.hidden = false;
  });

  installButtonEl.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installButtonEl.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installButtonEl.hidden = true;
  });
}
