# Task 4 Report: PWA Cache Coverage and Responsive Browser Verification

## Result

- Added `./css/uiverse-editorial.css` to `APP_SHELL` immediately after `./css/layout-polish.css`.
- Bumped the Service Worker cache once from `v79` to `v80`.
- Preserved Task 3's dedicated `app.js` network-first route and offline cache fallback unchanged.
- Added a narrow reduced-motion override so editorial hover, press, and selected-item transforms do not move when motion reduction is requested.

## TDD evidence

1. RED — `node --test test/ui-contract.test.js`
   - 4 passing, 1 failing.
   - Failing contract: `service worker caches the editorial stylesheet` because `./css/uiverse-editorial.css` was absent from `APP_SHELL`.
2. GREEN — after the `APP_SHELL` entry and `v80` cache version: targeted contract suite passed 5/5.
3. RED — added the reduced-motion movement contract: 5 passing, 1 failing because the reduce media query did not override hover/press transforms.
4. GREEN — added the scoped `transform: none` override: targeted contract suite passed 6/6.

## Automated verification

- `node --test test/ui-contract.test.js`: 6 passed, 0 failed.
- `npm test`: 23 passed, 0 failed.
- `git diff --check`: exit 0; no whitespace errors.

## Browser verification

Server: `npm start`, confirmed HTTP 200 at `http://127.0.0.1:3000/`. No generation or continue action was clicked, so no real generation request was triggered.

| Viewport | `scrollWidth` / `clientWidth` | Module columns | Reachable launchers | Card height |
| --- | --- | --- | --- | --- |
| 375 | 360 / 360 | 1 | 3 | 88px |
| 428 | 413 / 413 | 1 | 3 | 88px |
| 768 | 753 / 753 | 3 | 3 | 116px |
| 1280 | 1265 / 1265 | 3 | 3 | 116px |
| 1536 | 1521 / 1521 | 3 | 3 | 116px |

- At 1280px, opened and closed story, advanced, and special-element modals.
- Changed a story select (377 choices) and an advanced select (30 choices); each corresponding summary updated. The original empty values were restored afterward.
- Selected `金手指/外掛`, confirmed one selected item and a summary chip, then deselected it and confirmed the special summary block returned to hidden.
- Primary generate and continue disabled states matched the existing toolbar controls (`generate: true`, `continue: true`).
- At 375px and 428px, the special picker used `overflow-y: auto` with 433px client height and content taller than the container (18685px / 9546px respectively); the modal remained within the 900px viewport (863px). Close and done controls were both 44px high. No horizontal overflow occurred while open.
- Light and dark controls both worked after opening the settings panel. Editorial ink/paper contrast was 15.62:1 in light and 15.06:1 in dark.
- Final browser console error log was empty. The final browser reload had no horizontal overflow at 1280px and loaded the new reduced-motion rule from `uiverse-editorial.css`.

## Reduced-motion note

The available in-app browser viewport capability supports the required widths but does not expose media-feature emulation. Its `matchMedia('(prefers-reduced-motion: reduce)').matches` remained `false`, so an active reduced-motion rendering could not be asserted in this environment. The loaded browser stylesheet contained the new reduce rule, and the 6/6 UI contract suite asserts the required hover/press transform override.

## Files changed

- `public/sw.js`
- `test/ui-contract.test.js`
- `public/css/uiverse-editorial.css`

## Commits

- `bf13616 fix: cache and verify editorial console UI`

## Self-review

- Diff is limited to the Task 4 Service Worker, UI contract, and browser-found motion CSS scope.
- `public/js/app.js` was not changed; its pre-existing network-first route contract remains covered and passed.
- The cache entry, version bump, and cache ordering match the Task 4 brief.
- Browser checks used state conditions and no fixed waits. Test interactions were restored to their initial select/special-element values.

## Concerns

- Active `prefers-reduced-motion: reduce` emulation remains an environment limitation; the behavior is protected by the CSS contract and loaded-stylesheet check, but not by an active-media browser assertion.

---

## Review-remediation verification (2026-07-22)

### Changes made

- Replaced the source-text-only Service Worker assertions with a parsed `APP_SHELL` contract and a `node:vm` Service Worker harness in `test/ui-contract.test.js`.
- The parsed contract asserts `v80`, `./css/uiverse-editorial.css` immediately follows `./css/layout-polish.css`, and the install handler actually passes that parsed array to `cache.addAll(APP_SHELL)`.
- The harness evaluates the real `public/sw.js` with mocked `self`, `caches`, and `fetch`, dispatches `/js/app.js`, and proves both a network-first response and cache fallback after a rejected network request.
- `public/sw.js`, `public/js/app.js`, and CSS were not changed during this remediation. Task 3's existing route is preserved by the executed behavior test.

### TDD / test evidence

1. Added the parsed-shell and executed-worker tests before changing production code. The worker already implemented the required behavior, so no production fix was warranted.
2. First targeted run: `node --test test/ui-contract.test.js` produced 5 passing / 1 failing. The failure was test infrastructure: an array evaluated in a separate VM realm cannot be `deepStrictEqual` to a local-realm array despite identical values.
3. Fixed that test-harness boundary with `Array.from(shell)`; no production source changed.
4. Green: `node --test test/ui-contract.test.js` → 6 passed, 0 failed.
5. The exact command below ran the targeted suite 10 consecutive times → 10 passed, 0 failed.

```powershell
$failure = $null
for ($run = 1; $run -le 10; $run++) {
  $result = & node --test test/ui-contract.test.js 2>&1
  if ($LASTEXITCODE -ne 0) { $failure = "run=$run`n$result"; break }
}
if ($failure) { throw $failure }
```

Result: `ui_contract_repeat_runs=10 passed=10 failed=0`.

### Final commands and results

```text
node --test test/ui-contract.test.js  →  6 passed, 0 failed
npm test                              →  23 passed, 0 failed
git diff --check                       →  exit 0
```

### Active reduced-motion browser evidence

Browser: installed Google Chrome in headless mode, driven through Chrome DevTools Protocol using the repository's existing `ws` dependency at `D:\Download\github\NovelGenerator-main\node_modules\ws`. No dependency or lockfile was added.

```powershell
Start-Process -FilePath npm.cmd -ArgumentList start -WorkingDirectory 'D:\Download\github\NovelGenerator-main\.worktrees\uiverse-editorial-console' -WindowStyle Hidden
Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList '--headless=new', '--remote-debugging-port=9223', '--user-data-dir=<unique-temp-profile>', '--no-first-run', '--no-default-browser-check', 'about:blank' -WindowStyle Hidden
@'<Node CDP harness: Page.navigate http://127.0.0.1:3000/, Emulation.setEmulatedMedia prefers-reduced-motion=reduce, CSS.forcePseudoState hover/active/focus-visible, Runtime.evaluate computed styles, Log/Runtime/Network capture>'@ | node -
```

The CDP harness waited on `document.readyState === 'complete'` plus the required controls (no fixed browser wait), set the media feature before navigation, and used Chrome's `CSS.forcePseudoState` to exercise the actual `:hover`, `:active`, and `:focus-visible` cascade. Native pointer injection did not set pseudo state in this headless target, so it was not used as evidence.

Final 1280 × 900 browser output:

```json
{
  "viewport": "1280x900",
  "reduced": true,
  "hoverTransform": "none",
  "pressTransform": "none",
  "focus": {
    "outlineStyle": "solid",
    "outlineWidth": "3px",
    "outlineColor": "rgb(116, 158, 232)"
  },
  "requestCount": 94,
  "generationRequests": [],
  "consoleErrors": [],
  "exceptions": []
}
```

No generation or continue control was clicked. The temporary primary-button enabled state was used only to evaluate the normally disabled primary action's `:active` rule. Chrome and the local server were stopped after the run. Network capture found no non-GET request and no `/api/chat`, `/api/generate`, or `/api/continue` request.

### Remediation self-review

- `APP_SHELL` is parsed and compared by value; the CSS order cannot pass through a mere substring match.
- Install behavior is dispatched and awaited, so `cache.addAll(APP_SHELL)` is verified as a runtime call with the parsed contents.
- The fetch test executes the checked-in worker source and asserts the returned response body for online and offline cases, rather than inspecting branch order.
- The active browser check verifies the media feature and computed cascade in Chrome, including a visible focus indicator, with console and network guards.

### Remaining concern

- The Service Worker behavior test uses faithful in-memory `self`/`caches`/`fetch` mocks; it directly executes `sw.js`, but it is not a full Chrome Service Worker lifecycle test against persistent CacheStorage. The install and fetch contracts are covered at unit level, while the browser run covers active CSS/media behavior.
- The browser's unique temporary Chrome profile remains at `C:\Users\User\AppData\Local\Temp\task4-cdp-7ea03b8c-3761-4a2d-919b-dca600392c6f`; the execution policy rejected its removal after its exact temp-only path was validated. It contains only the disposable headless browser profile.
