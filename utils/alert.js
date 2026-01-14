// utils/alert.js  (RENDERER-ONLY, electron import QILMAYDI)
let alertBox, resolveConfirm;

const isRenderer = typeof window !== 'undefined' && typeof document !== 'undefined';

// fetch & inject 1 marta
async function ensureAlertMarkup() {
  if (!isRenderer) return;        // mainda hech narsa qilmang
  if (alertBox) return;

  // relative yo'lni mutlaqga aylantiramiz
  const htmlUrl = new URL('../html/customAlert.html', window.location.href);
  const cssUrl  = new URL('../css/alert.css', window.location.href);

  // CSS link qo'shish (agar yo'q bo'lsa)
  const exists = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some(l => l.href === String(cssUrl));
  if (!exists) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = String(cssUrl);
    document.head.appendChild(link);
  }

  // HTML ni yuklab, body ga qo'shamiz
  const res  = await fetch(htmlUrl);
  const html = await res.text();
  document.body.insertAdjacentHTML('beforeend', html);

  alertBox = document.getElementById('customAlert');
  const okBtn = document.getElementById('confirmAlertBtn');
  const cancelBtn = document.getElementById('cancelAlertBtn');

  okBtn?.addEventListener('click', () => {
    alertBox.classList.add('hidden');
    if (resolveConfirm) { resolveConfirm(true); resolveConfirm = null; }
  });
  cancelBtn?.addEventListener('click', () => {
    alertBox.classList.add('hidden');
    if (resolveConfirm) { resolveConfirm(false); resolveConfirm = null; }
  });
}

export async function showAlert(message, { duration = 3000 } = {}) {
  if (!isRenderer) {
    // Renderer-dagina ishlaydi. Mainda buni chaqirmang.
    console.warn('[alert.js] showAlert called outside renderer; noop.');
    return;
  }

  await ensureAlertMarkup();

  const alertEl = document.getElementById('customAlert');
  const msgEl   = document.getElementById('alertMessage');
  const okBtn   = document.getElementById('confirmAlertBtn');
  const cancel  = document.getElementById('cancelAlertBtn');

  msgEl.textContent = message ?? '';
  msgEl.style.whiteSpace = 'pre-line';
  cancel.style.display = 'none';
  alertEl.classList.remove('hidden');

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      okBtn.removeEventListener('click', onOk);
      alertEl.classList.add('hidden');
      resolve();
    };

    const onOk = () => finish();

    const tid = setTimeout(finish, duration);
    okBtn.addEventListener('click', onOk);
  });
}

export async function showConfirm(message) {
  if (!isRenderer) {
    console.warn('[alert.js] showConfirm called outside renderer; returning false.');
    return false; // yoki throw yangi error
  }

  await ensureAlertMarkup();

  const alertEl = document.getElementById('customAlert');
  const msgEl   = document.getElementById('alertMessage');
  const cancel  = document.getElementById('cancelAlertBtn');

  msgEl.textContent = message ?? '';
  cancel.style.display = 'inline-block';
  alertEl.classList.remove('hidden');

  return new Promise((resolve) => { resolveConfirm = resolve; });
}
