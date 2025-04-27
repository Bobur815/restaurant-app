

function selectProduct(item) {
    const tableBody = document.getElementById('orderTableBody');

    // Avval tekshiramiz, mahsulot allaqachon qo'shilganmi?
    let existingRow = document.getElementById(`order-item-${item.id}`);
    if (existingRow) {
        // Soni +1 qilamiz
        let qtyCell = existingRow.querySelector('.quantity');
        qtyCell.textContent = parseInt(qtyCell.textContent) + 1;

        let totalCell = existingRow.querySelector('.total');
        totalCell.textContent = parseInt(qtyCell.textContent) * item.price;
        updateGrandTotal()
    } else {
        // Yangi mahsulot qo'shish
        const row = document.createElement('tr');
        row.id = `order-item-${item.id}`;

        row.innerHTML = `
            <td><img src="../img/${item.image_url}" width="40" height="40" style="border-radius:5px;"></td>
            <td>${item.name}</td>
            <td>${item.price}</td>
            <td>
                <button class="decrement">-</button>
                <span class="quantity">1</span>
                <button class="increment">+</button>
            </td>
            <td class="total">${item.price}</td>
            <td>
                <button class="delete-btn">❌</button>
            </td>
        `;

        tableBody.appendChild(row);
        updateGrandTotal()
        // ➕ ➖ Tugmalariga Event Listener qo'shamiz
        const incrementBtn = row.querySelector('.increment');
        const decrementBtn = row.querySelector('.decrement');
        const deleteBtn = row.querySelector('.delete-btn');
        const qtySpan = row.querySelector('.quantity');
        const totalCell = row.querySelector('.total');

        incrementBtn.addEventListener('click', () => {
            qtySpan.textContent = parseInt(qtySpan.textContent) + 1;
            totalCell.textContent = parseInt(qtySpan.textContent) * item.price;
            updateGrandTotal()
        });

        decrementBtn.addEventListener('click', () => {
            if (parseInt(qtySpan.textContent) > 1) {
                qtySpan.textContent = parseInt(qtySpan.textContent) - 1;
                totalCell.textContent = parseInt(qtySpan.textContent) * item.price;
                updateGrandTotal()
            }
        });

        deleteBtn.addEventListener('click', () => {
            row.remove();
            updateGrandTotal()
        });
    }
}

function updateGrandTotal() {
    const totalCells = document.querySelectorAll('.total');
    let grandTotal = 0;

    totalCells.forEach(cell => {
        grandTotal += parseInt(cell.textContent);
    });

    document.getElementById('grandTotal').textContent = grandTotal.toLocaleString() + ' UZS';
}


export function loadOrderPage() {
    const menuList = document.getElementById('menuList');
    const categorySelect = document.getElementById('productCategory');
    const tableGrid = document.getElementById('tableGrid');

    for (let i = 1; i <= 10; i++) {
        const table = document.createElement('div');
        table.classList.add('table-box');
        table.textContent = `Stol ${i}`;
        table.addEventListener('click', () => {
            table.classList.toggle('busy');
        });
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
                    selectProduct(item);
                });
                menuList.appendChild(li);
            });
        })
        .catch(err => console.error("Ma'lumotlarni yuklashda xato:", err));
    }
}



