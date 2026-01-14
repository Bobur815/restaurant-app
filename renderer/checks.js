import { paymentMethods } from "../utils/paymentMethods.js";
import { payStatuses } from "../utils/payStatuses.js";
import { showAlert, showConfirm } from "../utils/alert.js";
import { openEditModal } from "./editCheck.js";
import { getOrderByQuery } from "./getOrderByQuery.js";
import { getReceiptSetting } from "./settings/receipt-setting.js";
import { withActionAnimation } from "../utils/loadAnimation.js";

const clickSound = new Audio('../sounds/mixkit.wav');
clickSound.preload = 'auto';

let table_count = 0;

export function loadCheklarPage(table_count = 10) {
  const startDate = document.querySelector("#startDate");
  const endDate = document.querySelector("#endDate");
  const stol = document.querySelector("#stol");
  const pay_method = document.querySelector("#pay-method");
  const status = document.querySelector("#status");
  const checkList = document.querySelector("#checkList");
  const totalAmount = document.getElementById("totalAmount");
  const refreshBtn = document.querySelector("#refreshBtn");
  const deleteModal = document.getElementById("confirmDeleteModal");
  const confirmDeleteYes = document.getElementById("confirmDeleteYes");
  const confirmDeleteNo = document.getElementById("confirmDeleteNo");
  const orderByType = document.getElementById("orderByType");
  const orderDirection = document.getElementById("orderDirection");
  const checkTable = document.querySelector(".check-table");

  let deleteTargetOrderNumber = null;
  table_count = parseInt(localStorage.getItem("table_count"), 10) || 10;

  const today = new Date().toISOString().split("T")[0];
  startDate.value = today;
  endDate.value = today;

  // stollarni to'ldirish
  stol.innerHTML = `<option value="all">🪑 Hammasi</option>`;
  for (let i = 1; i <= table_count; i++) {
    stol.innerHTML += `<option value="${i}">🪑 ${i}-stol</option>`;
  }

  // ---- DRY: joriy filter qiymatlarini olib, loadChecks ni chaqiradigan funksiya
  function refresh() {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => {/* ignore */ });

    if (!startDate.value || !endDate.value) {
      showAlert("Sanani to'g'ri kiriting!");
      return;
    }

    loadChecks(
      startDate.value,
      endDate.value,
      stol.value,
      pay_method.value,
      status.value,
      orderByType.value,
      orderDirection.value
    );
  }

  // ---- Reset tugmasi
  refreshBtn.addEventListener("click", () => {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => {/* ignore */ });

    startDate.value = today;
    endDate.value = today;
    stol.value = "all";
    pay_method.value = "all";
    status.value = "all";
    orderByType.value = orderByType.querySelector("option")?.value || "tableNumber";
    orderDirection.value = "asc";
    refresh();
  });


  // ---- Har bir filtr/select o‘zgarsa ham avtomatik yangilansin
  stol.addEventListener("change", refresh);
  pay_method.addEventListener("change", refresh);
  status.addEventListener("change", refresh);
  orderByType.addEventListener("change", refresh);
  orderDirection.addEventListener("change", refresh);
  startDate.addEventListener("change", refresh);
  endDate.addEventListener("change", refresh);

  // ---- Jadvaldagi tugmalar (edit/delete/print)
  checkList.addEventListener("click", async (e) => {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => {/* ignore */ });

    const btn = e.target.closest("button");
    if (!btn) return;

    const row = btn.closest("tr");
    const orderNumber = row?.querySelector("td:nth-child(2)")?.textContent;

    if (btn.classList.contains("edit-btn")) {
      
      openEditModal(
        orderNumber,
        row.dataset.paymentMethod,
        row.dataset.status
      );
    } else if (btn.classList.contains("delete-btn")) {
      deleteTargetOrderNumber = orderNumber;
      deleteModal.classList.remove("hidden");
    } else if (btn.classList.contains('print-btn')) {
      const orderItems = await getOrderByQuery({ orderNumber });
      
      
      if (!orderItems) return showAlert("❌ Buyurtma topilmadi");
      
      const receiptSettings = await getReceiptSetting();
      const { restaurantName, address, phone, footerNote } = receiptSettings;
      const { payment_method, orderDate, totalAmount, tableNumber } = orderItems;
      
      const order = {
        items: orderItems.items || [],
        orderNumber,
        orderDate,
        totalAmount,
        tableNumber,
        restaurantName,
        address,
        phone,
        footerNote,
      };
      
      if (!await showConfirm("Chekni chop etishni tasdiqlaysizmi?")) return;
      // prevent double-clicks while printing (optional)
      btn.disabled = true;
      
      try {
        await withActionAnimation(
          () => window.electronAPI.sendPrint({ order, paymentMethod: payment_method }),
          { type: 'open', title: "Chek chop etilmoqda…", icon: '🧾' }
        );
        await showAlert("✅ Chek chop etildi");
      } catch (e) {
        console.error(e);
        await showAlert("❌ Chek chop etilmadi: " + e.message);
      } finally {
        btn.disabled = false;
      }
    };


  });

  // ---- O‘chirish tasdiqlash
  confirmDeleteYes.addEventListener("click", async () => {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => {/* ignore */ });

    try {
      const res = await fetch(`http://localhost:3000/api/payment/${deleteTargetOrderNumber}`, {
        method: "DELETE",
      });
      if (res.ok) {
        showAlert("✅ Muvaffaqiyatli o‘chirildi");
        refresh(); // yangilaymiz
      } else {
        showAlert("❌ O‘chirishda xatolik");
      }
    } catch (err) {
      showAlert("🚫 Serverga ulanishda muammo");
    } finally {
      deleteModal.classList.add("hidden");
      deleteTargetOrderNumber = null;
    }
  });

  confirmDeleteNo.addEventListener("click", () => {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => {/* ignore */ });

    deleteModal.classList.add("hidden");
    deleteTargetOrderNumber = null;
  });

  // ---- Birinchi yuklashda hozirgi filtrlarga ko‘ra ma’lumotlarni olib kelish
  refresh();
}


export async function loadChecks(start, end, stol, payment_method, status, orderByType, orderDirection) {

  const checkList = document.querySelector("#checkList");
  checkList.innerHTML = `<tr><td colspan="10">⏳ Yuklanmoqda...</td></tr>`;

  const orderTypeColumnColor = {
    'tableNumber': 'col-table',
    'payment_date': 'col-date',
    'amount': 'col-amount'
  }

  columnColorByOrderType(orderTypeColumnColor[orderByType])

  try {
    let allParams = {
      startDate: start,
      endDate: end,
      tableNumber: stol,
      payment_method,
      status,
      orderByType,
      orderDirection
    }
    const queryObj = Object.fromEntries(
      Object.entries(allParams)
        .filter(([_, value]) => value !== 'all' && value != null)
    );
    const queryString = new URLSearchParams(queryObj).toString();
    const uri = "http://localhost:3000/api/payment?" + queryString;
    const response = await fetch(uri);

    checkList.innerHTML = '';
    if (response.ok) {
      const checks = await response.json();
      if (!checks.length) {
        checkList.innerHTML = `<tr><td colspan="9">📭 Checklar topilmadi</td></tr>`;
        return;
      }

      let total = 0;
      let increment = 1;
      checks.forEach(check => {
        total += check.amount || 0;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
                    <td>${increment}</td>
                    <td>${check.orderNumber || "-"}</td>
                    <td>${formatDateTime(check.payment_date)}</td>
                    <td>${check.tableNumber || "-"}</td>
                    <td>${check.amount?.toLocaleString()} so'm</td>
                    <td>${paymentMethods[check.paymentMethod] || "-"}</td>
                    <td>${payStatuses[check.status] || "-"}</td>
                    <td><button class="table-action-btn edit-btn"><img src="../img/edit-icon.png" alt="edit"></button></td>
                    <td><button class="table-action-btn delete-btn"><img src="../img/delete-icon.png" alt="delete"></button></td>
                    <td><button class="table-action-btn print-btn">🖨️</button></td>
                `;
        increment++;
        tr.dataset.orderNumber = check.orderNumber;
        tr.dataset.paymentMethod = check.payment_method;
        tr.dataset.status = check.status;
        checkList.appendChild(tr);


      });

      totalAmount.innerHTML = `<strong>${total.toLocaleString()} so'm</strong>`;
    } else {
      checkList.innerHTML = `<tr><td colspan="9">❌ Xatolik yuz berdi. Qayta urinib ko‘ring.</td></tr>`;
    }
  } catch (error) {
    console.error("Xatolik", error);
    checkList.innerHTML = `<tr><td colspan="9">🚫 Server bilan bog‘lanishda muammo</td></tr>`;
  }
}

// Bu funksiya global scope’ga emas, loadChecks ichida ham bo’lishi mumkin
function columnColorByOrderType(orderClass) {
  const table = document.querySelector('.check-table');
  if (!table) return;

  // 1) Qachonki biron bir ustun avvalgi qachon bo‘yoqlangan bo‘lsa, uni tozalaymiz
  const allClasses = ['col-date', 'col-table', 'col-amount'];
  const indexMap = { 'col-date': 3, 'col-table': 4, 'col-amount': 5 };

  allClasses.forEach(cls => {
    const idx = indexMap[cls];
    // header va body dagi teglarni topib klassini olib tashlaymiz
    table.querySelectorAll(`thead th:nth-child(${idx}), tbody td:nth-child(${idx})`)
      .forEach(el => el.classList.remove(cls));
  });

  // 2) So‘ngra yangi orderClass bo‘lsa, uning index’ini olib, o‘sha ustunga qo‘shamiz
  if (!orderClass) return;
  const colIdx = indexMap[orderClass];
  if (!colIdx) return;

  // header ustuniga
  const th = table.querySelector(`thead th:nth-child(${colIdx})`);
  if (th) th.classList.add(orderClass);

  // har bir row’dagi tegishli td ustuniga
  table.querySelectorAll(`tbody td:nth-child(${colIdx})`)
    .forEach(td => td.classList.add(orderClass));
}


function formatDateTime(isoString) {
  const date = new Date(isoString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${day}-${month}-${year} | ${hours}:${minutes}:${seconds}`;
}

