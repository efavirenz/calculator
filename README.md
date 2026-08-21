# Calculator

An iPhone-style calculator built as an installable, offline-capable Progressive
Web App (PWA) — vanilla HTML/CSS/JS, no frameworks, no build step, no CDN.

![version](https://img.shields.io/badge/version-v6.6-blue)
![platform](https://img.shields.io/badge/stack-vanilla%20JS%20%2F%20HTML%20%2F%20CSS-informational)
![license](https://img.shields.io/badge/license-MIT-green)

---

## 1. Overall Architecture

The app follows a strict **separation between business logic and the DOM**:

```
┌─────────────────────────────────────────────────────────┐
│                        app.js                            │
│           (composition root — wires everything)          │
└───────────┬───────────────────┬───────────────┬──────────┘
            │                   │                │
   ┌────────▼────────┐ ┌────────▼────────┐ ┌─────▼─────────┐
   │ CalculatorState  │ │ InputController │ │ HistoryManager │
   │ (data + rules)   │ │ (DOM/keyboard   │ │ (list + cap +  │
   │  no DOM access   │ │  event -> state)│ │  persistence)  │
   └────────┬─────────┘ └─────────────────┘ └───────┬────────┘
            │                                        │
   ┌────────▼─────────┐                    ┌─────────▼────────┐
   │ ExpressionParser  │                    │  StorageManager  │
   │ (tokenize/RPN/eval│                    │  (localStorage)  │
   │  no DOM, no state)│                    └──────────────────┘
   └────────────────────┘

   ┌────────────────────┐        ┌───────────────────┐
   │    UIRenderer       │◄───────┤   FormatUtils      │
   │ (pure DOM updates)  │        │ (token -> plain txt)│
   └─────────────────────┘        └────────────────────┘

   ┌─────────────────────┐
   │   PWABootstrap       │  registers service-worker.js, install prompt
   └──────────────────────┘
```

**Business logic never touches the DOM.** `CalculatorState` and
`expressionParser.js` are plain JavaScript classes/functions you could run in
Node with zero changes. `uiRenderer.js` is the only module that reads/writes
`document`. `inputController.js` is the bridge: it listens for clicks/keys and
calls methods on `CalculatorState`, then asks `app.js` to re-render.

## 2. Folder Structure

```
calculator-pwa/
├── index.html                 # App shell + keypad markup
├── manifest.json              # PWA manifest (relative paths)
├── service-worker.js          # Offline cache, versioned
├── generate_icons.py          # One-off script used to produce icons/*.png
├── css/
│   └── style.css
├── js/
│   ├── app.js                 # Composition root
│   ├── calculatorState.js     # Token model + calculator rules
│   ├── expressionParser.js    # Tokenizer, Shunting Yard, RPN eval
│   ├── formatUtils.js         # Token stream -> plain text (history)
│   ├── historyManager.js      # History list (cap, order)
│   ├── inputController.js     # DOM/keyboard event -> state calls
│   ├── pwaBootstrap.js        # Service worker registration
│   ├── storageManager.js      # localStorage read/write
│   └── uiRenderer.js          # All DOM mutation
├── icons/                     # App icons (see generate_icons.py)
├── .github/workflows/deploy.yml
├── LICENSE
└── README.md (this file)
```

## 3. Data Flow

1. A button click or keyboard press hits `InputController`.
2. `InputController` dispatches to a `CalculatorState` mutator method
   (`inputDigit`, `inputOperator`, `inputPower`, `inputReciprocal`, `evaluate`,
   `backspace`, `clearAll`, ...).
3. `CalculatorState` mutates its internal token array and, on `=`, calls into
   `expressionParser.js` to evaluate.
4. `app.js`'s `render()` callback reads the new state and calls
   `uiRenderer.renderDisplay(...)` to update the DOM.
5. On a successful `=`, `app.js` also pushes an entry into `HistoryManager`,
   which persists it via `storageManager.js` (`localStorage`).

No component reaches "sideways" into another's internals — everything flows
through `app.js`.

## 4. State Management

`CalculatorState` owns:

- `tokens`: an ordered array of `{ char, kind, isExponent, hidden }` objects —
  the single source of truth for "what's on screen and what will be
  evaluated."
- `displayState`: `'A'` (live entry) or `'B'` (result shown), matching the
  two display states in the spec.
- `exponentMode`: whether subsequently typed digits should be marked
  `isExponent` (active between pressing `x^y` and the next operator/`)`/`=`).
- `errorMessage`: non-null when the last evaluation failed.

Tokens carry two independent flags used purely for **rendering**, not
evaluation:

- `isExponent` — render inside a `<sup>` (superscript).
- `hidden` — never render at all, but still contributes its character to the
  raw expression string sent to the parser.

This lets the internal expression stay a normal, parseable string
(`1+(12)^(-1)`) while the screen shows `1+(12)⁻¹` with no visible `^` or
grouping parens around the exponent — see §7.

## 5. UI Wireframe

```
┌──────────────────────────────┐
│ ☰                    Install │  <- topbar (history / install)
│                               │
│                    1 + 2      │  <- upper display (State B only)
│                          9    │  <- lower display (live entry / result)
│                               │
│  (    )    1/x    xʸ         │  row 1: extended function row
│  AC   ⌫    +/-    ÷          │  row 2
│  7    8    9      ×          │  row 3
│  4    5    6      −          │  row 4
│  1    2    3      +          │  row 5
│  0 (wide)   .     =          │  row 6
└──────────────────────────────┘
```

## 6. Component Responsibilities

| Module                | Responsibility                                                        | Depends on            |
|------------------------|-------------------------------------------------------------------------|------------------------|
| `expressionParser.js` | Tokenize → Shunting Yard → RPN eval. Zero UI/state knowledge.          | nothing                |
| `calculatorState.js`  | Token stream mutations, display-state transitions, calls the parser.   | `expressionParser.js`  |
| `uiRenderer.js`       | Renders tokens/state to DOM; toggles disabled/aria attributes.         | DOM only               |
| `inputController.js`  | Delegated click + keyboard listeners → `CalculatorState` method calls. | `calculatorState.js`   |
| `historyManager.js`   | In-memory history list: newest-first, 50-item cap.                     | `storageManager.js`    |
| `storageManager.js`   | `localStorage` read/write with try/catch guards.                       | nothing                |
| `formatUtils.js`      | Token stream → plain-text string (Unicode superscripts) for history.   | nothing                |
| `pwaBootstrap.js`     | Registers `service-worker.js`, force update on badge tap, wires optional install prompt. | nothing                |
| `app.js`              | Composition root: instantiates everything, wires callbacks.            | all of the above       |

## 7. Expression Engine Design

**Tokenizer → Shunting Yard → RPN evaluator, no `eval()`.**

- Precedence (high → low): `^` (right-assoc) → unary minus → `×` `÷` →
  binary `+` `-`. This makes `-2^2` evaluate to `-4` (unary minus applies
  *after* exponentiation), matching standard mathematical convention and most
  scientific calculators.
- `^` is right-associative: `2^3^2` evaluates as `2^(3^2) = 512`.
- Unary minus is a distinct RPN operator (`u-`) so `3+-12` and a leading `-5`
  both parse correctly without contaminating binary subtraction.
- Floating point cleanup: results are rounded to 12 significant digits
  (`toPrecision(12)`) before display, and `-0` is normalized to `0`, so e.g.
  `0.1 + 0.2` displays as `0.3`, not `0.30000000000000004`.

### Superscript rendering (`x^y`, `1/x`)

The underlying token stream always uses a real `^` character so the parser
can evaluate it — but that `^` token is always flagged `hidden: true`, so it
never reaches the screen. Exponent *values* are flagged `isExponent: true`,
which `uiRenderer.js` renders inside a `<sup>` element.

- **`x^y`**: inserts a hidden `^` and flips on "exponent entry mode." Every
  digit/decimal typed while that mode is active is tagged `isExponent`.
  Pressing any operator, `)`, or `=` ends the mode (per spec).
- **`1/x`**: rewraps the trailing operand as `(operand)^(-1)`. The parens
  around the *operand* are real, visible tokens (so `1+12` → `1+(12)⁻¹`
  visibly keeps the `(12)`). The parens wrapping `-1` and the `^` itself are
  all `hidden: true` — only the raised `-1` shows.

### `(` / `)` balance-based buttons

`CalculatorState.parenBalance` is a getter (count of unmatched `(` tokens).
`)` is disabled (both the on-screen button via `aria-disabled`/`disabled`,
and the keyboard `)` key) whenever balance is `0`.

**Ambiguity resolved:** if `=` is pressed with unclosed parentheses, the app
**auto-closes them** (append the missing `)` characters) rather than showing
a syntax error. This matches how iOS's own calculator quietly recovers from
minor input mistakes instead of blocking the user with an error state.

### `+/-` (sign toggle)

Toggles a leading unary `-` on the trailing operand (number or fully-closed
parenthesized group). If the calculator is showing a result (State B),
toggles the sign of the result directly and starts a fresh expression from
that negated value — the standard iOS behavior of continuing from the
result.

## 8. Local Storage Design

Key: `calculator.history.v1` → JSON array of:

```json
{ "id": "...", "timestamp": 1690000000000, "tokens": [...], "expression": "1+2³", "result": "9" }
```

- Newest entries are unshifted to the front; the array is trimmed to 50
  items after every insert.
- All reads/writes go through `storageManager.js`, which wraps every call in
  `try/catch` so a full/blocked storage quota (e.g. Safari private mode)
  degrades gracefully to an empty, non-persisted history instead of crashing
  the app.
- Tapping a history entry re-runs that calculation's **result** as a fresh
  input (common "reuse a past value" UX), then closes the panel.

## 9. PWA Architecture

- `manifest.json` + `service-worker.js` provide installability and offline
  support. The service worker precaches the full app shell (HTML, CSS, JS,
  icons) on `install`, using a **cache-first** strategy with a network
  fallback for anything else same-origin.
- **Versioned cache**: `CACHE_NAME = calculator-cache-v6.5`. The `activate`
  handler deletes any cache whose name starts with `calculator-cache-` and
  doesn't match the current version. **Release process:** bump
  `CACHE_VERSION` in `service-worker.js` on every deploy that changes a
  cached file, so returning users don't get stuck on stale assets. Tapping
  the version badge in the topbar automatically purges old caches and reloads.
- **GitHub Pages subpath compatibility**: every path in `manifest.json`,
  `service-worker.js`, and `index.html` is relative (`./...`), and
  `start_url` / `scope` are both `"./"`. This is required because GitHub
  Pages project sites serve from `https://username.github.io/reponame/`, not
  the domain root — any leading-`/` absolute path would 404 there even
  though it works fine on `localhost`.
- **iOS Safari specifics**: iOS does not fully honor `manifest.json` for
  "Add to Home Screen," so `index.html` also includes
  `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`,
  `apple-mobile-web-app-title`, and explicit `apple-touch-icon` links (152,
  167, 180px) — iOS ignores maskable icons and picks its own icon otherwise.
- **Module loading requirement**: `index.html` loads `app.js` as
  `type="module"`, which browsers block under `file://`. **You must serve
  this app over `http://`/`https://`** (a local static server is enough) for
  both ES module imports and the service worker to work — service workers
  are unavailable under `file://` entirely. See §11 for a local-server
  command.

## 10. Accessibility

- Full keyboard support: digits, `+ - × ÷ ^`, `(` `)` (respecting the same
  balance-based disable rule as the on-screen button), `Enter`/`=` for
  equals, `Escape` for AC, `Backspace`/`Delete` for backspace.
- `)` button exposes `aria-disabled` + the native `disabled` attribute when
  balance is 0.
- All interactive elements are real `<button>`s with visible
  `:focus-visible` outlines and ≥44px touch targets.
- The display region uses `aria-live="polite"` so screen readers announce
  new results.
- History items are keyboard-operable (`Enter`/`Space`) with `role="button"`.

## 11. Running Locally

ES modules and the service worker both require an HTTP(S) origin — opening
`index.html` directly via `file://` will not work.

```bash
# any static file server works, for example:
npx serve .
# or
python3 -m http.server 8080
```

Then visit `http://localhost:<port>/`.

## 12. Deploying to GitHub Pages

1. Push this repository to GitHub (branch `main`).
2. In the repo's **Settings → Pages**, set **Source** to "GitHub Actions."
3. The included workflow (`.github/workflows/deploy.yml`) builds and deploys
   automatically on every push to `main` — no build step is needed since this
   is a static vanilla-JS app.
4. Your app will be live at `https://<username>.github.io/<reponame>/`.
   Because every path in this project is relative (see §9), no code changes
   are required to deploy under that subpath.
5. **After any deploy that changes a cached file** (HTML/CSS/JS/icons), bump
   `CACHE_VERSION` in `service-worker.js` first, or returning visitors may
   keep seeing the old cached version.

## 13. Testing Checklist

- [ ] All operators evaluate correctly, including `^` precedence/right-assoc
      (`2^3^2` = 512, `-2^2` = -4)
- [ ] Nested parentheses evaluate correctly
- [ ] `)` is disabled exactly when paren balance is 0 (mouse + keyboard)
- [ ] `1/x` wraps the trailing operand and renders `⁻¹` as superscript
- [ ] `x^y` enters/exits exponent mode correctly and renders superscript
- [ ] Wide `0` button spans 2 grid columns
- [ ] Decimal math and malformed-decimal guard (`.` cannot be entered twice)
- [ ] Consecutive calculations (operator after `=` continues from result)
- [ ] AC fully resets state
- [ ] Backspace: State A deletes trailing token; State B deletes trailing digit of result and clears upper display
- [ ] History persists across reloads, caps at 50, newest first
- [ ] Clear History requires confirmation
- [ ] App works offline after first load (airplane mode test)
- [ ] "Add to Home Screen" on iPhone Safari launches full-screen, correct icon
- [ ] Lighthouse: Performance / Accessibility / Best Practices / PWA all ≥95

## 14. Ambiguity Decisions Log

Per the "most iOS-like behavior, document the decision" rule:

1. **Unclosed parentheses on `=`**: auto-close rather than error (§7).
2. **Precedence of unary minus relative to `^`**: unary minus binds *looser*
   than `^` (so `-2^2 = -4`), matching standard math/most calculators.
3. **`+/-` on a mid-expression operand**: toggles a leading unary `-`
   immediately before the trailing number/paren-group, rather than requiring
   the operand to be re-typed.
4. **Typography**: all button text is white (including the function row),
   per the "White typography" requirement — a deliberate departure from
   Apple's own black-on-light-gray function buttons, consistent with this
   app's fully custom color palette.
5. **History item tap**: re-runs the entry's *result* as a fresh calculation
   (rather than only previewing it), which is the more useful default for
   reusing a past value in a new calculation.
6. **Exponent-mode interrupted by `(`**: since the spec only lists digits and
   the decimal point as continuing exponent-entry mode, pressing `(` ends
   exponent mode and starts a new normal-size term (same rule as pressing an
   operator).

## 15. Version History

### v6.6 — 2026-08-21
 
#### 📱 Landscape Keypad Layout for iPhone
 
- **6×4 Landscape Grid Layout** — Added dedicated CSS landscape layout (`@media (orientation: landscape) and (max-height: 550px)`) switching the 4×6 portrait keypad to a 6×4 grid. Digits (0–9, .) remain grouped on the left (columns 1–3) preserving muscle memory, while functions and operators (, ), ÷, 1/x, xʸ, ×, AC, ⌫, −, +/−, +, = are placed on the right (columns 4–6).
- **Landscape Display & Topbar Scaling** — Scaled display lines and topbar height in landscape mode to prevent bottom rows from overflowing on iPhone screens.
- **Safe Area Insets** — Respects landscape safe area insets for notches, dynamic islands, and home indicators.

### v6.5 — 2026-08-01

#### 🐛 Double-Input Touch Fix

- **Pointer/Click Event Synchronization Fix** — Fixed input controller state bug where `lastPointerType` flag was cleared in a microtask before synthetic `click` events executed, causing duplicate button press dispatches.

### v6.4 — 2026-08-01

#### 🛠 Audit Fixes & Quality Hardening

- **Scientific Notation Re-Tokenization Fix** — Replaced invalid `toLocaleString('fullwide')` call with explicit `toFixed()` and zero stripping in `_tokensFromString()` to ensure correct re-entry from scientific notation results across all browsers.
- **Exponent Mode Backspace Fix** — Fixed state bug where backspacing past an exponent digit cleared `exponentMode` despite the hidden `^` operator remaining in the token stream.
- **Forward Scanning Pre-Decimal Digit Limit** — Refactored `_leadingDigitLimitReached()` to scan forward from start of current number, preventing digit limit bypasses via backspace sequences and allowing post-decimal digits without restriction.
- **Lexer & Parser Hardening** — Disallowed bare `.` inputs in lexer (`Malformed decimal number`), guarded `inputCloseParen()` against trailing operators, and ensured immutable returns from `evaluate()`.
- **Test Suite Expansion** — Expanded test coverage from 6 to 22 test cases (`node --test`), covering state transitions, formatting utilities, and parser edge cases.

### v6.3 — 2026-08-01

#### 🔢 Leading-Zero Display Suppression

- **Strip leading zeros from display** — Numbers typed with leading zeros (e.g. `0,001` entered via copy-paste or thousands-separator input) now render without the redundant leading zeros in both State A (lower display) and State B (upper display). `0,001+0,002` shows as `1+2`. The fix is purely cosmetic — evaluation uses the raw token stream unchanged.
  - New `stripLeadingZeros()` helper in `formatUtils.js` strips the integer-part leading zeros while preserving a mandatory `0` before a decimal point (`0.5` stays `0.5`).
  - `uiRenderer.js` applies `stripLeadingZeros()` before `addThousandsSeparators()` when rendering digit/decimal token runs.
  - `tokensToPlainText()` in `formatUtils.js` refactored to group digit/decimal runs and apply the same stripping, so history entries match the display.

### v6.2 — 2026-07-29

#### 📱 iOS Safari UI Lock, Rapid Tap Fix & Copy to Clipboard

- **iOS Safari UI Lock & Overscroll Prevention** — Locked container overscroll bounce using `overscroll-behavior: none`, `position: fixed` layout rules, `touch-action: manipulation`, and non-scrollable `touchmove` prevention, preventing the UI/keypad from bouncing up/shifting during swipes or rapid taps.
- **Immediate Touch Response & Rapid Tap Fix** — Switched keypad event handling to `pointerdown` with `preventDefault()`, eliminating iOS 300ms touch delay and preventing dropped inputs during rapid button pressing.
- **Tap Lower Display to Copy + Toast** — Tapping the lower display line copies the displayed text/result to the system clipboard and triggers a smooth floating `Copied` notification toast.
- **Interactive Version Badge & SW Force Update** — Updated `CACHE_VERSION` to `v6.2` with automatic service worker checks on launch. Tapping the `v6.2` version badge unregisters service workers, clears `CacheStorage`, and reloads to guarantee instantaneous client updates.

### v6.1 — 2026-07-29

#### 🛡️ Comprehensive Code Audit & Remediation

- **Performance Reflow Fix** — Replaced `while` loop font auto-scaling in `autoShrinkToFit` with a single-step ratio calculation, eliminating up to ~38 forced layout reflows per keystroke.
- **Custom Error Message Display** — `uiRenderer.js` now renders specific diagnostic error messages (e.g. `Division by zero`) instead of hiding them behind a generic `"Error"` text.
- **Security & XSS Hardening** — Added `<meta http-equiv="Content-Security-Policy">` header and replaced `innerHTML = ''` DOM clears with `replaceChildren()`.
- **LocalStorage Data Validation** — `loadHistory()` now filters and validates stored entry shapes to prevent crashes from corrupted entries.
- **Mathematical Edge Cases** — `0^(-1)` reciprocal power evaluated as `Division by zero` error. Corrected `_tokensFromString` scientific notation expansion.
- **Automated Unit Test Suite** — Added 11 automated unit tests (`tests/parser.test.js`, `tests/state.test.js`) using Node.js native test runner.

### v6 — 2026-07-29

#### 🧼 Auto-Trim Trailing Operators on Evaluation

- **Graceful Trailing Operator Trimming** — Tapping `=` when an expression ends with binary operators (e.g. `61+`, `12+3+`, or `5×10÷`) now automatically strips trailing operator tokens before evaluating. The upper display shows the sanitized expression (e.g. `61` or `12+3`) and lower display displays the calculation result, preventing unnecessary syntax `Error` states.

### v5 — 2026-07-29

#### 🛠️ Error Recovery & Display Fix

- **Visible Upper Display on Error** — Ensure `upperEl.style.display = ''` when `errorMessage` is set so invalid expressions (e.g. `61+`) are displayed on the upper line while lower display shows `Error`.
- **Tap Upper Display to Recover Expression** — Tapping the upper display during an `Error` state now clears the error and moves the invalid expression (`61+`) down to the lower display (State A) so the user can fix it.
- **Smart Backspace on Error** — Tapping `Backspace` in an `Error` state now clears the error and removes the trailing invalid character (e.g. `61+` → `61`) instead of resetting the entire state.

### v4 — 2026-07-29

#### 🚀 iOS WebKit Fixes & Updated Backspace Behavior

- **Forced iOS WebKit GPU Layer Flush (Option B)** — Set `upperEl.style.display = 'none'` when in State A (and `''` in State B). This forces iOS WebKit on iPhones to completely unmount and flush the GPU layer for the upper display, guaranteeing the upper line is 100% cleared upon tapping `AC` or operators (`+`, `-`, `×`, `÷`).
- **`autoShrinkToFit` Fallback Guards** — Added numerical fallbacks (`|| 34` / `|| 18`) to `parseFloat(getComputedStyle...)` in `uiRenderer.js` so font resizing never receives `NaNpx` under mobile WebKit viewports.
- **Revised Backspace in State B** — Tapping `Backspace` while showing a result (State B) now performs a backspace directly on the result answer (lower display) while clearing the upper display and returning to State A (instead of restoring the old expression).

### v3 — 2026-07-28

#### 🐛 Bug Fixes & UX Enhancements

- **Thorough display line reset** — Explicitly clear `textContent` and reset inline `font-size` on both upper and lower display elements on every render cycle, ensuring the upper display line is completely hidden after pressing `AC` or operators (`+`, `-`, `×`, `÷`) from State B.
- **Redesigned history clear confirmation dialog** — Styled modal buttons with rounded corners (`border-radius: 10px`): `Cancel` button features a clean white background with black text, while `Clear` features a solid red background (`#FF453A`) with white text.
- **Auto-close history panel on clear** — Confirming history deletion now automatically closes the side history panel and returns to the main calculator view.
- **Keypad button press tap/fade effect** — Button press animation now features a quick opacity fade (`0.04s ease-in`) on touch followed by a smooth transition back (`0.3s ease-out`) to normal state.
- **Fixed display height for button size stability** — Locked the `.display` container height (`flex: 0 0 130px; height: 130px`) so shrinking lower-display font size when entering long numbers no longer alters container height or resizes keypad buttons.

### v2 — 2026-07-27

#### ✨ New Features

- **Thousands separators** — All numbers ≥ 1,000 are now displayed with commas
  (e.g. `1,234,567.89`). Formatting is applied in three places:
  - The live expression on the lower display (token-by-token, digit runs are
    grouped before rendering).
  - The result on the lower display (State B).
  - History entries — both the expression and the result lines.
  Exponential-notation values are left untouched. Two new helpers
  (`addThousandsSeparators`, `formatExpressionWithCommas`) were added to
  `formatUtils.js`.

- **Faithful history restore** — Tapping a history entry now loads the full
  expression *and* result exactly as they appeared right after `=` was pressed
  (State B: expression on the upper line, result on the lower line). Previously
  only the result string was re-entered digit-by-digit, losing the expression.
  - `HistoryManager.add()` now stores the raw token array alongside the
    expression string (`tokens` field in each history entry).
  - `CalculatorState.loadFromHistory(tokens, result)` restores both fields
    atomically into State B.
  - Backward-compatible: entries saved before v2 (no `tokens` field) fall back
    to the old digit-replay behaviour.

- **Tap upper display to resume editing** — In State B (result shown), clicking
  the upper display line moves the frozen expression back to the editable lower
  line without clearing it, letting the user continue editing the expression
  instead of starting fresh. Implemented via
  `CalculatorState.recallExpressionToEntry()` and a `click` listener on
  `#upper-display` wired in `app.js`.

#### 🎨 UI / CSS Improvements

- **Version badge** — A `v2` pill badge is shown in the top-right corner of the
  topbar, grouped with the Install button inside a new `.topbar-actions`
  flex container.
- **Keypad now fills available space** — The keypad uses `flex: 1 1 auto` with
  `grid-template-rows: repeat(6, 1fr)` and `min-height: 0`, removing the
  old fixed `aspect-ratio` / `max-height: 62vh` constraints so the layout
  adapts cleanly to all viewport sizes.
- **Upper display is independently scalable** — `.display-upper` and
  `.display-lower` each now carry their own `--display-max-font` /
  `--display-min-font` custom properties (34 px / 18 px for the upper line;
  64 px / 26 px for the lower line), giving finer control over the two-line
  expression display.
- **Tap cursor on upper display** — `.display-upper` gains `cursor: pointer`
  to hint that the line is interactive.
- **Wide `0` button centred** — `.btn-wide` now uses `justify-content: center`
  (previously left-aligned with an asymmetric `padding-left`).
- **Responsive short-viewport media query** — The `@media (max-height: 640px)`
  block now also reduces `.display-upper` font sizes (28 px / 16 px) in
  addition to the existing lower-display override.

#### ⚙️ Internal / Infrastructure

- **Service worker cache bumped to `v2`** — `CACHE_VERSION` in
  `service-worker.js` is updated from `v1` to `v2` so returning visitors
  receive the new assets instead of stale cached files.

---

## 16. License

MIT — see [LICENSE](./LICENSE).
