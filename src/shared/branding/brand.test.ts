import fs from 'fs';
import path from 'path';
import {
  BRAND_NAME,
  FAVICON_SOURCE,
  ICON_SOURCES,
  iconSvg,
  squareSvg,
  svgFileContents,
  toSvgString,
} from './brand';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

describe('generated brand files are current', () => {
  // If one of these fails, brand.ts changed: run `npm run build:icons` and commit the output.
  it.each(ICON_SOURCES.map((s) => [s.file, s.svg] as const))('build/icons/%s', (file, svg) => {
    expect(read(`build/icons/${file}`)).toBe(svgFileContents(svg()));
  });

  it('src/renderer/public/favicon.svg', () => {
    expect(read('src/renderer/public/favicon.svg')).toBe(svgFileContents(FAVICON_SOURCE()));
  });

  it('the Windows icon and PNGs exist', () => {
    for (const f of [
      'savdochef.ico',
      'savdochef-icon-1024.png',
      'savdochef-logo-square-1024.png',
    ]) {
      expect(fs.statSync(path.join(ROOT, 'build', 'icons', f)).size).toBeGreaterThan(1000);
    }
  });
});

describe('toSvgString', () => {
  it('escapes attribute values and text', () => {
    const out = toSvgString({ tag: 'text', attrs: { 'data-x': '"<&>' }, text: 'a<b & c' });
    expect(out).toBe('<text data-x="&quot;&lt;&amp;&gt;">a&lt;b &amp; c</text>');
  });

  it('produces a transparent-background icon: no full-canvas white fill', () => {
    const svg = toSvgString(iconSvg());
    expect(svg).not.toMatch(/fill="#fff(fff)?"[^>]*width="256"/i);
    expect(svg).toContain('rx="56"');
  });

  it('labels the artwork for screen readers', () => {
    expect(squareSvg().attrs['aria-label']).toBe(BRAND_NAME);
  });
});
