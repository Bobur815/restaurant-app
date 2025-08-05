// utils/alert.js
let alertBox, resolveConfirm;

// Fetch & inject the HTML + CSS exactly once
async function ensureAlertMarkup() {
  if (alertBox) return;
  const res  = await fetch('../html/customAlert.html');
  const html = await res.text();
  document.body.insertAdjacentHTML('beforeend', html);

  // now grab the injected nodes
  alertBox    = document.getElementById('customAlert');
  const msgEl = document.getElementById('alertMessage');

  // Wire the buttons:
  document.getElementById('confirmAlertBtn').addEventListener('click', () => {
    alertBox.classList.add('hidden');
    if (resolveConfirm) resolveConfirm(true);
  });
  document.getElementById('cancelAlertBtn').addEventListener('click', () => {
    alertBox.classList.add('hidden');
    if (resolveConfirm) resolveConfirm(false);
  });
}

export async function showAlert(message, { duration = 3000 } = {}) {
  await ensureAlertMarkup();

  const msgEl      = document.getElementById('alertMessage');
  const alertEl    = document.getElementById('customAlert');
  const okBtn      = document.getElementById('confirmAlertBtn');

  msgEl.textContent = message;
  alertEl.classList.remove('hidden');
  document.getElementById('cancelAlertBtn').style.display = 'none';

  return new Promise(resolve => {
    let settled = false;

    // helper to hide + resolve, only once
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      okBtn.removeEventListener('click', onClick);
      alertEl.classList.add('hidden');
      resolve();
    };

    // auto-dismiss
    const timeoutId = setTimeout(finish, duration);

    // resolve early on OK click
    function onClick() {
      finish();
    }
    okBtn.addEventListener('click', onClick);
  });
}


export async function showConfirm(message) {
  await ensureAlertMarkup();
  document.getElementById('alertMessage').textContent = message;
  alertBox.classList.remove('hidden');
  document.getElementById('cancelAlertBtn').style.display = 'inline-block';

  return new Promise(resolve => {
    resolveConfirm = resolve;
  });
}
