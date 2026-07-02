/** 將 public/ 同步到根目錄（GitHub Pages 工坊） */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'public');

const COPY_DIRS = ['css', 'js', 'icons', 'assets'];
const COPY_FILES = ['manifest.webmanifest', 'sw.js'];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const s = path.join(from, name);
    const d = path.join(to, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(src)) {
  console.error('public/ not found');
  process.exit(1);
}

for (const dir of COPY_DIRS) {
  const from = path.join(src, dir);
  if (fs.existsSync(from)) {
    copyDir(from, path.join(root, dir));
  }
}

for (const file of COPY_FILES) {
  const from = path.join(src, file);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(root, file));
  }
}

fs.copyFileSync(path.join(src, 'index.html'), path.join(root, 'index.html'));

// reader 站自帶一份多音字模組（供離線快取），從 public 同步避免漂移
fs.copyFileSync(
  path.join(src, 'js', 'tts-polyphone-hints.js'),
  path.join(root, 'reader', 'tts-polyphone-hints.js')
);
console.log('Synced public/ → root (workshop at /)');
