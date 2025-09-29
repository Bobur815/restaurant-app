// /renderer/settings/setting.js
import { showAlert } from "../../utils/alert.js";

const API_BASE = 'http://localhost:3000/api';

const toJSON = async (res) => {
  if (!res.ok) {
    const tx = await res.text().catch(() => '');
    throw new Error(tx || `HTTP ${res.status}`);
  }
  return res.json();
};

// API endpoints (adjust if needed)
const API = {
  me: '/users/me',
  updateMe: '/users/me',              // PUT { username? }
  changePassword: '/users/me/password',     // PUT { currentPassword, newPassword }
  receiptGet: '/receipt-settings',      // GET
  receiptUpdate: '/receipt-settings/update'       // PUT
};

export async function loadSettingsPage() {
  // When your template loader injects this page, call this function.
  try {
    await Promise.all([loadProfile(), loadReceipt()]);
  } catch (e) {
    console.error(e);
    showAlert(e.message || 'Sozlamalarni yuklashda xatolik.');
  }
}

// Auto-run if page is loaded directly (optional safety)
if (document.readyState !== 'loading') {
  safeInit();
} else {
  document.addEventListener('DOMContentLoaded', safeInit);
}
function safeInit() {
  const onSettingsPage =
    document.getElementById('profileForm') &&
    document.getElementById('receiptForm');
  if (onSettingsPage) loadSettingsPage();
}

async function loadProfile() {
  const usernameEl = document.getElementById('username');
  const currentPassword = document.getElementById('current-password');
  const res = await fetch(`${API_BASE}${API.me}`, { credentials: 'include' }).then(toJSON).catch(() => null);

  if (res && res.username && usernameEl) {
    usernameEl.value = res.username;
  }
  
  if (res.password) {
    currentPassword.value = res.password;
  }

  // Hook form
  const form = document.getElementById('profileForm');
  const btnSave = document.getElementById('profileSave');
  const btnReset = document.getElementById('profileReset');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    btnSave.disabled = true;

    const username = (document.getElementById('username')?.value || '').trim();
    const newPassword = document.getElementById('newPassword')?.value || '';
    const confirmPassword = document.getElementById('confirmPassword')?.value || '';

    try {
      // 1) Username update (if changed)
      if (username && username !== (res?.username || '')) {
        const result = await fetch(`${API_BASE}${API.updateMe}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username })
        }).then(toJSON);
        await showAlert(result.message)
        
      }

      // 2) Password change (if filled)
      if (newPassword || confirmPassword) {

        if (!newPassword || !confirmPassword) {
          throw new Error('Parolni o‘zgartirish uchun barcha maydonlarni to‘ldiring.');
        }
        if (newPassword !== confirmPassword) {
          throw new Error('Yangi parollar mos emas.');
        }
        const result = await fetch(`${API_BASE}${API.changePassword}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ newPassword })
        }).then(toJSON);
        
        await showAlert(result.message);
      }
      
      location.reload()
      // clear only password fields
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
    } catch (err) {
      console.error(err);
      await showAlert(err.message || 'Profilni yangilashda xatolik.');
    } finally {
      btnSave.disabled = false;
    }
  });

  btnReset?.addEventListener('click', () => {
    if (res?.username) document.getElementById('username').value = res.username;
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  });
}


async function loadReceipt() {
  const form = document.getElementById('receiptForm');
  const btnSave = document.getElementById('receiptSave');
  const btnReset = document.getElementById('receiptReset');

  let original = null;

  try {
    original = await fetch(`http://localhost:3000/api/receipt-settings`).then(toJSON);
  } catch {
    // create defaults if API returns empty
    original = {
      restaurantName: '',
      address: '',
      phone: '',
      footerNote: ''
    };
  }

  // fill
  setReceiptForm(original);

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    btnSave.disabled = true;

    const payload = getReceiptForm();
    try {
      const result = await fetch(`${API_BASE}${API.receiptUpdate}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      }).then(toJSON);

      await showAlert(result.message);
      location.reload()
      original = payload;
    } catch (err) {
      console.error(err);
      await showAlert(err.message || 'Saqlashda xatolik.');
    } finally {
      btnSave.disabled = false;
    }
  });

  btnReset?.addEventListener('click', () => {
    setReceiptForm(original);
  });
}

function setReceiptForm(data) {
  document.getElementById('restaurantName').value = data.restaurantName ?? '';
  document.getElementById('address').value = data.address ?? '';
  document.getElementById('phone').value = data.phone ?? '';
  document.getElementById('footerNote').value = data.footerNote ?? '';
}

function getReceiptForm() {
  return {
    restaurantName: (document.getElementById('restaurantName').value || '').trim(),
    address: (document.getElementById('address').value || '').trim(),
    phone: (document.getElementById('phone').value || '').trim(),
    footerNote: (document.getElementById('footerNote').value || '').trim()
  };
}
