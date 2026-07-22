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
