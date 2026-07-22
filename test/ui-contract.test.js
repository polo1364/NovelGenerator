const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');

function parseAppShell(source = sw) {
  const expression = source.match(/const APP_SHELL\s*=\s*(\[[\s\S]*?\n\]);/m)?.[1];
  assert.ok(expression, 'APP_SHELL must be declared as an array literal');
  const shell = vm.runInNewContext(`(${expression})`, {}, { filename: 'APP_SHELL' });
  assert.ok(Array.isArray(shell), 'APP_SHELL must evaluate to an array');
  return Array.from(shell);
}

function createServiceWorkerHarness({ fetchImpl, cachedResponse } = {}) {
  const handlers = new Map();
  const calls = { addAll: [], cacheMatch: [], fetch: [], open: [], put: [] };
  const cache = {
    async addAll(entries) {
      calls.addAll.push(Array.from(entries));
    },
    async match() {
      return cachedResponse;
    },
    async put(request, response) {
      calls.put.push({ request, response });
    }
  };
  const caches = {
    async open(name) {
      calls.open.push(name);
      return cache;
    },
    async match(request) {
      calls.cacheMatch.push(request);
      return cachedResponse;
    },
    async keys() {
      return [];
    },
    async delete() {
      return true;
    }
  };
  const self = {
    location: { origin: 'https://editorial.test' },
    clients: { async claim() {} },
    skipWaiting() {},
    addEventListener(type, handler) {
      handlers.set(type, handler);
    }
  };

  vm.runInNewContext(sw, {
    URL,
    Promise,
    caches,
    fetch(request) {
      calls.fetch.push(request);
      return fetchImpl(request);
    },
    self
  }, { filename: path.join(root, 'public', 'sw.js') });

  return {
    calls,
    dispatch(type, event) {
      const handler = handlers.get(type);
      assert.ok(handler, `service worker must register a ${type} handler`);
      handler(event);
    }
  };
}

async function dispatchFetch(harness, request) {
  let responsePromise;
  harness.dispatch('fetch', {
    request,
    respondWith(response) {
      responsePromise = Promise.resolve(response);
    }
  });
  assert.ok(responsePromise, `${request.url} must receive a response`);
  return responsePromise;
}

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
    '.editorial-modal .workspace-modal-footer .btn-primary {',
    '.editorial-modal .char-ai-btn,',
    '.editorial-modal .char-tab,',
    '.editorial-modal .combo-toggle {'
  ]) {
    assert.ok(css.includes(selector), `missing modal control selector: ${selector}`);
  }
  assert.match(css, /\.editorial-modal \.modal-close,[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/);
  assert.match(css, /\.editorial-modal \.char-ai-btn,[\s\S]*?\.editorial-modal \.char-tab,[\s\S]*?\.editorial-modal \.combo-toggle\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/);
  assert.match(css, /\.editorial-modal \*\s*\{\s*scroll-behavior:\s*auto !important;/);
});

test('service worker installs the parsed v80 application shell in stylesheet load order', async () => {
  const appShell = parseAppShell();
  const polishIndex = appShell.indexOf('./css/layout-polish.css');
  assert.ok(polishIndex >= 0, 'APP_SHELL must include layout-polish.css');
  assert.equal(appShell[polishIndex + 1], './css/uiverse-editorial.css');
  assert.match(sw, /const CACHE_VERSION\s*=\s*'v80';/);
  assert.match(sw, /cache\.addAll\(APP_SHELL\)/);

  const harness = createServiceWorkerHarness({ fetchImpl: async () => new Response('unused') });
  let installPromise;
  harness.dispatch('install', {
    waitUntil(promise) {
      installPromise = Promise.resolve(promise);
    }
  });
  assert.ok(installPromise, 'install must wait for APP_SHELL caching');
  await installPromise;

  assert.deepEqual(harness.calls.addAll, [appShell]);
});

test('service worker serves app.js network-first and falls back to its cached response offline', async () => {
  assert.match(sw, /app\.js.*Network First.*offline fallback/i,
    'the service-worker header must document the approved app.js network-first route');
  const appRequest = new Request('https://editorial.test/js/app.js');
  const onlineHarness = createServiceWorkerHarness({
    fetchImpl: async () => new Response('network app.js', { status: 200 })
  });

  const onlineResponse = await dispatchFetch(onlineHarness, appRequest);
  assert.equal(await onlineResponse.text(), 'network app.js');
  assert.equal(onlineHarness.calls.fetch.length, 1);
  assert.equal(onlineHarness.calls.fetch[0].url, appRequest.url);
  assert.equal(onlineHarness.calls.cacheMatch.length, 0);

  const cachedResponse = new Response('cached app.js', { status: 200 });
  const offlineHarness = createServiceWorkerHarness({
    cachedResponse,
    fetchImpl: async () => Promise.reject(new Error('offline'))
  });
  const offlineResponse = await dispatchFetch(offlineHarness, appRequest);
  assert.equal(await offlineResponse.text(), 'cached app.js');
  assert.equal(offlineHarness.calls.fetch.length, 1);
  assert.equal(offlineHarness.calls.cacheMatch.length, 1);
  assert.equal(offlineHarness.calls.cacheMatch[0].url, appRequest.url);
});

test('reduced motion disables editorial hover and press movement', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'uiverse-editorial.css'), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.editorial-console \.editorial-module:not\(:disabled\):hover,[\s\S]*?\.editorial-console \.primary-action-btn:not\(:disabled\):hover,[\s\S]*?\.editorial-console \.primary-action-btn:not\(:disabled\):active[\s\S]*?transform:\s*none;/);
});

test('final editorial fixes retain scoped shell, workspace, feedback, and verification contracts', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'uiverse-editorial.css'), 'utf8');
  assert.match(html, /class=["'][^"']*\beditorial-workspace\b[^"']*["']/);
  for (const tag of ['CORE', 'TUNE', 'SPICE']) {
    assert.match(html, new RegExp(`<span class=["']editorial-module-tag["'][^>]*>${tag}</span>`));
  }

  for (const selector of [
    '.desk-scene .card.editorial-console {',
    '.desk-scene .card.editorial-console .pipeline {',
    '.editorial-console .editorial-workspace {',
    '.editorial-console .editorial-module-tag {',
    '.editorial-modal .special-element-item:has(input:checked) .checkbox-custom,',
    '.editorial-modal .drama-switch input:checked + .drama-switch-text::before {',
    '.editorial-modal #elementSearch:focus-visible,',
    '.editorial-modal #dramaComboCount:focus-visible {'
  ]) {
    assert.ok(css.includes(selector), `missing final-fix selector: ${selector}`);
  }

  assert.match(css, /--ec-red:\s*#b93833;/);
  assert.match(css, /--ec-blue:\s*#2e5fae;/);
  assert.match(css, /@media \(min-width:\s*768px\)[\s\S]*?\.editorial-console \.editorial-workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*1fr\);/);
  assert.match(css, /\.desk-scene \.card\.editorial-console\s*\{[\s\S]*?background:\s*var\(--ec-paper\);[\s\S]*?border:\s*3px solid var\(--ec-ink\);[\s\S]*?border-radius:\s*4px;[\s\S]*?box-shadow:\s*10px 10px 0 var\(--ec-ink\);/);
  assert.match(css, /\.desk-scene \.card\.editorial-console \.pipeline\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?border-radius:\s*0;[\s\S]*?box-shadow:\s*none;/);
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'verify-editorial-console.js')),
    'computed-style browser verification script must be committed');
});
