import { PORTIONS } from "../utils/config_porsiya.js";
import { deleteDish, editDish } from "./mainrenderer.js";

// Render all category cards (async-friendly)
export async function renderCategoryItems(categoryItems, catGrid) {
  // 1) Resolve all image URLs in parallel (keeps original order)
  const imgUrls = await Promise.all(
    categoryItems.map(dish => window.electronAPI.getImagePath(dish))
  );

  // 2) Build cards in order
  for (let i = 0; i < categoryItems.length; i++) {
    const dish = categoryItems[i];
    const imgPath = imgUrls[i];

    const card = document.createElement('div');
    card.classList.add('card');
    card.dataset.originalPrice = String(dish.price ?? 0);

    // portions blocks
    let portionHTML = '';
    let soldByWeightHtml = '';

    if (dish.soldByWeight) {
      soldByWeightHtml = '<div class="portions portions-weight"><small>Kg: </small>' +
        PORTIONS.map((p, idx) =>
          `<span class="${p.value === 1.0 ? 'active' : ''}" data-portion="${p.value}">${p.value}</span>${idx !== PORTIONS.length - 1 ? ' | ' : ''}`
        ).join('') +
      '</div>';
    }

    if (dish.portions) {
      portionHTML = '<div class="portions portions-count"><small>Portion: </small>' +
        PORTIONS.map((p, idx) =>
          `<span class="${p.value === 1.0 ? 'active' : ''}" data-portion="${p.value}">${p.value}</span>${idx !== PORTIONS.length - 1 ? ' | ' : ''}`
        ).join('') +
      '</div>';
    }

    card.innerHTML = `
      <img src="${imgPath}" alt="${dish.name}">
      <h3>${dish.name ?? ''}</h3>
      <p>${dish.description ?? ''}</p>
      <strong class="price-line">
        <span class="price-text">${dish.price ?? 0} UZS</span> 
        ${dish.soldByWeight ? '<span class="unit">/ kg</span>' : ''}
      </strong>
      ${portionHTML}
      ${soldByWeightHtml}
      <div class="card-buttons">
        <button class="edit-btn" title="Edit">
          <img src="../img/edit-icon.png" alt="edit">
        </button>
        <button class="delete-btn" title="Delete">
          <img src="../img/delete-icon.png" alt="delete">
        </button>
      </div>
    `;

    // 3) Local (scoped) listeners

    // Portions click (works for both .portions-count and .portions-weight)
    card.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      // Portion span clicked?
      if (target.matches('.portions span')) {
        // sound
        if (typeof clickSound !== 'undefined' && clickSound) {
          clickSound.currentTime = 0;
          clickSound.play().catch(() => {});
        }

        // activate only within the same .portions group
        const group = target.closest('.portions');
        if (!group) return;

        group.querySelectorAll('span').forEach(s => s.classList.remove('active'));
        target.classList.add('active');

        // recalc price from original (stored on card)
        const priceEl = card.querySelector('.price-text');
        const originalPrice = parseFloat(card.dataset.originalPrice || '0');
        const portionValue = parseFloat(target.dataset.portion || target.textContent || '1');

        // round to integer UZS like before (you can tweak)
        const newPrice = Math.round(originalPrice * portionValue);
        if (priceEl) priceEl.textContent = `${newPrice} UZS`;
      }
    });

    // Edit
    const editBtn = card.querySelector('.edit-btn');
    editBtn?.addEventListener('click', () => {
      if (typeof clickSound !== 'undefined' && clickSound) {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => {});
      }
      editDish?.(dish.id);
    });

    // Delete
    const deleteBtn = card.querySelector('.delete-btn');
    deleteBtn?.addEventListener('click', () => {
      if (typeof clickSound !== 'undefined' && clickSound) {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => {});
      }
      
      deleteDish?.(dish.id);
    });

    // 4) Append
    catGrid.appendChild(card);
  }
}
