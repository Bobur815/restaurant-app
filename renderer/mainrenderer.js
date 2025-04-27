

window.addEventListener('DOMContentLoaded', () => {


    const asosiy = document.querySelector("#asosiy")
    const menu = document.querySelector("#menu")
    const buyurtma = document.querySelector("#buyurtma")
    const cheklar = document.querySelector("#cheklar")
    const hisobotlar = document.querySelector("#hisobotlar")
    const settings = document.querySelector("#settings")
    const chiqish = document.querySelector("#chiqish")
    const sidebarItems = document.querySelectorAll('.sidebar li');
    const maincontent = document.querySelector(".main-content");
    
    let date = document.querySelector("#current-date");


    async function loadTemplate(page) {
        sidebarItems.forEach(li => li.classList.remove('active'));
        document.getElementById(page).classList.add('active');
        try {
            const res = await fetch(`../html/${page}.html`);
            const html = await res.text();
            maincontent.innerHTML = html;

            // Dynamic import asosida modul yuklash
            switch(page) {
                case 'menu':
                    import('./add_items.js').then(module => module.loadMenuPage());
                    break;
                case 'buyurtma':
                    import('./order_items.js').then(module => module.loadOrderPage());
                    break;
                case 'cheklar':
                    import('./cheklar.js').then(module => module.loadCheklarPage());
                    break;
                case 'hisobotlar':
                    import('./reports.js').then(module => module.loadReportsPage());
                    break;
                case 'settings':
                    import('./settings.js').then(module => module.loadSettingsPage());
                    break;
            }
        } catch (err) {
            maincontent.innerHTML = "<h2>Page not found!</h2>";
            console.error(err);
        }
    }
    

    date.textContent = getUzbekFormattedDate()
    document.getElementById("asosiy").addEventListener("click", e => {
        e.preventDefault();
        loadTemplate('asosiy');
    });

    document.getElementById("menu").addEventListener("click", e => {
        e.preventDefault();
        loadTemplate('menu');
    });

    document.getElementById("buyurtma").addEventListener("click", e => {
        e.preventDefault();
        loadTemplate('buyurtma');
    });
    
    document.getElementById("cheklar").addEventListener("click", e => {
        e.preventDefault();
        loadTemplate('cheklar');
    });
    document.getElementById("hisobotlar").addEventListener("click", e => {
        e.preventDefault();
        loadTemplate('hisobotlar');
    });
    document.getElementById("settings").addEventListener("click", e => {
        e.preventDefault();
        loadTemplate('settings');
    });

});

export function loadMenuData() {
    const grid = document.getElementById('menuGrid');

    fetch('http://localhost:3000/api/menu')
        .then(res => res.json())
        .then(data => {
            grid.innerHTML = '';

            const categories = ['Ovqatlar', 'Salatlar', 'Ichimliklar', 'Desertlar','Non mahsulotlari'];

            categories.forEach(category => {
                const categoryItems = data.filter(item => item.category === category);

                if (categoryItems.length) {
                    // Create category section
                    const section = document.createElement('div');
                    section.classList.add('category-section');

                    const title = document.createElement('h2');
                    title.classList.add('category-title');
                    title.textContent = category;

                    const catGrid = document.createElement('div');
                    catGrid.classList.add('category-grid');

                    // Add cards
                    categoryItems.forEach(dish => {
                        const imgPath = `file:///C:/Users/user/Desktop/restaurant-app/img/${dish.image_url}`;
                        const card = document.createElement('div');
                            card.classList.add('card');

                            card.innerHTML = `
                                <img src="${imgPath}" alt="${dish.name}">
                                <h3>${dish.name}</h3>
                                <p>${dish.description}</p>
                                <strong>${dish.price} UZS</strong>
                                <div class="card-buttons">
                                    <button class="edit-btn">
                                        <img src="../img/edit-icon.png">
                                    </button>
                                    <button class="delete-btn">
                                        <img src="../img/delete-icon.png">
                                    </button>
                                </div>
                            `;

                            // Attach event listeners
                            const editBtn = card.querySelector('.edit-btn');
                            editBtn.addEventListener('click', () => editDish(dish.id));

                            const deleteBtn = card.querySelector('.delete-btn');
                            deleteBtn.addEventListener('click', () => deleteDish(dish.id));

                            catGrid.appendChild(card);

                    });

                    section.appendChild(title);
                    section.appendChild(catGrid);
                    grid.appendChild(section);
                }
            });
        })
        .catch(err => {
            console.error(err);
            grid.innerHTML = '<p>Xatolik yuz berdi! Maʼlumot yuklanmadi.</p>';
        });
}

export function openModal(mode, dish = null) {
    const modal = document.getElementById('addModal');
    const modalTitle = document.getElementById('modalTitle');
    const saveBtn = document.getElementById('saveProduct');

    // Modalni ko'rsatish
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    if (mode === 'add') {
        modalTitle.textContent = "Yangi Mahsulot Qo'shish";
        saveBtn.textContent = "Saqlash";

        // Inputlarni tozalash
        document.getElementById('productName').value = '';
        document.getElementById('productPrice').value = 0;
        document.getElementById('productImage').value = '';
        document.getElementById('productCategory').selectedIndex = 0;
        document.getElementById('productDesc').value = '';
    }

    if (mode === 'edit' && dish) {
        modalTitle.textContent = "Mahsulotni Tahrirlash";
        saveBtn.textContent = "O'zgartirish";

        // Ma'lumotlarni inputlarga joylash
        document.getElementById('productName').value = dish.name;
        document.getElementById('productPrice').value = dish.price;
        document.getElementById('productImage').value = dish.image_url;
        document.getElementById('productCategory').value = dish.category;
        document.getElementById('productDesc').value = dish.description;

        // Qo'shimcha: Tahrirlashda dish_id ni saqlab qo'yish
        saveBtn.dataset.dishId = dish.id;
    }

    // Modalni yopish
    document.getElementById('closeModal').onclick = () => {
        modal.style.display = '';
        modal.classList.add('hidden');
    };
}



function editDish(dish_id){

    fetch(`http://localhost:3000/api/menu/${dish_id}`)
    .then(res => res.json())
    .then(dish => {
        openModal('edit', dish);
    })
    .catch(err => console.error(err));
}

function deleteDish(dish_id){
    if(!confirm("Shu mahsulotni o'chirib yuborishni tasdiqlaysimi?")){
        return;
    }
    fetch(`http://localhost:3000/api/menu/${dish_id}`, {
        method: 'DELETE'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error("Mahsulotni o'chirishda xatoli yuz berdi!");
        }
        alert("✅ Mahsulot muvaffaqqiyatli o'chirildi!");
        loadMenuData(); 
    })
    .catch(error => {
        console.error("Error:", error);
        alert("Mahsulotni o'chirishda xatoli yuz berdi!");
    });
}

function getUzbekFormattedDate(date = new Date()) {
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();

    const uzbekMonths = [
        "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
        "Iyul", "Avgust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"
    ];

    const month = uzbekMonths[date.getMonth()];

    return `${day}-${month}, ${year}`;
}