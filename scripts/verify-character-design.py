"""Isolated browser contracts for four-step setup and character design. No paid API."""
import json
import os
from pathlib import Path
import sys
import tempfile
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
URL = sys.argv[1]
OUT = Path(tempfile.gettempdir()) / 'novel-character-design-qa'
OUT.mkdir(exist_ok=True)
EXTRAS = {'background': '前醫師曾誤診', 'ability': '治療消耗記憶', 'belief': '不傷無辜', 'arc': '逐步學會信任', 'voice': '緊張時反問', 'allegiance': '效忠王室卻欠敵方人情'}
CHAR = {'name': '林晴', 'gender': '女', 'role': '女主角', 'age': '28', 'personality': '冷靜', 'goal': '救人避免再失去家人', 'weakness': '害怕失敗', 'secret': '誤診只有師父知情', 'relation': '與師父互相猜疑', **EXTRAS}
STORY = '# 古城\n\n## 第1章 代價\n\n' + '林晴突然忘記所有限制，救活了病人。\n' * 90 + '\n（全文完）'
PLAN = {'openingAnchor': '林晴走進古城', 'steps': [{'action': '救人', 'motive': '避免失去家人', 'cause': '有人受傷', 'effect': '付出記憶代價'}], 'allowedChanges': ['消耗記憶'], 'fixedFacts': ['能力需要代價']}

with sync_playwright() as p:
    for engine, widths in [('chromium', [375, 428, 768, 1280, 1536]), ('webkit', [375])]:
        options = {'executable_path': os.environ.get('CHROME_BIN', 'C:/Program Files/Google/Chrome/Application/chrome.exe')} if engine == 'chromium' else {}
        browser = getattr(p, engine).launch(headless=True, **options)
        for width in widths:
            context = browser.new_context(viewport={'width': width, 'height': 900}, has_touch=width < 500, is_mobile=width < 500, service_workers='block')
            legacy = {'theme': '奇幻', 'setting': '海港', 'notes': '禁止穿越', 'chapters': '10', 'length': '50000', 'era': '古代', 'rating': '普遍級', 'autoContinue': False,
                      'characters': [{'name': '舊人物', 'gender': '女', 'goal': '保留我的目標'}]}
            context.add_init_script('if(!localStorage.getItem("novelWorkshopOnboarded")){localStorage.setItem("novelWorkshopOnboarded","1");localStorage.setItem("novelGeneratorSettings",'+json.dumps(json.dumps(legacy))+');}')
            page = context.new_page()
            errors, requests, held = [], [], []
            hold = {'value': False}
            override = {'value': None}
            response_mode = {'value': 'characters'}
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('dialog', lambda dialog: dialog.accept())

            def reply(route):
                data = override['value'] if override['value'] is not None else ([CHAR] if 'JSON 陣列' in route.request.post_data else CHAR)
                body = json.loads(route.request.post_data)
                if response_mode['value'] != 'characters':
                    if body.get('stream'):
                        content = '## 第1章 代價\n林晴必須救人並付出記憶代價。' if response_mode['value'] == 'outline' else STORY
                        chunks = [{'choices': [{'delta': {'content': content}, 'finish_reason': None}]}, {'choices': [{'delta': {}, 'finish_reason': 'stop'}]}]
                        route.fulfill(status=200, content_type='text/event-stream', body=''.join('data: '+json.dumps(chunk)+'\n\n' for chunk in chunks)+'data: [DONE]\n\n')
                        return
                    data = PLAN if body.get('max_tokens') == 1600 else {'recentOutcome': '林晴救人', 'characterConflicts': [{'character': '林晴', 'conflictType': 'ability_limit', 'constraint': '手動指定能力', 'issue': '未建立突破能力限制的原因', 'evidence': '林晴突然忘記所有限制'}]}
                route.fulfill(status=200, content_type='application/json', body=json.dumps({'choices': [{'message': {'content': json.dumps(data)}, 'finish_reason': 'stop'}]}))

            def route_request(route):
                if '/api/chat' in route.request.url:
                    requests.append(json.loads(route.request.post_data))
                    if hold['value']:
                        held.append(route)
                    else:
                        reply(route)
                elif route.request.url.startswith(URL):
                    route.continue_()
                else:
                    route.abort()

            page.route('**/*', route_request)
            page.goto(URL, wait_until='networkidle')
            ids = page.locator('.workspace-setup-launchers > button').evaluate_all('els=>els.map(e=>e.id)')
            assert ids == ['openStoryModalBtn', 'openAdvancedModalBtn', 'openSpecialModalBtn', 'openCharacterModalBtn'], ids
            activate = lambda selector: page.locator(selector).tap() if width < 500 else page.locator(selector).click()
            activate('#openSpecialModalBtn')
            assert page.locator('#specialElementsModal #notes').input_value() == '禁止穿越'
            page.locator('.special-element-item').first.click()
            element_name = page.locator('.special-element-item.selected .element-label').first.text_content()
            activate('#specialElementsModal .modal-close')
            activate('#openCharacterModalBtn')
            assert page.locator('.char-name').input_value() == '舊人物'
            assert page.locator('.char-goal').input_value() == '保留我的目標'
            assert '尚無 AI' in page.locator('#characterDesignStatus').text_content()
            for key in EXTRAS:
                assert page.locator('.char-' + key).input_value() == ''
            activate('#aiGenerateCharactersBtn')
            page.wait_for_function('!document.getElementById("aiGenerateCharactersBtn").disabled')
            assert len(requests) == 1
            prompt = requests[-1]['messages'][-1]['content']
            for value in ['海港', '古代', '普遍級', '50000', '禁止穿越', element_name, '能力與代價', '成長方向']:
                assert value in prompt, value
            for key, value in EXTRAS.items():
                assert page.locator('.char-' + key).input_value() == value, key
            assert '已變更' not in page.locator('#characterDesignStatus').text_content()
            activate('.character-more summary')
            page.locator('#characterSettingsModal').screenshot(path=str(OUT / f'{engine}-{width}.png'))
            assert not page.locator('#characterSettingsModal').evaluate('e=>e.scrollWidth>innerWidth'), width
            activate('#characterSettingsModal .modal-close')
            page.reload(wait_until='networkidle')
            activate('#openSpecialModalBtn')
            page.locator('#notes').fill('禁止穿越；全劇不得有戰爭')
            activate('#specialElementsModal .modal-close')
            activate('#openCharacterModalBtn')
            assert '已變更' in page.locator('#characterDesignStatus').text_content()
            assert len(requests) == 1
            # Existing manual data survives single-row completion and an in-flight edit.
            prior_marker = page.locator('.character-row').get_attribute('data-ai-design-context-key')
            override['value'] = [{}]
            activate('#aiGenerateCharactersBtn')
            page.wait_for_function('!document.getElementById("aiGenerateCharactersBtn").disabled')
            assert page.locator('.character-row').get_attribute('data-ai-design-context-key') == prior_marker, 'partial cast must not claim current design'
            override['value'] = {}
            activate('.char-ai-btn')
            page.wait_for_function('!document.querySelector(".char-ai-btn").disabled')
            assert page.locator('.character-row').get_attribute('data-ai-design-context-key') == prior_marker, 'empty single response must not clear stale warning'
            override['value'] = None
            page.locator('.char-ability').fill('手動指定能力')
            page.locator('.char-arc').fill('')
            activate('.char-ai-btn')
            page.wait_for_function('!document.querySelector(".char-ai-btn").disabled')
            assert page.locator('.char-ability').input_value() == '手動指定能力'
            assert page.locator('.char-arc').input_value() == EXTRAS['arc']
            hold['value'] = True
            activate('#aiGenerateCharactersBtn')
            page.wait_for_timeout(100)
            assert held
            page.locator('.char-goal').fill('請勿覆蓋進行中的編輯')
            reply(held.pop())
            page.wait_for_function('!document.getElementById("aiGenerateCharactersBtn").disabled')
            assert page.locator('.char-goal').input_value() == '請勿覆蓋進行中的編輯'
            if engine == 'chromium' and width == 1280:
                hold['value'] = False
                activate('#characterSettingsModal .modal-close')
                activate('#openStoryModalBtn')
                page.locator('#chapters').fill('1')
                page.locator('#length').fill('1000')
                page.locator('#autoContinueToggle').uncheck()
                activate('#storyElementsModal .modal-close')
                response_mode['value'] = 'outline'
                activate('#pipeline [data-action="outline"]')
                activate('#generateOutlineBtn')
                page.wait_for_function('document.getElementById("outlineLoading").style.display === "none"')
                outline_prompt = requests[-1]['messages'][-1]['content']
                for value in [EXTRAS['background'], EXTRAS['belief'], EXTRAS['arc'], EXTRAS['voice'], EXTRAS['allegiance'], '手動指定能力']:
                    assert value in outline_prompt, ('outline', value)
                activate('#closeOutlineModal')
                response_mode['value'] = 'prose'
                before = len(requests)
                activate('#primaryGenerateBtn')
                page.wait_for_function('document.getElementById("continuityReport").textContent.includes("疑似人物設定偏離")')
                pipeline_requests = requests[before:]
                assert len(pipeline_requests) == 3, [(r.get('stream'), r.get('max_tokens')) for r in pipeline_requests]
                for request in pipeline_requests:
                    for value in [EXTRAS['background'], EXTRAS['belief'], EXTRAS['arc'], EXTRAS['voice'], EXTRAS['allegiance'], '手動指定能力']:
                        assert value in request['messages'][-1]['content'], (request.get('max_tokens'), value)
                before_text = page.locator('#result').text_content()
                activate('.manuscript-continuity summary')
                activate('#continuityRetry')
                page.wait_for_function('!document.getElementById("continuityRetry").disabled')
                assert '疑似人物設定偏離' in page.locator('#continuityReport').text_content()
                assert page.locator('#result').text_content() == before_text
                print('PASS actual outline -> chapter plan -> prose -> state -> same-text recheck payloads', flush=True)
            assert not errors, errors
            print(f'PASS {engine}/{width}: order, legacy, context, extras, stale warning, safe completion and race', flush=True)
            context.close()
        browser.close()
