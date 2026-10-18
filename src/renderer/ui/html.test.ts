import { escapeHtml, html, raw, refs } from './html';

const render = (f: DocumentFragment) => {
  const div = document.createElement('div');
  div.append(f);
  return div;
};

describe('html``', () => {
  it('escapes text: markup in data stays text', () => {
    const evil = '<img src=x onerror="alert(1)">';
    const div = render(html`<p>${evil}</p>`);
    expect(div.querySelector('img')).toBeNull();
    expect(div.textContent).toBe(evil);
  });

  it('escapes attribute values, including quote breakouts', () => {
    const evil = '" onmouseover="alert(1)';
    const div = render(html`<a title="${evil}" class="c ${"x' onclick='y"}">t</a>`);
    const a = div.querySelector('a')!;
    expect(a.getAttribute('title')).toBe(evil);
    expect(a.getAttribute('onmouseover')).toBeNull();
    expect(a.getAttribute('onclick')).toBeNull();
  });

  it('neutralises javascript: URLs (with whitespace, case and control-char tricks)', () => {
    for (const url of ['javascript:alert(1)', '  JavaScript:alert(1)', '\u0001javascript:x']) {
      expect(
        render(html`<a href="${url}">x</a>`)
          .querySelector('a')!
          .getAttribute('href'),
      ).toBe('about:blank');
    }
    expect(
      render(html`<a href="${'https://ok.uz'}">x</a>`)
        .querySelector('a')!
        .getAttribute('href'),
    ).toBe('https://ok.uz');
  });

  it('after an interpolated attribute value, the tag closes and text positions work again', () => {
    const node = document.createElement('i');
    node.textContent = 'n';
    const div = render(
      html`<aside aria-label="${'Menyu'}">
        <div>${node}<input placeholder="${'q'}" /></div>
      </aside>`,
    );
    expect(div.querySelector('aside')!.getAttribute('aria-label')).toBe('Menyu');
    expect(div.querySelector('aside i')?.textContent).toBe('n');
    expect(div.querySelector('input')!.getAttribute('placeholder')).toBe('q');
  });

  it('refuses unquoted attributes and on* interpolation', () => {
    expect(() => html`<div class=${'a'}></div>`).toThrow(/quoted/);
    expect(() => html`<div onclick="${'x'}"></div>`).toThrow(/onclick/);
  });

  it('inserts nodes, nested templates and arrays, also inside table rows', () => {
    const cell = document.createElement('td');
    cell.textContent = 'node';
    const rows = ['a<b', 'c'].map(
      (t) =>
        html`<tr>
          <td>${t}</td>
        </tr>`,
    );
    const div = render(
      html`<table>
        <tbody>
          ${rows}
          <tr>
            ${cell}
          </tr>
        </tbody>
      </table>`,
    );
    expect([...div.querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      'a<b',
      'c',
      'node',
    ]);
    // Reading markup back is the point of this assertion.
    // eslint-disable-next-line no-restricted-properties
    expect(div.querySelector('td')!.innerHTML).toBe('a&lt;b');
  });

  it('keeps event listeners on inserted nodes', () => {
    const button = document.createElement('button');
    const onClick = jest.fn();
    button.addEventListener('click', onClick);
    const div = render(html`<div>${button}</div>`);
    div.querySelector('button')!.click();
    expect(onClick).toHaveBeenCalled();
  });

  it('drops null, undefined and booleans; raw() is inserted as-is', () => {
    expect(render(html`<p>${null}${undefined}${false}${true}${0}</p>`).textContent).toBe('0');
    expect(render(html`<p>${raw('<b>x</b>')}</p>`).querySelector('b')?.textContent).toBe('x');
  });

  it('refs() finds data-ref elements', () => {
    const r = refs<{ name: HTMLInputElement }>(
      render(html`<input data-ref="name" value="${'v'}" />`),
    );
    expect(r.name.value).toBe('v');
  });

  it('escapeHtml covers all five characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
