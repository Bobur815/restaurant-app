import { loadMenuData,openModal } from "./mainrenderer.js";
import { showAlert } from "../utils/alert.js";

const clickSound = new Audio('../sounds/mixkit.wav');
clickSound.preload = 'auto';

export function loadMenuPage() {
    loadMenuData();

    document.querySelector('.add-btn').addEventListener('click', () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});
        openModal('add');
    });

    document.querySelector('.increment').addEventListener('click', () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});
        let input = document.getElementById('productPrice');
        input.value = parseInt(input.value) + 1000;  
    });

    document.querySelector('.decrement').addEventListener('click', () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});
        let input = document.getElementById('productPrice');
        if (parseInt(input.value) > 0) {
            input.value = parseInt(input.value) - 1000;
        }
    });

    document.getElementById('uploadBtn').addEventListener('click', () => {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});
        document.getElementById('realFileInput').click();
    });

    document.getElementById('realFileInput').addEventListener('change', function() {
        clickSound.currentTime = 0;
        clickSound.play().catch(()=>{/*ignore*/});
        const fileName = this.files[0] ? this.files[0].name : '';
        document.getElementById('productImage').value = fileName;
    });
}

const saveBtn = document.getElementById('saveProduct');

document.getElementById('saveProduct').addEventListener('click', async () => {
    clickSound.currentTime = 0;
    clickSound.play().catch(()=>{/*ignore*/});
    let nameInput = document.getElementById('productName');
    let priceInput = document.getElementById('productPrice');
    let image_url = document.getElementById('productImage').value;
    let category = document.getElementById('productCategory').value;
    let description = document.getElementById('productDesc').value.trim();
    let selectedPortion = document.querySelector('input[name="portion"]:checked');
    let portions;

    selectedPortion.id === 'porsiyali' ? portions=true : portions=false;
    const dishId = saveBtn.dataset.dishId;

    let url = 'http://localhost:3000/api/menu/create';
    let method = 'POST';

    if (dishId) {
        url = `http://localhost:3000/api/menu/update/${dishId}`;
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
        category,
        portions
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
        showAlert("✅ Mahsulot qo'shildi");
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

