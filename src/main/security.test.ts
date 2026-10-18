jest.mock('electron', () => ({}));

import { isAppUrl, isExternalLinkAllowed } from './security';

describe('isAppUrl', () => {
  const dev = { devServerUrl: 'http://localhost:5400/' };
  const prod = {
    indexHtmlPath: 'C:\\Program Files\\SavdoChef\\resources\\app.asar\\dist-renderer\\index.html',
  };

  it('allows the dev server origin with any path or hash', () => {
    expect(isAppUrl('http://localhost:5400/', dev)).toBe(true);
    expect(isAppUrl('http://localhost:5400/#/orders', dev)).toBe(true);
  });

  it('rejects other ports, hosts and schemes in dev', () => {
    expect(isAppUrl('http://localhost:3000/', dev)).toBe(false);
    expect(isAppUrl('http://evil.example/', dev)).toBe(false);
    expect(isAppUrl('file:///C:/Windows/win.ini', dev)).toBe(false);
  });

  it('allows only the built index.html in production, any hash, case-insensitive drive path', () => {
    expect(
      isAppUrl(
        'file:///C:/Program%20Files/SavdoChef/resources/app.asar/dist-renderer/index.html',
        prod,
      ),
    ).toBe(true);
    expect(
      isAppUrl(
        'file:///c:/program files/savdochef/resources/app.asar/dist-renderer/index.html#/login',
        prod,
      ),
    ).toBe(true);
  });

  it('rejects other local files and remote pages in production', () => {
    expect(isAppUrl('file:///C:/Windows/win.ini', prod)).toBe(false);
    expect(
      isAppUrl(
        'file:///C:/Program%20Files/SavdoChef/resources/app.asar/dist-renderer/other.html',
        prod,
      ),
    ).toBe(false);
    expect(isAppUrl('https://example.com/', prod)).toBe(false);
    expect(isAppUrl('not a url', prod)).toBe(false);
  });
});

describe('isExternalLinkAllowed', () => {
  it('opens https only', () => {
    expect(isExternalLinkAllowed('https://savdochef.uz')).toBe(true);
    expect(isExternalLinkAllowed('http://savdochef.uz')).toBe(false);
    expect(isExternalLinkAllowed('file:///C:/x.exe')).toBe(false);
    expect(isExternalLinkAllowed('javascript:alert(1)')).toBe(false);
  });
});
