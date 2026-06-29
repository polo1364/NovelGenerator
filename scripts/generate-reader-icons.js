/**
 * 將 reader/icons 來源圖轉成 PWA 所需正方形圖示（避免被系統壓扁變形）
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ICONS_DIR = path.join(__dirname, '..', 'reader', 'icons');
const BG = { r: 58, g: 42, b: 26, alpha: 1 }; // #3a2a1a

async function squareIcon(input, output, size, { maskable = false } = {}) {
  const inner = maskable ? Math.round(size * 0.72) : size;
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

  const meta = await sharp(buf).metadata();
  if (meta.width !== size || meta.height !== size) {
    throw new Error(`${output}: expected ${size}x${size}, got ${meta.width}x${meta.height}`);
  }
  fs.writeFileSync(output, buf);
}

async function main() {
  const src = path.join(ICONS_DIR, 'icon-512.png');
  if (!fs.existsSync(src)) {
    console.error('Source icon not found:', src);
    process.exit(1);
  }

  const backup = path.join(ICONS_DIR, '_source-landscape.png');
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(src, backup);
  }

  await squareIcon(backup, path.join(ICONS_DIR, 'icon-192.png'), 192);
  await squareIcon(backup, path.join(ICONS_DIR, 'icon-512.png'), 512);
  await squareIcon(backup, path.join(ICONS_DIR, 'icon-512-maskable.png'), 512, { maskable: true });
  await squareIcon(backup, path.join(ICONS_DIR, 'apple-touch-icon.png'), 180);

  for (const f of ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png']) {
    const meta = await sharp(path.join(ICONS_DIR, f)).metadata();
    console.log(f, meta.width + 'x' + meta.height);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
