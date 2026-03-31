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

function showHelp() { alert("МОНОХРОМ - приватный чат."); }

function closeAllModals() {
    document.getElementById('main-overlay').classList.remove('active');
    document.getElementById('profile-modal').classList.remove('active');
    document.getElementById('delete-modal').classList.remove('active');
    document.getElementById('create-chat-modal').classList.remove('active');
    document.getElementById('group-info-modal').classList.remove('active');
    document.getElementById('edit-group-modal').classList.remove('active');
    document.getElementById('my-profile-modal').classList.remove('active');
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
    const namePanel = document.getElementById('pm-name');
    const usernamePanel = document.getElementById('pm-username');

    if (nameFooter) nameFooter.textContent = user.display_name;
    if (namePanel) namePanel.textContent = user.display_name;
    if (usernamePanel) usernamePanel.textContent = '@' + user.username;

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
    if(!username || !password) return alert('Введите данные');
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
            alert(res.message);
            // Если аккаунт не подтвержден, показываем поле ввода кода (бэкенд вернет 403)
            if (response.status === 403) {
                document.getElementById('reg-username').value = username; // Сохраняем имя для верификации
                showVerify();
            }
        }
    } catch (err) { alert('Ошибка'); }
}

async function register() {
    try {
        const displayName = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const username = document.getElementById('reg-username').value.trim();
        const password = document.getElementById('reg-password').value;
        const passwordCheck = document.getElementById('reg-password-confirm').value;

        if (!email.includes('@')) {
            alert('Введите корректный Gmail');
            return;
        }
        if (password !== passwordCheck) {
            alert('Пароли не совпадают!');
            return;
        }

        const response = await fetch(SERVER_URL + '/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, displayName, password, email })
        });
        const data = await response.json();
        if (data.success) {
            alert('Регистрация успешна! Введите код подтверждения из вашей почты.');
            showVerify();
        } else {
            alert(data.message || 'Ошибка регистрации');
        }
    } catch (err) {
        console.error(err);
        alert('Ошибка соединения с сервером');
    }
}

async function verifyCode() {
    const username = document.getElementById('reg-username').value.trim();
    const code = document.getElementById('verify-code-input').value.trim();
    if (code.length !== 6) return alert('Введите 6-значный код');

    try {
        const response = await fetch(SERVER_URL + '/api/auth/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, code })
        });
        const data = await response.json();
        if (data.success) {
            alert(data.message);
            showLogin();
        } else {
            alert(data.message);
        }
    } catch (err) {
        alert('Ошибка при проверке кода');
    }
}

async function resendCode() {
    if (resendTimer > 0) return;
    
    const username = document.getElementById('reg-username').value.trim();
    if (!username) return alert('Ошибка: сначала введите ваш юзернейм в поле регистрации');

    try {
        const response = await fetch(SERVER_URL + '/api/auth/resend-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await response.json();
        alert(data.message);
        
        if (data.success) {
            startResendTimer(60);
        }
    } catch (err) {
        alert('Ошибка при повторной отправке');
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
        document.getElementById('banned-overlay').classList.remove('hidden');
    });
}
