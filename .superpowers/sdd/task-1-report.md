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
- Stylesheet ordering is asserted from actual `link[rel="stylesheet"]` elements after excluding comments and script contents.
- IDs are checked with an exact attribute-value match and must occur once each.
- The change is limited to the requested test; no existing edits were reverted.

## Concerns

- The full `test/ui-contract.test.js` command is expected to remain red until a later task adds the editorial stylesheet link. This is intentional and required by the Task 1 brief.
- No browser verification was performed because Task 1 creates only a Node contract test and does not change the rendered UI.

## Review Fix Verification

Command:

```text
node --test test/ui-contract.test.js
```

Exact result:

```text
✖ editorial stylesheet loads after existing styles (4.3768ms)
✔ behavior-bearing workshop controls remain present exactly once (0.6089ms)
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 52.0193

✖ failing tests:

test at test\ui-contract.test.js:9:1
✖ editorial stylesheet loads after existing styles (4.3768ms)
  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:

    assert.ok(base >= 0 && polish > base && editorial > polish)

      at TestContext.<anonymous> (D:\Download\github\NovelGenerator-main\.worktrees\uiverse-editorial-console\test\ui-contract.test.js:23:10)
      at Test.runInAsyncScope (node:async_hooks:203:9)
      at Test.run (node:internal/test_runner/test:631:25)
      at Test.start (node:internal/test_runner/test:542:17)
      at startSubtest (node:internal/test_runner/harness:214:17) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '=='
  }
```

Command:

```text
git diff --check
```

Exact result:

```text
warning: in the working copy of 'test/ui-contract.test.js', LF will be replaced by CRLF the next time Git touches it
```

The diff check returned exit code 0. The warning is Git's line-ending normalization notice; no whitespace error was reported.
