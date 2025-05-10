import { getOrdersOfTable } from "./ordersOfTable.js";
import submitOrder from "./submitOrder.js";
import cancelOrder from "./cancelOrder.js";
import { showAlert } from "./alert.js";

let table_count = 10;
let table_number;
let grandTotal = 0;


function selectProduct(item) {

    const tableBody = document.getElementById('orderTableBody');

    // Check if product is already added
    let existingRow = document.getElementById(`order-item-${item.id}`);
    if (existingRow) {
        // Increase quantity
        let qtyCell = existingRow.querySelector('.quantity');
        qtyCell.textContent = parseInt(qtyCell.textContent) + 1;

        let totalCell = existingRow.querySelector('.total');
        totalCell.textContent = parseInt(qtyCell.textContent) * item.price;
        updateGrandTotal();
    } else {
        // Add new product row
        const row = document.createElement('tr');
        row.id = `order-item-${item.id}`;

        row.innerHTML = `
            <td><img src="../img/${item.image_url}" width="40" height="40" style="border-radius:5px;"></td>
            <td>${item.name}</td>
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
        updateGrandTotal();

        // Elements
        const incrementBtn = row.querySelector('.increment');
        const decrementBtn = row.querySelector('.decrement');
        const deleteBtn = row.querySelector('.delete-btn');
        const qtySpan = row.querySelector('.quantity');
        const totalCell = row.querySelector('.total');
        const portionCell = row.querySelector('.portion-cell');

        // Portion select (create dynamically)
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

            // Set default portion if provided
            const portionString = parseFloat(item.portions).toString();

            if (validPortions.includes(portionString)) {
                portion_Select.value = portionString;
                totalCell.textContent = parseInt(qtySpan.textContent) * item.price * parseFloat(portion_Select.value);
                updateGrandTotal();
            } else {
                console.warn(`Invalid portion: ${item.portions}`);
            }



            portion_Select.addEventListener('change', () => {
                totalCell.textContent = parseInt(qtySpan.textContent) * item.price * parseFloat(portion_Select.value);
                updateGrandTotal();
            });
        }

        // Set initial quantity if available
        if (item.quantity) {
            qtySpan.textContent = item.quantity;
        }

        // Increment button
        incrementBtn.addEventListener('click', () => {
            qtySpan.textContent = parseInt(qtySpan.textContent) + 1;
            const portionMultiplier = portion_Select ? parseFloat(portion_Select.value) : 1;
            totalCell.textContent = parseInt(qtySpan.textContent) * item.price * portionMultiplier;
            updateGrandTotal();
        });

        // Decrement button
        decrementBtn.addEventListener('click', () => {
            if (parseInt(qtySpan.textContent) > 1) {
                qtySpan.textContent = parseInt(qtySpan.textContent) - 1;
                const portionMultiplier = portion_Select ? parseFloat(portion_Select.value) : 1;
                totalCell.textContent = parseInt(qtySpan.textContent) * item.price * portionMultiplier;
                updateGrandTotal();
            }
        });

        // Delete button
        deleteBtn.addEventListener('click', () => {
            row.remove(); // remove the row from DOM
        
            updateGrandTotal(); // recalculate total
        
            // Disable the pay button by default
            payBtn.disabled = true;
        
            // ✅ Check if tableBody has no more rows
            if (tableBody.querySelectorAll('tr').length === 0) {
                const confirmCancel = confirm("Stoldagi barcha buyurtmalar o‘chirildi. Buyurtmani bekor qilmoqchimisiz?");
                if (confirmCancel) {
                    console.log("Table is now empty — canceling order...");
                    cancelOrder(table_number);
                    cancelBtn.disabled = true;
                } else {
                    console.log("Buyurtma bekor qilinmadi.");
                }
            }
            
        });
        
    }
}


function updateGrandTotal() {
    const totalCells = document.querySelectorAll('.total');
    
    grandTotal = 0;
    totalCells.forEach(cell => {
        grandTotal += parseInt(cell.textContent);
    });

    document.getElementById('grandTotal').textContent = grandTotal.toLocaleString() + ' UZS';
}



async function selectTable(tableNumber) {

    const orderBtn = document.querySelector('.order-btn');
    const cancelBtn = document.querySelector('.cancel-order');
    const payBtn = document.querySelector('.pay-btn');
    table_number = tableNumber;

    const tableBody = document.getElementById('orderTableBody');
    tableBody.innerHTML = ''; 

    payBtn.disabled = true;
    cancelBtn.disabled = true;

    getOrdersOfTable(tableNumber).then(orders => {
        if(orders.length){
            orders.forEach(order => selectProduct(order))
            payBtn.disabled = false;
            cancelBtn.disabled = false;
        }
    })

    document.getElementById('backButton').style.display = 'inline-flex';
    document.getElementById('tableNumber').style.display = 'inline';
    document.getElementById('tableNumber').innerText = `Stol № ${tableNumber}`;
    document.getElementById('pageTitle').innerText = '';

    document.getElementById('backButton').addEventListener('click', () => {
        goingBack()
    });

}

function goingBack(){
        document.getElementById('backButton').style.display = 'none';
        document.getElementById('tableNumber').style.display = 'none';
        document.getElementById('pageTitle').innerText = '🛒 Buyurtma';
        document.querySelector(".container").style.display = 'none';
        document.querySelector('.table-wrapper').style.display = 'flex';
}

export function loadOrderPage() {
    const menuList = document.getElementById('menuList');
    const categorySelect = document.getElementById('productCategory');
    const tableGrid = document.getElementById('tableGrid');
    
    tableGrid.textContent = "";

    for (let i = 1; i <= table_count + 1; i++) {
        const table = document.createElement('div');
        
        if (i === table_count + 1) {
            // 1️⃣ Qo'shish tugmasi uchun box
            const addBox = document.createElement('div');
            addBox.classList.add('add-table-box');
            addBox.innerHTML = `Qo'shish <img src="../img/white_add_icon.png" />`;
        
            addBox.addEventListener('click', (e) => {
                table_count += 1;
                loadOrderPage()
            });
        
            tableGrid.appendChild(addBox);
        
            // 2️⃣ O'chirish tugmasi uchun alohida box
            const deleteBox = document.createElement('div');
            deleteBox.classList.add('delete-table-box');
            deleteBox.innerHTML = `Oxirgini o'chirish <img src="../img/delete-icon.png" />`;
        
            deleteBox.addEventListener('click', (e) => {
                e.stopPropagation();
                if(tableGrid.children[table_count - 1].classList.contains('busy')){
                    return alert("Bu stolda buyurtma mavjud!")
                }
                if (table_count > 1) {
                    tableGrid.removeChild(tableGrid.children[table_count - 1]);  // Oxirgi stol (Qo'shish va O'chirish oldidagi)
                    table_count -= 1;
                } else {
                    alert("Bitta ham stol qolmadi!");
                }
            });
        
            tableGrid.appendChild(deleteBox);
        }
        
        else {
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
                document.querySelector('.table-wrapper').style.display = 'none';
                document.querySelector(".container").style.display = 'flex';
                selectTable(i);
            });
        }
    
        tableGrid.appendChild(table);
    }
    
    
    filterMenuByCategory()

    categorySelect.addEventListener('change', () => {
        const selectedCategory = categorySelect.value;

        filterMenuByCategory(selectedCategory);
    });
    if (!menuList) {
        console.error("❌ menuList topilmadi!");
        return;
    }

    function filterMenuByCategory(category='Ovqatlar'){
        fetch(`http://localhost:3000/api/menu/category/${category}`)
        .then(res => res.json())
        .then(menuItems => {
            menuList.innerHTML = '';

            menuItems.forEach(item => {
                const li = document.createElement('li');

                li.innerHTML = `
                    <img src="../img/${item.image_url}" alt="${item.name}" width="40" height="40" style="vertical-align:middle; border-radius:5px; object-fit:cover; border:1px solid #ccc;">
                    <span style="margin-left:10px;">${item.name}</span>
                `;
                li.addEventListener('click', () => {
                    payBtn.disabled = true;
                    selectProduct(item);
                });
                menuList.appendChild(li);
            });
        })
        .catch(err => console.error("Ma'lumotlarni yuklashda xato:", err));
    }

    const orderBtn = document.querySelector('.order-btn');
    const cancelBtn = document.querySelector('.cancel-order');
    const payBtn = document.querySelector('.pay-btn');

    cancelBtn.addEventListener('click', async () => {
        const confirmCancel = confirm("Buyurtmani bekor qilmoqchimisiz?");
        if (confirmCancel) {
            await cancelOrder(table_number);
            goingBack()
        } 
    })
    
    orderBtn.addEventListener('click', async () => {
    
        console.log("order");
        let items = [];
        document.querySelectorAll("tr[id^='order-item-']").forEach(row => {
            let menuId = row.id.replace('order-item-', '');
            let quantity = row.querySelector('.quantity').textContent;
            let price = row.querySelector('.price').textContent;
            let portionSelect = row.querySelector('#portionSelect');
            let portions = portionSelect ? parseFloat(portionSelect.value) : null;
    
            items.push({ menu_id: menuId, quantity, portions, price });
        });
    
        if (!items.length) {
            return showAlert("Mahsulot tanlanmagan!");
        }
    
        const newOrder = {
            table_number,
            total_amount: grandTotal,
            payment_method: 'cash',
            items
        };
    
        await submitOrder(newOrder);
    });
}




