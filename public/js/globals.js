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

function renderAvatarHTML(avatar, name, className = 'avatar') {
    const finalData = avatar && avatar.startsWith('/uploads/') ? getFullUrl(avatar) : avatar;
    if (finalData) {
        if (isVideoPath(avatar)) {
            return `<video src="${finalData}" autoplay loop muted playsinline class="${className}" style="object-fit:cover; border-radius:50%;"></video>`;
        } else {
            return `<img src="${finalData}" class="${className}" style="border-radius:50%; object-fit:cover;">`;
        }
    } else {
        const text = name ? name.substring(0, 2).toUpperCase() : '??';
        return `<div class="${className}">${text}</div>`;
    }
}

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

    const senderPrefix = (message.sender && currentUser && message.sender === currentUser.username) ? 'Вы: ' : '';
    return `${senderPrefix}${snippet}`;
}

window.addEventListener('load', () => {
    try {
        if (typeof initEmojiPicker === 'function') initEmojiPicker();
    } catch (e) {
        console.error('Ошибка инициализации EmojiPicker:', e);
    }

    let savedTheme = localStorage.getItem('appTheme');
    if (!savedTheme && localStorage.getItem('darkTheme') === 'true') savedTheme = 'dark-theme'; 
    if (savedTheme && savedTheme !== 'theme-light') document.body.classList.add(savedTheme);
    
    // Sync theme selector in settings
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect && savedTheme) {
        const themeMapReverse = {
            'theme-light': 'default',
            'dark-theme': 'dark',
            'theme-ocean': 'ocean',
            'theme-oled': 'oled'
        };
        themeSelect.value = themeMapReverse[savedTheme] || 'default';
    }

    const hideSplash = () => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.style.opacity = '0';
            setTimeout(() => splash.style.display = 'none', 600);
        }
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
                    console.warn('Auto-login network error, keeping token:', e);
                    document.getElementById('auth-screen').classList.add('active');
                }
                hideSplash();
            });
    } else {
        const authScreen = document.getElementById('auth-screen');
        if (authScreen) authScreen.classList.add('active');
        hideSplash();
    }

    setTimeout(hideSplash, 5000);

    const messageInput = document.getElementById('message-text');
    if (messageInput) {
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (typeof sendTextMessage === 'function') sendTextMessage();
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
                    reader.onload = ev => { if (typeof openMessageCropModal === 'function') openMessageCropModal(ev.target.result); };
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
                            images.forEach((img, index) => {
                                if (typeof emitMessage === 'function') setTimeout(() => emitMessage(img, 'image'), index * 300);
                            });
                        })
                        .catch(err => console.error("Paste error:", err));
                }
            }
        });

        messageInput.addEventListener('input', () => {
            const text = messageInput.value.trim();
            const inputArea = document.getElementById('message-input-area');
            if (inputArea) {
                if (text.length > 0) inputArea.classList.add('has-text');
                else inputArea.classList.remove('has-text');
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
    }

    const commentInput = document.getElementById('comment-input');
    if (commentInput) {
        commentInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (typeof sendComment === 'function') sendComment();
            }
        });
    }

    if (window.visualViewport) {
        let lastScrollHeight = 0;
        window.visualViewport.addEventListener('resize', () => {
            const messagesArea = document.getElementById('messages-area');
            if (!messagesArea) return;
            if (messagesArea.scrollHeight !== lastScrollHeight || messagesArea.scrollTop < messagesArea.scrollHeight - messagesArea.clientHeight - 10) {
                requestAnimationFrame(() => {
                    messagesArea.scrollTop = messagesArea.scrollHeight;
                });
            }
            lastScrollHeight = messagesArea.scrollHeight;
        });
    }

    const unlockAudio = () => {
        if (typeof initRingtoneAudio === 'function') initRingtoneAudio();
        document.removeEventListener('touchstart', unlockAudio, true);
        document.removeEventListener('click', unlockAudio, true);
    };
    document.addEventListener('touchstart', unlockAudio, true);
    document.addEventListener('click', unlockAudio, true);
});

document.addEventListener('keydown', (e) => {
    const viewer = document.getElementById('image-viewer');
    if (viewer && viewer.classList.contains('active')) {
        if (e.key === 'Escape') {
            if (typeof closeImageViewer === 'function') closeImageViewer();
        } else if (e.key === 'ArrowRight') {
            if (typeof nextImage === 'function') nextImage();
        } else if (e.key === 'ArrowLeft') {
            if (typeof prevImage === 'function') prevImage();
        }
    }
});

function changeTheme(themeKey) {
    const themesList = ['theme-light', 'dark-theme', 'theme-ocean', 'theme-oled'];
    const themeMap = {
        'default': 'theme-light',
        'dark': 'dark-theme',
        'ocean': 'theme-ocean',
        'oled': 'theme-oled'
    };

    const nextTheme = themeMap[themeKey] || themeKey;
    themesList.forEach(t => document.body.classList.remove(t));
    if (nextTheme !== 'theme-light') document.body.classList.add(nextTheme);

    localStorage.setItem('appTheme', nextTheme);
    localStorage.removeItem('darkTheme');
}

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
    localStorage.removeItem('darkTheme');
}

// --- CUSTOM MODAL API (Replaces alert, confirm, prompt) ---
window.showAlert = function(text, title = 'Уведомление', icon = '💡') {
    const overlay = document.getElementById('custom-alert-overlay');
    document.getElementById('cm-title').textContent = title;
    document.getElementById('cm-text').textContent = text;
    document.getElementById('cm-icon').textContent = icon;
    document.getElementById('cm-prompt-input').style.display = 'none';
    document.getElementById('cm-cancel-btn').style.display = 'none';
    const confirmBtn = document.getElementById('cm-confirm-btn');
    confirmBtn.textContent = 'OK';
    overlay.classList.add('active');

    return new Promise(resolve => {
        confirmBtn.onclick = () => {
            overlay.classList.remove('active');
            resolve();
        };
    });
};

window.showConfirm = function(text, title = 'Подтверждение', icon = '❓') {
    const overlay = document.getElementById('custom-alert-overlay');
    document.getElementById('cm-title').textContent = title;
    document.getElementById('cm-text').textContent = text;
    document.getElementById('cm-icon').textContent = icon;
    document.getElementById('cm-prompt-input').style.display = 'none';
    document.getElementById('cm-cancel-btn').style.display = 'block';
    const confirmBtn = document.getElementById('cm-confirm-btn');
    const cancelBtn = document.getElementById('cm-cancel-btn');
    confirmBtn.textContent = 'Да';
    cancelBtn.textContent = 'Отмена';
    overlay.classList.add('active');

    return new Promise(resolve => {
        confirmBtn.onclick = () => {
            overlay.classList.remove('active');
            resolve(true);
        };
        cancelBtn.onclick = () => {
            overlay.classList.remove('active');
            resolve(false);
        };
    });
};

window.showPrompt = function(text, defaultValue = '', title = 'Ввод данных', icon = '📝') {
    const overlay = document.getElementById('custom-alert-overlay');
    const input = document.getElementById('cm-prompt-input');
    document.getElementById('cm-title').textContent = title;
    document.getElementById('cm-text').textContent = text;
    document.getElementById('cm-icon').textContent = icon;
    input.style.display = 'block';
    input.value = defaultValue;
    document.getElementById('cm-cancel-btn').style.display = 'block';
    const confirmBtn = document.getElementById('cm-confirm-btn');
    const cancelBtn = document.getElementById('cm-cancel-btn');
    confirmBtn.textContent = 'OK';
    cancelBtn.textContent = 'Отмена';
    overlay.classList.add('active');

    return new Promise(resolve => {
        confirmBtn.onclick = () => {
            overlay.classList.remove('active');
            resolve(input.value);
        };
        cancelBtn.onclick = () => {
            overlay.classList.remove('active');
            resolve(null);
        };
    });
};

