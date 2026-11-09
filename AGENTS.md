# AGENTS.md

# Project Context

This project is an iPhone-style, installable, offline-capable Progressive Web App (PWA) calculator built with pure Vanilla HTML, CSS, and JavaScript.

- **Stack**: Vanilla HTML5, Vanilla CSS3, ES6 Modules (Vanilla JS).
- **Tooling**: No build step, no bundlers (Webpack/Vite/Parcel), no external frameworks (React/Vue/Tailwind), no backend API, no database.
- **Persistence**: `localStorage` (via `StorageManager`).
- **PWA**: `service-worker.js` and `manifest.json`.

---

# Key Architectural Constraints & Rules

1. **DOM and Logic Boundaries**:
   - Calculation/state/parser/formatting/history/storage logic must remain DOM-independent and directly testable in Node.js.
   - `app.js` is the composition root and may acquire DOM elements and wire browser events.
   - `inputController.js` translates browser events to state methods and receives callbacks for transient UI state; it must not query global `document`.
   - `uiRenderer.js` owns DOM rendering and UI mutations; avoid placing calculation or persistence logic here.

2. **No External Dependencies**:
   - Do not introduce `npm` packages, build scripts, CSS preprocessors, or CDN-hosted scripts unless explicitly instructed by the user.
   - Native browser APIs only.

3. **Security**:
   - Avoid `eval()`, `Function()`, or unsafe `innerHTML` dynamic execution.
   - Keep dynamic DOM insertion strictly sanitized and handled within `uiRenderer.js`.

---

# File Structure & Responsibilities

```
calculator/
├── index.html                 # App shell and keypad layout
├── manifest.json              # Web App Manifest
├── service-worker.js          # Offline caching strategy & lifecycle
├── generate_icons.py          # Python utility for generating PWA icon assets
├── css/
│   └── style.css              # Main layout, typography, animations, dark theme
├── js/
│   ├── app.js                 # Composition root - instantiates & wires modules
│   ├── calculatorState.js     # Token array state machine & calculation rules
│   ├── expressionParser.js    # Tokenizer, Shunting Yard algorithm, RPN evaluator
│   ├── formatUtils.js         # Token stream formatting utilities
│   ├── historyManager.js      # Calculation history management
│   ├── inputController.js     # Keyboard & click event handling
│   ├── pwaBootstrap.js        # SW registration & PWA installation prompt lifecycle
│   ├── storageManager.js      # localStorage read/write abstraction
│   └── uiRenderer.js          # DOM manipulation & screen updates
├── tests/
│   ├── format.test.js         # Display formatting & number separator tests
│   ├── parser.test.js         # Tokenizer, Shunting Yard, RPN eval tests
│   ├── state.test.js          # CalculatorState transitions & behavior tests
│   ├── inputController.test.js # Keyboard / transient UI tests
│   ├── pwa.test.js            # Precache/version/manifest static integrity tests
│   └── storage.test.js        # Persistence, validation and quota recovery tests
├── requirements-dev.txt       # Optional pinned Pillow dependency for icon generation
└── icons/                     # Generated icon files
```

---

# Testing & Verification

- **Test Runner**: Built-in Node.js test runner (`node:test`, `node:assert/strict`). No npm or external libraries.
- **Execution Command**:
  ```bash
  node --test tests/*.test.js
  ```
- **Rule**: Run test suite before and after making changes to `js/calculatorState.js`, `js/expressionParser.js`, or `js/formatUtils.js`.

---

# Guidance for AI Assistant

- **Code Modifications**: When editing JavaScript files in `js/`, preserve ES module syntax (`import`/`export`) and respect architectural boundaries.
- **Testing**: Always verify pure logic changes with `node --test tests/*.test.js`.
- **Styles**: Modify `css/style.css` using Vanilla CSS rules. Avoid adding utility-first utility classes inline in HTML unless consistent with existing layout patterns.
- **PWA Updates & Version Sync**: When altering cached files or adding assets, synchronize the release version across 4 locations:
  1. `CACHE_VERSION` in `service-worker.js`
  2. `#version-badge` text in `index.html`
  3. Version shield and release notes in `README.md`
  4. Current release summary in this `AGENTS.md` file
- **Current Release**: v7.12 (2026-11-09), with 110 passing Node tests. Display precision is 15 significant digits, matching input acceptance. Binary arithmetic closes top-level exponent mode; backspace re-derives exponent mode; value-adjacent pastes insert `×`; `+/-` on a power negates the base; failed evaluation does not mutate tokens. History is validated/capped at the storage boundary and reconciled across tabs. The history drawer is `inert` when closed with a CSS visibility fallback; display lines and the clipboard menu are keyboard-operable; focused buttons keep native `Enter`/`Space`. The service worker precaches core assets fail-hard and optional icons fail-soft, returns an explicit `504` offline response, and the version badge reloads only after a new worker activates. CI runs tests and a dynamic-code grep, then publishes only staged app files. The update flow must target only the Calculator service-worker scope and must not clear unrelated origin registrations or caches. The v7.11 focus-ring CSS change and the v7.12 touch/drawer/a11y/PWA changes still require manual confirmation on iPhone Safari/PWA. See `README.md` section 15 for release details.
- **Relative URLs & Subpath Deployment**: Maintain relative paths (`./...`) across all asset/script references for GitHub Pages subpath compatibility (`https://<username>.github.io/<reponame>/`). Never use root-relative paths (`/...`).
- **Local Serving**: ES modules and Service Worker require HTTP/HTTPS origin (`python3 -m http.server 8080` or `npx serve .`). Opening via `file://` fails.
