import { PORTIONS } from '../utils/config_porsiya.js';
import { showAlert, showConfirm } from "../utils/alert.js";
import { loadAllCategories } from './add-load-category.js';
import { loadSessionsPage } from './sessions/render.sessions.js';
import getMenuItemById from './getMenuItemById.js';
import { renderCategoryItems } from './renderCategoryItems.js';
import { httpDelete } from '../utils/httpDelete.js';

const clickSound = new Audio('../sounds/mixkit.wav');
clickSound.preload = 'auto';

window.addEventListener('DOMContentLoaded', () => {

    // const asosiy = document.querySelector("#asosiy")
    const menu = document.querySelector("#menu")
    const session = document.getElementById('session')
    const buyurtma = document.querySelector("#buyurtma")
    const cheklar = document.querySelector("#cheklar")
    const hisobotlar = document.querySelector("#hisobotlar")
    const settings = document.querySelector("#settings")
    const chiqish = document.querySelector("#chiqish")
    const sidebarItems = document.querySelectorAll('.sidebar li');
    const maincontent = document.querySelector(".main-content");
    const logo = document.querySelector('.logo')
    const holder = document.getElementById('copyright');

    if (holder) {
        const year = new Date().getFullYear();
        holder.innerHTML = `&copy; ${year} SavdoChef`;
    }

    let date = document.querySelector("#current-date");

    (async () => {
        try {
            const res = await fetch("http://localhost:3000/api/receipt-settings", {
                headers: { "Accept": "application/json" }
            });
            const data = res.ok ? await res.json() : null;

            logo.textContent = data?.restaurantName ?? "Shoxona"

        } catch (e) {
            await showAlert(e.message || "Brand nomi yuklashda xatolik")
        }
    })();

    async function loadTemplate(page) {
        let table_count = parseInt(localStorage.getItem('table_count'), 10) || 10;
        sidebarItems.forEach(li => li.classList.remove('active'));
        document.getElementById(page).classList.add('active');
        try {
            const res = await fetch(`../html/${page}.html`);
            const html = await res.text();
            maincontent.innerHTML = html;

            // Dynamic import asosida modul yuklash
            switch (page) {
                case 'menu':
                    loadMenuData();

                    const addBtn = document.querySelector('.add-btn');
                    if (addBtn) {
                        addBtn.addEventListener('click', () => {
                            clickSound.currentTime = 0;
                            clickSound.play().catch(() => { });
                            window.electronAPI.openAddWindow();
                        });
                    }
                    break;
                case 'session':
                    loadSessionsPage()
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
                    import('./settings/setting.js').then(module => module.loadSettingsPage());
                    break;
            }
        } catch (err) {
            maincontent.innerHTML = "<h2>Page not found!</h2>";
            console.error(err);
        }
    }

    loadTemplate('menu').then(() => {
        // loadTemplate ichida ham bor, lekin aynan shu joyda
        const menuLi = document.querySelector('.sidebar li#menu');
        if (menuLi) menuLi.classList.add('active');
    });
    date.textContent = getUzbekFormattedDate()
    // document.getElementById("asosiy").addEventListener("click", e => {
    //     clickSound.currentTime = 0;
    //     clickSound.play().catch(()=>{/*ignore*/});
    //     e.preventDefault();
    //     loadTemplate('asosiy');
    // });

    document.getElementById("menu").addEventListener("click", e => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => {/*ignore*/ });
        e.preventDefault();
        loadTemplate('menu');
    });

    document.getElementById("session").addEventListener("click", e => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => {/*ignore*/ });
        e.preventDefault();
        loadTemplate('session');
    });

    document.getElementById("buyurtma").addEventListener("click", e => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => {/*ignore*/ });
        e.preventDefault();
        loadTemplate('buyurtma');
    });

    document.getElementById("cheklar").addEventListener("click", e => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => {/*ignore*/ });
        e.preventDefault();
        loadTemplate('cheklar');
    });
    document.getElementById("hisobotlar").addEventListener("click", e => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => {/*ignore*/ });
        e.preventDefault();
        loadTemplate('hisobotlar');
    });
    document.getElementById("settings").addEventListener("click", e => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => {/*ignore*/ });
        e.preventDefault();
        loadTemplate('settings');
    });

    document.getElementById("chiqish").addEventListener("click", async e => {
        e.preventDefault()
        if (await showConfirm("Dasturdan chiqmoqchimisiz?")) {
            window.electronAPI.closeMainWindow();
        }
    })
    // Register once on startup
    window.electronAPI.onMenuReload(async () => {
        // If user is on Menu page, fully reload that fragment.
        // If they’re elsewhere, you can either ignore, or prefetch, or badge—your call.
        const menuLi = document.querySelector('.sidebar li#menu');
        const isMenuActive = menuLi?.classList.contains('active');
        if (isMenuActive) {
            await loadTemplate('menu'); // full re-render of the menu fragment
        }
    });

});

export async function loadMenuData() {
  const grid = document.getElementById('menuGrid');
  if (!grid) return;

  // Optional: show a loading state
  grid.innerHTML = '<p>Loading menu…</p>';

  try {
    // Fetch categories and menu data in parallel
    const [categories, menuData] = await Promise.all([
      loadAllCategories(),
      fetch('http://localhost:3000/api/menu/all').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    ]);

    grid.innerHTML = '';

    // Optional: build a map from category name → items (O(n) instead of filtering each time)
    const byCategory = new Map();
    for (const item of menuData || []) {
      const catName = item?.category?.name ?? 'Other';
      if (!byCategory.has(catName)) byCategory.set(catName, []);
      byCategory.get(catName).push(item);
    }

    // Render categories one by one (awaiting card render inside)
    for (const category of categories) {
      const categoryItems = byCategory.get(category.name) || [];
      if (!categoryItems.length) continue;

      // Create category section
      const section = document.createElement('div');
      section.classList.add('category-section');

      const title = document.createElement('h2');
      title.classList.add('category-title');
      title.textContent = category.name;

      const catGrid = document.createElement('div');
      catGrid.classList.add('category-grid');

      // Render cards (uses your async renderCategoryItems)
      await renderCategoryItems(categoryItems, catGrid);

      const inputLine = document.createElement('input');
      inputLine.classList.add('input-line');

      section.appendChild(title);
      section.appendChild(catGrid);
      section.appendChild(inputLine);
      grid.appendChild(section);
    }

    // If no categories had items, show a friendly empty state
    if (!grid.children.length) {
      grid.innerHTML = '<p>No menu items found.</p>';
    }
  } catch (err) {
    console.error('[loadMenuData] failed:', err);
    grid.innerHTML = '<p>Xatolik yuz berdi! Maʼlumot yuklanmadi.</p>';
  }
}


export async function openModal(mode, dish = null) {
    const modal = document.getElementById('addModal');
    const modalContent = modal.querySelector('.modal-content');
    const modalTitle = document.getElementById('modalTitle');
    const saveBtn = document.getElementById('saveProduct');
    const preview = document.getElementById('preview');
    const closeBtn = document.getElementById('closeModal');

    // Modalni ko'rsatish
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // Ichki click-lar fon listeneriga yetmasligi uchun
    modalContent.addEventListener('click', e => {
        e.stopPropagation();
    });

    // Faqatgina fon (modal o'zi) bosilganda yopish
    modal.addEventListener('click', e => {
        if (e.target === modal) {
            close();
        }
    });

    // Close tugmasi
    closeBtn.onclick = close;

    function close() {
        modal.style.display = 'none';
        modal.classList.add('hidden');
        // edit rejimidagi id-ni ham tozalab qo‘ya qolamiz
        delete saveBtn.dataset.dishId;
    }

    if (mode === 'add') {
        modalTitle.textContent = "Yangi Mahsulot Qo'shish";
        saveBtn.textContent = "Saqlash";
        preview.src = await window.electronAPI.getImagePath(dish);

        document.getElementById('productName').value = '';
        document.getElementById('productName').focus();
        document.getElementById('productPrice').value = 0;
        document.getElementById('productImage').value = '';
        document.getElementById('productCategory').selectedIndex = 0;
        document.getElementById('productDesc').value = '';
    }

    if (mode === 'edit' && dish) {
        modalTitle.textContent = "Mahsulotni Tahrirlash";
        saveBtn.textContent = "O'zgartirish";
        saveBtn.dataset.dishId = dish.id;

        preview.src = await window.electronAPI.getImagePath(dish);

        document.getElementById('productName').value = dish.name;
        document.getElementById('productPrice').value = dish.price;
        document.getElementById('productImage').value = dish.imageUrl;
        document.getElementById('productCategory').value = dish.category;
        document.getElementById('productDesc').value = dish.description;
    }
}




export async function editDish(dish_id) {
    try {
        const dish = await getMenuItemById(dish_id);
        await window.electronAPI.openAddWindow(dish);
    } catch (err) {
        console.error('editDish error:', err);
        showAlert?.(`❌ Ma'lumotni olishda xato: ${err.message}`) || alert(`Xato: ${err.message}`);
    }
}

export async function deleteDish(dish_id) {
  const confirmed = await showConfirm("Shu mahsulotni o'chirib yuborishni tasdiqlaysimi?");
  if (!confirmed) return;

try {
  const data = await httpDelete(`http://localhost:3000/api/menu/delete/${dish_id}`);
  await showAlert(data?.message || "✅ O'chirildi");
  await loadMenuData();
} catch (e) {
  if (e.status === 409) return showAlert(`❌ Xatolik: ${e.message}`);
  showAlert(`❌ Xatolik: ${e.message}` || "❌ Xatolik", {duration: 7000});
}

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