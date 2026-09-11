"""Real repeat-click/tap regression. Serve public/ locally and pass its URL; no paid calls."""
import os
from pathlib import Path
import sys
import tempfile
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
URL = sys.argv[1]
OUT = Path(tempfile.gettempdir()) / 'novel-random-fill-qa'
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    for engine, widths in [('chromium', [375, 428, 1280]), ('webkit', [375])]:
        options = {'executable_path': os.environ.get('CHROME_BIN', 'C:/Program Files/Google/Chrome/Application/chrome.exe')} if engine == 'chromium' else {}
        browser = getattr(p, engine).launch(headless=True, **options)
        for width in widths:
            context = browser.new_context(viewport={'width': width, 'height': 850}, is_mobile=width < 500, has_touch=width < 500, service_workers='block')
            context.add_init_script('localStorage.setItem("novelWorkshopOnboarded","1");')
            page = context.new_page()
            errors, api_calls = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))

            def route_request(route):
                if '/api/chat' in route.request.url:
                    api_calls.append(route.request.url)
                    route.abort()
                elif route.request.url.startswith(URL):
                    route.continue_()
                else:
                    route.abort()

            page.route('**/*', route_request)
            page.goto(URL, wait_until='networkidle')
            activate = lambda selector: page.locator(selector).tap() if width < 500 else page.locator(selector).click()
            activate('#openAdvancedModalBtn')
            page.locator('#randomSeed').fill('keep-my-story-seed')
            activate('#advancedSettingsModal .modal-close')
            activate('#openStoryModalBtn')
            previous = None
            for attempt in range(5):
                activate('#randomStoryElementsBtn')
                current = [page.locator('#' + name).input_value() for name in ['theme', 'setting', 'style']]
                assert all(current), current
                if previous is not None:
                    assert all(a != b for a, b in zip(previous, current)), f'{engine}/{width} click {attempt + 1} reused selections: {current}'
                previous = current
                assert page.locator('#randomSeed').input_value() == 'keep-my-story-seed'
            page.locator('#storyElementsModal').screenshot(path=str(OUT / f'{engine}-{width}.png'))
            activate('#storyElementsModal .modal-close')
            page.reload(wait_until='networkidle')
            activate('#openStoryModalBtn')
            assert [page.locator('#' + name).input_value() for name in ['theme', 'setting', 'style']] == previous
            activate('#randomStoryElementsBtn')
            current = [page.locator('#' + name).input_value() for name in ['theme', 'setting', 'style']]
            assert all(a != b for a, b in zip(previous, current))
            assert not api_calls, api_calls
            assert not errors, errors
            print(f'PASS {engine}/{width}: repeated fill, saved settings, no API calls', flush=True)
            context.close()
        browser.close()
