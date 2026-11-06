# Independent Audit Validation & Remediation Plan

**Project:** `calculator` — Vanilla HTML/CSS/JavaScript PWA  
**Review date:** 2026-11-06  
**Inputs:** `_NoGit/2_plan_to_fix.md`, `audit.md`, current repository source and tests  
**Review mode:** Independent validation and planning only. No application source code, tests, configuration, or documentation were modified as part of this review. The only repository change requested separately was adding `.serena/` to `.gitignore`.

---

# Executive Summary

## Validation totals

| Measure | Count | Notes |
|---|---:|---|
| Findings in `audit.md` | **16** | Counted from the report's findings summary table |
| Confirmed | **13** | Finding exists in current code and described behavior is supported |
| Partially Confirmed | **2** | Code pattern is present, but runtime impact depends on browser lifecycle/event behavior not tested here |
| Rejected | **1** | The reported XSS issue is correctly classified as a false positive |
| New findings discovered | **4** | Independent review found issues not listed in `audit.md` |
| Total findings after review | **20** | 16 original + 4 new |
| Issues requiring remediation or an explicit product decision | **19** | 17 confirmed + 2 partially confirmed; excludes the rejected XSS report |

**Overall conclusion:** The original audit is substantially accurate. The most important findings are the origin-wide PWA cleanup and the incorrect results produced by pasted unary-negative expressions. The audit also contains some recommendations that need refinement before implementation: do not adopt its minimal `inputOperator()` patch without a transactional paste design; do not blindly move every DOM event listener into `uiRenderer.js`; and treat service-worker runtime cache lifetime as a race/reliability concern rather than a guaranteed failure.

The independent review discovered a separate scientific-notation precision loss: `formatNumber()` first rounds to 12 significant digits but then emits only 7 significant digits for exponential output. It also confirmed a history persistence consistency defect under storage quota pressure. These should be included in the remediation backlog.

## Verification performed

| Check | Result |
|---|---|
| Current Node tests | **64 passed, 0 failed** (`node --test tests/*.test.js`; about 154 ms) |
| JavaScript syntax | **Passed** (`node --check` over every `js/*.js`) |
| Whitespace validation | **Passed** (`git diff --check`) |
| Clipboard unary-negative reproduction | **Confirmed**: `2×-3` and `2÷-3` both become `2-3`, result `-1` |
| Paste truncation reproduction | **Confirmed**: a 21-digit integer is accepted but reduced to 15 digits |
| Scientific-notation paste reproduction | **Confirmed**: `1e+20` is rejected by `pasteExpression()` |
| Incomplete exponent reproduction | **Confirmed**: `2^` evaluates successfully as `2` |
| Parenthesis adjacency reproduction | **Confirmed**: `(2)` followed by decimal becomes `(2)0.`; `(2)` followed by digit becomes `(2)3`; both fail evaluation |
| Scientific notation precision reproduction | **Confirmed**: `formatNumber(1.23456789012e20)` returns `1.234568e+20` |
| Quota fallback reproduction | **Confirmed with mocked `localStorage`**: manager retained 12 in-memory records while only 6 were persisted |
| Real browser / device tests | **Not performed**; pointer, clipboard, PWA lifecycle, zoom and iOS behavior need browser verification |

---

# Audit Findings Validation

Status definitions used here:
- **Confirmed** — source and deterministic reproduction support the finding.
- **Partially Confirmed** — a problematic pattern exists, but the report's claimed runtime consequence is conditional or not proven without browser-level testing.
- **Rejected** — the reported vulnerability/defect is not supported by the current implementation.

## PWA-01 — Force-update deletes every service worker and cache on the origin

**Severity in audit:** High  
**Validation:** **Confirmed**

### Technical evidence

- `js/pwaBootstrap.js`, `setupForceUpdate()` (approximately lines 37–59) calls `navigator.serviceWorker.getRegistrations()`, unregisters every returned registration, calls `caches.keys()`, and deletes every cache key.
- `js/pwaBootstrap.js`, `registerServiceWorker()` registers `./service-worker.js` with scope `./`.
- `manifest.json` uses relative `start_url` and `scope` values of `./`; `README.md` documents deployment under a GitHub Pages project subpath.
- Service-worker registrations and CacheStorage are origin-scoped. A path-scoped app still operates in an origin-wide storage namespace.

### Root cause

The manual force-update function treats origin-wide APIs as if they were app-local. It does not filter registrations by exact Calculator scope or caches by Calculator's cache-name prefix.

### Audit report assessment

The issue and High severity are correctly identified. The report's sample use of `getRegistration(appScope)` should be tightened: verify that the returned registration's `scope` exactly matches the expected Calculator scope before unregistering it. An even safer recommendation is to avoid unregistering the worker during routine updates and use the normal versioned service-worker lifecycle. Deleting only `calculator-cache-*` entries is preferable to deleting all origin caches.

### Proposed remediation

1. Prefer calling `update()` on the Calculator registration and allow the versioned install/activate lifecycle to replace the worker and old Calculator cache.
2. If a manual reset remains necessary, compute the expected deployment scope, locate the Calculator registration, and verify exact scope equality before unregistering.
3. Delete only cache names beginning with the exact Calculator prefix (`calculator-cache-`).
4. Do not clear unrelated origin caches or service-worker registrations.
5. Add an isolation test with one Calculator registration/cache and one unrelated registration/cache; the latter must remain untouched.

### Alternatives and tradeoffs

- **Normal service-worker update only (recommended):** lowest risk; avoids force-clearing caches and avoids taking ownership of other apps' origin data. Requires confidence in the existing version-bump process.
- **Scoped manual cleanup:** useful as a recovery action, but more complex and needs exact scope tests.
- **Origin-wide purge:** reject; it is not acceptable for a path-scoped PWA sharing an origin.

### Risk and validation

Breaking risk: Medium. Regression risk: High if a sibling app's registration/cache is touched. Security impact: primarily isolation/reliability, not code execution. Performance impact: negligible. Validate in a mocked service-worker harness and a GitHub Pages-style shared-origin deployment.

---

## CALC-01 — Pasted unary minus replaces the preceding binary operator

**Severity in audit:** High  
**Validation:** **Confirmed**

### Technical evidence

- `js/calculatorState.js`, `pasteExpression()` (approximately lines 341–409) processes the pasted text character by character and calls `inputOperator()` for arithmetic operators.
- `js/calculatorState.js`, `inputOperator()` (approximately lines 454–457) replaces a trailing operator token with the new operator.
- `tests/parser.test.js` demonstrates that the expression parser accepts unary minus after a binary operator. The failure occurs in the state/input path before the expression reaches the parser.
- Reproduction against the current code: `pasteExpression('2×-3')` returns `true`, stores `2-3`, and evaluates to `-1`; `2÷-3` also becomes `2-3`.

### Root cause

The live keypad operator-replacement rule is being reused as a clipboard parser. It cannot distinguish replacing an accidental trailing binary operator from entering unary negation as the next operand.

### Audit report assessment

The finding and High severity are correct. The report's minimal sample patch is not sufficient as the final design: it only addresses a narrow operator sequence, may alter the expected behavior for users replacing an operator, and does not make clipboard insertion transactional.

### Proposed remediation

1. Parse clipboard input into a temporary token sequence without mutating live state.
2. Model unary negation explicitly, or otherwise determine unary/binary context using the previous syntactic token.
3. Validate the entire expression before committing the new tokens.
4. Preserve the existing keypad rule for changing a trailing operator where appropriate.
5. Add state-level regression tests for `2×-3`, `2÷-3`, `1+-2`, `1--2`, negative bases, and ordinary operator replacement.

### Alternatives and tradeoffs

- **Dedicated paste tokenizer/parser (recommended):** clean separation and transactional behavior; more implementation work.
- **Special-case minus in `inputOperator()`:** smaller change, but merges interactive editing rules with parser semantics and can change operator-replacement UX.
- **Rewrite all state input around AST nodes:** potentially cleaner long-term, but high scope and regression risk for a targeted repair.

### Risk and validation

Breaking risk: High because operator-entry semantics change. Regression risk: High. Security impact: none directly. Performance impact: negligible. Unit-test parser and state together; manually test keypad, physical keyboard, and clipboard sequences.

---

## CALC-02 — Pasted values can be silently truncated at the input digit limit

**Severity in audit:** Medium  
**Validation:** **Confirmed**

### Technical evidence

- `js/calculatorState.js`, `inputDigit()` returns without appending when `_leadingDigitLimitReached()` is true.
- `pasteExpression()` calls `inputDigit()` repeatedly and returns `true` without checking that every digit was appended.
- Reproduction: a 21-digit input returns success and leaves only the first 15 digits in `rawExpression`.

### Root cause

Paste uses mutators that silently no-op at the interactive input limit, and the paste method does not detect partial acceptance or roll back.

### Audit report assessment

Finding and Medium severity are correct. The report's suggested regex example is only illustrative; a simple regex count is not a sufficient full validator for multiple operands, exponent components, and per-number integer/fraction limits.

### Proposed remediation

1. Tokenize and validate paste into temporary state.
2. Enforce the same 15-digit integer and 15-digit fractional limits per numeric operand, with a clearly defined policy for exponent digits.
3. Reject over-limit content before changing the current expression, or explicitly ask the user to accept rounding/truncation. Silent truncation must not occur.
4. Return a structured result such as `{ accepted: false, reason: 'digit-limit' }` so the UI can show a useful message.
5. Test existing state preservation after a rejected paste.

### Alternatives and tradeoffs

- **Reject atomically (recommended):** predictable and avoids wrong calculations; user must shorten the value.
- **Increase/disable paste limits:** better for large imported values but may exceed current precision/display assumptions.
- **Truncate with warning:** not recommended for a calculator because acceptance could still be mistaken for exact input.

### Risk and validation

Breaking risk: Medium. Regression risk: Medium. Security impact: low. Performance impact: negligible. Unit-test boundary values at 15/16 digits and decimals, multiple operands, and rollback.

---

## CALC-03 — Scientific-notation results cannot be pasted back

**Severity in audit:** Medium  
**Validation:** **Confirmed**

### Technical evidence

- `js/expressionParser.js`, `formatNumber()` emits scientific notation for magnitudes at or above `1e15` and below `1e-9`.
- `js/app.js`, `copyToClipboard()` copies `state.resultString` as text.
- `js/calculatorState.js`, `pasteExpression()` uses an allowlist that rejects `e` and `E`.
- Current reproduction: a result such as `1e+20` is rejected when pasted into a fresh `CalculatorState`.

### Root cause

The output formatter supports scientific notation but the clipboard input grammar does not. The input/output representations are not round-trip compatible.

### Audit report assessment

The finding and Medium severity are correct. The recommended direction is sound, but scientific notation should be parsed as a numeric token/structured exponent rather than blindly normalized without full validation. Support signed exponents and reject malformed forms such as `1e`, `1e+`, `1e--2`, and multiple exponent markers.

### Proposed remediation

1. Extend the clipboard grammar to recognize a strict scientific-number form: signed mantissa with optional decimal plus `e`/`E` and signed integer exponent.
2. Convert the accepted form to the same internal representation used by `_tokensFromString()` or a dedicated scientific token helper.
3. Keep thousands-separator and currency normalization separate from scientific parsing.
4. Add round-trip tests for positive/negative exponents, decimal mantissas, signs, and malformed exponent strings.

### Alternatives and tradeoffs

- **Dedicated scientific tokenization (recommended):** avoids text rewriting edge cases and can share logic with `_tokensFromString()`.
- **Normalize to `mantissa×10^(exponent)`:** minimal conceptual change and uses the existing parser; requires careful token construction.
- **Copy expanded decimal form:** can create extremely long strings and may exceed input limits; not recommended.

### Risk and validation

Breaking risk: Medium. Regression risk: Medium. Security impact: low because input remains numeric-only. Performance impact: negligible. Validate copy→paste round trips and calculation equality for magnitudes across both scientific thresholds.

---

## CALC-04 — An incomplete power expression is silently reduced to its base

**Severity in audit:** Medium  
**Validation:** **Confirmed**

### Technical evidence

- `js/calculatorState.js`, `evaluate()` removes trailing tokens whose `kind` is `operator` before calling the parser.
- Hidden `^` tokens are also `kind: 'operator'`.
- Reproduction: entering `2`, pressing `xʸ`, then evaluating returns successful result `2` instead of an incomplete-expression error.

### Root cause

A generic “trim trailing operators” step discards syntax-significant power and unary exponent tokens before parser validation. The state is mutated before the original expression can be rejected.

### Audit report assessment

Finding and Medium severity are correct. The sample check for only a trailing `^` or a negative sign is a useful start but does not cover every incomplete exponent group or malformed parenthesis state.

### Proposed remediation

1. Determine whether the last syntactic construct is complete before applying trailing-operator cleanup.
2. Never strip a hidden `^` or a unary sign that begins an unfinished exponent.
3. Restrict any auto-trimming behavior to explicitly supported trailing binary operators (`+`, `-`, `×`, `÷`) and document it.
4. On incomplete input, preserve the user expression and return a clear error; do not silently compute a different formula.
5. Add tests for `2^`, `2^-`, `2^(`, `2^(3+`, normal `2+`, and valid completed exponent groups.

### Alternatives and tradeoffs

- **Validate then evaluate without destructive cleanup (recommended):** preserves the original expression and gives deterministic error handling.
- **Special-case the exponent tail:** smaller change, but new grammar cases can be missed.
- **Auto-complete missing exponent values:** not recommended; there is no safe default exponent.

### Risk and validation

Breaking risk: Medium because current trailing-operator trimming may be relied upon. Regression risk: High around parentheses and exponent mode. Validate state immutability after failed evaluation, displayed error, and valid trailing plus/minus behavior.

---

## CALC-05 — Decimal input after a closing parenthesis creates an invalid expression

**Severity in audit:** Low  
**Validation:** **Confirmed**

### Technical evidence

- `js/calculatorState.js`, `inputDecimal()` prepends `0` when the trailing number is empty; it does not insert multiplication when the previous token is `rparen`.
- `inputOpenParen()` inserts implicit multiplication after a digit, decimal, or closing parenthesis, but the reverse adjacency path is not consistently handled.
- Reproduction: `(2)` followed by decimal creates `(2)0.`. Further test: `(2)` followed by digit creates `(2)3`. Both fail parser evaluation.

### Root cause

Implicit multiplication is implemented for opening-parenthesis entry but not consistently for a number/decimal entered after a closing parenthesis.

### Audit report assessment

The finding is valid. The audit described only the decimal case; independent validation shows the same underlying adjacency defect also affects direct digit entry after `)`. The fix should address both input paths, not only decimal input.

### Proposed remediation

1. Define adjacency semantics consistently: either support implicit multiplication or reject the input explicitly.
2. Recommended behavior is to insert `×` before a new digit or decimal operand after a closing parenthesis, consistent with `inputOpenParen()` behavior.
3. Add tests for `(2)3`, `(2).5`, `(2)(3)`, `(2)+3`, and parenthesized exponents.

### Alternatives and tradeoffs

- **Consistent implicit multiplication (recommended):** intuitive for calculator users; requires carefully testing exponent/parenthesis context.
- **Reject adjacent operands:** simpler parser semantics but less calculator-like; must prevent invalid token insertion and explain the action.

### Risk and validation

Breaking risk: Low to Medium. Regression risk: Medium. Security impact: none. Performance impact: none. Validate both UI input and paste paths.

---

## UI-01 — Escape dismisses the clipboard menu and also clears the calculation

**Severity in audit:** Medium  
**Validation:** **Confirmed**

### Technical evidence

- `js/inputController.js`, `KEY_TO_ACTION` maps `Escape` to `clear`.
- `js/app.js` has a document-level keydown listener that hides the clipboard menu on Escape.
- `InputController.attachKeyboard()` attaches at `window` and does not check clipboard-menu visibility. The event continues bubbling from `document` to `window` after the menu is hidden.

### Root cause

Two independent handlers process the same Escape event without a shared dismissal priority or propagation guard.

### Audit report assessment

Finding and Medium severity are correct. The report's conditional check in `InputController` could work, but centralizing the precedence rules is more maintainable.

### Proposed remediation

Define one Escape policy in the application shell: close an open dialog first, then history panel, then clipboard menu; only clear the calculator when no transient UI is open. Ensure the event is consumed once by the highest-priority action.

### Alternatives and tradeoffs

- **Centralized Escape handler (recommended):** one source of truth; moderate refactor.
- **InputController checks clipboard state:** smaller patch but introduces another UI-state dependency.
- **Remove Escape-to-clear:** safest from accidental data loss, but changes documented keyboard behavior.

### Risk and validation

Breaking risk: Medium. Regression risk: Medium. Security impact: none. Validate with expression present while clipboard menu/history/dialog are each open and closed; Escape must have exactly one effect.

---

## INPUT-02 — Stale pointer state can swallow a keyboard-generated keypad click

**Severity in audit:** Low  
**Validation:** **Partially Confirmed**

### Technical evidence

- `js/inputController.js`, `attachKeypad()`, sets `lastPointerType` during `pointerdown`.
- It resets the flag only when a subsequent keypad `click` reaches the click listener.
- There is no `pointercancel` cleanup. The click listener returns early whenever the flag is still truthy.

### Root cause

Input de-duplication uses a persistent pointer-type flag rather than an event identity/lifecycle guarantee. If an interaction is cancelled without a matching click, the stale flag can consume a later synthetic click.

### Audit report assessment

The code pattern is confirmed, but the report correctly labels the runtime issue as likely. Whether a particular browser emits a click after `preventDefault()` on `pointerdown`, or how `pointercancel` interacts with the compatibility click sequence, must be verified in actual supported browsers. Do not treat this as a proven universal failure.

### Proposed remediation

Prefer one native `click` activation path for pointer, keyboard, and assistive technology. Use CSS `touch-action` and a separate pressed-state visual effect rather than dispatching calculator actions on `pointerdown`. If pointerdown dispatch remains, explicitly handle pointer lifecycle and cancellation and avoid a shared stale flag.

### Alternatives and tradeoffs

- **Single click path (recommended):** native accessibility semantics and fewer event-order assumptions; may require tuning touch feedback.
- **Pointer lifecycle state machine:** retains immediate pointerdown response but has more browser-dependent logic.

### Risk and validation

Breaking risk: Medium due existing touch interaction tuning. Regression risk: Medium. Validate on iOS Safari, Chromium Android, desktop mouse, keyboard Enter/Space, pointercancel, and touch scrolling. Status should be revisited after browser testing.

---

## A11Y-01 — Viewport declaration restricts user zoom

**Severity in audit:** Medium  
**Validation:** **Confirmed**

### Technical evidence

- `index.html` viewport declaration includes `maximum-scale=1`.
- A viewport maximum can prevent user zoom in browsers that honor it. The precise behavior varies by browser and accessibility settings; the source contains the restriction regardless.

### Root cause

The app locks the maximum viewport scale to preserve the calculator's fixed-screen presentation.

### Audit report assessment

The source-level finding is correct. The audit's impact wording is appropriately conditional (“browsers that honor this restriction”). Severity Medium is reasonable as an accessibility concern, but verify supported browser behavior rather than assuming every iOS version blocks zoom.

### Proposed remediation

Remove `maximum-scale=1`, preserve `width=device-width, initial-scale=1, viewport-fit=cover`, and validate keypad layout at 200% zoom / larger text settings.

### Alternatives and tradeoffs

- **Allow user zoom (recommended):** better accessibility; layout may need responsive adjustments.
- **Keep zoom disabled:** reject unless a documented accessibility exception is established; a calculator layout is not a sufficient reason by itself.

### Risk and validation

Breaking risk: Low. Regression risk: Low to Medium for layout. Accessibility impact: positive. Validate mobile browser pinch zoom, browser text enlargement, and keyboard focus visibility.

---

## UI-02 — Auto-closed exponent parentheses render at baseline

**Severity in audit:** Low  
**Validation:** **Confirmed**

### Technical evidence

- `js/calculatorState.js`, `evaluate()`, appends missing right-parenthesis tokens with `isExponent: false`.
- `js/uiRenderer.js`, `renderTokensToFragment()`, groups contiguous exponent tokens into `<sup>`. A generated non-exponent close token therefore renders at baseline.
- The expression can still calculate; this is a display representation inconsistency.

### Root cause

Auto-close logic tracks only parenthesis balance, not the exponent/rendering context of each unmatched opening parenthesis.

### Audit report assessment

Finding and Low severity are correct. The suggested stack-based solution is appropriate. Ensure nested groups are matched in reverse order and do not simply copy the current global `exponentMode` flag.

### Proposed remediation

Scan tokens and maintain a stack of unmatched opening-parenthesis tokens/flags. Append corresponding closing tokens in reverse stack order, copying each opening token's `isExponent` metadata. Test nested exponent groups and normal parenthesis groups.

### Alternatives and tradeoffs

- **Stack matching (recommended):** correctly handles nesting and metadata.
- **Copy current exponent mode to all closers:** simpler but incorrect when nesting crosses exponent-mode boundaries.

### Risk and validation

Breaking risk: Low. Regression risk: Medium for nested parentheses. Validate both `rawExpression` and rendered DOM structure, not only the numerical result.

---

## ARCH-01 — DOM ownership rule is not consistently followed

**Severity in audit:** Low  
**Validation:** **Confirmed**

### Technical evidence

- `AGENTS.md` says `uiRenderer.js` is the only module allowed to inspect or mutate `document`/DOM elements.
- `js/app.js` performs DOM queries and attaches event handlers for clipboard, history, Escape, resize, and orientation behavior.
- `js/inputController.js` queries `document` for dialog and history state.

### Root cause

The written invariant is stricter than the actual composition-root design. `app.js` is intentionally the composition root and needs to bind UI elements; `inputController.js` has avoidable global DOM dependencies.

### Audit report assessment

The mismatch is real, but the audit's proposed choice to move all DOM queries into `uiRenderer.js` is not necessarily the best architecture. A composition root is a reasonable place to acquire elements and wire events. Prefer clarifying the boundary: pure calculation/state/parser modules are DOM-free; `app.js` and UI adapters may own DOM wiring; `uiRenderer.js` owns rendering operations. Remove `document` globals from `InputController` by injecting callbacks or explicit UI-state values.

### Proposed remediation

1. Update `AGENTS.md` and `README.md` to describe the intended actual boundary.
2. Keep `CalculatorState`, `expressionParser.js`, formatting utilities, history/storage logic DOM-independent.
3. Let `app.js` compose and wire UI elements.
4. Inject `isDialogOpen`, `isHistoryOpen`, and `isClipboardMenuOpen` callbacks/state into `InputController` rather than querying global document IDs.
5. Add unit tests for the controller using injected callbacks.

### Alternatives and tradeoffs

- **Clarify architecture + inject state (recommended):** small, pragmatic changes, avoids needless DOM relocation.
- **Move all DOM interaction into a dedicated UI adapter:** stronger boundaries but larger refactor and additional module.

### Risk and validation

Breaking risk: Low to Medium. Regression risk: Medium around keyboard behavior. Maintainability impact: positive. Validate no DOM access remains in pure logic modules and documentation matches the implementation.

---

## PWA-02 — Runtime cache writes are not tied to the fetch event lifetime

**Severity in audit:** Low  
**Validation:** **Partially Confirmed**

### Technical evidence

- `service-worker.js`, fetch handler (approximately lines 71–90), returns the fetch response but starts `caches.open(...).then(cache => cache.put(...))` without awaiting or registering that write as an event-lifetime promise.
- Core app-shell resources are precached, so the unawaited runtime write affects resources fetched outside the precache list.

### Root cause

The response promise does not include the runtime cache-write promise. The write may still complete, but the service worker lifecycle does not explicitly wait for it.

### Audit report assessment

The lifecycle concern is valid, but the claimed termination outcome is nondeterministic and was not reproduced in a browser. The proposed patch using `event.waitUntil()` must respect when that method may be called during event dispatch. Safer implementation is to include the cache operation in the promise passed to `respondWith()`, or use a standards-compliant waitUntil pattern validated in target browsers.

### Proposed remediation

1. Decide whether runtime caching outside the fixed app shell is needed. If not, simplify the fetch handler and document network-only handling for non-pre-cached same-origin files.
2. If runtime caching is needed, ensure the cache write is part of an event-lifetime promise. A straightforward option is to await `cache.put()` inside the promise returned to `respondWith()`; this can delay response completion slightly.
3. If using `event.waitUntil()`, call it according to the FetchEvent lifecycle requirements and test it in target browsers.
4. Add tests for cached response, network response plus cache write, fetch failure, and navigation fallback.

### Alternatives and tradeoffs

- **Await cache write in respondWith promise (recommended for correctness):** simplest lifecycle guarantee; response delivery can wait for cache I/O.
- **Use a separately extended lifetime promise:** can return the network response earlier but requires correct event timing and browser tests.
- **Remove runtime caching:** simplest if the application has no dynamic same-origin resources beyond the complete precache list.

### Risk and validation

Breaking risk: Low. Regression risk: Medium for offline behavior. Performance impact: low but measure network-response latency if awaited. Status remains partial pending browser verification.

---

## PERF-01 — Display fitting forces layout reads on each render

**Severity in audit:** Low  
**Validation:** **Confirmed**

### Technical evidence

- `js/uiRenderer.js`, `autoShrinkToFit()`, writes font size and then reads `scrollWidth` / `clientWidth`.
- `renderDisplay()` calls the fitting routine on normal entry and result render paths.
- The display DOM is small and the audit did not include a performance trace.

### Root cause

Style writes invalidate layout, and subsequent synchronous geometry reads can force layout calculation. This is a code-level read-after-write pattern; its user-visible cost is unmeasured.

### Audit report assessment

The pattern is correctly identified. The audit appropriately labels the impact modest/unmeasured and does not recommend an unverified patch. Do not treat it as a production blocker absent device profiling.

### Proposed remediation

1. Capture a baseline performance trace on a representative low/mid-range mobile device.
2. Record input-to-paint latency and forced layout events while entering long expressions and resizing/orienting.
3. Only if meaningful cost is observed, batch measurements/writes in `requestAnimationFrame`, reduce repeated geometry reads, or move fitting to a CSS strategy.
4. Re-run the same trace after the change and compare.

### Alternatives and tradeoffs

- **Profile first (recommended):** avoids unnecessary complexity.
- **Always batch into animation frame:** may reduce repeated work but can make display updates appear one frame later.
- **CSS-only fitting:** potentially simpler but may not reproduce the current auto-shrink behavior.

### Risk and validation

Breaking risk: Low. Regression risk: Medium for display sizing and scroll anchoring. Performance impact cannot be quantified without device traces.

---

## PRIV-01 — Calculation history persists as readable localStorage data

**Severity in audit:** Informational  
**Validation:** **Confirmed**

### Technical evidence

- `js/storageManager.js` stores JSON under `calculator.history.v1` via `window.localStorage`.
- `js/historyManager.js` persists expression tokens, expression text, result, and timestamp.
- History is capped to 50 entries during normal manager writes, but is not encrypted.

### Root cause

The design intentionally uses persistent browser storage for offline history. `localStorage` is readable by scripts executing on the same origin and is not a secure secret store.

### Audit report assessment

Correctly classified as informational rather than an exploit. Recommended disclosure is appropriate. Encryption of client-side data with a key available to the same origin would not protect it from same-origin JavaScript.

### Proposed remediation

1. Tell users that history remains in this browser/device until cleared.
2. Keep Clear History visible and functional.
3. Consider an opt-out/disable-history or auto-clear option only if the product's expected use includes sensitive values.
4. Do not represent localStorage as encrypted or secure storage.

### Alternatives and tradeoffs

- **Disclosure + clear control (recommended baseline):** minimal friction.
- **History-off / auto-clear option:** more privacy, more settings and support burden.
- **Client-side encryption in the same origin:** not recommended as a security boundary.

### Risk and validation

Breaking risk: Low. Privacy benefit: positive. Validate reload persistence, clear operation, and any opt-out/retention setting if implemented.

---

## MAINT-01 — Icon generator dependency is not documented or pinned

**Severity in audit:** Low  
**Validation:** **Confirmed**

### Technical evidence

- `generate_icons.py` imports `PIL.Image` and `PIL.ImageDraw`, as well as unused `ImageFont`.
- No Python requirements file or Pillow installation instruction is present in the project docs.
- The generated PNG assets are committed; Pillow is a developer-time dependency, not a browser runtime dependency.

### Root cause

The one-off asset generation tool depends on Pillow but its development environment is undocumented.

### Audit report assessment

Finding is valid, severity Low is reasonable. Clarify that the dependency does not contradict the app's dependency-free runtime. The audit's proposed version range is a constraint, not a fully reproducible exact pin; use a tested exact version if reproducible builds are required.

### Proposed remediation

1. Remove unused `ImageFont` import.
2. Document Pillow as optional development tooling.
3. Add `requirements-dev.txt` with a tested Pillow version/range only if contributors are expected to regenerate icons.
4. Keep generated PNGs as the deployed assets; do not add Python packages to the browser app.

### Alternatives and tradeoffs

- **Optional dev requirements file (recommended):** reproducible icon regeneration without runtime dependency.
- **Document manual install command only:** simplest but less reproducible.
- **Remove generator:** reasonable if icons are rarely changed, but loses a useful source artifact.

### Risk and validation

Breaking risk: Low. Regression risk: Low. Verify a clean virtual environment can regenerate all declared image files with expected dimensions.

---

## SEC-FP-01 — Suspected XSS through history/display rendering

**Severity in audit:** Informational (audit already labels it False Positive)  
**Validation:** **Rejected** as an exploitable finding

### Technical evidence

- `js/uiRenderer.js` builds DOM nodes and uses `textContent` / `document.createTextNode()` for user/history-derived text.
- Source scan found no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval()`, or `new Function()` in application code.
- `index.html` defines a CSP baseline with `default-src 'self'`, `object-src 'none'`, and `base-uri 'self'`.

### Root cause

The suspected vector assumes untrusted expression/history strings are interpreted as HTML. The current rendering path inserts them as text, not markup.

### Audit report assessment

The audit's false-positive conclusion is correct for the inspected history/display path. Keep separate security hardening notes for CSP: `style-src 'unsafe-inline'` is permissive, but it is not itself evidence of script execution. `frame-ancestors` is not supported in a CSP meta policy and must be delivered as an HTTP response header if anti-framing protection is required.

### Proposed remediation

No XSS patch is required for the inspected rendering path. Preserve text-only DOM sinks and add tests that history strings remain text. Review CSP delivery headers as a separate deployment/security task if supported by the hosting platform.

### Alternatives and tradeoffs

Do not replace text nodes with `innerHTML`. A future feature that accepts rich HTML would need a separate sanitizer/security review; that is outside the current app behavior.

### Risk and validation

No direct remediation risk because no patch is recommended. Keep a regression test for text-only rendering and scan future changes for unsafe sinks.

---

# New Issues Discovered

## NEW-CALC-06 — Scientific notation formatter drops significant digits

**Severity:** Medium  
**Status:** Confirmed

### Evidence

- `js/expressionParser.js`, `formatNumber()`, lines approximately 258–270, rounds the value using `toPrecision(12)` and then, for scientific notation, calls `toExponential(6)`.
- `toExponential(6)` formats six digits after the decimal point, i.e. seven significant digits total.
- Reproduction: `formatNumber(1.23456789012e20)` returns `1.234568e+20`, not the intended approximately 12-significant-digit output `1.23456789012e+20`.

### Root cause

The exponential formatting step discards precision preserved by the preceding 12-significant-digit rounding.

### Impact

Scientific-notation results are less precise than normal-magnitude results. A user may copy or reuse a value that has lost several significant digits. JavaScript Number already has IEEE-754 precision limits; the formatter should not discard an additional five significant decimal digits beyond the documented 12-digit policy.

### Proposed remediation

Use an exponential precision consistent with the 12-significant-digit policy (for example, `toExponential(11)` after the existing rounding), and preserve trailing-zero normalization. Confirm exact output conventions at both thresholds and for negative values.

### Alternatives

- **Use `toExponential(11)` for 12 significant digits (recommended):** consistent with comments and ordinary formatter behavior.
- **Intentionally display seven significant digits:** valid product choice only if documented and tested; update README/comments to state the precision policy.

### Risk / validation

Risk: Medium because displayed and copied values change. Add unit tests for non-power-of-ten large and small values, boundary thresholds, sign, and round-trip behavior. Confirm behavior for values already at JavaScript floating-point precision limits.

---

## NEW-STORAGE-01 — Quota fallback leaves in-memory history different from persisted history

**Severity:** Low  
**Status:** Confirmed

### Evidence

- `js/storageManager.js`, `saveHistory()`, lines approximately 42–52, halves the array recursively when a write fails and eventually writes only a prefix of the supplied entries.
- `js/historyManager.js`, `add()`, adds the entry to `this.entries`, calls `saveHistory(this.entries)`, but does not replace in-memory entries with the truncated list or surface a partial-save warning.
- Independent reproduction with mocked `localStorage` quota: 12 entries remained in `HistoryManager.getAll()` while only 6 records were persisted.

### Root cause

The storage layer silently changes the data set it persists but returns only a boolean. The manager retains the original list and the UI renders that in-memory list.

### Impact

During the current session users see history entries that disappear after reload. The fallback can therefore hide data loss during a quota event.

### Proposed remediation

Return a structured save result that includes the actually persisted entries/count, or move quota trimming policy into `HistoryManager`. Keep in-memory and persisted lists consistent. If data is dropped, show a non-blocking notice that older history was removed to free storage.

### Alternatives

- **Return the retained list/count and reconcile manager state (recommended):** preserves a clear single source of truth.
- **Do not trim automatically; fail visibly:** avoids silent deletion but history stops persisting until the user clears storage.
- **Retry with a fixed smaller count:** simpler, but must still update in-memory state and communicate data loss.

### Risk / validation

Risk: Low to Medium. Test quota success, failure under 5 entries, multiple recursive reductions, and reload consistency. Use a mocked Storage implementation; do not require real browser quota exhaustion for every unit test.

---

## NEW-PRIV-02 — localStorage is shared by sibling GitHub Pages project paths

**Severity:** Low (contextual privacy risk)  
**Status:** Confirmed, conditional on shared-origin deployment

### Evidence

- `README.md` explicitly supports project-site deployment under paths such as `https://username.github.io/reponame/`.
- `js/storageManager.js` uses `window.localStorage` with key `calculator.history.v1`.
- Browser localStorage is scoped by origin, not by URL path. Separate project paths under the same origin share the same localStorage namespace.

### Root cause

The PWA's supported deployment model uses path-separated apps on one origin, while localStorage isolation is origin-based. The key is namespaced, but any same-origin script can still read it.

### Impact

A sibling app hosted under the same `username.github.io` origin can read or alter Calculator history if its JavaScript chooses to access that key. This is not an exploitable vulnerability in the current Calculator code; it is a deployment/privacy boundary limitation.

### Proposed remediation

Document that history is available to JavaScript from every app sharing the origin. Do not store sensitive secrets in this history. If strict app isolation is a product requirement, deploy applications on separate origins (for example, separate subdomains or independent hosts); changing the storage key alone does not provide isolation.

### Alternatives

- **Disclosure and avoid sensitive data (recommended for the current static PWA):** no additional runtime complexity.
- **Deploy Calculator on a dedicated origin:** stronger boundary but requires hosting/DNS/deployment changes.
- **Client-side encryption with a key available to the same origin:** does not defend against same-origin scripts and is not a meaningful isolation control.

### Risk / validation

Risk: Low for the intended personal calculator; potentially Medium if users enter sensitive data and host untrusted sibling apps. Validate by opening two same-origin project paths and confirming shared localStorage behavior in a controlled test.

---

## NEW-UI-03 — Clipboard fallback can leave a temporary textarea in the DOM after an exception

**Severity:** Low  
**Status:** Confirmed code-path cleanup gap

### Evidence

- `js/app.js`, `copyToClipboard()`, lines approximately 39–52, appends a temporary textarea, calls `focus()`, `select()`, and `document.execCommand('copy')`, then removes the textarea only on the normal path.
- The catch block returns `false` without removing the element.

### Root cause

Temporary DOM cleanup is not in a `finally` block. If focus/select/execCommand throws after insertion, the helper exits with the textarea still attached.

### Impact

A failed legacy clipboard attempt can leave an invisible textarea in the document. Repeated failures can accumulate nodes and may affect focus/navigation behavior.

### Proposed remediation

Keep a reference to the temporary textarea and remove it in `finally` if it was attached. Ensure removal itself is guarded and does not mask the original copy error.

### Alternatives

- **`try/finally` cleanup (recommended):** deterministic cleanup with minimal change.
- **Remove legacy fallback:** simpler if supported browsers all provide `navigator.clipboard`, but can reduce compatibility and requires a product/browser support decision.

### Risk / validation

Risk: Low. Test successful legacy copy, `execCommand` returning false, `execCommand` throwing, and focus/select throwing after node insertion. Confirm no textarea remains in the DOM on all failure paths.

---

# Remediation Plan

## Cross-cutting implementation principles

1. Prefer transactional state changes: parse and validate in temporary state, then commit once complete.
2. Preserve the original input on failed evaluation/paste; never transform an invalid expression into a different successful expression silently.
3. Keep arithmetic and parser logic DOM-free. DOM wiring may remain in `app.js` as the composition root; inject UI state into `InputController` rather than querying global IDs from the controller.
4. Scope origin-level browser APIs to the app's own service-worker scope/cache prefix.
5. Treat privacy limitations honestly: browser storage is persistent and origin-scoped, not encrypted or path-isolated.
6. Add regression tests before implementing fixes; every confirmed defect should have a failing test first.
7. Bump PWA cache version once for the consolidated release after any cached files change. Synchronize `CACHE_VERSION`, the badge in `index.html`, and the README version shield.

## Issue-by-issue plan matrix

| ID | Proposed solution | Alternative | Main risks | Validation |
|---|---|---|---|---|
| PWA-01 | Use Calculator's exact registration and `calculator-cache-` prefix only; preferably rely on normal update lifecycle | Scoped manual reset | High cross-app regression risk if scope matching is wrong | Mock sibling registration/cache preservation; test GitHub Pages subpath |
| CALC-01 | Dedicated transactional paste tokenizer with unary/binary distinction | Special-case unary minus in input method | High calculation-regression risk | State tests for negative operands and operator replacement |
| CALC-02 | Pre-validate every numeric operand and reject over-limit paste atomically | Increase input limits | Medium data-loss risk if partial paste remains | 15/16 digit and 15/16 fractional boundary tests; rollback |
| CALC-03 | Strict scientific-number parser normalized to internal exponent tokens | Expand to decimal string | Medium parser/round-trip risk | Copy→paste round trips for positive/negative exponents |
| CALC-04 | Detect incomplete exponent before destructive trimming; preserve tokens on error | Narrow special-case guard | Medium/High state regressions | `2^`, `2^-`, incomplete groups and valid trailing binary operators |
| CALC-05 | Consistent implicit multiplication after `)` for digit and decimal entry | Reject adjacency explicitly | Medium expression-entry regression | `(2)3`, `(2).5`, `(2)(3)`, nested/exponent cases |
| UI-01 | Centralize Escape priority across dialog, history, clipboard, and calculator | Controller checks each UI flag | Medium input/keyboard regression | Browser tests with each overlay state |
| INPUT-02 | Single native click activation path | Pointer lifecycle state machine | Medium touch/keyboard regression | iOS Safari, Android Chrome, desktop mouse, Enter/Space, cancel |
| A11Y-01 | Remove `maximum-scale=1` | Keep only with documented exception | Low layout regression | Pinch zoom and 200% text/zoom checks |
| UI-02 | Match unmatched paren tokens with a stack; preserve exponent metadata | Copy current mode flag | Medium nested rendering regression | Unit token tests + DOM snapshot for nested exponent groups |
| ARCH-01 | Clarify DOM boundary; inject UI-state callbacks into controller | Dedicated DOM adapter module | Medium refactor risk | Unit-test controller without global `document`; review AGENTS/README |
| PWA-02 | Tie cache writes to `respondWith()` promise/event lifetime | Remove runtime caching if unnecessary | Low offline/latency tradeoff | Service-worker harness and offline fetch test |
| PERF-01 | Measure first; optimize only if trace proves cost | CSS-only fitting | Medium display rendering regression | Before/after device traces and long-expression input |
| PRIV-01 | Disclose history persistence; consider opt-out only if needed | Auto-clear setting | Low product UX changes | Reload/clear/privacy notice checks |
| MAINT-01 | Declare optional dev-only Pillow dependency and remove unused import | Document manual install | Low tooling friction | Clean venv regenerates expected icons |
| SEC-FP-01 | No XSS patch; preserve text-only sinks | None | Risk only if unsafe sinks are introduced later | Static scan and text-rendering regression tests |
| NEW-CALC-06 | Use exponential formatting consistent with 12 significant digits | Explicitly document 7-digit policy | Medium numerical display regression | `formatNumber` precision and threshold tests |
| NEW-STORAGE-01 | Return persisted subset/count and reconcile manager state; notify user on trimming | Fail visibly without truncating | Low/Medium history consistency regression | Mock quota; compare in-memory and persisted state after reload |
| NEW-PRIV-02 | Document origin-level storage sharing; use separate origin for strict isolation | No persistence of history | Contextual privacy/deployment tradeoff | Same-origin sibling path test |
| NEW-UI-03 | Put temporary textarea removal in `finally` | Remove fallback path | Low clipboard compatibility regression | Simulate thrown legacy clipboard API and assert cleanup |

## Detailed risk controls

### Calculation state and paste

- Do not merge the CALC-01/CALC-02/CALC-03 changes as unrelated string substitutions. They share the paste parser boundary and should be designed together.
- Define a token grammar for unary plus/minus, binary operators, decimal points, parentheses, and scientific exponents.
- Validate all tokens and operand limits before mutating `CalculatorState`.
- Maintain compatibility with input entry methods and history restore; verify `rawExpression`, rendered token flags, and final numeric result.
- Keep parser errors explicit. Do not silently auto-correct pasted mathematical meaning.

### PWA and caching

- The service worker is shared by all pages within its registered scope; CacheStorage is shared by origin. Every manual update operation must be app-scoped.
- Keep the install precache list aligned with shipped resources.
- If runtime caching is removed, ensure the offline feature claim remains accurate for the full app shell.
- Test both first install and update from previous cache version.

### Storage and privacy

- `localStorage` exceptions must not crash calculation or rendering.
- A quota fallback must have one authoritative list and must not silently present discarded records as safely persisted.
- `localStorage` is origin-wide and readable by same-origin code. Do not suggest client-side encryption as a defense against same-origin JavaScript.

### DOM and accessibility

- Keep all user/history text in `textContent` or text nodes.
- Make keyboard dismissal actions mutually exclusive and predictable.
- Preserve native button semantics for keyboard and assistive technology activation.
- Do not block user zoom.

---

# File Impact Analysis

The following is the complete planned file impact if all confirmed/partial/new issues are implemented. It is an implementation plan only; none of these source modifications have been made in this task.

## Application source files

| File path | Reason / issue IDs | Planned changes | Estimated risk | Dependencies |
|---|---|---|---|---|
| `js/pwaBootstrap.js` | PWA-01 | Replace origin-wide unregister/cache purge with exact Calculator registration/scope and cache-prefix handling, or normal update-only action | High | PWA tests; `service-worker.js` cache naming |
| `js/calculatorState.js` | CALC-01, CALC-02, CALC-03, CALC-04, CALC-05 | Transactional paste integration; unary/binary operator handling; input limit checks; scientific-token support; incomplete exponent validation; implicit multiplication after `)` | High | `js/expressionParser.js`; `tests/state.test.js` |
| `js/expressionParser.js` | NEW-CALC-06 | Preserve intended significant digits in exponential output | Medium | `tests/parser.test.js` or `tests/format.test.js` |
| `js/inputController.js` | UI-01, INPUT-02, ARCH-01 | Remove global document-state dependencies; clarify Escape handling; use click-first keypad activation or robust pointer lifecycle | Medium | `js/app.js`; new controller/browser tests |
| `js/app.js` | UI-01, ARCH-01, NEW-UI-03 | Centralize Escape precedence / callback wiring; wrap fallback textarea cleanup in `finally` | Medium | `js/inputController.js`; DOM tests |
| `js/uiRenderer.js` | UI-02, PERF-01, PRIV-01 (optional notice) | Preserve exponent close-token rendering input; profile/optimize only if justified; optionally render history persistence notice | Low–Medium | `js/calculatorState.js`; DOM tests; `index.html` |
| `js/storageManager.js` | STORAGE-01, PRIV-01, NEW-PRIV-02 | Return persisted-entry metadata; keep quota behavior explicit; document origin-scoped history key semantics | Medium | `js/historyManager.js`; storage tests |
| `js/historyManager.js` | STORAGE-01 | Reconcile in-memory entries with persistence result and expose partial-save status | Medium | `js/storageManager.js`; `tests/state.test.js` or new history tests |
| `service-worker.js` | PWA-02, PWA-01 (if update lifecycle changes) | Include runtime cache write in event lifetime or remove unnecessary runtime caching; keep cache prefix ownership clear | Medium | Service-worker tests; cache version bump |
| `index.html` | A11Y-01, PRIV-01 (notice if selected), release version | Remove maximum scale; optionally add history privacy notice; sync badge if release cache version changes | Low | README version; `service-worker.js` |
| `generate_icons.py` | MAINT-01 | Remove unused `ImageFont` import | Low | Optional `requirements-dev.txt` |

## Tests and test infrastructure

| File path | Reason / issue IDs | Planned changes | Estimated risk | Dependencies |
|---|---|---|---|---|
| `tests/state.test.js` | CALC-01–CALC-05 | Add paste unary sign, over-limit rollback, incomplete exponent, scientific paste, and parenthesis adjacency regressions | Medium | `js/calculatorState.js` |
| `tests/parser.test.js` | CALC-03, NEW-CALC-06 | Test strict scientific token conversion and significant-digit formatting, malformed exponents and thresholds | Medium | `js/expressionParser.js`; state integration |
| `tests/format.test.js` | NEW-CALC-06 | Add exact scientific notation significant-digit output cases | Low | `formatNumber()` |
| `tests/storage.test.js` (new) | STORAGE-01, PRIV-01 | Mock storage success, quota, malformed JSON, and persistence/in-memory consistency | Low–Medium | `js/storageManager.js`, `js/historyManager.js` |
| `tests/inputController.test.js` or browser test harness (new) | UI-01, INPUT-02, ARCH-01 | Test Escape priority, pointer cancellation, click activation, injected UI state | Medium | `js/inputController.js`, `js/app.js` |
| `tests/serviceWorker.test.js` or browser harness (new) | PWA-01, PWA-02 | Test registration/cache isolation, cache lifecycle, offline behavior and runtime cache lifetime | Medium–High | `js/pwaBootstrap.js`, `service-worker.js` |
| Browser/manual validation checklist (new doc or README section) | INPUT-02, A11Y-01, PWA-01/02, UI-01 | Define device/browser matrix and repeatable test steps | Low | Target devices / hosting |

## Documentation and developer tooling

| File path | Reason / issue IDs | Planned changes | Estimated risk | Dependencies |
|---|---|---|---|---|
| `AGENTS.md` | ARCH-01, task completion | Correct DOM ownership invariant; document parser/paste rules and browser regression expectations | Low | Actual architecture decision |
| `README.md` | ARCH-01, PRIV-01/02, MAINT-01, version synchronization | Correct architecture description; disclose history persistence/origin scope; explain optional Pillow dev dependency; update version history after release | Low | `index.html`, `service-worker.js` |
| `requirements-dev.txt` (new, optional) | MAINT-01 | Record tested Pillow dependency for icon generation | Low | Python environment |
| `service-worker.js`, `index.html`, `README.md` | Any cached-file change | Bump to one synchronized release version after implementation | Medium | Consolidated release |
| `.gitignore` | User-requested Serena housekeeping | `.serena/` is now ignored | Completed separately | None |

---

# Recommended Implementation Order

No Critical-severity findings were recorded. Use the following order, with tests written before implementation.

## Priority 1 — Critical

**None identified.** The current findings do not establish a Critical-severity compromise or irreversible remote data loss.

## Priority 2 — High

1. **PWA-01 — Scope force-update behavior.** Prevent Calculator from unregistering unrelated applications or clearing unrelated caches. Add isolation tests before deployment.
2. **CALC-01 — Fix unary-negative expression handling.** A valid pasted expression currently returns a different correct-looking answer. Design the paste/tokenization change with CALC-02 and CALC-03.

## Priority 3 — Medium

3. **CALC-02 — Make paste digit-limit handling atomic.** No partial paste and no silent truncation.
4. **CALC-03 — Support scientific-notation paste.** Make Copy → Paste round trips work for the app's own valid output.
5. **CALC-04 — Reject incomplete exponent expressions.** Do not turn `2^` into `2`.
6. **UI-01 — Centralize Escape-key priority.** Prevent dismissal from clearing the active calculation.
7. **A11Y-01 — Restore browser zoom.** Remove the maximum-scale restriction and test responsive layout.
8. **NEW-CALC-06 — Preserve scientific notation precision.** Align formatting with the stated 12-significant-digit policy.
9. **NEW-PRIV-02 — Decide deployment privacy boundary.** At minimum document origin-level sharing; use a separate origin if cross-app isolation is required.

## Priority 4 — Low / Informational improvements

10. **CALC-05 — Fix parenthesis adjacency.** Apply implicit multiplication consistently for digit and decimal entry.
11. **INPUT-02 — Verify and simplify pointer/click activation.** Treat the current report as partial until browser behavior is tested.
12. **UI-02 — Preserve exponent metadata in auto-closed parentheses.**
13. **ARCH-01 — Align architecture documentation and controller dependencies.** Prefer clarifying the composition-root boundary over a broad DOM rewrite.
14. **PWA-02 — Tie runtime cache writes to the service-worker lifetime.** Confirm whether runtime caching is even needed beyond precache.
15. **NEW-STORAGE-01 — Reconcile in-memory and persisted history when quota fallback trims records.**
16. **NEW-UI-03 — Always remove temporary clipboard textarea on exceptions.**
17. **PRIV-01 — Explain history persistence and keep clear-history controls discoverable.**
18. **MAINT-01 — Make optional icon generation dependencies reproducible.**
19. **PERF-01 — Profile before optimizing display fitting.**
20. **SEC-FP-01 — No fix required; preserve safe text rendering.** This is a rejected vulnerability report, not an open remediation defect.

---

# Risks and Assumptions

## Assumptions

1. The app is intended to remain a static, dependency-free browser PWA; Node is used only for the built-in test runner.
2. GitHub Pages project-subpath deployment remains a supported target, as documented in README.
3. The 15-integer-digit / 15-fractional-digit interactive input limits remain intentional product constraints unless the owner chooses to change them.
4. Exponent calculations should preserve the documented 12-significant-digit formatting policy, subject to JavaScript Number precision.
5. History persistence is a feature, but the project owner may decide whether history should be optional or automatically cleared.

## Areas requiring human/product decision

- Should clipboard paste accept the same 15-digit limits as keypad entry, or should paste support longer numbers with an explicit precision policy?
- Should adjacent number/decimal input after `)` imply multiplication, consistent with current opening-parenthesis behavior?
- Should the version badge perform a normal service-worker update or expose a scoped recovery/reset function?
- Is the app expected to coexist with untrusted apps under the same GitHub Pages origin? If so, a dedicated origin is the only robust browser-origin isolation boundary.
- Is the DOM boundary intended to mean “only `uiRenderer.js` mutates rendered content,” or literally “only `uiRenderer.js` may access DOM”? Current `app.js` composition-root behavior supports the former more naturally.
- Which mobile browsers/OS versions are the formal support matrix for pointer, clipboard, zoom, service-worker and PWA installation testing?

## Unverified / uncertain

- INPUT-02 depends on real pointer event sequences; the static code path is risky, but cross-browser reproduction is outstanding.
- PWA-02 is a lifecycle race; the unawaited cache write is proven, but an actual dropped write was not observed in a browser.
- `maximum-scale=1` is present in source, but browser enforcement varies.
- No deployed-site, Lighthouse, offline, iOS Add to Home Screen, or real-device test was performed in this validation.
- `Pillow` is a developer-only script dependency and does not add a browser runtime dependency.

## Change-control constraints for the implementation phase

- Do not combine all changes into one unreviewable patch. Group by calculator input/paste, PWA lifecycle, UI/accessibility, and storage/tooling.
- Keep a failing regression test for every confirmed issue before implementing its fix.
- Run `node --test tests/*.test.js`, `node --check` for changed JavaScript files, and `git diff --check` after each relevant group.
- For cached-file changes, bump and synchronize the service-worker cache version, HTML version badge, and README shield once for the release.
- Do not add third-party browser dependencies or build tooling without explicit approval. An optional Python development dependency is separate from the app runtime.
- Review `audit_validation_plan.md` and this HTML version together; update both if validation status or remediation decisions change.

---

# Final Verdict

The original audit's two High-severity issues and the main clipboard/state findings are independently verified. Two findings remain conditional on browser-specific behavior and should be validated before deciding whether to implement them. One alleged security issue (XSS through the current history/display rendering) is correctly rejected as a false positive.

Four additional findings should be added to the backlog: scientific-notation precision loss, quota-related history divergence, origin-level localStorage sharing under GitHub Pages project paths, and clipboard-fallback DOM cleanup on exceptions.

**Recommended next action:** implement Priority 2 first, with regression tests and careful scope/transactional design. Do not modify source code merely by copying the example patches from `audit.md`; this plan refines them where the initial report's proposed fix is incomplete or too broad.
