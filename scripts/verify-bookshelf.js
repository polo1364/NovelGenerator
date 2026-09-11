/* Isolated browser QA. Only fixture data enters the disposable Chrome profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { CdpClient, poll, getJson, stopProcess, setViewport } = require('./verify-editorial-console');
const { books } = require('../test/fixtures/bookshelf-books');
const { STYLES } = require('../public/js/book-design');
const baseline = process.argv.includes('--baseline');
const root = path.join(__dirname, '..');
const output = path.resolve(process.env.SHELF_QA_OUTPUT || path.join(os.tmpdir(), 'novel-bookshelf-qa'));
const fixture = Array.from({ length: 200 }, (_, i) => ({ ...books[i % 48], id: 1720000000000 + i,
  tags: i < 48 ? [...books[i].tags, 'gallery', `sample-${i}-only`] : ['performance'],
  title: i < 48 ? books[i].title : books[i % 48].title + ' · ' + (i + 1),
  ...(i>=48 && i<64 ? {title:STYLES[i-48].words[0]+'：時間的藏書',tags:['styles',`style-page-${Math.floor((i-48)/8)+1}`],kind:'novel',volumes:[],totalVolumes:1} : {}) }));
const settle = client => client.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
async function click(client, selector, touch = false) {
  const p = await client.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'nearest'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  if (touch) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...p });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...p });
  }
}
async function key(client, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ['keyDown','keyUp']) await client.send('Input.dispatchKeyEvent', { type,key,code,windowsVirtualKeyCode,modifiers, ...(key==='Enter' && type==='keyDown' ? {text:'\r'} : {}) });
}
async function search(client, value) {
  await click(client, '#bookshelfSearch');
  await key(client, 'a', 'KeyA', 65, 2);
  await key(client, 'Backspace', 'Backspace', 8);
  if (value) await client.send('Input.insertText', { text: value });
  await settle(client);
}
async function screenshot(client, name) {
  await client.send('Input.dispatchMouseEvent', { type:'mouseMoved',x:0,y:0 });
  await client.evaluate('document.activeElement.blur()');
  await poll('status message clears',()=>client.evaluate("!document.getElementById('status').classList.contains('show')"));
  await poll('animations finish', () => client.evaluate('document.getAnimations().every(a => a.playState !== "running")'));
  const shot = await client.send('Page.captureScreenshot', { format:'png' });
  fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
}
async function run() {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-shelf-profile-'));
  const port = 3212, debugPort = 9323;
  let server, chrome, client;
  try {
    server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
    await poll('server', async () => (await fetch(`http://127.0.0.1:${port}/`)).ok);
    chrome = spawn(process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
      { stdio: 'ignore', windowsHide: true });
    const target = await poll('Chrome', async () => (await getJson(`http://127.0.0.1:${debugPort}/json/list`)).find(t => t.type === 'page'));
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable', 'DOM.enable', 'CSS.enable'].map(method => client.send(method)));
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('bookmarks', location.search.includes('empty') ? '[]' : ${JSON.stringify(JSON.stringify(fixture))});` });
    await setViewport(client, 1280);
    await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await poll('bookmarks loaded', () => client.evaluate(`document.querySelectorAll('.bookmark-item-title').length >= 200`));
    await poll('welcome visible',()=>client.evaluate("document.getElementById('onboardingOverlay').classList.contains('show')"));
    await click(client,'#onboardingSkip');
    const report = { baseline, books: 200, viewport: 1280 };
    report.openMs = await client.evaluate(`(() => { const t = performance.now(); document.getElementById('bookmarkNavToggle').click(); document.getElementById('bookshelfBody').getBoundingClientRect(); return performance.now() - t; })()`);
    await settle(client);
    report.sortMs = await client.evaluate(`(() => { const t = performance.now(); const el=document.getElementById('bookshelfSort'); el.value='name'; el.dispatchEvent(new Event('change')); document.getElementById('bookshelfBody').getBoundingClientRect(); return performance.now()-t; })()`);
    report.scroll = await client.evaluate(`new Promise(resolve => { const el=document.querySelector('.bookshelf-scroll'); const times=[]; let last=performance.now(); function step(now) {times.push(now-last);last=now;el.scrollTop+=20;if(times.length<60)requestAnimationFrame(step);else{el.scrollTop=0;times.sort((a,b)=>a-b);resolve({medianMs:times[30],p95Ms:times[57]});}}requestAnimationFrame(step); })`);
    if (!baseline) {
      report.toggleMs = await client.evaluate(`(() => {const t=performance.now();document.querySelector('[data-shelf-view="spine"]').click();document.getElementById('bookshelfBody').getBoundingClientRect();return performance.now()-t;})()`);
      console.log('Performance', JSON.stringify(report));
      await click(client, '[data-shelf-view="cover"]');
      await search(client, 'gallery');
      assert.equal(await client.evaluate("document.querySelectorAll('.shelf-book').length"), 48);
      const appearances = await client.evaluate("Object.fromEntries([...document.querySelectorAll('.shelf-book')].map(b=>[b.dataset.bookId,b.querySelector('.book-object').dataset.design]))");
      for (const sort of ['oldest','newest','name','length','color','style']) {
        await client.evaluate(`(() => {const e=document.getElementById('bookshelfSort');e.value=${JSON.stringify(sort)};e.dispatchEvent(new Event('change'));})()`);
        assert.deepEqual(await client.evaluate("Object.fromEntries([...document.querySelectorAll('.shelf-book')].map(b=>[b.dataset.bookId,b.querySelector('.book-object').dataset.design]))"),appearances);
      }
      await client.evaluate("document.getElementById('bookshelfSort').value='name';document.getElementById('bookshelfSort').dispatchEvent(new Event('change'))");
      report.viewports = [];
      for (const width of [375,428,768,1280,1536]) {
        await setViewport(client, width);
        await client.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
        await client.send('Emulation.setTouchEmulationEnabled', {enabled:width<500});
        await settle(client);
        for (const mode of ['cover','spine']) {
          await click(client, `[data-shelf-view="${mode}"]`, width<500);
          await settle(client);
          const result = await client.evaluate(`(() => {
            const body=document.getElementById('bookshelfBody'), scroller=document.querySelector('.bookshelf-scroll');
            const rows=[...body.children];
            const clipped=[...body.querySelectorAll('.cover-title')].filter(e=>e.scrollHeight>e.clientHeight+2 || e.scrollWidth>e.clientWidth+2).map(e=>e.textContent);
            const aligned=rows.every(row=>[...row.querySelectorAll('.shelf-slot')].every(e=>Math.abs(e.getBoundingClientRect().bottom-row.getBoundingClientRect().top-parseFloat(getComputedStyle(row,'::after').top))<2));
            return {mode:body.dataset.view,columns:rows[0].children.length,overflow:scroller.scrollWidth>scroller.clientWidth,aligned,clipped};
          })()`);
          report.viewports.push({width,...result});
          console.log(width, mode, 'clipped titles:', result.clipped);
          assert.equal(result.overflow, false, `${width} ${mode} horizontal overflow`);
          assert.ok(result.aligned, `${width} ${mode} shelves align`);
          assert.deepEqual(result.clipped, [], `${width} ${mode} title fit`);
          if (width<500 && mode==='cover') assert.equal(result.columns,2);
          await screenshot(client, `shelf-${width}-${mode}`);
          if (width===375 && mode==='cover') {
            await click(client,'.shelf-book',true);
            assert.ok(await client.evaluate("document.getElementById('bookDetail').classList.contains('open')"));
            await click(client,'#bookDetailClose',true);
          }
        }
      }
      await setViewport(client,1536);
      await client.send('Emulation.setTouchEmulationEnabled',{enabled:false});
      await click(client,'[data-shelf-view="cover"]');
      await search(client,'fantasy');
      assert.equal(await client.evaluate("document.querySelectorAll('.shelf-book').length"),6);
      const hoverPoint = await client.evaluate("(() => {const r=document.querySelector('.shelf-book').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+100};})()");
      await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverPoint});
      await poll('book extraction motion',()=>client.evaluate("new DOMMatrix(getComputedStyle(document.querySelector('.shelf-book .book-object')).transform).m42 < -5.9"));
      await poll('foil is finite',()=>client.evaluate("!document.getAnimations().some(a=>a.animationName==='shelf-foil' && a.playState==='running')"));
      await screenshot(client,'fantasy-color');
      await client.evaluate(`(() => {const s=document.createElement('style');s.id='qa-grayscale';s.textContent='.book-object {filter:grayscale(1)} .cover-title,.cover-imprint,.shelf-caption,.shelf-book-meta {visibility:hidden}';document.head.append(s)})()`);
      await screenshot(client,'fantasy-grayscale-no-titles');
      await client.evaluate("document.getElementById('qa-grayscale').remove()");
      await setViewport(client,1280);
      const directions = new Set();
      for (const page of [1,2]) {
        await search(client,`style-page-${page}`);
        assert.equal(await client.evaluate("document.querySelectorAll('.shelf-book').length"),8);
        for(const id of await client.evaluate("[...document.querySelectorAll('.shelf-book [data-art-direction]')].map(e=>e.dataset.artDirection)")) directions.add(id);
        await screenshot(client,`styles-${page}`);
        await client.evaluate(`(() => {const s=document.createElement('style');s.id='qa-grayscale';s.textContent='.book-object {filter:grayscale(1)} .cover-title,.cover-imprint,.shelf-caption,.shelf-book-meta {visibility:hidden}';document.head.append(s)})()`);
        await screenshot(client,`styles-${page}-grayscale`);
        await client.evaluate("document.getElementById('qa-grayscale').remove()");
      }
      assert.equal(directions.size,16);
      await setViewport(client,375);
      await search(client,'styles');
      const clippedStyles = await client.evaluate("[...document.querySelectorAll('.cover-title')].filter(e=>e.scrollHeight>e.clientHeight+2 || e.scrollWidth>e.clientWidth+2).map(e=>({title:e.textContent,layout:e.className,width:e.clientWidth,height:e.clientHeight,scrollWidth:e.scrollWidth,scrollHeight:e.scrollHeight}))");
      assert.deepEqual(clippedStyles, [], '375px art direction title fit');
      await screenshot(client,'styles-mobile');
      await setViewport(client,1536);
      report.artDirections = [...directions];
      await search(client,'sample-0-only');
      await key(client,'Tab','Tab',9,8);
      assert.equal(await client.evaluate('document.activeElement.className'),'shelf-book');
      await key(client,'Tab','Tab',9);
      assert.equal(await client.evaluate('document.activeElement.id'),'bookshelfSearch');
      const design = await client.evaluate("document.querySelector('.shelf-book .book-object').dataset.design");
      await click(client,'.shelf-book');
      assert.equal(await client.evaluate("document.querySelector('#bookDetailCover .book-object').dataset.design"),design);
      assert.ok(await client.evaluate("document.getElementById('bookDetailTitle').textContent.includes('全 3 集')"));
      await screenshot(client,'series-detail');
      await key(client,'Escape','Escape',27);
      assert.equal(await client.evaluate("document.activeElement.className"),'shelf-book');
      await key(client,'Enter','Enter',13);
      assert.ok(await client.evaluate("document.getElementById('bookDetail').classList.contains('open')"));
      await click(client,'#bookDetailRead');
      assert.ok(await client.evaluate("!document.getElementById('bookshelfModal').classList.contains('open')"));
      await click(client,'#bookmarkNavToggle');
      await poll('library reopened',()=>client.evaluate("document.getElementById('bookshelfModal').classList.contains('open')"));
      await search(client,'no-results-xyz');
      assert.ok(await client.evaluate("document.getElementById('shelfEmptyTitle').textContent.includes('搜尋')"));
      await screenshot(client,'no-search-results');
      await search(client,'gallery');
      await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await click(client,'[data-shelf-view="spine"]');
      await key(client,'Tab','Tab',9);
      assert.ok(await client.evaluate("[...document.querySelectorAll('.book-object')].every(e=>getComputedStyle(e).transform==='none' && getComputedStyle(e).transitionDuration==='0s')"));
      assert.equal(await client.evaluate("localStorage.getItem('bookshelfView')"),'spine');
      await client.evaluate('window.__qaReloading=true');
      await client.send('Page.reload');
      await poll('reload ready',()=>client.evaluate("!window.__qaReloading && document.readyState==='complete' && document.querySelectorAll('.bookmark-item-title').length===200"));
      await click(client,'#bookmarkNavToggle');
      assert.equal(await client.evaluate("document.getElementById('bookshelfBody').dataset.view"),'spine');
      await search(client,'sample-1-only');
      await click(client,'.shelf-book');
      await click(client,'#bookDetailRead');
      await click(client,'#bookmarkNavToggle');
      await click(client,'#bookshelfSaveBtn');
      await search(client,'');
      assert.equal(await client.evaluate("document.querySelectorAll('.shelf-book').length"),201);
      const importedTitle = '宇宙圖書館裡那位記得所有故事卻忘了自己姓名的最後一名管理員';
      const imported = [
        {id:1820000000000,title:importedTitle,content:'測試匯入小說',tags:['imported-only']},
        {id:1820000000001,title:'<img src=x onerror=window.__unsafeExecuted=1>',content:'<img src=x onerror=window.__unsafeExecuted=1>',tags:['unsafe-only']}
      ];
      const importPath = path.join(output,'import-fixture.json');
      fs.writeFileSync(importPath,JSON.stringify(imported));
      await client.send('Page.setInterceptFileChooserDialog',{enabled:true});
      await click(client,'#bookshelfImportBtn');
      const document = await client.send('DOM.getDocument');
      const input = await client.send('DOM.querySelector',{nodeId:document.root.nodeId,selector:'#importFileInput'});
      await client.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[importPath]});
      await poll('import complete',()=>client.evaluate("document.querySelectorAll('.shelf-book').length===203"));
      await search(client,'imported-only');
      await click(client,'.shelf-book');
      assert.equal(await client.evaluate("document.getElementById('bookDetailTitle').textContent"),importedTitle);
      await setViewport(client,375);
      await settle(client);
      await screenshot(client,'long-title-detail-mobile');
      assert.ok(await client.evaluate("document.querySelector('.book-detail-card').getBoundingClientRect().right<=innerWidth"));
      await click(client,'#bookDetailEdit');
      assert.equal(await client.evaluate('document.activeElement.id'),'editBookmarkTitle');
      await key(client,'Tab','Tab',9,8);
      assert.ok(await client.evaluate("document.getElementById('editModal').contains(document.activeElement)"));
      await key(client,'Escape','Escape',27);
      assert.equal(await client.evaluate('document.activeElement.className'),'shelf-book');
      await key(client,'Enter','Enter',13);
      await click(client,'#bookDetailEdit');
      await key(client,'a','KeyA',65,2);
      await client.send('Input.insertText',{text:importedTitle+' 修訂'});
      await click(client,'#saveEditBtn');
      assert.equal(await client.evaluate('document.activeElement.className'),'shelf-book');
      await key(client,'Enter','Enter',13);
      assert.equal(await client.evaluate("document.getElementById('bookDetailTitle').textContent"),importedTitle+' 修訂');
      await key(client,'Escape','Escape',27);
      await search(client,'unsafe-only');
      assert.equal(await client.evaluate("document.querySelectorAll('.shelf-book img,.shelf-book script').length"),0);
      assert.equal(await client.evaluate("document.querySelectorAll('#bookmarkList img,#bookmarkList script').length"),0);
      assert.ok(await client.evaluate("!window.__unsafeExecuted"));
      await click(client,'.shelf-book');
      // Accept only the fixture deletion dialog; no user data is in this profile.
      const deletion = click(client,'#bookDetailDelete');
      await poll('delete confirmation',async()=> {
        try { await client.send('Page.handleJavaScriptDialog',{accept:true}); return true; } catch { return false; }
      });
      await deletion;
      await search(client,'');
      assert.equal(await client.evaluate("document.querySelectorAll('.shelf-book').length"),202);
      const downloadDir=fs.mkdtempSync(path.join(output,'export-'));
      await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
      await click(client,'#bookshelfExportBtn');
      const exportFile=await poll('export download',()=>fs.readdirSync(downloadDir).find(name=>name.endsWith('.json')));
      const exported=JSON.parse(fs.readFileSync(path.join(downloadDir,exportFile),'utf8'));
      assert.equal(exported.length,202);
      assert.deepEqual(exported.find(b=>b.id===fixture[0].id),fixture[0]);
      assert.ok(exported.every(b=>!('design' in b) && !('appearance' in b)));
      await poll('offline shell cached',()=>client.evaluate(`caches.open('novel-workshop-v103').then(async c => !!(await c.match('./js/book-design.js')) && !!(await c.match('./css/bookshelf-atelier.css')) && !!(await c.match('./css/reader-modes.css')) && !!(await c.match('./assets/sakura.webp')) && !!(await c.match('./js/manuscript-workspace.js')) && !!(await c.match('./css/manuscript-workspace.css')) && !!(await c.match('./css/mobile-touch.css')))`));
      await client.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
      await client.evaluate('window.__qaReloading=true');
      await client.send('Page.reload');
      await poll('offline bookmarks',()=>client.evaluate("!window.__qaReloading && document.readyState==='complete' && document.querySelectorAll('.bookmark-item-title').length===202"));
      await click(client,'#bookmarkNavToggle');
      assert.equal(await client.evaluate("document.querySelectorAll('.shelf-book').length"),202);
      await click(client,'[data-shelf-view="cover"]');
      assert.ok(await client.evaluate("!!document.querySelector('.cover-art svg')"));
      await client.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      await client.send('Storage.clearDataForOrigin',{origin:`http://127.0.0.1:${port}`,storageTypes:'indexeddb,local_storage'});
      await client.evaluate('window.__qaReloading=true');
      await client.send('Page.navigate',{url:`http://127.0.0.1:${port}/?empty`});
      await poll('empty app loaded',()=>client.evaluate("!window.__qaReloading && document.readyState==='complete' && document.getElementById('bookmarkEmpty').style.display!=='none'"));
      await poll('empty welcome',()=>client.evaluate("document.getElementById('onboardingOverlay').classList.contains('show')"));
      await click(client,'#onboardingSkip');
      await click(client,'#bookmarkNavToggle');
      assert.equal(await client.evaluate("document.querySelectorAll('.shelf-book').length"),0);
      assert.ok(await client.evaluate("document.getElementById('shelfEmptyTitle').textContent.includes('第一本')"));
      await screenshot(client,'empty-library-mobile');
      report.persistence = 'save, import, full title, unsafe text, delete, export unchanged schema, offline reload and empty library passed';
      report.behavior = 'search, series detail, shared appearance, keyboard, reading, touch, reduced motion, preference reload passed';
    }
    fs.writeFileSync(path.join(output, baseline ? 'baseline.json' : 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    assert.equal(client.events.exceptions.length, 0);
    assert.equal(client.events.requests.filter(r => /\/api\/(chat|generate|continue)/.test(r.url)).length, 0);
  } catch (error) {
    if (client) {
      const shot = await client.send('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(output,'failure.png'),Buffer.from(shot.data,'base64'));
      console.error(await client.evaluate(`({active:document.activeElement.outerHTML.slice(0,300),search:document.getElementById('bookshelfSearch').value,empty:document.getElementById('shelfEmptyTitle').textContent,modal:document.getElementById('bookshelfModal').className})`));
    }
    throw error;
  } finally {
    client?.close(); await stopProcess(chrome); await stopProcess(server);
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('novel-shelf-profile-')) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
