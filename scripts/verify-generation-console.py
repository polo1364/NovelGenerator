"""Real Chrome UI checks with a local, streamed API fixture. No paid requests.
Run: python scripts/verify-generation-console.py (requires Python Playwright).
"""
import functools
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(tempfile.gettempdir()) / 'novel-generation-console-qa'
OUT.mkdir(parents=True, exist_ok=True)
PLAN = {'openingAnchor':'旅人抵達古城', 'steps':[{'action':'尋找守門人','motive':'找到入口','cause':'城門關閉','effect':'得知入口'}], 'allowedChanges':['找到入口'], 'fixedFacts':['城門關閉']}
STORY = '# 測試故事\n## 第1章 古城\n' + '旅人走過古城，看見遠方的燈火。' * 125 + '\n'

class FixtureHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        if self.path != '/api/chat':
            self.send_error(404)
            return
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.requests.append({'stream':request['stream'],'max_tokens':request['max_tokens']})
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream' if request['stream'] else 'application/json')
            self.end_headers()
            if request['stream']:
                for fragment in [STORY[:500], STORY[500:]]:
                    self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':fragment},'finish_reason':None}]})+'\n\n').encode())
                    self.wfile.flush()
                    time.sleep(2)
                self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{},'finish_reason':'stop'}], 'usage':{'prompt_tokens':1000,'completion_tokens':2000,'total_tokens':3000}})+'\n\ndata: [DONE]\n\n').encode())
            else:
                time.sleep(2)
                content = PLAN if request['max_tokens'] == 1600 else {'recentOutcome':'旅人抵達古城'}
                self.wfile.write(json.dumps({'choices':[{'message':{'content':json.dumps(content)},'finish_reason':'stop'}], 'usage':{'prompt_tokens':1000,'completion_tokens':100,'total_tokens':1100}}).encode())
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # expected when the user presses Stop

def run():
    server = http.server.ThreadingHTTPServer(('127.0.0.1',0), functools.partial(FixtureHandler,directory=str(ROOT/'public')))
    server.requests = []
    threading.Thread(target=server.serve_forever,daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    report = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROME_BIN','C:/Program Files/Google/Chrome/Application/chrome.exe'),headless=True)
            for width in [375,428,768,1280,1536]:
                context = browser.new_context(viewport={'width':width,'height':900},is_mobile=width<500,has_touch=width<500,service_workers='block')
                context.add_init_script('localStorage.setItem("novelWorkshopOnboarded","1");localStorage.setItem("novelGeneratorSettings",JSON.stringify({theme:"奇幻",chapters:"2",length:"4000",autoContinue:false}));')
                # Fixed weekday pricing window, while the actual elapsed clock keeps ticking.
                hour = '01' if width == 375 else '00'
                context.add_init_script('''{const OriginalDate=Date,start=OriginalDate.now(),epoch=OriginalDate.parse("2026-09-10T'''+hour+''':00:00Z");globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[epoch+OriginalDate.now()-start]));}static now(){return epoch+OriginalDate.now()-start;}};}''')
                page = context.new_page()
                errors = []
                dialogs = {'cancel_next':False,'count':0}
                def handle_dialog(dialog):
                    dialogs['count'] += 1
                    if dialogs['cancel_next']:
                        dialogs['cancel_next'] = False
                        dialog.dismiss()
                    else:
                        dialog.accept()
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('dialog',handle_dialog)
                page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(url) else route.abort())
                page.goto(url,wait_until='networkidle')
                page.evaluate('document.fonts.ready')
                if not page.locator('#generationControlsBtn').is_visible():
                    page.locator('#dockToggle').click()
                page.locator('#generationControlsBtn').click()
                expect(page.locator('#primaryActions')).to_be_focused()
                expect(page.locator('#generateBtn')).not_to_be_visible()
                expect(page.locator('#continueBtn')).not_to_be_visible()
                expect(page.locator('#generationEstimate')).to_contain_text('$')
                if width == 375:
                    original_estimate = page.locator('#generationEstimate').inner_text()
                    page.locator('#openStoryModalBtn').click()
                    page.locator('#length').fill('6000')
                    page.locator('#storyElementsModal [data-modal-close="story"]').first.click()
                    expect(page.locator('#generationEstimate')).not_to_have_text(original_estimate)
                    expect(page.locator('#generationEstimateScope')).to_contain_text('3,000')
                    page.locator('#openStoryModalBtn').click()
                    page.locator('#length').fill('4000')
                    page.locator('#storyElementsModal [data-modal-close="story"]').first.click()
                    page.locator('#apiPanelToggle').click()
                    page.locator('#model').select_option('deepseek-v4-pro')
                    expect(page.locator('#generationEstimate')).not_to_have_text(original_estimate)
                    page.locator('#model').select_option('deepseek-flash')
                    page.locator('#apiPanelClose').click()
                    expect(page.locator('#generationEstimate')).to_have_text(original_estimate)
                    expect(page.locator('#actionPricingPeriod')).to_contain_text('尖峰')
                    dialogs['cancel_next'] = True
                    count_before_cancel = len(server.requests)
                    page.locator('#primaryGenerateBtn').click()
                    expect(page.locator('#status')).to_contain_text('已取消尖峰')
                    assert len(server.requests) == count_before_cancel
                    assert dialogs['count'] == 1
                if width <= 768:
                    assert page.locator('#generationControlsBtn').evaluate('(e)=>getComputedStyle(e,"::before").content') not in ['none','normal','""']
                for theme in ['light','dark']:
                    page.evaluate('(theme)=>setTheme(theme)',theme)
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'{width}: overflow'
                    page.locator('#primaryActions').screenshot(path=str(OUT/f'console-{width}-{theme}.png'))
                page.emulate_media(reduced_motion='reduce')
                before = len(server.requests)
                page.locator('#primaryGenerateBtn').click()
                expect(page.locator('#generationStage')).to_contain_text('1/3')
                expect(page.locator('#progressChapter')).to_contain_text('第1章')
                expect(page.locator('#generationStage')).to_contain_text('2/3')
                expect(page.locator('#progressWords')).not_to_have_text('已生成 0 字')
                page.wait_for_timeout(600)
                expect(page.locator('#progressTime')).not_to_have_text('已耗時 0:00')
                assert page.locator('#stopGenerationBtn').bounding_box()['height'] >= 44
                page.screenshot(path=str(OUT/f'live-{width}.png'))
                stop_state = page.evaluate('''() => { const e=stopGenerationBtn,r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,viewport:[innerWidth,innerHeight],hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,250),ok:r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}; }''')
                assert stop_state['ok'], f'{width}: stop obscured: {stop_state}'
                expect(page.locator('#generationStage')).to_contain_text('3/3',timeout=15000)
                expect(page.locator('#primaryContinueBtn')).to_be_enabled(timeout=15000)
                expect(page.locator('#generationProgress')).not_to_be_visible(timeout=15000)
                assert len(server.requests)-before == 3, 'exactly plan/story/state requests'
                assert not errors, errors
                report[width] = {'layout':True,'controls':True,'stages':True,'requests':3}
                if width == 375:
                    page.locator('#generationControlsBtn').click()
                    page.locator('#primaryContinueBtn').click()
                    expect(page.locator('#generationStage')).to_contain_text('1/3')
                    expect(page.locator('#progressWords')).not_to_have_text('已生成 0 字')
                    page.locator('#stopGenerationBtn').click()
                    expect(page.locator('#generationProgress')).not_to_be_visible(timeout=10000)
                    expect(page.locator('#result')).to_contain_text('旅人走過古城')
                    expect(page.locator('#primaryGenerateBtn')).to_be_enabled()
                    page.locator('#primaryContinueBtn').click()
                    expect(page.locator('#generationStage')).to_contain_text('2/3',timeout=10000)
                    page.locator('#stopGenerationBtn').click()
                    expect(page.locator('#generationProgress')).not_to_be_visible(timeout=10000)
                    expect(page.locator('#result')).to_contain_text('旅人走過古城')
                    report[width]['stop_preserves_story'] = True
                    report[width]['peak_cancel_and_accept'] = True
                    report[width]['estimate_updates'] = True
                context.close()
                print(f'PASS {width}px',flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    (OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'PASS artifacts: {OUT}',flush=True)

if __name__ == '__main__':
    run()
