# Calculator

An iPhone-style calculator built as a installable, offline-capable Progressive
Web App (PWA) — vanilla HTML/CSS/JS, no frameworks, no build step, no CDN.

![version](https://img.shields.io/badge/version-v2-blue)
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
| `pwaBootstrap.js`     | Registers `service-worker.js`, wires optional install prompt.          | nothing                |
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
{ "id": "...", "timestamp": 1690000000000, "expression": "1+2³", "result": "9" }
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
- **Versioned cache**: `CACHE_NAME = calculator-cache-v1`. The `activate`
  handler deletes any cache whose name starts with `calculator-cache-` and
  doesn't match the current version. **Release process:** bump
  `CACHE_VERSION` in `service-worker.js` on every deploy that changes a
  cached file, so returning users don't get stuck on stale assets.
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
- [ ] Backspace: State A deletes a character; State B moves the expression
      back down and clears the result first
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
