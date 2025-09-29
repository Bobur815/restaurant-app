import { showAlert, showConfirm } from "../../utils/alert.js";
import { withActionAnimation } from "../../utils/loadAnimation.js";
import { categoryOptions } from "../add-load-category.js";
import getMenuItemById from "../getMenuItemById.js";
import { renderMenuItems } from "../orderPageHelpers.js";
import { confirmSession } from "./confirm-session.js";
import { getResiduals } from "./getResiduals.js";
import { addOrMergeRowFromResidual, unwrapResidualItems } from "./handleResiduals.js";
import { updateSession } from "./update-session.js";

const clickSound = new Audio(new URL('../../sounds/mixkit.wav', import.meta.url));
clickSound.preload = 'auto';


function flashRow(tr) {
    tr.classList.remove('flash');
    tr.offsetHeight;
    tr.classList.add('flash');
}

window.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(location.search);
    const modeParam = params.get('mode') || 'create';
    const editId = params.get('edit');      // /?mode=edit&edit=<id>
    const closeId = params.get('sessionId'); // /?mode=close&sessionId=<id>
    const isEdit = (modeParam === 'edit' && !!editId);
    const isClose = (modeParam === 'close' && !!closeId);

    const productCategory = document.getElementById('productCategory');
    const menuList = document.getElementById('menuList');
    const searchInput = document.getElementById('search-input');
    const createBtn = document.querySelector('.createBtn');
    const orderTableBody = document.getElementById('orderTableBody');
    const menuSidebar = document.querySelector('.menu-sidebar')

    // Bu elementlar bo'lmasa ham xatoga tushmaslik uchun tekshiruv
    const filtersWrap = document.querySelector('.filters-wrap') || null;
    const bulkActions = document.getElementById('bulk-actions') || null;
    if (bulkActions) bulkActions.style.display = 'none';

    // --- Yordamchilar ---
    const hideEl = (el) => {
        if (el) el.classList.add('hidden');
    };
    const showEl = (el) => { if (el) el.classList.remove('hidden'); };

    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

    function setRadioFromNumbers(tr) {
        const id = tr.dataset.menuId;
        const rem = Number(tr.dataset.remaining || 0);
        const carry = Number(tr.querySelector('.qty-carry')?.value || 0);
        const write = Number(tr.querySelector('.qty-writeoff')?.value || 0);
        const rCarry = tr.querySelector(`input[name="act-${id}"][value="CARRY_TO_NEXT"]`);
        const rWO = tr.querySelector(`input[name="act-${id}"][value="WRITE_OFF"]`);

        if (!rCarry || !rWO) return;

        if (carry === rem && write === 0) {
            rCarry.checked = true; rWO.checked = false;
        } else if (write === rem && carry === 0) {
            rCarry.checked = false; rWO.checked = true;
        } else {
            // custom split => no radio selected
            rCarry.checked = false; rWO.checked = false;
        }
    }

    function onQtyInput(tr, changed /* 'carry' | 'write' */) {
        const rem = Number(tr.dataset.remaining || 0);
        const carryEl = tr.querySelector('.qty-carry');
        const writeEl = tr.querySelector('.qty-writeoff');
        if (!carryEl || !writeEl) return;

        let carry = Number(carryEl.value || 0);
        let write = Number(writeEl.value || 0);

        if (changed === 'carry') {
            carry = clamp(carry, 0, rem);
            write = rem - carry;
        } else {
            write = clamp(write, 0, rem);
            carry = rem - write;
        }

        carryEl.value = carry;
        writeEl.value = write;

        setRadioFromNumbers(tr);
        updateTotals();
    }

    function updateTotals() {
        let totalRem = 0, totalCarry = 0, totalWrite = 0;
        orderTableBody.querySelectorAll('tr').forEach(tr => {
            const rem = Number(tr.dataset.remaining || 0);
            const carry = Number(tr.querySelector('.qty-carry')?.value || 0);
            const write = Number(tr.querySelector('.qty-writeoff')?.value || 0);
            totalRem += rem; totalCarry += carry; totalWrite += write;
        });
        const elR = document.getElementById('total-remaining');
        const elC = document.getElementById('total-carry');
        const elW = document.getElementById('total-writeoff');
        if (elR) elR.textContent = String(totalRem);
        if (elC) elC.textContent = String(totalCarry);
        if (elW) elW.textContent = String(totalWrite);
    }

    function attachRowListeners(tr, id) {
        // radio defaulting (quick full-assign)
        tr.addEventListener('change', () => {
            flashRow(tr);
            const rem = Number(tr.dataset.remaining || 0);
            const act = tr.querySelector(`input[name="act-${id}"]:checked`)?.value;
            const carryEl = tr.querySelector('.qty-carry');
            const writeEl = tr.querySelector('.qty-writeoff');
            if (!carryEl || !writeEl) return;

            if (act === 'CARRY_TO_NEXT') {
                carryEl.value = rem; writeEl.value = 0;
            } else if (act === 'WRITE_OFF') {
                writeEl.value = rem; carryEl.value = 0;
            }
            updateTotals();
        });

        // split-friendly inputs
        const carryEl = tr.querySelector('.qty-carry');
        const writeEl = tr.querySelector('.qty-writeoff');
        carryEl?.addEventListener('input', () => onQtyInput(tr, 'carry'));
        writeEl?.addEventListener('input', () => onQtyInput(tr, 'write'));
    }

    function collectClosePayload() {
        const actions = [];
        const errors = [];

        orderTableBody.querySelectorAll('tr').forEach(tr => {
            const menu_id = tr.dataset.menuId;
            const rem = Number(tr.dataset.remaining || 0);
            const carry = Number(tr.querySelector('.qty-carry')?.value || 0);
            const write = Number(tr.querySelector('.qty-writeoff')?.value || 0);

            if (rem === 0) return; // nothing to do

            // Validate per-row
            if (carry < 0 || write < 0 || carry + write !== rem) {
                errors.push(menu_id);
                tr.classList.add('row-error');
            } else {
                tr.classList.remove('row-error');
                actions.push({ menu_id, carry_to_next_qty: carry, write_off_qty: write });
            }
        });

        return { actions, errors };
    }

    if (modeParam === 'create') {
        const residuals = await getResiduals({ action: 'CARRY_TO_NEXT', status: 'pending', limit: 500 });
        const items = unwrapResidualItems(residuals).filter(r => r.action === 'CARRY_TO_NEXT' && r.status === 'pending');

        if (items.length) {
            for (const r of items) {
                await addOrMergeRowFromResidual({ menu_id: (r.menu_id?._id ?? r.menu_id), quantity: r.quantity - 1 || 0 });
            }
            await showAlert(`Oldingi smenadan ${items.length} ta mahsulotning qoldiqlari qo'shildi`);
        }
    }

    // Kategoriyalar (faqat create/edit rejimida kerak)

    if (!isClose) {

        await categoryOptions(productCategory);
    }

    // Menyuni yangilash (faqat create/edit uchun)
    const updateMenu = async () => {
        if (isClose) return; // close rejimida menyu ko‘rsatmaymiz
        const q = {
            category: productCategory?.value,
            search: (searchInput?.value || '').trim(),
        };
        // open-session rejimida badge ko‘rinmaydi
        await renderMenuItems(q, menuList, { mode: 'open-session', selectProduct });
    };

    // --------- REJIM TITLLAR / TUGMA MATNI ----------
    if (isEdit) {
        document.querySelector('.windowTitle').textContent = 'Smena tahrirlash';
        createBtn.textContent = 'Saqlash';
    } else if (isClose) {
        document.querySelector('.windowTitle').textContent = 'Smena yopish';
        createBtn.textContent = 'Yopish';
        menuSidebar.style.display = 'none'
        if (filtersWrap) hideEl(filtersWrap);
        // Jadval sarlavhasiga 2 ta ustun qo‘shishni unutmang (HTMLda thead ga qo‘shilgan bo‘lishi kerak),
        // yoki dinamik qo‘shamiz (quyida rowlarda <td> larni to‘ldiramiz).
    } else {
        createBtn.textContent = 'Smena ochish';
    }

    // --------- EDIT rejimi: mavjud smenani yuklaymiz (initialQuantity ni qo‘yish) ----------
    if (isEdit) {
        try {
            const res = await fetch(`http://127.0.0.1:3000/api/session/${editId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const session = await res.json();

            (session.items || []).forEach(async (it) => {
                const menuItem = await getMenuItemById(it.menu_id);
                const item = {
                    _id: (it.menu_id?._id ?? it.menu_id),
                    name: menuItem?.name ?? '—',
                    image_url: menuItem?.image_url ?? '',
                };
                // create/edit rejimida item qo‘shish:
                selectProduct(item);
                // qiymatni aniq qo‘yish
                const row = document.getElementById(`order-item-${item._id}`);
                if (row) {
                    const qtyEl = row.querySelector('.quantity');
                    qtyEl.value = parseInt(it.initialQuantity || 1, 10);
                }
            });
        } catch (err) {
            console.error('Load session for edit error:', err);
            showAlert('Smenani yuklashda xatolik.');
        }
    }

    // --------- CLOSE rejimi: mavjud smenani yuklaymiz va qoldiq aksiyasi tanlash UI ----------
    if (isClose) {
        if (bulkActions) bulkActions.style.display = 'flex';
        try {
            const headTr = document.querySelector('.headTr')

            const res = await fetch(`http://127.0.0.1:3000/api/session/${closeId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const session = await res.json();

            // (inside isClose block, after you fetched the session)
            headTr.innerHTML = `
            <th class="index" style="font-weight:bold;">#</th>
            <th class="cell-image">Rasm</th>
            <th class="cell-name">Mahsulot</th>
            <th class="cell-initial">Boshlang‘ich</th>
            <th class="cell-sold">Sotilgan</th>
            <th class="cell-remaining">Qoldiq</th>
            <th class="cell-carry">Keyingi smenaga</th>
            <th class="cell-writeoff">Chiqimga</th>
            `;

            // Jadvalni qoldiqlar bilan to‘ldiramiz:
            // Mahsulot | Boshlang‘ich | Sotilgan | Qoldiq | Keyingi smenaga | Chiqimga
            orderTableBody.innerHTML = '';
            let ind = 1;

            for (const it of (session.items || [])) {
                const menuItem = await getMenuItemById(it.menu_id);
                const name = menuItem?.name ?? '—';
                const id = (it.menu_id?._id ?? it.menu_id);

                const initial = Number(it.initialQuantity || 0);
                const sold = Number(it.soldQuantity || 0);
                const remaining = Math.max(0, initial - sold);

                const tr = document.createElement('tr');
                tr.id = `close-item-${id}`;
                tr.dataset.menuId = id;
                tr.dataset.remaining = String(remaining);

                tr.innerHTML = `
    <td class="index" style="font-weight:bold;">${ind++}</td>
    <td class="cell-image"><img src="../img/${menuItem?.image_url ?? ''}" alt="${name}" width="60" height="60" style="border-radius:5px;"/></td>
    <td class="cell-name">${name}</td>
    <td class="cell-initial">${initial}</td>
    <td class="cell-sold">${sold}</td>
    <td class="cell-remaining"><strong>${remaining}</strong></td>

    <td class="cell-carry">
      <label class="option-card ${remaining === 0 ? 'disabled' : ''}">
        <input type="radio" name="act-${id}" value="CARRY_TO_NEXT" ${remaining > 0 ? 'checked' : ''} ${remaining === 0 ? 'disabled' : ''}/>
        <span class="label-text">➡️ O‘tkazish</span>
      </label>
      <input type="number" class="quantity qty-carry" min="0" max="${remaining}" value="${remaining}" ${remaining === 0 ? 'disabled' : ''}/>
    </td>

    <td class="cell-writeoff">
      <label class="option-card ${remaining === 0 ? 'disabled' : ''}">
        <input type="radio" name="act-${id}" value="WRITE_OFF" ${remaining === 0 ? 'disabled' : ''}/>
        <span class="label-text">🗑️ Chiqim</span>
      </label>
      <input type="number" class="quantity qty-writeoff" min="0" max="${remaining}" value="0" ${remaining === 0 ? 'disabled' : ''}/>
    </td>
  `;

                orderTableBody.appendChild(tr);

                // attach listeners for split & totals
                attachRowListeners(tr, id);
            }

            // show and initialize bulk bar
            const bulkBar = document.getElementById('bulk-actions');
            if (bulkBar) {
                showEl(bulkBar);
                const btnAllCarry = bulkBar.querySelector('.btn-all-carry');
                const btnAllWriteOff = bulkBar.querySelector('.btn-all-writeoff');

                function setBulkActive(which /* 'carry' | 'writeoff' | null */) {
                    const btnAllCarry = bulkBar.querySelector('.btn-all-carry');
                    const btnAllWriteOff = bulkBar.querySelector('.btn-all-writeoff');

                    btnAllCarry?.classList.toggle('active', which === 'carry');
                    btnAllWriteOff?.classList.toggle('active', which === 'writeoff');

                    btnAllCarry?.setAttribute('aria-pressed', String(which === 'carry'));
                    btnAllWriteOff?.setAttribute('aria-pressed', String(which === 'writeoff'));
                }

                btnAllCarry?.addEventListener('click', () => {
                    orderTableBody.querySelectorAll('tr').forEach(tr => {
                        const rem = Number(tr.dataset.remaining || 0);
                        const id = tr.dataset.menuId;
                        const rCarry = tr.querySelector(`input[name="act-${id}"][value="CARRY_TO_NEXT"]`);
                        const carryEl = tr.querySelector('.qty-carry');
                        const writeEl = tr.querySelector('.qty-writeoff');
                        if (rem > 0 && rCarry && carryEl && writeEl) {
                            rCarry.checked = true;
                            carryEl.value = rem; writeEl.value = 0;
                        }
                    });
                    updateTotals();
                    setBulkActive('carry');   // <-- qo‘shildi
                });

                btnAllWriteOff?.addEventListener('click', () => {
                    orderTableBody.querySelectorAll('tr').forEach(tr => {
                        const rem = Number(tr.dataset.remaining || 0);
                        const id = tr.dataset.menuId;
                        const rWO = tr.querySelector(`input[name="act-${id}"][value="WRITE_OFF"]`);
                        const carryEl = tr.querySelector('.qty-carry');
                        const writeEl = tr.querySelector('.qty-writeoff');
                        if (rem > 0 && rWO && carryEl && writeEl) {
                            rWO.checked = true;
                            writeEl.value = rem; carryEl.value = 0;
                        }
                    });
                    updateTotals();
                    setBulkActive('writeoff'); // <-- qo‘shildi
                });

                orderTableBody.addEventListener('input', () => setBulkActive(null));
                orderTableBody.addEventListener('change', () => setBulkActive(null));

                /* boshlang‘ich holat */
                setBulkActive(null);

                // do an initial totals pass
                updateTotals();
            }

        } catch (err) {
            console.error('Load session for close error:', err);
            showAlert('Smenani yuklashda xatolik.');
        }
    }

    // --- Initial load of menu list (faqat create/edit uchun) ---
    await updateMenu();
    productCategory?.addEventListener('change', updateMenu);
    searchInput?.addEventListener('input', updateMenu);

    // --- CREATE / EDIT / CLOSE tugmasi ---
    createBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try { clickSound.currentTime = 0; clickSound.play().catch(() => { }); } catch { }

        // Tasdiqlash
        const ok = await showConfirm(isEdit ? "O‘zgartirishlarni saqlaymizmi?" : isClose ? "Smena yopilishini tasdiqlaysizmi?" : "Smena ochilishini tasdiqlaysizmi?");
        if (!ok) return;

        if (isClose) {

            const { actions, errors } = collectClosePayload();

            if (errors.length) {
                showAlert('Iltimos, qizil chiziq bilan belgilangan qatorlarda (carry + chiqim) yig‘indisi qoldiq bilan teng bo‘lishi kerak.');
                return;
            }

            try {
                const payload = { actions };
                const resp = await withActionAnimation(
                    () => fetch(`http://127.0.0.1:3000/api/session/close/${closeId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    }),
                    { type: 'close', title: 'Smena yopilmoqda…', icon: '🔒' }
                );
                const data = await resp.json();
                if (!resp.ok) throw new Error(data?.message || `HTTP ${resp.status}`);

                await showAlert('Smena muvaffaqiyatli yopildi ✅');
                // TODO: refresh parent + close window if desired
                window.electronAPI.emitSessionUpdated();
                window.close();
            } catch (e) {
                console.error('Close session error:', e);
                await showAlert(e.message || 'Smena yopishda xatolik');
            }
            return;
        }

        // CREATE / EDIT rejimi:
        // 1) Gather items from table
        const items = Array.from(document.querySelectorAll("tr[id^='order-item-']")).map(row => {
            const menu_id = row.id.replace('order-item-', '');

            const qtyEl = row.querySelector('.quantity');
            // .value mavjud bo'lmasa .textContent dan olamiz; vergulni nuqtaga aylantiramiz
            const raw = (qtyEl?.value ?? qtyEl?.textContent ?? '0').toString().replace(',', '.');

            // kasrni saqlab qolish
            let initialQuantity = parseFloat(raw);
            if (!Number.isFinite(initialQuantity)) initialQuantity = 0;

            // manfiy bo'lmasin va 3 xonagacha yaxlitlaymiz (kg uchun qulay)
            initialQuantity = Math.max(0, Math.round(initialQuantity * 1000) / 1000);

            return { menu_id, initialQuantity };
        });



        if (!items.length) return showAlert("Mahsulot tanlanmagan!");

        // 3) Send
        try {
            if (isEdit) {
                await updateSession(editId, { items });      // ⬅️ PUT update
            } else {
                await confirmSession({ items });             // ⬅️ POST create (mavjud)
            }

            window.electronAPI.emitSessionUpdated();
            window.close();
        } catch (err) {
            console.error('Save error:', err);
            showAlert("Saqlashda xatolik yuz berdi.");
        }
    });
});


/**
 * Jadvalga item qo‘shish (sizda bor) – o‘zgartirmadik
 */
export function selectProduct(item) {
    return new Promise(resolve => {
        const tableBody = document.getElementById('orderTableBody');

        const existing = document.getElementById(`order-item-${item._id}`);
        if (existing) {
            const qtyEl = existing.querySelector('.quantity');
            qtyEl.value = parseInt(qtyEl.value, 10) + 1;
            updateRowNumbers();
            return resolve();
        }

        const row = document.createElement('tr');
        row.id = `order-item-${item._id}`;
        row.innerHTML = `
      <td class="index" style="font-weight: bold;"></td>
      <td>
        <img src="../img/${item.image_url || ''}" alt="${item.name}" width="60" height="60" style="border-radius:5px;">
      </td>
      <td class="name" style="font-size: 18px; font-weight:bold;">${item.name}</td>
      <td>
        <button class="decrement">−</button>
        <input type="number" class="quantity">
        <button class="increment">+</button>
      </td>
      <td>
        <button class="delete-btn">❌</button>
      </td>
    `;
        tableBody.appendChild(row);

        const qtyEl = row.querySelector('.quantity');
        const decBtn = row.querySelector('.decrement');
        const incBtn = row.querySelector('.increment');
        const deleteBtn = row.querySelector('.delete-btn');

        qtyEl.value = 1;

        incBtn.addEventListener('click', () => {
            flashRow(row);
            try { clickSound.currentTime = 0; clickSound.play().catch(() => { }); } catch { }
            qtyEl.value = parseInt(qtyEl.value, 10) + 1;
        });
        decBtn.addEventListener('click', () => {
            flashRow(row);
            try { clickSound.currentTime = 0; clickSound.play().catch(() => { }); } catch { }
            const q = parseInt(qtyEl.value, 10);
            if (q > 1) qtyEl.value = q - 1;
        });
        deleteBtn.addEventListener('click', () => {
            flashRow(row);
            try { clickSound.currentTime = 0; clickSound.play().catch(() => { }); } catch { }
            row.remove();
            updateRowNumbers();
        });

        updateRowNumbers();
        resolve();
    });
}

function updateRowNumbers() {
    const tableBody = document.getElementById('orderTableBody');
    tableBody.querySelectorAll('tr').forEach((tr, i) => {
        flashRow(tr);
        const idxCell = tr.querySelector('.index');
        idxCell.textContent = i + 1;
    });
}
