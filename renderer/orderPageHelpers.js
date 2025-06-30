import submitOrder from "./submitOrder.js"
import { loadOrderPage } from "./order_items.js";
import { getOrderByQuery } from "./getOrderByQuery.js";

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
                clickSound.play().catch(()=>{/*ignore*/});
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
                document.querySelector('.table-wrapper').style.display = 'none';
                document.querySelector(".container").style.display = 'flex';
                
                selectTable(i);
            });

            tableGrid.appendChild(table);
        }
    }
}

// Extracted helper: Render the menu list
function renderMenuItems(category, menuList, payBtn, selectProduct) {
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

// Extracted helper: Attach order and cancel buttons safely
function attachOrderButtons(cancelBtn, orderBtn, payBtn, table_number, cancelOrder, goingBack, getOrdersOfTable, showAlert) {
    
    if (!payBtn.dataset.listenerAttached) {
        payBtn.addEventListener("click", async () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(()=>{/*ignore*/});
            let grandTotal = 0;
          let items = [];
          document.querySelectorAll("tr[id^='order-item-']").forEach(row => {
            let menuId = row.id.replace('order-item-', '');
            let quantity = parseInt(row.querySelector('.quantity').textContent);
            let price = parseInt(row.querySelector('.price').textContent);
            let portionSelect = row.querySelector('.portionSelect');
            let portions = portionSelect ? parseFloat(portionSelect.value) : null;
            let name = row.querySelector('.name').textContent;
            
            grandTotal += +row.querySelector('.total').textContent
            
            items.push({ menu_id: menuId, name, quantity, portions, price });
          });
      
          if (!items.length) {
            return showAlert("Mahsulot tanlanmagan!");
          }
          
          let query = {
            table_number,
            status: "pending"
          };

          const orderofOneTable = await getOrderByQuery(query)
          const order = {
            table_number,
            orderId:orderofOneTable[0].order_number,
            order_id:orderofOneTable[0]._id,
            total_amount: grandTotal,
            items
          };

          const result = await window.electronAPI.openPaymentWindow(order);
          if(result.success){
              goingBack()
          }
        });
      
        payBtn.dataset.listenerAttached = 'true';
      }
      
    if (!cancelBtn.dataset.listenerAttached) {
        cancelBtn.addEventListener('click', async () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(()=>{/*ignore*/});
            const confirmCancel = confirm("Buyurtmani bekor qilmoqchimisiz?");
            if (confirmCancel) {
                await cancelOrder(table_number);
                await getOrdersOfTable(table_number); // You may use this result to toggle busy class
                goingBack();
            }
        });
        cancelBtn.dataset.listenerAttached = 'true';
    }

    if (!orderBtn.dataset.listenerAttached) {
        orderBtn.addEventListener('click', async () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(()=>{/*ignore*/});
            let grandTotal = 0;
            let items = [];
            document.querySelectorAll("tr[id^='order-item-']").forEach(row => {
                let menuId = row.id.replace('order-item-', '');
                let quantity = parseInt(row.querySelector('.quantity').textContent);
                let price = parseInt(row.querySelector('.price').textContent);
                let portionSelect = row.querySelector('.portionSelect');
                let portions = portionSelect ? parseFloat(portionSelect.value) : null;

                grandTotal += +row.querySelector('.total').textContent
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
        orderBtn.dataset.listenerAttached = 'true';
    }
}

export { renderTables, renderMenuItems, attachOrderButtons };
