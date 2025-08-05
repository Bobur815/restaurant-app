import { categoryOptions } from "../add-load-category.js";
import { renderMenuItems } from "../orderPageHelpers.js";

const clickSound = new Audio(new URL('../../sounds/mixkit.wav', import.meta.url));
clickSound.preload = 'auto';

window.addEventListener('DOMContentLoaded', async () => {
    const productCategory = document.getElementById('productCategory');
    const menuList = document.getElementById('menuList');
    const searchInput = document.getElementById('search-input');

    // Populate your category <select>
    await categoryOptions(productCategory);

    // Helper that grabs current filters and re-renders
    const updateMenu = async () => {
        const params = {
            category: productCategory.value,
            search: searchInput.value.trim(),
        };

        await renderMenuItems(params, menuList, null, selectProduct);
    };

    // Initial load
    await updateMenu();

    // Re-render on category change
    productCategory.addEventListener('change', updateMenu);

    // Re-render on typing in the search box
    searchInput.addEventListener('input', updateMenu);
});

/**
 * Add a product to the order‐table.
 * If it’s already there, just bump the quantity.
 * @param {{ _id: string, name: string, image_url: string }} item
 * @returns {Promise<void>}
 */
export function selectProduct(item) {
    return new Promise(resolve => {
        const tableBody = document.getElementById('orderTableBody');

        // 1) If row exists, increment quantity
        const existing = document.getElementById(`order-item-${item._id}`);
        if (existing) {
            const qtyEl = existing.querySelector('.quantity');
            qtyEl.value = parseInt(qtyEl.value, 10) + 1;
            updateRowNumbers();
            return resolve();
        }

        // 2) Otherwise create a new row
        const row = document.createElement('tr');
        row.id = `order-item-${item._id}`;
        row.innerHTML = `
      <td class="index" style="font-weight: bold;"></td>
      <td>
        <img
          src="../img/${item.image_url}"
          alt="${item.name}"
          width="60" height="60"
          style="border-radius:5px;"
        >
      </td>
      <td class="name" style="font-size: 18px; font-weight:bold;">${item.name}</td>
      <td>
        <button class="decrement">−</button>
        <input type="number" class="quantity">
        <button class="increment">+</button>
      </td>
      <td>
        <button class="delete-btn">❌</button>
      </td>
    `;
        tableBody.appendChild(row);

        // 3) Wire up the buttons
        const qtyEl = row.querySelector('.quantity');
        const decBtn = row.querySelector('.decrement');
        const incBtn = row.querySelector('.increment');
        const deleteBtn = row.querySelector('.delete-btn');
        qtyEl.value = 1

        incBtn.addEventListener('click', () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(() => { });
            qtyEl.value = parseInt(qtyEl.value, 10) + 1;
        });
        decBtn.addEventListener('click', () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(() => { });
            const q = parseInt(qtyEl.value, 10);
            if (q > 1) qtyEl.value = q - 1;
        });
        deleteBtn.addEventListener('click', () => {
            clickSound.currentTime = 0;
            clickSound.play().catch(() => { });
            row.remove();
            updateRowNumbers();
        });

        // 4) Update the “№” column for all rows
        updateRowNumbers();

        resolve();
    });
}

/** Recalculate the “№” cell for each row */
function updateRowNumbers() {
    const tableBody = document.getElementById('orderTableBody');
    tableBody.querySelectorAll('tr').forEach((tr, i) => {
        const idxCell = tr.querySelector('.index');
        idxCell.textContent = i + 1;
    });
}
