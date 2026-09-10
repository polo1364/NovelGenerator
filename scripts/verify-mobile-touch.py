"""Isolated real mobile Chrome target-size and touch checks; no paid requests."""
import functools
import http.server
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from playwright.sync_api import sync_playwright

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
spec = importlib.util.spec_from_file_location('reader', Path(__file__).with_name('verify-book-reader.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
OUT = Path(tempfile.gettempdir())/'novel-mobile-touch'
OUT.mkdir(exist_ok=True)
STORY = '# 旅行手記\n\n## 第1章 出發\n\n' + ('雨停以後，我們沿著河岸向遠方走去。\n\n'*40)

def targets(page, scope='body'):
    return page.locator(scope).evaluate('''root => [...root.querySelectorAll('button,summary,select')]
      .filter(e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && !e.disabled)
      .map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.className||e.tagName,label:e.textContent.trim().slice(0,22),w:r.width,h:r.height};})''')

def run():
    failures=[]
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(reader.QuietHandler,directory=str(reader.ROOT/'public')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    url=f'http://127.0.0.1:{server.server_port}/'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN','C:/Program Files/Google/Chrome/Application/chrome.exe'),headless=True)
            for width in [320,375,428]:
                errors=[]
                context,page=reader.boot(browser,width,STORY,url,errors)
                page.set_viewport_size({'width':width,'height':667})
                small=[item for item in targets(page) if item['w']<44 or item['h']<44]
                if small:
                    failures.append(f'{width}: undersized {json.dumps(small,ensure_ascii=False)}')
                # The dock is pinned; every original action must be reachable without a tiny tab.
                dock=page.locator('.floating-toolbar').evaluate('''e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,x:r.x,y:r.y,overflow:e.scrollWidth>e.clientWidth};}''')
                print(f'{width}: dock {dock}',flush=True)
                if dock['overflow']: failures.append(f'{width}: dock overflow')
                label=page.locator('#generationControlsBtn').evaluate('e=>{const s=getComputedStyle(e,"::after"); return {label:s.content,position:s.position,width:parseFloat(s.width)};}')
                assert label['position']=='static' and label['width']>0,label
                for opener,closer,scope in [('#apiPanelToggle','#apiPanelClose','#apiPanel'),('#settingsToggle','#settingsClose','#settingsDropdown')]:
                    page.locator(opener).tap()
                    panel_small=[item for item in targets(page,scope) if item['w']<44 or item['h']<44]
                    if panel_small: failures.append(f'{width}: {scope} undersized {json.dumps(panel_small,ensure_ascii=False)}')
                    page.locator(closer).tap()
                    assert not page.locator(scope).evaluate('e=>e.classList.contains("open")')
                page.wait_for_function('getComputedStyle(settingsDropdown).opacity==="0"')
                page.screenshot(path=str(OUT/f'console-{width}.png'))
                page.locator('#bookmarkNavToggle').tap()
                page.locator('#bookshelfModal').evaluate('e=>Promise.all(e.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))')
                shielded=page.locator('#bookshelfModal').evaluate('''modal=>[.15,.5,.85].every(x=>modal.contains(document.elementFromPoint(innerWidth*x,innerHeight-110)))''')
                if not shielded:
                    detail=page.evaluate('''()=>({body:document.body.className,hits:[.15,.5,.85].map(x=>document.elementFromPoint(innerWidth*x,innerHeight-110)?.outerHTML.slice(0,200))})''')
                    failures.append(f'{width}: bookshelf does not shield secondary dock from touch: {detail}')
                page.locator('#bookshelfCloseBtn').tap()
                for opener,scope in [('#openStoryModalBtn','#storyElementsModal'),('#openAdvancedModalBtn','#advancedSettingsModal'),('#openSpecialModalBtn','#specialElementsModal')]:
                    page.locator(opener).tap()
                    page.locator(scope).evaluate('e=>Promise.all(e.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))')
                    small=[item for item in targets(page,scope) if item['w']<44 or item['h']<44]
                    if small: failures.append(f'{width}: {scope} undersized {json.dumps(small,ensure_ascii=False)}')
                    covered=page.locator(scope).evaluate('''modal=>[...document.querySelectorAll('.floating-toolbar button,.settings-toggle,.bookmark-nav-toggle,.chapter-nav-toggle')]
                      .filter(e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden')
                      .every(e=>{const r=e.getBoundingClientRect();return modal.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})''')
                    if not covered: failures.append(f'{width}: {scope} does not shield dock from touch')
                    page.locator(scope+' .modal-close').tap()
                    assert not page.locator(scope).evaluate('e=>e.matches(".open,.show")')
                for selector in ['#generationControlsBtn','#manuscriptHorizontal','#manuscriptVertical','#manuscriptHorizontal','#manuscriptLatest']:
                    button=page.locator(selector)
                    button.scroll_into_view_if_needed()
                    hit=button.evaluate('''e=>{const r=e.getBoundingClientRect();return [.2,.5,.8].every(x=>[.2,.5,.8].every(y=>e.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y))));}''')
                    if not hit:
                        detail=button.evaluate('''e=>{const r=e.getBoundingClientRect();return {rect:[r.x,r.y,r.width,r.height],hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,200),scrollY};}''')
                        failures.append(f'{width}: obstructed {selector}: {detail}')
                    if hit: button.tap()
                page.locator('#readingScene').screenshot(path=str(OUT/f'manuscript-{width}.png'))
                assert not errors,errors
                context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print('\n'.join(failures),flush=True)
    assert not failures, f'{len(failures)} mobile touch failures; artifacts: {OUT}'
    print(f'PASS mobile touch: {OUT}',flush=True)

if __name__=='__main__':
    run()
