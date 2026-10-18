// Renders the brand artwork from src/shared/branding/brand.ts into:
//   build/icons/*.svg                       vector sources (committed; brand.test.ts checks they are current)
//   build/icons/savdochef.ico               Windows app/installer icon (16-256 px)
//   build/icons/savdochef-icon-1024.png     Linux icon, store listings
//   build/icons/savdochef-logo-square-1024.png
//   src/renderer/public/favicon.svg         window favicon
//
// Run: npm run build:icons   (needs Node >= 22.6 for --experimental-strip-types)
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = await import(pathToFileURL(join(root, 'src', 'shared', 'branding', 'brand.ts')).href);

const iconsDir = join(root, 'build', 'icons');
const publicDir = join(root, 'src', 'renderer', 'public');
mkdirSync(iconsDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

const svgFile = brand.svgFileContents;

for (const { file, svg } of brand.ICON_SOURCES) {
  writeFileSync(join(iconsDir, file), svgFile(svg()));
  console.log(`✓ build/icons/${file}`);
}
writeFileSync(join(publicDir, 'favicon.svg'), svgFile(brand.FAVICON_SOURCE()));
console.log('✓ src/renderer/public/favicon.svg');

/** Each size is rendered natively from the vector (not downscaled), so 16 px stays crisp. */
const png = (node) =>
  sharp(Buffer.from(brand.toSvgString(node)))
    .png({ compressionLevel: 9 })
    .toBuffer();

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const entries = await Promise.all(
  ICO_SIZES.map(async (size) => ({ size, data: await png(brand.iconSvg('light', size)) })),
);
writeFileSync(join(iconsDir, 'savdochef.ico'), buildIco(entries));
console.log(`✓ build/icons/savdochef.ico (${ICO_SIZES.join(', ')})`);

writeFileSync(join(iconsDir, 'savdochef-icon-1024.png'), await png(brand.iconSvg('light', 1024)));
console.log('✓ build/icons/savdochef-icon-1024.png');
writeFileSync(
  join(iconsDir, 'savdochef-logo-square-1024.png'),
  await png(brand.squareSvg('light', 1024)),
);
console.log('✓ build/icons/savdochef-logo-square-1024.png');

/** ICO container with PNG-compressed images (supported by Windows Vista and later). */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const dir = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette colours
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });

  return Buffer.concat([header, ...dir, ...images.map((i) => i.data)]);
}
