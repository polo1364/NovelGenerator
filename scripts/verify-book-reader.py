"""Isolated real-Chrome reader regression checks; no user data or generation API calls.
Requires Python Playwright and Chrome. Run: python scripts/verify-book-reader.py
"""
import functools
import http.server
import json
import os
import re
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

def boot(browser, width, story, url, errors=None):
    context = browser.new_context(viewport={'width': width, 'height': 900}, is_mobile=width < 500, has_touch=width < 500, service_workers='block')
    context.add_init_script('if(!localStorage.getItem("bookReaderPreferences"))localStorage.setItem("bookReaderPreferences",JSON.stringify({mode:"book"}));')
    context.add_init_script('if(!localStorage.getItem("readerQaSeeded")){localStorage.setItem("savedStory",'+json.dumps(story)+');localStorage.setItem("readerQaSeeded","1");}')
    bookmarks = [{'id':1720000000000,'title':'測試藏書','content':STORY}, {'id':1720000000001,'title':'第二本書','content':STORY.replace('測試藏書','第二本書')}]
    context.add_init_script('localStorage.setItem("bookmarks",'+json.dumps(json.dumps(bookmarks))+');')
    page = context.new_page()
    if errors is not None:
        page.on('pageerror', lambda error: errors.append(str(error)))
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
    opener = page.locator('#bookmarkNavToggle')
    if not opener.is_visible():
        opener = page.locator('#manuscriptShelf')
    opener.click()
    page.locator('#bookshelfSearch').fill(title)
    page.locator('.shelf-book').click()
    page.locator('#bookDetailRead').click()

def snapshot(page):
    return page.evaluate(r'''() => ({indicator:bookIndicator.textContent,
      total:Number(bookIndicator.textContent.match(/共 (\d+)/)[1]),
      focusInside:bookReaderOverlay.contains(document.activeElement),
      measuredHeight:parseFloat(bookMeasure.style.height), actualHeight:bookPageRight.clientHeight,
      text:[bookPageLeft,bookPageRight].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.textContent).join(''),
      clipped:[bookPageLeft,bookPageRight].filter(e=>e.getBoundingClientRect().width>0).some(e=>e.scrollHeight>e.clientHeight+1 || e.scrollWidth>e.clientWidth+1),
      overflow:bookReaderOverlay.scrollWidth>innerWidth})''')

def check_presentation(page, label):
    layout = page.evaluate('''() => {const book=bookBook.getBoundingClientRect(), inner=bookPageRight.getBoundingClientRect(), stage=document.querySelector('.book-stage').getBoundingClientRect();return {width:innerWidth, height:innerHeight, bookLeft:book.left, bookRight:book.right, headCount:document.querySelectorAll('.book-running-head').length, headOutsideText:![...document.querySelectorAll('.book-running-head')].some(e=>e.closest('.book-page-inner')), caseVisible:getComputedStyle(bookBook,'::before').content!=='none', safeTop:inner.top-book.top, stageTop:stage.top};}''')
    check(layout['headCount']==2 and layout['headOutsideText'], f'{label}: running heads stay outside paginated story')
    if layout['width'] > 820:
        check(layout['caseVisible'] and layout['safeTop']>=56, f'{label}: hardcover and separate running-head space')
    elif layout['height'] > 500:
        check(layout['bookLeft']<=1 and layout['bookRight']>=layout['width']-1, f'{label}: edge-to-edge mobile paper')
    controls = page.locator('#bookReaderOverlay button').evaluate_all('''els=>els.filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>{const r=e.getBoundingClientRect();return {id:e.id,w:r.width,h:r.height,visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})''')
    check(all(c['w']>=44 and c['h']>=44 and c['visible'] and c['hit'] for c in controls), f'{label}: all controls reachable with 44px targets')
    for theme in ['light','dark']:
        page.evaluate('(theme)=>setTheme(theme)',theme)
        colors = page.locator('#bookPageRight').evaluate('''e=>{const s=getComputedStyle(e.parentElement),f=getComputedStyle(document.querySelector('.book-flip-front'));return {ink:s.color,paper:s.backgroundColor,flipInk:f.color,flipPaper:f.backgroundColor};}''')
        def luminance(value):
            channels = [float(v)/255 for v in re.findall(r'[\d.]+',value)[:3]]
            linear = [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in channels]
            return sum(a*b for a,b in zip(linear,[.2126,.7152,.0722]))
        a,b = luminance(colors['ink']),luminance(colors['paper'])
        check((max(a,b)+.05)/(min(a,b)+.05)>=4.5, f'{label}: {theme} body contrast >= 4.5')
        check(colors['ink']==colors['flipInk'] and colors['paper']==colors['flipPaper'], f'{label}: {theme} flip matches paper')
        page.screenshot(path=str(OUT/f'reader-{label}-{theme}.png'))
    page.evaluate('setTheme("light")')

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
            widths = [] if os.environ.get('READER_QA_SHORT_ONLY') else ([int(os.environ['READER_QA_WIDTH'])] if os.environ.get('READER_QA_WIDTH') else [375,428,768,1280,1536])
            for width in widths:
                context,page = boot(browser,width,STORY,url)
                open_reader(page)
                initial = snapshot(page)
                check(abs(initial['measuredHeight']-initial['actualHeight'])<=1, f'{width}: initial measurement matches visible page')
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
                check_presentation(page,str(width))
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
                    open_reader(page)
                    for _ in range(14):
                        if page.locator('#bookFontInc').is_disabled(): break
                        page.locator('#bookFontInc').click()
                    check(page.locator('#bookFontValue').inner_text()=='28 px' and page.locator('#bookFontInc').is_disabled(), 'font upper limit and value visible')
                    check(not snapshot(page)['clipped'], 'large font remains within page')
                    for _ in range(14): page.locator('#bookFontDec').click()
                    check(page.locator('#bookFontValue').inner_text()=='14 px' and page.locator('#bookFontDec').is_disabled(), 'font lower limit and value visible')
                    page.locator('#bookFontInc').click()
                    check(page.locator('#bookFontValue').inner_text()=='15 px', 'font controls work after reaching limit')
                context.close()
            for width,height in [(375,667),(812,375)]:
                context,page = boot(browser,width,STORY,url)
                page.set_viewport_size({'width':width,'height':height})
                if height == 375:
                    for format_name in ['txt','html']:
                        page.locator('#downloadBtn').click()
                        with page.expect_download():
                            page.locator(f'#toolbarDownloadMenu [data-format="{format_name}"]').click(timeout=4000)
                    check(True, 'landscape TXT and HTML downloads remain reachable')
                open_reader(page)
                check_presentation(page,f'{width}x{height}')
                check(abs(snapshot(page)['measuredHeight']-snapshot(page)['actualHeight'])<=1, f'{width}x{height}: measurement matches')
                page.emulate_media(reduced_motion='reduce')
                text,clipped = collect_pages(page)
                check(not clipped and text==STORY.replace('# ','').replace('\n',''),f'{width}x{height}: complete text fits')
                if height == 375:
                    while not page.locator('#bookFontInc').is_disabled(): page.locator('#bookFontInc').click()
                    page.locator('#bookResetProgress').click()
                    text,clipped = collect_pages(page)
                    check(not clipped and text==STORY.replace('# ','').replace('\n',''), 'landscape 28px: complete text fits')
                    page.locator('#bookResetProgress').click()
                    page.screenshot(path=str(OUT/'landscape-large-font.png'))
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
