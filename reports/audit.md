# Calculator PWA — Comprehensive Technical Audit

**Audit date:** 2026-11-08  
**Repository HEAD examined:** `808ac42` (`Reset Safari keypad focus outline`)  
**Release examined:** v7.11  
**Auditor perspective:** Principal Software Engineer / Security Engineer

---

## Scope and Method

The audit covered every runtime file in the repository:

- `index.html`, `manifest.json`, `service-worker.js`, `css/style.css`
- `js/app.js`, `calculatorState.js`, `expressionParser.js`, `formatUtils.js`,
  `historyManager.js`, `inputController.js`, `pwaBootstrap.js`,
  `storageManager.js`, `uiRenderer.js`
- `tests/*.test.js`, `.github/workflows/deploy.yml`

Verification performed:

1. Full read of all source files and tests.
2. `node --test tests/*.test.js` — **86 passed, 0 failed** (203 ms).
3. Runtime probes of the actual ES modules under Node for numeric fidelity,
   state transitions, paste behavior, exponent-mode recovery, history loading,
   and keyboard dispatch. Key reproductions are quoted in the findings.
4. Random-action state-machine fuzzing (20,000 sequences, 18 actions each) to
   look for thrown exceptions and token-stream corruption. No exceptions were
   thrown; the token-shape invariants held.
5. Differential parser testing (20,000 generated expressions) against an
   independent JavaScript evaluation. No precedence/associativity mismatch was
   found for finite expressions; only expected division-by-zero errors.
6. Static searches for `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
   `document.write`, `eval`, `new Function`, and direct `localStorage` access.

**Assumptions / uncertainty**

- No real-device or browser-automation run was performed during this audit.
  Browser-dependent claims (pinch-zoom interception, tab order, native button
  activation) are derived from the code plus standard DOM/CSS behaviour and
  are labelled where relevant.
- The README's claim that iPhone Safari/PWA validation passed for v7.9/v7.11
  was not independently reproduced.
- GitHub Pages exposure claims assume deployment through the included
  `.github/workflows/deploy.yml`.
- "Likely" is used where impact depends on deployment/environment rather than
  code alone.

**No Critical findings were identified.** The application has no backend, no
third-party scripts, no `eval`, and no unsafe DOM insertion. The most serious
findings are calculation-correctness defects and accessibility regressions.

---

# Findings Summary Table

| ID | Severity | Category | Title | Status |
| -- | -------- | -------- | ----- | ------ |
| AUD-001 | High | Functional correctness | 12-significant-digit result rounding corrupts accepted 13–15 digit inputs | Confirmed |
| AUD-002 | Medium | Functional correctness | Paste silently concatenates into the current number and rejects valid parenthesized pastes | Confirmed |
| AUD-003 | Medium | Functional correctness | Stale exponent mode after error + Backspace makes display disagree with evaluation | Confirmed |
| AUD-004 | Low | Functional correctness | Exiting exponent mode then typing a digit/decimal builds an unparseable expression | Confirmed |
| AUD-005 | Medium | Accessibility | Global `touchmove` `preventDefault` blocks pinch-zoom and scrolling outside two selectors | Confirmed |
| AUD-006 | Medium | Accessibility | Global Enter shortcut steals activation from focused keypad buttons | Confirmed |
| AUD-007 | Medium | Accessibility | History drawer remains tabbable while off-screen and `aria-hidden`; focus is not restored or trapped | Confirmed |
| AUD-008 | Low | Accessibility | Copy/Paste and expression recall are pointer-only; clipboard menu has no focus management | Confirmed |
| AUD-009 | Low | Reliability | History loading bypasses the 50-item cap and weakly validates stored entries | Confirmed |
| AUD-010 | Low | Performance / UX | Every `=` rewrites storage and rebuilds the closed history drawer; repeated `=` duplicates entries | Confirmed |
| AUD-011 | Low | PWA reliability | Precache install is all-or-nothing; offline non-navigation fetch resolves `undefined` | Confirmed |
| AUD-012 | Low | PWA reliability / UX | Version badge reloads unconditionally without awaiting SW activation and discards the current expression | Confirmed |
| AUD-013 | Low | CI / Release | Deploy workflow publishes the whole repository and never runs tests | Confirmed |
| AUD-014 | Low | Functional consistency | Sign toggle on a power expression changes base precedence inconsistently | Confirmed |
| AUD-015 | Low | Documentation | README contradicts implemented exponent, reciprocal, and history behaviour; references a missing file | Confirmed |
| AUD-016 | Low | Maintainability | `app.js` reaches into private state (`_tokensFromString`) and reassigns `tokens` | Confirmed |
| AUD-017 | Informational | Code quality | Dead/unreachable code and unused exports/parameters | Confirmed |
| AUD-018 | Informational | Testing | Duplicate tests and untested critical paths (precision, Enter key, renderer, SW/manifest) | Confirmed |
| AUD-019 | Informational | Security hardening | CSP is sound for scripts but meta-only and relies on `style-src 'unsafe-inline'`; no frame protection | Confirmed |
| AUD-020 | Low | Data security | History is readable by any other app on the shared origin (documented, but real) | Confirmed |
| AUD-021 | Low | UX / Input handling | Paste rejects valid error-producing expressions, Unicode minus, and misreads European decimal separators | Confirmed |
| AUD-022 | Informational | Security | XSS via history/token rendering | False Positive |
| AUD-023 | Informational | Security | DOM clobbering / eval-style injection via input | False Positive |
| AUD-024 | Informational | Reliability | `localStorage` quota failure crashes the app or loses history | False Positive |
| AUD-025 | Informational | Performance | History rendering/listeners leak memory | False Positive |

---

# Detailed Findings

## AUD-001 — 12-significant-digit result rounding corrupts accepted 13–15 digit inputs

### Severity

High

### Category

Functional correctness

### Description

`formatNumber()` rounds every result to **12 significant digits** before display.
At the same time, the input layer explicitly accepts up to **15 digits before
the decimal point** (`MAX_DIGITS_BEFORE_DECIMAL = 15`). Any 13–15 digit integer
entered by the user is therefore silently changed by pressing `=`, and all
subsequent chained calculations use the changed value.

This is not floating-point noise cleanup; it is a loss of user-entered integer
digits.

### Evidence

`js/expressionParser.js`:

```js
export function formatNumber(value) {
  if (!Number.isFinite(value)) {
    throw new ExpressionError('Result is not a finite number');
  }

  // Round to 12 significant digits to eliminate float noise, then
  // strip trailing zeros / trailing decimal point.
  let rounded = parseFloat(value.toPrecision(12));
```

`js/calculatorState.js`:

```js
const MAX_DIGITS_BEFORE_DECIMAL = 15;
const MAX_DIGITS_AFTER_DECIMAL = 15;
```

Reproduced against the real modules (Node):

```text
evaluateExpression('999999999999999')  => "1e+15"          // expected 999999999999999
evaluateExpression('123456789012345')  => "123456789012000"
evaluateExpression('1234567890123')    => "1234567890120"
evaluateExpression('99999999999999.9') => "100000000000000"

// chaining after the corrupted result
13-digit eval: 1234567890120
chain "1234567890120 + 1" => 1234567890120   // expected 1234567890121
```

The round-trip loss also means history and clipboard copy store/export the
corrupted value.

### Why It Matters

- **Business impact:** A calculator that returns a wrong answer for a value it
  allowed the user to enter is a core-product trust failure. It can silently
  corrupt financial/inventory/ID calculations and any chained result.
- **Technical impact:** The display precision policy (12 significant digits)
  is inconsistent with the input policy (15 integer + 15 fractional digits).
  The mismatch is systemic: `formatNumber`, history persistence, clipboard
  copy, and `_tokensFromString` chaining all consume the rounded string.

### Realistic Failure Scenario

A user enters `1234567890123` (13 digits) and presses `=`. The calculator shows
`1234567890120`. They then press `+ 1 =` and still see `1234567890120`, even
though the correct answer is `1234567890124`. No warning is shown, and the
history entry records the wrong result.

### Recommended Fix

1. Raise the display precision to 15 significant digits:
   `parseFloat(value.toPrecision(15))`. This was verified to preserve all
   15-digit integers **and** clean common float noise (`0.1 + 0.2 → 0.3`,
   `0.1 + 0.7 → 0.8`, `1.005 × 100 → 100.5`).
2. If scientific notation is used, raise `toExponential(11)` to
   `toExponential(14)` so the mantissa precision matches the policy.
3. Decide and document whether the supported precision is "15 significant
   digits" or "15 integer + 15 fractional digits". If 15 significant digits is
   the policy, enforce it at input time (count significant digits, not
   pre/post-decimal digits separately).
4. Add regression tests for the exact values above and for chaining.
5. Note that this intentionally changes displayed precision: existing tests
   that assert 12-digit strings (`'-0.666666666667'`, `'2.08008382305'`,
   `'0.454545454545'`, `'1.44224957031'`, etc.) must be updated to the new
   15-significant-digit expectations, or the precision must be made
   configurable for tests.

### Example Patch

```js
// js/expressionParser.js
export function formatNumber(value) {
  if (!Number.isFinite(value)) {
    throw new ExpressionError('Result is not a finite number');
  }

  // 15 significant digits preserves every integer the input layer accepts
  // and still removes IEEE-754 noise (e.g. 0.1 + 0.2).
  let rounded = parseFloat(value.toPrecision(15));

  if (Object.is(rounded, -0)) rounded = 0;

  const abs = Math.abs(rounded);
  if (rounded !== 0 && (abs >= 1e15 || abs < 1e-9)) {
    return rounded.toExponential(14).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))e/, '$1e');
  }

  return rounded.toString();
}
```

```js
// tests/parser.test.js — add
test('preserves accepted 13-15 digit integers', () => {
  assert.equal(formatNumber(999999999999999), '999999999999999');
  assert.equal(formatNumber(123456789012345), '123456789012345');
  assert.equal(evaluateExpression('1234567890123'), '1234567890123');
  assert.equal(evaluateExpression('1234567890123+1'), '1234567890124');
});
```

---

## AUD-002 — Paste silently concatenates into the current number and rejects valid parenthesized pastes

### Severity

Medium

### Category

Functional correctness / input handling

### Description

`pasteExpression()` appends clipboard tokens to the live expression in entry
mode. The combination logic only inserts an implicit `×` when the existing
last token is `)` and the pasted tokens start with a digit/decimal/`(`. It does
not handle:

- existing number + pasted number → silent digit concatenation;
- existing number + pasted `(` expression → combined expression fails
  validation and the paste is rejected;
- existing `)` + pasted `(` is handled, but the general rule is incomplete.

### Evidence

`js/calculatorState.js`, `pasteExpression()`:

```js
const combined = [...this.tokens];
const lastToken = combined[combined.length - 1];
if (lastToken?.kind === 'rparen' && ['digit', 'decimal', 'lparen'].includes(pastedTokens[0]?.kind)) {
  combined.push(makeToken('×', 'operator', { isExponent: this.exponentMode }));
}
combined.push(...pastedTokens);
try {
  evaluateExpression(this._tokensToRawExpression(combined));
} catch {
  return false;
}
```

Observed results with the real module:

```text
existing="5"       paste="12345"     -> raw=512345        = 512345
existing="5"       paste="2+3"       -> raw=52+3          = 55
existing="2+3"     paste="4"         -> raw=2+34          = 36
existing="10"      paste="(2+3)×4"   -> REJECTED          (valid standalone paste)
existing="10+"     paste="(2+3)×4"   -> raw=10+(2+3)×4    = 30
```

The rejected `10` + `(2+3)×4` case is valid in isolation and works after an
operator; the inconsistency is caused solely by the missing `×` insertion.

### Why It Matters

- **Business impact:** Pasting a value or equation while a number is already on
  screen can silently produce a completely different number (`5` + `12345`
  becomes `512345`), or silently do nothing ("Nothing to paste"). Both erode
  trust in the paste feature.
- **Technical impact:** Paste validation is transactional (good), but the
  combination rule is not derived from the token grammar. It is ad hoc and
  inconsistent with the keypad's own implicit-multiplication rules.

### Realistic Failure Scenario

A user has `5` on screen, copies `12345` from a document, and taps Paste to
replace it. The display becomes `512345`. In another case, the user has `10`
on screen and pastes a parenthesized sub-equation; the app says "Nothing to
paste" even though the clipboard content is valid.

### Recommended Fix

Define explicit paste semantics and implement them uniformly:

- **Safest default:** in entry mode, paste replaces the current expression
  unless it ends with a binary operator or `(`; in those cases append.
- If append remains the default, insert `×` whenever the current last token is
  a digit/decimal/`)` and the pasted first token is a digit/decimal/`(`.
- Reject ambiguous digit+digit concatenation, or insert `×` and show what was
  inserted.
- Report a specific error ("Cannot combine with current expression") instead
  of the generic "Nothing to paste".

### Example Patch

```js
pasteExpression(raw) {
  if (typeof raw !== 'string') return false;
  const pasted = this._parsePastedExpression(raw);
  if (!pasted || pasted.length === 0) return false;

  // In RESULT/error state, paste replaces the session.
  if (this.displayState === DisplayState.RESULT || this.isError) {
    this.tokens = pasted;
  } else {
    const combined = [...this.tokens];
    const last = combined[combined.length - 1];
    const first = pasted[0];

    const leftIsValue = last?.kind === 'digit' || last?.kind === 'decimal' || last?.kind === 'rparen';
    const rightStartsValue = ['digit', 'decimal', 'lparen'].includes(first?.kind);

    if (leftIsValue && rightStartsValue) {
      // Choose one documented policy:
      //  A) reject ambiguous concatenation, or
      //  B) insert an explicit multiplication sign (shown here).
      combined.push(makeToken('×', 'operator', { isExponent: this.exponentMode }));
    }

    combined.push(...pasted);
    try {
      evaluateExpression(this._tokensToRawExpression(combined));
    } catch {
      return false;
    }
    this.tokens = combined;
  }

  this.displayState = DisplayState.ENTRY;
  this.resultString = null;
  this.errorMessage = null;
  this.exponentMode = false;
  return true;
}
```

Add tests for every existing/paste pairing in the table above.

---

## AUD-003 — Stale exponent mode after error + Backspace makes display disagree with evaluation

### Severity

Medium

### Category

Functional correctness

### Description

When evaluation fails with `Incomplete expression` because the expression ends
with a hidden `^` operator, `exponentMode` remains `true`. Pressing Backspace
clears the error and pops the `^`, but the **error branch of `backspace()` does
not recompute `exponentMode`** (the normal branch does). The next digit is
therefore marked `isExponent: true` even though there is no `^` in the token
stream. `rawExpression` then evaluates the digits as a single number (e.g.
`53`) while the renderer displays a superscript (`5³`).

This is a display-versus-evaluation divergence, not just a cosmetic issue.

### Evidence

`js/calculatorState.js`, `backspace()` error branch:

```js
backspace() {
  if (this.isError) {
    this.errorMessage = null;
    this.displayState = DisplayState.ENTRY;
    if (this.tokens.length > 0) this.tokens.pop();
    return; // <-- no exponentMode recomputation
  }
  ...
  // normal branch does recompute it:
  const last = this.tokens[this.tokens.length - 1];
  this.exponentMode = Boolean(
    last && ((last.kind === 'operator' && last.char === '^') || last.isExponent)
  );
}
```

Reproduction:

```text
inputDigit('5'); inputPower(); evaluate()
  => { success: false, error: 'Incomplete expression' }, exponentMode = true
backspace()
  => tokens = [5], exponentMode = true        // stale
inputDigit('3')
  => rawExpression = "53"
  => token 3 has isExponent = true            // renders as 5³
evaluate()
  => { success: true, result: '53' }          // screen says 5³
```

`uiRenderer.renderTokensToFragment()` wraps any `isExponent` run in `<sup>`,
so the visible screen is `5³`.

### Why It Matters

- **Business impact:** The user sees a different mathematical expression than
  the one being evaluated. Any user relying on the screen gets a wrong answer.
- **Technical impact:** `exponentMode` is a second source of truth derived from
  tokens, but the recovery path forgets to re-derive it. This class of bug will
  recur whenever a new early-return path is added to `backspace()`.

### Realistic Failure Scenario

A user types `5`, taps `xʸ`, then taps `=` by mistake. The app shows
"Incomplete expression". They press Backspace to recover and then type `3`.
The display shows `5³` (which every user reads as 125), but pressing `=`
returns `53`. The history records `53` while the screen showed `5³`.

### Recommended Fix

Extract the exponent-mode recomputation into a helper and call it from both
Backspace paths. Add a state invariant test that asserts, for every token
stream, that no token is `isExponent` unless it is preceded by a `^` or by
another exponent token.

### Example Patch

```js
_recomputeExponentMode() {
  const last = this.tokens[this.tokens.length - 1];
  this.exponentMode = Boolean(
    last && ((last.kind === 'operator' && last.char === '^') || last.isExponent)
  );
}

backspace() {
  if (this.isError) {
    this.errorMessage = null;
    this.displayState = DisplayState.ENTRY;
    if (this.tokens.length > 0) this.tokens.pop();
    this._recomputeExponentMode();
    return;
  }
  ...
  this._recomputeExponentMode();
}
```

```js
// tests/state.test.js — add
test('backspace after incomplete-exponent error does not leave stale exponent mode', () => {
  const state = new CalculatorState();
  state.inputDigit('5');
  state.inputPower();
  state.evaluate();
  state.backspace();
  assert.equal(state.exponentMode, false);
  state.inputDigit('3');
  assert.equal(state.tokens.at(-1).isExponent, false);
  assert.equal(state.evaluate().result, '53');
});
```

---

## AUD-004 — Exiting exponent mode then typing a digit/decimal builds an unparseable expression

### Severity

Low

### Category

Functional correctness

### Description

After pressing `xʸ` a second time to exit exponent mode, the tokens still end
with an exponent run. `inputDigit()` / `inputDecimal()` only insert an implicit
`×` after `)`, not after an exponent run that is no longer in exponent-entry
mode. The new digit is therefore appended directly to the exponent term with
`isExponent: false`, producing strings such as `2^(3)4` and `1.5^(2).` that the
parser rejects.

### Evidence

`js/calculatorState.js`, `inputDigit()`:

```js
if (last?.kind === 'rparen') {
  this.tokens.push(makeToken('×', 'operator', { isExponent: this.exponentMode }));
}
this.tokens.push(makeToken(digit, 'digit', { isExponent: this.exponentMode }));
```

Reproduction:

```text
2 → xʸ → 3 → xʸ (exit mode) → 4
  rawExpression = "2^(3)4"      display = 2³4      evaluate = Invalid expression

1.5 → xʸ → 2 → xʸ → decimal
  rawExpression = "1.5^(2)."    display = 1.5².    evaluate = Malformed decimal number
```

### Why It Matters

- **Business impact:** The keypad accepts input that it immediately cannot
  evaluate, producing a red error state with no obvious recovery instruction.
- **Technical impact:** Implicit multiplication is implemented in several
  input methods (`inputDigit`, `inputDecimal`, `inputOpenParen`, paste) rather
  than in one token-stream insertion helper, so the "after `)`" rule was not
  applied to the "after exponent run" case.

### Realistic Failure Scenario

A user calculates `2³`, exits exponent mode intending to continue with `×4`,
but types `4` directly. The screen shows `2³4`; pressing `=` shows
"Invalid expression" instead of `32`.

### Recommended Fix

When `exponentMode` is false and the trailing term ends in an exponent run,
insert an implicit `×` before a new digit/decimal, exactly as is done after
`)`. Alternatively, keep exponent mode active until an operator is pressed,
but then the xʸ toggle must not be presented as "leave the exponent". The
implicit-`×` fix is the least surprising.

### Example Patch

```js
_ensureImplicitMultiplicationBeforeValue() {
  const last = this.tokens[this.tokens.length - 1];
  if (!last) return;
  const endsValue = last.kind === 'rparen' || (last.isExponent && !this.exponentMode);
  if (endsValue) {
    this.tokens.push(makeToken('×', 'operator', { isExponent: this.exponentMode }));
  }
}

inputDigit(digit) {
  this._clearErrorIfNeeded();
  this._startFreshIfShowingResult();
  if (this._leadingDigitLimitReached()) return;
  this._ensureImplicitMultiplicationBeforeValue();
  this.tokens.push(makeToken(digit, 'digit', { isExponent: this.exponentMode }));
}

inputDecimal() {
  this._clearErrorIfNeeded();
  this._startFreshIfShowingResult();
  this._ensureImplicitMultiplicationBeforeValue();
  ...
}
```

Add the two reproduction cases as tests.

---

## AUD-005 — Global `touchmove` `preventDefault` blocks pinch-zoom and scrolling outside two selectors

### Severity

Medium

### Category

Accessibility (and input reliability)

### Description

`app.js` installs a non-passive `touchmove` listener on `document` and calls
`preventDefault()` for every touch that is not inside `.history-list` or
`.display-line`. This suppresses:

- pinch-to-zoom anywhere else (including the keypad/topbar and the
  confirmation dialog), and
- scrolling inside the native `<dialog>` or any future scrollable area that is
  not one of the two exempted selectors.

The viewport meta tag deliberately does not disable zoom, so the JavaScript
listener is the only thing preventing it.

### Evidence

`js/app.js`:

```js
document.addEventListener(
  'touchmove',
  (event) => {
    if (event.target?.closest('.history-list, .display-line')) {
      return;
    }
    event.preventDefault();
  },
  { passive: false }
);
```

`index.html` viewport:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

No `user-scalable=no`, so pinch-zoom is expected to be available.

### Why It Matters

- **Business impact:** A calculator is often used by older or low-vision users.
  Blocking pinch-zoom is a WCAG 2.1 1.4.4 (Resize Text) / mobile accessibility
  failure and can make an installed PWA feel broken.
- **Technical impact:** A document-level gesture veto is broader than needed.
  It also makes any future scrollable UI (settings, long dialogs, help) require
  an allow-list edit.

### Realistic Failure Scenario

A user with reduced vision tries to pinch-zoom the keypad or the "Clear all
calculation history?" dialog. The gesture is swallowed. If the dialog content
overflows on a small screen or with large text, the dialog cannot be scrolled.

### Recommended Fix

Prefer CSS (`overscroll-behavior`, `touch-action`, fixed body) over a global
touch veto. If the listener must remain, allow multi-touch gestures and
scrollable ancestors:

```js
document.addEventListener(
  'touchmove',
  (event) => {
    if (event.touches.length > 1) return;               // allow pinch-zoom
    if (event.target?.closest?.('.history-list, .display-line, dialog')) return;
    if (event.cancelable) event.preventDefault();
  },
  { passive: false }
);
```

Better: remove the listener entirely and rely on the existing
`html, body { position: fixed; overflow: hidden; overscroll-behavior: none; }`
plus `touch-action: manipulation` on `.app`.

---

## AUD-006 — Global Enter shortcut steals activation from focused keypad buttons

### Severity

Medium

### Category

Accessibility / keyboard interaction

### Description

`InputController.attachKeyboard()` listens on `window` and maps `Enter` to
`equals`, then calls `preventDefault()`. Native `<button>` activation with
Enter is a default action of the keydown event. Therefore, when keyboard focus
is on any keypad button (for example after tapping it, which moves focus via
`button.focus()`), pressing Enter runs `=` instead of activating the focused
button.

Space still works because `' '` is not in the key map and the global handler
returns without preventing default, but Enter is the primary activation key
for many keyboard and switch users.

### Evidence

`js/inputController.js`:

```js
const KEY_TO_ACTION = {
  Enter: 'equals',
  ...
};
```

```js
const mapped = KEY_TO_ACTION[event.key];
if (!mapped) return;
event.preventDefault();
```

`js/inputController.js`, `attachKeypad()` focuses the button on pointerdown:

```js
if (typeof button.focus === 'function') {
  try { button.focus({ preventScroll: true }); } catch { button.focus(); }
}
```

A simulation using the real `InputController` with `event.target` representing
a focused keypad button produced:

```text
Enter while keypad button focused -> prevented: true | state.displayState: A | tokens: []
```

The focused button's native click was suppressed; the key was consumed as `=`.

### Why It Matters

- **Business impact:** Keyboard/switch users cannot activate a focused keypad
  button with Enter; they must discover Space as a workaround. This undermines
  the README's claim of "full keyboard support."
- **Technical impact:** A global shortcut competes with native control
  activation. The guard that ignores inputs/dialogs does not ignore buttons.

### Realistic Failure Scenario

A keyboard user tabs to the `7` button and presses Enter expecting `7`. The
calculator instead attempts `=` on an empty expression; nothing happens. If an
expression is in progress, Enter evaluates it, which is destructive to the
user's intended edit.

### Recommended Fix

Let native activation win when focus is on an interactive control, at least for
Enter/Space. Keep digit/operator shortcuts working when a button has focus.

```js
// near the top of the keydown handler, after modifier checks
const onButton = event.target?.closest?.('button, [role="button"]');
if (onButton && (event.key === 'Enter' || event.key === ' ')) {
  return; // allow native click activation of the focused control
}
```

Add a regression test that dispatches Enter with a focused keypad button and
asserts the digit/action is dispatched exactly once via the click path.

---

## AUD-007 — History drawer remains tabbable while off-screen and `aria-hidden`; focus is not restored or trapped

### Severity

Medium

### Category

Accessibility

### Description

The history panel is hidden only with `transform: translateX(-105%)`. It is
never `display:none`, `visibility:hidden`, or `inert`. All of its buttons and
history items keep `tabIndex`/default focusability. The panel is also marked
`aria-hidden="true"` when closed. This creates the classic
"aria-hidden element contains focusable descendants" violation: keyboard users
tab through invisible controls, and screen readers receive contradictory
state. Closing the panel (overlay click, close button, or selecting an item)
does not return focus to the hamburger button. There is also no focus trap while
the panel is open, so Tab can move to the keypad behind the overlay.

### Evidence

`css/style.css`:

```css
.history-panel {
  position: fixed;
  ...
  transform: translateX(-105%);
  transition: transform 0.25s ease;
}
.history-panel.is-open { transform: translateX(0); }
```

`index.html`:

```html
<aside id="history-panel" class="history-panel" aria-hidden="true" ...>
```

`js/uiRenderer.js`:

```js
export function toggleHistoryPanel(open) {
  ...
  panel.classList.toggle('is-open', open);
  panel.setAttribute('aria-hidden', String(!open));
  ...
  if (open && panel) {
    panel.querySelector('.history-close')?.focus();
  }
  // no focus restoration when closing
}
```

`js/uiRenderer.js`, `renderHistory()` makes every item focusable:

```js
item.setAttribute('role', 'button');
item.tabIndex = 0;
```

`js/app.js`, `handleHistorySelect()` closes the panel without moving focus:

```js
render();
toggleHistoryPanel(false);
```

### Why It Matters

- **Business impact:** Screen-reader and keyboard users encounter invisible
  focus stops and can lose their place entirely after closing the drawer.
- **Technical impact:** The visibility mechanism and accessibility state are
  maintained separately (`class` vs `aria-hidden`) and can drift. `aria-hidden`
  is being used as a visual-hiding mechanism, which it is not.

### Realistic Failure Scenario

A keyboard user opens history, tabs to close it, presses Enter, and focus stays
on the now-offscreen close button. The next Tab press moves through invisible
history entries and "Clear History" before reaching visible UI. A screen reader
user may be told the focused element is hidden.

### Recommended Fix

- Set `panel.inert = !open` (modern browsers) and add a CSS visibility fallback.
- Keep `aria-hidden` in sync with `inert`.
- Return focus to `#hamburger-btn` on close (or to the previously focused
  element).
- Optionally implement a focus trap or use a `<dialog>`-based drawer.
- Do not set `tabIndex = 0` on items while the panel is inert; inert handles it,
  but the closed panel must not be reachable.

### Example Patch

```js
export function toggleHistoryPanel(open) {
  const panel = document.querySelector(SELECTORS.historyPanel);
  const overlay = document.querySelector(SELECTORS.historyOverlay);
  const hamburgerBtn = document.getElementById('hamburger-btn');

  if (panel) {
    panel.classList.toggle('is-open', open);
    panel.inert = !open;                       // removes from tab order + a11y tree
    panel.setAttribute('aria-hidden', String(!open));
  }
  if (overlay) overlay.classList.toggle('is-open', open);
  hamburgerBtn?.setAttribute('aria-expanded', String(open));

  if (open && panel) {
    panel.querySelector('.history-close')?.focus();
  } else {
    hamburgerBtn?.focus();
  }
}
```

```css
.history-panel {
  visibility: hidden;
  transition: transform .25s ease, visibility 0s linear .25s;
}
.history-panel.is-open {
  visibility: visible;
  transition: transform .25s ease;
}
```

---

## AUD-008 — Copy/Paste and expression recall are pointer-only; clipboard menu has no focus management

### Severity

Low

### Category

Accessibility

### Description

The two display lines are plain `<div>`s with click listeners:

- tapping `#upper-display` recalls the frozen expression for editing;
- tapping `#lower-display` opens the Copy/Paste menu.

They have no `tabindex`, no role, and no keydown handler, so keyboard-only
users cannot trigger either action. When the menu does open (by pointer), focus
is not moved into it, the `role="menu"` does not implement arrow-key
navigation, and the menu's own buttons are only reachable by tabbing after the
fact.

### Evidence

`js/app.js`:

```js
const upperDisplayEl = document.getElementById('upper-display');
addSwipeSafeClickListener(upperDisplayEl, () => {
  state.recallExpressionToEntry();
  render();
});

const lowerDisplayEl = document.getElementById('lower-display');
addSwipeSafeClickListener(lowerDisplayEl, () => {
  showClipboardMenu();
});
```

`index.html`:

```html
<div id="upper-display" class="display-line display-upper" aria-label="Expression"></div>
<div id="lower-display" class="display-line display-lower" aria-label="Current value">0</div>
```

`js/uiRenderer.js`, `showClipboardMenu()` removes `hidden`, shows the menu, but
does not focus a menu item.

### Why It Matters

- **Business impact:** The clipboard feature and "resume editing" gesture are
  undiscoverable and unusable without a pointer. This is a functional
  accessibility gap, not merely cosmetic.
- **Technical impact:** Clickable `<div>`s are an anti-pattern for interactive
  behaviour; they cannot receive keyboard focus or expose button semantics.

### Realistic Failure Scenario

A user navigating by keyboard wants to copy the current result. There is no Tab
stop for the display and no menu command, so the feature is impossible to use.

### Recommended Fix

- Make each display line an actual `<button>` (or add `role="button"`,
  `tabindex="0"`, and Enter/Space handlers).
- Move focus to the first menu item when the clipboard menu opens and restore
  focus to the lower display when it closes.
- Implement ArrowLeft/ArrowRight/Home/End within `role="menu"`, or use two
  plain buttons in a labelled group instead of a menu role.
- Alternatively add explicit Copy/Paste buttons to the top bar for
  discoverability.

### Example Patch

```html
<div id="lower-display" class="display-line display-lower"
     role="button" tabindex="0" aria-haspopup="menu"
     aria-label="Current value. Open copy or paste menu.">0</div>
```

```js
function activateOnKeyboard(el, handler) {
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  });
}
activateOnKeyboard(lowerDisplayEl, showClipboardMenu);
```

---

## AUD-009 — History loading bypasses the 50-item cap and weakly validates stored entries

### Severity

Low

### Category

Reliability / data integrity

### Description

`HistoryManager` caps only on `add()`. `loadHistory()` accepts any array length
and filters only on:

- `expression` is a string,
- `result` is a string,
- optional `tokens` shape (`char`/`kind` strings).

It does not validate `id` or `timestamp`, does not bound array length, does not
validate token flag types, and does not verify that `result` is a finite numeric
string. A stale/corrupt/foreign writer can therefore inject thousands of
entries or malformed rows that the UI will render as "Invalid Date" or with
ambiguous IDs.

### Evidence

`js/storageManager.js`:

```js
const parsed = JSON.parse(raw);
if (!Array.isArray(parsed)) return [];
return parsed.filter(
  (entry) =>
    entry &&
    typeof entry === 'object' &&
    typeof entry.expression === 'string' &&
    typeof entry.result === 'string' &&
    (!('tokens' in entry) || (Array.isArray(entry.tokens) && entry.tokens.every(
      (t) => t && typeof t === 'object' && typeof t.char === 'string' && typeof t.kind === 'string'
    )))
);
```

`js/uiRenderer.js` assumes `timestamp` and `id`:

```js
timeEl.textContent = formatTimestamp(entry.timestamp); // new Date(undefined) → "Invalid Date"
...
item.addEventListener('click', () => onSelect(entry.id)); // id may be undefined
```

Reproduction with a stubbed `localStorage`:

```text
stored array of 60 valid entries -> HistoryManager.getAll().length === 60
stored [{ expression: 'x', result: 'y' }] -> accepted as-is
```

### Why It Matters

- **Business impact:** A user upgrading from an older/buggy version (or a
  sibling app writing to the same origin) can see an enormous or malformed
  history list; "Clear History" still works, but the drawer may be slow or
  confusing.
- **Technical impact:** Persistence is the trust boundary for the history UI.
  Weak validation lets invalid data reach rendering and selection logic.

### Realistic Failure Scenario

A previous version (or a manual test) wrote 5,000 entries without a cap.
On launch the app loads all of them into memory and opens the drawer by
rendering 5,000 DOM rows with 10,000 listeners, freezing the UI on a phone.

### Recommended Fix

- Enforce `MAX_HISTORY_ITEMS` at load time (slice to 50).
- Validate `id` (non-empty string), `timestamp` (finite number), `result`
  (non-empty, finite numeric representation, optionally matching
  `/^-?\d/`), and boolean flags on tokens.
- Cap token count per entry (e.g. 512).
- On load, if invalid rows are dropped, persist the cleaned list once.
- Keep the versioned key; consider bumping to `v2` if the schema changes.

### Example Patch

```js
const MAX_ITEMS = 50;
const MAX_TOKENS = 512;
const TOKEN_KINDS = new Set(['digit', 'decimal', 'operator', 'lparen', 'rparen']);

function isValidToken(t) {
  return t && typeof t === 'object'
    && typeof t.char === 'string' && t.char.length === 1
    && TOKEN_KINDS.has(t.kind)
    && typeof t.isExponent === 'boolean'
    && typeof t.hidden === 'boolean';
}

export function loadHistory() {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === 'object'
        && typeof entry.id === 'string' && entry.id.length > 0
        && Number.isFinite(entry.timestamp)
        && typeof entry.expression === 'string'
        && typeof entry.result === 'string' && entry.result.length > 0
        && Number.isFinite(Number(entry.result))
        && (!('tokens' in entry)
          || (Array.isArray(entry.tokens)
            && entry.tokens.length <= MAX_TOKENS
            && entry.tokens.every(isValidToken))))
      .slice(0, MAX_ITEMS);
  } catch (err) {
    console.warn('Failed to load history from storage:', err);
    return [];
  }
}
```

---

## AUD-010 — Every `=` rewrites storage and rebuilds the closed history drawer; repeated `=` duplicates entries

### Severity

Low

### Category

Performance / UX

### Description

`app.js` re-renders the history list on every successful evaluation, even when
the history panel is closed. `renderHistory()` replaces the whole list and
creates three elements plus two listeners per entry (up to 50). At the same
time, `HistoryManager.add()` serializes the full history with
`JSON.stringify` and writes it synchronously to `localStorage`.

Pressing `=` repeatedly re-evaluates the same token stream and calls
`onEvaluate()` each time, so each press appends another identical history
entry (until the cap) and performs another storage write.

### Evidence

`js/app.js`:

```js
onEvaluate: (tokens) => {
  const expressionText = tokensToPlainText(tokens);
  history.add(tokens, expressionText, state.resultString);
  renderHistory(history.getAll(), handleHistorySelect); // always, even if closed
  ...
}
```

`js/uiRenderer.js`, `renderHistory()` calls `replaceChildren()` and then
appends each item directly to the attached list.

`js/calculatorState.js`, `evaluate()` does not mark a repeated evaluation; it
re-evaluates the same tokens:

```text
2+2, "=" x3 -> result 4 each time, and app.js adds 3 history rows
```

### Why It Matters

- **Business impact:** A held Enter key or an impatient user fills history with
  duplicate rows, pushing out older useful entries, and taps can cause visible
  jank on older phones.
- **Technical impact:** Work is done for an invisible panel, and persistence
  cost grows with history size on a synchronous main-thread API.

### Realistic Failure Scenario

A user presses `=` several times to confirm the result. History now contains
`2+2 = 4` five times, and the oldest real calculation is evicted. On a slow
device the drawer open animation stutters because the list was just rebuilt.

### Recommended Fix

- Render history only when the panel is opening (or when it is already open).
- Use a `DocumentFragment` for batch insertion.
- Skip adding a history entry when `=` is pressed again without any state
  change (e.g. `displayState === RESULT` and tokens unchanged since the last
  evaluation). Optionally return a `repeat` flag from `evaluate()`.
- Debounce/coalesce storage writes if history grows.

### Example Patch

```js
// js/app.js
onEvaluate: (tokens) => {
  const expressionText = tokensToPlainText(tokens);
  const signature = `${state.rawExpression}|${state.resultString}`;

  if (signature !== lastHistorySignature) {
    lastHistorySignature = signature;
    history.add(tokens, expressionText, state.resultString);
    if (historyPanel?.classList.contains('is-open')) {
      renderHistory(history.getAll(), handleHistorySelect);
    }
  }

  if (history.lastSaveWasTrimmed) showToast('Older history removed to free storage');
  else if (history.lastSaveFailed) showToast('History could not be saved; browser storage is full');
},
```

```js
// js/uiRenderer.js — renderHistory
const fragment = document.createDocumentFragment();
for (const entry of entries) { ... fragment.appendChild(item); }
listEl.replaceChildren(fragment);
```

Reset `lastHistorySignature` whenever a non-equals action mutates state.

---

## AUD-011 — Precache install is all-or-nothing; offline non-navigation fetch resolves `undefined`

### Severity

Low

### Category

PWA reliability

### Description

`install` uses `cache.addAll(PRECACHE_URLS)`. Per the Cache API, if any one URL
fails (404, network error, redirect problem, missing icon), the entire install
rejects. The app then has no service worker and therefore no offline support,
even though every other asset was fine. The only signal is a `console.warn`
from the registration `.catch()`.

In the `fetch` handler, the offline `.catch()` returns `undefined` for
non-navigation requests. `event.respondWith(undefined)` produces a network
error/TypeError rather than a controlled offline response.

Additionally, the dynamic cache uses `caches.match(event.request)` across all
origin caches and never revalidates non-precached responses, so any same-origin
GET that was cached once stays stale until the cache version is bumped.

### Evidence

`service-worker.js`:

```js
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});
...
.catch(() => {
  if (event.request.mode === 'navigate') {
    return caches.match('./index.html');
  }
  return undefined; // respondWith(undefined)
});
```

`js/pwaBootstrap.js` only logs registration failure:

```js
.catch((err) => {
  console.warn('Service worker registration failed:', err);
});
```

### Why It Matters

- **Business impact:** A single renamed/missing icon during a release silently
  disables offline mode for all users of that release. Users only notice when
  they are offline.
- **Technical impact:** The cache is fail-fast rather than fail-soft; there is
  no integrity check in CI that `PRECACHE_URLS` matches the deployed files.

### Realistic Failure Scenario

A developer renames `icon-maskable-192.png` but forgets to update
`PRECACHE_URLS`. `cache.addAll` rejects on install; the SW never activates.
The app still works online, so the regression ships unnoticed. Offline users
get the browser error page.

### Recommended Fix

- Add a CI test that parses `PRECACHE_URLS` and verifies every file exists.
- Make install resilient: cache a required core list with `addAll`, and add
  optional assets individually with `Promise.allSettled`; only fail install if
  the core shell is unavailable.
- Return an explicit `Response` in the offline fallback:
  `new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })`.
- Match within `CACHE_NAME` (`cache.match`) for deterministic behavior.
- Consider network-first for HTML navigations or stale-while-revalidate for
  non-precached assets.

### Example Patch

```js
const CORE_URLS = ['./', './index.html', './css/style.css', './js/app.js', /* ... */];
const OPTIONAL_URLS = PRECACHE_URLS.filter((u) => !CORE_URLS.includes(u));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_URLS);
    await Promise.allSettled(OPTIONAL_URLS.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});
```

```js
.catch(() => {
  if (event.request.mode === 'navigate') {
    return caches.match('./index.html');
  }
  return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
});
```

```js
// tests/pwa.test.js (Node, no browser required)
import { readFileSync, existsSync } from 'node:fs';
// parse PRECACHE_URLS from service-worker.js and assert each file exists
```

---

## AUD-012 — Version badge reloads unconditionally without awaiting SW activation and discards the current expression

### Severity

Low

### Category

PWA reliability / UX

### Description

Tapping the version badge always calls `window.location.reload()`, even when
there is no update, and does not wait for a newly found service worker to
finish installing/activating. It also discards any in-progress expression
(state is in memory only). The UI deliberately advertises the badge as
"Tap to check for updates", so this is a surprising destructive action.

### Evidence

`js/pwaBootstrap.js`:

```js
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
  } catch (err) { ... }
  window.location.reload(); // always, before activation is guaranteed
});
```

### Why It Matters

- **Business impact:** A user taps a small "v7.11" badge out of curiosity and
  loses the expression they were typing. The update may not even be applied yet,
  forcing a second tap.
- **Technical impact:** `registration.update()` resolves after the update check,
  not after the new worker is activated and controlling the page. With
  `skipWaiting`, activation is usually quick but not guaranteed before reload.

### Realistic Failure Scenario

A user has a long expression in progress and taps `v7.11` to see whether the
app is current. The page reloads and the expression is gone. If the new worker
was still installing, the reload serves the old cache and the user sees no
change.

### Recommended Fix

- Only reload if a new worker is waiting/activating.
- Listen for `updatefound` / `statechange` and `navigator.serviceWorker.controllerchange`.
- Show a toast/banner ("Update ready — reload") and let the user choose.
- If auto-reload is retained, persist the current expression/state to
  `sessionStorage` before reload and restore on boot.
- If already up to date, show "Up to date" instead of reloading.

### Example Patch

```js
versionBadgeEl.addEventListener('click', async () => {
  versionBadgeEl.textContent = 'Checking...';
  try {
    const reg = await navigator.serviceWorker.getRegistration(new URL('./', document.baseURI).href);
    if (!reg) { window.location.reload(); return; }

    await reg.update();
    if (!reg.waiting && !reg.installing) {
      showToast('Already up to date');
      return;
    }

    const worker = reg.waiting || reg.installing;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') window.location.reload();
    });
  } catch {
    window.location.reload();
  }
});
```

---

## AUD-013 — Deploy workflow publishes the whole repository and never runs tests

### Severity

Low

### Category

CI / release

### Description

The GitHub Pages workflow uploads the repository root (`path: "."`) and deploys
without running the Node test suite, a syntax check, or any cache/manifest
integrity check. The artifact therefore contains `tests/`, `README.md`,
`generate_icons.py`, `requirements-dev.txt`, `.github/`, and any future
`reports/` directory (including this audit if committed). It also means a
broken commit can be deployed without the 86-test suite ever running.

### Evidence

`.github/workflows/deploy.yml`:

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4
  - name: Setup Pages
    uses: actions/configure-pages@v5
  - name: Upload artifact
    uses: actions/upload-pages-artifact@v3
    with:
      path: "."
  - name: Deploy to GitHub Pages
    id: deployment
    uses: actions/deploy-pages@v4
```

No `node --test` step, no `test` job, no staging directory.

### Why It Matters

- **Business impact:** Regressions can reach production without the only
  automated safety net. Publishing internal test/dev files enlarges the public
  surface and can expose audit/report content.
- **Technical impact:** The artifact is not the app shell; it is the repository.
  The deployment has no gate and no guarantee that `PRECACHE_URLS` and
  `CACHE_VERSION` are consistent.

### Realistic Failure Scenario

A commit breaks `formatNumber` or renames an icon; CI deploys it immediately.
Users receive the broken cache on their next visit. Separately, a future
`reports/audit.md` (security findings, internal notes) becomes publicly
downloadable at `https://<user>.github.io/<repo>/reports/audit.md`.

### Recommended Fix

- Add a `test` job (`node --test tests/*.test.js`) and make deploy depend on it,
  or run tests in the build job before upload.
- Stage only the app shell into `_site/` and upload that directory.
- Add a static integrity check: every `PRECACHE_URLS` entry exists; manifest
  icons exist; `CACHE_VERSION` / badge version / README version agree.
- Consider pinning third-party actions to commit SHAs.

### Example Patch

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: node --test tests/*.test.js

  deploy:
    needs: test
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Stage app shell
        run: |
          mkdir -p _site
          cp -R index.html manifest.json service-worker.js css js icons _site/
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: "_site"
      - uses: actions/deploy-pages@v4
        id: deployment
```

---

## AUD-014 — Sign toggle on a power expression changes base precedence inconsistently

### Severity

Low

### Category

Functional consistency

### Description

`inputPower()` auto-wraps a unary minus before the base, so entering `-5`, then
`xʸ`, then `2` evaluates `(-5)^2 = 25`. But pressing `+/-` *after* building
`5^2` inserts the minus before the base without parentheses, producing
`-5^2`, which the parser (correctly, by convention) evaluates as `-(5^2) = -25`.
The same visible intent ("make the base negative") yields two different
results depending on the order of button presses.

### Evidence

`js/calculatorState.js`, `inputPower()`:

```js
const start = this._findSingleOperandStart(this.tokens.length);
if (start !== null && this.tokens[start].kind === 'operator' && this.tokens[start].char === '-') {
  // Auto-wrap unary minus before trailing operand into (-operand)
  ...
  this.tokens = [...beforeTokens, ...wrappedBase];
}
```

`js/calculatorState.js`, `_findTrailingOperandRange()` deliberately includes the
base when not in exponent mode:

```js
if (!this.exponentMode && start > 0 && this.tokens[start - 1].kind === 'operator' && this.tokens[start - 1].char === '^') {
  const baseStart = this._findSingleOperandStart(start - 1);
  if (baseStart !== null) start = baseStart;
}
```

`toggleSign()` then splices `-` at `range.start`.

Reproduction:

```text
5 → xʸ → 2 → xʸ (exit) → +/-   => raw "-5^(2)" => -25
-5 → xʸ → 2                    => raw "(-5)^(2)" => 25
```

### Why It Matters

- **Business impact:** Users cannot predict whether `+/-` negates the base or
  the whole power; the result differs for even exponents.
- **Technical impact:** Sign handling is split between `inputPower` (wraps base)
  and `toggleSign` (prefixes a token), with different precedence outcomes. The
  README's ambiguity log does not document this case.

### Realistic Failure Scenario

A user computes `5² = 25`, realizes they wanted `-5`, taps `+/-`, and gets
`-25` while the screen shows `-5²`. Another user enters `-5` first and gets
`25`. Support has no consistent rule to explain.

### Recommended Fix

Pick one semantic and implement it in both paths. Recommended: make `+/-` on a
power term wrap the base as `(-base)^exp`, matching `inputPower`:

```js
// In toggleSign(), when the trailing term is base^exp, rewrite:
//   base ^ exp  ->  ( - base ) ^ exp
// and when already wrapped, remove the inner minus.
```

Alternatively, remove the base-inclusion block so `+/-` negates only the
trailing exponent, and document that the base is negated by editing the base.
Add tests for `5^2 +=>`, `(-5)^2`, and toggling twice.

---

## AUD-015 — README contradicts implemented exponent, reciprocal, and history behaviour; references a missing file

### Severity

Low

### Category

Documentation

### Description

Several user-facing README statements do not match the code:

1. §7 says pressing any operator, `)`, or `=` ends exponent mode. The code does
   not end it on operators or `)`; §14.6 correctly says it persists. The two
   sections contradict each other.
2. §7 says `1/x` rewraps the operand as `(operand)^(-1)` and that only a raised
   `-1` is visible. The implementation wraps the operand as a visible `(1÷x)`
   expression and does not create a hidden `^(-1)` token stream.
3. §8 and §14.5 say tapping history re-runs the entry's **result** as a fresh
   input. The code restores the full token expression and shows it as State B
   (`loadFromHistory`), with the result-only fallback only for legacy entries.
4. §2 lists `implementation_report.html`, which does not exist in the repo.

### Evidence

`README.md`:

```text
182:  Pressing any operator, `)`, or `=` ends the mode (per spec).
183:- **`1/x`**: rewraps the trailing operand as `(operand)^(-1)`. The parens
184:  around the *operand* are real, visible tokens ...
186:  all `hidden: true` — only the raised `-1` shows.
230:- Tapping a history entry re-runs that calculation's **result** as a fresh
80:├── implementation_report.html # v7.8 remediation report
```

Actual code:

```js
// inputReciprocal(): wraps as (1 ÷ operand)
const wrapped = [ '(', '1', '÷', ...operand, ')' ];
```

```js
// app.js handleHistorySelect()
state.loadFromHistory(entry.tokens, entry.result); // restores expression + result
```

`find . -name implementation_report.html` returns nothing.

### Why It Matters

- **Business impact:** Users and maintainers form wrong expectations about
  exponent entry and history restore. A tester following §7 will file false
  bugs (or miss real ones); the README is part of the product.
- **Technical impact:** Documentation drift around subtle input semantics
  increases regression risk. The contradiction between §7 and §14.6 means
  there is no single source of truth.

### Recommended Fix

Align the README with the code (or the code with the README, deliberately):

- §7: "Exponent mode persists across operators and parentheses until `xʸ` is
  pressed again or evaluation completes" (matching §14.6 and tests).
- §7: describe `1/x` as `(1 ÷ operand)` with a toggle-off unwrap.
- §8/§14.5: describe restoring the expression + result in State B, with
  legacy result-only fallback.
- Remove the `implementation_report.html` row or add the file.
- Add the README examples to the test suite so a future behaviour change forces
  a doc update.

---

## AUD-016 — `app.js` reaches into private state (`_tokensFromString`) and reassigns `tokens`

### Severity

Low

### Category

Maintainability / architecture

### Description

The composition root calls the underscore-private `state._tokensFromString()`
and assigns `state.tokens` directly in the legacy-history fallback. This
violates the stated architectural boundary ("No component reaches sideways into
another's internals", README §3) and bypasses any future invariants in
`CalculatorState` (exponent mode, display state, token validation).

### Evidence

`js/app.js`:

```js
function handleHistorySelect(id) {
  ...
  if (Array.isArray(entry.tokens) && entry.tokens.length > 0) {
    state.loadFromHistory(entry.tokens, entry.result);
  } else {
    state.clearAll();
    state.tokens = state._tokensFromString(entry.result);
    state.displayState = DisplayState.ENTRY;
  }
  ...
}
```

`README.md`:

```text
No component reaches "sideways" into another's internals — everything flows
through app.js.
```

### Why It Matters

- **Business impact:** Low today, but any future change to token representation
  or state invariants can break the untested legacy path without a compile-time
  signal.
- **Technical impact:** Private API coupling and direct field mutation defeat
  encapsulation and make the state machine harder to reason about.

### Recommended Fix

Add a public state method for the fallback and keep all token mutation inside
`CalculatorState`:

```js
loadResultOnly(result) {
  this.reset();
  this.tokens = this._tokensFromString(result);
  this.displayState = DisplayState.ENTRY;
}

// app.js
if (Array.isArray(entry.tokens) && entry.tokens.length > 0) {
  state.loadFromHistory(entry.tokens, entry.result);
} else {
  state.loadResultOnly(entry.result);
}
```

Also have `loadFromHistory` validate/normalize tokens and reject empty arrays
internally, so callers cannot create invalid State B.

---

## AUD-017 — Dead/unreachable code and unused exports/parameters

### Severity

Informational

### Category

Code quality

### Description

Several items are dead or misleadingly unused:

- `RIGHT_ASSOCIATIVE` includes `'u-'`, but unary minus is pushed directly onto
  the operator stack without ever consulting `comparePrecedence` for incoming
  `'u-'`; the entry is unreachable.
- `showCopyToast()` in `uiRenderer.js` is exported but never imported.
- `SELECTORS` is exported but never imported outside `uiRenderer.js`.
- `CalculatorState.pasteNumber()` is an alias used only by tests; the app calls
  `pasteExpression()`.
- `InputController` computes a `before` string (`state.rawExpression`) and passes
  it to `onEvaluate`, but `app.js` ignores it, as it ignores the second `result`
  argument.
- `formatUtils.js` and `calculatorState.js` duplicate parenthesis-enclosure
  logic (`isEnclosedInParensString` vs `isEnclosedInParens`).

### Evidence

```js
// js/expressionParser.js
const RIGHT_ASSOCIATIVE = new Set(['^', 'u-']); // 'u-' never reaches this check

// js/uiRenderer.js
export function showCopyToast() { showToast('Copied'); } // unused
export { SELECTORS };                                   // unused export

// js/inputController.js
const before = state.rawExpression;                     // computed, unused by app
```

### Why It Matters

- **Business impact:** None directly.
- **Technical impact:** Dead code increases the maintenance surface and makes
  readers believe a right-associativity rule exists for unary minus. Duplicate
  parenthesis helpers can drift apart (they already differ in formatting
  context).

### Recommended Fix

Remove the dead entries/exports/parameters, or document why they are retained.
Merge the two enclosure helpers into `formatUtils`/a shared `tokenUtils` module
and import it from both places.

---

## AUD-018 — Duplicate tests and untested critical paths

### Severity

Informational

### Category

Testing

### Description

The 86-test suite passes and covers many historical regressions well, but:

- `tests/state.test.js` contains verbatim duplicate tests:
  - lines 43–53 vs 988–997 ("Paste parses unary minus transactionally…")
  - lines 55–61 vs 999–1005 ("Paste rejects over-limit…")
  - lines 63–70 vs 1007–1014 ("Paste accepts scientific notation…")
  - lines 93–97 vs 1016–1020 ("Incomplete power expressions…")
  - lines 99–106 vs 1022–1029 ("Digit and decimal entry after closing…")
- There is no test for the actual numeric-fidelity bug in AUD-001.
- There is no test for Enter activation of a focused keypad button (AUD-006).
- `uiRenderer.js`, `app.js`, `pwaBootstrap.js`, `service-worker.js`, and
  `manifest.json` have no automated coverage.
- There is no static test that `PRECACHE_URLS` matches existing files or that
  the four version locations agree.
- There is no state invariant test that `isExponent` tokens always follow a
  `^`/exponent run (would catch AUD-003/AUD-004).

### Evidence

```text
tests/state.test.js:43  test('Paste parses unary minus transactionally ...')
tests/state.test.js:988 test('Paste parses unary minus transactionally ...')

tests/state.test.js:55  test('Paste rejects over-limit ...')
tests/state.test.js:999 test('Paste rejects over-limit ...')
```

`node --test tests/*.test.js` → 86 pass, 0 fail.

### Why It Matters

- **Business impact:** The highest-impact defect (AUD-001) is invisible to the
  suite, so the release process can certify a wrong-answer build as green.
- **Technical impact:** Duplicate tests inflate confidence and runtime without
  adding coverage; the UI/PWA layers are effectively untested.

### Recommended Fix

Highest-risk tests to add, in order:

1. `formatNumber`/`evaluateExpression` precision for 13–15 digit integers,
   0.1+0.2, 0.1+0.7, scientific thresholds, and chaining.
2. State invariant/property test: after random actions, no `isExponent` token
   without an exponent context, and `evaluate()` result equals evaluation of a
   freshly parsed `rawExpression`.
3. Paste combination matrix (existing value × pasted literal/expression).
4. Keyboard: Enter on focused button, Space, modifier keys, disabled controls.
5. A small DOM shim for `uiRenderer` (or extract a pure view-model builder and
   test that) covering State A/B/error and escaping via `textContent`.
6. `loadHistory` validation/cap/corrupt JSON with a fake `localStorage`.
7. Static PWA checks: precache file existence, manifest icon files, version
   sync (`service-worker.js`, `index.html`, `README.md`, `AGENTS.md`).

Remove the duplicated test blocks.

---

## AUD-019 — CSP is sound for scripts but meta-only and relies on `style-src 'unsafe-inline'`; no frame protection

### Severity

Informational

### Category

Security hardening

### Description

The CSP is better than most vanilla PWAs:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self' 'unsafe-inline';
               img-src 'self' data:; object-src 'none'; base-uri 'self';">
```

`script-src` falls back to `default-src 'self'`, so inline scripts and external
scripts are blocked. `'unsafe-inline'` is limited to styles, which the code
requires because it sets `element.style.fontSize` / `display` / `visibility`
directly. There is no `unsafe-eval` and no third-party origin.

Limitations:

- A CSP delivered via `<meta>` cannot set `frame-ancestors`, `report-uri`, or
  `sandbox`. The app can therefore be framed by another origin (clickjacking),
  though the practical value of clickjacking a calculator is low.
- `style-src 'unsafe-inline'` would allow CSS injection if HTML injection were
  ever introduced. The app currently has no HTML injection path.
- There is no `Permissions-Policy` / `Referrer-Policy` (GitHub Pages does not
  allow custom response headers, so this is largely out of the app's control).

### Why It Matters

- **Business impact:** Minimal today; this is defense-in-depth.
- **Technical impact:** If the project moves to a host that supports headers,
  or if a future feature introduces dynamic HTML, the current policy would be
  the wrong backstop.

### Recommended Fix

- If hosting changes, serve CSP as a response header with
  `frame-ancestors 'none'`.
- Add a CI grep that fails on `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `document.write`, `eval(`, `new Function`.
- If Chromium-only hardening is acceptable, consider Trusted Types
  (`require-trusted-types-for 'script'`) and a no-op policy.
- Keep the no-inline-script rule; if inline scripts ever become necessary, use
  hashes/nonces instead of `'unsafe-inline'`.

---

## AUD-020 — History is readable by any other app on the shared origin (documented, but real)

### Severity

Low

### Category

Data security / privacy

### Description

History is stored as readable JSON under `calculator.history.v1` in
`localStorage`. On GitHub Pages project sites, all projects under
`https://<user>.github.io/` share the same origin and therefore the same
`localStorage`. Any JavaScript served from another project on that origin can
read (and overwrite) this history. The README acknowledges this, but it is a
real data-exposure boundary, not only a quota concern.

### Evidence

`js/storageManager.js`:

```js
const HISTORY_KEY = 'calculator.history.v1';
...
window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
```

`README.md`:

```text
226: - History is stored as readable JSON in this browser's `localStorage` until
227:   cleared. It is not encrypted or a secure secret store. Browser storage is
228:   shared by all apps on the same origin (including sibling GitHub Pages paths);
229:   do not enter sensitive secrets. Use a dedicated origin when app isolation is required.
```

### Why It Matters

- **Business impact:** Calculations can contain financial or personal values.
  A compromised or third-party sibling project on the same origin can read
  them. This is a user-facing privacy risk that the product can only mitigate,
  not eliminate, on github.io.
- **Technical impact:** `localStorage` has no origin partitioning by path.
  Encryption inside the page is not meaningful because the same origin's code
  can read the key.

### Realistic Failure Scenario

A user deploys another app (or a fork/demo) on the same GitHub Pages account
that contains a compromised dependency. That app reads
`calculator.history.v1` and exfiltrates the user's calculations. The calculator
itself is not compromised.

### Recommended Fix

- Keep the README disclosure (already present) and consider a visible
  "History is stored on this device only" note in the UI.
- Offer a "Don't save history" / session-only mode.
- For strong isolation, recommend a dedicated origin/domain or a host with
  per-site isolation; document that `localStorage` is not a secret store.
- At minimum, cap and validate stored data (AUD-009) so a sibling writer cannot
  turn the shared storage into a DoS vector.

---

## AUD-021 — Paste rejects valid error-producing expressions, Unicode minus, and misreads European decimal separators

### Severity

Low

### Category

UX / input handling

### Description

Paste validation runs the full evaluator, not just the grammar. As a result,
syntactically valid expressions that merely evaluate to an error are rejected
with the generic "Nothing to paste" toast:

- `1/0` (division by zero),
- `10^400` (overflow),
- `(-2)^0.5` (non-finite/complex).

The normalizer also rejects the Unicode minus signs commonly produced by
word processors (`U+2212 −`, en dash, em dash), and it removes commas
unconditionally. A European-formatted number such as `1.234,56` is therefore
silently interpreted as `1.23456` (a factor-of-1000 error) instead of being
rejected or parsed locale-aware.

### Evidence

`js/calculatorState.js`, `_parsePastedExpression()`:

```js
const cleaned = raw
  .replace(/[,\s$€£¥₹]/g, '')
  .replace(/\*/g, '×')
  .replace(/\//g, '÷')
  .replace(/x/gi, '×');
if (!cleaned || !/^[0-9.+\-×÷^()eE]+$/.test(cleaned) || !/\d/.test(cleaned)) return null;
...
try {
  evaluateExpression(this._tokensToRawExpression(tokens));
} catch {
  return null; // syntax was fine, but the value errors
}
```

Observed:

```text
paste "1.234,56"  -> raw "1.23456"
paste "5−3"       -> REJECTED (U+2212)
paste "1/0"       -> REJECTED
paste "(-2)^0.5"  -> REJECTED
```

`js/app.js` maps every rejection to the same toast:

```js
if (state.pasteExpression(text)) { ... } else { showToast('Nothing to paste'); }
```

### Why It Matters

- **Business impact:** Pasting from spreadsheets/word processors is a primary
  use case; a silent factor-of-1000 error is worse than a rejection. "Nothing to
  paste" when the clipboard is non-empty is confusing.
- **Technical impact:** Validation conflates grammar with evaluation success,
  and normalization assumes a single locale convention.

### Recommended Fix

- Separate `validateSyntax(expression)` from `evaluateExpression(expression)`.
  Paste should succeed when the grammar is valid; let `=` show the runtime
  error.
- Normalize common Unicode minus/dash characters to `-`.
- Detect ambiguous separators: if the input contains both `.` and `,`, treat
  the last one as the decimal separator and the other as grouping (or reject
  with a clear message). At minimum, do not silently delete commas in numbers
  that also contain a dot.
- Return a reason from `pasteExpression` (`'empty' | 'invalid' | 'too-long'`)
  and show a specific toast.

---

## AUD-022 — XSS via history/token rendering

### Severity

Informational

### Category

Security

### Status

False Positive

### Description

No cross-site scripting path was found. History and display rendering never
use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, or
`eval`/`new Function`.

### Evidence

`js/uiRenderer.js` uses DOM APIs exclusively:

```js
sup.textContent = text;
const textNode = document.createTextNode(addThousandsSeparators(stripLeadingZeros(numStr)));
fragment.appendChild(textNode);
...
resultEl.textContent = `= ${addThousandsSeparators(entry.result)}`;
timeEl.textContent = formatTimestamp(entry.timestamp);
```

`js/app.js` toast text:

```js
toast.textContent = message;
```

Static search across `js/` found no `innerHTML`/`insertAdjacentHTML`/`eval`
usage. CSP `script-src` falls back to `'self'`.

### Why It Matters

This is the most important negative result: even a malicious
`localStorage` entry containing `<img onerror=...>` is rendered as literal
text, not markup.

### Realistic Failure Scenario

Not applicable.

### Recommended Fix

Keep the invariant and add a CI grep so a future change cannot reintroduce
`innerHTML`/`eval` without review.

---

## AUD-023 — DOM clobbering / eval-style injection via input

### Severity

Informational

### Category

Security

### Status

False Positive

### Description

- The app does not read globals by element `id`/`name`, so DOM clobbering is not
  exploitable in its current code.
- Pasted expressions are tokenized into a strict digit/operator/parenthesis
  token stream; they are never passed to `eval`, `Function`, or a template
  engine.
- The only dynamic attribute writes are `aria-disabled`, `aria-hidden`,
  `aria-expanded`, `role`, `tabIndex`, `hidden`, and `classList` toggles with
  fixed values.

### Evidence

No `window[...]`/global element access; all selectors are explicit
`getElementById`/`querySelector`. `expressionParser.js` implements its own
lexer/Shunting Yard/RPN evaluator and rejects unknown characters.

### Why It Matters

Documents that the calculator's parser is not an injection surface.

### Recommended Fix

No action beyond preserving the tokenizer whitelist and avoiding
global-by-ID access.

---

## AUD-024 — `localStorage` quota failure crashes the app or loses history

### Severity

Informational

### Category

Reliability

### Status

False Positive

### Description

Quota failures are handled, not fatal. `saveHistory()` catches the exception,
retries by halving the list (when >5 entries), and reports
`{ success: false }`; `HistoryManager.add()` removes the unpersisted newest
entry and the UI shows a toast. `clearHistoryStorage()` and `loadHistory()` are
also guarded.

Caveat: when trimming succeeds, older history is permanently discarded. This is
intentional/documented, and the user is told via toast; it is not a crash.

### Evidence

`js/storageManager.js`:

```js
try {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  return { success: true, entries: [...entries], trimmed: false };
} catch (err) {
  if (entries.length > 5) {
    const reduced = entries.slice(0, Math.floor(entries.length / 2));
    const result = saveHistory(reduced);
    return { ...result, trimmed: result.success };
  }
  ...
}
```

`tests/storage.test.js` covers both the trim and the total-failure path.

### Why It Matters

Confirms the quota path is intentionally resilient; the only residual risk is
deliberate data loss under pressure (AUD-009/AUD-010 discuss validation and
duplicate growth).

### Recommended Fix

No crash fix needed. Consider surfacing how many entries were removed and
allowing the user to export before trimming.

---

## AUD-025 — History rendering/listeners leak memory

### Severity

Informational

### Category

Performance

### Status

False Positive

### Description

No retained-listener leak was found. `renderHistory()` calls
`listEl.replaceChildren()`, which removes the old `<li>` nodes. The per-item
`click`/`keydown` listeners are attached to those nodes and become unreachable
with them. Clipboard-menu dismissal uses a single module-level handler that is
explicitly removed on hide and before re-registering. Toast and flash timers
are short-lived and the toast timeout is cleared before replacement.

The real cost is churn (AUD-010), not a leak.

### Evidence

```js
listEl.replaceChildren();
...
item.addEventListener('click', ...);
item.addEventListener('keydown', ...);
```

```js
if (menuDismissHandler) {
  document.removeEventListener('pointerdown', menuDismissHandler);
  menuDismissHandler = null;
}
```

### Why It Matters

Rules out a common suspected issue; performance recommendations should target
unnecessary work rather than leaked handlers.

### Recommended Fix

No leak fix. Apply the AUD-010 rendering/storage optimizations.

---

# Architecture Recommendations

## Refactoring

1. **Extract pure token transformations from `CalculatorState`.**
   `_parsePastedExpression()` (~100 lines) and `_tokensFromString()` (~57
   lines) do not depend on instance state. Move them into `pasteParser.js` and
   `resultTokenizer.js` (or a single `tokenStream.js`) and expose pure
   functions. This reduces `calculatorState.js` from ~900 lines, makes the
   highest-risk parsing/testability surface directly testable, and removes the
   need for `app.js` to call a private method.

2. **Unify exponent serialization.** `CalculatorState.rawExpression` and
   `formatUtils.tokensToClipboardText` both walk exponent runs with slightly
   different rules (the latter skips hidden tokens). One shared
   `serializeExpression(tokens, { forParser, forClipboard })` would eliminate a
   class of divergence bugs.

3. **Centralize numeric policy.** Put the significant-digit limit, display
   thresholds (`1e15`, `1e-9`), input digit limits, and scientific-notation
   formatting thresholds in one module with named constants. AUD-001 exists
   precisely because the input limit and display precision were defined in
   different files with different values.

4. **Make the composition root honest.** Add public state methods for every
   mutation (`loadResultOnly`, `restoreEntry`) and stop reassigning
   `state.tokens`/calling `_`-prefixed methods from `app.js` (AUD-016). Add a
   lint/CI check that `_` members are only referenced inside their module.

5. **Split `renderDisplay` into a pure view-model builder and a DOM applier.**
   The State A/B/error rules, thousands separators, and exponent grouping can be
   computed as plain data and unit-tested in Node without a DOM. The DOM layer
   then only creates text nodes. This also makes it easy to test the
   display/evaluation invariant from AUD-003.

6. **Remove the duplicated `isEnclosedInParens` implementations** and the dead
   code listed in AUD-017. Keep the `SELECTORS` map private.

7. **Decide and document precision semantics once.** "15 significant digits"
   is a coherent policy; "15 before + 15 after decimal" is not, because it
   implies up to 30 significant digits, which IEEE-754 doubles and the current
   formatter cannot honor.

## Reliability Improvements

1. **Add cache/manifest integrity tests to CI** and make deploy depend on the
   Node suite (AUD-013). This is the cheapest way to prevent both wrong-answer
   releases and silent offline breakage.
2. **Fail-soft service-worker install** with a required core list plus optional
   assets, and return a real `Response` for offline non-navigation requests
   (AUD-011).
3. **Update UX with user consent** instead of unconditional reload, and preserve
   in-progress state across reload (AUD-012).
4. **Cap and validate history at the persistence boundary** (AUD-009), and avoid
   rebuilding the closed drawer / duplicate evaluations (AUD-010).
5. **Add a `storage` event listener** if multi-tab use matters: last-write-wins
   can silently discard entries created in another tab. Merge by `id`/timestamp
   before writing, or at least reload the list when another tab changes it.
6. **Surface corrupt-history recovery.** `loadHistory()` currently returns `[]`
   on JSON parse failure; the next `add()` overwrites the key, permanently
   discarding recoverable data. Consider backing up the raw string under a
   `.corrupt` key and telling the user.

## Security Hardening

1. Keep the no-`innerHTML`/no-`eval` invariant and enforce it with a CI grep;
   the current implementation is clean (AUD-022/AUD-023).
2. Serve CSP as a header with `frame-ancestors 'none'` if the hosting platform
   changes; the meta CSP cannot provide frame protection (AUD-019).
3. Keep `script-src` restricted to `'self'`; do not add CDNs (the project rule
   already forbids them).
4. Treat `localStorage` as public-to-origin. Keep the README disclosure,
   consider a session-only history option, and recommend a dedicated origin for
   users who care about isolation (AUD-020).
5. Restrict the deployed artifact to the app shell so test/dev/report files are
   not published (AUD-013).
6. Pin GitHub Actions to commit SHAs if the repository's threat model includes
   supply-chain compromise of action tags.

## Accessibility Hardening

1. Remove or narrow the global `touchmove` veto (AUD-005).
2. Let native Enter/Space activate focused controls (AUD-006).
3. Use `inert` + focus restoration/trapping for the history drawer (AUD-007).
4. Make display interactions keyboard-accessible and give the clipboard menu
   real focus management (AUD-008).
5. Add an axe-style manual checklist to the release process: keyboard-only pass,
   screen-reader pass, 200% text zoom/pinch zoom, reduced motion. The existing
   CSS already handles `prefers-reduced-motion` well.

## Verification Notes (positive controls)

Verified as correct and worth preserving:

- No external dependencies, no CDN, no build step.
- All app-shell paths are relative (`./...`), including manifest, SW precache,
  icons and script tags — subpath deployment is correctly configured.
- Version is synchronized across `service-worker.js` (`v7.11`), `index.html`
  (`v7.11`), `README.md` badge and §15, and `AGENTS.md` current release.
- Exponents are rendered with DOM nodes and text content, never HTML strings.
- Parser has no `eval`; precedence, right-associative `^`, unary minus, and
  division-by-zero handling passed differential/fuzz testing.
- `storageManager` guards every `localStorage` call and the quota path is
  tested.
- Cache activation deletes only `calculator-cache-*` entries and uses
  `skipWaiting()`/`clients.claim()` as documented.
- `prefers-reduced-motion`, safe-area insets, 44px targets, and a visible
  `:focus-visible` indicator are already implemented.

---

*End of audit.*
