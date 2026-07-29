# ANTIGRAVITY.md

# Project Context

This project is an iPhone-style, installable, offline-capable Progressive Web App (PWA) calculator built with pure Vanilla HTML, CSS, and JavaScript.

- **Stack**: Vanilla HTML5, Vanilla CSS3, ES6 Modules (Vanilla JS).
- **Tooling**: No build step, no bundlers (Webpack/Vite/Parcel), no external frameworks (React/Vue/Tailwind), no backend API, no database.
- **Persistence**: `localStorage` (via `StorageManager`).
- **PWA**: `service-worker.js` and `manifest.json`.

---

# Key Architectural Constraints & Rules

1. **Strict DOM Separation**:
   - Business logic (`CalculatorState`, `expressionParser.js`) **must never touch the DOM**. They should remain pure JS modules testable in Node.js environments.
   - `uiRenderer.js` is the **only** module allowed to inspect or mutate `document` or DOM elements.
   - `inputController.js` bridges DOM events (clicks/keypresses) to state methods.
   - `app.js` serves as the composition root wiring logic to UI.

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
└── icons/                     # Generated icon files
```

---

# Guidance for AI Assistant

- **Code Modifications**: When editing JavaScript files in `js/`, preserve ES module syntax (`import`/`export`) and respect architectural boundaries.
- **Styles**: Modify `css/style.css` using Vanilla CSS rules. Avoid adding utility-first utility classes inline in HTML unless consistent with existing layout patterns.
- **PWA Updates**: If altering cached files or adding assets, remember to update cache versioning in `service-worker.js`.
