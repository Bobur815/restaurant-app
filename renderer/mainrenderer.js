import { PORTIONS } from '../utils/config_porsiya.js';
import { showAlert, showConfirm } from "../utils/alert.js";
const clickSound = new Audio('../sounds/mixkit.wav');
clickSound.preload = 'auto';

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
        let table_count = parseInt(localStorage.getItem('table_count'), 10) || 10;
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
                    import('./order_items.js').then(module => module.loadOrderPage(table_count));
                    break;
                case 'cheklar':
                    import('./checks.js').then(module => module.loadCheklarPage(table_count));
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
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});
        e.preventDefault();
        loadTemplate('asosiy');
    });

    document.getElementById("menu").addEventListener("click", e => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});
        e.preventDefault();
        loadTemplate('menu');
    });

    document.getElementById("buyurtma").addEventListener("click", e => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});
        e.preventDefault();
        loadTemplate('buyurtma');
    });
    
    document.getElementById("cheklar").addEventListener("click", e => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});
        e.preventDefault();
        loadTemplate('cheklar');
    });
    document.getElementById("hisobotlar").addEventListener("click", e => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});
        e.preventDefault();
        loadTemplate('hisobotlar');
    });
    document.getElementById("settings").addEventListener("click", e => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});
        e.preventDefault();
        loadTemplate('settings');
    });

});

export function loadMenuData() {
    const grid = document.getElementById('menuGrid');

    fetch('http://localhost:3000/api/menu/all')
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
                        let imgPath;
                        if (dish.image_url) {
                        imgPath = `file:///C:/Users/user/Desktop/restaurant-app/img/${dish.image_url}`;
                        } else {
                        // fallback if image is missing
                        imgPath = `file:///C:/Users/user/Desktop/restaurant-app/img/placeholder.png`;
                        }

                        const card = document.createElement('div');
                            card.classList.add('card');
                            
                            let portionHTML = '';
                            if (dish.portions === 1) {
                                portionHTML = '<div class="portions"><small>Porsiya: </small>';
                                PORTIONS.forEach((p,index) => {
                                    portionHTML += `<span class="${p.value === 1.0 ? 'active' : ''}">${p.value.toString()}</span> `;
                                    if (index !== PORTIONS.length - 1) {
                                        portionHTML += ' | ';
                                    }
                                });
                                portionHTML += '</div>';
                            }                            
                            

                            card.innerHTML = `
                                <img src="${imgPath}" alt="${dish.name}">
                                <h3>${dish.name}</h3>
                                <p>${dish.description}</p>
                                <strong>${dish.price} UZS</strong>
                                ${portionHTML}
                                <div class="card-buttons">
                                    <button class="edit-btn">
                                        <img src="../img/edit-icon.png">
                                    </button>
                                    <button class="delete-btn">
                                        <img src="../img/delete-icon.png">
                                    </button>
                                </div>
                            `;
                            card.setAttribute('data-original-price', dish.price);
                            document.addEventListener('click', function(e) {

                                if (e.target.matches('.portions span')) {
                            
                                    // Avvalgi activelarni olib tashlaymiz
                                    const spans = e.target.parentElement.querySelectorAll('span');
                                    spans.forEach(span => span.classList.remove('active'));
                            
                                    // Bosilgan span'ga active class qo'shamiz
                                    e.target.classList.add('active');
                            
                                    // >>> Narxni o'zgartirish
                                    const portionValue = parseFloat(e.target.textContent); // tanlangan porsiya qiymati (masalan: 0.7)
                            
                                    // Narx yozilgan elementni topamiz
                                    const priceElement = e.target.closest('.card').querySelector('strong');
                            
                                    // Asl narxni olish uchun (hozirgi narxdan emas, original dan olish kerak => dish.price)
                                    // Dish.price ni saqlash kerak, shuning uchun kartaga atribut qo'shamiz
                                    const originalPrice = parseFloat(e.target.closest('.card').getAttribute('data-original-price'));
                                
                                    // Hisoblab yozamiz
                                    const newPrice = Math.round(originalPrice * portionValue);
                            
                                    priceElement.textContent = `${newPrice} UZS`;
                                }
                            });

                            // Attach event listeners
                            const editBtn = card.querySelector('.edit-btn');
                            editBtn.addEventListener('click', () => {
                                clickSound.currentTime = 0;
                                clickSound.play().catch(()=>{/*ignore*/});
                                editDish(dish._id);
                            })

                            const deleteBtn = card.querySelector('.delete-btn');
                            deleteBtn.addEventListener('click', () => {
                                clickSound.currentTime = 0;
                                clickSound.play().catch(()=>{/*ignore*/});
                                deleteDish(dish._id)});

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
        let productName = document.getElementById('productName');
        productName.value = '';
        productName.focus()
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
        saveBtn.dataset.dishId = dish._id;
    }

    // Modalni yopish
    document.getElementById('closeModal').onclick = () => {
        modal.style.display = 'none';
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

async function deleteDish(dish_id){

    const confirmed = await showConfirm("Shu mahsulotni o'chirib yuborishni tasdiqlaysimi?");
    
    if (!confirmed) return;

    fetch(`http://localhost:3000/api/menu/delete/${dish_id}`, {
        method: 'DELETE'
    })

    .then(response => {
        if (!response.ok) {
            throw new Error("Mahsulotni o'chirishda xatoli yuz berdi!");
        }
        showAlert("✅ Mahsulot muvaffaqqiyatli o'chirildi!");
        
            
        loadMenuData(); 
    })
    .catch(error => {
        console.error("Error:", error);
        showAlert("Mahsulotni o'chirishda xatoli yuz berdi!");
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