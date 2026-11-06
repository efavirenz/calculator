# Comprehensive Project Audit — Calculator PWA

**Audit date:** 2026-11-06  
**Project:** `calculator`  
**Scope:** Application source, tests, PWA manifest/service worker, styles, documentation, icon generator, and Serena project configuration.  
**Method:** Static source review, targeted Node.js reproductions, JavaScript syntax checks, asset inspection, and full automated test run. No application source files were modified during this audit.

## Executive Assessment

The project has a coherent, dependency-free PWA architecture, a custom arithmetic parser that avoids `eval()`, sensible use of text-only DOM rendering, guarded `localStorage` access, and a substantial pure-logic test suite. The existing 64 tests pass, all JavaScript files pass `node --check`, the seven declared icon assets have the expected image dimensions, and the PWA cache version is synchronized at `v7.7` across the service worker, HTML badge, and README.

The audit nevertheless found several confirmed correctness defects in clipboard input and incomplete exponent entry. More importantly, the version-badge force-update action clears every service-worker registration and CacheStorage entry for the current origin, potentially disrupting unrelated applications hosted under the same origin (for example, sibling GitHub Pages project sites). These should be fixed before treating the app as production-ready.

**Production-readiness conclusion:** Good baseline, but **not yet fully production-ready**. Prioritize `PWA-01`, `CALC-01` through `CALC-04`, and `UI-01`; then add browser-level regression tests for the DOM, pointer, clipboard, and service-worker paths. This is a source audit, not a live cross-browser deployment certification.

## Audit Execution and Verification

| Check | Result | Evidence / limitation |
|---|---|---|
| Existing automated tests | **64 passed, 0 failed** | `node --test tests/*.test.js`; exit code 0; duration about 190 ms |
| JavaScript syntax | **Passed** | `node --check` for every `js/*.js` file |
| Whitespace / patch check | **Passed** | `git diff --check` |
| Dynamic HTML / script injection scan | **No dangerous sink found** | No application use of `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function` |
| PWA icon files | **Passed** | `file icons/*.png` confirms 152, 167, 180, 192, and 512 px dimensions as declared |
| Version synchronization | **Passed** | `service-worker.js`, `index.html`, and README all show `v7.7` |
| Browser / real-device verification | **Not performed** | No browser automation or deployed-device session was available in this audit |
| Build / lint | **Not applicable / not configured** | No package manifest, build step, linter, or formatter configuration is present; project intentionally uses native browser and Node APIs |

### Findings Summary Table

| ID | Severity | Category | Title | Status |
| -- | -------- | -------- | ----- | ------ |
| PWA-01 | High | Reliability / PWA | Force-update deletes all service workers and caches for the origin | Confirmed |
| CALC-01 | High | Functional | Pasted unary minus replaces the preceding binary operator | Confirmed |
| CALC-02 | Medium | Functional | Pasted values can be silently truncated at the input digit limit | Confirmed |
| CALC-03 | Medium | Functional | Scientific-notation results cannot be pasted back | Confirmed |
| CALC-04 | Medium | Functional | An incomplete power expression is silently reduced to its base | Confirmed |
| CALC-05 | Low | Functional | Decimal input immediately after `)` produces an invalid expression | Confirmed |
| UI-01 | Medium | Input handling | Escape dismisses the clipboard menu and also clears the calculation | Confirmed |
| INPUT-02 | Low | Input handling | Stale pointer state can swallow the next keyboard-generated keypad click | Likely |
| A11Y-01 | Medium | Accessibility | Viewport declaration restricts user zoom | Confirmed |
| UI-02 | Low | Rendering | Auto-closed exponent parentheses render at baseline | Confirmed |
| ARCH-01 | Low | Code quality | DOM ownership rule is not consistently followed | Confirmed |
| PWA-02 | Low | Reliability / PWA | Runtime cache writes are not tied to the fetch event lifetime | Likely |
| PERF-01 | Low | Performance | Display fitting forces layout reads on every render | Confirmed |
| PRIV-01 | Informational | Data security | Calculation history persists as readable localStorage data | Confirmed |
| MAINT-01 | Low | Maintainability | Icon generator's Pillow dependency is not documented or pinned | Confirmed |
| SEC-FP-01 | Informational | Security | Suspected history/display XSS is not supported by the inspected code | False Positive |

---

# Detailed Findings

## PWA-01 — Force-update deletes every service worker and cache on the origin

### Severity

**High**

### Category

Reliability / PWA isolation

### Description

The version-badge update handler unregisters every service worker returned for the origin and deletes every CacheStorage cache. Service-worker registrations and CacheStorage are origin-scoped, not limited to this app's path. The app itself is configured to support GitHub Pages subpaths, where separate project sites can share the same origin.

### Evidence

- `js/pwaBootstrap.js`, `setupForceUpdate()`, lines 40–53:

```js
const registrations = await navigator.serviceWorker.getRegistrations();
for (const reg of registrations) {
  await reg.unregister();
}
const keys = await caches.keys();
for (const key of keys) {
  await caches.delete(key);
}
```

- `manifest.json`, `start_url` and `scope` are `./` (lines 8–9).
- `js/pwaBootstrap.js`, `registerServiceWorker()`, registers `./service-worker.js` with scope `./` (lines 13–16).
- `README.md` explicitly documents GitHub Pages project-subpath hosting (section 9).

### Why It Matters

An update to Calculator can remove offline support and cached resources belonging to unrelated applications hosted on the same origin. The impact extends beyond this calculator; it can break sibling project sites until they reload and re-register their service workers.

### Realistic Failure Scenario

Calculator and another PWA are hosted at `https://example.github.io/calculator/` and `https://example.github.io/another-app/`. Tapping Calculator's version badge unregisters both registrations and deletes both apps' caches.

### Recommended Fix

Limit cleanup to this app's own service-worker scope and cache-name prefix. Do not use origin-wide cleanup as an application-specific update mechanism.

### Example Patch

```js
const appScope = new URL('./', window.location.href).href;
const registration = await navigator.serviceWorker.getRegistration(appScope);
if (registration) await registration.unregister();

const keys = await caches.keys();
for (const key of keys) {
  if (key.startsWith('calculator-cache-')) {
    await caches.delete(key);
  }
}
```

Verify `appScope` against the deployed path before release. An even safer approach is to let the service worker's existing versioned install/activate lifecycle perform normal updates and reserve the badge for a scoped cache purge only.

---

## CALC-01 — Pasted unary minus replaces the preceding binary operator

### Severity

**High**

### Category

Functional correctness / clipboard parsing

### Description

`pasteExpression()` feeds each character through interactive input methods. When the previous token is any operator other than `^`, `inputOperator()` replaces that token with the newly entered operator. Consequently, a valid pasted expression with a negative right-hand operand loses its binary operator and calculates a different expression.

### Evidence

- `js/calculatorState.js`, `pasteExpression()`, lines 383–390, dispatches `+`, `-`, `×`, and `÷` through `inputOperator()`.
- `js/calculatorState.js`, `inputOperator()`, lines 454–457:

```js
if (last.kind === 'operator') {
  // Replace a trailing operator instead of stacking two in a row.
  this.tokens[this.tokens.length - 1] = makeToken(op, 'operator', { isExponent: this.exponentMode });
  return;
}
```
- `tests/parser.test.js`, lines 76–80, proves the parser itself accepts expressions such as `5×-3` and `12÷-3`; the defect is in the state/paste layer.
- Reproduced with the actual state class: pasting `2×-3` produces `rawExpression === '2-3'` and result `-1` instead of `-6`. Pasting `2÷-3` also becomes `2-3`; `1--2` becomes `1-2`.

### Why It Matters

The UI reports paste success and can return a numerically valid but incorrect answer. This is more dangerous than a parse error because the user may not realize that the imported formula changed.

### Realistic Failure Scenario

A user pastes `2×-3` from a document or another calculator. The app silently changes it to `2-3` and displays `-1`.

### Recommended Fix

Do not use the UI's operator-replacement behavior to parse pasted expressions. Parse and validate the clipboard string into a temporary token stream that distinguishes unary and binary operators, then commit the complete stream only after successful validation. Alternatively, update operator-entry semantics so a minus after a binary operator is retained as unary negation.

### Example Patch

A minimal direction for `inputOperator()` is to preserve a minus as a unary token when it follows another operator (except where the existing power-specific branch applies):

```js
if (last.kind === 'operator') {
  if (op === '-' && last.char !== '^') {
    this.tokens.push(makeToken('-', 'operator', { isExponent: this.exponentMode }));
  } else {
    this.tokens[this.tokens.length - 1] = makeToken(op, 'operator', {
      isExponent: this.exponentMode,
    });
  }
  return;
}
```

This is a minimal direction, not a complete parser redesign. Add regression tests for `2×-3`, `2÷-3`, `1--2`, and ordinary operator replacement before adopting it.

---

## CALC-02 — Pasted values can be silently truncated at the input digit limit

### Severity

**Medium**

### Category

Functional correctness / input validation

### Description

`inputDigit()` silently returns after the maximum integer or fractional digit count is reached. `pasteExpression()` calls `inputDigit()` one character at a time and unconditionally returns `true` after the loop. A paste longer than the input limit is therefore accepted but only partially inserted.

### Evidence

- `js/calculatorState.js`, `inputDigit()`, lines 271–277:

```js
if (this._leadingDigitLimitReached()) return;
this.tokens.push(makeToken(digit, 'digit', { isExponent: this.exponentMode }));
```

- `js/calculatorState.js`, `pasteExpression()`, lines 379–380 and 408, repeatedly calls `inputDigit()` and then returns `true` without checking whether every character was accepted.
- Reproduced with a 21-digit integer: `pasteExpression('100000000000000000000')` returns `true`, but the state contains only `100000000000000` (15 digits).

### Why It Matters

A long account value, identifier-like number, or high-precision input may be changed without warning. The resulting calculation can look legitimate while using a truncated operand.

### Realistic Failure Scenario

A user copies a 16-digit or longer value. The paste toast says “Pasted”, but the last digits are discarded and the displayed value is smaller.

### Recommended Fix

Make paste transactional. Validate the full pasted value against digit limits before changing application state. If it exceeds a supported limit, reject it and show an explicit message rather than returning success for a partial paste.

### Example Patch

```js
const exceedsDigitLimit = [...cleaned.matchAll(/\d+(?:\.\d*)?|\.\d+/g)].some((match) => {
  const [integerPart, fractionalPart = ''] = match[0].split('.');
  return integerPart.length > MAX_DIGITS_BEFORE_DECIMAL ||
    fractionalPart.length > MAX_DIGITS_AFTER_DECIMAL;
});
if (exceedsDigitLimit) return false;
```

The actual limit check should be operand-aware and separately enforce integer/fractional limits. Do not rely only on total digits for a complete implementation. Also return a structured rejection reason so the UI can distinguish unsupported input from permission failure.

---

## CALC-03 — Scientific-notation results cannot be pasted back

### Severity

**Medium**

### Category

Functional correctness / clipboard round-trip

### Description

The calculator formats very large and very small results using scientific notation. The Copy action copies `state.resultString` verbatim, but `pasteExpression()` only allows digits, decimal points, operators, and parentheses. The character `e`/`E` is rejected, so results in scientific notation cannot be pasted back into a new or existing calculation.

### Evidence

- `js/app.js`, lines 165–173, copies `state.resultString` when the display is in result state.
- `js/expressionParser.js`, `formatNumber()`, uses exponential output for magnitudes `>= 1e15` or `< 1e-9`.
- `js/calculatorState.js`, `pasteExpression()`, line 355, rejects any input not matching `/^[0-9.+\-×÷^()]+$/`.
- `tests/parser.test.js`, lines 96–103, confirms results `1e+25` and `1e-22` are valid formatted outputs.
- Reproduced: evaluating `10^20` yields `1e+20`; passing that copied value to a fresh `pasteExpression()` returns `false`. `1e-10` is also rejected.

### Why It Matters

The app's own Copy and Paste functions are not round-trip compatible for a supported output format. Users cannot chain or reuse scientific results by copying them.

### Realistic Failure Scenario

A user calculates `10^20`, copies `1e+20`, then pastes it into a new calculation. The app says “Nothing to paste”.

### Recommended Fix

Support a strict scientific-number grammar and normalize it into the parser's existing `mantissa × 10^exponent` representation. Reject malformed exponent forms; do not pass arbitrary text to a general evaluator.

### Example Patch

```js
const normalized = raw
  .replace(/[,\s$€£¥₹]/g, '')
  .replace(/\*/g, '×')
  .replace(/\//g, '÷')
  .replace(/x/gi, '×');
const scientificNumber = /^([+-]?\d+(?:\.\d+)?)[eE]([+-]?\d+)$/;
const match = normalized.match(scientificNumber);
const cleaned = match
  ? `${match[1]}×10^(${match[2]})`
  : normalized;
```

Integrate this normalization before ordinary tokenization and add round-trip tests for positive and negative exponents.

---

## CALC-04 — An incomplete power expression is silently reduced to its base

### Severity

**Medium**

### Category

Functional correctness / expression validation

### Description

`evaluate()` strips every trailing token whose `kind` is `operator`. This includes the hidden power operator `^` and an incomplete unary minus in exponent entry. For example, pressing `2`, then `xʸ`, then `=` removes `^` and evaluates `2`. Pressing `2`, `xʸ`, `-`, `=` also removes the incomplete exponent tokens and evaluates `2`.

### Evidence

- `js/calculatorState.js`, lines 680–688:

```js
while (
  this.tokens.length > 0 &&
  this.tokens[this.tokens.length - 1].kind === 'operator'
) {
  this.tokens.pop();
}
```

- Reproduced: `2^` becomes `2` and succeeds with result `2`; an incomplete negative exponent also reduces to `2`.
- The parser itself correctly rejects incomplete expressions; the state layer mutates the token stream before calling it.

### Why It Matters

An unfinished exponent is silently ignored. The user may believe the power operation was evaluated, when the displayed value is only the base.

### Realistic Failure Scenario

The user enters a base, taps `xʸ`, and accidentally presses equals before entering the exponent. The calculator shows the base as a successful result instead of indicating incomplete input.

### Recommended Fix

Only auto-trim supported trailing binary arithmetic operators, and never discard `^` or a unary sign that belongs to an unfinished exponent. Validate the expression before mutating tokens, or return an explicit incomplete-expression error.

### Example Patch

```js
const last = this.tokens.at(-1);
if (last?.char === '^' || (this.exponentMode && last?.char === '-')) {
  this.errorMessage = 'Incomplete expression';
  return { success: false, error: this.errorMessage };
}
```

Extend the check to all incomplete exponent-group cases and test `2^=`, `2^- =`, and valid trailing `2+ =` separately.

---

## CALC-05 — Decimal input after a closing parenthesis creates an invalid expression

### Severity

**Low**

### Category

Functional correctness / edge cases

### Description

`inputDecimal()` checks only whether the trailing token run is numeric. Immediately after `)`, it considers the run empty, inserts `0`, then inserts `.` without adding an operator. The resulting expression has adjacent operands and fails evaluation.

### Evidence

- `js/calculatorState.js`, lines 285–292, prefixes `0` whenever `_trailingNumberHasDecimal()` reports `isEmpty`.
- `inputOpenParen()` explicitly inserts implicit multiplication after a digit, decimal, or closing parenthesis; `inputDecimal()` has no equivalent handling for a preceding `rparen`.
- Reproduced: entering `(2)` followed by decimal produces `(2)0.` and `evaluate()` returns `Invalid expression`.

### Why It Matters

A normal keypad action after a completed parenthesized expression leaves the user with an invalid formula. The input path does not explain or prevent the failure.

### Realistic Failure Scenario

The user enters `(2)` and then starts a decimal operand. The app appends `0.` without a multiplication operator, then shows an error on equals.

### Recommended Fix

Define the intended adjacency behavior. If implicit multiplication is supported consistently, insert `×` before the leading zero when decimal input follows `)`. Apply the same explicit rule to digit input after `)` so the keypad does not create adjacent operands unintentionally.

### Example Patch

```js
const last = this.tokens.at(-1);
if (last?.kind === 'rparen') {
  this.tokens.push(makeToken('×', 'operator', { isExponent: this.exponentMode }));
}
```

Run this before adding the leading zero, and add tests for `(2).5` and `(2)3` according to the chosen UX rule.

---

## UI-01 — Escape dismisses the clipboard menu and also clears the calculation

### Severity

**Medium**

### Category

Input handling / user experience

### Description

Escape is mapped to the calculator's `clear` action. Separately, `app.js` listens for Escape to hide the clipboard menu. The document-level handler runs before the event reaches the window-level keyboard handler used by `InputController`; the keyboard handler does not check whether the clipboard menu is open. Thus the same Escape key both closes the menu and clears the expression.

### Evidence

- `js/inputController.js`, line 13: `Escape: 'clear'`.
- `js/app.js`, lines 233–239: the document keydown listener calls `hideClipboardMenu()` on Escape.
- `js/inputController.js`, lines 170–191: the keyboard listener is attached to `window` and maps the key without checking clipboard-menu visibility.

### Why It Matters

A dismissal key unexpectedly destroys the current calculation. This is a data-loss interaction, even though the calculation is only in memory.

### Realistic Failure Scenario

The user opens the Copy/Paste menu while an expression is in progress, presses Escape to dismiss it, and the calculator clears the expression as well.

### Recommended Fix

Give the transient clipboard menu priority over the calculator clear shortcut. When Escape dismisses the menu, prevent the event from reaching calculator dispatch or make `InputController` ignore Escape while the menu is open. Keep Escape-to-clear only when no dismissible UI is active.

### Example Patch

```js
const clipboardMenu = document.getElementById('clipboard-menu');
if (event.key === 'Escape' && clipboardMenu && !clipboardMenu.hidden) {
  return; // app-level handler already dismisses the menu
}
```

A cleaner design is to centralize Escape handling and define explicit precedence for dialog, history panel, clipboard menu, then calculator clear.

---

## A11Y-01 — Viewport declaration restricts user zoom

### Severity

**Medium**

### Category

Accessibility

### Description

The viewport meta tag sets `maximum-scale=1`. Browsers that honor this restriction can prevent users from pinching to zoom, making small controls and text harder to use for people with low vision.

### Evidence

- `index.html`, line 5:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
```

### Why It Matters

Users lose a standard browser accessibility mechanism. The app should not impose a zoom ceiling solely to preserve a fixed calculator layout.

### Realistic Failure Scenario

A user with low vision opens the PWA on a mobile browser that respects `maximum-scale=1` and cannot enlarge the display using pinch zoom.

### Recommended Fix

Remove `maximum-scale=1`. Confirm the keypad and display remain usable under browser zoom and larger system text settings.

### Example Patch

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

---

## INPUT-02 — Stale pointer state can swallow a keyboard-generated keypad click

### Severity

**Low**

### Category

Input handling / accessibility

### Description

The keypad records `lastPointerType` during `pointerdown`, then calls `preventDefault()` for a valid button press. The flag is reset only if a subsequent `click` event reaches the fallback listener. There is no corresponding reset on `pointerup` or `pointercancel`. In browsers where cancelling `pointerdown` suppresses the compatibility click, the flag can remain set and cause the next keyboard/screen-reader-generated click to be treated as an already-processed pointer click.

### Evidence

- `js/inputController.js`, lines 122–132, sets `lastPointerType` and cancels `pointerdown`.
- `js/inputController.js`, lines 146–151, resets the flag only when a `click` event occurs.
- No `pointerup` or `pointercancel` listener resets the state.

### Why It Matters

The keyboard/synthetic-click fallback can become dependent on the previous pointer interaction. This is an accessibility and reliability risk; the exact event sequence is browser-dependent and was not verified in a real browser during this audit.

### Realistic Failure Scenario

A user taps a keypad button, then navigates to another keypad button using Tab and activates it with Enter or Space. If the original pointer interaction did not produce a click event, the next keyboard click is consumed as a duplicate and the key does nothing.

### Recommended Fix

Prefer a single `click` activation path for pointer and keyboard input, using CSS `touch-action` to manage gesture behavior. If pointerdown dispatch must remain, explicitly manage pointer lifecycle and de-duplication without allowing a cancelled pointer to leave a stale flag.

### Example Patch

A robust direction is to move the calculator action dispatch into one click handler and remove the pointerdown action dispatch. Keep visual pressed-state feedback separate from calculator-state mutation. Add browser tests for mouse, touch, Enter/Space activation, and pointer cancellation.

---

## UI-02 — Auto-closed exponent parentheses render at baseline

### Severity

**Low**

### Category

UI correctness

### Description

When `evaluate()` auto-closes unmatched parentheses, it always appends closing tokens with `isExponent: false`. If an unclosed parenthesis is part of exponent entry, the closing parenthesis is rendered outside the superscript run even though the opening parenthesis and exponent content are superscripted. The parser still calculates the expression successfully; this is a display inconsistency.

### Evidence

- `js/calculatorState.js`, lines 690–694:

```js
this.tokens.push(makeToken(')', 'rparen', { isExponent: false }));
```

- `js/uiRenderer.js`, lines 45–54, groups only contiguous `isExponent` tokens inside `<sup>`.
- Reproduced with `2 xʸ ( 1 + 3 =`: evaluation succeeds as `16`, but the auto-added closing parenthesis token is not marked as exponent content.

### Why It Matters

The displayed expression no longer matches the intended mathematical typography and can make the grouping ambiguous.

### Realistic Failure Scenario

A user relies on equals to auto-close an unfinished exponent group. The closing parenthesis appears on the baseline rather than in the superscript.

### Recommended Fix

When auto-closing, match each unmatched opening parenthesis and copy its `isExponent` flag to the corresponding generated closing token.

### Example Patch

Track unmatched opening-parenthesis flags with a stack while scanning tokens, then append closing tokens in reverse order using each opening token's exponent flag. Do not assign `false` to every generated close token.

---

## ARCH-01 — DOM ownership rule is not consistently followed

### Severity

**Low**

### Category

Code quality / architecture

### Description

The project instructions state that `uiRenderer.js` is the only module allowed to inspect or mutate the DOM. In practice, `app.js` directly queries elements, attaches DOM listeners, reads classes, and mutates event flow; `inputController.js` also accesses `document` to inspect dialog and history state. The implementation is therefore inconsistent with its documented architectural invariant.

### Evidence

- `AGENTS.md`, “Strict DOM Separation”: `uiRenderer.js` is the only module allowed to inspect or mutate `document` or DOM elements.
- `js/app.js`, for example lines 150–160 and 233–256, uses `document.getElementById`, attaches listeners, and checks DOM classes.
- `js/inputController.js`, lines 182–186, queries the dialog and history panel directly.

### Why It Matters

The split between UI, input, and composition responsibilities is less clear than the documentation promises. This makes browser behavior harder to unit-test and increases the cost of replacing or testing the UI independently.

### Realistic Failure Scenario

A future developer tests `InputController` with a pure state object but encounters hidden dependencies on global `document` elements and their IDs.

### Recommended Fix

Choose and document a consistent boundary. Either allow the composition root and input adapter to own event wiring while keeping business/state modules DOM-free, or move all DOM queries and state checks behind UI adapter callbacks so `uiRenderer.js` (or a dedicated DOM adapter) owns them. Update README and AGENTS.md to match the chosen architecture.

### Example Patch

Inject UI-state callbacks into `InputController` instead of querying the document:

```js
constructor({ state, onChange, onEvaluate, isDialogOpen, isHistoryOpen, isClipboardMenuOpen }) {
  Object.assign(this, { state, onChange, onEvaluate, isDialogOpen, isHistoryOpen, isClipboardMenuOpen });
}
```

Then check the injected callbacks from `attachKeyboard()` and keep DOM lookup in the UI adapter.

---

## PWA-02 — Runtime cache writes are not tied to the fetch event lifetime

### Severity

**Low**

### Category

Reliability / PWA caching

### Description

For same-origin cache misses, the service worker returns the network response and starts a cache write without awaiting it or registering it with `event.waitUntil()`. The service worker may be terminated after the response is delivered, before the best-effort cache write completes. This affects runtime-cached resources; the precached application shell is not dependent on this path.

### Evidence

- `service-worker.js`, lines 75–81:

```js
return fetch(event.request)
  .then((response) => {
    if (response && response.status === 200 && response.type === 'basic') {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
    }
    return response;
  });
```

### Why It Matters

An otherwise successful online fetch may not be retained for later offline use. The practical impact is limited because all listed core app assets are precached during installation.

### Realistic Failure Scenario

A same-origin resource outside `PRECACHE_URLS` is fetched for the first time. The browser terminates the worker before `cache.put()` completes, so that resource is not available offline on the next visit.

### Recommended Fix

Tie cache writes to the fetch event lifetime with `event.waitUntil()` or return a response promise whose cache operation is properly managed. Keep the app shell precache as the reliable offline baseline.

### Example Patch

```js
const response = await fetch(event.request);
if (response && response.status === 200 && response.type === 'basic') {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(event.request, response.clone());
}
return response;
```

Validate the exact event-lifetime pattern in the supported browser targets before merging.

---

## PERF-01 — Display fitting forces layout reads on each render

### Severity

**Low**

### Category

Performance

### Description

Each state change triggers `render()`. The display renderer writes text and font-size styles, then synchronously reads `scrollWidth` and `clientWidth` to calculate a fitting font size. This read-after-write pattern can force layout on each keypress. The DOM is small, so this is an optimization opportunity rather than evidence of a user-visible performance problem.

### Evidence

- `js/app.js`, `render()`, lines 100–113, is invoked after state changes.
- `js/uiRenderer.js`, `autoShrinkToFit()`, lines 168–174, writes `fontSize` and then reads `scrollWidth` / `clientWidth`.
- `scrollToDisplayEnd()` also schedules another scroll adjustment through `requestAnimationFrame()`.

### Why It Matters

Repeated synchronous layout can become more expensive on slower mobile devices and long expressions. No measured frame-rate regression was established in this audit.

### Realistic Failure Scenario

On a low-powered phone, rapid keypad entry of a long expression repeatedly triggers text layout and font fitting, increasing input-frame work.

### Recommended Fix

Profile on target mobile devices before optimizing. Consider measuring once per animation frame, minimizing style writes before geometry reads, or using a CSS-based responsive font strategy if it can preserve the current display behavior.

### Example Patch

No safe drop-in code patch is recommended without profiling; preserve the current behavior until a device trace demonstrates a measurable bottleneck.

---

## PRIV-01 — Calculation history persists as readable localStorage data

### Severity

**Informational**

### Category

Data security / privacy

### Description

The app persists expressions, results, timestamps, and token streams in browser `localStorage` under `calculator.history.v1`. This is expected for an offline PWA, but it is persistent, readable by JavaScript executing in the same origin, and not encrypted by the application.

### Evidence

- `js/storageManager.js`, lines 10 and 42–45, stores JSON in `window.localStorage`.
- `js/historyManager.js`, lines 28–40, persists tokens, expression, result, and timestamp.
- `README.md`, section 8, documents the history design and 50-entry cap.

### Why It Matters

Calculations may contain amounts or other values a user does not want retained on a shared or managed device. `localStorage` is not a secure secret store, and any successful same-origin script injection would be able to read it.

### Realistic Failure Scenario

A user enters private numeric information on a shared browser profile. The history remains available after the session until explicitly cleared or browser site data is removed.

### Recommended Fix

Disclose local-only persistence in the UI or privacy documentation, keep the Clear History control discoverable, and consider an optional history-off or auto-clear setting if the product needs to handle sensitive values. Do not claim that localStorage is encrypted.

### Example Patch

Add a short notice near the history panel: “History is stored in this browser on this device. Clear it before sharing this browser profile.” No cryptographic patch is appropriate for ordinary localStorage.

---

## MAINT-01 — Icon generator dependency is not documented or pinned

### Severity

**Low**

### Category

Maintainability / reproducibility

### Description

`generate_icons.py` imports Pillow (`PIL`) but the repository has no Python dependency declaration or documented installation command. A clean developer environment cannot reliably regenerate the committed icons without independently discovering and installing Pillow. `ImageFont` is imported but not used.

### Evidence

- `generate_icons.py`, line 7: `from PIL import Image, ImageDraw, ImageFont`.
- `README.md` and `AGENTS.md` mention the script but do not document Pillow or an install command.
- No Python requirements file was found in the project root.

### Why It Matters

Icon regeneration is not reproducible from the repository instructions alone. The unused import adds minor noise.

### Realistic Failure Scenario

A contributor clones the repository and runs `python3 generate_icons.py`; execution fails with `ModuleNotFoundError: No module named 'PIL'`.

### Recommended Fix

Document Pillow as a development-only tool and pin or constrain its version in a small `requirements-dev.txt`. Remove the unused `ImageFont` import.

### Example Patch

```text
# requirements-dev.txt
Pillow>=10,<13
```

Then document `python3 -m pip install -r requirements-dev.txt` before running the generator.

---

## SEC-FP-01 — Suspected XSS through history/display rendering is a false positive

### Severity

**Informational**

### Category

Security / XSS assessment

### Description

No active XSS issue was identified in the inspected display or history rendering paths. The code does not use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval()`, or `new Function()`. Expression and history strings are rendered through `textContent` or `document.createTextNode()`.

### Evidence

- `js/uiRenderer.js`, lines 45–82, constructs nodes and assigns `textContent` / text nodes.
- `js/uiRenderer.js`, lines 110–112 and 250–260, uses `textContent` for errors, results, and history values.
- Repository scan found no dangerous HTML/script sinks in application source.
- `index.html`, line 8, defines `default-src 'self'`, `object-src 'none'`, and `base-uri 'self'`.

### Why It Matters

The string values stored in history and entered through the clipboard do not become HTML in the current rendering implementation. Marking these paths as an exploitable XSS vulnerability would be a false positive.

### Realistic Failure Scenario

A pasted string containing `<img onerror=...>` is rejected by the character allowlist, and any value that reaches text rendering is inserted as text rather than parsed markup.

### Recommended Fix

Keep using DOM node creation and text-only sinks. Do not replace them with `innerHTML` for convenience. Continue to validate clipboard syntax independently of XSS protection.

### Example Patch

No patch required for the inspected XSS path.

---

# Security Audit Notes

1. **XSS:** No exploitable HTML injection path was found in the inspected application code. The parser never evaluates JavaScript; it tokenizes a restricted arithmetic grammar and evaluates arithmetic operators.
2. **CSP:** The page defines a useful baseline (`default-src 'self'`, `object-src 'none'`, `base-uri 'self'`). However, `style-src 'self' 'unsafe-inline'` is permissive. It may be needed by current dynamic `element.style` assignments; if hardening is desired, move dynamic styling to controlled classes/CSS variables where possible and test before removing it. `frame-ancestors` is not present; that directive must be delivered as an HTTP response header and is not effective when placed in a CSP meta element.
3. **DOM clobbering:** The inspected code uses explicit `getElementById` / `querySelector` lookups rather than relying on named global properties. No concrete DOM-clobbering issue was found.
4. **localStorage:** History is persistent and readable, as described in `PRIV-01`. `loadHistory()` catches parse/storage errors and checks basic field types; it does not enforce an upper bound on loaded entry count or fully validate token flags/timestamps. Since normal writes cap history at 50 and all rendering uses text nodes, this is a robustness improvement, not a demonstrated exploit.
5. **Clipboard:** Clipboard access is user-triggered and failures are caught. The correctness risks are parser/state issues described above, not a demonstrated script-injection vector.

# Reliability and PWA Assessment

## Positive Findings

- Manifest contains `id`, relative `start_url` / `scope`, standalone display mode, theme/background colors, and standard plus maskable icons.
- All referenced PNG assets were present and their actual dimensions matched the manifest/HTML declarations.
- The service worker pre-caches the app shell and all declared icon files; install uses `waitUntil()` and fails atomically if a required precache asset is missing.
- The activate handler removes only old caches with the `calculator-cache-` prefix, which is appropriately scoped at the cache-name level.
- Cache version is synchronized at `v7.7` in the inspected locations.
- Network fallback returns `index.html` only for navigation requests; it does not substitute HTML for failed script/style/image requests.
- `localStorage` reads/writes/removals are wrapped in `try/catch`; save attempts progressively reduce the stored history if quota writes fail.

## Limitations / Risks

- `PWA-01` is a cross-app isolation defect in the manual force-update path.
- `PWA-02` makes non-pre-cached runtime caching best-effort.
- An offline-first cache requires disciplined cache-version bumps on every cached-file release; this is documented but not automatically enforced by CI.
- No installability audit, Lighthouse run, offline browser test, update lifecycle test, iOS Add to Home Screen test, or GitHub Pages subpath deployment test was executed in this source-only audit.

# Performance Review

- The app is small, dependency-free, and has a bounded normal history size of 50 entries.
- History is serialized only on successful calculations, not on every digit press.
- `renderHistory()` rebuilds at most the loaded history list when opened; no persistent detached-node retention was identified in the reviewed code.
- `PERF-01` identifies a synchronous geometry read after style writes on each display render. Its real-world impact is unmeasured and likely modest for the current UI.
- Global listeners are attached once during `main()`; there is no SPA mount/unmount cycle. No demonstrated recurring listener leak was found. The clipboard-menu timeout/listener lifecycle is small but would benefit from a browser regression test for rapid open/close sequences.

# Code Quality and Architecture Recommendations

1. **Separate clipboard parsing from interactive editing.** Parse clipboard strings into a validated temporary representation; do not route raw characters through methods whose purpose is to replace an operator during live keypad entry. Commit only after the entire paste succeeds.
2. **Represent unary and binary operators explicitly.** A distinct unary-negation token avoids relying on a special case of “replace the previous operator” and simplifies negative operands in entry and paste paths.
3. **Treat incomplete exponent input as an error.** Never remove the hidden `^` or a pending exponent sign as generic trailing-operator cleanup.
4. **Scope PWA maintenance actions.** Only unregister the Calculator registration and delete cache names owned by Calculator.
5. **Define one DOM boundary.** Update implementation and `AGENTS.md` / `README.md` together so future changes do not violate architectural expectations.
6. **Preserve browser zoom.** Remove `maximum-scale=1` and test the layout with zoom enabled.
7. **Add regression tests before fixes are considered complete.** Include exact reproductions from the findings table and browser-level tests for touch, keyboard, focus, clipboard, and service-worker scope isolation.
8. **Improve CSP deliberately.** Retain strict script policy and text-only DOM handling. Reduce inline-style allowances only after replacing the current dynamic style assignments and test that the layout still works.
9. **Make icon generation reproducible.** Declare the development-only Pillow dependency and remove the unused import.
10. **Avoid speculative performance changes.** Profile on representative phones before reworking display measurement or history rendering.

# Testing Coverage Review

## Current Coverage

The 64 Node tests cover parser lexing, arithmetic precedence, right-associative powers, unary negation at parser level, division-by-zero handling, malformed decimals, nested parentheses, state transitions, exponent entry, sign toggling, reciprocal transforms, paste basics, scientific result chaining, and formatting utilities.

## Highest-Risk Untested Areas

1. **State/paste integration for unary operators:** parser tests prove `5×-3` works, but state/paste tests do not prove the same valid input survives `inputOperator()` normalization.
2. **Paste limits and scientific round trips:** no tests cover over-limit values being truncated, scientific-notation Copy → Paste, or valid scientific clipboard forms.
3. **Incomplete exponent entry:** no regression test asserts that `2^=` or `2^-=` must not silently return `2`.
4. **Parenthesis-followed input:** no tests cover decimal/digit entry immediately after `)` or superscript rendering of auto-closed exponent parentheses.
5. **DOM/input integration:** no browser tests cover pointerdown cancellation, synthetic click de-duplication, keyboard activation after pointer use, Escape precedence, history focus behavior, or ARIA/zoom behavior.
6. **Clipboard API behavior:** no integration tests cover denied permissions, unavailable APIs, fallback copy cleanup, and Copy/Paste interaction with existing expressions.
7. **Service-worker lifecycle and scope isolation:** no tests verify install failure on a missing precache asset, activation cleanup, runtime caching, offline navigation, or preservation of another registration/cache on the same origin.
8. **Storage resilience:** no automated tests for malformed JSON, invalid token flags, oversized history arrays, quota exhaustion fallback, or concurrent tabs overwriting each other's snapshots.
9. **Real devices:** no evidence of iOS Safari / installed PWA testing for gestures, standalone installation, clipboard permissions, rotation, offline startup, and force-update behavior.

## Recommended Test Strategy

- Keep the existing `node:test` suite for pure parser/state/format behavior.
- Add deterministic state regression tests for every `CALC-*` finding.
- Add a small DOM test harness or browser automation suite for input-controller and renderer behavior. Browser automation is especially important for pointer/click event sequencing and service-worker lifecycle semantics; those should not be inferred from Node unit tests alone.
- Add a service-worker test harness with mocked CacheStorage/registrations to prove cleanup stays within the Calculator scope and `calculator-cache-` prefix.
- Add a manual release checklist for iOS Safari and at least one Chromium-based mobile browser, including offline launch and a GitHub Pages subpath deployment.

# Final Verdict

**The core arithmetic parser and existing unit tests are in good shape, but the application has confirmed defects at the state/clipboard boundary and one high-impact PWA isolation defect.** The project should not be called fully production-ready until `PWA-01`, `CALC-01`–`CALC-04`, and `UI-01` are corrected and regression-tested. The remaining findings are lower-severity accessibility, consistency, maintainability, and performance improvements. No application source code was changed as part of this audit; this report is the only requested deliverable created by the audit.
