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

  const register = () => {
    navigator.serviceWorker
      .register('./service-worker.js', { scope: './' })
      .then((reg) => {
        // Check for updated service worker script on app launch
        reg.update();
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register);
  }
}

/**
 * Wires up a scoped update action on the version badge. It never clears
 * origin-wide registrations or caches belonging to other applications.
 * @param {HTMLElement|null} versionBadgeEl
 */
export function setupForceUpdate(versionBadgeEl) {
  if (!versionBadgeEl) return;

  versionBadgeEl.addEventListener('click', async () => {
    versionBadgeEl.textContent = 'Checking...';
    try {
      if ('serviceWorker' in navigator) {
        const expectedScope = new URL('./', document.baseURI).href;
        const registration = await navigator.serviceWorker.getRegistration(expectedScope);
        if (registration && registration.scope === expectedScope) {
          await registration.update();
        }
      }
    } catch (err) {
      console.warn('Service worker update check failed:', err);
    }
    window.location.reload();
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
