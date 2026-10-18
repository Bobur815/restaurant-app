import { confirmDialog, openModal } from './modal';

// jsdom lacks <dialog> behaviour; give it the minimum the modal relies on.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

describe('modal', () => {
  it('escapes the title, focuses the first field and restores focus on close', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const body = document.createElement('div');
    const input = document.createElement('input');
    body.append(input);
    const m = openModal({ title: '<b>x</b>', body });

    expect(m.dialog.querySelector('.modal-title')!.textContent).toBe('<b>x</b>');
    expect(m.dialog.querySelector('b')).toBeNull();
    expect(document.activeElement).toBe(input);

    m.close();
    await m.closed;
    expect(document.activeElement).toBe(opener);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('an action returning false keeps it open; buttons are disabled while it runs', async () => {
    let release!: (v: boolean) => void;
    const m = openModal({
      title: 't',
      body: document.createElement('div'),
      actions: [
        { label: 'Go', kind: 'primary', onClick: () => new Promise<boolean>((r) => (release = r)) },
      ],
    });
    const go = m.dialog.querySelector<HTMLButtonElement>('.btn-primary')!;
    go.click();
    expect(go.disabled).toBe(true);
    release(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(m.dialog.open).toBe(true);
    expect(go.disabled).toBe(false);
    m.close();
  });

  it('a non-dismissible modal ignores Escape', () => {
    const m = openModal({ title: 't', body: document.createElement('div'), dismissible: false });
    const cancel = new Event('cancel', { cancelable: true });
    m.dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    m.close();
  });

  it('confirmDialog resolves true only on confirm', async () => {
    const yes = confirmDialog({ title: 'q', message: 'sure?' });
    document.querySelector<HTMLButtonElement>('dialog .btn-primary')!.click();
    await expect(yes).resolves.toBe(true);

    const no = confirmDialog({ title: 'q', message: 'sure?' });
    document.querySelector<HTMLButtonElement>('dialog .btn-secondary')!.click();
    await expect(no).resolves.toBe(false);
  });
});
