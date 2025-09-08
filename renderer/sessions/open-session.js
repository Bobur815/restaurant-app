import { showAlert, showConfirm } from "../../utils/alert.js";
import { categoryOptions } from "../add-load-category.js";
import getMenuItemById from "../getMenuItemById.js";
import { renderMenuItems } from "../orderPageHelpers.js";
import { confirmSession } from "./confirm-session.js"; // POST create
// Agar sizda update API alohida bo'lsa, shu faylga ham oling:
import { updateSession } from "./update-session.js";   // PUT update (quyida yozaman)

const clickSound = new Audio(new URL('../../sounds/mixkit.wav', import.meta.url));
clickSound.preload = 'auto';

window.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(location.search);
    const modeParam = params.get('mode') || 'create';
    const editId = params.get('edit');
    const isEdit = (modeParam === 'edit' && !!editId);

    const productCategory = document.getElementById('productCategory');
    const menuList = document.getElementById('menuList');
    const searchInput = document.getElementById('search-input');
    const createBtn = document.querySelector('.createBtn');
    const orderTableBody = document.getElementById('orderTableBody');

    await categoryOptions(productCategory);

    const updateMenu = async () => {
        const params = {
            category: productCategory.value,
            search: searchInput.value.trim(),
        };
        // open-session rejimida badge ko‘rinmaydi
        await renderMenuItems(params, menuList, { mode: 'open-session', selectProduct });
    };

    // EDIT rejimi: mavjud smenani yuklab jadvalga joylaymiz
    if (isEdit) {
        document.querySelector('.windowTitle').textContent = 'Smena tahrirlash';
        createBtn.textContent = 'Saqlash';
        try {
            const res = await fetch(`http://127.0.0.1:3000/api/session/${editId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const session = await res.json();

            // items ni jadvalga to‘ldirish
            (session.items || []).forEach( async (it) =>  {
                const menuItem = await getMenuItemById(it.menu_id)

                const item = {
                    _id: (it.menu_id?._id ?? it.menu_id),
                    name: menuItem?.name ?? '—',
                    image_url: menuItem.image_url ?? '',
                };
                // quantity = initialQuantity (open-session’da shu kiritilardi)
                selectProduct(item);
                // qiymatni aniq qo‘yib qo‘yamiz
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
    } else {
        createBtn.textContent = 'Smena ochish';
    }

    // Initial load of menu list
    await updateMenu();

    productCategory.addEventListener('change', updateMenu);
    searchInput.addEventListener('input', updateMenu);

    createBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try { clickSound.currentTime = 0; clickSound.play().catch(() => { }); } catch { }

        // 1) Gather items from table
        const items = Array.from(document.querySelectorAll("tr[id^='order-item-']")).map(row => {
            const menu_id = row.id.replace('order-item-', '');
            const qtyStr = row.querySelector('.quantity').value;
            const initialQuantity = parseInt(qtyStr, 10) || 0;
            return { menu_id, initialQuantity };
        });

        if (!items.length) return showAlert("Mahsulot tanlanmagan!");

        // 2) Confirm
        const ok = await showConfirm(isEdit ? "O‘zgartirishlarni saqlaymizmi?" : "Smena ochilishini tasdiqlaysizmi?");
        if (!ok) return;

        // 3) Send
        try {
            if (isEdit) {
                await updateSession(editId, { items });      // ⬅️ PUT update
            } else {
                await confirmSession({ items });             // ⬅️ POST create (mavjud)
            }

            // 4) Parent’ga xabar beramiz va oynani yopamiz
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
            try { clickSound.currentTime = 0; clickSound.play().catch(() => { }); } catch { }
            qtyEl.value = parseInt(qtyEl.value, 10) + 1;
        });
        decBtn.addEventListener('click', () => {
            try { clickSound.currentTime = 0; clickSound.play().catch(() => { }); } catch { }
            const q = parseInt(qtyEl.value, 10);
            if (q > 1) qtyEl.value = q - 1;
        });
        deleteBtn.addEventListener('click', () => {
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
        const idxCell = tr.querySelector('.index');
        idxCell.textContent = i + 1;
    });
}
