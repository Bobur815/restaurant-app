import { qrSvg, utf8Bytes } from './qr';

describe('QR codes', () => {
  it('encode text as UTF-8, so a Cyrillic payee in a bank string survives', () => {
    expect(utf8Bytes('ST|A')).toEqual([0x53, 0x54, 0x7c, 0x41]);
    expect(utf8Bytes('Т')).toEqual([0xd0, 0xa2]);
    expect(utf8Bytes('€')).toEqual([0xe2, 0x82, 0xac]);
    expect(utf8Bytes('😀')).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  it('draw as SVG nodes with a white quiet zone', () => {
    const svg = qrSvg('ST00012|Name=Тошкент', 120);
    expect(svg.getAttribute('width')).toBe('120');
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('#fff');
    expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/^M\d/);
  });
});
