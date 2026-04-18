let resendTimer = 0;

function showLogin() { 
    document.getElementById('login-card').classList.remove('hidden'); 
    document.getElementById('register-card').classList.add('hidden'); 
    document.getElementById('verify-card').classList.add('hidden'); 
}
function showRegister() { 
    document.getElementById('login-card').classList.add('hidden'); 
    document.getElementById('register-card').classList.remove('hidden'); 
    document.getElementById('verify-card').classList.add('hidden'); 
}
function showVerify() {
    document.getElementById('login-card').classList.add('hidden');
    document.getElementById('register-card').classList.add('hidden');
    document.getElementById('verify-card').classList.remove('hidden');
}

function showHelp() { showAlert('МОНОХРОМ — приватный, быстрый мессенджер с шифрованием.', 'О приложении', 'ℹ️'); }

function closeAllModals() {
    document.getElementById('main-overlay').classList.remove('active');
    document.getElementById('profile-modal').classList.remove('active');
    document.getElementById('delete-modal').classList.remove('active');
    document.getElementById('create-chat-modal').classList.remove('active');
    document.getElementById('group-info-modal').classList.remove('active');
    document.getElementById('edit-group-modal').classList.remove('active');
    document.getElementById('my-profile-modal').classList.remove('active');
    const adminPanel = document.getElementById('admin-panel-modal');
    if (adminPanel) {
        adminPanel.classList.remove('active');
        adminPanel.style.display = 'none';
    }
    document.getElementById('forward-modal').classList.remove('active');
    document.getElementById('new-chat-choice-modal').classList.remove('active');
    document.getElementById('story-preview-modal').classList.remove('active');
    document.getElementById('music-modal').classList.remove('active');
    const picker = document.getElementById('emoji-picker');
    if (picker) picker.classList.remove('active');
    closeMessageCropModal();
    closeCommentsModal();
    cancelReply();
    closeReactionPicker();
    closeImageViewer();
    closeCropModal();
}

function authSuccess(user) {
    localStorage.setItem('monochrome_user', JSON.stringify(user));
    // Ensure all fields are present
    user.bio = user.bio || '';
    user.birth_date = user.birth_date || '';
    currentUser = user;
    isPremium = !!user.is_premium;
    
    // Update IDs that actually exist in index.html
    const nameFooter = document.getElementById('my-name-footer');
    const footerStatus = document.querySelector('.profile-footer .profile-status');
    const namePanel = document.getElementById('my-profile-name-modal');
    const usernamePanel = document.getElementById('my-profile-username-modal');
    const settingsDisplayName = document.getElementById('settings-display-name');

    if (nameFooter) {
        let badgesHTML = '';
        if (user.is_admin) badgesHTML += '<span class="premium-badge-mini admin">ADMIN</span>';
        else if (user.is_premium) badgesHTML += '<span class="premium-badge-mini">★</span>';
        
        nameFooter.innerHTML = `<div style="display:flex; align-items:center; gap:6px;">
            ${escapeHTML(user.display_name)} ${badgesHTML}
        </div>`;
    }
    if (footerStatus) {
        footerStatus.textContent = 'в сети';
        footerStatus.style.color = '#2ecc71';
    }
    if (namePanel) namePanel.textContent = user.display_name;
    if (usernamePanel) usernamePanel.textContent = '@' + user.username;
    if (settingsDisplayName) settingsDisplayName.textContent = user.display_name;

    updateAllMyAvatars(user.avatar, user.display_name);
    updateMyMusicUI(user.music_status);
    if (typeof updatePremiumUI === 'function') updatePremiumUI();
    
    socket.emit('get contacts', (contacts) => {
        myContacts = {};
        contacts.forEach(c => myContacts[c.contact_username] = c.alias);
        
        const authScreen = document.getElementById('auth-screen');
        const chatScreen = document.getElementById('chat-screen');
        if (authScreen) authScreen.classList.remove('active');
        if (chatScreen) chatScreen.classList.add('active');

        // Safety checks for deferred scripts
        if (typeof loadRecentChats === 'function') loadRecentChats();
        if (typeof loadStories === 'function') loadStories();
    });
}

async function login() {
    const username = document.getElementById('username-input').value.trim();
    const password = document.getElementById('password-input').value;
    if (!username || !password) return showAlert('Введите имя пользователя и пароль.', 'Внимание', '⚠️');
    try {
        const response = await fetch(SERVER_URL + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, fcmToken: localStorage.getItem('fcm_token') || fcmToken })
        });
        const res = await response.json();
        if (res.success) {
            localStorage.setItem('monochrome_token', res.token);
            socket.auth = { token: res.token };
            socket.disconnect().connect();
            authSuccess(res.user);
        } else {
            showAlert(res.message || 'Ошибка входа.', 'Ошибка', '❌');
            // Если аккаунт не подтвержден, показываем поле ввода кода (бэкенд вернет 403)
            if (response.status === 403) {
                document.getElementById('reg-username').value = username;
                showVerify();
            }
        }
    } catch (err) { 
        console.error('Login error:', err);
        showAlert('Ошибка соединения. Проверьте подключение к серверу.', 'Ошибка сети', '🔌');
    }
}

async function register() {
    try {
        const displayName = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const username = document.getElementById('reg-username').value.trim();
        const password = document.getElementById('reg-password').value;
        const passwordCheck = document.getElementById('reg-password-confirm').value;

        if (!email.includes('@')) {
            showAlert('Введите корректный email адрес.', 'Ошибка', '❌');
            return;
        }
        if (password !== passwordCheck) {
            showAlert('Пароли не совпадают!', 'Ошибка', '❌');
            return;
        }

        const response = await fetch(SERVER_URL + '/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, displayName, password, email })
        });
        const data = await response.json();
        if (data.success) {
            showAlert('Регистрация успешна! Введите код подтверждения из вашей почты.', 'Готово', '✅');
            showVerify();
        } else {
            showAlert(data.message || 'Ошибка регистрации.', 'Ошибка', '❌');
        }
    } catch (err) {
        console.error(err);
        showAlert('Ошибка соединения с сервером.', 'Ошибка сети', '🔌');
    }
}

async function verifyCode() {
    const username = document.getElementById('reg-username').value.trim();
    const code = document.getElementById('verify-code-input').value.trim();
    if (code.length !== 6) return showAlert('Введите 6-значный код.', 'Внимание', '⚠️');

    try {
        const response = await fetch(SERVER_URL + '/api/auth/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, code })
        });
        const data = await response.json();
        if (data.success) {
            showAlert(data.message, 'Успех', '✅');
            showLogin();
        } else {
            showAlert(data.message || 'Неверный код.', 'Ошибка', '❌');
        }
    } catch (err) { 
        console.error('Verify code error:', err);
        showAlert('Ошибка при проверке кода.', 'Ошибка сети', '🔌');
    }
}

async function resendCode() {
    if (resendTimer > 0) return;
    
    const username = document.getElementById('reg-username').value.trim();
    if (!username) return showAlert('Сначала введите ваш юзернейм в поле регистрации.', 'Внимание', '⚠️');

    try {
        const response = await fetch(SERVER_URL + '/api/auth/resend-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await response.json();
        showAlert(data.message, data.success ? 'Готово' : 'Ошибка', data.success ? '✅' : '❌');
        
        if (data.success) {
            startResendTimer(60);
        }
    } catch (err) {
        showAlert('Ошибка при повторной отправке.', 'Ошибка сети', '🔌');
    }
}

function startResendTimer(seconds) {
    resendTimer = seconds;
    const btn = document.getElementById('resend-code-btn');
    btn.disabled = true;
    
    const interval = setInterval(() => {
        resendTimer--;
        if (resendTimer <= 0) {
            clearInterval(interval);
            btn.textContent = 'отправить код повторно';
            btn.disabled = false;
        } else {
            btn.textContent = `отправить повторно (${resendTimer}с)`;
        }
    }, 1000);
}

// Banned Notification
if (typeof socket !== 'undefined') {
    socket.on('banned_notification', () => {
        // Скрываем весь интерфейс чата
        const chatScreen = document.getElementById('chat-screen');
        if (chatScreen) chatScreen.classList.remove('active');

        // Показываем banned overlay
        const overlay = document.getElementById('banned-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        } else {
            // Fallback: показываем красивый алёрт и разлогиниваем
            showAlert('Ваш аккаунт заблокирован администратором.', 'Аккаунт заблокирован', '🚫').then(() => {
                localStorage.removeItem('monochrome_token');
                localStorage.removeItem('monochrome_user');
                window.location.reload();
            });
        }
    });
}
