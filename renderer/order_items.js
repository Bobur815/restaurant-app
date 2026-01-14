import { getOrdersOfTable } from "./ordersOfTable.js";
import cancelOrder from "./cancelOrder.js";
import { showAlert, showConfirm } from "../utils/alert.js";
import {
  renderTables,
  renderMenuItems,
  attachOrderButtons,
} from "./orderPageHelpers.js";
import { categoryOptions } from "./add-load-category.js";
import { roundN } from "../utils/roundN.js";

let table_count = parseInt(localStorage.getItem("table_count"), 10) || 10;
let tableNumber;
let grandTotal = 0;

let payBtn, orderBtn, cancelBtn;
const clickSound = new Audio(new URL("../sounds/mixkit.wav", import.meta.url));
clickSound.preload = "auto";

export function selectProduct(item) {
  return new Promise(async (resolve) => {
    const tableBody = document.getElementById("orderTableBody");
    payBtn.disabled = true; // keyinchalik updateGrandTotal ichida yoqiladi
    // ---------- Helpers ----------
    const EPS = 1e-9;
    const safeNum = (v, d = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };

    const fixed2 = (n) => safeNum(n, 0).toFixed(2);
    const clampNonNeg = (x) => (x < 0 || Number.isNaN(x) ? 0 : x);

    const getMaxLeft = (it) => {
      const ml = safeNum(
        it.remainingQuantity ?? it.quantity ?? Infinity,
        Infinity
      );
      return Number.isFinite(ml) ? ml : Infinity;
    };

    // id -> row id
    const rowId = `order-item-${item.id}`;
    let existingRow = document.getElementById(rowId);

    // Agar qator allaqachon bor bo‘lsa, faqat MERGE qilish (yangi qator yaratmaymiz)
    if (existingRow) {
      const qtyInput = existingRow.querySelector(".quantity");
      const portionSelect = existingRow.querySelector(".portionSelect");
      const weightInput = existingRow.querySelector(".weight-input");
      const totalSpan = existingRow.querySelector(".total");
      const customPriceInput = existingRow.querySelector(".custom-price");

      const unitPrice = safeNum(item.unit_price ?? item.price, 0);
      const maxLeft = getMaxLeft(item);

      const getPerUnitWeightKg = () => {
        if (customPriceInput) {
          const cp = clampNonNeg(safeNum(customPriceInput.value, 0));
          return unitPrice > 0 ? cp / unitPrice : 0;
        }
        if (weightInput) return clampNonNeg(safeNum(weightInput.value, 0));
        if (portionSelect) return clampNonNeg(safeNum(portionSelect.value, 1));
        return 1;
      };
      const setTotal = () => {
        if (customPriceInput) {
          const qty = clampNonNeg(parseInt(qtyInput?.value || "0", 10));
          const cp = clampNonNeg(safeNum(customPriceInput.value, 0));
          const total = qty * cp;

          if (totalSpan) totalSpan.textContent = fixed2(total);
          if (typeof updateGrandTotal === "function") updateGrandTotal();

          // weight-input ko'rsatkichi (readonly)
          const perUnitW = unitPrice > 0 ? cp / unitPrice : 0;
          if (weightInput) weightInput.value = perUnitW;
        } else {
          const qty = clampNonNeg(parseInt(qtyInput?.value || "0", 10));
          const factor = getPerUnitWeightKg();
          const total = qty * factor * unitPrice;
          if (totalSpan) totalSpan.textContent = fixed2(total);
          if (typeof updateGrandTotal === "function") updateGrandTotal();
        }
      };

      // “Bitta bosishda bitta birlik qo‘shish” — yetarli bo‘lsa oshiramiz
      const currentQty = clampNonNeg(parseInt(qtyInput?.value || "0", 10));
      const perUnitW = getPerUnitWeightKg();
      const nextEff = roundN((currentQty + 1) * perUnitW, 3);
      const ml = roundN(maxLeft, 3);
      if (nextEff > ml + EPS) return showAlert("Mahsulot yetarli emas");
      qtyInput.value = String(currentQty + 1);
      setTotal();
      return resolve();
    }

    // ---------- Yangi qator yaratish ----------
    const unitPrice = safeNum(item.unitPrice ?? item.price, 0);
    const startQty = safeNum(item.quantity ?? 1);
    const maxLeft = getMaxLeft(item);

    // Porsiya startini moslab qo‘yish
    if (
      !item.soldByWeight &&
      (item.portions === true || typeof item.portions === "number")
    ) {
      const start = typeof item.portions === "number" ? item.portions : 1;
      const candidates = [start, 1, 0.7, 0.5];
      const pick =
        candidates.find((v) => startQty * v <= maxLeft + EPS) ||
        candidates.find((v) => v <= maxLeft + EPS);
      item.portions = pick ?? 1;
    }
    
    const row = document.createElement("tr");
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
        const startWeight = Number.isFinite(item.weightKg)
          ? Number(item.weightKg)
          : 1;
        return `
          <div class="weight-incdec">
            <input type="number" class="weight-input" readonly min="0" step="0.1" value="${startWeight}" />
            <input type="number" class="custom-price" min="1000" step="1000" value="${fixed2(item.unitsPrice)}" />
          </div>
        `;
      }
      const hasPortion = item.portions === true || typeof item.portions === "number";
      if (hasPortion) {
        const selected = typeof item.portions === "number" ? item.portions : 1;
        return `
          <select class="portionSelect">
            <option value="1"   ${selected === 1 ? "selected" : ""}>1</option>
            <option value="0.7" ${selected === 0.7 ? "selected" : ""}>0.7</option>
            <option value="0.5" ${selected === 0.5 ? "selected" : ""}>0.5</option>
          </select>
        `;
      }
      return "";
    })();

    const totalCellHTML = (() => {
      if (item.soldByWeight) {
        const unitPrice = safeNum(item.unit_price ?? item.price, 0);
        const startWeight = Number.isFinite(item.weightKg)
          ? Number(item.weightKg)
          : 1; // kg per unit
        const perUnitCustomPrice = startWeight * unitPrice;
        const t = startQty * perUnitCustomPrice; // total = qty * customPrice
        return `<span class="total">${fixed2(t)}</span>`;
      } else {
        const p = typeof item.portions === "number" ? item.portions : 1;
        const t = startQty * p * unitPrice;
        return `<span class="total">${fixed2(t)}</span>`;
      }
    })();

    let imgPath = await window.electronAPI.getImagePath(item);

    row.innerHTML = `
      <td><img src="${imgPath}" width="40" height="40" style="border-radius:5px;"></td>
      <td class="name">${item.name ?? item.menu.name ?? "-"}</td>
      <td class="price-cell"><span class="price">${unitPrice}</span></td>
      <td class="qty-cell">${qtyHTML}</td>
      <td class="portion-cell">${portionCellHTML}</td>
      <td class="total-group">${totalCellHTML}</td>
      <td><button class="delete-btn">❌</button></td>
    `;

    tableBody.appendChild(row);

    // --------- Elementlar (faqat shu qator ichidan) ----------
    const decrementBtn = row.querySelector(".decrement");
    const incrementBtn = row.querySelector(".increment");
    const qtyInput = row.querySelector(".quantity");
    const portionSelect = row.querySelector(".portionSelect");
    const weightInput = row.querySelector(".weight-input");
    const totalSpan = row.querySelector(".total");
    const customPriceInput = row.querySelector(".custom-price");
    const deleteBtn = row.querySelector(".delete-btn");

    // --------- Hisob-funktsiyalar ----------
    const getQty = () => clampNonNeg(parseInt(qtyInput?.value || "0", 10));
    const getPerUnitWeightKg = () => {
      // soldByWeight bo'lsa: per-unit weight = customPrice / unitPrice
      if (customPriceInput) {
        const cp = clampNonNeg(safeNum(customPriceInput.value, 0));
        return unitPrice > 0 ? cp / unitPrice : 0;
      }
      // boshqalar uchun (portionSelect/weightInput) eski mantiq
      if (weightInput) return clampNonNeg(safeNum(weightInput.value, 0));
      if (portionSelect) return clampNonNeg(safeNum(portionSelect.value, 1));
      return 1;
    };
    const effNow = () => roundN(getQty() * getPerUnitWeightKg(), 3);

    const setTotal = () => {
      payBtn.disabled = true;
      if (customPriceInput) {
        const qty = getQty();
        const cp = clampNonNeg(safeNum(customPriceInput.value, 0));
        const total = qty * cp;

        if (totalSpan?.textContent != null)
          totalSpan.textContent = fixed2(total);

        // weight-input (readonly) = jami kg = qty * (cp / unitPrice)
        const perUnitW = unitPrice > 0 ? cp / unitPrice : 0;
        if (weightInput) weightInput.value = perUnitW;
      } else {
        // oddiy tovarlar (porsiya/son)
        const total = getQty() * getPerUnitWeightKg() * unitPrice; // (portion yoki weightInput ishlashi mumkin)
        if (totalSpan?.textContent != null)
          totalSpan.textContent = fixed2(total);
      }

      if (typeof updateGrandTotal === "function") updateGrandTotal();
    };

    // Boshlang‘ich hisob
    setTotal();

    const canBumpQty = () => {
      const perUnitW = getPerUnitWeightKg();
      const nextTotalW = roundN((getQty() + 1) * perUnitW, 3);
      return nextTotalW <= roundN(maxLeft, 3) + EPS;
    };

    // --------- Eventlar ----------
    incrementBtn?.addEventListener("click", () => {
      clickSound.currentTime = 0;
      clickSound.play().catch(() => {});
      if (!canBumpQty()) return showAlert("Mahsulot yetarli emas");
      qtyInput.value = String(getQty() + 1);
      setTotal();
    });

    decrementBtn?.addEventListener("click", () => {
      clickSound.currentTime = 0;
      clickSound.play().catch(() => {});
      const cur = getQty();
      if (cur > 1) {
        qtyInput.value = String(cur - 1);
        setTotal();
      }
    });

    portionSelect?.addEventListener("change", () => {
      clickSound.currentTime = 0;
      clickSound.play().catch(() => {});
      // qty o‘zgarmaydi; eff <= maxLeft shartini tekshiramiz
      if (effNow() > roundN(maxLeft, 3) + EPS) {
        // agar yangi portion sig‘masa — eski qoldiriladi (rollback)
        // select’ni eski qiymatga qaytaring: eng yaqin mosini tanlaymiz
        const candidates = [1, 0.7, 0.5];
        const qty = getQty();
        const viable = candidates.find(
          (v) => roundN(qty * v, 3) <= roundN(maxLeft, 3) + EPS
        );
        if (viable != null) portionSelect.value = String(viable);
        else portionSelect.value = "1";
        showAlert("Mahsulot yetarli emas");
      }
      setTotal();
    });

    customPriceInput?.addEventListener("input", () => {
      const qty = Math.max(1, getQty());
      let cp = clampNonNeg(safeNum(customPriceInput.value, 0));

      // totalWeight (kg) = qty * (cp / unitPrice)
      const totalW = unitPrice > 0 ? qty * (cp / unitPrice) : Infinity;

      if (roundN(totalW, 3) > roundN(maxLeft, 3) + EPS) {
        const allowedPerUnitW = roundN(Math.max(0, maxLeft / qty), 3);
        const allowedCP = unitPrice * allowedPerUnitW;
        cp = allowedCP;
        customPriceInput.value = fixed2(cp);
        showAlert("Mahsulot yetarli emas");
      }

      setTotal(); // bu total span va weight-input (readonly) ni ham yangilaydi
    });

    deleteBtn.addEventListener("click", async () => {
      clickSound.currentTime = 0;
      clickSound.play().catch(() => {});
      row.remove();
      if (typeof updateGrandTotal === "function") updateGrandTotal();

      if (tableBody.querySelectorAll("tr").length === 0) {
        if (
          await showConfirm(
            "Stoldagi barcha buyurtmalar o‘chirildi. Buyurtmani bekor qilmoqchimisiz?"
          )
        ) {
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
  const totals = document.querySelectorAll(".total");
  let total = 0;
  totals.forEach((sp) => {
    const v = parseFloat((sp.textContent || "").replace(/\s/g, ""));
    if (!Number.isNaN(v)) total += v;
  });

  grandTotal = total;
  document.getElementById("grandTotal").textContent =
    grandTotal.toLocaleString() + " UZS";

  return grandTotal;
}

async function selectTable(tableNumber) {
  try {
    const tableBody = document.getElementById("orderTableBody");
    tableBody.innerHTML = "";

    // Reset grand total
    grandTotal = 0;
    document.getElementById("grandTotal").textContent =
      grandTotal.toLocaleString() + " UZS";

    // 1) Orderlarni olamiz
    const orders = (await getOrdersOfTable(tableNumber)) || [];

    // 2) Normalize: grouped (order.items[]) yoki flat bo'lsa ham bir xil ishlasin
    const items = Array.isArray(orders[0]?.items) ? orders[0].items : orders;

    // 3) Har bir itemni selectProduct bilan chizamiz
    for (const it of items) {
      // selectProduct ichida unit_price || price ni o'zi tekshiradi
      await selectProduct(it);
    }

    // 4) Qatorlar bor bo'lsa, cancel yoqiladi
    const hasRows =
      document.querySelectorAll("tr[id^='order-item-']").length > 0;
    cancelBtn.disabled = !hasRows;

    // 5) Totalni yangilash + payBtn holatini set qilish
    const currentTotal = updateGrandTotal();
    payBtn.disabled = !(currentTotal > 0);

    // 6) Tugmalarni bog'lash (listener duplication bo'lmasin)
    attachOrderButtons(
      cancelBtn,
      orderBtn,
      payBtn,
      tableNumber,
      cancelOrder,
      goingBack,
      getOrdersOfTable,
      showAlert
    );

    // 7) Header UI
    const backBtn = document.getElementById("backButton");

    backBtn.style.display = "flex";
    backBtn.onclick = () => {
      clickSound.currentTime = 0;
      clickSound.play().catch(() => {});
      goingBack();
    };

    const tn = document.getElementById("tableNumber");
    tn.style.display = "inline";
    tn.innerText = `Stol № ${tableNumber}`;

    document.getElementById("pageTitle").innerText = "";
  } catch (err) {
    console.error("[selectTable] failed:", err);
    showAlert("Ma’lumotlarni yuklashda xatolik yuz berdi.");
  }
}

function goingBack() {
  document.getElementById("backButton").style.display = "none";
  document.getElementById("tableNumber").style.display = "none";
  document.getElementById("pageTitle").innerText = "🛒 Buyurtma";
  document.querySelector(".container").style.display = "none";
  document.querySelector(".table-wrapper").style.display = "flex";

  loadOrderPage(table_count);
}

export async function loadOrderPage(newTableCount) {
  table_count = newTableCount; // ⬅️ Yangi qiymatni saqlab qolamiz
  const menuList = document.getElementById("menuList");
  const tableGrid = document.getElementById("tableGrid");
  orderBtn = document.querySelector(".order-btn");
  cancelBtn = document.querySelector(".cancel-order");
  payBtn = document.querySelector(".pay-btn");
  const categorySelect = document.getElementById("productCategory");
  const searchInput = document.getElementById("search-input");

  categorySelect.innerHTML = "";
  await categoryOptions(categorySelect);
  // Render the tables
  renderTables(
    table_count,
    payBtn,
    cancelBtn,
    getOrdersOfTable,
    selectTable,
    goingBack
  );

  // Initial render
  const updateMenu = async () => {
    const params = {
      category: categorySelect.value,
      search: searchInput.value.trim(),
    };
    // open-session rejimida badge ko‘rinmaydi
    await renderMenuItems(params, menuList, {
      mode: "order",
      payBtn,
      selectProduct,
    });
  };

  await updateMenu();

  // Category o‘zgarganda
  categorySelect.addEventListener("change", () => {
    if (typeof clickSound !== "undefined") {
      clickSound.currentTime = 0;
      clickSound.play().catch(() => {});
    }
    updateMenu();
  });

  searchInput.addEventListener("input", () => {
    updateMenu();
  });
}
