import { paymentMethods } from "../utils/paymentMethods.js";
import { payStatuses } from "../utils/payStatuses.js";
import { showAlert } from "../utils/alert.js";
import { openEditModal } from "./editCheck.js";

const clickSound = new Audio('../sounds/mixkit.wav');
clickSound.preload = 'auto';

let table_count = 0;

export function loadCheklarPage(table_count=10) {
    const startDate = document.querySelector("#startDate");
    const endDate = document.querySelector("#endDate");
    const stol = document.querySelector('#stol');
    const pay_method = document.querySelector('#pay-method');
    const status = document.querySelector('#status');
    const filterBtn = document.querySelector("#filterBtn");
    const checkList = document.querySelector("#checkList");
    const totalAmount = document.getElementById("totalAmount");
    const refreshBtn = document.querySelector("#refreshBtn");
    const deleteModal = document.getElementById("confirmDeleteModal");
    const confirmDeleteYes = document.getElementById("confirmDeleteYes");
    const confirmDeleteNo = document.getElementById("confirmDeleteNo");

    let deleteTargetOrderNumber = null;
    table_count = parseInt(localStorage.getItem('table_count'), 10) || 10;

    const today = new Date().toISOString().split('T')[0];
    startDate.value = today;
    endDate.value = today;

    for (let i = 1; i <= table_count; i++) {
        stol.innerHTML += `<option value="${i}">🪑 ${i}-stol</option>`;
    }

    refreshBtn.addEventListener("click", () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});

        startDate.value = today;
        endDate.value = today;
        stol.value = 'all'
        pay_method.value = 'all'
        status.value = 'all'
        loadChecks(startDate.value, endDate.value, stol.value, pay_method.value, status.value);
    });

    filterBtn.addEventListener("click", () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});

        if (!startDate.value || !endDate.value) {
            showAlert("Sanani to'g'ri kiriting!");
            return;
        }
        loadChecks(startDate.value, endDate.value, stol.value, pay_method.value, status.value);
    });

    checkList.addEventListener('click',(e) => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});

        const btn = e.target.closest('button');
        if (!btn) return;

        const row = btn.closest('tr');
        const orderNumber = row?.querySelector('td:nth-child(2)')?.textContent;

        if (btn.classList.contains('edit-btn')) {
            openEditModal(
                orderNumber,
                row.dataset.paymentMethod,
                row.dataset.status
              );
        } else if (btn.classList.contains('delete-btn')) {
            deleteTargetOrderNumber = orderNumber;
            deleteModal.classList.remove("hidden");
        } else if (btn.classList.contains('print-btn')) {
            console.log('🖨️ Print', orderNumber);
        }
    });

    confirmDeleteYes.addEventListener("click", async () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});

        try {
            const res = await fetch(`http://localhost:3000/api/payment/${deleteTargetOrderNumber}`, {
                method: "DELETE"
            });
            if (res.ok) {
                showAlert("✅ Muvaffaqiyatli o‘chirildi");
                loadChecks(startDate.value, endDate.value, stol.value, pay_method.value, status.value);
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
        clickSound.play().catch(()=>{/*ignore*/});
        
        deleteModal.classList.add("hidden");
        deleteTargetOrderNumber = null;
    });
    
    // first load
    loadChecks(today, today, stol.value, pay_method.value, status.value);
    
}

export async function loadChecks(start, end, stol, payment_method, status) {
    checkList.innerHTML = `<tr><td colspan="10">⏳ Yuklanmoqda...</td></tr>`;
    
    try {
        let allParams = {
            startDate: start, 
            endDate: end,
            table_number: stol,
            payment_method,
            status
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
                    <td>${check.order_number || "-"}</td>
                    <td>${formatDateTime(check.payment_date)}</td>
                    <td>${check.table_number || "-"}</td>
                    <td>${check.amount?.toLocaleString()} so'm</td>
                    <td>${paymentMethods[check.payment_method] || "-"}</td>
                    <td>${payStatuses[check.status] || "-"}</td>
                    <td><button class="table-action-btn edit-btn"><img src="../img/edit-icon.png" alt="edit"></button></td>
                    <td><button class="table-action-btn delete-btn"><img src="../img/delete-icon.png" alt="delete"></button></td>
                    <td><button class="table-action-btn print-btn">🖨️</button></td>
                `;
                increment++;
                tr.dataset.orderNumber    = check.order_number;
                tr.dataset.paymentMethod  = check.payment_method;
                tr.dataset.status         = check.status;
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
  