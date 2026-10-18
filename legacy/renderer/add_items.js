// add_items.js
// This script runs in the dedicated "add item" BrowserWindow (loaded via add_item.html).
// Make sure your <script> tag in add_item.html is:
//   <script type="module" src="../renderer/add_items.js"></script>

import { showAlert } from '../utils/alert.js';
import { categoryOptions } from './add-load-category.js';

// Preload the click sound
const clickSound = new Audio(new URL('../sounds/mixkit.wav', import.meta.url));
clickSound.preload = 'auto';

// Wait for the DOM to be ready
window.addEventListener('DOMContentLoaded', async () => {
  // If you still wrapped the form in a hidden modal, un-hide it:
  const modal = document.getElementById('addModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  // Grab all controls
  const saveBtn = document.getElementById('saveProduct');
  const cancelBtn = document.getElementById('closeModal');
  const uploadBtn = document.getElementById('uploadBtn');
  const realInput = document.getElementById('realFileInput');
  const modalTitle = document.getElementById('modalTitle');

  const nameInput = document.getElementById('productName');
  const priceInput = document.getElementById('productPrice');
  const imageUrl = document.getElementById('productImage');
  const category = document.getElementById('productCategory');
  const setCategory = document.getElementById('setCategory');
  const description = document.getElementById('productDesc');
  const preview = document.getElementById('preview');

  const hiddenWeightInput = document.getElementById('soldByWeight');
  const hiddenPortionInput = document.getElementById('portionValue');
  const items = document.querySelectorAll('.portion-options .option');

  items.forEach(li => {
    li.addEventListener('click', () => {
      clickSound.currentTime = 0;
      clickSound.play().catch(() => { });

      // 1) clear old selection
      items.forEach(x => x.classList.remove('selected'));
      // 2) mark selected
      li.classList.add('selected');

      // 3) update hidden inputs
      hiddenPortionInput.value = li.dataset.portions; // "true"/"false"
      hiddenWeightInput.value = li.dataset.weight;   // "true"/"false"
    });
  });

  

  setCategory.addEventListener('click', () => {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => { });
    window.electronAPI.openCategoryWindow()
  })

  await categoryOptions(category, 'add_item');
  
category.addEventListener('change', () => {
    const selectedCategory = category.value;
  });

  if (!saveBtn || !cancelBtn) {
    console.warn('Add-item UI not found; skipping setup.');
    return;
  }

  window.electronAPI.onLoadDish(async (dish) => {
    // exactly like your old openModal('edit', dish):

    modalTitle.textContent = "Mahsulotni Tahrirlash";
    saveBtn.dataset.dishId = dish.id;
    nameInput.value = dish.name;
    priceInput.value = dish.price;
    imageUrl.value = dish.imageUrl;
    category.value = dish.category.id
    
    description.value = dish.description;
    
    preview.src = await window.electronAPI.getImagePath(dish);

    // if you want to change button text:
    saveBtn.textContent = "O'zgartirish";
  });

uploadBtn?.addEventListener("click", async () => {
  clickSound.currentTime = 0;
  clickSound.play().catch(() => {});

  const picked = await window.electronAPI.selectImage();
  if (picked) {
    // picked = { filePath, fileName, fileUrl }
    document.getElementById("productImage").value = picked.fileName; // faqat nomini saqlaymiz
    document.getElementById("preview").src = picked.fileUrl;         // tayyor file:/// URL
  }
});

  // Fallback HTML input (if ever used)
  realInput?.addEventListener('change', (e) => {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => { });
    const file = e.target.files[0];
    if (file) {
      document.getElementById('productImage').value = file.name;
      document.getElementById('preview').src = URL.createObjectURL(file);
    }
  });

  // Cancel: just close this window
  cancelBtn.addEventListener('click', () => {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => { });
    window.close();
  });

  // Save product
  saveBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const portions = hiddenPortionInput.value === 'true';
    const soldByWeight = hiddenWeightInput.value === 'true';
    const dishId = saveBtn.dataset.dishId;

    clickSound.currentTime = 0;
    clickSound.play().catch(() => { });

    // Determine URL/method
    let url = 'http://localhost:3000/api/menu/create';
    let method = 'POST';
    let showAlerMsg = '✅ Mahsulot qo‘shildi'

    if (dishId) {
      url = `http://localhost:3000/api/menu/update/${dishId}`;
      method = 'PUT';
      showAlerMsg = "✅ Mahsulot o'zgartirildi"
    }

    // Basic validation
    const name = nameInput.value.trim();
    const price = priceInput.value.trim();
    nameInput.style.border = '';
    priceInput.style.border = '';
    if (!name || !parseInt(price, 10) || !category.value) {
      if (!name) nameInput.style.border = '2px solid red';
      if (!parseInt(price, 10)) priceInput.style.border = '2px solid red';
      if (!category.value) category.style.border = '2px solid red';
      return;
    }

    const normalizedPortions = soldByWeight ? false : portions;

    const newItem = {
      name: nameInput.value.trim(),
      price: parseInt(priceInput.value, 10),
      imageUrl: imageUrl.value.trim(),
      description: description.value.trim(),
      categoryId: category.value,
      portions: normalizedPortions,
      soldByWeight: soldByWeight,
    };
    
    let response, data;
    try {
      
      response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem)
      });

      // 🔥 JSONni avval o‘qib olamiz
      data = await response.json();

      if (!response.ok) {
        // data.message allaqachon mavjud bo‘ladi
        if (data.message?.includes('Bu nomda mahsulot mavjud')) {
          showAlert('❌ Bu nomda mahsulot allaqachon mavjud');
          nameInput.style.border = '2px solid red';
        } else {
          showAlert('❌ Noma’lum xatolik yuz berdi');
        }
        return;  // chiqib ketamiz, xato holatda oynani yopmaymiz
      }

      await showAlert(showAlerMsg, { duration: 3000 });
      window.electronAPI.menuUpdated();
      window.close();

    } catch (err) {
      console.error("Fetch yoki tarmoq xatosi:", err);
      showAlert('❌ Tarmoq xatosi yoki noto‘g‘ri javob');
      // bu yerda ham oynani yopmaymiz, shunchaki alert ko‘rsatayapmiz
    }

  });
});
