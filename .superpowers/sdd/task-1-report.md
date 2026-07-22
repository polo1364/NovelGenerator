# Task 1 Report

## Scope

Added the UI contract test required by `task-1-brief.md`. No production HTML, CSS, or JavaScript was changed.

## Files Changed

- `test/ui-contract.test.js`
  - Verifies `css/uiverse-editorial.css` is loaded after `css/styles.css` and `css/layout-polish.css`.
  - Verifies each of the 15 behavior-bearing workshop control IDs occurs exactly once.

## TDD Evidence

### RED

Command:

```text
node --test test/ui-contract.test.js
```

Output summary:

```text
FAIL editorial stylesheet loads after existing styles
PASS behavior-bearing workshop controls remain present exactly once
tests 2
pass 1
fail 1
```

The failure is the expected missing `css/uiverse-editorial.css` link. The ID contract passed.

### GREEN

Because this task explicitly stops at creating the contract test, the future stylesheet link is intentionally not implemented here. The existing-control contract was verified independently:

Command:

```text
node --test --test-name-pattern="behavior-bearing workshop controls remain present exactly once" test/ui-contract.test.js
```

Output summary:

```text
PASS behavior-bearing workshop controls remain present exactly once
tests 1
pass 1
fail 0
```

Additional check:

```text
git diff --check
```

Result: no whitespace errors.

## Commit

- Contract test commit: `9fc83b4a10c522c5a062a36b42edef28c831ebbf` (`test: lock workshop UI contracts`)
- This report is committed separately after the contract test so the report can record the implementation commit hash.

## Self-Review

- The test reads the actual `public/index.html` from the repository root.
- Stylesheet ordering is asserted by source position, matching the brief.
- IDs are checked with an exact attribute-value match and must occur once each.
- The change is limited to the requested test; no existing edits were reverted.

## Concerns

- The full `test/ui-contract.test.js` command is expected to remain red until a later task adds the editorial stylesheet link. This is intentional and required by the Task 1 brief.
- No browser verification was performed because Task 1 creates only a Node contract test and does not change the rendered UI.
