import submitOrder from "./submitOrder.js"
import { loadOrderPage } from "./order_items.js";
import { getOrderByQuery } from "./getOrderByQuery.js";
import { showAlert, showConfirm } from "../utils/alert.js";
import { renderAllSessions } from "./sessions/render.sessions.js";
import { selectProduct } from "./order_items.js";
import { roundN } from "../utils/roundN.js";

const clickSound = new Audio('../sounds/mixkit.wav');
clickSound.preload = 'auto';

// Extracted helper: Render the tables
function renderTables(table_count, payBtn, cancelBtn, getOrdersOfTable, selectTable, goingBack) {
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
                loadOrderPage(table_count);
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
                    showAlert("Bitta ham stol qolmadi!");
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
                const id = it.menuId?.id ?? it.menuId;
                const initial = Number(it.initialQuantity || 0);
                const sold = Number(it.soldQuantity || 0);
                const remain = roundN(initial - sold, 2);
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
            const stat = remainByMenuId.get(item.id) || null;
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
            src="../img/${item.imageUrl}"
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

function attachOrderButtons(cancelBtn, orderBtn, payBtn, tableNumber, cancelOrder, goingBack, getOrdersOfTable, showAlert) {
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
            items.push({ menu: menuId, name, quantity, weightValue, portions, unitPrice:price, price });
        });

        if (!items.length) return showAlert("Mahsulot tanlanmagan!");

        const query = { tableNumber, status: "pending" };
        const orderData = await getOrderByQuery(query);
        if (!orderData || Object.keys(orderData).length === 0) {
            return showAlert("Hali hech qanday pending buyurtma mavjud emas!");
        }
        
        const { orderNumber, id: orderId } = orderData;
        const order = {
            tableNumber,
            orderNumber,
            orderId,
            totalAmount: grandTotal,
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
            await cancelOrder(tableNumber);
            await getOrdersOfTable(tableNumber);
            goingBack();
        }
    };

    // ORDER
    orderBtn.onclick = async () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => { });

        const toNum = (v, d = 0) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : d;
        };
        const round2 = (x) => Math.round(x * 100) / 100;

        // prevent double submit
        if (orderBtn.disabled) return;
        orderBtn.disabled = true;

        try {
            // 1) Build remainingByMenu from the single open session
            const openSessions = (await renderAllSessions({ status: "open" })) || [];
            const active = Array.isArray(openSessions) ? openSessions[0] : openSessions;
            const remainingByMenu = new Map(
                (active?.items ?? []).map((si) => [
                    String(si.menuId),
                    toNum(si.initialQuantity, 0) - toNum(si.soldQuantity, 0),
                ])
            );

            // 2) Collect items with strict stock guards
            let grandTotal = 0;
            const items = [];
            const EPS = 1e-9;

            const rows = document.querySelectorAll("tr[id^='order-item-']");
            for (const row of rows) {
                const menuId = row.id.replace("order-item-", "");
                const remaining = remainingByMenu.has(menuId)
                    ? remainingByMenu.get(menuId)
                    : Infinity;

                // qty
                const qtyEl = row.querySelector(".quantity");
                const qty = Math.max(1, Math.trunc(toNum(qtyEl?.value ?? qtyEl?.textContent, 0)));

                // unit price
                const priceEl = row.querySelector(".price");
                const unitPrice = toNum(priceEl?.value ?? priceEl?.textContent, 0);

                // controls
                const portionSelect = row.querySelector(".portionSelect");
                const weightInput = row.querySelector(".weight-input");

                // total (UI)
                const totalSpan = row.querySelector(".total");
                const totalInput = row.querySelector(".total-input");
                const totalVal = toNum(totalInput?.value ?? totalSpan?.textContent, 0);

                // Build payload + compute effective usage
                const payload = {
                    menuId,
                    soldByWeight: false,
                    quantity: qty,
                    portions: null,
                    unitPrice: round2(unitPrice),
                    totalPrice: round2(totalVal),
                };

                let effectiveUse = qty; // default for simple items

                if (weightInput) {
                    // weight product
                    const w = Math.max(0, toNum(weightInput.value, 0));
                    
                    payload.soldByWeight = true;
                    payload.weightKg = w;
                    payload.portions = null;
                    // server stores `quantity` as units count for weight items
                    payload.quantity = qty; // keep your UI qty as units
                    effectiveUse = qty * w;
                } else if (portionSelect) {
                    // portion product
                    const portion = toNum(portionSelect.value, 1);
                    payload.soldByWeight = false;
                    payload.portions = portion;
                    effectiveUse = qty * portion;
                }
                
                // Stock guard – STOP on first violation
                if (!(effectiveUse <= remaining + EPS)) {
                    const label =
                        weightInput
                            ? `kg`
                            : portionSelect
                                ? `porsiya`
                                : `dona`;
                    await showAlert(`❌ Mahsulot yetarli emas (qolgan: ${round2(remaining)} ${label})`);
                    orderBtn.disabled = false;
                    return;
                }

                grandTotal += totalVal;
                items.push(payload);
            }

            if (!items.length) {
                await showAlert("Mahsulot tanlanmagan!");
                orderBtn.disabled = false;
                return;
            }

            // 3) Submit
            const newOrder = {
                tableNumber,
                totalAmount: round2(grandTotal),
                paymentMethod: "cash", // UIda keyin tanlansa, shu yerga qo'ying
                items,
            };

            await submitOrder(newOrder);

            // 4) UI refresh
            await renderMenuItems(
                { category: categorySelect.value, search: searchInput.value.trim() },
                document.getElementById("menuList"),
                { mode: "order", payBtn, selectProduct }
            );

            await showAlert("✅ Buyurtma saqlandi", { duration: 2000 });
        } catch (err) {
            console.error(err);
            await showAlert("❌ Buyurtmani saqlashda xatolik");
        } finally {
            orderBtn.disabled = false;
        }
    };

}


export { renderTables, renderMenuItems, attachOrderButtons };
