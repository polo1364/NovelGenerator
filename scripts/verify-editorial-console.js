#!/usr/bin/env node

/*
 * Rerunnable computed-style verification for the editorial console.
 * It drives a fresh headless Chrome profile through CDP and never clicks a
 * generation or continuation control, so no real API generation is invoked.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const root = path.join(__dirname, '..');
const serverPort = Number(process.env.VERIFY_PORT || 3210);
const cdpPort = Number(process.env.VERIFY_CDP_PORT || 9321);
const chromePath = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const viewports = [375, 428, 768, 1280, 1536];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function poll(label, check, timeoutMs = 15000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`${url} returned ${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, delay(5000)]);
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = { consoleErrors: [], exceptions: [], requests: [] };
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') this.events.exceptions.push(message.params.exceptionDetails.text);
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') this.events.consoleErrors.push(message.params.entry.text);
      if (message.method === 'Network.requestWillBeSent') this.events.requests.push({
        method: message.params.request.method,
        url: message.params.request.url
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  async forcePseudo(selector, pseudoClasses) {
    const document = await this.send('DOM.getDocument');
    const node = await this.send('DOM.querySelector', { nodeId: document.root.nodeId, selector });
    assert.ok(node.nodeId, `missing ${selector}`);
    await this.send('CSS.forcePseudoState', { nodeId: node.nodeId, forcedPseudoClasses: pseudoClasses });
  }

  close() {
    this.socket.close();
  }
}

function hexToRgb(hex) {
  const normalized = hex.trim().replace('#', '');
  assert.match(normalized, /^[0-9a-f]{6}$/i, `expected a six-digit hex color, received ${hex}`);
  return [0, 2, 4].map(index => Number.parseInt(normalized.slice(index, index + 2), 16) / 255);
}

function luminance(hex) {
  return hexToRgb(hex).map(channel => channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function setViewport(client, width) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
}

async function navigate(client) {
  await client.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
  await poll('editorial console page load', async () => client.evaluate(
    "document.readyState === 'complete' && !!document.querySelector('#stepSetup') && !!document.querySelector('#openSpecialModalBtn')"
  ));
}

async function collectLayout(client) {
  return client.evaluate(`(() => {
    const style = (element, pseudo) => getComputedStyle(element, pseudo);
    const shell = document.querySelector('#stepSetup');
    const workspace = document.querySelector('.editorial-workspace');
    const modules = document.querySelector('.editorial-console__modules');
    const pipeline = document.querySelector('#pipeline');
    const studioLabel = document.querySelector('.pipeline-header');
    const stepTitle = document.querySelector('.step-chip:not(.active) .step-title');
    const stepMetric = document.querySelector('.step-chip:not(.active) .step-metric');
    const launcherSub = document.querySelector('.editorial-module .wsl-sub');
    const disabledOutline = document.querySelector('#outlineAttachOpenBtn');
    const shellStyle = style(shell);
    const pipelineStyle = style(pipeline);
    return {
      shell: {
        background: shellStyle.backgroundColor,
        border: shellStyle.borderTop,
        radius: shellStyle.borderTopLeftRadius,
        shadow: shellStyle.boxShadow
      },
      pipeline: {
        background: pipelineStyle.backgroundColor,
        borderWidth: pipelineStyle.borderTopWidth,
        radius: pipelineStyle.borderTopLeftRadius,
        shadow: pipelineStyle.boxShadow
      },
      text: {
        studioLabel: style(studioLabel, '::before').color,
        stepTitle: style(stepTitle).color,
        stepMetric: style(stepMetric).color,
        launcherSub: style(launcherSub).color,
        disabledColor: style(disabledOutline).color,
        disabledOpacity: style(disabledOutline).opacity
      },
      workspaceColumns: style(workspace).gridTemplateColumns,
      moduleColumns: style(modules).gridTemplateColumns,
      overflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
      colors: {
        paper: shellStyle.getPropertyValue('--ec-paper').trim(),
        red: shellStyle.getPropertyValue('--ec-red').trim(),
        blue: shellStyle.getPropertyValue('--ec-blue').trim()
      }
    };
  })()`);
}

async function collectKeyboardFocus(client, selector) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await poll(`${selector} focus transition`, async () => client.evaluate(
    `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).borderColor === 'rgb(46, 95, 174)'`
  ));
  return client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const style = getComputedStyle(element);
    return {
      matches: element.matches(':focus-visible'),
      style: style.outlineStyle,
      width: style.outlineWidth,
      color: style.outlineColor,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow
    };
  })()`);
}

async function verifyModalAndFocus(client) {
  await client.evaluate("document.querySelector('#openSpecialModalBtn').click()");
  await poll('special-elements modal content', async () => client.evaluate(
    "document.querySelectorAll('#specialElementsContainer .special-element-item').length > 0"
  ));
  await client.evaluate("document.querySelector('#specialElementsContainer .special-element-item').click()");
  await poll('special-element checkbox feedback', async () => client.evaluate(
    "getComputedStyle(document.querySelector('#specialElementsContainer .special-element-item.selected .checkbox-custom')).backgroundColor === 'rgb(30, 119, 116)'"
  ));
  const searchFocus = await collectKeyboardFocus(client, '#elementSearch');
  await client.evaluate("document.querySelector('#dramaComboToggle').click()");
  await poll('drama count visibility', async () => client.evaluate(
    "getComputedStyle(document.querySelector('#dramaComboCount')).display !== 'none'"
  ));
  const countFocus = await collectKeyboardFocus(client, '#dramaComboCount');
  const modal = await client.evaluate(`(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    const picker = style('.special-elements-picker');
    const grid = style('#specialElementsContainer');
    const selected = style('#specialElementsContainer .special-element-item.selected .checkbox-custom');
    return {
      pickerOverflow: picker.overflowY,
      gridOverflow: grid.overflowY,
      checkbox: { background: selected.backgroundColor, transform: selected.transform }
    };
  })()`);
  return { ...modal, searchFocus, countFocus };
}

async function run() {
  assert.ok(fs.existsSync(chromePath), `Chrome not found at ${chromePath}; set CHROME_BIN to override`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-editorial-'));
  let server;
  let chrome;
  let client;
  try {
    server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(serverPort) },
      stdio: 'ignore'
    });
    await poll('local server', async () => {
      const response = await fetch(`http://127.0.0.1:${serverPort}/`);
      return response.ok;
    });

    chrome = spawn(chromePath, [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      'about:blank'
    ], { stdio: 'ignore' });
    const targets = await poll('Chrome DevTools endpoint', async () => {
      const pages = await getJson(`http://127.0.0.1:${cdpPort}/json/list`);
      return pages.find(page => page.type === 'page');
    });
    client = new CdpClient(targets.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([
      client.send('Page.enable'),
      client.send('Runtime.enable'),
      client.send('Network.enable'),
      client.send('Log.enable'),
      client.send('DOM.enable'),
      client.send('CSS.enable')
    ]);

    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const assertPipelineReset = (layout, label) => {
      assert.equal(layout.pipeline.background, 'rgba(0, 0, 0, 0)', `${label} pipeline background must be transparent`);
      assert.equal(layout.pipeline.borderWidth, '0px', `${label} pipeline border must be reset`);
      assert.equal(layout.pipeline.radius, '0px', `${label} pipeline radius must be reset`);
      assert.equal(layout.pipeline.shadow, 'none', `${label} pipeline shadow must be reset`);
    };
    const layouts = {};
    for (const width of viewports) {
      await setViewport(client, width);
      await navigate(client);
      layouts[width] = await collectLayout(client);
      assert.equal(layouts[width].overflow, true, `${width}px must not have horizontal page overflow`);
      assert.match(layouts[width].shell.background, /^rgb\(245, 240, 223\)$/);
      assert.match(layouts[width].shell.border, /^3px solid rgb\(23, 24, 22\)$/);
      assert.equal(layouts[width].shell.radius, '4px');
      assert.match(layouts[width].shell.shadow, /rgb\(23, 24, 22\) 10px 10px 0px 0px/);
      assertPipelineReset(layouts[width], `${width}px light`);
      assert.equal(layouts[width].text.studioLabel, 'rgb(23, 24, 22)', `${width}px studio label must use editorial ink`);
      assert.equal(layouts[width].text.stepTitle, 'rgb(23, 24, 22)', `${width}px workflow title must use editorial ink`);
      assert.equal(layouts[width].text.stepMetric, 'rgb(30, 119, 116)', `${width}px workflow metadata must use editorial teal`);
      assert.equal(layouts[width].text.launcherSub, 'rgb(30, 119, 116)', `${width}px launcher summary must use editorial teal`);
      assert.equal(layouts[width].text.disabledColor, 'rgb(87, 83, 78)', `${width}px disabled action must remain readable`);
      assert.ok(Number(layouts[width].text.disabledOpacity) >= 0.72, `${width}px disabled action opacity must remain at least 0.72`);
      assert.equal(layouts[width].moduleColumns.split(' ').length, width < 768 ? 1 : 3);
      assert.equal(layouts[width].workspaceColumns.split(' ').length, width < 768 ? 1 : 2);
    }

    await setViewport(client, 1280);
    await navigate(client);
    await client.evaluate("document.querySelector('#darkThemeBtn').click()");
    await poll('dark theme activation', async () => client.evaluate("document.documentElement.dataset.theme === 'dark'"));
    const darkLayout = await collectLayout(client);
    assertPipelineReset(darkLayout, '1280px dark');
    await client.evaluate("document.querySelector('#lightThemeBtn').click()");
    await poll('light theme restoration', async () => client.evaluate("document.documentElement.dataset.theme === 'light'"));

    await setViewport(client, 1280);
    await navigate(client);
    const modal = await verifyModalAndFocus(client);
    assert.equal(modal.pickerOverflow, 'auto');
    assert.equal(modal.gridOverflow, 'visible');
    assert.match(modal.checkbox.background, /^rgb\(30, 119, 116\)$/);
    assert.notEqual(modal.checkbox.transform, 'none');
    for (const focus of [modal.searchFocus, modal.countFocus]) {
      assert.equal(focus.matches, true, `focus-visible must match after keyboard focus: ${JSON.stringify(focus)}`);
      assert.equal(focus.style, 'solid', `focus outline must remain visible: ${JSON.stringify(modal)}`);
      assert.equal(focus.width, '3px');
      assert.equal(focus.borderColor, 'rgb(46, 95, 174)', `focus border must use the accessible blue: ${JSON.stringify(focus)}`);
    }

    const redContrast = contrastRatio(layouts[1280].colors.red, layouts[1280].colors.paper);
    const blueContrast = contrastRatio(layouts[1280].colors.blue, layouts[1280].colors.paper);
    assert.ok(redContrast >= 4.5, `light red contrast must meet 4.5:1, received ${redContrast.toFixed(2)}:1`);
    assert.ok(blueContrast >= 3, `focus blue contrast must meet 3:1, received ${blueContrast.toFixed(2)}:1`);

    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await setViewport(client, 1280);
    await navigate(client);
    await client.forcePseudo('#openStoryModalBtn', ['hover', 'focus-visible']);
    const reducedMotion = await client.evaluate(`(() => {
      const style = getComputedStyle(document.querySelector('#openStoryModalBtn'));
      return {
        enabled: matchMedia('(prefers-reduced-motion: reduce)').matches,
        transform: style.transform,
        focus: { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor }
      };
    })()`);
    assert.equal(reducedMotion.enabled, true);
    assert.equal(reducedMotion.transform, 'none');
    assert.deepEqual(reducedMotion.focus, { style: 'solid', width: '3px', color: 'rgb(46, 95, 174)' });

    const generationRequests = client.events.requests.filter(request => /\/api\/(chat|generate|continue)/.test(new URL(request.url).pathname));
    assert.deepEqual(generationRequests, [], 'browser verification must not make a generation request');
    assert.deepEqual(client.events.consoleErrors, [], 'browser console must not contain error-level logs');
    assert.deepEqual(client.events.exceptions, [], 'browser runtime must not throw exceptions');

    console.log(JSON.stringify({
      result: 'PASS',
      viewports: Object.fromEntries(viewports.map(width => [width, {
        overflow: layouts[width].overflow,
        workspaceColumns: layouts[width].workspaceColumns,
        moduleColumns: layouts[width].moduleColumns,
        pipeline: layouts[width].pipeline
      }])),
      darkPipeline: darkLayout.pipeline,
      contrast: { redOnPaper: Number(redContrast.toFixed(2)), blueOnPaper: Number(blueContrast.toFixed(2)) },
      modal,
      reducedMotion
    }, null, 2));
  } finally {
    client?.close();
    await stopProcess(chrome);
    await stopProcess(server);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

run().catch(error => {
  console.error(`editorial browser verification failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
