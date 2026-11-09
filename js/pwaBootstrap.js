/**
 * pwaBootstrap.js
 *
 * Registers the service worker using a relative path/scope so the
 * app works correctly when deployed under a GitHub Pages subpath
 * (https://username.github.io/reponame/). Also exposes a small
 * install-prompt helper if the browser supports beforeinstallprompt.
 */

import { showToast } from './uiRenderer.js';

const UPDATE_TIMEOUT_MS = 10000;

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
 * Resolves when the supplied worker activates, when the page gets a new
 * controller, or after a bounded timeout. Never rejects.
 * @param {ServiceWorkerRegistration} registration
 * @param {ServiceWorker} worker
 * @returns {Promise<void>}
 */
function waitForActivation(registration, worker) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker.removeEventListener('statechange', onStateChange);
      navigator.serviceWorker.removeEventListener('controllerchange', finish);
      resolve();
    };
    const onStateChange = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') finish();
    };
    const timer = window.setTimeout(finish, UPDATE_TIMEOUT_MS);

    worker.addEventListener('statechange', onStateChange);
    navigator.serviceWorker.addEventListener('controllerchange', finish);
    onStateChange();
  });
}

/**
 * Wires up a scoped update action on the version badge. The badge only
 * reloads after a new worker has activated (or when there is no calculator
 * registration to update), so an "up to date" tap preserves the current
 * expression. It never clears origin-wide registrations or caches belonging
 * to other applications (AUD-012).
 * @param {HTMLElement|null} versionBadgeEl
 */
export function setupForceUpdate(versionBadgeEl) {
  if (!versionBadgeEl) return;

  const defaultBadgeText = versionBadgeEl.textContent;
  let busy = false;

  versionBadgeEl.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    versionBadgeEl.textContent = 'Checking...';

    const restoreBadge = () => {
      versionBadgeEl.textContent = defaultBadgeText;
      busy = false;
    };

    try {
      if (!('serviceWorker' in navigator)) {
        window.location.reload();
        return;
      }

      const expectedScope = new URL('./', document.baseURI).href;
      const registration = await navigator.serviceWorker.getRegistration(expectedScope);
      if (!registration || registration.scope !== expectedScope) {
        // No calculator worker controls this scope; a reload is the only way
        // to pick up new assets.
        window.location.reload();
        return;
      }

      await registration.update();

      const pending = registration.waiting || registration.installing;
      if (!pending) {
        showToast('Already up to date');
        restoreBadge();
        return;
      }

      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      showToast('Update ready — reloading');
      await waitForActivation(registration, pending);
      window.location.reload();
    } catch (err) {
      console.warn('Service worker update check failed:', err);
      showToast('Update check failed');
      restoreBadge();
    }
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
