"""Isolated real-Chrome reader regression checks; no user data or generation API calls.
Requires Python Playwright and Chrome. Run: python scripts/verify-book-reader.py
"""
import functools
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get('READER_QA_OUTPUT', str(Path(tempfile.gettempdir()) / 'novel-reader-regression')))
OUT.mkdir(parents=True, exist_ok=True)
STORY = '# 測試藏書\n' + '\n'.join(f'段落{i:03d}，' + '旅人走過古城，看見遠方的燈火。' * 4 for i in range(24))
failures, report = [], {}

def check(condition, label):
    if not condition:
        failures.append(label)
    print(('PASS ' if condition else 'FAIL ') + label, flush=True)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

def boot(browser, width, story, url):
    context = browser.new_context(viewport={'width': width, 'height': 900}, is_mobile=width < 500, has_touch=width < 500, service_workers='block')
    context.add_init_script('if(!localStorage.getItem("readerQaSeeded")){localStorage.setItem("savedStory",'+json.dumps(story)+');localStorage.setItem("readerQaSeeded","1");}')
    bookmarks = [{'id':1720000000000,'title':'測試藏書','content':STORY}, {'id':1720000000001,'title':'第二本書','content':STORY.replace('測試藏書','第二本書')}]
    context.add_init_script('localStorage.setItem("bookmarks",'+json.dumps(json.dumps(bookmarks))+');')
    page = context.new_page()
    page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(url) else route.abort())
    page.goto(url, wait_until='networkidle')
    page.locator('#onboardingSkip').click()
    page.evaluate('document.fonts.ready')
    return context, page

def open_reader(page):
    if not page.locator('#bookReaderBtn').is_visible():
        page.locator('#dockToggle').click()
    page.locator('#bookReaderBtn').click()
    page.wait_for_function('bookReaderOverlay.classList.contains("open") && bookPageRight.textContent.length > 0')
    page.wait_for_timeout(350)

def switch_book(page, title):
    page.locator('#bookmarkNavToggle').click()
    page.locator('#bookshelfSearch').fill(title)
    page.locator('.shelf-book').click()
    page.locator('#bookDetailRead').click()

def snapshot(page):
    return page.evaluate(r'''() => ({indicator:bookIndicator.textContent,
      total:Number(bookIndicator.textContent.match(/共 (\d+)/)[1]),
      focusInside:bookReaderOverlay.contains(document.activeElement),
      text:[bookPageLeft,bookPageRight].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.textContent).join(''),
      clipped:[bookPageLeft,bookPageRight].filter(e=>e.getBoundingClientRect().width>0).some(e=>e.scrollHeight>e.clientHeight+1 || e.scrollWidth>e.clientWidth+1),
      overflow:bookReaderOverlay.scrollWidth>innerWidth})''')

def collect_pages(page):
    text, clipped = '', False
    for _ in range(150):
        s = snapshot(page)
        if s['clipped'] and not clipped:
            print(page.evaluate('''() => {bookMeasure.innerHTML=bookPageRight.innerHTML; return [bookPageRight,bookMeasure].map(e=>({id:e.id,w:e.clientWidth,h:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight,overflow:getComputedStyle(e).overflow,children:[...e.children].map(c=>({tag:c.tagName,y:c.getBoundingClientRect().top-e.getBoundingClientRect().top,h:c.getBoundingClientRect().height,margin:getComputedStyle(c).margin,font:getComputedStyle(c).font}))}));}'''), flush=True)
        text += s['text']
        clipped = clipped or s['clipped']
        if page.locator('#bookNext').is_disabled():
            break
        page.locator('#bookNext').click()
        page.wait_for_function('!bookFlip.classList.contains("active")')
    return text, clipped

def run():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT / 'public')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROME_BIN', 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless=True)
            for width in ([int(os.environ['READER_QA_WIDTH'])] if os.environ.get('READER_QA_WIDTH') else [375,428,768,1280,1536]):
                context,page = boot(browser,width,STORY,url)
                open_reader(page)
                initial = snapshot(page)
                check(initial['focusInside'], f'{width}: focus enters reader')
                page.keyboard.press('Tab')
                check(snapshot(page)['focusInside'], f'{width}: Tab stays inside reader')
                for _ in range(10):
                    page.keyboard.press('Tab')
                check(snapshot(page)['focusInside'], f'{width}: Tab wraps inside reader')
                page.locator('#bookReaderClose').click()
                check(page.evaluate('document.activeElement.id') == 'bookReaderBtn', f'{width}: close restores focus')
                open_reader(page)
                check(initial['total'] == snapshot(page)['total'], f'{width}: initial/reopened pagination stable')
                page.emulate_media(reduced_motion='reduce')
                page.locator('#bookNext').click()
                check(not page.locator('#bookFlip').evaluate('(e)=>e.classList.contains("active")'), f'{width}: reduced motion skips flip')
                page.wait_for_function('!bookFlip.classList.contains("active")')
                page.locator('#bookResetProgress').click()
                text,clipped = collect_pages(page)
                check(not clipped, f'{width}: all pages fit')
                check(text == STORY.replace('# ', '').replace('\n', ''), f'{width}: complete text exactly once')
                check(not initial['overflow'], f'{width}: no horizontal overflow')
                page.locator('#bookResetProgress').click()
                page.screenshot(path=str(OUT / f'reader-{width}.png'))
                report[str(width)] = initial
                if width == 375:
                    for _ in range(3):
                        page.locator('#bookNext').click()
                    before = snapshot(page)
                    page.locator('#bookReaderClose').click()
                    switch_book(page, '第二本書')
                    rapid_before = page.evaluate('localStorage.getItem("bookReaderProgressByStory")')
                    page.evaluate('() => {bookReaderBtn.click();bookReaderClose.click();}')
                    check(page.evaluate('localStorage.getItem("bookReaderProgressByStory")') == rapid_before, 'closing before pagination does not save stale pages')
                    open_reader(page)
                    page.locator('#bookReaderClose').click()
                    switch_book(page, '測試藏書')
                    open_reader(page)
                    check(snapshot(page)['text'] == before['text'], 'switching books preserves first book position')
                    anchor_text = before['text'][:16]
                    page.locator('#bookFontInc').click()
                    check(anchor_text in snapshot(page)['text'], 'font resize retains current text anchor')
                    anchor_text = snapshot(page)['text'][:16]
                    page.set_viewport_size({'width':768,'height':900})
                    page.wait_for_timeout(300)
                    check(anchor_text in snapshot(page)['text'], 'viewport resize retains current text anchor')
                    page.emulate_media(reduced_motion='no-preference')
                    page.locator('#bookNext').click()
                    page.locator('#bookReaderClose').click()
                    open_reader(page)
                    page.locator('#bookNext').click()
                    page.wait_for_function('!bookFlip.classList.contains("active")')
                    check(not snapshot(page)['clipped'], 'closing during animation leaves reader usable')
                    page.locator('#bookReaderClose').click()
                    after_font = page.evaluate('JSON.parse(localStorage.getItem("bookReaderProgressByStory") || "null")')
                    check(bool(after_font), 'per-book progress saved in separate storage')
                    legacy = next(v for v in after_font.values() if v['title']=='測試藏書') if after_font else None
                    if legacy:
                        legacy.pop('offset', None)
                        page.evaluate('(v)=>{localStorage.setItem("bookReaderProgress",JSON.stringify(v));localStorage.removeItem("bookReaderProgressByStory");}', legacy)
                        open_reader(page)
                        check(not snapshot(page)['indicator'].startswith('第 1 '), 'legacy progress resumes')
                        page.locator('#bookReaderClose').click()
                        check(page.evaluate('Object.keys(JSON.parse(localStorage.getItem("bookReaderProgressByStory"))).length')==1, 'legacy progress migrates on save')
                    else:
                        check(False, 'legacy progress available for compatibility check')
                context.close()
            long_story = '# 超長' + '標題' * 150 + '\n' + '漫長的旅程沒有停歇📚<&>' * 180 + '最後一句應能看見'
            context,page = boot(browser,375,long_story,url)
            open_reader(page)
            page.emulate_media(reduced_motion='reduce')
            text,clipped = collect_pages(page)
            check(not clipped, 'long title and unpunctuated paragraph fit')
            check(text == long_story.replace('# ', '').replace('\n', ''), 'long title and paragraph are lossless')
            page.screenshot(path=str(OUT / 'long-paragraph-last.png'))
            context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    report['failures'] = failures
    (OUT / 'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    if failures:
        raise SystemExit(f'{len(failures)} reader regression checks failed')

if __name__ == '__main__':
    run()
