import { loadMenuData,openModal } from "./mainrenderer.js";

export function loadMenuPage() {
    loadMenuData();

    document.querySelector('.add-btn').addEventListener('click', () => {
        openModal('add');
    });

    document.querySelector('.increment').addEventListener('click', () => {
        let input = document.getElementById('productPrice');
        input.value = parseInt(input.value) + 1000;  
    });

    document.querySelector('.decrement').addEventListener('click', () => {
        let input = document.getElementById('productPrice');
        if (parseInt(input.value) > 0) {
            input.value = parseInt(input.value) - 1000;
        }
    });

    document.getElementById('uploadBtn').addEventListener('click', () => {
        document.getElementById('realFileInput').click();
    });

    document.getElementById('realFileInput').addEventListener('change', function() {
        const fileName = this.files[0] ? this.files[0].name : '';
        document.getElementById('productImage').value = fileName;
    });
}
const saveBtn = document.getElementById('saveProduct');
document.getElementById('saveProduct').addEventListener('click', async () => {
    let nameInput = document.getElementById('productName');
    let priceInput = document.getElementById('productPrice');
    let image_url = document.getElementById('productImage').value;
    let category = document.getElementById('productCategory').value;
    let description = document.getElementById('productDesc').value.trim();
    const dishId = saveBtn.dataset.dishId;

    let url = 'http://localhost:3000/api/menu';
    let method = 'POST';

    if (dishId) {
        url = `http://localhost:3000/api/menu/${dishId}`;
        method = 'PUT';
    }

    let name = nameInput.value.trim();
    let price = priceInput.value.trim();

    nameInput.style.border = '';
    priceInput.style.border = '';

    nameInput.addEventListener('input', () => {
        if (nameInput.value.trim()) {
            nameInput.style.border = '';
        }
    });
    priceInput.addEventListener('input', () => {
        if (priceInput.value.trim()) {
            priceInput.style.border = '';
        }
    });

    if (!name || !parseInt(price)) {

        if (!name) {
            nameInput.style.border = '2px solid red';
        }
        if (!parseInt(price)) {
            priceInput.style.border = '2px solid red';
        }

        return;
    }
    
    const newItem = {
        name,
        price,
        image_url,
        description,
        category
    };

    try {
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newItem)
        });

        const data = await response.json();
        alert("✅ Qo'shildi");
        document.getElementById('addModal').style.display = 'none';
        loadMenuData()
        nameInput.value = '';
        priceInput.value = '';
        document.getElementById('productImage').value = '';
        document.getElementById('productDesc').value = '';
    } catch (error) {
        console.error("Xato:", error);
    }
});

