const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

test('editorial stylesheet and console structure fulfil the Task 2 contract', () => {
  const editorialStylesheet = path.join(root, 'public', 'css', 'uiverse-editorial.css');
  assert.ok(fs.existsSync(editorialStylesheet), 'editorial stylesheet must exist');

  const markup = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const stylesheets = [...markup.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => ({
      rel: tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1],
      href: tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    }))
    .filter(({ rel }) => rel?.split(/\s+/).includes('stylesheet'))
    .map(({ href }) => href);
  const base = stylesheets.indexOf('css/styles.css');
  const polish = stylesheets.indexOf('css/layout-polish.css');
  const editorial = stylesheets.indexOf('css/uiverse-editorial.css');
  assert.ok(base >= 0 && polish > base && editorial > polish);

  const requiredClasses = [
    ['stepSetup', 'editorial-console'],
    ['pipeline-header', 'editorial-console__workflow'],
    ['workspace-setup-launchers', 'editorial-console__modules'],
    ['openStoryModalBtn', 'editorial-module'],
    ['openAdvancedModalBtn', 'editorial-module'],
    ['openSpecialModalBtn', 'editorial-module'],
    ['section', 'editorial-note'],
    ['outlineAttachSection', 'editorial-outline']
  ];
  for (const [identifier, className] of requiredClasses) {
    const element = identifier.includes('Btn') || identifier === 'stepSetup' || identifier === 'outlineAttachSection'
      ? new RegExp(`<(?=[^>]*\\bid=["']${identifier}["'])(?=[^>]*\\bclass=["'][^"']*\\b${className}\\b)[^>]*>`, 'i')
      : new RegExp(`<[^>]*\\bclass=["'][^"']*\\b${identifier}\\b[^"']*\\b${className}\\b[^"']*["'][^>]*>`, 'i');
    assert.match(markup, element, `${identifier} must include ${className}`);
  }

  const css = fs.readFileSync(editorialStylesheet, 'utf8');
  for (const selector of [
    '.editorial-console {',
    '[data-theme="dark"] .editorial-console {',
    '.editorial-console .editorial-console__modules {',
    '.editorial-console .editorial-module {',
    '.editorial-console .editorial-module:focus-visible {',
    '.editorial-console .step-chip.active,',
    '.editorial-console .primary-action-btn:not(:disabled):active {'
  ]) {
    assert.ok(css.includes(selector), `missing scoped selector: ${selector}`);
  }
  assert.match(css, /--ec-yellow:\s*#efc84a;/);
  assert.match(css, /\[data-theme="dark"\] \.editorial-console \.primary-generate:not\(:disabled\) \{\s*color:\s*#171816;/);
  assert.match(css, /\.editorial-console \.step-chip,\s*\.editorial-console \.btn-small \{\s*min-height:\s*44px;/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
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

test('workspace modals retain dialog semantics', () => {
  const editorialStylesheet = path.join(root, 'public', 'css', 'uiverse-editorial.css');
  const css = fs.readFileSync(editorialStylesheet, 'utf8');

  for (const id of ['storyElementsModal', 'advancedSettingsModal', 'specialElementsModal']) {
    const tag = html.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`, 'i'))?.[0] || '';
    assert.match(tag, /role=["']dialog["']/);
    assert.match(tag, /aria-modal=["']true["']/);

    const modalMarkup = html.match(new RegExp(
      `<div\\b[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?` +
      `<div\\b(?=[^>]*\\bclass=["'][^"']*\\bmodal-content\\b)(?=[^>]*\\bclass=["'][^"']*\\beditorial-modal\\b)[^>]*>[\\s\\S]*?` +
      `<div\\b(?=[^>]*\\bclass=["'][^"']*\\bmodal-body\\b)(?=[^>]*\\bclass=["'][^"']*\\beditorial-modal__body\\b)[^>]*>`,
      'i'
    ))?.[0] || '';
    assert.ok(modalMarkup, `${id} must retain editorial presentation hooks`);
  }

  for (const selector of [
    '.editorial-modal input:not([type="checkbox"]):not([type="radio"]),',
    '.editorial-modal input:focus-visible,',
    '.editorial-modal .special-element-item.selected {',
    '.editorial-modal .modal-close,',
    '.editorial-modal .btn-small,',
    '.editorial-modal .workspace-modal-footer .btn-primary {'
  ]) {
    assert.ok(css.includes(selector), `missing modal control selector: ${selector}`);
  }
  assert.match(css, /\.editorial-modal \.modal-close,[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/);
  assert.match(css, /\.editorial-modal \*\s*\{\s*scroll-behavior:\s*auto !important;/);
});

test('service worker fetches app.js network first with an offline cache fallback', () => {
  const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
  assert.match(sw, /function isBehaviorAsset\(pathname\)\s*\{[\s\S]*?pathname\.endsWith\('\/js\/app\.js'\)/);
  assert.match(sw, /function networkFirst\(request\)\s*\{[\s\S]*?\.catch\(\(\) => caches\.match\(request\)\)/);

  const behaviorRoute = sw.indexOf('if (isBehaviorAsset(url.pathname))');
  const codeRoute = sw.indexOf('if (isCodeAsset(url.pathname))');
  assert.ok(behaviorRoute >= 0, 'app.js must have a dedicated fetch route');
  assert.ok(behaviorRoute < codeRoute, 'app.js network-first route must precede the code asset route');
  assert.match(sw.slice(behaviorRoute, codeRoute), /event\.respondWith\(networkFirst\(request\)\);/);
});
