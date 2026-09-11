"""Real touch/click checks with local API fixtures, isolated storage, and no paid calls."""
import functools
import http.server
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent.parent
OUT = Path(tempfile.gettempdir()) / 'novel-continuity-qa'
OUT.mkdir(exist_ok=True)
STORY = '# 旅行手記\n\n## 第1章 城門\n\n' + '旅人走到城門前，守門人告訴他今晚不能進城。\n' * 35 + '旅人離開城門，走到河岸。旅人站在河岸。守門人仍在城門。'

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        if self.path != '/api/chat':
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.requests.append(body)
        mode = self.server.mode
        if mode == 'hold':
            self.server.release.wait(8)
        status = 429 if mode == 'rate' else 200
        content = '{broken' if mode == 'json' else json.dumps({'recentOutcome': '旅人未能進城'})
        if mode in ('baseline', 'partial', 'repaired'):
            traveler = {'entity': '旅人', 'location': '城門', 'evidence': '旅人走到城門前'}
            records = [traveler]
            if mode != 'baseline':
                traveler.update(location='河岸', evidence='旅人站在河岸。')
                records.append({'entity': '守門人', 'location': '城門', 'evidence': '守門人仍在城門。'})
                if mode == 'repaired':
                    traveler['transitionEvidence'] = '旅人離開城門，走到河岸。'
                else:
                    records.append({'entity': '花朵', 'location': '窗邊', 'evidence': '<img src=x onerror=alert(1)>'})
            content = json.dumps({'entities': records, 'characterStates': ['不可採用的無依據摘要']})
        if mode == 'omitted':
            content = json.dumps({'entities': [{'entity': '守門人', 'location': '城門', 'evidence': '守門人仍在城門。'}]})
        data = {'error': {'message': 'private upstream detail'}} if status == 429 else {
            'choices': [{'message': {'content': content}, 'finish_reason': 'length' if mode == 'length' else 'stop'}],
            'usage': {'prompt_tokens': 1000, 'completion_tokens': 3000 if mode == 'length' else 100, 'total_tokens': 4000 if mode == 'length' else 1100}}
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

def run():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT / 'public')))
    server.requests = []
    server.mode = 'ok'
    server.release = threading.Event()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    try:
        with sync_playwright() as p:
            for engine, widths in [('chromium', [375, 428, 1280]), ('webkit', [375])]:
                options = {'executable_path': os.environ.get('CHROME_BIN', 'C:/Program Files/Google/Chrome/Application/chrome.exe')} if engine == 'chromium' else {}
                browser = getattr(p, engine).launch(headless=True, **options)
                for width in widths:
                    context = browser.new_context(viewport={'width': width, 'height': 850}, is_mobile=width < 500, has_touch=width < 500, service_workers='block')
                    context.add_init_script('localStorage.setItem("novelWorkshopOnboarded","1");if(!localStorage.getItem("savedStory"))localStorage.setItem("savedStory",'+json.dumps(STORY)+');')
                    context.add_init_script('{const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:["2026-09-12T00:00:00Z"]));}static now(){return OriginalDate.parse("2026-09-12T00:00:00Z");}};}')
                    page = context.new_page()
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(url) else route.abort())
                    dialog_state = {'accept': False, 'messages': []}
                    def dialog_handler(dialog):
                        dialog_state['messages'].append(dialog.message)
                        dialog.accept() if dialog_state['accept'] else dialog.dismiss()
                    page.on('dialog', dialog_handler)
                    page.goto(url, wait_until='networkidle')
                    page.evaluate('document.fonts.ready')
                    def activate(selector):
                        locator = page.locator(selector)
                        locator.tap() if width < 500 else locator.click()
                    activate('.manuscript-continuity summary')
                    report = page.locator('#continuityReport')
                    original = page.locator('#result').text_content()
                    before = len(server.requests)
                    activate('#continuityRetry')
                    assert len(server.requests) == before
                    assert 'API 費用' in dialog_state['messages'][-1]
                    dialog_state['accept'] = True
                    for mode, expected in [('rate', '請求過於頻繁'), ('json', 'JSON 格式'), ('length', '回應被截斷'), ('ok', '上次成功整理'), ('ok', '上次成功整理')]:
                        server.mode = mode
                        before = len(server.requests)
                        activate('#continuityRetry')
                        expect(page.locator('#continuityRetry')).to_be_enabled()
                        expect(report).to_contain_text(expected)
                        assert len(server.requests) == before + 1
                        request = server.requests[-1]
                        assert request['max_tokens'] == 3000 and request['stream'] is False
                        assert '連貫性編輯' in request['messages'][0]['content']
                        assert page.locator('#result').text_content() == original
                        assert page.evaluate('localStorage.getItem("savedStory")') == STORY
                        assert 'private upstream detail' not in report.inner_text()
                        assert not page.locator('#generationProgress').evaluate('e=>e.classList.contains("show")')
                    successful = page.evaluate('localStorage.getItem("novelStoryStateLedger")')
                    server.mode = 'length'
                    activate('#continuityRetry')
                    expect(report).to_contain_text('回應被截斷')
                    expect(report).to_contain_text('上次成功整理')
                    assert page.evaluate('localStorage.getItem("novelStoryStateLedger")') == successful
                    page.locator('.manuscript-continuity').screenshot(path=str(OUT / f'{engine}-{width}-failure.png'))
                    server.mode = 'hold'
                    server.release.clear()
                    activate('#continuityRetry')
                    expect(report).to_contain_text('檢查中')
                    expect(page.locator('#continuityRetry')).to_be_disabled()
                    activate('#continuityCancel')
                    expect(page.locator('#continuityRetry')).to_be_enabled()
                    expect(page.locator('#continuityCancel')).to_be_hidden()
                    server.release.set()
                    assert page.locator('#result').text_content() == original
                    assert page.evaluate('localStorage.getItem("novelStoryStateLedger")') == successful
                    page.reload(wait_until='networkidle')
                    activate('.manuscript-continuity summary')
                    expect(report).to_contain_text('上次成功整理')
                    for mode in ('baseline', 'partial'):
                        server.mode = mode
                        before = len(server.requests)
                        activate('#continuityRetry')
                        expect(page.locator('#continuityRetry')).to_be_enabled()
                        assert len(server.requests) == before + 1
                    expect(report).to_contain_text('摘要更新不完整')
                    expect(report).to_contain_text('地點：城門 → 河岸')
                    expect(report).to_contain_text('轉變引句：未提供')
                    expect(report).not_to_contain_text('疑似劇情衝突')
                    expect(report).not_to_contain_text('上次成功整理')
                    assert page.locator('#continuityReport img').count() == 0
                    ledger = page.evaluate('JSON.parse(localStorage.getItem("novelStoryStateLedger"))')
                    assert len(ledger['issues']) == 2
                    assert ledger['state']['characterStates'] == ['守門人仍在城門。']
                    assert next(e for e in ledger['state']['entities'] if e['entity'] == '旅人')['location'] == '城門'
                    page.locator('.manuscript-continuity').screenshot(path=str(OUT / f'{engine}-{width}-partial.png'))
                    before = len(server.requests)
                    page.reload(wait_until='networkidle')
                    activate('.manuscript-continuity summary')
                    expect(report).to_contain_text('摘要更新不完整')
                    assert len(server.requests) == before, 'restoring categories must not call API'
                    server.mode = 'omitted'
                    activate('#continuityRetry')
                    expect(page.locator('#continuityRetry')).to_be_enabled()
                    expect(report).to_contain_text('地點：城門 → 河岸')
                    expect(report).not_to_contain_text('未發現規則衝突')
                    assert len(server.requests) == before + 1
                    before = len(server.requests)
                    # Older saved records only have warning strings and must also restore safely.
                    page.evaluate('const x=JSON.parse(localStorage.getItem("novelStoryStateLedger"));delete x.issues;delete x.analysisStart;localStorage.setItem("novelStoryStateLedger",JSON.stringify(x));')
                    page.reload(wait_until='networkidle')
                    activate('.manuscript-continuity summary')
                    expect(report).to_contain_text('摘要更新不完整')
                    server.mode = 'repaired'
                    activate('#continuityRetry')
                    expect(page.locator('#continuityRetry')).to_be_enabled()
                    expect(report).to_contain_text('未發現規則衝突')
                    repaired = page.evaluate('JSON.parse(localStorage.getItem("novelStoryStateLedger"))')
                    assert next(e for e in repaired['state']['entities'] if e['entity'] == '旅人')['location'] == '河岸'
                    assert page.locator('#result').text_content() == original
                    assert page.evaluate('localStorage.getItem("savedStory")') == STORY
                    assert len(server.requests) == before + 1
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    box = page.locator('#continuityRetry').bounding_box()
                    assert box['height'] >= 44 and box['width'] >= 44
                    assert not errors, errors
                    print(f'PASS continuity {engine} {width}px', flush=True)
                    context.close()
                browser.close()
    finally:
        server.release.set()
        server.shutdown()
        server.server_close()
    print(f'Artifacts: {OUT}', flush=True)

if __name__ == '__main__':
    run()
