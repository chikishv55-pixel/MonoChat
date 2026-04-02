const SERVER_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? `http://${window.location.hostname}:3000`
    : (window.location.protocol === 'file:' || !window.location.hostname)
        ? 'http://5.35.95.248:3000' // Fallback for Capacitor/Electron if not hosted
        : window.location.origin;

// Заглушки, чтобы избежать ReferenceError при загрузке
window.loadStories = window.loadStories || function() { console.log('Stories script not yet ready...'); };
window.loadRecentChats = window.loadRecentChats || function() { console.log('Chat list script not yet ready...'); };

const socket = io(SERVER_URL);

socket.on('connect_error', (error) => {
    console.error('Ошибка подключения Socket.IO:', error);
});

// --- Глобальные переменные состояния ---
let currentUser = null;
let fcmToken = null;
let currentChatUser = null;
let messageToDeleteId = null;
let myContacts = {};
let mediaRecorder;
let audioChunks = [];
let newGroupMembers = new Set();
let voiceStartTime = 0;
let cropper;
let messageCropper;
let replyContext = null;
let forwardMessageId = null;
let typingTimer;
const typingTimeout = 2000; // 2 секунды
let isCurrentlyTyping = false;
const typingUsers = new Map(); // chatId -> Set of displayNames
let currentCommentMessageId = null;
let isPremium = false;

let imageViewerData = {
    sources: [],
    currentIndex: 0
};

// Вспомогательная функция для получения полных URL адресов картинок
function getFullUrl(path) {
    if (path && path.startsWith('/uploads/')) {
        return SERVER_URL + path;
    }
    return path;
}

function isVideoPath(path) {
    if (!path) return false;
    const ext = path.split('.').pop().toLowerCase();
    return ['mp4', 'webm', 'ogg', 'mov'].includes(ext);
}

function renderAvatarHTML(avatar, displayName, className = 'avatar', isPremiumUser = false) {
    const safeName = escapeHTML(displayName);
    const firstChars = safeName.substring(0, 2).toUpperCase();
    let html = '';
    
    if (!avatar) {
        html = `<div class="${className}">${firstChars}</div>`;
    } else {
        const url = escapeHTML(getFullUrl(avatar));
        if (isVideoPath(avatar)) {
            html = `<video class="${className}" src="${url}" autoplay loop muted playsinline></video>`;
        } else {
            html = `<img class="${className}" src="${url}">`;
        }
    }

    if (isPremiumUser) {
        // We append the star inside the same wrapper if needed, 
        // but often the star is placed next to the name.
        // For consistent UI, let's keep it next to the name in chat list/header,
        // but maybe a small badge on the avatar itself is also good.
        // For now, we'll return JUST the avatar element.
    }
    return html;
}

/**
 * Безопасно экранирует HTML-строку для предотвращения XSS.
 * @param {string} str Входная строка.
 * @returns {string} Экранированная строка.
 */
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function createMessageSnippet(message) {
    if (!message) return 'Нет сообщений';
    let snippet = '';
    if (message.type === 'text') snippet = message.text;
    else if (message.type === 'image') snippet = 'Фото';
    else if (message.type === 'gallery') snippet = 'Галерея';
    else if (message.type === 'audio') snippet = 'Голосовое сообщение';
    else if (message.type === 'circle_video') snippet = 'Видеосообщение';
    else if (message.type === 'sticker') snippet = 'Стикер';
    else snippet = 'Сообщение';

    const senderPrefix = message.sender === currentUser.username ? 'Вы: ' : '';
    return `${senderPrefix}${snippet}`;
}

window.addEventListener('load', () => {
    try {
        if (typeof initEmojiPicker === 'function') initEmojiPicker();
    } catch (e) {
        console.error('Ошибка инициализации EmojiPicker:', e);
    }

    let savedTheme = localStorage.getItem('appTheme');
    if (!savedTheme && localStorage.getItem('darkTheme') === 'true') savedTheme = 'dark-theme'; // Миграция со старой версии
    if (savedTheme && savedTheme !== 'theme-light') document.body.classList.add(savedTheme);

    const hideSplash = () => {
        const beep = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ9vT19vT19vT19vT19vT19vT19vT19v');
        beep.play().catch(() => { });
        const splash = document.getElementById('splash-screen');
        splash.style.opacity = '0';
        setTimeout(() => splash.style.display = 'none', 600);
    };

    const token = localStorage.getItem('monochrome_token');
    if (token) {
        fetch(SERVER_URL + '/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } })
            .then(res => {
                if (res.status === 401 || res.status === 403) {
                    throw new Error('AUTH_FAILED');
                }
                return res.json();
            })
            .then(res => {
                if (res.success) {
                    isPremium = !!res.user.is_premium;
                    try {
                        socket.auth = { token: token };
                        socket.disconnect().connect();
                        authSuccess(res.user);
                    } catch (err) {
                        console.error('Ошибка при инициализации профиля:', err);
                    }
                    hideSplash();
                } else {
                    throw new Error('AUTH_FAILED');
                }
            }).catch(e => {
                if (e.message === 'AUTH_FAILED') {
                    localStorage.removeItem('monochrome_token');
                    localStorage.removeItem('monochrome_user');
                    document.getElementById('auth-screen').classList.add('active');
                } else {
                    // Сетевая ошибка или сервер временно недоступен - даем дойти до экрана логина без удаления токена
                    console.warn('Auto-login network error, keeping token:', e);
                    document.getElementById('auth-screen').classList.add('active');
                }
                hideSplash();
            });
    } else {
        document.getElementById('auth-screen').classList.add('active');
        hideSplash();
    }

    // ГАРАНТИЯ: Если через 5 секунд заставка все еще висит — убираем её в любом случае
    setTimeout(hideSplash, 5000);

    const messageInput = document.getElementById('message-text');
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Prevent new line on enter
            sendTextMessage();
        }
    });

    document.getElementById('comment-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendComment();
        }
    });

    messageInput.addEventListener('paste', (e) => {
        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData || !clipboardData.items) return;

        const items = clipboardData.items;
        const files = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                if (file) files.push(file);
            }
        }

        if (files.length > 0) {
            e.preventDefault();

            if (files.length === 1) {
                const reader = new FileReader();
                reader.onload = ev => openMessageCropModal(ev.target.result);
                reader.readAsDataURL(files[0]);
            } else {
                const readAsDataURL = (file) => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = ev => resolve(ev.target.result);
                    reader.onerror = ev => reject(ev);
                    reader.readAsDataURL(file);
                });

                Promise.all(files.map(readAsDataURL))
                    .then(images => {
                        images.forEach((img, index) => setTimeout(() => emitMessage(img, 'image'), index * 300));
                    })
                    .catch(err => alert("Не удалось загрузить вставленные изображения."));
            }
        }
    });

    messageInput.addEventListener('input', () => {
        const text = messageInput.value.trim();
        const inputArea = document.getElementById('message-input-area');
        if (text.length > 0) {
            inputArea.classList.add('has-text');
        } else {
            inputArea.classList.remove('has-text');
        }

        if (!currentChatUser) return;
        if (!isCurrentlyTyping) {
            isCurrentlyTyping = true;
            socket.emit('start typing', { chatId: currentChatUser.username });
        }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            socket.emit('stop typing', { chatId: currentChatUser.username });
            isCurrentlyTyping = false;
        }, typingTimeout);
    });

    // =====================================================================
    // FIX: Клавиатура на мобильных не прокручивает чат вниз
    // visualViewport API отслеживает реальный видимый viewport (без клавиатуры).
    // При его изменении — принудительно оставляем скролл у последнего сообщения.
    // =====================================================================
    if (window.visualViewport) {
        let lastScrollHeight = 0;
        window.visualViewport.addEventListener('resize', () => {
            const messagesArea = document.getElementById('messages-area');
            if (!messagesArea) return;
            // Если высота viewport уменьшилась (открылась клавиатура)
            // — держим скролл у последнего сообщения
            if (messagesArea.scrollHeight !== lastScrollHeight || messagesArea.scrollTop < messagesArea.scrollHeight - messagesArea.clientHeight - 10) {
                requestAnimationFrame(() => {
                    messagesArea.scrollTop = messagesArea.scrollHeight;
                });
            }
            lastScrollHeight = messagesArea.scrollHeight;
        });
    }

    // =====================================================================
    // FIX: Инициализируем AudioContext при первом касании/клике пользователя.
    // Без этого браузер блокирует воспроизведение аудио (autoplay policy).
    // initRingtoneAudio() определена в webrtc.js
    // =====================================================================
    const unlockAudio = () => {
        if (typeof initRingtoneAudio === 'function') initRingtoneAudio();
        document.removeEventListener('touchstart', unlockAudio, true);
        document.removeEventListener('click', unlockAudio, true);
    };
    document.addEventListener('touchstart', unlockAudio, true);
    document.addEventListener('click', unlockAudio, true);
});


document.addEventListener('keydown', (e) => {
    if (!currentUser) return;
    // Обновляем футер (PC)
    const nameFooter = document.getElementById('my-name-footer');
    const avatarFooter = document.getElementById('my-avatar-footer');
    
    if (nameFooter && currentUser) nameFooter.textContent = currentUser.display_name;
    if (avatarFooter) {
        avatarFooter.textContent = '';
        if (currentUser.avatar) {
            if (currentUser.avatar.endsWith('.mp4') || currentUser.avatar.endsWith('.webm')) {
                avatarFooter.innerHTML = `<video src="${currentUser.avatar}" autoplay loop muted playsinline></video>`;
            } else {
                avatarFooter.style.backgroundImage = `url(${currentUser.avatar})`;
            }
        } else {
            avatarFooter.textContent = currentUser.display_name[0].toUpperCase();
        }
    }
    const viewer = document.getElementById('image-viewer');
    if (viewer.classList.contains('active')) {
        if (e.key === 'Escape') {
            closeImageViewer();
        } else if (e.key === 'ArrowRight') {
            nextImage();
        } else if (e.key === 'ArrowLeft') {
            prevImage();
        }
    }
});

function toggleTheme() {
    const themesList = ['theme-light', 'dark-theme', 'theme-ocean', 'theme-oled'];
    let currentTheme = localStorage.getItem('appTheme');
    if (!currentTheme && localStorage.getItem('darkTheme') === 'true') currentTheme = 'dark-theme';
    if (!currentTheme) currentTheme = 'theme-light';

    let idx = themesList.indexOf(currentTheme);
    let nextTheme = themesList[(idx + 1) % themesList.length];

    themesList.forEach(t => document.body.classList.remove(t));
    if (nextTheme !== 'theme-light') document.body.classList.add(nextTheme);

    localStorage.setItem('appTheme', nextTheme);
    localStorage.removeItem('darkTheme'); // Очищаем старый формат, чтобы не путался
}
