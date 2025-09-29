//renderer/loginrenderer.js:
window.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.querySelector('#login-form');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const messageBox = document.getElementById('message');
  const toggle = document.querySelector('#toggle-password');
  const submitBtn = loginForm.querySelector('button[type="submit"]');

  messageBox.className = 'alert d-none';
  usernameInput.focus();
  
  // Parol ko'rsatish/berkitish
  toggle.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    toggle.textContent = isHidden ? '🙈' : '👁️';
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    let username = usernameInput.value.trim();
    let password = passwordInput.value;

    usernameInput.classList.remove('input-error');
    passwordInput.classList.remove('input-error');
    messageBox.className = 'alert d-none';
    messageBox.textContent = '';

    if (!username) {
      messageBox.className = 'alert alert-danger';
      messageBox.textContent = "Username maydoni bo'sh!";
      usernameInput.classList.add('input-error');
      usernameInput.focus();
      return;
    }
    if (!password) {
      messageBox.className = 'alert alert-danger';
      messageBox.textContent = "Password maydoni bo'sh!";
      passwordInput.classList.add('input-error');
      passwordInput.focus();
      return;
    }

    // 🔹 Endi faqat matnni ichki span orqali o'zgartiramiz
    const btnText = submitBtn.querySelector('.btn-text');
    const progress = submitBtn.querySelector('.progress-bar');
    const originalBtnText = btnText ? btnText.textContent : 'Login';

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');

    try {
      const result = await window.authAPI.attemptLogin({ username, password });

      if (result?.success) {
        messageBox.className = 'alert alert-success';
        messageBox.textContent = '✅ Muvaffaqiyatli!';
        // 🔹 Success animatsiyasi: progress bar to'lsin (2s)
        if (btnText) btnText.textContent = 'Yuklanmoqda...';
        if (progress) {
          progress.style.right = '0%';
        }

        setTimeout(() => {
          // Reset progress (keyingi login uchun)
          if (progress) progress.style.right = '100%';
          if (btnText) btnText.textContent = originalBtnText;

          if (window.authAPI?.afterLoginSuccess) {
            window.authAPI.afterLoginSuccess();
          }
        }, 1500);

      } else {
        messageBox.className = 'alert alert-danger';
        messageBox.textContent = result?.message || "❌ Username yoki parol noto'g'ri!";
        usernameInput.classList.add('input-error');
        passwordInput.classList.add('input-error');
        passwordInput.select();
      }
    } catch (err) {
      console.error('Renderer login error:', err);
      messageBox.className = 'alert alert-danger';
      messageBox.textContent = '❌ Tarmoq yoki ichki xatolik. Qayta urinib ko‘ring.';
    } finally {
      // Tugmani faqat muvaffaqiyatsiz holatda qayta yoqamiz.
      // Muvaffaqiyatda 2s ichida afterLoginSuccess chaqiriladi, keyin oynani yopasiz.
      setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        if (btnText) btnText.textContent = originalBtnText;
      }, 2000);
    }
  });
});
