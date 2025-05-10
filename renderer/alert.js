let alertBox;
let resolveConfirm; // for storing the promise resolver

export function showAlert(message) {
  const alertMessage = document.getElementById('alertMessage');
  alertBox = document.getElementById('customAlert');
  if (alertBox && alertMessage) {
    alertMessage.textContent = message;
    alertBox.classList.remove('hidden');

    // Hide Cancel button for pure alerts
    document.getElementById('cancelAlertBtn').style.display = 'none';
  }
}

// ✅ confirm-style alert that returns a promise
export function showConfirm(message) {
  const alertMessage = document.getElementById('alertMessage');
  alertBox = document.getElementById('customAlert');

  if (alertBox && alertMessage) {
    alertMessage.textContent = message;
    alertBox.classList.remove('hidden');

    // Show Cancel button
    document.getElementById('cancelAlertBtn').style.display = 'inline-block';

    return new Promise((resolve) => {
      resolveConfirm = resolve;
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("confirmAlertBtn")?.addEventListener("click", () => {
    alertBox.classList.add('hidden');
    if (resolveConfirm) resolveConfirm(true);
  });

  document.getElementById("cancelAlertBtn")?.addEventListener("click", () => {
    alertBox.classList.add('hidden');
    if (resolveConfirm) resolveConfirm(false);
  });
});
