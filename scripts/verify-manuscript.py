"""Real Chrome manuscript UI checks with isolated saved stories; no paid API calls."""
import functools
import http.server
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import threading
from playwright.sync_api import sync_playwright, expect

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('reader_qa', Path(__file__).with_name('verify-book-reader.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
OUT = Path(tempfile.gettempdir()) / 'novel-manuscript-qa'
OUT.mkdir(exist_ok=True)
STORY = '# 霧港來信\n\n' + '\n\n'.join(
    f'## 第{i}章 {title}\n\n' + ('海霧沿著堤岸慢慢升起。林舟握著那封沒有署名的信，望向多年未曾點亮的燈塔。\n\n' * 12)
    for i, title in enumerate(['霧中的燈塔', '未寄出的信', '潮聲的回答'], 1))

def run():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(reader.QuietHandler, directory=str(reader.ROOT/'public')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROME_BIN','C:/Program Files/Google/Chrome/Application/chrome.exe'), headless=True)
            for width in [375,428,768,1280,1536]:
                errors = []
                context,page = reader.boot(browser,width,STORY,url,errors)
                expect(page.locator('#manuscriptChapters button')).to_have_count(3)
                expect(page.locator('#result .manuscript-chapter')).to_have_count(3)
                assert page.locator('#result').text_content() == STORY
                page.locator('#readingScene').scroll_into_view_if_needed()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'{width}: page overflow'
                page.locator('#readingScene').screenshot(path=str(OUT/f'manuscript-{width}.png'))
                page.locator('#manuscriptChapters button').nth(1).click()
                expect(page.locator('#manuscriptChapters button').nth(1)).to_have_attribute('aria-current','true')
                assert page.locator('#result').text_content() == STORY
                page.locator('#manuscriptVertical').click()
                expect(page.locator('#result')).to_have_class('output vertical-writing')
                assert page.locator('#result').evaluate('e=>e.firstChild.nodeType===Node.TEXT_NODE')
                assert page.locator('#result').text_content() == STORY
                page.locator('#manuscriptChapters button').nth(1).click()
                page.locator('#manuscriptHorizontal').click()
                expect(page.locator('#result .manuscript-chapter')).to_have_count(3)
                page.locator('#manuscriptFollow').uncheck()
                assert not page.evaluate('ManuscriptWorkspace.shouldFollow()')
                page.locator('#manuscriptLatest').click()
                expect(page.locator('#manuscriptFollow')).to_be_checked()
                page.emulate_media(reduced_motion='reduce')
                page.locator('#manuscriptRead').click()
                expect(page.locator('#bookReaderOverlay')).to_have_class('book-reader-overlay open')
                page.locator('#bookReaderClose').click()
                assert page.locator('#result').text_content() == STORY
                if width == 1280:
                    # Exercise the real streaming renderer while the network fixture is tested separately.
                    page.locator('#manuscriptFollow').uncheck()
                    page.evaluate('''() => { document.body.classList.add('is-generating');
                      verticalViewport.scrollTop=100; setResultStreaming(result.textContent+'新文字'); }''')
                    assert page.locator('#verticalViewport').evaluate('e=>e.scrollTop') == 100
                    page.evaluate('(story)=>{document.body.classList.remove("is-generating");result.textContent=story;}',STORY)
                    expect(page.locator('#result .manuscript-chapter')).to_have_count(3)
                    page.locator('#manuscriptVertical').click()
                    page.evaluate('''() => { document.body.classList.add('is-generating');
                      result.style.minWidth='0px'; setResultStreaming(result.textContent+'新文字'); }''')
                    assert page.locator('#result').evaluate('e=>parseFloat(e.style.minWidth)>0 && e.style.height===verticalViewport.clientHeight+"px"'), 'vertical no-follow still updates paper layout'
                    page.evaluate('(story)=>{document.body.classList.remove("is-generating");result.textContent=story;}',STORY)
                    page.locator('#manuscriptHorizontal').click()
                    expect(page.locator('#result .manuscript-chapter')).to_have_count(3)
                    page.locator('#manuscriptSpeak').click()
                    expect(page.locator('#speechModal')).to_be_visible()
                    page.locator('#closeSpeechModal').click()
                    page.evaluate('''() => { highlightCheck.checked=true;
                      speechPlayQueue=[{highlightStart:30,highlightEnd:70}]; highlightCurrentSegment(0); }''')
                    expect(page.locator('#currentSpeakingSegment')).to_have_count(1)
                    assert page.locator('#result').text_content() == STORY, 'highlight preserves original newlines'
                    page.evaluate('clearHighlight()')
                    expect(page.locator('#result .manuscript-chapter')).to_have_count(3)
                    page.locator('#manuscriptSave').click()
                    assert page.evaluate('loadBookmarks().some(b=>b.content===result.textContent)')
                    page.locator('.manuscript-download summary').click()
                    with page.expect_download() as download:
                        page.locator('[data-manuscript-format="txt"]').click()
                    expected_download = page.evaluate('(story)=>optimizeTxtForMobile(story)',STORY).replace('\r\n','\n')
                    assert Path(download.value.path()).read_text(encoding='utf-8-sig') == expected_download
                    page.locator('#manuscriptShelf').click()
                    expect(page.locator('#bookshelfModal')).to_have_class('bookshelf-modal open')
                    page.keyboard.press('Escape')
                    examples = [
                        ('星際量子紀事','躍遷之前','艦橋的燈逐一亮起。她望著觀測窗外陌生的星群，第一次意識到，返航座標已經消失。'),
                        ('江湖劍影','雪夜來客','雪落在青石階上。年輕劍客收起油紙傘，客棧深處卻傳來一聲他早已熟悉的嘆息。'),
                        ('花園重逢','春日的信','花店尚未開門，她已經站在窗前。多年以前留下的那封信，今天終於等到了回音。'),
                        ('無聲的第七天','空白的日曆','牆上的日曆停在昨天。他伸手揭下那一頁，背面是一行陌生又熟悉的字。')]
                    for title, chapter, paragraph in examples:
                        sample = STORY.replace('霧港來信', title).replace('霧中的燈塔',chapter).replace('海霧沿著堤岸慢慢升起。林舟握著那封沒有署名的信，望向多年未曾點亮的燈塔。',paragraph)
                        page.evaluate('(story)=>{result.textContent=story;parseAndShowChapters(story);}',sample)
                        expect(page.locator('#manuscriptTitle')).to_have_text(title)
                        assert 'lighthouse' not in page.locator('#readingScene').get_attribute('style')
                        source = page.locator('#readingScene').get_attribute('data-art-source')
                        assert source == ('abstract' if title=='無聲的第七天' else 'title')
                        page.locator('#verticalViewport').evaluate('e=>e.scrollTop=0')
                        # Fresh preview avoids unrelated download toasts / stale status in evidence.
                        preview_context, preview = reader.boot(browser,1536,sample,url,errors)
                        preview.locator('#dockToggle').click()
                        preview.locator('#readingScene').scroll_into_view_if_needed()
                        preview.wait_for_function('document.body.classList.contains("manuscript-in-view")')
                        preview.locator('#readingScene').screenshot(path=str(OUT/f'title-{title}.png'))
                        preview_context.close()
                    unsafe = '# 未知標題\n\n## 第1章 <img src=x onerror=alert(1)>\n\n安全正文。'
                    page.evaluate('(story)=>{result.textContent=story;parseAndShowChapters(story);}',unsafe)
                    expect(page.locator('#result .manuscript-chapter')).to_have_count(1)
                    assert page.locator('#result').text_content() == unsafe
                    assert page.locator('#result img, #manuscriptChapters img, #chapterNavList img').count() == 0
                    page.evaluate('(story)=>{latestStory=story;result.textContent=story;parseAndShowChapters(story);}',STORY)
                    page.on('dialog',lambda dialog: dialog.accept())
                    page.locator('#resetWorkspaceBtn').click()
                    expect(page.locator('#manuscriptChapters button')).to_have_count(0)
                    expect(page.locator('#wordCountDisplay')).not_to_be_visible()
                    expect(page.locator('#manuscriptRead')).to_be_disabled()
                assert not errors, errors
                context.close()
                print(f'PASS manuscript {width}px',flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print(f'Artifacts: {OUT}',flush=True)

if __name__ == '__main__':
    run()
