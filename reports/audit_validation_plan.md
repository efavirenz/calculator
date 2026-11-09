# Audit Validation & Remediation Plan — Calculator PWA

**Validation date:** 2026-11-08
**Validator:** Independent review of `reports/audit.md` (dated 2026-11-08, HEAD `808ac42`, release v7.11)
**Method:** Full re-read of every runtime file, re-execution of the Node test suite (`node --test tests/*.test.js` → 86 pass / 0 fail), and independent runtime-probe reproduction of every functional claim made in the audit report. No application code was modified.

---

# Executive Summary

| Metric | Value |
| --- | --- |
| Total findings in `reports/audit.md` | 25 |
| Findings **Confirmed** | 21 (includes AUD-022…AUD-025, whose "False Positive" statuses were independently validated as correct) |
| Findings **Partially Confirmed** | 0 |
| Findings **Rejected** | 0 |
| **New findings discovered** | 6 (NEW-001 … NEW-006) |
| Total issues requiring remediation | 27 |

**Headline conclusions**

1. The audit report is **highly accurate**. Every functional reproduction claimed in the audit (AUD-001, 002, 003, 004, 014, 021) was independently reproduced against the real ES modules with identical results. Code-inspection findings (AUD-005…AUD-013, AUD-015…AUD-020) all check out against the source.
2. The single most important defect is **AUD-001**: `formatNumber()` rounds results to 12 significant digits while the input layer accepts up to 15 digits, so pressing `=` silently corrupts values the user entered (`1234567890123` → `1234567890120`; chained `+1` still shows `1234567890120`). Verified by direct execution.
3. Four "False Positive" verdicts (AUD-022…AUD-025) are correct: no `innerHTML`/`eval` anywhere in `js/` (verified by grep — the only match is a doc comment), quota-failure handling is resilient and tested, and listener management in the UI layer is clean.
4. The independent review found **6 additional issues**, the most significant being NEW-001: pressing an arithmetic operator while in exponent-entry mode is silently absorbed into the exponent (`5 xʸ 2 + 3 =` → `5^(2+3)` = **3125**, not 28).

---

# Audit Findings Validation

For each finding: what the audit claimed, what this validation found (with evidence from the real codebase / real module executions), and an assessment of the audit's own analysis.

---

## AUD-001 — 12-significant-digit result rounding corrupts accepted 13–15 digit inputs

* **Severity (audit):** High
* **Validation Result:** ✅ **Confirmed** (reproduced at runtime)

### Technical Evidence

- `js/expressionParser.js` `formatNumber()` line 260: `let rounded = parseFloat(value.toPrecision(12));`
- `js/calculatorState.js` lines 27–28: `MAX_DIGITS_BEFORE_DECIMAL = 15`, `MAX_DIGITS_AFTER_DECIMAL = 15`; enforced by `_leadingDigitLimitReached()`.

Independent reproduction (real modules, Node):

```
evaluateExpression('999999999999999')  => "1e+15"        (expected 999999999999999)
evaluateExpression('123456789012345')  => "123456789012000"
evaluateExpression('1234567890123')    => "1234567890120"
evaluateExpression('99999999999999.9') => "100000000000000"
evaluateExpression('1234567890120+1')  => "1234567890120"  (chained corruption)
evaluateExpression('0.1+0.2')          => "0.3"          (noise cleanup still works)
```

All values match the audit's reproduction exactly. The corruption also propagates through history (`app.js` `onEvaluate` stores `state.resultString`), clipboard copy (`tokensToClipboardText` of re-parsed tokens), and `_tokensFromString` chaining.

### Root Cause

Display precision policy (12 significant digits) and input acceptance policy (15 integer digits) are defined in two different modules with conflicting values. `formatNumber` was written for noise cleanup; the input limits were added later without synchronizing.

### Audit Report Assessment

- **Issue identified:** Correct.
- **Severity:** High is appropriate — it is a silent wrong-answer class defect for values the UI explicitly accepts.
- **Root cause:** Correct.
- **Recommended fix:** Sound. The proposed `toPrecision(15)` was not executed here, but the audit reports it was; the recommendation to also audit dependent test expectations and the `toExponential` mantissa width is appropriate. The 1e15 threshold in `formatNumber` is consistent with 15-significant-digit policy.

---

## AUD-002 — Paste silently concatenates into the current number; parenthesized pastes rejected

* **Severity (audit):** Medium
* **Validation Result:** ✅ **Confirmed** (reproduced at runtime)

### Technical Evidence

`js/calculatorState.js` `pasteExpression()` line 491–502: only inserts an implicit `×` when the existing last token is `rparen`. Independent reproduction:

| Existing | Pasted | Result | Outcome |
| --- | --- | --- | --- |
| `5` | `12345` | raw `512345` | silently concatenated |
| `5` | `2+3` | raw `52+3` = 55 | silently concatenated |
| `2+3` | `4` | raw `2+34` = 36 | silently concatenated |
| `10` | `(2+3)×4` | raw unchanged `10` | **REJECTED** (valid in isolation) |
| `10+` | `(2+3)×4` | raw `10+(2+3)×4` | accepted |

All five rows match the audit's table exactly.

### Root Cause

The paste-combination rule is ad-hoc ("×" only after `rparen`) instead of being derived from token grammar: value-adjacent-value needs an explicit rule (insert `×`, reject, or replace).

### Audit Report Assessment

- Correct on issue, root cause, and severity (silent value corruption + unexpected rejection of valid input = Medium).
- The "safest default: replace" recommendation in the fix section conflicts slightly with the "insert ×" example patch, but the patch explicitly documents the policy fork — appropriate.

---

## AUD-003 — Stale exponent mode after error + Backspace (display ≠ evaluation)

* **Severity (audit):** Medium
* **Validation Result:** ✅ **Confirmed** (reproduced at runtime)

### Technical Evidence

`js/calculatorState.js` `backspace()` error branch (lines 707–712) returns **without** the exponent-mode recomputation the normal branch performs (lines 726–737). Runtime probe:

```
5 → xʸ → =        => { success:false, error:'Incomplete expression' }, exponentMode=true (stale)
backspace()       => exponentMode=true, tokens=[5]
inputDigit('3')   => raw="53", token 3 isExponent=true  → renders as 5³
evaluate()        => { success:true, result:'53' }
```

Screen shows `5³`; the evaluator computes `53`. A display/evaluation divergence, exactly as the audit described.

### Root Cause

`exponentMode` is a derived second source of truth; the error-recovery early-return path in `backspace()` was added without re-deriving it.

### Audit Report Assessment

Fully correct on issue, root cause, severity, and fix (extract a `_recomputeExponentMode()` helper used by both branches). The proposed invariant test ("no `isExponent` token without exponent context") is the right regression guard.

---

## AUD-004 — Exiting exponent mode then typing a digit/decimal builds unparseable expressions

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed** (reproduced at runtime)

### Technical Evidence

`inputDigit()` (line 411) and `inputDecimal()` (line 423) insert an implicit `×` only when the last token is `rparen` — not when the trailing term is an exponent run after `exponentMode` was toggled off. Runtime probe:

```
2 → xʸ → 3 → xʸ (exit) → 4     => raw "2^(3)4",  evaluate: "Invalid expression"
1.5 → xʸ → 2 → xʸ (exit) → .   => raw "1.5^(2).", evaluate: "Malformed decimal number"
```

Matches the audit's reproductions exactly.

### Root Cause

Implicit-multiplication insertion is duplicated across `inputDigit`, `inputDecimal`, `inputOpenParen`, and `pasteExpression` instead of centralized; the "after exponent run" case was missed in two of them.

### Audit Report Assessment

Correct. The proposed `_ensureImplicitMultiplicationBeforeValue()` helper (which also fixes the duplication that caused AUD-004) is the right direction, and pairs naturally with NEW-001 below (same family).

---

## AUD-005 — Global `touchmove` `preventDefault` blocks pinch-zoom and off-allowlist scrolling

* **Severity (audit):** Medium
* **Validation Result:** ✅ **Confirmed** (code-certain; browser impact as described)

### Technical Evidence

- `js/app.js` lines 63–72: document-level non-passive `touchmove` listener calling `event.preventDefault()` for every touch not inside `.history-list`/`.display-line`.
- `index.html` line 5: viewport has no `user-scalable=no`, so the JS veto is the only zoom blocker.
- `css/style.css` lines 39–46 already use `position:fixed; overflow:hidden; overscroll-behavior:none` on `html, body` and `touch-action: manipulation` on `.app`/`.btn` — i.e., the CSS-only mitigations the audit recommends already exist, meaning part of the *motivation* for the JS veto is historical (iOS rubber-banding) and the veto is now redundant except for browser edges.

### Root Cause

Over-broad gesture suppression installed to prevent overscroll on iOS, implemented as a document-level veto rather than CSS containment.

### Audit Report Assessment

Correct, including the honest "browser-behaviour inferred" labelling. Severity Medium is defensible (WCAG 1.4.4 concern). One nuance: the audit's proposed "better: remove the listener entirely" is supported by the fact that the CSS containment listed above already exists; the residual risk (older WebKit quirk) should be validated on iOS in the release checklist.

---

## AUD-006 — Global Enter shortcut steals activation from focused keypad buttons

* **Severity (audit):** Medium
* **Validation Result:** ✅ **Confirmed**

### Technical Evidence

- `js/inputController.js`: `KEY_TO_ACTION.Enter = 'equals'` (line 11); the keydown handler (lines 202–246) calls `event.preventDefault()` for any mapped key **after** guards for `input, textarea, dialog` and open dialogs — but not for focused `<button>`s.
- `attachKeypad()` (lines 180–187) programmatically focuses the button on `pointerdown`, so after any tap a keypad button holds focus.
- `preventDefault()` on keydown suppresses the native Enter-activation click of the focused button; the click fallback only handles `detail === 0` activations, which never occur once the keydown default is cancelled.

Code-path analysis: tap `7` (button focused) → press Enter → global handler maps to `equals`, prevents default, dispatches `equals` → the focused `7` is never activated. Space still activates the focused button because `' '` is unmapped and no default is prevented. Exactly the asymmetry the audit describes.

### Root Cause

A global shortcut competes with native control activation; the guard list (`input, textarea, dialog`) omits interactive controls.

### Audit Report Assessment

Correct and severity-appropriate (primary activation key unavailable to keyboard/switch users while a control is focused). The proposed early-return for `closest('button, [role="button"]')` + regression test is the minimal, correct fix.

---

## AUD-007 — History drawer tabbable while off-screen/`aria-hidden`; no focus restore or trap

* **Severity (audit):** Medium
* **Validation Result:** ✅ **Confirmed**

### Technical Evidence

- `css/style.css` lines 329–349: `.history-panel` is hidden only via `transform: translateX(-105%)`; no `visibility`, `display:none`, or `inert` anywhere.
- `index.html` line 106: `aria-hidden="true"` statically present on the panel.
- `js/uiRenderer.js` `toggleHistoryPanel()` (lines 287–304): toggles class + `aria-hidden`, focuses `.history-close` **only when opening**; never restores focus on close.
- `alert(!open)`-style drift risk confirmed: `aria-hidden` and visibility (`class`) are maintained in two places.
- `renderHistory()` (lines 245–246) sets `role="button"` and `tabIndex = 0` on every history item; `app.js` `handleHistorySelect()` closes the panel without refocusing.

Consequence (per standard DOM/a11y behaviour): with the panel closed, all of its buttons/rows remain in the tab order while `aria-hidden` says they are invisible — the exact "aria-hidden element contains focusable descendants" violation, plus focus loss after close and no trap while open.

### Root Cause

Visibility implemented as animation-only (transform) with the a11y state bolted on separately.

### Audit Report Assessment

Correct. The recommended `panel.inert = !open` + CSS `visibility` fallback + focus restoration to `#hamburger-btn` is the standard, minimal, vanilla-consistent solution (no dependencies required).

---

## AUD-008 — Copy/Paste and expression recall are pointer-only; clipboard menu lacks focus management

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed**

### Technical Evidence

- `index.html` lines 49–50: both display lines are `<div>`s (no `role`, no `tabindex`).
- `js/app.js` lines 162–172: `addSwipeSafeClickListener` on both — click-only; no keydown handling.
- `js/uiRenderer.js` `showClipboardMenu()` (lines 341–361): opens the menu but moves no focus into it; items are `<button>`s reachable only by Tab after the fact; dismissal (`pointerdown`) does not restore focus.

### Root Cause

Interactive affordances were built on plain `<div>`s with click listeners instead of actual buttons, and the menu was never wired into the focus order.

### Audit Report Assessment

Correct. Severity Low is reasonable (keyboard feature gap, not correctness). The recommended fixes (real buttons or `role="button"` + `tabindex` + Enter/Space handlers; focus-in/focus-out for the menu; optionally explicit Copy/Paste buttons) are appropriate.

---

## AUD-009 — History loading bypasses the 50-item cap; weak validation

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed** (reproduced with stubbed `localStorage`)

### Technical Evidence

- `js/storageManager.js` `loadHistory()` (lines 15–35): filters only on expression/result string types and a weak token-shape check; no cap, no `id`/`timestamp`/numeric-result validation, no per-entry token-count bound.
- `js/historyManager.js` caps only in `add()` (line 39).

Independent reproduction:

```
stored array of 60 valid entries  -> loadHistory().length === 60
stored [{ expression:'x', result:'y' }] -> accepted as-is (missing id/timestamp)
```

Matches the audit. The UI then renders `formatTimestamp(undefined)` → "Invalid Date" (`uiRenderer.js` line 262) and select-by-undefined-id (line 265).

### Root Cause

The persistence boundary is the only validation point; `add()` enforces the cap, `load()` does not.

### Audit Report Assessment

Correct. The proposed load-time validator (id non-empty string, finite timestamp, non-empty finite-numeric result, full token flag validation, 512-token cap, `slice(0, 50)`) is complete and testable in Node with a fake `localStorage`.

---

## AUD-010 — Every `=` rewrites storage and rebuilds the closed history drawer; repeated `=` duplicates entries

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed**

### Technical Evidence

- `js/app.js` `onEvaluate` (lines 135–141): `history.add(...)` + `renderHistory(...)` on every successful evaluation, regardless of panel state (the panel's visibility is checked in `handleEscape`, never here).
- `js/uiRenderer.js` `renderHistory()` (lines 230–274): `replaceChildren()` + per-item element creation (3 nodes + 2 listeners each, up to 50) — no `DocumentFragment` batching.
- `js/calculatorState.js` `evaluate()` does not deduplicate: a second `=` on the same tokens re-evaluates and returns success again (verified: `2+2 → =, =, =` → three success outcomes → three `history.add()` calls), each serializing the whole history via `JSON.stringify` in `saveHistory()`.

### Root Cause

No idempotency guard at the history-consumer level, and rendering is unconditional.

### Audit Report Assessment

Correct. The signature-based dedup + render-only-if-open + DocumentFragment recommendations are all low-risk and measurable.

---

## AUD-011 — Precache install all-or-nothing; offline non-navigation fetch resolves `undefined`; cache-first staleness

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed** (per Cache/Service-Worker specs; currently latent)

### Technical Evidence

- `service-worker.js` lines 39–46: install uses `cache.addAll(PRECACHE_URLS)` — per spec, one failure rejects the whole install; `skipWaiting` then never runs; registration `.catch` only logs (`js/pwaBootstrap.js` line 21).
- Lines 84–89: offline `.catch()` returns `undefined` for non-navigation requests → `respondWith(undefined)` → network error.
- Line 72: `caches.match(event.request)` (cross-cache, never revalidates) for any same-origin GET → cached-once-stays-stale-until-version-bump.
- **Latency check:** the current `PRECACHE_URLS` list was cross-checked against the `icons/` directory and all 20 entries exist — the fragility is real but not currently triggered.

### Root Cause

Fail-fast install strategy and a respondWith fallback that relies on `undefined` being tolerated.

### Audit Report Assessment

Correct, including the "likely" hedging. The core/optional split with `Promise.allSettled`, explicit 504-style `Response` fallback, scoped `cache.match`, and a CI existence test are all appropriate. Severity Low is right for a calculator (offline HTML nav is still protected).

---

## AUD-012 — Version badge reloads unconditionally without awaiting SW activation

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed**

### Technical Evidence

`js/pwaBootstrap.js` `setupForceUpdate()` lines 40–54: sets `'Checking...'`, tries `registration.update()` (best-effort, may do nothing if no registration or scope mismatch), and then **always** `window.location.reload()` — including when no update exists and regardless of whether the new worker finished activating. In-memory state (current expression) is lost. `registration.update()` resolves after the update *check*, not after activation, so the reload can even serve the old cache.

### Root Cause

The update affordance conflates "check for update" with "apply update now", without awaiting worker lifecycle or asking the user.

### Audit Report Assessment

Correct. The recommended flow (reload only if `waiting`/`installing`, wait for `statechange → activated` or `controllerchange`, otherwise report "Up to date") is the standard pattern. Persisting the expression to `sessionStorage` is a good supplementary fix.

---

## AUD-013 — Deploy workflow publishes the whole repository; tests never run in CI

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed**

### Technical Evidence

`.github/workflows/deploy.yml` (full read): a single `deploy` job — checkout, `configure-pages@v5`, `upload-pages-artifact@v3` with `path: "."`, `deploy-pages@v4`. No `node --test` step, no staging directory, no integrity check. The artifact is the repo root: `tests/`, `README.md`, `generate_icons.py`, `requirements-dev.txt`, `.github/`, and any committed `reports/` would all be published.

### Root Cause

The workflow was scaffolded to deploy without a build/test stage.

### Audit Report Assessment

Correct. The proposed test job + `_site/` staging + precache/version integrity check directly address it. Pinning actions to SHAs is a reasonable hardening suggestion.

---

## AUD-014 — Sign toggle on a power expression changes base precedence inconsistently

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed** (reproduced at runtime)

### Technical Evidence

- `inputPower()` lines 588–600 auto-wraps a leading unary minus into `(-operand)` before inserting `^`.
- `toggleSign()` lines 670–681 splices a bare `-` token at `range.start`; `_findTrailingOperandRange()` (lines 210–215) deliberately includes the base when previous token is `^`.

Runtime probe:

```
5 → xʸ → 2 → xʸ (exit) → +/-   => raw "-5^(2)"  => -25
5 → +/- → xʸ → 2               => raw "(-5)^(2)" => 25
```

Both rows match the audit. Same visible intent, two different results depending on press order.

### Root Cause

Sign handling split across two code paths with different precedence outcomes (`-5^2` evaluates as `-(5^2)` per the parser's unary-minus precedence, which is mathematically standard).

### Audit Report Assessment

Correct. The recommended unification (make `+/-` on a power term produce `(-base)^exp`, matching `inputPower`) preserves user intent and is testable.

---

## AUD-015 — README contradicts implemented exponent/reciprocal/history behaviour; references missing file

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed**

### Technical Evidence

Verified each claim against `README.md` and the code:

1. §7 line 182: "Pressing any operator, `)`, or `=` ends the mode (per spec)" — the code does **not** end exponent mode on operators or `)` (verified: `inputOperator`/`inputOpenParen` never reset `exponentMode`; operators are even marked `isExponent: true` and absorbed into the exponent run). §14.6 contradicts §7.
2. §7 lines 183–186: claims `1/x` wraps as hidden `^(-1)` with all-hidden tokens; `inputReciprocal()` (lines 641–648) actually builds a visible `(1÷operand)` group. (README §14.5 line 438 itself documents the `(1÷x)` change — the contradiction is internal to the README.)
3. §8 line 230: "Tapping a history entry re-runs that calculation's **result** as a fresh input" — `app.js` `handleHistorySelect()` calls `state.loadFromHistory(entry.tokens, entry.result)`, which restores the **full expression** as State B; the result-only path (`state._tokensFromString(entry.result)`) is a legacy fallback.
4. §2 line 80 lists `implementation_report.html` — `glob` confirms the file does not exist.

### Root Cause

Documentation drift: v7.3 changed reciprocal notation and history-restore semantics without updating §7/§8; the exponent-mode rule was described in two contradictory sections.

### Audit Report Assessment

Correct on all four sub-claims. Recommended doc code-alignment is appropriate.

---

## AUD-016 — `app.js` reaches into private state (`_tokensFromString`) and reassigns `tokens`

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed**

### Technical Evidence

`js/app.js` `handleHistorySelect()` lines 149–153 (legacy fallback): `state.clearAll(); state.tokens = state._tokensFromString(entry.result); state.displayState = DisplayState.ENTRY;` — direct field mutation and private-method call, in violation of the composition-root/app-boundary rule stated in AGENTS.md and README §3.

### Root Cause

The legacy no-tokens history path predates `loadFromHistory()` and was never encapsulated.

### Audit Report Assessment

Correct. The proposed `loadResultOnly()` public method (with internal normalization/validation) is the right fix and doubles as the place to validate legacy-stored values (ties into AUD-009).

---

## AUD-017 — Dead/unreachable code and unused exports/parameters

* **Severity (audit):** Informational
* **Validation Result:** ✅ **Confirmed**

### Technical Evidence (each sub-claim verified)

- `RIGHT_ASSOCIATIVE` includes `'u-'` (`expressionParser.js` line 36) — `'u-'` is never processed as an *incoming* operator (`toRPN()` pushes it directly at line 133 without calling `comparePrecedence`), so the membership is dead. (Nuance: `'u-'` *is* consulted as a **stack-top**, but only via `PRECEDENCE['u-']`, not via the right-associativity set.)
- `showCopyToast()` exported in `uiRenderer.js` line 334, grep shows no importer.
- `SELECTORS` exported (line 381), no importer outside `uiRenderer.js`.
- `CalculatorState.pasteNumber()` (lines 516–518) is an alias referenced only by tests.
- `InputController`'s `before`/`result` args to `onEvaluate` (lines 123–126) — `app.js`'s `onEvaluate: (tokens) => {…}` ignores both.
- Duplicated parenthesis-enclosure logic: `isEnclosedInParens` (`calculatorState.js` line 39) vs `isEnclosedInParensString` (`formatUtils.js` line 28) — near-identical implementations.

### Audit Report Assessment

All claims verified. Fixes are cosmetic/low-risk; do them in a cleanup commit grouped with tests.

---

## AUD-018 — Duplicate tests and untested critical paths

* **Severity (audit):** Informational
* **Validation Result:** ✅ **Confirmed**

### Technical Evidence

- Duplicate named tests confirmed by grep in `tests/state.test.js`, exactly the 5 pairs claimed (lines 43/988, 55/999, 63/1007, 93/1016, 99/1022); test-count summary shows each of these titles appears twice in the suite (`grep "^test(" | uniq -c` → five titles with count 2).
- No test file references `service-worker`, `PRECACHE`, or `manifest` (grep over `tests/` — zero hits).
- No test covers numeric fidelity for 13–15 digit integers (AUD-001 invisible to the suite — verified by the passing run of the current suite while AUD-001 reproduces).
- `uiRenderer.js`, `app.js`, `pwaBootstrap.js` have no dedicated test files (test dir contains format/parser/state/inputController/storage only).
- `loadHistory()` validation/cap untested (`tests/storage.test.js` has 2 tests only).

### Audit Report Assessment

Correct, including the prioritized list of highest-risk tests to add. This is the cheapest quality lever available.

---

## AUD-019 — CSP sound for scripts but meta-only; `style-src 'unsafe-inline'`; no frame protection

* **Severity (audit):** Informational
* **Validation Result:** ✅ **Confirmed**

### Technical Evidence

`index.html` line 8: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self';`. Script-src falls back to `'self'` (no inline scripts exist — the only `<script>` is `src="./js/app.js"`). No `frame-ancestors`, no `report-uri`, no `Permissions-Policy`. `style-src 'unsafe-inline'` is genuinely required by the code (`uiRenderer.js` writes `element.style.fontSize/display/visibility` directly).

### Audit Report Assessment

Accurate and appropriately hedged (meta-CSP limitations are platform facts). Recommendations are defense-in-depth; informational severity is right.

---

## AUD-020 — History readable by any other app on the shared origin

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed** (documented risk; real)

### Technical Evidence

`js/storageManager.js` lines 10, 45: raw JSON under `calculator.history.v1` in readable `localStorage`. README §(privacy) lines 226–229 explicitly discloses the sibling-origin exposure. GitHub Pages project sites share one origin per user, so any same-origin sibling app's JS can read (or overwrite) the key.

### Audit Report Assessment

Correct. The audit correctly treats this as an environmental constraint with mitigations (disclosure, session-only mode option, dedicated-origin guidance) rather than a code defect to "fix".

---

## AUD-021 — Paste rejects valid error-producing expressions, Unicode minus; misreads European decimals

* **Severity (audit):** Low
* **Validation Result:** ✅ **Confirmed** (reproduced at runtime)

### Technical Evidence

`_parsePastedExpression()` (lines 271–371): validation delegates to the full evaluator (line 366) and the normalizer removes commas/currency/whitespace unconditionally (line 273) with an ASCII-minus-only whitelist (line 277). Runtime probe:

```
paste '1234,567'   -> raw 1234567   (comma silently deleted)
paste '1.234,56'   -> raw 1.23456    (factor-of-1000 misinterpretation)
paste '5−3' (U+2212) -> REJECTED
paste '1/0'        -> REJECTED
paste '10^400'     -> REJECTED
paste '(-2)^0.5'   -> REJECTED
paste '5'          -> accepted
```

All match the audit. (Note the mild counter-case: US-formatted `'1234,567'` → `1234567` happens to be correct, so comma deletion is only wrong for ambiguity/European formats — but the failure mode is silent, which is the core problem.)

### Root Cause

Conflation of syntax validation with evaluation success, plus a single-locale heuristic in normalization.

### Audit Report Assessment

Correct. The recommendation to split `validateSyntax` from `evaluateExpression`, normalize Unicode dashes, and treat combined `,`/`.` inputs as ambiguous (reject or locale-aware) rather than silently deleting commas, is the right shape. Returning specific reasons instead of the generic "Nothing to paste" toast is a clear UX win.

---

## AUD-022 — XSS via history/token rendering (audit status: False Positive)

* **Severity (audit):** Informational
* **Validation Result:** ✅ **Confirmed as a correct False Positive**

### Technical Evidence

Full-file review of `uiRenderer.js`: every text insertion uses `textContent`/`createTextNode` (`sup.textContent` line 52, `createTextNode` line 75, `resultEl.textContent` line 258, `timeEl.textContent` line 262, `toast.textContent` line 325). Grep across `js/` for `innerHTML|outerHTML|insertAdjacentHTML|document.write|eval\(|new Function` returns zero code matches (the only hit is `expressionParser.js` line 6, a comment). History entries come from localStorage (weakly validated — see AUD-009) but even malicious content is rendered as text.

### Audit Report Assessment

Correct conclusion. The recommended CI-grep preservation is worth adopting.

---

## AUD-023 — DOM clobbering / eval-style injection (audit status: False Positive)

* **Severity (audit):** Informational
* **Validation Result:** ✅ **Confirmed as a correct False Positive**

### Technical Evidence

All element access is by explicit literal selectors (`document.getElementById`/`querySelector` with fixed literals in `app.js`/`uiRenderer.js`); no `window[name]`, no `Function()`, no template engines. Pasted text is tokenized to a strict `digit/decimal/operator/lparen/rparen` whitelist (`/^[0-9.+\-×÷^()eE]+$/`, line 277) and rejected otherwise; dynamic attribute writes are fixed-value (`aria-disabled`, `aria-hidden`, `aria-expanded`, `role`, `tabIndex`, `hidden`, classList).

### Audit Report Assessment

Correct. No action beyond preserving invariants.

---

## AUD-024 — `localStorage` quota failure crashes/loses history (audit status: False Positive)

* **Severity (audit):** Informational
* **Validation Result:** ✅ **Confirmed as a correct False Positive**

### Technical Evidence

`storageManager.saveHistory()` (lines 42–56): try/catch, halve-and-retry (entries > 5), returns `{success, entries, trimmed}`. `historyManager.add()` (lines 42–46): on failure, `this.entries.shift()` removes the unpersisted newest entry (not the user's data); `lastSaveFailed` surfaces a toast in `app.js` `onEvaluate` (line 140). `loadHistory()`/`clearHistoryStorage()` are guarded; `tests/storage.test.js` covers trim and total failure.

### Audit Report Assessment

Correct. Residual deliberate data loss (trimming) is documented and surfaced; the suggested improvements (count in toast, export before trim) are optional.

---

## AUD-025 — History rendering/listeners leak memory (audit status: False Positive)

* **Severity (audit):** Informational
* **Validation Result:** ✅ **Confirmed as a correct False Positive**

### Technical Evidence

`renderHistory()` replaces children (`replaceChildren()` line 232) — per-item listeners attach to items that die with the nodes. Clipboard menu dismissal keeps a single module-level handler explicitly removed before re-registration (lines 349–360, 375–378). Toast timeout cleared before replacement (lines 327–330). No retained-handler leak found. The real cost is the churn described in AUD-010.

### Audit Report Assessment

Correct — the finding is routed to AUD-010's optimizations rather than a leak fix.

---

# New Issues Discovered

Six issues the audit did not list. Each was verified against the running modules.

---

## NEW-001 — Arithmetic operators pressed during exponent-entry mode are absorbed into the exponent

* **Severity:** **Medium** (functional/UX intent mismatch)
* **Category:** Functional correctness / input handling — same family as AUD-003/AUD-004

### Evidence

`js/calculatorState.js` `inputOperator()` (lines 521–561): the final push is `makeToken(op, 'operator', { isExponent: this.exponentMode })`. While `exponentMode` is active, Arithmetic operators are marked `isExponent: true` — they join the exponent run. `rawExpression()` (lines 171–186) then collects every consecutive `isExponent` token into the parenthesized exponent.

Runtime probe (real modules):

```
5 → xʸ → 2 → + → 3 → =
  tokens: 5 ^(hidden) 2(exp) +(exp) 3(exp)
  raw:       "5^(2+3)"
  evaluate:  3125      (user almost certainly expected 25 + 3 = 28)
```

The screen renders this as `5²⁺³` — a superscript binary operator with a superscript trailing digit. Mathematically self-consistent, but it violates the near-universal iOS-calculator expectation that `+` leaves any current entry state, and there is no way to "escape" the exponent and use `+` normally without first pressing `xʸ` a second time.

### Root Cause

The exponent-mode persistence rule (deliberate per README §14.6, and contradictory with README §7 — AUD-015) combined with non-modal-but-marked operators: instead of terminating the exponent run, the run is extended with the operator.

### Recommended Remediation

End exponent-entry mode when a **binary arithmetic operator** (`+ - × ÷`) is pressed (treat as "close the exponent"), matching calculator convention and mysteriously aligning README §7/§14.6. Any remaining design option (keep current behavior) must at least be documented as the single source of truth and covered by tests. If the absorbed-operator design is kept, at minimum render plain (non-superscript) operators so the display is unambiguous. Coordinate with the AUD-004 fix (`_ensureImplicitMultiplicationBeforeValue`) so the transition `2³ → × → 4` behaves correctly.

---

## NEW-002 — `evaluate()`'s auto-close of parentheses mutates the token stream even when evaluation fails

* **Severity:** Low
* **Category:** State machine edge case

### Evidence

`evaluate()` (lines 796–802) computes unbalanced parens and pushes `)` tokens into `this.tokens` **before** evaluation. If evaluation then throws (e.g. Division by zero), the error branch (lines 813–816) sets `errorMessage` but leaves the mutated tokens in place.

Runtime probe:

```
( → 5 → ÷ → 0 → =
  rawExpression before: "(5÷0"
  evaluate: { success:false, error:'Division by zero' }
  rawExpression after:  "(5÷0)"     ← phantom ')' the user never typed
  backspace():            pops one ')' token (removing the phantom minus the user's own chars)
```

The error display now shows an expression containing tokens the user did not enter; `recallExpressionToEntry()` and history-reload paths inherit them.

### Root Cause

Token mutation committed unconditionally before validation.

### Recommended Remediation

Evaluate the auto-closed expression **on a copy** (build the auto-closed token array locally and serialize from it); commit appended `)` tokens to `this.tokens` only on success. Zero-UX-change fix, testable with the Division-by-zero probe above.

---

## NEW-003 — Forced synchronous layout in the render path on every keystroke

* **Severity:** Low
* **Category:** Performance / reflow

### Evidence

`js/uiRenderer.js` `renderDisplay()` runs per state change (i.e., per keypress):

- `autoShrinkToFit()` (lines 165–177): writes `style.fontSize`, then reads `el.scrollWidth > el.clientWidth` / `clientWidth` — a layout-invalidating write followed by a forced synchronous layout read (twice per call in the B/either branch since it is called for both displays — up to 4 forced layouts per render).
- `scrollToDisplayEnd()` (lines 154–162): reads `scrollWidth` twice (immediately and inside `requestAnimationFrame`) and writes `scrollLeft` — two more read/write pairs.

Additionally, `app.js` attaches full `render()` to `resize` (line 260) + `orientationchange` ×2 (lines 261–264) with no throttle; a touch-drag-resize on desktop can invoke `renderDisplay` continuously.

### Root Cause

East-west read/write interleaving with no batching; auto-shrink measures live elements instead of computing from text metrics.

### Recommended Remediation

Batch reads before writes within `renderDisplay` (measure once, then set), cache `getComputedStyle` custom properties per orientation, and consider measuring the candidate string in an offscreen measurer node (or computing expected width from `ch`-based approximation) to avoid per-keystroke forced layouts. Throttle/debounce `resize` with `requestAnimationFrame`. Validate with a Performance recording iterating ~50 digit presses; target zero forced-sync-layout warnings per frame.

---

## NEW-004 — Manifest locks installed PWA to portrait while the app implements landscape layout

* **Severity:** Low
* **Category:** PWA consistency

### Evidence

- `manifest.json` line 11: `"orientation": "portrait"`.
- `css/style.css` lines 518–609: a complete, deliberately implemented landscape 6×4 layout; `app.js` subscribes to `orientationchange` to re-render for it.

On Android/Chromium the manifest orientation locks installed standalone windows to portrait, making the landscape stylesheet dead code; on iOS Safari the orientation field is largely ignored, yielding inconsistent behavior across platforms.

### Root Cause

Manifest written for the phone-lock use case without reference to the (later) landscape CSS.

### Recommended Remediation

Decide: either set `"orientation": "any"` (landscape layout becomes reachable in installed PWAs), or drop the landscape stylesheet/`orientationchange` handling (accepting portrait-only on lockable platforms). Given the app already ships and maintains landscape CSS, `any` is the cheap option; document the choice in README.

---

## NEW-005 — `#history-overlay` is statically `aria-hidden="true"` but becomes an interactive click target when open

* **Severity:** Low
* **Category:** Accessibility

### Evidence

- `index.html` line 105: `<div id="history-overlay" class="history-overlay" aria-hidden="true"></div>` — never updated by `toggleHistoryPanel()` (which only syncs panel/hamburger).
- `css/style.css` lines 324–327: `.history-overlay.is-open { pointer-events: auto; }` plus an `app.js` click handler — i.e., an element declared `aria-hidden` is the click-to-close affordance (mouse/AT-click path), while keyboard dismissal only works via Escape.

### Root Cause

The overlay's a11y state was set once in the HTML and never synchronized with its interactive state.

### Recommended Remediation

Track overlay open/close in `toggleHistoryPanel()` (`overlay.setAttribute('aria-hidden', String(!open))`) or, better, remove `aria-hidden` from the overlay entirely (it is THC-free decorative and not focusable; using `aria-hidden` on a click target is an anti-pattern), and keep Escape as the keyboard dismissal (already wired). Fold into the AUD-007 fix.

---

## NEW-006 — Multi-tab history edits silently discard the other tab's entries (no `storage` event handling)

* **Severity:** Low
* **Category:** Reliability

### Evidence

`historyManager.add()` (lines 38–44) is unconditionally newest-first in-memory and writes the whole list; `loadHistory()` runs only at construction. If two tabs of the app are open, each holds its own `HistoryManager`; every `=` in tab A rewrites `calculator.history.v1` and erases entries added in tab B since its own last write (last-write-wins with silent loss). The audit mentioned this under "Reliability Improvements" but not as a finding. No `storage` listener exists anywhere in `js/`.

### Root Cause

No cross-tab reconciliation at the persistence boundary.

### Recommended Remediation

Add a `window.addEventListener('storage', …)` in `app.js` (or `HistoryManager.reload()` invoked from it) that re-reads the key when another tab writes, merging by `id`/timestamp before the next write; at minimum reload the list so the drawer reflects the other tab. Low priority since multi-tab calculator use is uncommon; the fix is cheap and also helps recover from PWA+browser-tab dual contexts.

---

# Remediation Plan

Every confirmed/partially confirmed audit finding and every new finding, with solution strategy, alternatives, risk, and validation.

---

## R1 — AUD-001: Restore numeric fidelity (display precision 15 significant digits)

### 1. Proposed Solution

1. In `js/expressionParser.js` `formatNumber()`: change `parseFloat(value.toPrecision(12))` → `toPrecision(15)`; raise `toExponential(11)` → `toExponential(14)`; keep the ±1e15 / 1e-9 thresholds (they are consistent with a 15-significant-digit policy).
2. Regenerate dependent test expectations in `tests/parser.test.js` and `tests/state.test.js` (12-digit strings such as `'0.454545454545'`, `'2.08008382305'`, `'1.44224957031'` become 15-digit strings).
3. Add regression tests: `formatNumber(999999999999999) === '999999999999999'`, `evaluateExpression('1234567890123') === '1234567890123'`, `evaluateExpression('1234567890123+1') === '1234567890124'`, plus noise-clean cases `0.1+0.2 → 0.3`, `0.1+0.7 → 0.8`, `1.005×100 → 100.5`, and exponent-threshold cases just inside/outside `1e15`/`1e-9`.
4. Add a comment documenting the precision policy, and (recommended) hoist the policy constant into a shared `config`/`numericPolicy` module instead of free-standing literals in the parser and state.

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. `toPrecision(15)` (recommended)** | Minimal change; verified to preserve all accepted integers; float-noise cleanup (`0.1+0.2`) still works because `parseFloat` strips trailing zeros of the precise representation — the classic noise cases survive at 15 digits. |
| B. Bigger hammer: 17-digit round-trip (`toLocaleString('full-precision')` or `value.toString()`) | Devolves into displaying raw float artifacts (`0.1+0.2 → 0.30000000000000004`) unless a separate cleanup heuristic is added — worse UX, no fidelity gain for legitimate input. |
| C. Configurable precision for tests | Adds config plumbing for little benefit once A's regression coverage exists; useful only if tests are parameterized. |
| D. Enforce 15 significant digits at *input* time instead | Changes input restrictions mid-release; stricter than most calculators; rejects 16+ integer digits that currently type-check (and such values are already > 1e15 territory). Combine with A only if product wants symmetric guarantees. |

### 3. Risk Assessment

- **Breaking-change risk:** Low — display strings change slightly for chained/long decimal results (intended).
- **Regression risk:** Medium — the formatter threshold interplay (`1e15`, `1e-9`, trailing-zero regexes) must be re-tested on both sides of thresholds; history/chaining consumes the result string serially, so tests must cover chained `_tokensFromString` round trips.
- **Security impact:** none.
- **Performance impact:** none (same code path).

### 4. Validation Strategy

- Unit: new fixed-value tests + full suite green.
- Chaining: `evaluateExpression(evaluateExpression('1234567890123') + '+1')` equals `1234567890124`.
- Manual: sample matrix on device (enter 13-digit number, `=`, `+1`, `=`; verify display and history).
- Documentation: update README/AGENTS.md "precision" statements if any.

---

## R2 — AUD-002: Define paste-combination semantics

### 1. Proposed Solution

Rewrite `pasteExpression()`'s combination branch with one documented rule:

- In entry mode, compute `leftIsValue` (last token is `digit`/`decimal`/`rparen`) and `rightStartsValue` (pasted first token is `digit`/`decimal`/`lparen`).
- **Recommended default: append with an implicit `×` whenever `leftIsValue && rightStartsValue`** (consistent with the keypad's own `)`-then-`(` and digit-after-`(` implicit-multiplication rules), so `10` + `(2+3)×4` becomes `10×(2+3)×4` and `5` + `12345` becomes `5×12345` — never silent digit concatenation.
- Keep the existing transactional validation (evaluate the combined expression before commit; reject on error).
- Return a reason code (`'empty' | 'invalid' | 'too-long' | 'rejected'`) and let `app.js` show specific toasts ("Cannot combine with current expression" vs "Nothing to paste").

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. Insert × between value-adjacent pastes (recommended)** | Consistent with keypad implicit multiplication; never corrupts values; user sees exactly what happened on screen. |
| B. Paste **replaces** the expression in entry mode | Simplest semantics; but appending after a trailing operator (`5+` + `3`) must still work, and replace-on-`5`+paste-`12345` would be jarring (deleting what the user typed). |
| C. Reject ambiguous digit+digit juxtaposition | Safest but adds a rejection case to a feature already criticized for over-rejecting (AUD-021). |
| D. Show confirmation on insert | Overkill for a one-tap flow; requires new UI. |

### 3. Risk Assessment

- **Breaking-change risk:** Low-medium — behavior of the combine path changes for digit-adjacent pastes (was silent concatenation); users who (nobody realistically) depended on concatenation see `5×12345` instead of `512345`.
- **Regression risk:** Low — the change is localized to one branch; existing paste tests (including the five duplicated ones) validate non-combination logic unchanged.
- **Security impact:** none (input still whitelisted; commit still transactional).
- **Performance impact:** negligible (one extra eval validation per combine).

### 4. Validation Strategy

- Unit: matrix tests for existing ∈ {empty, number, `2+3`, `5+`, `(`, `...(1÷x)`-wrapped, exponent run} × pasted ∈ {number, expression, parenthesized, scientific, invalid} — assert token stream and `rawExpression` each time.
- Manual: paste flows on device via the clipboard menu.

---

## R3 — AUD-003: Make exponent-mode re-derivation uniform in `backspace()`

### 1. Proposed Solution

Extract `_recomputeExponentMode()` (reads the new last token; sets `exponentMode = last && ((last is '^' operator) || last.isExponent)`) and call it from **both** `backspace()` branches. Add the state-invariant property test: after any random action sequence, no token has `isExponent: true` unless it is part of an exponent run following a `^`/exponent context, and `rawExpression`'s evaluation matches the displayed superscript structure.

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. Shared helper called in both branches (recommended)** | 6-line change; kills the whole bug class for future early-returns if paired with the invariant test. |
| B. Make `exponentMode` a pure derived getter (no stored flag) | Most robust long-term but touches ~15 call sites and risks subtle timing changes (the flag is mutated and read within single actions); higher regression risk for a calculator at this maturity. |

### 3. Risk Assessment

- **Breaking-change risk:** none intended.
- **Regression risk:** Low — the helper mirrors the existing normal-branch logic verbatim.
- **Security impact:** none.
- **Performance impact:** negligible.

### 4. Validation Strategy

- Unit: the audit's exact reproduction test (`5 → xʸ → = → backspace → 3` must yield `exponentMode === false`, token `isExponent === false`, result `53`).
- Property/invariant test looped with seeded random actions.

---

## R4 — AUD-004 + (NEW-001): Centralize implicit multiplication & define exponent-mode exit on operators

### 1. Proposed Solution

Single helper `_ensureImplicitMultiplicationBeforeValue()` used by `inputDigit()`, `inputDecimal()`, `inputOpenParen()`, and `pasteExpression()`:

- Insert implicit `×` when the trailing term ends a value while not in active entry of that value: last token is `rparen`, **or** last token is an exponent-run token while `exponentMode === false` (AUD-004), **or** (combinable) last is a value token followed by nothing pending.
- For NEW-001: in `inputOperator()`, when `exponentMode === true` and the pressed operator is a binary arithmetic op (`+ - × ÷`), first flush exponent mode (set `exponentMode = false`), then push the operator as a normal (non-superscript) operator — i.e., arithmetic closes the exponent, matching calculator convention and reconciling README §7 with actual behavior. `^` and unary `-` (e.g. negative exponents) remain inside exponent context.

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. Helper + operators end exponent mode (recommended)** | Fixes AUD-004 and NEW-001 with one concept; matches user expectations; makes README §7 truthful. |
| B. Keep absorbed-operator design; only fix AUD-004 | Smaller diff but leaves NEW-001 (e.g. `5^(2+3)` trap) as a documented surprise. |
| C. Never exit exponent mode except on `xʸ` press; keep absorbed design and document | Self-consistent but keeps the 3125-vs-28 surprise; strongest claim to "single source of truth", weakest claim to usability. |

### 3. Risk Assessment

- **Breaking-change risk:** Medium — NEW-001 fix changes documented §14.6 behavior; loud README/test updates required (behavior-spec change, deliberate).
- **Regression risk:** Medium — exponent serialization paths (`rawExpression`, `tokensToClipboardText`, history restore, reciprocal-in-exponent `(1÷x)` superscript) must be re-validated; the absorbed-operator design removal affects any existing test asserting superscript operators.
- **Security impact:** none.
- **Performance impact:** negligible.

### 4. Validation Strategy

- Unit: AUD-004 reproductions (`2^(3)4`, `1.5^(2).` become `2^(3)×4`-like valid streams); NEW-001 reproduction (`5 xʸ 2 + 3 =` → `28`); reciprocal-in-exponent tests; toggle-off/toggle-on sequences.
- Property test: parseability invariant — for every random action sequence, `evaluateExpression(rawExpression)` either succeeds or the state displays an error *before* `=` was pressed.

---

## R5 — AUD-005: Replace the global touchmove veto with CSS + narrow JS

### 1. Proposed Solution

1. Prefer removal: the existing CSS (`html, body { position:fixed; overflow:hidden; overscroll-behavior:none }`, `.app { touch-action: manipulation }`) already prevents rubber-banding in modern Safari. Remove the document listener, keeping per-element `touch-action: pan-x` on `.display-line` and `overflow-y:auto` on `.history-list`.
2. If a JS guard is still needed on target platforms after iOS verification, narrow it exactly as the audit proposes: allow `event.touches.length > 1`, allow `.history-list, .display-line, dialog` ancestors, and only `preventDefault()` when `event.cancelable`.

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. Remove listener (recommended, gated on iOS manual test)** | Restores pinch-zoom everywhere (WCAG 1.4.4); eliminates an entire class of "future scrollable surface breaks" bugs; small risk of reintroducing a historical iOS rubber-band on old WebKit. |
| B. Narrowed listener | Retains rubber-band protection on unverified WebKit builds; keeps allow-list-maintenance burden. |

### 3. Risk Assessment

- **Breaking-change risk:** Low-medium — need iPhone Safari/installed-PWA revalidation (already flagged as required for the v7.11 focus-ring fix; bundle both).
- **Regression risk:** Low; overscroll is already CSS-contained.
- **Security impact:** none.
- **Performance impact:** slightly better (avoids per-touch JS veto work).

### 4. Validation Strategy

- Manual (mandatory): iPhone Safari + installed PWA — pinch-zoom on keypad and dialog; scroll test in history list; rubber-band check at app edges.
- Desktop: simulated touch via devtools.

---

## R6 — AUD-006: Let native activation win for Enter/Space on focused controls

### 1. Proposed Solution

In `attachKeyboard()`, after modifier guards, early-return for `event.key === 'Enter' || event.key === ' '` when `event.target?.closest?.('button, [role="button"]')` exists. Digit and operator shortcuts remain mapped regardless of button focus. Add regression test: dispatch Enter with a focused keypad button target → the button's action dispatches exactly once through the click path, and no `preventDefault` occurs for that key.

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. Early-return for Enter/Space on focused buttons (recommended)** | Minimal; native semantics preserved; keyboard `=` still available when focus is on body. |
| B. Remove Enter from the global map entirely | Loses a popular shortcut (Enter evaluates while focus is not on a control). |

### 3. Risk Assessment

Low on all axes. One behavioral nuance to test: with focus on the `=` button itself, pressing Enter now triggers native activation → dispatch `equals` — identical outcome, no double-dispatch (the global handler returned early; the native click path activates once).

### 4. Validation Strategy

- Unit (InputController with fake targets/window): Enter on focused button; Space on focused button; Enter with focus on body; Escape/history/dialog paths unaffected.
- Manual: keyboard-only pass w/ tab order.

---

## R7 — AUD-007 (+ NEW-005): History drawer inert + focus restore/trap

### 1. Proposed Solution

In `toggleHistoryPanel()`:

- `panel.inert = !open` (with the class/visibility CSS fallback below for older engines),
- `panel.setAttribute('aria-hidden', String(!open))`,
- restore focus to `#hamburger-btn` when closing,
- update overlay `aria-hidden` (or drop it — NEW-005),
- keep `aria-expanded` sync on the hamburger (exists).

Add the CSS visibility/hide fallback exactly as the audit proposes (`visibility: hidden` + transition delay) so off-screen content is also removed from AT trees on browsers where `inert` is unsupported.

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. `inert` + focus restore + Enter/Escape paths (recommended)** | No dependencies; preserves slide animation; broad modern support (Chrome 102+, Safari 15.5+, Firefox 112+). |
| B. Convert drawer to native `<dialog>` | Free focus trap/modality; but restyling and animation continuity add regression risk for the iOS-styled PWA. |

### 3. Risk Assessment

- **Breaking-change risk:** Low.
- **Regression risk:** Low-medium — touch + keyboard + screen-reader flows must be retested (panel open/close on all four paths: hamburger, close button, overlay click, Escape; select-item path; clear-history dialog interplay).
- **Security impact:** none.
- **Performance impact:** negligible.

### 4. Validation Strategy

- Manual a11y pass (VoiceOver + keyboard-only): no tab stops inside closed panel; focus lands on close button when opening and returns to hamburger on all close paths.
- Unit: not DOM-covered; rely on `uiRenderer` extraction (AUD-018 follow-up) if implemented.

---

## R8 — AUD-008: Keyboard-accessible display interactions + clipboard menu focus management

### 1. Proposed Solution

- Make both display lines keyboard-activatable: `role="button"`, `tabindex="0"`, Enter/Space keydown handlers (`recallExpressionToEntry()` for upper, `showClipboardMenu()` for lower); `aria-haspopup="menu"` + descriptive `aria-label` on the lower line.
- In `showClipboardMenu()`, move focus to the first `menuitem`; on `hideClipboardMenu()`, restore focus to the lower display.
- Replace `role="menu"` + `role="menuitem"` with a simple labeled group of two real buttons (arrow-key menu navigation is overkill for 2 items), or implement ArrowLeft/Right if the menu semantics are kept.

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. Div → interactive (role/button) + focus-in/out in menu (recommended)** | Minimal diff; keeps current layout. |
| B. Real `<button>` wrapping each display line | Better native semantics but restyling risk (CSS `.display-line` overflow behaviors with button wrappers). |
| C. Always-visible Copy/Paste buttons in topbar | Best discoverability; adds new UI elements; combine with A later. |

### 3. Risk Assessment

- **Breaking-change risk:** Low; new tab stops change the tab order — verify with AUD-006/R6 work (both areas of keyboard flow).
- **Regression risk:** Low-medium (swipe-safe click path must keep pointer-only behavior unchanged).
- **Security impact:** none. **Performance impact:** negligible.

### 4. Validation Strategy

- Manual keyboard-only test: Tab to display lines, activate with Enter/Space; menu focus in/out; Escape closes and focus restores.
- Unit (if view-model extraction lands): activation handler mapping.

---

## R9 — AUD-009 (+ AUD-016 legacy path): Harden history loading & encapsulate legacy restore

### 1. Proposed Solution

- Rewrite `loadHistory()` with the audit's validator: non-empty string `id`, finite `timestamp`, non-empty finite-numeric `result`, token flag/type validation with `char` length 1, per-entry ≤512 tokens, and `slice(0, 50)`. If any rows are dropped, persist the cleaned list once (or persist lazily on next add).
- In `CalculatorState`, add `loadResultOnly(result)` that validates/normalizes `result` internally (via `_tokensFromString` + numeric clamp) and sets State A — replacing the direct `state.tokens = state._tokensFromString(...)` mutation in `app.js` (AUD-016).
- Have `loadFromHistory()` itself validate tokens (reject/normalize empty or malformed arrays) so `app.js` doesn't need to pre-validate.

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. Validator at storage boundary + public state method (recommended)** | Defense-in-depth at the actual trust boundary; removes private coupling. |
| B. Validator only, keep legacy mutation | Leaves AUD-016; cheaper. |
| C. Version the key (`v2`) and migrate | Ensures old malformed data can't re-enter mid-flight; slightly more code; retained until next cleanup. |

### 3. Risk Assessment

- **Breaking-change risk:** Low (older versions' data either validates or is dropped once, with a cleaning write).
- **Regression risk:** Low — genuine newest-first 50-entry histories pass unchanged.
- **Security impact:** reduces the malformed-data/no-cap DoS surface of a hostile sibling writer.
- **Performance impact:** load-time O(n) once at boot; capped afterwards.

### 4. Validation Strategy

- Unit (fake `localStorage`): 60-entry cap; missing id/timestamp; NaN result; >512 tokens; non-array JSON; quirks of legacy survivors.
- Manual: corrupt the stored string, reload app, verify empty state + next add succeeds.

---

## R10 — AUD-010: Dedupe repeated `=`; render history lazily; batch with DocumentFragment

### 1. Proposed Solution

- In `app.js`, keep a `lastHistorySignature` (`rawExpression|resultString`) reset by every non-equals mutation (`controller.onChange`); on `onEvaluate`, `history.add()` only when the signature differs.
- Render history in `onEvaluate` **only if** the panel is currently open (the old pattern of always-rendering was meant to keep it fresh — the drawer already re-renders on every `hamburger` click, line 230, so lazy render is safe).
- In `renderHistory()`, build a `DocumentFragment` and `listEl.replaceChildren(fragment)`.

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. Signature dedupe + lazy render + fragment (recommended)** | All three costs addressed; simple, observable via unit tests of the state machine + a lightweight render stub. |
| B. Return a `repeat` flag from `evaluate()` | Pushes UI policy into the state machine; couples modules; skips the "different expression, same result" case (signature handles). |
| C. `requestIdleCallback`-deferred storage write | Adds complexity + potential data loss on immediate close; scan separately only if history growth becomes a problem. |

### 3. Risk Assessment

- **Breaking-change risk:** Low (behavior: repeated `=` no longer piles duplicates — arguably a feature fix).
- **Regression risk:** Low-medium: ensure the "closed-panel-then-open" path always renders fresh (`hamburger` click already forces this — keep that), and that `lastSaveWasTrimmed`/`lastSaveFailed` toasts survive the render-if-open change.
- **Security impact:** none.
- **Performance impact:** positive (no main-thread list rebuild of up to 50 items per `=`; storage write skipped on repeats).

### 4. Validation Strategy

- Unit: state-level `evaluate()` idempotency on `2+2 → =×3`; app-level integration with stubbed `renderHistory` asserting call count.
- Perf probe: `performance.now()` around 50 rapid `=` presses before/after.

---

## R11 — AUD-011: Fail-soft service worker install + explicit offline fallback

### 1. Proposed Solution

- Split `PRECACHE_URLS` into `CORE_URLS` (`./`, `./index.html`, `./css/style.css`, all 9 `js/*.js` files) and `OPTIONAL_URLS` (manifest + icons). Install caches core with `addAll()` (fail hard only when the shell is unavailable) and icons with `Promise.allSettled(cache.add(url))`.
- Offline `.catch()`fallback: return `caches.match('./index.html', {cacheName: CACHE_NAME})` for navigations; `new Response('Offline', {status: 504, headers: {'Content-Type': 'text/plain'}})` otherwise.
- Scope matching: use `cache.match(event.request)` after `caches.open(CACHE_NAME)` for the precache hit.
- Add a Node test (`tests/pwa.test.js`) parsing `PRECACHE_URLS`/`CORE_URLS` from the source and asserting file existence, plus a manifest-icons-vs-disk test.

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. Core/optional split + explicit 504 (recommended)** | Keeps offline reliability while tolerating asset-level release mistakes; minimal conceptual change. |
| B. Network-first for navigations, cache-first assets | Fresher HTML; slightly slower first offline-ready UX; bigger strategy rewrite than necessary now. |
| C. Stale-while-revalidate for all non-precached requests | Most robust freshness; more code paths to test. |

### 3. Risk Assessment

- **Breaking-change risk:** Low-medium — SW strategy changes need careful iOS install/offline revalidation.
- **Regression risk:** Low — activate/activate cleanup unchanged; new code paths small.
- **Security impact:** none (scope stays origin/relative).
- **Performance impact:** neutral (allSettled parallel).

### 4. Validation Strategy

- Node tests for the URL manifest integrity (no browser needed).
- Manual: trace in DevTools Application panel; airplane-mode navigations; simulate a missing icon by renaming it locally → install must still succeed.

---

## R12 — AUD-012: Consentful update flow on the version badge

### 1. Proposed Solution

- Badge click → `getRegistration()` → if none: reload. Otherwise `await update()`.
- If no `waiting`/`installing`: show toast "Already up to date" (reuse `showToast`), skip reload, no expression loss.
- If an update exists: reuse `showToast('Update ready — reloading')` and hook `worker.addEventListener('statechange', …) → 'activated' → reload`, **or** simply call `controller`-visible reload guard: persist current expression to `sessionStorage` before the trigger; restore in `app.js` `main()` boot.
- Restore "v7.11" text if the check finishes without reload (currently `'Checking...'` is never restored when not reloading).

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. Update-detected-then-reload with toast (recommended)** | User keeps their work; update actually applied before reload. |
| B. Immediate reload but persist session state | Simpler; still a destructive-feeling action; needs a boot-time restore hook. |
| C. Do nothing here; give the PWA a natural updates-on-launch | Leaves the checked behavior users already learned. |

### 3. Risk Assessment

- **Breaking-change risk:** Low; update flow must target only the Calculator SW scope (existing guard retained).
- **Regression risk:** Low-medium; badge flows, toast timing, scope check covered by manual test matrix.
- **Security impact:** none.
- **Performance impact:** negligible.

### 4. Validation Strategy

- Manual: bad-network update check (no reload), stale-badge reload path, badge tap with an expression in progress, scope-isolation regression (sibling app's registration must not be touched).

---

## R13 — AUD-013: CI test gate + staged artifact

### 1. Proposed Solution

As the audit proposes: add a `test` job (`node --test tests/*.test.js`) with `deploy.needs: test`; stage only `index.html`, `manifest.json`, `service-worker.js`, `css/`, `js/`, `icons/` into `./_site` and upload that dir. Consider pinning actions to commit SHAs.

### 2. Alternative Solution

* Keep single job, insert a `run: node --test` step before upload (weaker; a broken artifact still ships all repo files).

### 3. Risk Assessment

- **Breaking-change risk:** Low; the staging list must be kept in sync when files are added (add a CI step that warns if an expected file is missing, same test as R11).
- **Regression risk:** Low; only deployment packaging, no runtime code.
- **Security impact:** positive (stops publishing tests/reports/internal docs).
- **Performance impact:** CI time + a few seconds.

### 4. Validation Strategy

- CI run logs; post-deploy URL probes (e.g. `/token_test.txt`-style spot checks: `reports/...` must 404; `/js/app.js` must 200).
- Verify version badge/cache-version agreement check either in CI script or Node tests.

---

## R14 — AUD-014: Unify sign-toggle semantics on power expressions

### 1. Proposed Solution

In `toggleSign()`, when the trailing term is a `base^exp` power (detected through `_findTrailingOperandRange`'s base-inclusive range), rewrite `base^exp` → `(–base)^exp` (wrapping or unwrapping the inner minus), symmetric with `inputPower()`'s auto-wrap. Both `5` → `xʸ` → `2` → `+/-` and `5` → `+/-` → `xʸ` → `2` then yield `-25` — **wait**, both become `(-5)^2 = 25`? Decide explicitly: recommended target is that `+/-` means "negate the base of the trailing power", so both paths yield `25` for `-5²`. The other coherent option is "toggle sign of the whole term" (yielding `-25`), which requires wrapping `-(5^2)`. Pick one, document it in README's ambiguity log, add tests for `5^2 +/-`, `(-5)^2`, toggling twice.

### 2. Alternative Solutions

| Option | Tradeoff |
| --- | --- |
| **A. Base-negation semantics (matches inputPower's existing intent) (recommended)** | Consistent with the button's visible effect while the user edits mid-expression. |
| B. Whole-term negation (prepend `-(…)`) | Matches "mathematically standard" `-5^2`; visually heavier; differs from inputPower's current intent. |
| C. Remove base-inclusion from `_findTrailingOperandRange` (negate exponent only) | Smallest diff, but degenerates to "sign affects the exponent", surprising. |

### 3. Risk Assessment

Low-medium: an existing documented ambiguity resolution changes; existing tests cover `toggleSign toggles numeric operand sign correctly` and remain valid for non-power cases; power-specific tests needed.

### 4. Validation Strategy

Unit: table of `(expression, +/- toggle, evaluate)` matrix; manual: check screen shows the parenthesis wrap the user expects.

---

## R15 — AUD-015 + AUD-016 + NEW-004 documentation alignment

(README edits grouped here + tests per R1/R4/R14.)

### 1. Proposed Solution

- §7/§14.6: single exponent-mode rule ("mode persists until `xʸ` is pressed again or evaluation completes" — *or* the new R4 rule "binary operators close the exponent" if R4-A is adopted).
- §7: reciprocal documented as `(1÷operand)` with unwrap (also fix the contradiction with §14.5 line 438).
- §8/§14.5: history tap restores **expression + result** in State B, result-only fallback for legacy entries.
- §2: delete `implementation_report.html` row (file does not exist — verified).
- Manifest orientation: align with NEW-004 decision.
- Add doc-example tests (R4 examples) so drift forces failing tests.
- Version-synchronization rule (AGENTS.md) applies to any release that ships these fixes.

### 4. Validation Strategy

- Docs diff review; `grep` the missing file; unit tests assert the documented behavior examples.

---

## R16 — AUD-017: Dead code cleanup

Remove `u-` from `RIGHT_ASSOCIATIVE` (or leave a comment), delete `showCopyToast`, stop exporting `SELECTORS`, delete `pasteNumber` alias (and its test usages), stop computing/passing the unused `before`/`result` args to `onEvaluate` (or start using them — `before` could power the R10 signature), and merge `isEnclosedInParens`/`isEnclosedInParensString` into one shared helper in `formatUtils.js` imported by `calculatorState.js`. Tests must be updated in the same commit (green suite, no skipped tests).

**Risk:** Low. **Validation:** full suite + grep-based test that no `_`-private is imported cross-module.

---

## R17 — AUD-018 + NEW-002/NEW-003 derived tests: Close the test gaps

Highest-value additions, ordered:

1. **Numeric fidelity** (R1 tests) — prevents shipping wrong-answer builds.
2. **State invariant/property test**: random action sequences; assert (a) `isExponent` tokens only in exponent context, (b) `evaluate()` result equals parsing a freshly built `rawExpression`, (c) `rawExpression` is parseable whenever `isError === false` after `=`.
3. **Paste combination matrix** (R2).
4. **Keyboard dispatch**: Enter on focused button (R6), Space, modifiers, disabled-state guards.
5. **`loadHistory` validation/cap/corrupt-JSON** (R9, fake `localStorage`).
6. **Static PWA checks**: precache-vs-filesystem, manifest-icons-vs-filesystem, four-way version sync (`service-worker.js`/`index.html`/`README.md`/`AGENTS.md`).
7. **DOM-layer tests**: extract a pure view-model builder from `renderDisplay` (audit Architecture Recommendation #5) and unit-test State A/B/error rendering decisions in Node.
8. **Remove the five duplicated test pairs** in `tests/state.test.js`.

**Risk:** Low (tests only + module extraction). **Validation:** suite count grows (~+20 tests), all green; duplicates removed lowers count by 5 net.

---

## R18 — AUD-019/AUD-020/AUD-022/AUD-023: Preserve invariants; minimal hardening

- Add a CI grep failing on `innerHTML|outerHTML|insertAdjacentHTML|document.write|eval(|new Function(` within `js/` (protects AUD-022/023's clean bill).
- Keep the current meta CSP; when hosting changes (GitHub Pages limitations), move to headers with `frame-ancestors 'none'`.
- Keep README's localStorage disclosure (AUD-020); consider a visible in-app "History is stored on this device" note; optional "session-only history" setting (out of scope unless requested).
- Fold R9's validator to also cap stored-size abuse (DoS vector from sibling apps).

**Risk:** Low. **Validation:** CI job output; README diff.

---

## R19 — NEW-002: evaluate() token rollback

Addressed in R4's family but listed separately: evaluate on a copy; commit auto-close only on success. **Validation:** Division-by-zero probe (`(5÷0` → `=` → error; token stream unchanged; backspace removes user's own char).

---

## R20 — NEW-003: Render path batching

See R5 detail under "Proposed Solution" (batch reads/writes; throttle resize). **Validation:** Chrome DevTools Performance — zero forced-sync-layout rows per keypress; before/after timings of ~50 keystrokes.

---

## R21 — R5 duplicates I added above (NEW-004, NEW-005, NEW-006) are summarized as follows

- **NEW-004 (manifest orientation):** set `"orientation": "any"` (or drop landscape CSS); document choice; update AGENTS release notes. Low risk.
- **NEW-005 (overlay aria-hidden sync):** fold into R7's `toggleHistoryPanel()` change. Low risk.
- **NEW-006 (multi-tab storage listener):** add a `storage` listener in `app.js` that calls a new `HistoryManager.reload()` (re-`loadHistory()` with the R9 validator), merging by `id`. Low risk; cheap.

---

# File Impact Analysis

Grouped by primary issue; multiple issues touching the same file are listed together.

| # | File Path | Reason For Modification | Issues Served | Planned Changes (high level) | Estimated Risk |
| --- | --- | --- | --- | --- | --- |
| F1 | `js/expressionParser.js` | Numeric fidelity policy; paste-syntax validation split | AUD-001, AUD-021 | `formatNumber` → 15 significant digits + `toExponential(14)`; add exported `validateSyntax()` (grammar-only) for paste; optionally hoist precision policy constants | Medium |
| F2 | `js/calculatorState.js` | Exponent-mode recovery/exit, implicit multiplication, paste combine/sign, evaluate rollback, public legacy-load API | AUD-002, AUD-003, AUD-004, AUD-014, AUD-016, AUD-021, NEW-001, NEW-002 | `_recomputeExponentMode()` helper; `_ensureImplicitMultiplicationBeforeValue()` helper; rewrite `pasteExpression` combination + reason codes; Unicode-dash normalization + ambiguity split; `inputOperator` closes exponent mode (decision-gated); `toggleSign` power-base semantics; `evaluate()` copy-then-commit; new `loadResultOnly()`; stronger `loadFromHistory` validation | Medium |
| F3 | `js/inputController.js` | Keyboard focus steals; unused args | AUD-006, AUD-017 | Early return for Enter/Space when target is a button; drop unused `before`/`result` args (or adopt for R10 signature) | Low |
| F4 | `js/app.js` | Touch veto, history render cadence + dedupe, history select encapsulation, clipboard a11y, storage-event listener, session restore | AUD-005, AUD-008, AUD-010, AUD-016, NEW-002(no), NEW-006, R12 session persist | Narrow/remove `touchmove`; `onEvaluate` signature dedupe + render-if-open; `handleHistorySelect` → `loadResultOnly`; add keydown handlers/role wiring for display lines; add `window.addEventListener('storage', …)`; (optional) sessionStorage save on badge-triggered reload | Medium |
| F5 | `js/uiRenderer.js` | History drawer a11y, clipboard-menu focus, render batching, dead exports, fragment batching | AUD-007, AUD-008, AUD-010, AUD-017, NEW-003, NEW-005 | `toggleHistoryPanel` inert + focus restore + overlay aria sync; `showClipboardMenu` focus-in/out; `renderHistory` DocumentFragment; `renderDisplay` read/write batching; delete `showCopyToast`; stop exporting `SELECTORS` | Medium |
| F6 | `css/style.css` | Drawer hiding fallback, a11y of open overlay, (touch-action already present) | AUD-007, NEW-005 | `.history-panel` visibility/transition-delay fallback; (optional) overlay focus-target styling if overlay becomes a real close affordance | Low |
| F7 | `service-worker.js` | Resilient precache + explicit offline response + scoped matching | AUD-011, R11 | Core/optional split; `Promise.allSettled`; 504 Response fallback; `cache.match` with `CACHE_NAME` | Medium |
| F8 | `js/pwaBootstrap.js` | Consentful update + no-reload path | AUD-012, R12 | Reload only when waiting/installing; wait for activated; toast for up-to-date; keep scope guard | Low |
| F9 | `js/storageManager.js` | Load-time validation/cap + cleaned-list persistence | AUD-009 | Full entry/token validator; `slice(0,50)`; one-pass cleaning write | Low |
| F10 | `js/historyManager.js` | Reload support for multi-tab; dedupe support flags | NEW-006, R10 | New `reload()` method (validated re-read); unchanged `add()` semantics | Low |
| F11 | `manifest.json` | Orientation decision | NEW-004 | `"orientation": "any"` (recommended) or remove landscape CSS in F6 (alternative) | Low |
| F12 | `index.html` | Display-line roles/tabindex; (optional CSP frame hardening stays out of scope for meta) | AUD-008 | `role="button" tabindex="0" aria-haspopup="menu"` + aria-labels on both display lines | Low |
| F13 | `.github/workflows/deploy.yml` | Test gate, staged artifact, integrity checks | AUD-013, R11/R17 static checks | Add `test` job; `needs: test`; `_site/` staging; optional precache/version integrity step | Low |
| F14 | `tests/parser.test.js` | AUD-001 regression tests; syntax/validate tests | AUD-001, AUD-021 | New precision expectations + fidelity matrix; `validateSyntax` cases | Low |
| F15 | `tests/state.test.js` | Exponent recovery/exit, paste combine, sign semantics, duplicate removal, invariants | AUD-002/003/004/014, NEW-001/002 | `_recomputeExponentMode` test; paste matrix; sign-on-power matrix; exponent-operator absorption tests; remove 5 duplicated test pairs | Low |
| F16 | `tests/inputController.test.js` | Enter/Space focus behavior | AUD-006 | Focused-button activation regression tests | Low |
| F17 | `tests/storage.test.js` | Load validation/cap | AUD-009 | Fake-localStorage validation matrix | Low |
| F18 | `tests/pwa.test.js` (new) | Static integrity | AUD-011, AUD-013, R17 | Precache-vs-disk, manifest icons, version-sync grep test | Low |
| F19 | `README.md` | Doc drift fixes + update-flow description + ambiguity log | AUD-015, R4/R14/R12 | §7/§8/§14.5/§14.6 alignment; remove missing-file row; version badge + release notes | Low |
| F20 | `AGENTS.md` | Version sync rule upkeep | (release hygiene after any fix batch) | Current-release note + affected guidance | Low |

**Deliberately untouched:** `js/formatUtils.js` (only if the R16 helper merge is adopted — then `isEnclosedInParensString` gains an export/import handshake with `calculatorState.js`); `generate_icons.py`, `requirements-dev.txt`, icons (no changes); `reports/*` (output only).

---

# Recommended Implementation Order

Priorities reflect user impact × blast radius; each batch ends with the full test suite green and a version bump per AGENTS.md sync rules if cached files changed.

### Priority 1 — Critical (wrong answers / trust)

1. **R1 (AUD-001)** — numeric fidelity fix + regression tests. Independent, bounded, highest value.
2. **R3 (AUD-003)** — exponent recovery display divergence (screen says one thing, evaluator computes another).

### Priority 2 — High (silent data/correctness surprises)

3. **R4 (AUD-004 + NEW-001)** — implicit-multiplication centralization + exponent-mode exit on operators (behavior spec decision required — see Risks).
4. **R2 (AUD-002)** — paste combination semantics (spec decision: insert `×`).
5. **R9 (AUD-009 + AUD-016)** — history load hardening + `loadResultOnly` encapsulation.
6. **R19 (NEW-002)** — evaluate() token rollback (tiny; bundle with R4 since both touch `evaluate()`/state).

### Priority 3 — Medium (accessibility & reliability)

7. **R5 (AUD-005)** — touchmove veto removal (bundle the promised iPhone Safari focus-ring revalidation).
8. **R6 (AUD-006)** — Enter/Space native activation.
9. **R7 (AUD-007 + NEW-005)** — drawer `inert`, focus restore, overlay aria sync.
10. **R8 (AUD-008)** — keyboard access for display lines + clipboard focus management.
11. **R11 (AUD-011)** — service worker fail-soft install + offline fallback.
12. **R12 (AUD-012)** — consentful update flow.

### Priority 4 — Low (polish, hygiene, hardening)

13. **R10 (AUD-010)** — dedupe `=` + lazy history render + fragment batching.
14. **R14 (AUD-014)** — sign-on-power semantics decision.
15. **R13 (AUD-013)** — CI test gate + staged artifact.
16. **R15/R16/R17/R18/R20/R21** — README alignment, dead code, test-gap closure, security invariant greps, render batching, manifest orientation, multi-tab storage listener.

### Suggested commit batching (to keep each release shippable)

- Batch A (correctness): R1, R3, R19 + tests.
- Batch B (input semantics): R4, R2, R14 + README + tests.
- Batch C (a11y): R5, R6, R7, R8 + style.css + tests.
- Batch D (PWA/CI): R11, R12, R13 + tests/pwa.test.js.
- Batch E (hygiene): R10, R9, R15, R16, R17, R18, R20, R21.

---

# Risks and Assumptions

**Assumptions**

1. The audit's claim of running against HEAD `808ac42` matches the working tree validated here; the file set and line numbers were confirmed against the current checkout.
2. All browser-dependent checks (pinch-zoom interception, tab order, native button activation, PWA install/update flows) were validated from code + standard DOM/spec behavior, exactly as the audit disclosed; they still require real-device validation, especially iOS Safari (the AGENTS.md release checklist already flags this for v7.11's focus-ring work — the R5 change must ride the same manual pass).
3. Behavior-spec decisions are required from the maintainer before Batch B:
   - Whether binary operators close exponent mode (R4) — this intentionally changes the v7.9+ documented behavior (README §14.6 vs §7 contradiction).
   - Whether `+/-` on a power expression means negate-base (R14 target A) or negate-term.
   - Whether paste inserts `×` or replaces when values are adjacent (R2 target A vs B).
   - Whether the manifest orientation changes to `any` (NEW-004).
4. The Node test suite remains the only automated gate; until R17 lands, regressive UI changes are manual-test-only.
5. Deploy artifact staging (R13) assumes GitHub Pages continues as the host and that `reports/` (this document and audit.md) should not be committed — never mind deployed — unless intentionally public.
6. `localStorage` on the shared GitHub Pages origin remains readable by sibling apps regardless of code changes (AUD-020); the mitigation set is disclosure + validation + optional session-only mode, not elimination.

**Uncertainties / human-review items**

- `toPrecision(15)` claim (from the audit) was not re-executed here beyond the noise-case checks; run its verification probe before merging R1 (it should hold: `parseFloat` normalizes the 15-digit representation).
- `panel.inert` support matrix (Safari 15.5+, Chrome 102+, Firefox 112+) should be confirmed against current device targets; the CSS visibility fallback covers any gap.
- The current precache list is complete (verified 20/20 files exist), so AUD-011's install-failure scenario is latent today — no user harm exists *yet*; the fix is prophylactic.
- Multi-tab merge strategy (NEW-006) is deliberately minimal (reload + id-merge); if third-writer conflicts matter, a real merge policy needs product review.
- Long-term refactor opportunities flagged by the audit's Architecture Recommendations (pure view-model extraction, shared token serializer, centralized numeric-policy module) were intentionally *not* scheduled as mandatory remediation — they are enablers for R17's test goals and can be folded in opportunistically.

---

*End of validation & remediation plan.*
