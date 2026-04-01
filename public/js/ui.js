function postStory(input) {
            const file = input.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = e => {
                socket.emit('post story', { image: e.target.result, time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
                setTimeout(loadStories, 500);
            };
            reader.readAsDataURL(file);
        }

        function loadStories() {
            socket.emit('get stories', stories => {
                const area = document.getElementById('stories-area');
                const addBtn = area.querySelector('.story-add').outerHTML;
                area.innerHTML = addBtn;
                stories.forEach(s => {
                    const div = document.createElement('div');
                    div.className = 'story-item';
                    const thumb = s.avatar ? getFullUrl(s.avatar) : getFullUrl(s.image);
                    div.innerHTML = `<img src="${thumb}" class="story-thumb">`;
                    div.onclick = () => openStory(s);
                    area.appendChild(div);
                });
            });
        }

        function openStory(s) {
            document.getElementById('story-img').src = getFullUrl(s.image);
            document.getElementById('story-caption').textContent = `${s.display_name} • ${s.time}`;
            document.getElementById('story-viewer').classList.add('active');
        }

        function closeStory() { document.getElementById('story-viewer').classList.remove('active'); }

        // Обрезка аватарки
        function uploadAvatar(input) {
            const file = input.files[0]; if (!file) return;
            
            const isVideo = file.type.startsWith('video/');
            if (isVideo && !isPremium) {
                alert('Видео-аватарки доступны только Premium пользователям');
                input.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = e => {
                const dataUrl = e.target.result;
                const modal = document.getElementById('crop-modal');
                const img = document.getElementById('crop-image');
                const video = document.getElementById('crop-video');
                const title = modal.querySelector('h3');

                // Закрываем модалку профиля, чтобы открыть модалку обрезки
                document.getElementById('my-profile-modal').classList.remove('active');
                modal.classList.add('active');

                if (isVideo) {
                    title.textContent = 'Предпросмотр видео';
                    img.style.display = 'none';
                    video.style.display = 'block';
                    video.src = dataUrl;
                    video.classList.add('preview-mode');
                    if (cropper) cropper.destroy();
                    // Сохраняем dataUrl в дата-атрибут для последующей загрузки
                    modal.dataset.currentVideo = dataUrl;
                } else {
                    title.textContent = 'Обрезка (выберите круг)';
                    img.style.display = 'block';
                    video.style.display = 'none';
                    video.src = '';
                    video.classList.remove('preview-mode');
                    img.src = dataUrl;
                    modal.dataset.currentVideo = '';

                    if (cropper) cropper.destroy();
                    cropper = new Cropper(img, {
                        aspectRatio: 1, 
                        viewMode: 1,
                        dragMode: 'move',
                        guides: false,
                        center: false,
                        cropBoxMovable: true,
                        cropBoxResizable: true,
                        toggleDragModeOnDblclick: false,
                    });
                }
            };
            reader.readAsDataURL(file);
            input.value = ''; 
        }

        function uploadAvatarFile(dataUrl) {
            const oldAvatar = currentUser.avatar;
            updateAllMyAvatars(dataUrl, currentUser.display_name); // Оптимистичное обновление
            
            fetch(SERVER_URL + '/api/upload/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('monochrome_token') },
                body: JSON.stringify({ avatar: dataUrl })
            }).then(r => r.json()).then(res => {
                if (res.success) {
                    currentUser.avatar = res.path;
                    localStorage.setItem('monochrome_user', JSON.stringify(currentUser));
                    updateAllMyAvatars(currentUser.avatar, currentUser.display_name);
                } else {
                    alert('Ошибка обновления аватара: ' + (res.message || ''));
                    currentUser.avatar = oldAvatar;
                    updateAllMyAvatars(oldAvatar, currentUser.display_name);
                }
            });
        }

        function closeCropModal() {
            document.getElementById('crop-modal').classList.remove('active');
            const video = document.getElementById('crop-video');
            video.pause();
            video.src = '';
            if(cropper) cropper.destroy();
        }

        function saveCroppedAvatar() {
            const modal = document.getElementById('crop-modal');
            const videoData = modal.dataset.currentVideo;

            if (videoData) {
                uploadAvatarFile(videoData);
            } else if (cropper) {
                const canvas = cropper.getCroppedCanvas({ width: 300, height: 300 });
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                uploadAvatarFile(dataUrl);
            }
            closeCropModal();
        }

        // --- Обрезка вставленных сообщений ---
        function openMessageCropModal(dataUrl) {
            document.getElementById('message-crop-image').src = dataUrl;
            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('message-crop-modal').classList.add('active');

            if (messageCropper) messageCropper.destroy();
            const image = document.getElementById('message-crop-image');
            messageCropper = new Cropper(image, {
                viewMode: 1,
                dragMode: 'move',
                guides: true,
                center: true,
                cropBoxMovable: true,
                cropBoxResizable: true,
                toggleDragModeOnDblclick: false
            });
        }

        function closeMessageCropModal() {
            document.getElementById('message-crop-modal').classList.remove('active');
            if (messageCropper) messageCropper.destroy();
        }

        function sendCroppedMessageImage() {
            if (!messageCropper) return;
            const canvas = messageCropper.getCroppedCanvas({ imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            emitMessage(dataUrl, 'image');
            closeAllModals(); 
        }

        // --- Функции ответов и пересылки ---

        function showReplyUI(messageId, sender, text, type) {
            let snippet = '';
            if (type === 'text') {
                snippet = (text || '').toString().substring(0, 50);
            } else if (type === 'image') {
                snippet = 'Фото';
            } else if (type === 'gallery') {
                snippet = 'Галерея';
            } else if (type === 'audio') {
                snippet = 'Голосовое сообщение';
            } else if (type === 'circle_video') {
                snippet = 'Видеосообщение';
            } else if (type === 'sticker') {
                snippet = 'Стикер';
            }
            
            replyContext = { messageId, sender };

            const previewArea = document.getElementById('reply-preview-area');
            previewArea.innerHTML = `
                <div class="reply-preview">
                    <div class="reply-preview-content">
                        <b>Ответ на @${escapeHTML(sender)}</b>
                        <p>${escapeHTML(snippet)}</p>
                    </div>
                    <button class="reply-preview-close" onclick="cancelReply()">×</button>
                </div>
            `;
            document.getElementById('message-text').focus();
        }

        function cancelReply() {
            replyContext = null;
            document.getElementById('reply-preview-area').innerHTML = '';
        }

        function scrollToMessage(messageId) {
            const msgEl = document.getElementById(`msg-${messageId}`);
            if (msgEl) {
                msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                msgEl.style.transition = 'background-color 0.5s';
                msgEl.style.backgroundColor = 'var(--active-bg)';
                setTimeout(() => {
                    msgEl.style.backgroundColor = '';
                }, 1500);
            } else {
                alert('Исходное сообщение не найдено (возможно, оно в непрогруженной части истории).');
            }
        }

        function openForwardModal(messageId) {
            forwardMessageId = messageId;
            socket.emit('get recent chats', (chats) => {
                const list = document.getElementById('forward-chats-list');
                list.innerHTML = '';
                chats.forEach(chat => {
                    const displayName = myContacts[chat.username] || chat.display_name;
                    const avatarHTML = renderAvatarHTML(chat.avatar, displayName, 'chat-avatar');
                    const item = document.createElement('div');
                    item.className = 'chat-item';
                    item.innerHTML = `<label><input type="checkbox" name="forward-target" value="${chat.username}"><div class="avatar-wrapper">${avatarHTML}</div><div class="chat-info"><span class="chat-name">${displayName}</span>${chat.is_premium ? '<span class="premium-star">★</span>' : ''}</div></label>`;
                    list.appendChild(item);
                });
                document.getElementById('main-overlay').classList.add('active');
                document.getElementById('forward-modal').classList.add('active');
            });
        }

        function executeForward() {
            const selected = document.querySelectorAll('input[name="forward-target"]:checked');
            if (selected.length === 0) return alert('Выберите хотя бы один чат для пересылки.');
            
            const targets = Array.from(selected).map(el => el.value);
            socket.emit('forward_message', { messageId: forwardMessageId, targets }, (res) => {
                if (res.success) { alert('Сообщение переслано.'); } else { alert('Ошибка: ' + (res.message || 'Не удалось переслать сообщение.')); }
                closeAllModals();
            });
        }

        // --- Комментарии ---
        function openComments(messageId) {
            currentCommentMessageId = messageId;
            document.getElementById('comments-list').innerHTML = '';
            document.getElementById('comment-input').value = '';
            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('comments-modal').classList.add('active');
            
            socket.emit('get_comments', messageId, (comments) => {
                if (comments) comments.forEach(appendCommentUI);
            });
        }

        function closeCommentsModal() {
            currentCommentMessageId = null;
            document.getElementById('comments-modal').classList.remove('active');
            if (!document.querySelector('.custom-modal.active:not(#comments-modal)')) {
                document.getElementById('main-overlay').classList.remove('active');
            }
        }

        function appendCommentUI(comment) {
            const list = document.getElementById('comments-list');
            const div = document.createElement('div');
            div.style.display = 'flex'; div.style.gap = '12px';
            
            const safeName = escapeHTML(comment.display_name);
            const avatarHTML = renderAvatarHTML(comment.avatar, comment.display_name, 'comment-avatar');
            
            div.innerHTML = `${avatarHTML}<div style="flex: 1; display: flex; flex-direction: column;"><div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px;"><span style="font-size: 14px; font-weight: 600; color: var(--text-main);">${safeName}${comment.is_premium ? ' <span class="premium-star">★</span>' : ''}</span><span style="font-size: 11px; color: var(--text-muted);">${comment.time}</span></div><div style="background: var(--bg-card); padding: 12px 16px; border-radius: 4px 16px 16px 16px; font-size: 14px; line-height: 1.5; color: var(--text-main); border: 1px solid var(--border-light); box-shadow: 0 4px 12px rgba(0,0,0,0.05); white-space: pre-wrap; word-break: break-word;">${escapeHTML(comment.text)}</div></div>`;
            list.appendChild(div);
            list.scrollTop = list.scrollHeight;
        }

        function sendComment() {
            const input = document.getElementById('comment-input');
            const text = input.value.trim();
            if (!text || !currentCommentMessageId) return;
            
            const now = new Date(); const time = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
            
            socket.emit('post_comment', { messageId: currentCommentMessageId, text, time }, (res) => {
                if (res.success) input.value = ''; else alert('Ошибка при отправке комментария.');
            });
        }

        // --- Функции задержки для панели действий ---
        const messageActionTimers = new Map();

        function showMessageActionsWithDelay(messageEl) {
            cancelHideMessageActions(messageEl);
            if (messageEl.classList.contains('show-actions') || messageEl.classList.contains('actions-active')) return;

            const timer = setTimeout(() => {
                messageEl.classList.add('show-actions');
                messageActionTimers.delete(messageEl.id + '-show');
            }, 400); // задержка 400мс
            messageActionTimers.set(messageEl.id + '-show', timer);
        }

        function hideMessageActionsWithDelay(messageEl) {
            const showTimerId = messageEl.id + '-show';
            if (messageActionTimers.has(showTimerId)) {
                clearTimeout(messageActionTimers.get(showTimerId));
                messageActionTimers.delete(showTimerId);
            }
            if (messageEl.classList.contains('actions-active')) return;

            const timer = setTimeout(() => {
                messageEl.classList.remove('show-actions');
                messageActionTimers.delete(messageEl.id + '-hide');
            }, 200);
            messageActionTimers.set(messageEl.id + '-hide', timer);
        }

        function cancelHideMessageActions(messageEl) {
            const hideTimerId = messageEl.id + '-hide';
            if (messageActionTimers.has(hideTimerId)) {
                clearTimeout(messageActionTimers.get(hideTimerId));
                messageActionTimers.delete(hideTimerId);
            }
        }

        // --- Функции реакций ---
        function openReactionPicker(buttonEl, messageId) {
            closeReactionPicker(); // Close any other open picker
            const picker = document.getElementById('reaction-picker');
            picker.dataset.messageId = messageId;
            
            // Добавляем класс, чтобы панель действий не исчезала при уводе мыши
            const msgEl = document.getElementById(`msg-${messageId}`);
            if (msgEl) {
                msgEl.classList.add('actions-active');
            }

            const rect = buttonEl.getBoundingClientRect();
            picker.style.top = `${rect.top - picker.offsetHeight - 10}px`;
            picker.style.left = `${rect.left + rect.width / 2 - picker.offsetWidth / 2}px`;

            picker.classList.add('active');
        }

        function closeReactionPicker() {
            const picker = document.getElementById('reaction-picker');
            const messageId = picker.dataset.messageId;

            // Убираем класс, который "замораживал" панель действий
            if (messageId) {
                const msgEl = document.getElementById(`msg-${messageId}`);
                if (msgEl) {
                    msgEl.classList.remove('actions-active');
                }
            }

            picker.classList.remove('active');
            delete picker.dataset.messageId;
        }

        function toggleReaction(emojiEl, emoji) {
            const picker = emojiEl.closest('.reaction-picker');
            const messageId = picker.dataset.messageId;
            clientToggleReaction(messageId, emoji);
            closeReactionPicker();
        }

        function clientToggleReaction(messageId, emoji) {
            socket.emit('toggle reaction', { messageId, emoji });
        }
        function showCallChoice() {
            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('call-choice-modal').classList.add('active');
        }

        function closeCallChoice() {
            document.getElementById('call-choice-modal').classList.remove('active');
            if (!document.querySelector('.custom-modal.active:not(#call-choice-modal)')) {
                document.getElementById('main-overlay').classList.remove('active');
            }
        }

        function togglePremium() {
            const newValue = !isPremium;
            fetch(SERVER_URL + '/api/auth/premium', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('monochrome_token') },
                body: JSON.stringify({ isPremium: newValue })
            }).then(r => r.json()).then(res => {
                if (res.success) {
                    isPremium = !!res.is_premium;
                    currentUser.is_premium = res.is_premium;
                    localStorage.setItem('monochrome_user', JSON.stringify(currentUser));
                    alert(isPremium ? 'Поздравляем! Теперь у вас есть Premium.' : 'Подписка Premium отменена.');
                    location.reload(); // Перезагружаем для обновления UI
                } else {
                    alert('Ошибка при обновлении подписки.');
                }
            });
        }

        function updatePremiumUI() {
            const label = document.getElementById('premium-status-label');
            const sublabel = document.getElementById('premium-status-sublabel');
            const btn = document.getElementById('premium-action-btn');
            const icon = document.querySelector('.premium-icon');

            if (label && sublabel && btn && icon) {
                if (isPremium) {
                    label.textContent = 'Monochrome Premium Активен';
                    sublabel.textContent = 'Вам доступны видео-аватарки';
                    btn.textContent = 'Активен';
                    btn.style.color = 'var(--text-muted)';
                    
                    const profileName = document.getElementById('profile-name');
                    if (profileName && !profileName.innerHTML.includes('premium-star')) {
                        profileName.innerHTML += ' <span class="premium-star">★</span>';
                    }
                } else {
                    label.textContent = 'Monochrome Premium';
                    sublabel.textContent = 'Разблокировать видео-аватарки';
                    btn.textContent = 'Подключить';
                    btn.style.color = 'var(--accent)';
                }
            }
        }
        // --- PROFILE HOVER CARD LOGIC ---
        let phTimer;
        document.addEventListener('DOMContentLoaded', () => {
            const footer = document.getElementById('my-profile-footer');
            const card = document.getElementById('profile-hover-card');

            if (footer && card) {
                footer.addEventListener('mouseenter', () => {
                    clearTimeout(phTimer);
                    updateHoverCardUI();
                    document.getElementById('profile-hover-card').classList.add('active');
                });
                footer.addEventListener('mouseleave', (e) => {
                    // Don't hide if moving to the card itself
                    const card = document.getElementById('profile-hover-card');
                    if (e.relatedTarget === card || card.contains(e.relatedTarget)) return;

                    phTimer = setTimeout(() => {
                        card.classList.remove('active');
                        document.getElementById('ph-settings-menu').classList.remove('active');
                        stopCurrentEffect();
                    }, 500);
                });

                card.addEventListener('mouseleave', (e) => {
                    const footer = document.getElementById('my-profile-footer');
                    if (e.relatedTarget === footer || footer.contains(e.relatedTarget)) return;

                    phTimer = setTimeout(() => {
                        card.classList.remove('active');
                        document.getElementById('ph-settings-menu').classList.remove('active');
                        stopCurrentEffect();
                    }, 500);
                });
            }
        });

        function toggleHoverCardSettings(e) {
            e.stopPropagation();
            document.getElementById('ph-settings-menu').classList.toggle('active');
        }

        async function setProfileEffect(effect) {
            if (!currentUser) return;
            currentUser.profile_effect = effect;
            document.getElementById('ph-settings-menu').classList.remove('active');
            
            // Save to server
            socket.emit('update_profile', {
                displayName: currentUser.display_name,
                bio: currentUser.bio,
                birthDate: currentUser.birth_date,
                profileCardBg: currentUser.profile_card_bg,
                profileEffect: effect
            }, (res) => {
                if (res.success) {
                    startEffect(effect);
                }
            });
        }

        let effectInterval;
        function stopCurrentEffect() {
            if (effectInterval) {
                cancelAnimationFrame(effectInterval);
                effectInterval = null;
            }
            const canvas = document.getElementById('ph-effects-canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }

        function startEffect(type) {
            stopCurrentEffect();
            if (type === 'none') return;
            
            const canvas = document.getElementById('ph-effects-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            
            // Resize canvas to parent, or fallback to fixed size if parent hidden
            const parent = canvas.parentElement;
            canvas.width = parent.offsetWidth || 320;
            canvas.height = parent.offsetHeight || 420;

            if (type === 'snow') {
                const flakes = Array.from({ length: 50 }, () => ({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    r: Math.random() * 3 + 1,
                    v: Math.random() * 0.6 + 0.3 // Slower snow
                }));

                function draw() {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
                    ctx.beginPath();
                    for (let f of flakes) {
                        ctx.moveTo(f.x, f.y);
                        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2, true);
                        f.y += f.v;
                        f.x += Math.sin(f.y / 50) * 0.5;
                        if (f.y > canvas.height) {
                            f.y = -10;
                            f.x = Math.random() * canvas.width;
                        }
                    }
                    ctx.fill();
                    effectInterval = requestAnimationFrame(draw);
                }
                draw();
            } else if (type === 'stars') {
                const stars = Array.from({ length: 50 }, () => ({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    size: Math.random() * 1.5 + 0.5,
                    opacity: Math.random(),
                    speed: Math.random() * 0.05 + 0.01,
                    vx: (Math.random() - 0.5) * 0.3,
                    vy: (Math.random() - 0.5) * 0.3
                }));

                function draw() {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    for (let s of stars) {
                        ctx.fillStyle = `rgba(255, 255, 255, ${Math.abs(Math.sin(s.opacity))})`;
                        ctx.beginPath();
                        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
                        ctx.fill();
                        s.opacity += s.speed;
                        s.x += s.vx;
                        s.y += s.vy;

                        if (s.x < 0) s.x = canvas.width;
                        if (s.x > canvas.width) s.x = 0;
                        if (s.y < 0) s.y = canvas.height;
                        if (s.y > canvas.height) s.y = 0;
                    }
                    effectInterval = requestAnimationFrame(draw);
                }
                draw();
            }
        }

        function updateHoverCardUI() {
            if (!currentUser) return;
            const card = document.getElementById('profile-hover-card');
            const name = document.getElementById('ph-name');
            const username = document.getElementById('ph-username');
            const bio = document.getElementById('ph-bio');
            const avatar = document.getElementById('ph-avatar');

            if (name) {
                let badges = '';
                if (currentUser.username === 'xxx' || currentUser.is_admin) {
                    badges = '<span class="premium-plate dev">DEV</span><span class="premium-plate admin">ADMIN</span>';
                } else if (currentUser.is_premium) {
                    badges = '<span class="premium-plate">PREMIUM</span>';
                }
                name.innerHTML = `${escapeHTML(currentUser.display_name)}${badges}`;
            }
            if (username) username.textContent = '@' + currentUser.username;
            if (bio) bio.textContent = currentUser.bio || 'Нет описания';
            
            if (avatar) {
                const avatarHTML = renderAvatarHTML(currentUser.avatar, currentUser.display_name, 'avatar-img-actual');
                const statusDotHTML = `<div class="status-dot ${currentUser.isOnline ? 'online' : 'offline'}" style="width:14px; height:14px; bottom:2px; right:2px; border:2px solid var(--bg-card);"></div>`;
                avatar.innerHTML = avatarHTML + statusDotHTML;
            }

            if (card) {
                if (currentUser.profile_card_bg) {
                    const bgUrl = getFullUrl(currentUser.profile_card_bg);
                    card.style.backgroundImage = `url(${bgUrl})`;
                    card.style.backgroundSize = 'cover';
                    card.style.backgroundPosition = 'center';
                } else {
                    card.style.backgroundImage = '';
                }
            }

            if (currentUser.profile_effect) {
                setTimeout(() => startEffect(currentUser.profile_effect), 100);
            }
        }

        function renderAvatarHTML(avatar, name, className) {
            const finalData = avatar && avatar.startsWith('/uploads/') ? getFullUrl(avatar) : avatar;
            if (finalData) {
                if (isVideoPath(avatar)) {
                    return `<video src="${finalData}" autoplay loop muted playsinline class="${className}" style="object-fit:cover;"></video>`;
                } else {
                    return `<img src="${finalData}" class="${className}">`;
                }
            } else {
                return `<div class="${className}">${name ? name.substring(0,2).toUpperCase() : '??'}</div>`;
            }
        }
