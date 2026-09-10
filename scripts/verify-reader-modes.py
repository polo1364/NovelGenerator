"""Real browser checks for switchable readers, using the isolated reader fixture."""
import importlib.util
import functools
import http.server
import threading
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

spec = importlib.util.spec_from_file_location('reader_qa', Path(__file__).with_name('verify-book-reader.py'))
sys.dont_write_bytecode = True
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
MODES = ['clean','book','night','illustrated','outline','scroll','spread','focus']
STORY = '# 霧港來信\n' + '\n'.join(f'## 第{i}章 遠方的燈火\n' + ('旅人推開窗，看見港口的燈火映在潮水上。📚 那封沒有署名的信，仍安靜地躺在桌角。\n' * 10) for i in range(1,5))

def run():
    server = http.server.ThreadingHTTPServer(('127.0.0.1',0), functools.partial(qa.QuietHandler,directory=str(qa.ROOT/'public')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
            for width in [375,428,768,1280,1536]:
                context,page=qa.boot(browser,width,STORY,f'http://127.0.0.1:{server.server_port}/')
                errors=[]
                page.on('pageerror',lambda error: errors.append(str(error)))
                page.evaluate('delete Array.prototype.findLastIndex')
                qa.open_reader(page)
                assert not errors, errors
                assert page.locator('#bookReaderMode').count()==1, 'Reader mode selector missing'
                page.emulate_media(reduced_motion='reduce')
                for mode in MODES:
                    page.locator('#bookReaderMode').select_option(mode)
                    page.wait_for_timeout(100)
                    assert page.locator('#bookReaderOverlay').get_attribute('data-reader-mode')==mode
                    assert not page.evaluate('bookReaderOverlay.scrollWidth>innerWidth'), (width,mode,'overflow')
                    controls=page.locator('.book-reader-bar button, #bookReaderMode, .book-stage button').evaluate_all('''els=>els.filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})''')
                    assert all(controls), (width,mode,'unreachable control')
                    if mode=='scroll':
                        assert page.locator('#bookScrollText').inner_text().replace('\n','')==STORY.replace('## ','').replace('# ','').replace('\n','')
                        page.locator('#bookScrollView').evaluate('e=>e.scrollTop=e.scrollHeight*.47')
                        page.wait_for_timeout(400)
                    else:
                        assert not qa.snapshot(page)['clipped'], (width,mode,'clipped text')
                        if width==1280:
                            page.locator('#bookResetProgress').click() if mode!='focus' else None
                            if mode=='focus':
                                page.locator('#bookReaderMode').select_option('clean')
                                page.locator('#bookResetProgress').click()
                                page.locator('#bookReaderMode').select_option('focus')
                            text,clipped=qa.collect_pages(page)
                            assert not clipped and text==STORY.replace('## ','').replace('# ','').replace('\n',''), (mode,'full text lost or clipped')
                    page.screenshot(path=str(qa.OUT/f'mode-{width}-{mode}.png'))
                    print(f'PASS {width}: {mode}',flush=True)
                page.locator('#bookReaderMode').select_option('outline')
                if width<=900: page.locator('#bookTocToggle').click()
                page.locator('#bookTocList button').filter(has_text='第3章').click()
                assert '第3章' in qa.snapshot(page)['text'], 'Chapter navigation missed target'
                page.locator('#bookReaderMode').select_option('scroll')
                page.wait_for_timeout(100)
                saved_top=page.locator('#bookScrollView').evaluate('e=>e.scrollTop')
                assert saved_top>0, 'Switch to scroll lost progress'
                page.locator('#bookReaderClose').click()
                qa.open_reader(page)
                assert abs(page.locator('#bookScrollView').evaluate('e=>e.scrollTop')-saved_top)<3, 'Reopen scroll anchor drifted'
                if width==375:
                    page.locator('#bookScrollView').evaluate('e=>e.scrollTop+=317')
                    page.wait_for_timeout(400)
                    offset_before=page.evaluate('Object.values(JSON.parse(localStorage.getItem("bookReaderProgressByStory")))[0].offset')
                    page.set_viewport_size({'width':768,'height':900})
                    page.wait_for_timeout(800)
                    offset_after=page.evaluate('Object.values(JSON.parse(localStorage.getItem("bookReaderProgressByStory")))[0].offset')
                    assert abs(offset_after-offset_before)<40, ('scroll resize anchor lost',offset_before,offset_after)
                    page.set_viewport_size({'width':375,'height':900})
                    page.wait_for_timeout(800)
                page.locator('#bookSettingsToggle').click()
                page.locator('#bookReaderFont').select_option('sans')
                page.locator('#bookReaderLeading').select_option('2.2')
                page.locator('#bookReaderWidth').select_option('wide')
                assert page.locator('#bookReaderSize').count()==1, 'Font size must be available in focus settings too'
                page.locator('#bookReaderSize').fill('24')
                page.locator('#bookReaderSize').dispatch_event('input')
                page.locator('#bookReaderTone').select_option('dark')
                page.locator('#bookSettingsClose').click()
                page.locator('#bookReaderMode').select_option('clean')
                assert not qa.snapshot(page)['clipped'], 'Settings clipped paginated text'
                page.locator('#bookReaderClose').click()
                page.reload(wait_until='networkidle')
                qa.open_reader(page)
                assert page.locator('#bookReaderMode').input_value()=='clean', 'Mode preference not persisted'
                if width==1280:
                    for mode in ['book','spread','illustrated']:
                        page.locator('#bookReaderMode').select_option(mode)
                        page.locator('#bookSettingsToggle').click()
                        page.locator('#bookReaderWidth').select_option('narrow')
                        narrow=page.locator('#bookBook').bounding_box()['width']
                        page.locator('#bookReaderWidth').select_option('wide')
                        wide=page.locator('#bookBook').bounding_box()['width']
                        assert wide>narrow+20, (mode,'page width setting does nothing',narrow,wide)
                        page.locator('#bookSettingsClose').click()
                assert not errors, errors
                context.close()
            for width,height in [(375,667),(812,375)]:
                context,page=qa.boot(browser,width,STORY,f'http://127.0.0.1:{server.server_port}/')
                page.set_viewport_size({'width':width,'height':height})
                qa.open_reader(page)
                page.emulate_media(reduced_motion='reduce')
                page.locator('#bookSettingsToggle').click()
                page.locator('#bookReaderSize').fill('28')
                page.locator('#bookReaderSize').dispatch_event('input')
                page.locator('#bookReaderLeading').select_option('2.2')
                page.locator('#bookSettingsClose').click()
                for mode in MODES:
                    page.locator('#bookReaderMode').select_option(mode)
                    if mode!='scroll': assert not qa.snapshot(page)['clipped'], (width,height,mode,'28px clipped')
                    assert not page.evaluate('bookReaderOverlay.scrollWidth>innerWidth'), (width,height,mode,'overflow')
                context.close()
            browser.close()
    finally:
        server.shutdown(); server.server_close()

if __name__=='__main__': run()
