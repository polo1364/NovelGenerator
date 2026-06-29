const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let edge = fs.readFileSync(path.join(root, 'public/js/edge-tts-speech.js'), 'utf8');
let speech = fs.readFileSync(path.join(root, 'reader-speech.js'), 'utf8');

edge = edge.replace(
  'async function checkAvailable() {',
  'async function checkAvailable() {\n    if (typeof location !== "undefined" && location.protocol === "file:") return false;'
);

speech = speech.replace(
  "if (api.toast) api.toast('Edge 朗讀需啟動本機伺服器（npm start）');",
  "if (api.toast) api.toast(location.protocol==='file:'?'單檔模式無法 Edge 朗讀，請 npm start 後用 localhost 開啟':'Edge 朗讀需啟動本機伺服器（npm start）');"
);

const block = '<script src="edge-tts-speech.js"></script>\r\n<script src="reader-speech.js"></script>';
const blockLf = block.replace(/\r\n/g, '\n');
const inline = '<script>\n' + edge + '\n</script>\n<script>\n' + speech + '\n</script>';

if (!html.includes(block) && !html.includes(blockLf)) {
  if (html.includes('global.EdgeTtsSpeech') && html.includes('global.initReaderSpeech')) {
    console.log('Already inlined');
    process.exit(0);
  }
  console.error('marker not found');
  process.exit(1);
}

html = html.includes(block) ? html.replace(block, inline) : html.replace(blockLf, inline.replace(/\r\n/g, '\n'));
html = html.replace(
  'Microsoft Edge 神經語音 · 需執行 npm start',
  '閱讀可雙擊本檔 · Edge 朗讀需 npm start 後用 localhost 開啟'
);
html = html.replace(
  '本機書庫 · 雙擊即可使用',
  '本機書庫 · 雙擊 index.html 即可閱讀'
);

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('inlined OK, size', html.length);
