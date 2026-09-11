"""Browser regression for cut prose and evidence-gated warnings; local fixtures, no paid API."""
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
OUT = Path(tempfile.gettempdir()) / 'novel-truncation-qa'
OUT.mkdir(exist_ok=True)
PARTIAL = '# 城門紀事\n\n## 第1章 城門\n\n' + '他們走進城裡，準備尋找失蹤的人。\n' * 130 + '「帶走。」他對十二個戰士說。「萊'
REST = '恩還活著。」\n' + '他們終於找到了失蹤者，決定先回城。\n' * 90
PLAN = {'openingAnchor': '接續城門事件', 'steps': [{'action': '尋人', 'motive': '救人', 'cause': '有人失蹤', 'effect': '找到同伴'}], 'allowedChanges': ['找到同伴'], 'fixedFacts': ['同伴仍活著']}
SETTINGS = {'theme': '奇幻', 'setting': '海港', 'style': '寫實', 'chapters': '3', 'length': '6000', 'autoContinue': False,
            'characters': [{'name': '申屠硯', 'gender': '男', 'belief': '不主動傷害轉世者'}, {'name': '九黎梟', 'gender': '男', 'personality': '冷靜殘暴'}]}

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT / 'public')))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/'
try:
    with sync_playwright() as p:
        for engine, widths in [('chromium', [375, 428, 1280]), ('webkit', [375])]:
            options = {'executable_path': os.environ.get('CHROME_BIN', 'C:/Program Files/Google/Chrome/Application/chrome.exe')} if engine == 'chromium' else {}
            browser = getattr(p, engine).launch(headless=True, **options)
            for width in widths:
                for mode in ['saved', 'saved_pending', 'initial_eof', 'initial_length', 'failed_resume', 'cancel_state']:
                    context = browser.new_context(viewport={'width': width, 'height': 850}, has_touch=width < 500, is_mobile=width < 500, service_workers='block')
                    initial = PARTIAL + '恩還活著。」' if mode == 'saved_pending' else PARTIAL
                    context.add_init_script('localStorage.setItem("novelWorkshopOnboarded","1");localStorage.setItem("novelGeneratorSettings",'+json.dumps(json.dumps(SETTINGS))+');localStorage.setItem("savedStory",'+json.dumps(initial)+');')
                    page = context.new_page()
                    errors, requests, streams, held = [], [], [], []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.on('dialog', lambda dialog: dialog.accept())

                    def route_request(route):
                        if '/api/chat' not in route.request.url:
                            route.continue_() if route.request.url.startswith(url) else route.abort()
                            return
                        body = json.loads(route.request.post_data)
                        requests.append(body)
                        if body.get('stream'):
                            streams.append(body)
                            first = len(streams) == 1 and not mode.startswith('saved')
                            content = PARTIAL + REST if mode == 'cancel_state' else PARTIAL if first else REST
                            if mode == 'failed_resume' and not first:
                                route.fulfill(status=401, content_type='application/json', body='{"error":{"message":"invalid api key"}}')
                                return
                            terminal = 'length' if first and mode == 'initial_length' else 'stop'
                            chunks = 'data: '+json.dumps({'choices': [{'delta': {'content': content}}]})+'\n\n'
                            if not (first and mode == 'initial_eof'):
                                chunks += 'data: '+json.dumps({'choices': [{'delta': {}, 'finish_reason': terminal}]})+'\n\ndata: [DONE]\n\n'
                            route.fulfill(status=200, content_type='text/event-stream', body=chunks)
                        else:
                            if mode == 'cancel_state' and body.get('max_tokens') == 3000:
                                held.append(route)
                                return  # Hold state response so Stop cancels only the analysis.
                            data = PLAN if body.get('max_tokens') == 1600 else {'recentOutcome': '找到同伴'}
                            route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices': [{'message': {'content': json.dumps(data)}, 'finish_reason': 'stop'}]}))

                    page.route('**/*', route_request)
                    page.goto(url, wait_until='networkidle')
                    if mode == 'saved_pending':
                        page.evaluate('localStorage.setItem("novelStoryResume", JSON.stringify({fingerprint:NovelGenerationPlanning.createStoryFingerprint(localStorage.getItem("savedStory"))}))')
                        page.reload(wait_until='networkidle')
                    activate = lambda selector: page.locator(selector).tap() if width < 500 else page.locator(selector).click()
                    activate('#manuscriptContinue' if mode.startswith('saved') else '#primaryGenerateBtn')
                    if mode == 'cancel_state':
                        expect(page.locator('#generationStage')).to_contain_text('3/3', timeout=20000)
                        activate('#stopGenerationBtn')
                        expect(page.locator('#primaryGenerateBtn')).to_be_enabled()
                        assert len(streams) == 1
                        assert page.evaluate('localStorage.getItem("novelStoryResume")') is None
                        assert page.locator('#result').text_content() == PARTIAL + REST.strip()
                        assert not errors, errors
                        for route in held:
                            route.abort()
                        print(f'PASS {engine}/{width}/cancel_state: completed prose not marked as pending', flush=True)
                        context.close()
                        continue
                    expect(page.locator('#generationStage')).to_contain_text('正文尚未完成' if mode == 'failed_resume' else '本次生成流程完成', timeout=20000)
                    expect(page.locator('#primaryGenerateBtn')).to_be_enabled()
                    assert len(streams) == (1 if mode.startswith('saved') else 2), (mode, len(streams))
                    continuation_prompt = streams[-1]['messages'][-1]['content']
                    assert '接續完成【第 1 章】' in continuation_prompt
                    assert '撰寫【第 2 章】' not in continuation_prompt
                    text = page.locator('#result').text_content()
                    if mode == 'failed_resume':
                        assert text == PARTIAL
                        assert not any(r.get('max_tokens') == 3000 for r in requests)
                        assert '第1章生成完成' not in page.locator('#status').text_content()
                        expect(page.locator('#manuscriptContinue')).to_be_enabled()
                    else:
                        assert '「萊恩還活著。」' in text, text[-200:]
                        assert '第2章' not in text
                        assert len([r for r in requests if r.get('max_tokens') == 3000]) == 1
                        assert page.evaluate('localStorage.getItem("novelStoryResume")') is None
                    assert page.evaluate('localStorage.getItem("savedStory")') == text
                    assert not errors, errors
                    page.locator('.manuscript-workspace').screenshot(path=str(OUT / f'{engine}-{width}-{mode}.png'))
                    print(f'PASS {engine}/{width}/{mode}: same chapter, saved prose, correct completion state', flush=True)
                    context.close()
            browser.close()
finally:
    server.shutdown()
    server.server_close()
print(f'Artifacts: {OUT}', flush=True)
