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
            const reader = new FileReader();
            reader.onload = e => {
                // Закрываем модалку профиля, чтобы открыть модалку обрезки
                document.getElementById('my-profile-modal').classList.remove('active');
                document.getElementById('crop-image').src = e.target.result;
                document.getElementById('crop-modal').classList.add('active');

                if (cropper) cropper.destroy();
                const image = document.getElementById('crop-image');
                cropper = new Cropper(image, {
                    aspectRatio: 1, 
                    viewMode: 1,
                    dragMode: 'move',
                    guides: false,
                    center: false,
                    cropBoxMovable: true,
                    cropBoxResizable: true,
                    toggleDragModeOnDblclick: false,
                });
            };
            reader.readAsDataURL(file);
            input.value = ''; 
        }

        function closeCropModal() {
            document.getElementById('crop-modal').classList.remove('active');
            if(cropper) cropper.destroy();
        }

        function saveCroppedAvatar() {
            if (!cropper) return;
            const canvas = cropper.getCroppedCanvas({ width: 300, height: 300 });
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            
            const oldAvatar = currentUser.avatar;
            updateAllMyAvatars(dataUrl, currentUser.display_name); // Оптимистичное обновление
            
            fetch(SERVER_URL + '/api/upload/avatar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('monochrome_token') },
            body: JSON.stringify({ avatar: dataUrl })
        }).then(r => r.json()).then(res => {
                if (res.success) {
                    // Обновляем на путь с сервера
                    currentUser.avatar = res.path;
                    localStorage.setItem('monochrome_user', JSON.stringify(currentUser));
                    updateAllMyAvatars(currentUser.avatar, currentUser.display_name);
                } else {
                    alert('Ошибка обновления аватара: ' + (res.message || ''));
                    // В случае ошибки возвращаем старый аватар
                    currentUser.avatar = oldAvatar;
                    updateAllMyAvatars(oldAvatar, currentUser.display_name);
                }
            });
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
                    const avatarHTML = chat.avatar ? `<img class="chat-avatar" src="${getFullUrl(chat.avatar)}">` : `<div class="chat-avatar">${displayName.substring(0,2).toUpperCase()}</div>`;
                    const item = document.createElement('div');
                    item.className = 'chat-item';
                    item.innerHTML = `<label><input type="checkbox" name="forward-target" value="${chat.username}"><div class="avatar-wrapper">${avatarHTML}</div><div class="chat-info"><span class="chat-name">${displayName}</span></div></label>`;
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
            const avatarUrl = comment.avatar ? getFullUrl(comment.avatar) : null;
            const avatarHTML = avatarUrl ? `<img src="${escapeHTML(avatarUrl)}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0;">` : `<div style="width: 36px; height: 36px; border-radius: 50%; background: var(--avatar-bg); color: var(--avatar-text); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 500; flex-shrink: 0;">${safeName.substring(0,2).toUpperCase()}</div>`;
            
            div.innerHTML = `${avatarHTML}<div style="flex: 1; display: flex; flex-direction: column;"><div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px;"><span style="font-size: 14px; font-weight: 600; color: var(--text-main);">${safeName}</span><span style="font-size: 11px; color: var(--text-muted);">${comment.time}</span></div><div style="background: var(--bg-card); padding: 12px 16px; border-radius: 4px 16px 16px 16px; font-size: 14px; line-height: 1.5; color: var(--text-main); border: 1px solid var(--border-light); box-shadow: 0 4px 12px rgba(0,0,0,0.05); white-space: pre-wrap; word-break: break-word;">${escapeHTML(comment.text)}</div></div>`;
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
