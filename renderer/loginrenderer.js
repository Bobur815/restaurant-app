//renderer/loginrenderer.js:


window.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.querySelector('#login-form');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const messageBox = document.getElementById('message');
  const toggle = document.querySelector('#toggle-password');
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  const rememberText = document.querySelector('.remember-text');
  const rememberCheck = document.querySelector('.remember')

  const REMEMBER_KEY = 'savdochef_login_remember';

  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}');
    if (saved?.username) {
      
      usernameInput.value = saved.username;
      passwordInput.focus();
      if (rememberCheck) rememberCheck.checked = true;
    } else {
  usernameInput.focus();

    }
      
  } catch { /* ignore corrupted storage */ }


  rememberText.addEventListener('click', (e) => {
    if (!(rememberText instanceof HTMLLabelElement)) {
      e.preventDefault();
      if (rememberCheck) {
        rememberCheck.checked = !rememberCheck.checked;
      }
    }
  });

  messageBox.className = 'alert invisible';
  
  // update icon + aria
function setVisibleState(isVisible) {
  toggle.src = isVisible ? '../img/icons8-hide-50.png' : '../img/icons8-show-50.png';
  toggle.title = isVisible ? 'Hide Password' : 'Show Password';
  toggle.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
  toggle.setAttribute('aria-pressed', String(isVisible));
}

function togglePassword() {
  const isVisible = passwordInput.type === 'text';
  // optional: keep cursor position (nice UX)
  const start = passwordInput.selectionStart, end = passwordInput.selectionEnd;

  passwordInput.type = isVisible ? 'password' : 'text';
  setVisibleState(!isVisible);

  // restore selection if possible
  try {
    passwordInput.setSelectionRange(start, end);
  } catch {}
  passwordInput.focus();
}

toggle.addEventListener('click', togglePassword);

// keyboard support (Enter/Space)
toggle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    togglePassword();
  }
});

// init
setVisibleState(false);

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    let username = usernameInput.value.trim();
    let password = passwordInput.value;

    usernameInput.classList.remove('input-error');
    passwordInput.classList.remove('input-error');
    messageBox.className = 'alert invisible';
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
      const result = await window.electronAPI.attemptLogin({ username, password });

      if (result?.success) {
        messageBox.className = 'alert alert-success';
        messageBox.textContent = '✅ Muvaffaqiyatli!';
        // 🔹 Success animatsiyasi: progress bar to'lsin (2s)
        if (btnText) btnText.textContent = 'Yuklanmoqda...';
        if (progress) {
          progress.style.right = '0%';
        }

        if (result?.success) {
          // Save/clear remembered username
          if (rememberCheck?.checked) {
            localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username }));
          } else {
            localStorage.removeItem(REMEMBER_KEY);
          }

          // (rest of your success code stays the same)
        }

        setTimeout(() => {
          // Reset progress (keyingi login uchun)
          if (progress) progress.style.right = '100%';
          if (btnText) btnText.textContent = originalBtnText;

          if (window.electronAPI?.afterLoginSuccess) {
            window.electronAPI.afterLoginSuccess();
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
      // Muvaffaqiyatda 1.5s ichida afterLoginSuccess chaqiriladi, keyin oynani yopasiz.
      setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
        if (btnText) btnText.textContent = originalBtnText;
      }, 1500);
    }
  });
});
