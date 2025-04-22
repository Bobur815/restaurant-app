window.addEventListener('DOMContentLoaded', () => {
  const information = document.getElementById('info');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.querySelector(".submit-btn");
  const toggle = document.querySelector("#toggle-password");

  toggle.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    toggle.textContent = isHidden ? "🙈" : "👁️";
  })

  loginBtn.addEventListener('click', (e) => {
    e.preventDefault(); // prevents form from refreshing the page
    let username = usernameInput.value.trim()
    let password = passwordInput.value.trim()

    if (!username || !password) {
      return;
    }

    // Send login data to main process
    window.electronAPI.sendLogin({ username, password });
  });


  window.electronAPI.receiveLoginResult((result) => {
    const messageBox = document.getElementById('message');
  
    if (result.success) {
      messageBox.style.color = 'green';
      messageBox.textContent = "✅ Muvaffaqqiyatli!";
      // Keyingi UI jarayonlarini shu yerda bajaramiz
    } else {
      messageBox.style.color = 'red';
      messageBox.textContent = "❌ Username yoki parol noto'g'ri!";
      
      // Inputlarni tozalash (xohlasang)
      usernameInput.value = "";
      passwordInput.value = "";
      
      // Fokus qayta inputga tushsin
      usernameInput.focus();
    }
  });
  

});
