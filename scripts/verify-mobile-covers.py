"""Cross-engine cover title rendering with isolated fixtures and no API calls."""
import functools
import http.server
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from playwright.sync_api import sync_playwright

sys.dont_write_bytecode = True
sys.stdout.reconfigure(encoding='utf-8')
spec = importlib.util.spec_from_file_location('reader', Path(__file__).with_name('verify-book-reader.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
OUT = Path(tempfile.gettempdir()) / 'novel-mobile-covers'
OUT.mkdir(exist_ok=True)

def run():
    fixtures = json.loads(subprocess.check_output(['node', '-e', 'process.stdout.write(JSON.stringify(require("./test/fixtures/bookshelf-books").books))'], cwd=reader.ROOT).decode('utf-8'))
    fixtures.extend({'id': 1721000000000+i, 'title': title, 'content': '# '+title+'\n\n測試內容'} for i, title in enumerate(['酒館底下的深淵', '星際歸途']))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(reader.QuietHandler, directory=str(reader.ROOT / 'public')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    failures = []
    try:
        with sync_playwright() as p:
            for engine in ['chromium', 'webkit']:
                options = {'executable_path': os.environ.get('CHROME_BIN', 'C:/Program Files/Google/Chrome/Application/chrome.exe')} if engine == 'chromium' else {}
                browser = getattr(p, engine).launch(headless=True, **options)
                for width in [375, 428]:
                    context = browser.new_context(viewport={'width': width, 'height': 900}, is_mobile=True, has_touch=True, service_workers='block')
                    context.add_init_script('localStorage.setItem("bookmarks",'+json.dumps(json.dumps(fixtures))+');')
                    page = context.new_page()
                    url = f'http://127.0.0.1:{server.server_port}/'
                    page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(url) else route.abort())
                    page.goto(url, wait_until='networkidle')
                    page.locator('#onboardingSkip').tap()
                    page.evaluate('document.fonts.ready')
                    page.locator('#bookmarkNavToggle').tap()
                    page.locator('[data-shelf-view="cover"]').tap()
                    page.locator('#bookshelfModal').evaluate('e=>Promise.all(e.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))')
                    page.screenshot(path=str(OUT / f'{engine}-{width}-cover.png'))
                    records = []
                    for title in page.locator('#bookshelfBody .cover-title').all():
                        title.scroll_into_view_if_needed()
                        title.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                        record = title.evaluate('''e=>{
                          const r=e.getBoundingClientRect(), cover=e.closest('.book-object').getBoundingClientRect();
                          const range=document.createRange();range.selectNodeContents(e);const text=range.getBoundingClientRect();
                          return {title:e.textContent,w:r.width,h:r.height,font:parseFloat(getComputedStyle(e).fontSize),coverW:cover.width,unit:parseFloat(getComputedStyle(e).getPropertyValue('--cover-unit'))||0,
                            textW:text.width,textH:text.height,clipped:e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2,
                            intersects:text.right>r.left&&text.left<r.right&&text.bottom>r.top&&text.top<r.bottom};
                        }''')
                        records.append(record)
                        if record['unit'] <= 0 or record['w'] <= 1 or record['h'] <= 1 or record['font'] < 5 or record['textW'] <= 0 or record['textH'] <= 0 or not record['intersects'] or record['clipped']:
                            failures.append(f'{engine} {width}: {record}')
                    assert len(records) == len(fixtures), len(records)
                    print(f'{engine} {width}: checked {len(records)} titles', flush=True)
                    context.close()
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print('\n'.join(failures), flush=True)
    assert not failures, f'{len(failures)} cover rendering failures; {OUT}'
    print(f'PASS mobile covers: {OUT}', flush=True)

if __name__ == '__main__':
    run()
