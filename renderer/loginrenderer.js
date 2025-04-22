window.addEventListener('DOMContentLoaded', () => {

  const loginForm = document.querySelector('#login-form');   // 🔹 Formani olish
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const messageBox = document.getElementById('message');
  const toggle = document.querySelector("#toggle-password");
  messageBox.classList.remove('d-none');

  toggle.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    toggle.textContent = isHidden ? "🙈" : "👁️";
  });

  // ⭐ ENTER va BUTTON uchun umumiy submit hodisa
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();  

    let username = usernameInput.value.trim();
    let password = passwordInput.value.trim();

    usernameInput.classList.remove('input-error');
    passwordInput.classList.remove('input-error');

    if (!username) {
      messageBox.className = "alert alert-danger";
      messageBox.textContent = "Username maydoni bo'sh!";
      usernameInput.classList.add('input-error');

      usernameInput.focus();
      return;
    }

    if (!password) {
      messageBox.className = "alert alert-danger";
      messageBox.textContent = "Password maydoni bo'sh!";
      passwordInput.classList.add('input-error');

      passwordInput.focus();
      return;
    }

    window.electronAPI.sendLogin({ username, password });
  });

  window.electronAPI.receiveLoginResult((result) => {
    if (result.success) {
      messageBox.className = "alert alert-success";
      messageBox.textContent = "✅ Muvaffaqqiyatli!";
    } else {
      messageBox.className = "alert alert-danger";
      messageBox.textContent = "❌ Username yoki parol noto'g'ri!";
      usernameInput.classList.add('input-error');
      passwordInput.classList.add('input-error');
    }
  });

});
