import { showAlert, showConfirm } from "../../utils/alert.js";
import { formatYMD } from "../../utils/setReportDate.js";
import { getOrderByQuery } from "../getOrderByQuery.js";
import { getOrdersOfTable } from "../ordersOfTable.js";
import { friendlyDayLabel, setDateHeader } from "./setDateHeader.js";

const clickSound = new Audio(new URL('../../sounds/mixkit.wav', import.meta.url));
clickSound.preload = 'auto';

// ---- Config / helpers -------------------------------------------------------
const API_BASE = 'http://localhost:3000/api';
const JSON_HEADERS = { 'Accept': 'application/json' };

const q = (sel) => document.querySelector(sel);
const byId = (id) => document.getElementById(id);

const setLoadingRow = (tbody, text = '⏳ Yuklanmoqda...') => {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="10">${text}</td></tr>`;
};

const setEmptyRow = (tbody, text = '📭 Maʼlumot topilmadi') => {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="10">${text}</td></tr>`;
};

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: JSON_HEADERS, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiDelete(path) {

  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: JSON_HEADERS, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    body,
    method: 'PUT',
    headers: JSON_HEADERS,
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json()
}

// ---- Data -------------------------------------------------------------------
export async function renderAllSessions(filter = {}) {
  const query = new URLSearchParams(filter).toString();
  const path = query ? `/session?${query}` : `/session`;

  const payload = await apiGet(path);

  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function getOpenSessionId() {
  const open = await renderAllSessions({ status: 'open' });
  if (!Array.isArray(open) || open.length === 0) return null;
  return open[0]?._id ?? null;
}


function groupSessionsByDay(sessions = []) {

  const sorted = [...sessions].sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );

  // { 'YYYY-MM-DD': { sessions: [...], items: [...], times: [Date,...] } }
  const map = new Map();

  for (const s of sorted) {
    const created = new Date(s.createdAt);
    const dayKey = formatYMD(created, false);
    const items = Array.isArray(s.items) ? s.items : [];

    if (!map.has(dayKey)) {
      map.set(dayKey, { sessions: [], items: [], times: [] });
    }
    const box = map.get(dayKey);
    box.sessions.push(s);
    box.items.push(...items);
    box.times.push(created);
  }

  return map;
}

/**
 * Sana bo‘yicha filterlash (createdAt ni ishlatamiz)
 */
function initOpenDateFilter(allSessions, selectEl, onChange) {
  if (!selectEl) return;

  const dates = Array.from(
    new Set(
      (allSessions || [])
        .map((s) => (s.createdAt || '').slice(0, 10))
        .filter(Boolean)
    )
  ).sort();

  selectEl.innerHTML =
    `<option value="">Hammasi</option>` +
    dates.map((d) => `<option value="${d}">${d}</option>`).join('');

  selectEl.onchange = () => {
    const date = selectEl.value;
    const filtered = date
      ? (allSessions || []).filter((s) => (s.createdAt || '').startsWith(date))
      : allSessions;
    onChange(filtered || []);
  };
}

// ---- Page controller --------------------------------------------------------
export async function loadSessionsPage() {
  const openListEl = byId('openSessionList');
  const closedListEl = byId('closedSessionList');
  const openSessionBtn = byId('session-open-btn');
  const openDateFilter = byId('open-date-of-session');
  const deleteBtn = q('.delete-btn');
  const closeBtn = q('.session-close-btn');
  const editBtn = q('.edit-btn');
  const openDateHeaderTr = byId('openSessionDate');
  const closeDateHeaderTr = byId('closeSessionDate');

  // Loaderlar
  setLoadingRow(openListEl);
  setLoadingRow(closedListEl);

  if (closeBtn) {
    closeBtn.onclick = async (e) => {
      e.preventDefault()
      try {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => { });
      } catch { }

      try {
        const sessionId = await getOpenSessionId();
        if (!sessionId) return showAlert("❌ Ochiq Smena topilmadi!");

        const orders = await getOrderByQuery({ status: "pending" })

        if (orders) {
          return showAlert('🚫 Tugallanmagan buyurtma mavjud!')
        }

        const ok = typeof showConfirm === 'function'
          ? await showConfirm("Smenani yopishni tasdiqlaysizmi?")
          : confirm("Smenani yopishni tasdiqlaysizmi?");
        if (!ok) return;

        const payload = await apiPut(`/session/close/${sessionId}`);
        await showAlert("✅ Smena yopildi");

      } catch (error) {
        console.error(error);
        showAlert("❌ Smenani yopishda xatolik yuz berdi");
      }
      finally {
        // yangilash
        await refreshLists(openListEl, closedListEl, openDateFilter, openDateHeaderTr, closeDateHeaderTr);
      }

    }
  }

  // Edit tugmasi
  if (editBtn) {
    editBtn.onclick = async (e) => {
      e.preventDefault();
      try { clickSound.currentTime = 0; clickSound.play().catch(() => { }); } catch { }
      try {
        const sessionId = await getOpenSessionId();
        if (!sessionId) return showAlert("❌ Ochiq Smena topilmadi!");
        await window.electronAPI.openSessionEditWindow(sessionId);   // ⬅️ tahrirlash oynasini ochish
      } catch (error) {
        console.error(error);
        showAlert("❌ Smenani tahrirlashda xatolik yuz berdi");
      }
    };
  }

  // Open Session tugmasi
  if (openSessionBtn) {
    openSessionBtn.onclick = async (e) => {
      e.preventDefault();
      try { clickSound.currentTime = 0; clickSound.play().catch(() => { }); } catch { }

      const open = await renderAllSessions({ status: 'open' });
      if (open.length) return showAlert("Avval ochiq smenani yoping!");

      await window.electronAPI.openSessionCreateWindow(); // ⬅️ yangi smena oynasi
    };
  }

  // Delete tugmasi
  if (deleteBtn) {
    deleteBtn.onclick = async (e) => {
      e.preventDefault();

      try {
        const sessionId = await getOpenSessionId();
        if (!sessionId) return showAlert("❌ Ochiq Smena topilmadi!");

        const ok = typeof showConfirm === 'function'
          ? await showConfirm("Smenani o‘chirishni tasdiqlaysizmi?")
          : confirm("Smenani o‘chirishni tasdiqlaysizmi?");
        if (!ok) return;

        const payload = await apiDelete(`/session/delete/${sessionId}`);
        await showAlert("✅ Smena O‘chirildi");
      } catch (err) {
        console.error(err);
        showAlert("❌ Smenani o‘chirishda xatolik yuz berdi");
      } finally {
        // yangilash
        await refreshLists(openListEl, closedListEl, openDateFilter, openDateHeaderTr, closeDateHeaderTr);
      }
    };
  }

  const closedContainer = byId('closedSessionsContainer');
  if (closedContainer) {
    closedContainer.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('.closed-delete-btn');
      const prnBtn = e.target.closest('.closed-print-btn');
      if (!delBtn && !prnBtn) return;

      const sessionId = (delBtn || prnBtn).dataset.id;
      if (!sessionId) return;

      if (delBtn) {
        const ok = typeof showConfirm === 'function'
          ? await showConfirm("Yopilgan smenani o‘chirishni tasdiqlaysizmi?")
          : confirm("Yopilgan smenani o‘chirishni tasdiqlaysizmi?");
        if (!ok) return;

        try {
          await apiDelete(`/session/delete/${sessionId}`);
          await showAlert("✅ Smena o‘chirildi");
          await refreshLists(
            byId('openSessionList'),
            byId('closedSessionList'),
            byId('open-date-of-session'),
            byId('openSessionDate'),
            byId('closeSessionDate'),
          );
        } catch (err) {
          console.error(err);
          showAlert("❌ O‘chirishda xatolik yuz berdi");
        }
      }

      if (prnBtn) {
        // Faqat shu card ichidagi jadvalni chop etish
        const card = prnBtn.closest('.session-card');
        if (!card) return;
        const table = card.querySelector('table');
        if (!table) return;

        const html = `
          <html>
            <head>
              <title>Chop etish</title>
              <style>
                body { font-family: Arial, sans-serif; padding: 16px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #ddd; padding: 6px 8px; }
                th { background: #f7f7f7; }
              </style>
            </head>
            <body>
              <h3>${card.querySelector('.session-card__title')?.textContent || 'Smena'}</h3>
              ${table.outerHTML}
              <script>window.print();</script>
            </body>
          </html>
        `;
        const w = window.open('', '_blank');
        if (w) {
          w.document.open();
          w.document.write(html);
          w.document.close();
        }
      }
    });
  }

  // Child “save” qilganda listlarni auto-refresh
  window.electronAPI.onSessionUpdated(async () => {
    await refreshLists(openListEl, closedListEl, openDateFilter, openDateHeaderTr, closeDateHeaderTr);
  });

  // Dastlabki yuklash
  await refreshLists(openListEl, closedListEl, openDateFilter, openDateHeaderTr, closeDateHeaderTr);
}

export async function refreshLists(openListEl, closedListEl, openDateFilter, openDateHeaderTr, closeDateHeaderTr) {
  try {
    const sessions = await renderAllSessions();

    if (!Array.isArray(sessions) || sessions.length === 0) {
      setEmptyRow(openListEl, '📭 Smenalar topilmadi');
      // closedListEl endi ishlatilmaydi; containerga yozamiz
      const closedContainer = byId('closedSessionsContainer');
      if (closedContainer) closedContainer.innerHTML = `<div class="empty">📭 Smenalar topilmadi</div>`;
      return;
    }

    const openSessions = sessions.filter((s) => s.status === 'open');
    const closedSessions = sessions.filter((s) => s.status === 'closed');

    // Ochiq smenalarni eski jadval formatida ko‘rsatamiz
    renderSessionRowsGrouped(openSessions, openListEl, openDateHeaderTr);

    // Yopilgan smenalarni card/table ko‘rinishida ko‘rsatamiz
    const closedContainer = byId('closedSessionsContainer');
    renderClosedSessionsAsTables(closedSessions, closedContainer, closeDateHeaderTr);

    // Filtr (xohishga ko‘ra: yopilganlar uchun ham, ochiq uchun ham)
    initOpenDateFilter(closedSessions, openDateFilter, (filtered) => {
      const container = byId('closedSessionsContainer');
      renderClosedSessionsAsTables(filtered, container, closeDateHeaderTr);
    });
  } catch (err) {
    console.error(err);
    showAlert("❌ Smenalarni yuklashda xatolik yuz berdi");
    setEmptyRow(openListEl, '❌ Yuklab bo‘lmadi');
    const closedContainer = byId('closedSessionsContainer');
    if (closedContainer) closedContainer.innerHTML = `<div class="empty">❌ Yuklab bo‘lmadi</div>`;
  }
}



function renderSessionRowsGrouped(sessions, tbody, headerTr) {
  if (!tbody) return;
  tbody.innerHTML = '';

  // Umumiy header (thead)
  setDateHeader(headerTr, sessions, 6);

  // Guruhlash
  const grouped = groupSessionsByDay(sessions);
  const dayKeys = Array.from(grouped.keys()).sort(); // ko‘tarilish tartibi

  let rowIndex = 1;
  const frag = document.createDocumentFragment();
  let hasRows = false;

  if (dayKeys.length === 0) {
    setEmptyRow(tbody, '📭 Hech narsa yo‘q');
    return;
  }

  for (const day of dayKeys) {
    const box = grouped.get(day);
    const items = Array.isArray(box.items) ? box.items : [];

    if (items.length === 0) continue;

    hasRows = true;

    // O‘sha kunning itemlari
    for (const item of items) {
      const menu = item.menu_id || {};
      const initial = Number(item.initialQuantity || 0);
      const sold = Number(item.soldQuantity || 0);
      const remain = initial - sold;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${rowIndex++}</td>
        <td>
          <img
            src="../img/${menu.image_url || 'placeholder.png'}"
            alt="${menu.name || ''}"
            width="40" height="40"
            style="border-radius:5px;"
          >
        </td>
        <td>${menu.name || '-'}</td>
        <td>${initial}</td>
        <td>${sold}</td>
        <td>${remain}</td>
      `;
      frag.appendChild(tr);
    }

  }

  if (!hasRows) {
    setEmptyRow(tbody, '📭 Hech narsa yo‘q');
    return;
  }

  tbody.appendChild(frag);
}


function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.entries(v).forEach(([dk, dv]) => node.dataset[dk] = dv);
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(ch => {
    if (typeof ch === 'string') node.appendChild(document.createTextNode(ch));
    else if (ch) node.appendChild(ch);
  });
  return node;
}

function buildSessionCard(session, index) {
  const created = new Date(session.createdAt);
  const day = formatYMD(created, false);
  const time = created.toLocaleTimeString('uz-Uz', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const items = Array.isArray(session.items) ? session.items : [];

  // Card container
  const card = el('div', { class: 'session-card' });

  // Card header
  const header = el('div', { class: 'session-card__header' }, [
    el('div', { class: 'session-card__title' }, `#${index} — ${friendlyDayLabel(day)} | ${time}`)
  ]);

  // Table
  const table = el('table', { class: 'session-table session-table--mini' });
  const thead = el('thead', {}, [
    el('tr', {}, [
      el('th', {}, '№'),
      el('th', {}, 'Rasm'),
      el('th', {}, 'Nomi'),
      el('th', {}, "Boshlang'ich soni"),
      el('th', {}, 'Sotilgani'),
      el('th', {}, 'Qoldiq'),
    ])
  ]);
  const tbody = el('tbody');

  let row = 1;
  for (const item of items) {
    const menu = item.menu_id || {};
    const initial = Number(item.initialQuantity || 0);
    const sold = Number(item.soldQuantity || 0);
    const remain = initial - sold;

    const tr = el('tr', {}, [
      el('td', {}, String(row++)),
      el('td', {}, el('img', {
        src: `../img/${menu.image_url || 'placeholder.png'}`,
        alt: menu.name || '',
        width: '40',
        height: '40',
        style: 'border-radius:5px; object-fit:cover;'
      })),
      el('td', {}, menu.name || '-'),
      el('td', {}, String(initial)),
      el('td', {}, String(sold)),
      el('td', {}, String(remain)),
    ]);

    tbody.appendChild(tr);
  }

  table.appendChild(thead);
  table.appendChild(tbody);

  // Card footer (actions)
  const footer = el('div', { class: 'session-card__footer' }, [
    el('button', {
      class: 'delete-btn closed-delete-btn',
      dataset: { id: session._id }
    }, '🗑️ O‘chirish'),
    el('button', {
      class: 'print-btn closed-print-btn',
      dataset: { id: session._id }
    }, '🖨️ Chop etish'),
  ]);

  card.appendChild(header);
  card.appendChild(table);
  card.appendChild(footer);
  return card;
}

function renderClosedSessionsAsTables(closedSessions, containerEl, headerTr) {
  if (!containerEl) return;

  // header (umumiy)
  setDateHeader(headerTr, closedSessions, 6);

  containerEl.innerHTML = '';
  if (!Array.isArray(closedSessions) || closedSessions.length === 0) {
    containerEl.innerHTML = `<div class="empty">📭 Yopilgan smenalar yo‘q</div>`;
    return;
  }

  // Sana bo‘yicha tushish tartibida
  const sorted = [...closedSessions].sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );

  let i = 1;
  const frag = document.createDocumentFragment();
  for (const s of sorted) {
    frag.appendChild(buildSessionCard(s, i++));
  }
  containerEl.appendChild(frag);
}
