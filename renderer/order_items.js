import { getOrdersOfTable } from "./ordersOfTable.js";
import cancelOrder from "./cancelOrder.js";
import { showAlert, showConfirm } from "../utils/alert.js";
import { renderTables, renderMenuItems, attachOrderButtons } from "./orderPageHelpers.js";
import { categoryOptions } from "./add-load-category.js";
import { roundN } from "../utils/roundN.js";
import { getOrderByQuery } from "./getOrderByQuery.js";



let table_count = parseInt(localStorage.getItem('table_count'), 10) || 10;;
let tableNumber;
let grandTotal = 0;

let payBtn, orderBtn, cancelBtn;
const clickSound = new Audio(new URL('../sounds/mixkit.wav', import.meta.url));
clickSound.preload = 'auto';


export function selectProduct(item) {
    return new Promise((resolve) => {
        const tableBody = document.getElementById('orderTableBody');

        // ---------- Helpers ----------
        const EPS = 1e-9;
        const safeNum = (v, d = 0) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : d;
        };

        const fixed2 = (n) => safeNum(n, 0).toFixed(2);
        const clampNonNeg = (x) => (x < 0 || Number.isNaN(x)) ? 0 : x;

        const getMaxLeft = (it) => {

            const ml = safeNum(it.remainingQuantity ?? it.quantity ?? Infinity, Infinity);
            return Number.isFinite(ml) ? ml : Infinity;
        };

        // id -> row id
        const rowId = `order-item-${item.id}`;
        let existingRow = document.getElementById(rowId);

        // Agar qator allaqachon bor bo‘lsa, faqat MERGE qilish (yangi qator yaratmaymiz)
        if (existingRow) {
            const qtyInput = existingRow.querySelector('.quantity');
            const portionSelect = existingRow.querySelector('.portionSelect');
            const weightInput = existingRow.querySelector('.weight-input');
            const totalSpan = existingRow.querySelector('.total');
            const totalInput = existingRow.querySelector('.total-input');

            const unitPrice = safeNum(item.unit_price ?? item.price, 0);
            const maxLeft = getMaxLeft(item);

            const getQty = () => clampNonNeg(parseInt(qtyInput?.value || '0', 10));
            const getFactor = () => {
                if (weightInput) return clampNonNeg(safeNum(weightInput.value, 0)); // kg
                if (portionSelect) return clampNonNeg(safeNum(portionSelect.value, 1)); // 1/0.7/0.5
                return 1;
            };
            const setTotal = () => {
                const qty = getQty();
                const factor = getFactor();
                const total = qty * factor * unitPrice;
                if (totalSpan) totalSpan.textContent = fixed2(total);
                if (totalInput) totalInput.value = fixed2(total);
                if (typeof updateGrandTotal === 'function') updateGrandTotal();
            };

            // “Bitta bosishda bitta birlik qo‘shish” — yetarli bo‘lsa oshiramiz
            const currentQty = getQty();
            const factor = getFactor();
            const nextEff = roundN((currentQty + 1) * factor, 3);
            const ml = roundN(maxLeft, 3);

            if (nextEff > ml + EPS) {
                return showAlert('Mahsulot yetarli emas');
            }

            qtyInput.value = String(currentQty + 1);
            setTotal();
            return resolve();
        }

        // ---------- Yangi qator yaratish ----------
        const unitPrice = safeNum(item.unit_price ?? item.price, 0);
        const startQty = safeNum(item.soldByWeight ? (item.units ?? 1) : (item.quantity ?? 1), 1);
        const maxLeft = getMaxLeft(item);

        // Porsiya startini moslab qo‘yish
        if (!item.soldByWeight && (item.portions === true || typeof item.portions === 'number')) {
            const start = typeof item.portions === 'number' ? item.portions : 1;
            const candidates = [start, 1, 0.7, 0.5];
            const pick = candidates.find(v => (startQty * v) <= maxLeft + EPS) || candidates.find(v => v <= maxLeft + EPS);
            item.portions = pick ?? 1;
        }
        

        const row = document.createElement('tr');
        row.id = rowId;

        const qtyHTML = `
      <div class="incdec">
        <button class="decrement">-</button>
        <input type="number" class="quantity" value="${startQty}" min="1" step="1" />
        <button class="increment">+</button>
      </div>
    `;

        const portionCellHTML = (() => {
            if (item.soldByWeight) {
                const startWeight = Number.isFinite(item.weightKg) ? Number(item.weightKg) : 1;
                const weightVal = startWeight;

                return `
          <div class="incdec">
            <button class="weight-decrement">-</button>
            <input type="number" class="weight-input" min="0" step="0.1" value="${weightVal}" />
            <button class="weight-increment">+</button>
          </div>
        `;
            }
            const hasPortion = item.portions === true || typeof item.portions === 'number';
            if (hasPortion) {
                const selected = typeof item.portions === 'number' ? item.portions : 1;
                return `
          <select class="portionSelect">
            <option value="1"   ${selected === 1 ? 'selected' : ''}>1</option>
            <option value="0.7" ${selected === 0.7 ? 'selected' : ''}>0.7</option>
            <option value="0.5" ${selected === 0.5 ? 'selected' : ''}>0.5</option>
          </select>
        `;
            }
            return '';
        })();

        const totalCellHTML = (() => {
            if (item.soldByWeight) {
                const w = safeNum(item.weightKg, 1);
                const t = startQty * w * unitPrice;
                return `<input type="number" class="total-input" min="0" step="1000.0" value="${t}" />`;
            } else {
                const p = (typeof item.portions === 'number') ? item.portions : 1;
                const t = startQty * p * unitPrice;
                return `<span class="total">${fixed2(t)}</span>`;
            }
        })();

        row.innerHTML = `
      <td><img src="../img/${item.imageUrl ?? item.menu.imageUrl ?? 'placeholder.jpg'}" width="40" height="40" style="border-radius:5px;"></td>
      <td class="name">${item.name ?? item.menu.name ?? '-'}</td>
      <td class="price-cell"><span class="price">${unitPrice}</span></td>
      <td class="qty-cell">${qtyHTML}</td>
      <td class="portion-cell">${portionCellHTML}</td>
      <td class="total-group">${totalCellHTML}</td>
      <td><button class="delete-btn">❌</button></td>
    `;

        tableBody.appendChild(row);

        // --------- Elementlar (faqat shu qator ichidan) ----------
        const decrementBtn = row.querySelector('.decrement');
        const incrementBtn = row.querySelector('.increment');
        const qtyInput = row.querySelector('.quantity');
        const portionSelect = row.querySelector('.portionSelect');
        const weightInput = row.querySelector('.weight-input');
        const wDecBtn = row.querySelector('.weight-decrement');
        const wIncBtn = row.querySelector('.weight-increment');
        const totalSpan = row.querySelector('.total');
        const totalInput = row.querySelector('.total-input');
        const deleteBtn = row.querySelector('.delete-btn');

        // --------- Hisob-funktsiyalar ----------
        const getQty = () => clampNonNeg(parseInt(qtyInput?.value || '0', 10));
        const getFactor = () => {
            if (weightInput) return clampNonNeg(safeNum(weightInput.value, 0)); // kg
            if (portionSelect) return clampNonNeg(safeNum(portionSelect.value, 1));
            return 1;
        };
        const effNow = () => roundN(getQty() * getFactor(), 3);

        const setTotal = () => {
            const total = getQty() * getFactor() * unitPrice;
            if (totalSpan) totalSpan.textContent = fixed2(total);
            if (typeof updateGrandTotal === 'function') updateGrandTotal();
        };

        // Boshlang‘ich hisob
        setTotal();

        const canBumpQty = () => {
            const next = roundN((getQty() + 1) * getFactor(), 3);
            return next <= roundN(maxLeft, 3) + EPS;
        };

        // --------- Eventlar ----------
        incrementBtn?.addEventListener('click', () => {
            clickSound.currentTime = 0; clickSound.play().catch(() => { });
            if (!canBumpQty()) return showAlert('Mahsulot yetarli emas');
            qtyInput.value = String(getQty() + 1);
            setTotal();
        });

        decrementBtn?.addEventListener('click', () => {
            clickSound.currentTime = 0; clickSound.play().catch(() => { });
            const cur = getQty();
            if (cur > 1) {
                qtyInput.value = String(cur - 1);
                setTotal();
            }
        });

        portionSelect?.addEventListener('change', () => {
            clickSound.currentTime = 0; clickSound.play().catch(() => { });
            // qty o‘zgarmaydi; eff <= maxLeft shartini tekshiramiz
            if (effNow() > roundN(maxLeft, 3) + EPS) {
                // agar yangi portion sig‘masa — eski qoldiriladi (rollback)
                // select’ni eski qiymatga qaytaring: eng yaqin mosini tanlaymiz
                const candidates = [1, 0.7, 0.5];
                const qty = getQty();
                const viable = candidates.find(v => roundN(qty * v, 3) <= roundN(maxLeft, 3) + EPS);
                if (viable != null) portionSelect.value = String(viable);
                else portionSelect.value = "1";
                showAlert('Mahsulot yetarli emas');
            }
            setTotal();
        });

        // Weight - step tugmalari
        wDecBtn?.addEventListener('click', () => {
            clickSound.currentTime = 0; clickSound.play().catch(() => { });
            if (!weightInput) return;
            const cur = safeNum(weightInput.value, 0);
            const next = Math.max(0.01, roundN(cur - 0.1, 2));
            const qty = getQty();
            if (roundN(qty * next, 3) > roundN(maxLeft, 3) + EPS) {
                return; // o‘zgartirmaymiz
            }
            weightInput.value = next.toFixed(2);
            setTotal();
        });

        wIncBtn?.addEventListener('click', () => {
            clickSound.currentTime = 0; clickSound.play().catch(() => { });
            if (!weightInput) return;
            const cur = safeNum(weightInput.value, 0);
            const next = roundN(cur + 0.1, 2);
            const qty = getQty();
            if (roundN(qty * next, 3) > roundN(maxLeft, 3) + EPS) {
                return showAlert('Mahsulot yetarli emas');
            }
            weightInput.value = next.toFixed(2);
            setTotal();
        });

        // Qo‘lda weight/total tahrirlash
        weightInput?.addEventListener('input', () => {
            const qty = getQty();
            const w = getFactor(); // weightInput value
            if (roundN(qty * w, 3) > roundN(maxLeft, 3) + EPS) {
                // rollback: eng ko‘p ruxsat etilganini qo‘yish
                const allowed = roundN(Math.max(0, maxLeft / Math.max(1, qty)), 2);
                weightInput.value = allowed.toFixed(2);
                showAlert('Mahsulot yetarli emas');
            }
            setTotal();
        });

        totalInput?.addEventListener('input', () => {
            // reverse: total -> weight (qty, unitPrice orqali)
            const qty = getQty();
            const t = clampNonNeg(safeNum(totalInput.value, 0));
            const denom = qty * unitPrice;
            const newW = denom > 0 ? (t / denom) : 0;
            if (roundN(qty * newW, 3) > roundN(maxLeft, 3) + EPS) {
                const allowed = roundN(Math.max(0, maxLeft / Math.max(1, qty)), 2);
                if (weightInput) weightInput.value = allowed.toFixed(2);
                // total ham qayta hisob
                const corr = qty * allowed * unitPrice;
                totalInput.value = fixed2(corr);
                return showAlert('Mahsulot yetarli emas');
            }
            if (weightInput) weightInput.value = roundN(newW, 2).toFixed(2);
            setTotal();
        });

        deleteBtn.addEventListener('click', async () => {
            clickSound.currentTime = 0; clickSound.play().catch(() => { });
            row.remove();
            if (typeof updateGrandTotal === 'function') updateGrandTotal();

            if (tableBody.querySelectorAll('tr').length === 0) {
                if (await showConfirm("Stoldagi barcha buyurtmalar o‘chirildi. Buyurtmani bekor qilmoqchimisiz?")) {
                    await cancelOrder(tableNumber);
                    goingBack();
                    cancelBtn.disabled = true;
                }
            }
        });

        resolve();
    });
}


function updateGrandTotal() {
    const totalCells = document.querySelectorAll('.total-input');
    const totalSpans = document.querySelectorAll('.total');
    const totalCellsArray = [...totalCells, ...totalSpans];
    let total = 0;

    totalCellsArray.forEach(cell => {
        total += parseInt(cell.textContent) || parseFloat(cell.value) || 0;

    });
    payBtn.disabled = true;


    grandTotal = total; // update global
    document.getElementById('grandTotal').textContent = grandTotal.toLocaleString() + ' UZS';
    return grandTotal;
}


async function selectTable(tableNumber) {
    try {

        const tableBody = document.getElementById('orderTableBody');
        tableBody.innerHTML = '';

        // Reset grand total
        grandTotal = 0;
        document.getElementById('grandTotal').textContent = grandTotal.toLocaleString() + ' UZS';

        payBtn.disabled = true;
        cancelBtn.disabled = true;

        // 1) Orderlarni olamiz
        const orders = await getOrdersOfTable(tableNumber) || [];

        // 2) Normalize: grouped (order.items[]) yoki flat bo'lsa ham bir xil ishlasin
        const items = Array.isArray(orders[0]?.items)
            ? orders[0].items
            : orders;


        // 3) Har bir itemni selectProduct bilan chizamiz
        for (const it of items) {

            // selectProduct ichida unit_price || price ni o'zi tekshiradi
            await selectProduct(it);
        }

        // 4) Qatorlar bor bo'lsa, cancel yoqiladi
        const hasRows = document.querySelectorAll("tr[id^='order-item-']").length > 0;
        cancelBtn.disabled = !hasRows;

        // 5) Totalni yangilash + payBtn holatini set qilish
        const currentTotal = updateGrandTotal();
        payBtn.disabled = !(currentTotal > 0);

        // 6) Tugmalarni bog'lash (listener duplication bo'lmasin)
        attachOrderButtons(
            cancelBtn, orderBtn, payBtn,
            tableNumber,
            cancelOrder, goingBack, getOrdersOfTable, showAlert
        );

        // 7) Header UI
        const backBtn = document.getElementById('backButton');

        backBtn.style.display = 'flex';
        backBtn.onclick = () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(() => { });
            goingBack();
        };

        const tn = document.getElementById('tableNumber');
        tn.style.display = 'inline';
        tn.innerText = `Stol № ${tableNumber}`;

        document.getElementById('pageTitle').innerText = '';

    } catch (err) {
        console.error('[selectTable] failed:', err);
        showAlert('Ma’lumotlarni yuklashda xatolik yuz berdi.');
    }
}




function goingBack() {
    document.getElementById('backButton').style.display = 'none';
    document.getElementById('tableNumber').style.display = 'none';
    document.getElementById('pageTitle').innerText = '🛒 Buyurtma';
    document.querySelector(".container").style.display = 'none';
    document.querySelector('.table-wrapper').style.display = 'flex';

    loadOrderPage(table_count);
}

export async function loadOrderPage(newTableCount) {

    table_count = newTableCount; // ⬅️ Yangi qiymatni saqlab qolamiz
    const menuList = document.getElementById('menuList');
    const tableGrid = document.getElementById('tableGrid');
    orderBtn = document.querySelector('.order-btn');
    cancelBtn = document.querySelector('.cancel-order');
    payBtn = document.querySelector('.pay-btn');
    const categorySelect = document.getElementById('productCategory');
    const searchInput = document.getElementById('search-input');

    categorySelect.innerHTML = ''
    await categoryOptions(categorySelect)
    // Render the tables
    renderTables(table_count, payBtn, cancelBtn, getOrdersOfTable, selectTable, goingBack);

    // Initial render
    const updateMenu = async () => {
        const params = {
            category: categorySelect.value,
            search: searchInput.value.trim(),
        };
        // open-session rejimida badge ko‘rinmaydi
        await renderMenuItems(
            params,
            menuList,
            { mode: 'order', payBtn, selectProduct }
        );
    };

    await updateMenu()

    // Category o‘zgarganda
    categorySelect.addEventListener('change', () => {
        if (typeof clickSound !== 'undefined') {
            clickSound.currentTime = 0;
            clickSound.play().catch(() => { });
        }
        updateMenu()
    });

    searchInput.addEventListener('input', () => {
        updateMenu()
    })

}



