

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
            const res = await fetch(`../templates/${page}.html`);
            const html = await res.text();
            maincontent.innerHTML = html;
    
            if (page === 'menu') {
                const script = document.createElement('script');
                script.src = '../renderer/add_items.js';
                document.body.appendChild(script);
            }
    
        } catch (err) {
            maincontent.innerHTML = "<h2>Page not found!</h2>";
            console.error(err);
        }
    }
    
    

    date.textContent = getUzbekFormattedDate()
    asosiy.addEventListener("click", async (e) => {
        e.preventDefault();
        await loadTemplate('asosiy');
    });
    
    menu.addEventListener("click", async (e) => {
        e.preventDefault();
        await loadTemplate('menu');
        loadMenuData();   
    });
    
    buyurtma.addEventListener("click", async (e) => {
        e.preventDefault();
        await loadTemplate('buyurtma');
    });
    
    cheklar.addEventListener("click", async (e) => {
        e.preventDefault();
        await loadTemplate('cheklar');
    });
    
    hisobotlar.addEventListener("click", async (e) => {
        e.preventDefault();
        await loadTemplate('hisobotlar');
    });
    
    settings.addEventListener("click", async (e) => {
        e.preventDefault();
        await loadTemplate('settings');
    });
    chiqish.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("chiqish"); 
    })

});

function loadMenuData() {
    const grid = document.getElementById('menuGrid');  

    fetch('http://localhost:3000/api/menu')
        .then(res => res.json())
        .then(data => {
            grid.innerHTML = '';
            data.forEach(dish => {
                const imgPath = `file:///C:/Users/user/Desktop/restaurant-app/img/${dish.image_url}`;
                grid.innerHTML += `
                    <div class="card">
                        <img src="${imgPath}" alt="${dish.name}">
                        <h3>${dish.name}</h3>
                        <p>${dish.description}</p>
                        <strong>${dish.price} UZS</strong>
                        <div class="card-buttons">
                            <button class="edit-btn"  onclick="editDish(${dish.id})"><img src = "../img/edit-icon.png"></button>
                            <button class="delete-btn" onclick="deleteDish(${dish.id})"><img src = "../img/delete-icon.png"></button>
                        </div>
                    </div>
                `;
            });
        })
        .catch(err => {
            console.error(err);
            grid.innerHTML = '<p>Xatolik yuz berdi! Maʼlumot yuklanmadi.</p>';
        });
}

function addItems(){
    console.log("post");
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