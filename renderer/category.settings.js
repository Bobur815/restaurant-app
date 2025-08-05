import { showAlert, showConfirm } from "../utils/alert.js";
import { categoryOptions, loadAllCategories } from "./add-load-category.js";

const clickSound = new Audio(new URL('../sounds/mixkit.wav', import.meta.url));
clickSound.preload = 'auto';

window.addEventListener('DOMContentLoaded', async () => {
    const categories = await loadAllCategories();

    const tbody = document.getElementById('categoryTableBody');
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    const categoryModal = document.getElementById('categoryModal');
    const categoryNameInput = document.getElementById('categoryNameInput');
    const saveCategoryBtn = document.getElementById('saveCategoryBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const modalTitle = document.getElementById('modalTitle');

    let editCategoryId = null;

    // Kategoriyani jadvalga qo‘shish
    let count = 1;
    categories.forEach(category => {
        const tr = document.createElement('tr');
        // Tartib raqami
        const tdNumber = document.createElement('td')
        tdNumber.textContent = count
        tdNumber.classList.add('col-number');
        tr.appendChild(tdNumber)
        count += 1

        // Nomi
        const tdName = document.createElement('td');
        tdName.textContent = category.name;
        tdName.classList.add('col-name');
        tr.appendChild(tdName);

        // Tahrirlash tugmasi
        const tdEdit = document.createElement('td');
        const btnEdit = document.createElement('button');
        tdEdit.classList.add('th2');
        btnEdit.type = 'button';
        btnEdit.className = 'btn-edit';
        btnEdit.setAttribute('aria-label', `${category.name} kategoriyasini tahrirlash`);

        const imgEdit = document.createElement('img');
        imgEdit.src = '../img/edit-icon.png';
        imgEdit.alt = 'edit';
        btnEdit.appendChild(imgEdit);
        tdEdit.appendChild(btnEdit);
        tr.appendChild(tdEdit);

        // O'chirish tugmasi
        const tdDel = document.createElement('td');
        const btnDel = document.createElement('button');
        tdDel.classList.add('th3');
        btnDel.type = 'button';
        btnDel.className = 'btn-delete';
        btnDel.setAttribute('aria-label', `${category.name} kategoriyasini o‘chirish`);

        const imgDel = document.createElement('img');
        imgDel.src = '../img/delete-icon.png';
        imgDel.alt = 'delete';
        btnDel.appendChild(imgDel);
        tdDel.appendChild(btnDel);
        tr.appendChild(tdDel);

        tbody.appendChild(tr);

        // Edit hodisasi
        btnEdit.addEventListener('click', () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(() => { });
            editCategoryId = category._id;
            categoryNameInput.value = category.name;
            modalTitle.textContent = "Kategoriya tahrirlash";
            categoryModal.classList.remove('hidden');
        });

        // Delete hodisasi
        btnDel.addEventListener('click', async () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(() => { });

            // o‘chirishga roziligini so‘raymiz
            if (!await showConfirm(`"${category.name}" kategoriyasini o‘chirishga ishonchingiz komilmi?`)) {
                return;
            }

            try {
                const res = await fetch(`http://localhost:3000/api/category/delete/${category._id}`, {
                    method: 'DELETE'
                });

                // JSON formatida xabar kutamiz
                const data = await res.json();

                if (!res.ok) {
                    // 400 yoki 409 kabi holatlarda bu blok ishlaydi
                    // backend: throw new CustomError(msg, status)
                    // controller: res.status(status).json({ message: msg })
                    await showAlert(data.message || 'Xatolik yuz berdi!');
                    return;
                }

                // muvaffaqiyatli o‘chirildi
                await showConfirm(data.message || '✅ Kategoriya o‘chirildi');
                // jadvalni yangilaymiz, yoki faqat shu satrni olib tashlaymiz:
                // tr.remove();
                window.location.reload();

            } catch (err) {
                // tarmoq xatolari yoki JSON parse xatolari
                console.error(err);
                await showAlert('Server bilan bog‘lanishda xatolik yuz berdi!');
            }
        });
    });

    // Qo‘shish tugmasi
    addCategoryBtn.addEventListener('click', () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => { });
        editCategoryId = null;
        categoryNameInput.value = '';
        modalTitle.textContent = "Kategoriya qo‘shish";
        categoryModal.classList.remove('hidden');
    });

    // Modalni yopish
    closeModalBtn.addEventListener('click', () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => { });
        categoryModal.classList.add('hidden');
    });

    // Saqlash tugmasi
    saveCategoryBtn.addEventListener('click', async () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => { });
        const categoryName = categoryNameInput.value.trim();
        if (!categoryName) return alert("Kategoriya nomini kiriting!");

        const bodyData = JSON.stringify({ name: categoryName });
        console.log(bodyData);

        try {
            if (editCategoryId) {
                await fetch(`http://localhost:3000/api/category/update/${editCategoryId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: bodyData
                })
                    .then(res => console.log(res));
                await showAlert("Kategoriya nomi o'zgartirildi")
            } else {
                await fetch('http://localhost:3000/api/category/create', {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: bodyData
                })
                    .then(res => console.log(res));
                await showAlert("Yangi kategoriya saqlandi")
            }
            window.location.reload();
        } catch (err) {
            alert("Saqlashda xatolik yuz berdi!");
            console.error(err);
        }

        categoryModal.classList.add('hidden');
    });

});
