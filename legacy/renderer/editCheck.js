import { showAlert } from "../utils/alert.js";
import { paymentMethods } from "../utils/paymentMethods.js";
import { payStatuses } from "../utils/payStatuses.js";
import { loadChecks} from "./checks.js";

export function openEditModal(orderNumber, currentMethod, currentStatus) {
    
    // a) create the modal container if it doesn’t already exist
    let modal = document.getElementById('editModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'editModal';
      modal.classList.add('modal', 'hidden');
      document.body.appendChild(modal);
    }
  
    // b) populate the two selects
    const pmSelect = modal.querySelector('#edit-payment-method');
    const stSelect = modal.querySelector('#edit-status');
    pmSelect.innerHTML = Object.entries(paymentMethods)
      .map(([key, label]) =>
        `<option value="${key}" ${key === currentMethod ? 'selected' : ''}>${label}</option>`
      ).join('');
    stSelect.innerHTML = Object.entries(payStatuses)
      .map(([key, label]) =>
        `<option value="${key}" ${key === currentStatus ? 'selected' : ''}>${label}</option>`
      ).join('');
  
    // c) show the modal
    modal.classList.remove('hidden');
  
    // d) wire up Save / Cancel
    const onClose = () => {
      modal.classList.add('hidden');
    };
    modal.querySelector('#editCancelBtn').onclick = onClose;
    modal.querySelector('#editCloseBtn').onclick = onClose;

    modal.querySelector('#editSaveBtn').onclick = async () => {
      const newMethod = pmSelect.value;
      const newStatus = stSelect.value;
  
      try {
        const res = await fetch(
          `http://localhost:3000/api/payment/${orderNumber}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              payment_method: newMethod,
              status: newStatus
            })
          }
        );
        if (!res.ok) throw new Error(await res.text());
        showAlert('✅ O\'zgartirildi!');
        // re-load the list
        
        const today = new Date().toISOString().split('T')[0];
        loadChecks(
          document.querySelector('#startDate').value,
          document.querySelector('#endDate').value,
          document.querySelector('#stol').value,
          document.querySelector('#pay-method').value,
          document.querySelector('#status').value
        );
      } catch (err) {
        console.error(err);
        showAlert('❌ Tahrirlashda xatolik');
      } finally {
        onClose();
      }
    };
  }