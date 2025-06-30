let alertBox;
let resolveConfirm;

export function showAlert(message) {
  const alertMessage = document.getElementById("alertMessage");
  alertBox = document.getElementById("customAlert");
  if (alertBox && alertMessage) {
    alertMessage.textContent = message;
    alertBox.classList.remove("hidden");
    document.getElementById("cancelAlertBtn").style.display = "none";
  }
}

export function showConfirm(message) {
  const alertMessage = document.getElementById("alertMessage");
  alertBox = document.getElementById("customAlert");

  if (alertBox && alertMessage) {
    alertMessage.textContent = message;
    alertBox.classList.remove("hidden");
    document.getElementById("cancelAlertBtn").style.display = "inline-block";

    return new Promise((resolve) => {
      resolveConfirm = resolve;
    });
  }
}

// ✅ Delegated click listener
document.addEventListener("click", (e) => {
  if (e.target.id === "confirmAlertBtn") {
    const alertBox = document.getElementById("customAlert");
    alertBox?.classList.add("hidden");
    if (resolveConfirm) resolveConfirm(true);
  }

  if (e.target.id === "cancelAlertBtn") {
    const alertBox = document.getElementById("customAlert");
    alertBox?.classList.add("hidden");
    if (resolveConfirm) resolveConfirm(false);
  }
});
