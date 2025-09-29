import submitOrder from "./submitOrder.js"
import { loadOrderPage } from "./order_items.js";
import { getOrderByQuery } from "./getOrderByQuery.js";
import { showAlert, showConfirm } from "../utils/alert.js";
import { renderAllSessions } from "./sessions/render.sessions.js";
import { selectProduct } from "./order_items.js";

const clickSound = new Audio('../sounds/mixkit.wav');
clickSound.preload = 'auto';

// Extracted helper: Render the tables
function renderTables(table_count, table_number, payBtn, cancelBtn, getOrdersOfTable, selectTable, goingBack) {
    const tableGrid = document.getElementById('tableGrid');
    tableGrid.textContent = "";

    for (let i = 1; i <= table_count + 1; i++) {
        if (i === table_count + 1) {
            const addBox = document.createElement('div');
            addBox.classList.add('add-table-box');
            addBox.innerHTML = `Qo'shish <img src="../img/white_add_icon.png" />`;
            addBox.addEventListener('click', () => {
                table_count += 1;
                localStorage.setItem('table_count', table_count);
                loadOrderPage(table_count)
            });
            tableGrid.appendChild(addBox);

            const deleteBox = document.createElement('div');
            deleteBox.classList.add('delete-table-box');
            deleteBox.innerHTML = `Oxirgini o'chirish <img src="../img/delete-icon.png" />`;
            deleteBox.addEventListener('click', (e) => {
                clickSound.currentTime = 0;
                clickSound.play().catch(() => {/*ignore*/ });
                e.stopPropagation();
                if (tableGrid.children[table_count - 1].classList.contains('busy')) {
                    return alert("Bu stolda buyurtma mavjud!");
                }
                if (table_count > 1) {
                    tableGrid.removeChild(tableGrid.children[table_count - 1]);
                    table_count -= 1;
                    localStorage.setItem('table_count', table_count);
                    loadOrderPage(table_count)
                } else {
                    alert("Bitta ham stol qolmadi!");
                }
            });
            tableGrid.appendChild(deleteBox);
        } else {
            const table = document.createElement('div');
            table.classList.add('table-box');
            table.textContent = `${i} - Stol`;

            getOrdersOfTable(i).then(orders => {
                if (orders.length) {
                    table.classList.toggle('busy');
                    payBtn.disabled = false;
                    cancelBtn.disabled = false;
                }
            });

            table.addEventListener('click', () => {
                clickSound.currentTime = 0;
                clickSound.play().catch(() => {/*ignore*/ });
                document.querySelector('.table-wrapper').style.display = 'none';
                document.querySelector(".container").style.display = 'flex';

                selectTable(i);
            });

            tableGrid.appendChild(table);
        }
    }
}

// orderPageHelpers.js
async function renderMenuItems(params, menuList, opts = {}) {
    const { category = 'all', search = '' } = params;
    const {
        mode = 'order',                 // 'order' | 'open-session'
        payBtn = null,
        selectProduct = null,
    } = opts;

    const query = new URLSearchParams({ category, search }).toString();
    const url = `http://localhost:3000/api/menu?${query}`;

    // Faqat 'order' rejimida qolgan miqdorlarni hisoblaymiz
    const remainByMenuId = new Map();

    if (mode === 'order') {
        const sessions = (await renderAllSessions({ status: 'open' })) || [];
        if (!sessions.length) {
            return showAlert('❌ Ochiq smena topilmadi!');
        }
        // Eng yangi ochiq smenani tanlaymiz
        const active = [...sessions].sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        )[0];

        if (active.items?.length) {
            for (const it of active.items) {
                const id = it.menu_id?._id ?? it.menu_id;
                const initial = Number(it.initialQuantity || 0);
                const sold = Number(it.soldQuantity || 0);
                const remain = Math.max(0, initial - sold);
                remainByMenuId.set(id, { remain, initial, sold });
            }
        }
    }

    const qtyBadgeStyle = (n) => {
        let bg = '#ef4444'; // red-500
        if (n > 10) bg = '#22c55e';      // green-500
        else if (n > 0) bg = '#f59e0b';  // amber-500
        return `
      display:inline-flex;align-items:center;justify-content:center;
      min-width:42px;height:28px;padding:0 10px;border-radius:20px;
      font-weight:600;color:#111;background:${bg};
      box-shadow:0 1px 2px rgba(0,0,0,.08);
    `;
    };

    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.error('Failed to load menu:', res.status, await res.text());
            return;
        }

        const menuItems = await res.json();
        menuList.innerHTML = '';

        menuItems.forEach(item => {
            const stat = remainByMenuId.get(item._id) || null;
            const remain = stat?.remain ?? null;
            const initial = stat?.initial ?? 0;
            const sold = stat?.sold ?? 0;

            const li = document.createElement('li');
            li.style.cssText = `
        display:flex;align-items:center;justify-content:space-between;
        gap:12px;padding:10px;border-bottom:1px solid #eee;cursor:pointer;
        border-radius:8px;transition:background .15s ease;
      `;

            // 'order' rejimida qolmagan bo‘lsa disable feel
            if (mode === 'order' && remain === 0) {
                li.style.opacity = '0.6';
                li.style.cursor = 'not-allowed';
            }

            li.onmouseenter = () => (li.style.background = '#f3f4f6');
            li.onmouseleave = () => (li.style.background = 'transparent');

            // Title (tooltip)
            if (mode === 'order') {
                li.title = (remain != null)
                    ? `Boshlang'ich: ${initial} | Sotilgan: ${sold} | Qolgan: ${remain}`
                    : `Bu mahsulot joriy smenaga kiritilmagan`;
            } else {
                li.title = `Yangi smena uchun mahsulot tanlang`;
            }

            // O‘ng tomondagi blok: 'order' rejimida badge ko‘rinadi, 'open-session' da ko‘rinmaydi
            const rightBlockHTML = (mode === 'order')
                ? (remain != null
                    ? `<span style="${qtyBadgeStyle(remain)}">${remain} ${item.soldByWeight ? 'kg' : ''}</span>`
                    : `<span style="
                 font-size:12px;color:#6b7280;border:1px dashed #d1d5db;
                 padding:4px 8px;border-radius:12px;">0</span>`)
                : ''; // open-session -> badge yo‘q

            li.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <img
            src="../img/${item.image_url}"
            alt="${item.name}"
            width="40" height="40"
            style="vertical-align:middle;border-radius:6px;object-fit:cover;border:1px solid #e5e7eb;"
          >
          <span style="font-size:18px;font-weight:700;">${item.name}</span>
        </div>
        <div>${rightBlockHTML}</div>
      `;

            li.addEventListener('click', () => {
                // 'order' rejimida qolmagan bo‘lsa tanlanmaydi
                if (mode === 'order' && !remain) return;

                if (typeof clickSound !== 'undefined') {
                    clickSound.currentTime = 0;
                    clickSound.play().catch(() => { });
                }

                if (mode === 'order' && payBtn) {
                    payBtn.disabled = true;
                }

                if (selectProduct) {
                    if (mode === 'order') {
                        // buyurtma uchun remain ma’lumotlari bilan
                        selectProduct({
                            ...item,
                            remainingQuantity: remain,
                            initialQuantity: initial,
                            soldQuantity: sold,
                        });
                    } else {
                        // open-session: faqat itemning o‘zi (badge kerak emas)
                        selectProduct(item);
                    }
                }
            });

            menuList.appendChild(li);
        });
    } catch (err) {
        console.error("Ma'lumotlarni yuklashda xato:", err);
    }
}

function attachOrderButtons(cancelBtn, orderBtn, payBtn, table_number, cancelOrder, goingBack, getOrdersOfTable, showAlert) {
    const categorySelect = document.getElementById('productCategory');
    const searchInput = document.getElementById('search-input');

    const toNum = (v, d = 0) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : d;
    };

    // PAY
    payBtn.onclick = async () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => { });

        let grandTotal = 0;
        let items = [];

        document.querySelectorAll("tr[id^='order-item-']").forEach(row => {
            const menuId = row.id.replace('order-item-', '');

            // quantity: input yoki (kamdan-kam) span
            const qtyEl = row.querySelector('.quantity');
            const quantity = toNum(qtyEl?.value ?? qtyEl?.textContent ?? '0');

            // unit price: span yoki input bo'lishi mumkin
            const priceEl = row.querySelector('.price');
            const price = toNum(priceEl?.value ?? priceEl?.textContent ?? '0');

            // portions: select bo‘lsa o‘qiymiz (non-weight), aks holda null
            const portionSelect = row.querySelector('.portionSelect');
            const portions = portionSelect ? toNum(portionSelect.value, 1) : null;

            const weightInput = row.querySelector('.weight-input');
            const weightValue = weightInput ? toNum(weightInput.value, 0) : null;

            // total: non-weight -> <span class="total">, weight -> <input class="total-input">
            const totalEl = row.querySelector('.total') || row.querySelector('.total-input');
            const totalVal = toNum(totalEl?.value ?? totalEl?.textContent ?? '0');

            const name = (row.querySelector('.name')?.textContent || '').trim();

            grandTotal += totalVal;
            items.push({ menu_id: menuId, name, quantity, weightValue, portions, price });
        });

        if (!items.length) return showAlert("Mahsulot tanlanmagan!");
        
        const query = { table_number, status: "pending" };
        const orderData = await getOrderByQuery(query);
        if (!orderData || Object.keys(orderData).length === 0) {
            return showAlert("Hali hech qanday pending buyurtma mavjud emas!");
        }

        const { order_number, _id: order_id } = orderData;
        const order = {
            table_number,
            orderId: order_number,
            order_id,
            total_amount: grandTotal,
            items
        };

        const result = await window.electronAPI.openPaymentWindow(order);
        if (result.success) goingBack();
    };

    // CANCEL
    cancelBtn.onclick = async () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => { });
        if (await showConfirm("Buyurtmani bekor qilmoqchimisiz?")) {
            await cancelOrder(table_number);
            await getOrdersOfTable(table_number);
            goingBack();
        }
    };
    
    // ORDER
    orderBtn.onclick = async () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => { });
        
        const toNum = (v, d = 0) => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : d;
        };
        const round2 = (x) => Math.round(x * 100) / 100;
        const round3 = (x) => Math.round(x * 1000) / 1000;

        let grandTotal = 0;
        let items = [];

        document.querySelectorAll("tr[id^='order-item-']").forEach(row => {
            const menuId = row.id.replace('order-item-', '');

            // qty (span yoki input)
            const qtyEl = row.querySelector('.quantity');
            const qty = toNum(qtyEl?.value ?? qtyEl?.textContent ?? '0');

            // unit price (span yoki input) — sizda class '.price'
            const priceEl = row.querySelector('.price');
            const unitPrice = toNum(priceEl?.value ?? priceEl?.textContent ?? '0');

            // portion / weight
            const portionSelect = row.querySelector('.portionSelect'); // porsiya (0.5/0.7/1)
            const weightInput = row.querySelector('.weight-input');  // kg (faqat kg, birlik yo'q)

            // total (span yoki input)
            const totalEl = row.querySelector('.total, .total-input');
            const totalVal = toNum(totalEl?.value ?? totalEl?.textContent ?? '0');

            // default payload
            const payload = {
                menu_id: menuId,
                soldByWeight: false,
                quantity: 0,
                portions: null,
                unit_price: round2(unitPrice),
                total_price: round2(totalVal),
            };

            if (weightInput) {
                // === Kilolik mahsulot ===
                const unitsCount = Math.max(1, Math.trunc(qty));          // masalan: qty=2
                const weightKgPerUnit = parseFloat(weightInput.value || '0'); // masalan: 0.5
                const effectiveKg = unitsCount * weightKgPerUnit;         // 1.0 kg

                payload.soldByWeight = true;
                payload.units = unitsCount;            // ✅ NEW
                payload.weight_kg = weightKgPerUnit;   // ✅ NEW

                payload.quantity = round3(effectiveKg); // inventar uchun
                payload.portions = null;
            } else if (portionSelect) {
                // === Porsiyali mahsulot (soldByWeight = false) ===
                const portion = toNum(portionSelect.value, 1);        // 1 / 0.7 / 0.5
                payload.soldByWeight = false;
                payload.quantity = Math.max(1, Math.trunc(qty));      // non-weight: qty butun
                payload.portions = portion;                           // 0.5 yoki 0.7 (float)
            } else {
                // === Oddiy dona mahsulot ===
                payload.soldByWeight = false;
                payload.quantity = Math.max(1, Math.trunc(qty));      // butun
                payload.portions = null;
            }

            grandTotal += totalVal;
            items.push(payload);
        });

        if (!items.length) return showAlert("Mahsulot tanlanmagan!");

        const newOrder = {
            table_number,
            total_amount: round2(grandTotal),
            payment_method: 'cash',
            items
        };

        await submitOrder(newOrder);

        renderMenuItems(
            { category: categorySelect.value, search: searchInput.value.trim() },
            document.getElementById('menuList'),
            { mode: 'order', payBtn, selectProduct }
        );
    };



}


export { renderTables, renderMenuItems, attachOrderButtons };
