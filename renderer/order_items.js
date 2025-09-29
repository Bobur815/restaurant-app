import { getOrdersOfTable } from "./ordersOfTable.js";
import cancelOrder from "./cancelOrder.js";
import { showAlert, showConfirm } from "../utils/alert.js";
import { renderTables, renderMenuItems, attachOrderButtons } from "./orderPageHelpers.js";
import { categoryOptions } from "./add-load-category.js";



let table_count = parseInt(localStorage.getItem('table_count'), 10) || 10;;
let table_number;
let grandTotal = 0;

let payBtn, orderBtn, cancelBtn;
const clickSound = new Audio(new URL('../sounds/mixkit.wav', import.meta.url));
clickSound.preload = 'auto';


export function selectProduct(item) {
    return new Promise((resolve) => {
        const tableBody = document.getElementById('orderTableBody');

        // ==== existing merge: faqat dona (soldByWeight=false) va portions=false bo'lsa ====
        let existingRow = document.getElementById(`order-item-${item._id}`);
        if (existingRow && !item.soldByWeight && !item.portions) {
            const qtyInput = existingRow.querySelector('.quantity');
            const current = parseInt(qtyInput.value || '0', 10);
            const maxLeft = (item.remainingQuantity ?? item.quantity ?? Infinity);
            if (current + 1 > maxLeft) return showAlert('Mahsulot yetarli emas');
            qtyInput.value = current + 1;

            const portionSel = existingRow.querySelector('.portionSelect');
            const portionMul = portionSel ? parseFloat(portionSel.value) : 1;
            const totalEl = existingRow.querySelector('.total');
            const unitPrice = Number(item.price) || 0;

            totalEl.textContent = ((current + 1) * unitPrice * portionMul).toFixed(2);
            updateGrandTotal();
            return resolve();
        }

        if (item.soldByWeight || item.portions) {
            const safeNum = (v, d = 0) => {
                const n = Number(v);
                return Number.isFinite(n) ? n : d;
            };

            const maxLeft = safeNum(item.remainingQuantity ?? item.quantity ?? Infinity, Infinity);

            // Default factor before a row exists:
            const defaultFactor =
                item.soldByWeight
                    ? safeNum(item.weight_kg, 1)
                    : (typeof item.portions === 'number' ? Number(item.portions) : 1);

            const currentQty = existingRow
                ? parseInt((existingRow.querySelector('.quantity')?.value || '0'), 10)
                : 0;

            const nextEff = (currentQty + 1) * defaultFactor;

            // If default factor doesn't fit (e.g., left = 0.7 but default=1),
            // try to auto-pick a smaller factor for portioned items.
            if (nextEff > maxLeft) {
                if (!item.soldByWeight) {
                    const candidates = [1, 0.7, 0.5];
                    const viable = candidates.find(v => (currentQty + 1) * v <= maxLeft);
                    if (viable) {
                        item.portions = viable; // set starting portion to a viable one
                    } else {
                        return showAlert('Mahsulot yetarli emas');
                    }
                } else {
                    // soldByWeight: set starting weight to the remaining (or whatever fits)
                    if ((currentQty + 1) * 0.01 <= maxLeft) {
                        item.weight_kg = Math.min(defaultFactor, maxLeft / (currentQty + 1));
                    } else {
                        return showAlert('Mahsulot yetarli emas');
                    }
                }
            }

            // If a row already exists, MERGE instead of creating a duplicate row
            if (existingRow) {
                const qtyInput = existingRow.querySelector('.quantity');
                qtyInput.value = (currentQty + 1).toString();

                const portionSelect = existingRow.querySelector('.portionSelect');
                const weightInput = existingRow.querySelector('.weight-input');
                const unitPrice = Number(item.unit_price ?? item.price) || 0;

                // Recalculate effective total
                const portionFactor = () => {
                    if (item.soldByWeight) return Math.max(0, Number(weightInput?.value || item.weight_kg || 1));
                    if (portionSelect) return Math.max(0, Number(portionSelect.value || 1));
                    return 1;
                };

                const qty = parseInt(qtyInput.value || '0', 10);
                const eff = qty * portionFactor();
                if (eff > maxLeft) {
                    // revert increment if this step exceeds stock
                    qtyInput.value = currentQty.toString();
                    return showAlert('Mahsulot yetarli emas');
                }

                const totalSpan = existingRow.querySelector('.total');
                const totalInput = existingRow.querySelector('.total-input');
                const total = item.soldByWeight ? (qty * portionFactor() * unitPrice) : (qty * portionFactor() * unitPrice);

                if (totalSpan) totalSpan.textContent = (Number.isFinite(total) ? total : 0).toFixed(2);
                if (totalInput) totalInput.value = (Number.isFinite(total) ? total : 0).toFixed(2);

                // keep your dataset & grand total updates
                if (typeof updateGrandTotal === 'function') updateGrandTotal();
                return resolve();
            }
        }



        // ==== Helpers ====
        const safeNum = (v, d = 0) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : d;
        };
        const fixed2 = (n) => safeNum(n, 0).toFixed(2);
        const clampNonNeg = (x) => (x < 0 || Number.isNaN(x)) ? 0 : x;

        // ==== Yangi qator ====
        const row = document.createElement('tr');
        row.id = `order-item-${item._id}`;

        const unitPrice = safeNum(item.unit_price ?? item.price, 0);
        const startQty = safeNum(item.soldByWeight ? (item.units ?? 1) : (item.quantity ?? 1), 1);

        // Soni (har doim): - [qty] +
        const qtyHTML = `
      <div class="incdec">
        <button class="decrement">-</button>
        <input type="number" class="quantity" value="${startQty}" min="1" step="1" />
        <button class="increment">+</button>
      </div>
    `;

        // right before you build portionCellHTML:
        const maxLeft = Number(item.remainingQuantity ?? item.quantity ?? Infinity) || Infinity;
        if (!item.soldByWeight && (item.portions === true || typeof item.portions === 'number')) {
            const start = typeof item.portions === 'number' ? item.portions : 1;
            const candidates = [start, 1, 0.7, 0.5]; // try the given first, then fallbacks
            const pick = candidates.find(v => (startQty * v) <= maxLeft) || candidates.find(v => v <= maxLeft);
            item.portions = pick ?? 1; // last resort 1; increment guard will still protect
        }
        if (item.soldByWeight) {
            const w = Number.isFinite(item.weight_kg) ? Number(item.weight_kg) : 1;
            item.weight_kg = Math.min(w, maxLeft / startQty);
        }


        // Porsiya/Weight ustuni
        const portionCellHTML = (() => {
            if (item.soldByWeight) {
                const weightVal = safeNum(item.weight_kg, 1);
                return `
          <div class="weight-box">
            <input type="number" class="weight-input" min="0" step="0.1" value="${weightVal}" />
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

        // Narx (unit price)
        const priceCellHTML = `<span class="price">${unitPrice}</span>`;

        // Total ustuni
        const totalCellHTML = (() => {
            if (item.soldByWeight) {
                const w = safeNum(item.weight_kg, 1);
                const t = startQty * w * unitPrice;
                return `<input type="number" class="total-input" min="0" step="1000.0" value="${fixed2(t)}" />`;
            } else {
                const p = (typeof item.portions === 'number') ? item.portions : 1;
                const t = startQty * p * unitPrice;
                return `<span class="total">${fixed2(t)}</span>`;
            }
        })();

        row.innerHTML = `
      <td><img src="../img/${item.image_url ?? ''}" width="40" height="40" style="border-radius:5px;"></td>
      <td class="name">${item.name}</td>
      <td class="price-cell">${priceCellHTML}</td>
      <td class="qty-cell">${qtyHTML}</td>
      <td class="portion-cell">${portionCellHTML}</td>
      <td class="total-group">${totalCellHTML}</td>
      <td><button class="delete-btn">❌</button></td>
    `;

        tableBody.appendChild(row);

        // ==== Elementlar ====
        const decrementBtn = row.querySelector('.decrement');
        const incrementBtn = row.querySelector('.increment');
        const qtyInput = row.querySelector('.quantity');
        const portionSelect = row.querySelector('.portionSelect'); // non-weight
        const weightInput = row.querySelector('.weight-input');  // weight
        const totalSpan = row.querySelector('.total');         // non-weight total
        const totalInput = row.querySelector('.total-input');   // weight total
        const deleteBtn = row.querySelector('.delete-btn');

        // ==== Helpers (borlariga qo'shimcha) ====
        const portionFactor = () => {
            // weight bo'lsa -> weightInput qiymati (kg), porsiya bo'lsa -> select qiymati, oddiy bo'lsa -> 1
            if (item.soldByWeight) return clampNonNeg(safeNum(weightInput?.value, 0));
            if (portionSelect) return clampNonNeg(safeNum(portionSelect.value, 1));
            return 1;
        };

        const getQty = () => clampNonNeg(parseInt(qtyInput.value || '0', 10));

        // UI/submit uchun effekt miqdorni saqlab boramiz
        const updateEffectiveDataset = () => {
            const eff = getQty() * portionFactor();
            row.dataset.effectiveQty = eff.toFixed(3);
            // portions: weight bo'lsa ham shu joyga weight_kg ni yozamiz (float), oddiyda null
            const p = item.soldByWeight ? portionFactor()
                : (portionSelect ? portionFactor() : null);
            row.dataset.portions = (p ?? '').toString();
        };

        // ==== Hisoblashlar ====
        function recalcNonWeight() {
            const qty = getQty();
            const factor = portionFactor();                // 1 yoki 0.7/0.5
            const total = qty * factor * unitPrice;        // <-- qty × portion
            if (totalSpan) totalSpan.textContent = fixed2(total);
            updateEffectiveDataset();
            updateGrandTotal();
        }

        function recalcFromWeight() {
            // Forward: qty & weight_kg -> total
            const qty = getQty();
            const wKg = portionFactor();                   // weightInput qiymati (kg)
            const total = qty * wKg * unitPrice;           // <-- qty × weight_kg
            if (totalInput) totalInput.value = fixed2(total);
            updateEffectiveDataset();
            updateGrandTotal();
        }

        function recalcFromTotal() {
            // Reverse: total -> weight_kg (qty va unitPrice bo'yicha)
            const qty = getQty();
            const t = clampNonNeg(safeNum(totalInput?.value, 0));
            const denom = qty * unitPrice;
            const newW = denom > 0 ? (t / denom) : 0;     // <-- weight_kg ni qayta hisob
            if (weightInput) weightInput.value = newW.toFixed(2);
            updateEffectiveDataset();
            updateGrandTotal();
        }

        // ==== Boshlang'ich hisob ====
        if (item.soldByWeight) recalcFromWeight();
        else recalcNonWeight();

        const canIncrement = () => {
            const nextQty = getQty() + 1;
            const effNext = nextQty * portionFactor();
            return effNext <= maxLeft;
        };

        // ==== Eventlar ====
        incrementBtn?.addEventListener('click', () => {
            clickSound.currentTime = 0; clickSound.play().catch(() => { });
            if (!canIncrement()) return showAlert('Mahsulot yetarli emas');
            qtyInput.value = (getQty() + 1).toString();
            item.soldByWeight ? recalcFromWeight() : recalcNonWeight();
        });

        decrementBtn?.addEventListener('click', () => {
            clickSound.currentTime = 0; clickSound.play().catch(() => { });
            const current = parseInt(qtyInput.value || '0', 10);
            if (current > 1) {
                qtyInput.value = current - 1;
                item.soldByWeight ? recalcFromWeight() : recalcNonWeight();
            }
        });

        portionSelect?.addEventListener('change', recalcNonWeight);

        weightInput?.addEventListener('input', recalcFromWeight);
        totalInput?.addEventListener('input', recalcFromTotal);

        deleteBtn.addEventListener('click', async () => {
            clickSound.currentTime = 0; clickSound.play().catch(() => { });
            row.remove();
            updateGrandTotal();

            if (tableBody.querySelectorAll('tr').length === 0) {
                if (await showConfirm("Stoldagi barcha buyurtmalar o‘chirildi. Buyurtmani bekor qilmoqchimisiz?")) {
                    await cancelOrder(table_number);
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
        table_number = tableNumber;

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
            ? orders.flatMap(o => o.items)
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
        backBtn.style.display = 'inline-flex';
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
    renderTables(table_count, table_number, payBtn, cancelBtn, getOrdersOfTable, selectTable, goingBack);

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



