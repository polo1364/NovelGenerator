# Uiverse Editorial Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current workshop presentation with the approved Uiverse-derived editorial console while preserving every existing UI behavior and JavaScript contract.

**Architecture:** Keep the vanilla HTML/CSS/JS application and all behavior-bearing IDs intact. Add one scoped visual layer loaded after existing CSS, make only class-level HTML changes, and add static contract tests that guard the stylesheet order, required controls, and Service Worker cache entry.

**Tech Stack:** HTML5, CSS custom properties, vanilla JavaScript, Node.js built-in test runner, Express, Service Worker.

## Global Constraints

- Do not add React, Vue, Tailwind, or a Uiverse runtime dependency.
- Do not change API calls, generation prompts, storage keys, data formats, or PWA behavior.
- Preserve every existing `id`, `data-*`, form name, control type, and event target in `public/index.html`.
- Scope imported Uiverse selectors under `.editorial-console`; do not introduce generic `.card`, `.container`, `.input`, or `.button` rules.
- Preserve source attribution comments for every adapted Uiverse component.
- Support light theme, dark theme, and `prefers-reduced-motion: reduce`.
- At widths below 768px use one column, a horizontally scrollable workflow, and controls at least 44px high.

---

### Task 1: Lock the Existing UI Contract

**Files:**
- Create: `test/ui-contract.test.js`
- Inspect: `public/index.html`
- Inspect: `public/js/app.js`

**Interfaces:**
- Consumes: existing `public/index.html` IDs and stylesheet links.
- Produces: Node tests that later tasks must keep green.

- [ ] **Step 1: Add a failing contract test for the new stylesheet and immutable control IDs**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

test('editorial stylesheet loads after existing styles', () => {
  const base = html.indexOf('css/styles.css');
  const polish = html.indexOf('css/layout-polish.css');
  const editorial = html.indexOf('css/uiverse-editorial.css');
  assert.ok(base >= 0 && polish > base && editorial > polish);
});

test('behavior-bearing workshop controls remain present exactly once', () => {
  const ids = [
    'stepSetup', 'pipeline', 'openStoryModalBtn', 'openAdvancedModalBtn',
    'openSpecialModalBtn', 'workspaceConfigSummary', 'notes',
    'outlineAttachPanel', 'primaryGenerateBtn', 'primaryContinueBtn',
    'resetWorkspaceBtn', 'storyElementsModal', 'advancedSettingsModal',
    'specialElementsModal', 'specialElementsContainer'
  ];
  for (const id of ids) {
    const matches = html.match(new RegExp(`id=["']${id}["']`, 'g')) || [];
    assert.equal(matches.length, 1, `${id} must occur exactly once`);
  }
});
```

- [ ] **Step 2: Run the targeted test and verify the stylesheet assertion fails**

Run: `node --test test/ui-contract.test.js`

Expected: one failure because `css/uiverse-editorial.css` is not linked yet; the ID contract passes.

- [ ] **Step 3: Commit the contract test**

```powershell
git add test/ui-contract.test.js
git commit -m "test: lock workshop UI contracts"
```

---

### Task 2: Add the Editorial Console Structure and Theme Layer

**Files:**
- Create: `public/css/uiverse-editorial.css`
- Modify: `public/index.html:36-39`
- Modify: `public/index.html:179-344`

**Interfaces:**
- Consumes: existing theme variables and all IDs protected by Task 1.
- Produces: `.editorial-console`, `.editorial-console__masthead`, `.editorial-module`, `.editorial-note`, and scoped action styles.

- [ ] **Step 1: Link the new stylesheet last and add non-behavioral scope classes**

Add after `layout-polish.css`:

```html
<link rel="stylesheet" href="css/uiverse-editorial.css" />
```

Add `editorial-console` to `#stepSetup`, `editorial-console__workflow` to `.pipeline-header`, `editorial-console__modules` to `.workspace-setup-launchers`, and `editorial-module` to each `.workspace-launcher-btn`. Add `editorial-note` to the custom-rule `.section` and `editorial-outline` to `#outlineAttachSection`. Do not alter or move any existing ID or `data-*` attribute.

- [ ] **Step 2: Add scoped tokens and editorial console shell**

Start `public/css/uiverse-editorial.css` with:

```css
/* Uiverse sources adapted under .editorial-console:
   0xnihilism/quiet-dog-6, 0xnihilism/moody-moth-91,
   Creatlydev/friendly-fish-0, adamgiebl/proud-donkey-24,
   Bodyhc/loud-badger-7. MIT licensed via uiverse-io/galaxy. */
.editorial-console {
  --ec-ink: #171816;
  --ec-paper: #f5f0df;
  --ec-red: #d94f49;
  --ec-teal: #1e7774;
  --ec-yellow: #efc84a;
  --ec-blue: #749ee8;
  position: relative;
  color: var(--ec-ink);
  background-color: var(--ec-paper);
  border: 3px solid var(--ec-ink);
  border-radius: 4px;
  box-shadow: 10px 10px 0 var(--ec-ink);
}

[data-theme="dark"] .editorial-console {
  --ec-ink: #f2eee2;
  --ec-paper: #171a1d;
  --ec-red: #ff7169;
  --ec-teal: #48b8ae;
  --ec-yellow: #f1cc58;
  --ec-blue: #89aef4;
  box-shadow: 10px 10px 0 #050606;
}
```

- [ ] **Step 3: Adapt the Uiverse card language for the three launcher modules**

```css
.editorial-console .editorial-console__modules {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.editorial-console .editorial-module {
  min-height: 116px;
  border: 2px solid var(--ec-ink);
  border-radius: 3px;
  box-shadow: 5px 5px 0 var(--ec-ink);
  transform-style: preserve-3d;
  transition: transform 180ms ease, box-shadow 180ms ease;
}

.editorial-console .editorial-module:not(:disabled):hover {
  transform: translate(-2px, -2px);
  box-shadow: 7px 7px 0 var(--ec-ink);
}

.editorial-console .editorial-module:focus-visible {
  outline: 3px solid var(--ec-blue);
  outline-offset: 4px;
}
```

- [ ] **Step 4: Style the workflow, notes, outline, summary, and action hierarchy**

Implement the approved mockup using only scoped selectors. Keep the current HTML text and button semantics. Use `var(--ec-yellow)` for the active workflow step, paper/tape treatment for `.editorial-note`, dashed border for `.editorial-outline`, and the Uiverse-derived pressed state below for `.primary-action-btn`:

```css
.editorial-console .primary-action-btn:not(:disabled) {
  border: 3px solid var(--ec-ink);
  border-radius: 3px;
  box-shadow: 5px 5px 0 var(--ec-ink);
}

.editorial-console .primary-action-btn:not(:disabled):active {
  transform: translate(4px, 4px);
  box-shadow: 1px 1px 0 var(--ec-ink);
}
```

- [ ] **Step 5: Run the contract test and full test suite**

Run: `node --test test/ui-contract.test.js`

Expected: 2 tests pass.

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 6: Commit the shell and module redesign**

```powershell
git add public/index.html public/css/uiverse-editorial.css test/ui-contract.test.js
git commit -m "feat: add Uiverse editorial console shell"
```

---

### Task 3: Restyle Modal Controls Without Changing Behavior

**Files:**
- Modify: `public/index.html:867-1056`
- Modify: `public/css/uiverse-editorial.css`
- Modify: `test/ui-contract.test.js`

**Interfaces:**
- Consumes: `#storyElementsModal`, `#advancedSettingsModal`, `#specialElementsModal`, and JavaScript-created `.special-element-item` nodes.
- Produces: `.editorial-modal`, `.editorial-control`, selected/focus/disabled states, and one-scroll-owner modal behavior.

- [ ] **Step 1: Extend the contract test to protect modal semantics**

```js
test('workspace modals retain dialog semantics', () => {
  for (const id of ['storyElementsModal', 'advancedSettingsModal', 'specialElementsModal']) {
    const tag = html.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`, 'i'))?.[0] || '';
    assert.match(tag, /role=["']dialog["']/);
    assert.match(tag, /aria-modal=["']true["']/);
  }
});
```

- [ ] **Step 2: Add only presentation classes to the three workspace modals**

Add `editorial-modal` to their `.modal-content` elements and `editorial-modal__body` to their existing modal body containers. Preserve IDs, labels, `aria-*`, close buttons, and input order.

- [ ] **Step 3: Adapt Uiverse form, checkbox, and toggle states under `.editorial-modal`**

```css
.editorial-modal input:not([type="checkbox"]):not([type="radio"]),
.editorial-modal select,
.editorial-modal textarea {
  min-height: 44px;
  border: 2px solid var(--ec-ink, var(--text));
  border-radius: 3px;
  box-shadow: 3px 3px 0 color-mix(in srgb, var(--ec-ink, var(--text)) 28%, transparent);
}

.editorial-modal input:focus-visible,
.editorial-modal select:focus-visible,
.editorial-modal textarea:focus-visible {
  outline: 3px solid var(--ec-blue, var(--accent));
  outline-offset: 2px;
}

.editorial-modal .special-element-item.selected {
  transform: translateY(-1px);
  border-color: var(--ec-teal, var(--accent));
  box-shadow: 3px 3px 0 var(--ec-teal, var(--accent));
}
```

Retain the existing fixed-height/overflow rules for `.workspace-modal--special .special-elements-grid`; do not move the list back onto the homepage.

- [ ] **Step 4: Add reduced-motion behavior**

```css
@media (prefers-reduced-motion: reduce) {
  .editorial-console *,
  .editorial-modal * {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: all tests pass, including 3 UI contract tests.

- [ ] **Step 6: Commit modal styling**

```powershell
git add public/index.html public/css/uiverse-editorial.css test/ui-contract.test.js
git commit -m "feat: restyle workshop modal controls"
```

---

### Task 4: Add PWA Cache Coverage and Perform Responsive Browser Verification

**Files:**
- Modify: `public/sw.js:8-16`
- Modify: `test/ui-contract.test.js`
- Modify if browser findings require it: `public/css/uiverse-editorial.css`

**Interfaces:**
- Consumes: `public/css/uiverse-editorial.css` from Tasks 2-3.
- Produces: offline cache coverage and verified responsive behavior.

- [ ] **Step 1: Add a failing Service Worker cache contract**

```js
test('service worker caches the editorial stylesheet', () => {
  const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
  assert.match(sw, /\.\/css\/uiverse-editorial\.css/);
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `node --test test/ui-contract.test.js`

Expected: the Service Worker cache test fails because the asset is not listed.

- [ ] **Step 3: Add the stylesheet to `APP_SHELL` and bump the cache version once**

```js
const CACHE_VERSION = 'v80';
```

Add `'./css/uiverse-editorial.css',` immediately after `'./css/layout-polish.css',`.

- [ ] **Step 4: Run automated verification**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 5: Start the app for browser verification**

Run: `npm start`

Expected: server reports its local URL without startup errors.

- [ ] **Step 6: Verify the primary workflow in the browser**

At 1280px, open and close all three workspace modals; change one story setting; select and deselect one special element; confirm the summaries update; confirm primary generate/continue/reset disabled states mirror the existing toolbar controls; confirm no console errors.

- [ ] **Step 7: Verify responsive layouts**

Check 375, 428, 768, 1280, and 1536px. At each width assert `document.documentElement.scrollWidth === document.documentElement.clientWidth`. Confirm the workflow remains reachable, module cards stack below 768px, modal controls remain at least 44px high, and the special-elements modal owns its scroll instead of lengthening the page.

- [ ] **Step 8: Verify themes and motion preference**

Switch the existing theme control between light and dark and confirm readable contrast. Emulate `prefers-reduced-motion: reduce` and confirm hover/press movement is disabled while focus indicators remain visible.

- [ ] **Step 9: Commit verified cache and responsive fixes**

```powershell
git add public/sw.js public/css/uiverse-editorial.css test/ui-contract.test.js
git commit -m "fix: cache and verify editorial console UI"
```
