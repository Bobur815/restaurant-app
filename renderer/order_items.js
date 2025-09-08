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

        let existingRow = document.getElementById(`order-item-${item._id}`);
        if (existingRow) {
            let qtyCell = existingRow.querySelector('.quantity');
            qtyCell.textContent = parseInt(qtyCell.textContent) + 1;

            let totalCell = existingRow.querySelector('.total');
            totalCell.textContent = parseInt(qtyCell.textContent) * item.price;
            updateGrandTotal();
            return resolve(); // Resolve here too
        }

        const row = document.createElement('tr');
        row.id = `order-item-${item._id}`;
        row.innerHTML = `
            <td><img src="../img/${item.image_url}" width="40" height="40" style="border-radius:5px;"></td>
            <td class=name>${item.name}</td>
            <td class="price">${item.price}</td>
            <td>
                <button class="decrement">-</button>
                <span class="quantity">1</span>
                <button class="increment">+</button>
            </td>
            <td class="portion-cell"></td>
            <td class="total">${item.price}</td>
            <td>
                <button class="delete-btn">❌</button>
            </td>
        `;

        tableBody.appendChild(row);

        const incrementBtn = row.querySelector('.increment');
        const decrementBtn = row.querySelector('.decrement');
        const deleteBtn = row.querySelector('.delete-btn');
        const qtySpan = row.querySelector('.quantity');
        const totalCell = row.querySelector('.total');
        const portionCell = row.querySelector('.portion-cell');

        let portion_Select = null;
        if (item.portions) {
            portion_Select = document.createElement('select');
            portion_Select.className = 'portionSelect';

            const validPortions = ['1', '0.7', '0.5'];
            validPortions.forEach(value => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = value;
                portion_Select.appendChild(option);
            });

            portionCell.appendChild(portion_Select);

            let rawPortion = item.portions === true ? '1' :
                typeof item.portions === 'object' && item.portions.$numberDecimal
                    ? item.portions.$numberDecimal
                    : item.portions;

            const portionString = parseFloat(rawPortion).toString();
            if (validPortions.includes(portionString)) {
                portion_Select.value = portionString;
                totalCell.textContent = parseInt(qtySpan.textContent) * item.price * parseFloat(portion_Select.value);
            }

            portion_Select.addEventListener('change', () => {
                totalCell.textContent = parseInt(qtySpan.textContent) * item.price * parseFloat(portion_Select.value);
                updateGrandTotal();
            });
        }

        if (item.quantity) {
            qtySpan.textContent = item.quantity;
        }

        incrementBtn.addEventListener('click', () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(() => { });

            if (item.remainingQuantity < parseInt(qtySpan.textContent) + 1) {
                return showAlert('Mahsulot yetarli emas')
            }

            qtySpan.textContent = parseInt(qtySpan.textContent) + 1;
            const portionMultiplier = portion_Select ? parseFloat(portion_Select.value) : 1;
            totalCell.textContent = parseInt(qtySpan.textContent) * item.price * portionMultiplier;
            updateGrandTotal();
        });

        decrementBtn.addEventListener('click', () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(() => { });
            if (parseInt(qtySpan.textContent) > 1) {
                qtySpan.textContent = parseInt(qtySpan.textContent) - 1;
                const portionMultiplier = portion_Select ? parseFloat(portion_Select.value) : 1;
                totalCell.textContent = parseInt(qtySpan.textContent) * item.price * portionMultiplier;
                updateGrandTotal();
            }
        });

        deleteBtn.addEventListener('click', async () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(() => { });
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

        updateGrandTotal(); // recalculate when new row is added
        resolve(); // ✅ Resolve the promise at the end
    });
}



function updateGrandTotal() {
    const totalCells = document.querySelectorAll('.total');
    let total = 0;

    totalCells.forEach(cell => {
        total += parseInt(cell.textContent);
    });
    payBtn.disabled = true;

    grandTotal = total; // update global
    document.getElementById('grandTotal').textContent = grandTotal.toLocaleString() + ' UZS';
    return grandTotal;
}




async function selectTable(tableNumber) {
    table_number = tableNumber;

    const tableBody = document.getElementById('orderTableBody');
    tableBody.innerHTML = '';

    // ✅ Reset grandTotal before anything
    grandTotal = 0;
    document.getElementById('grandTotal').textContent = grandTotal.toLocaleString() + ' UZS';

    payBtn.disabled = true;
    cancelBtn.disabled = true;

    const orders = await getOrdersOfTable(tableNumber);
    if (orders.length) {
        for (const order of orders) {
            await selectProduct(order);
        }
        payBtn.disabled = false;
        cancelBtn.disabled = false;
    }
    const currentTotal = updateGrandTotal();

    attachOrderButtons(cancelBtn, orderBtn, payBtn, table_number, cancelOrder, goingBack, getOrdersOfTable, showAlert);

    document.getElementById('backButton').style.display = 'inline-flex';
    document.getElementById('tableNumber').style.display = 'inline';
    document.getElementById('tableNumber').innerText = `Stol № ${tableNumber}`;
    document.getElementById('pageTitle').innerText = '';

    document.getElementById('backButton').addEventListener('click', () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => { });
        goingBack();
    });
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



