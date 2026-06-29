/**
 * 將 reader/icons 來源圖轉成 PWA 所需正方形圖示（避免被系統壓扁變形）
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ICONS_DIR = path.join(__dirname, '..', 'reader', 'icons');
const BG = { r: 58, g: 42, b: 26, alpha: 1 }; // #3a2a1a

async function centerCropSquare(input, output, size) {
  const meta = await sharp(input).metadata();
  const side = Math.min(meta.width, meta.height);
  const left = Math.floor((meta.width - side) / 2);
  const top = Math.floor((meta.height - side) / 2);
  await sharp(input)
    .extract({ left, top, width: side, height: side })
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(output);
}

async function maskableIcon(input, output, size) {
  const inner = Math.round(size * 0.72);
  const buf = await sharp(input)
    .resize(inner, inner, { fit: 'contain', background: BG })
    .extend({
      top: Math.floor((size - inner) / 2),
      bottom: Math.ceil((size - inner) / 2),
      left: Math.floor((size - inner) / 2),
      right: Math.ceil((size - inner) / 2),
      background: BG,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(output, buf);
}

async function main() {
  const backup = path.join(ICONS_DIR, '_source-landscape.png');
  if (!fs.existsSync(backup)) {
    const fallback = path.join(ICONS_DIR, 'icon-512.png');
    if (!fs.existsSync(fallback)) {
      console.error('Source icon not found:', backup);
      process.exit(1);
    }
    fs.copyFileSync(fallback, backup);
  }

  await centerCropSquare(backup, path.join(ICONS_DIR, 'favicon-32.png'), 32);
  await centerCropSquare(backup, path.join(ICONS_DIR, 'icon-192.png'), 192);
  await centerCropSquare(backup, path.join(ICONS_DIR, 'icon-512.png'), 512);
  await centerCropSquare(backup, path.join(ICONS_DIR, 'apple-touch-icon.png'), 180);
  await maskableIcon(backup, path.join(ICONS_DIR, 'icon-512-maskable.png'), 512);

  for (const f of fs.readdirSync(ICONS_DIR).filter((x) => x.endsWith('.png') && !x.startsWith('_'))) {
    const meta = await sharp(path.join(ICONS_DIR, f)).metadata();
    console.log(f, meta.width + 'x' + meta.height);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
