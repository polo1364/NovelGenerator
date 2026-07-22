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
