

// Modalni ochish
document.querySelector('.add-btn').addEventListener('click', () => {
    document.getElementById('addModal').classList.remove('hidden');

});

// Modalni yopish
document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('addModal').classList.add('hidden');

});

document.querySelector('.increment').addEventListener('click', () => {
    let input = document.getElementById('productPrice');
    input.value = parseInt(input.value) + 1000;   // Har bosishda 1000 ga oshirish
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

document.getElementById('saveProduct').addEventListener('click', async () => {
    let nameInput = document.getElementById('productName');
    let priceInput = document.getElementById('productPrice');
    let image_url = document.getElementById('productImage').value;
    let description = document.getElementById('productDesc').value.trim();
    let errorDiv = document.getElementById('errorMessage');

    let name = nameInput.value.trim();
    let price = priceInput.value.trim();

    // Avval eski borderlarni tiklash (normal holatga)
    nameInput.style.border = '';
    priceInput.style.border = '';
    errorDiv.style.display = 'none';
    errorDiv.textContent = '';

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

    if (!name || !price) {
        
        errorDiv.textContent = "Iltimos, Mahsulot nomi va narxini kiriting!";
        errorDiv.style.display = 'block';
        if (!name) {
            nameInput.style.border = '2px solid red';
        }
        if (!price) {
            priceInput.style.border = '2px solid red';
        }
        return;
    }

    
    
    
    const newItem = {
        name,
        price,
        image_url,
        description
    };

    try {
        const response = await fetch('http://localhost:3000/api/menu', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newItem)
        });

        const data = await response.json();
        alert("✅ Qo'shildi");
        document.getElementById('addModal').style.display = 'none';
    } catch (error) {
        console.error("Xato:", error);
    }
});

