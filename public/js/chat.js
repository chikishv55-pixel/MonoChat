        function loadRecentChats() {
            socket.emit('get recent chats', (users) => renderChatsList(users, 'У вас пока нет переписок.'));
        }

                function handleSearch(e) {
            // Поиск только по нажатию Enter или если поле пустое (сброс)
            if (e && e.type === 'keydown' && e.key !== 'Enter') return;
            const query = document.getElementById('search-input').value.trim();
            if (query.length === 0) {
                document.querySelector('.chats-column').classList.remove('is-searching');
                return loadRecentChats();
            }
            document.querySelector('.chats-column').classList.add('is-searching');
                        socket.emit('search users', query, (users) => renderChatsList(users.filter(u => u.username !== currentUser.username), 'Пользователь не найден'));
        }

        function renderChatsList(users, emptyText) {
            const chatsList = document.getElementById('chats-list');
            chatsList.innerHTML = '';
            if (users.length === 0) return chatsList.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted);">${emptyText}</div>`;
            users.forEach(user => {
                const isActive = currentChatUser && currentChatUser.username === user.username;
                const chatItem = document.createElement('div');
                chatItem.className = `chat-item ${isActive ? 'active' : ''}`;
                chatItem.setAttribute('data-username', user.username);
                chatItem.onclick = () => selectChat(user);
                
                const displayName = escapeHTML(myContacts[user.username] || user.display_name);
                const isUserPremium = !!user.is_premium;
                const premiumBadge = isUserPremium ? '<span class="premium-star" title="Premium">в…</span>' : '';

                let avatarHTML = renderAvatarHTML(user.avatar, displayName, 'chat-avatar');
                const statusDotHTML = user.isGroup ? '' : `<div class="status-dot ${user.isOnline ? 'online' : 'offline'}"></div>`;
                
                const snippetText = createMessageSnippet(user.lastMessage);
                const lastMessageHTML = `<span class="chat-last-message" id="lm-${user.username}">${escapeHTML(snippetText)}</span>`;

                chatItem.innerHTML = `<div class="avatar-wrapper">${avatarHTML}${statusDotHTML}</div>
                    <div class="chat-info">
                        <span class="chat-name">${displayName} ${premiumBadge}</span>
                        ${lastMessageHTML}
                    </div>`;
                chatsList.appendChild(chatItem);
            });
        }

        let lastChatRequestId = 0;
        function selectChat(user) {
            currentChatUser = user;
            
            // РЎР±СЂР°СЃС‹РІР°РµРј РїРѕР»Рµ РІРІРѕРґР° Рё РґСЂСѓРіРёРµ СЃРѕСЃС‚РѕСЏРЅРёСЏ
            cancelReply();
            document.getElementById('message-text').value = '';
            document.getElementById('message-input-area').classList.remove('has-text');

            // РњРіРЅРѕРІРµРЅРЅР°СЏ РѕС‡РёСЃС‚РєР° СЃРѕРѕР±С‰РµРЅРёР№ Рё РїРѕРєР°Р· Р»РѕР°РґРµСЂР°
                        const area = document.getElementById('messages-area');
            area.innerHTML = '<div class="chat-loader"><div class="spinner"></div><span>Загрузка сообщений...</span></div>';
            
            const requestId = ++lastChatRequestId;
            const displayName = myContacts[user.username] || user.display_name;
            const safeDisplayName = escapeHTML(displayName);
            const safeUsername = escapeHTML(user.username);
            
            const isUserPremium = !!user.is_premium;
            const premiumBadge = isUserPremium ? '<span class="premium-star" title="Premium">в…</span>' : '';
            
            const avatarWrapper = document.querySelector('.messages-header .avatar-wrapper');
            avatarWrapper.innerHTML = renderAvatarHTML(user.avatar, displayName, 'partner-avatar') + 
                `<div class="status-dot" id="current-chat-status-dot" style="display:none;"></div>`;

            document.getElementById('current-chat-name').innerHTML = `${safeDisplayName} ${premiumBadge} <span class="username-tag" style="color:inherit">@${safeUsername}</span>`;
            const dot = document.getElementById('current-chat-status-dot');
            const statusText = document.getElementById('current-chat-status-text');
            const addContactBtn = document.getElementById('add-contact-btn');
            const callChoiceBtn = document.getElementById('call-choice-btn');

                        if (user.isGroup) {
                dot.style.display = 'none';
                let typeStr = user.type === 'channel' ? 'Канал' : 'Группа';
                let membersStr = user.member_count ? `${user.member_count} ${user.type === 'channel' ? 'подписчиков' : 'участников'}` : typeStr;
                statusText.textContent = membersStr;
                addContactBtn.style.display = 'none';
                callChoiceBtn.style.display = 'none';
                
                // Скрываем поле ввода, если это канал и пользователь не админ
                if (user.type === 'channel' && user.my_role !== 'admin') {
                    document.getElementById('message-input-area').style.display = 'none';
                } else {
                    document.getElementById('message-input-area').style.display = 'flex';
                }
            } else {
                dot.style.display = 'block';
                dot.className = `status-dot ${user.isOnline ? 'online' : 'offline'}`;
                statusText.textContent = user.isOnline ? 'в сети' : 'офлайн';
                addContactBtn.style.display = myContacts[user.username] ? 'none' : 'block';
                callChoiceBtn.style.display = 'block';
                document.getElementById('message-input-area').style.display = 'flex';
            }
            
            // Адаптация для мобилок: добавляем класс активности чата
            document.querySelector('.chat-container').classList.add('chat-active');
            
            socket.emit('get history', user.username, (messages) => {
                if (requestId === lastChatRequestId) {
                    renderMessages(messages);
                }
            });

            // Обновляем активный чат в списке
            document.querySelectorAll('.chat-item').forEach(el => {
                el.classList.remove('active');
                if (el.getAttribute('data-username') === user.username) {
                    el.classList.add('active');
                }
            });

            // After setting the default status, check for typers
            updateTypingIndicator(user.username);
        }

        // Кнопка назад для мобилок
        function closeChatMobile() {
            document.querySelector('.chat-container').classList.remove('chat-active');
            currentChatUser = null;
        }

        function addCurrentToContacts() {
            const alias = prompt("РРјСЏ РґР»СЏ РєРѕРЅС‚Р°РєС‚Р°:", currentChatUser.display_name);
            if (alias) {
                socket.emit('add contact', { username: currentChatUser.username, alias }, () => {
                    myContacts[currentChatUser.username] = alias;
                    selectChat(currentChatUser);
                    loadRecentChats();
                });
            }
        }

        socket.on('user status changed', (data) => {
            const chatEl = document.querySelector(`.chat-item[data-username="${data.username}"] .status-dot`);
            if (chatEl) chatEl.className = `status-dot ${data.online ? 'online' : 'offline'}`;
                        if (currentChatUser && currentChatUser.username === data.username) {
                currentChatUser.isOnline = data.online;
                document.getElementById('current-chat-status-dot').className = `status-dot ${data.online ? 'online' : 'offline'}`;
                document.getElementById('current-chat-status-text').textContent = data.online ? 'в сети' : 'офлайн';
            }
        });

        socket.on('user data changed', (data) => {
            if (data.username === currentChatUser?.username) {
                if (data.display_name) currentChatUser.display_name = data.display_name;
                if (data.avatar) currentChatUser.avatar = data.avatar;
                selectChat(currentChatUser); // Re-render header
            }
            loadRecentChats(); // To update name in chat list
        });

        function openCurrentChatInfo() {
             if (!currentChatUser) return;
             if (currentChatUser.isGroup) {
                 openGroupInfoModal();
             } else {
                 openProfileModal();
             }
         }

         function openProfileModal() {
             const displayName = myContacts[currentChatUser.username] || currentChatUser.display_name; 
             const safeDisplayName = escapeHTML(displayName);
             setAvatarUI('pm-avatar-img', 'pm-avatar-text', currentChatUser.avatar, safeDisplayName);
             document.getElementById('pm-name').textContent = safeDisplayName;
             document.getElementById('pm-username').textContent = '@' + currentChatUser.username;

             const bioEl = document.getElementById('pm-bio');
             const bdateEl = document.getElementById('pm-bdate');
             
             bioEl.textContent = currentChatUser.bio || '';
             bioEl.style.display = currentChatUser.bio ? 'block' : 'none';

                          if (currentChatUser.birth_date) {
                 bdateEl.textContent = `Дата рождения: ${new Date(currentChatUser.birth_date).toLocaleDateString()}`;
                 bdateEl.style.display = 'block';
             } else {
                 bdateEl.style.display = 'none';
             }

             const pmMusicWidget = document.getElementById('pm-music-widget');
             if (currentChatUser.music_status) {
                 pmMusicWidget.style.display = 'flex';
                 pmMusicWidget.classList.add('playing');
                 document.getElementById('pm-music-text').textContent = currentChatUser.music_status;
             } else {
                 pmMusicWidget.style.display = 'none';
             }

             document.getElementById('main-overlay').classList.add('active');
             document.getElementById('profile-modal').classList.add('active');
         }

        function openFullAvatar() {
            if (currentChatUser && currentChatUser.avatar) {
                document.getElementById('full-avatar-img').src = getFullUrl(currentChatUser.avatar);
                document.getElementById('avatar-viewer').classList.add('active');
            }
        }
        
        function closeFullAvatar() { document.getElementById('avatar-viewer').classList.remove('active'); }

        function sendTextMessage() {
            const input = document.getElementById('message-text');
            const text = input.value.trim();
            if (!text) return;

            // Stop typing indicator
            clearTimeout(typingTimer);
            if (isCurrentlyTyping) {
                socket.emit('stop typing', { chatId: currentChatUser.username });
                isCurrentlyTyping = false;
            }

            emitMessage(text, 'text'); 
            input.value = '';
            input.dispatchEvent(new Event('input')); // РћР±РЅРѕРІР»СЏРµРј РІРёРґРёРјРѕСЃС‚СЊ РєРЅРѕРїРѕРє
        }

        function sendImage(input) {
            const files = input.files;
            if (!files || files.length === 0) return;

                        if (files.length === 1) {
                // Если выбрано одно фото - открываем окно предпросмотра с кнопкой "Отправить"
                const reader = new FileReader();
                reader.onload = e => openMessageCropModal(e.target.result);
                reader.readAsDataURL(files[0]);
            } else {
                const readAsDataURL = (file) => new Promise((res, rej) => {
                    const reader = new FileReader();
                    reader.onload = e => res(e.target.result);
                    reader.onerror = e => rej(e);
                    reader.readAsDataURL(file);
                });
                Promise.all(Array.from(files).map(readAsDataURL))
                    .then(images => {
                        images.forEach((img, index) => setTimeout(() => emitMessage(img, 'image'), index * 300));
                    })
                    .catch(err => alert("Не удалось загрузить изображения."));
            }
            input.value = '';
        }
        async function startVoice() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                                mediaRecorder = new MediaRecorder(stream);
                voiceStartTime = Date.now();
                mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
                mediaRecorder.start(); 
                document.getElementById('record-btn').classList.add('recording');
            } catch (err) { alert('Нет доступа к микрофону!'); }
        }

        function stopVoice() {
            if (!mediaRecorder) return; 
            mediaRecorder.stop(); 
            const duration = (Date.now() - voiceStartTime) / 1000;
            mediaRecorder.onstop = () => {
                document.getElementById('record-btn').classList.remove('recording');
                if (duration < 1.0) {
                    audioChunks = [];
                    return;
                }
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader(); 
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => emitMessage(reader.result, 'audio', duration);
                audioChunks = [];
            };
        }

        let circleMediaRecorder;
        let circleChunks = [];
        let circleStream;
        let circleStartTime = 0;

        async function startCircleVideo() {
            try {
                circleStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", aspectRatio: 1 }, audio: true });
                
                const previewOverlay = document.getElementById('circle-preview-overlay');
                const previewVideo = document.getElementById('circle-preview-video');
                previewVideo.srcObject = circleStream;
                previewOverlay.style.display = 'flex';
                setTimeout(() => previewOverlay.classList.add('visible'), 10);

                circleMediaRecorder = new MediaRecorder(circleStream, { mimeType: 'video/webm' });
                circleStartTime = Date.now();
                circleChunks = [];
                circleMediaRecorder.ondataavailable = e => circleChunks.push(e.data);
                circleMediaRecorder.start();
                                document.getElementById('record-btn').classList.add('recording');
            } catch (err) { 
                alert('Нет доступа к камере или микрофону!'); 
                if (circleStream) {
                    circleStream.getTracks().forEach(t => t.stop());
                    circleStream = null;
                }
                hideCirclePreview();
            }
        }

        function stopCircleVideo() {
            hideCirclePreview();

            if (!circleMediaRecorder) {
                if (circleStream) {
                    circleStream.getTracks().forEach(t => t.stop());
                    circleStream = null;
                }
                return;
            }

            if (circleMediaRecorder.state === 'recording') {
                circleMediaRecorder.stop();
            }

            const duration = (Date.now() - circleStartTime) / 1000;
            circleMediaRecorder.onstop = () => {
                document.getElementById('record-btn').classList.remove('recording');
                if (circleStream) {
                    circleStream.getTracks().forEach(t => t.stop());
                    circleStream = null;
                }
                if (duration < 1.0) {
                    circleChunks = [];
                    return;
                }
                const videoBlob = new Blob(circleChunks, { type: 'video/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(videoBlob);
                reader.onloadend = () => emitMessage(reader.result, 'circle_video', duration);
                circleChunks = [];
            };
        }

        // --- Р›РѕРіРёРєР° РїРµСЂРµРєР»СЋС‡РµРЅРёСЏ СЂРµР¶РёРјР° Р·Р°РїРёСЃРё ---
        let recordMode = 'voice'; // 'voice' | 'video'
        let isRecordingMedia = false;
        let recordHoldTimer = null;
        let isPressing = false;
        let isTouchDevice = false;

        function handleRecordStart(e) {
            if (e.type === 'touchstart') isTouchDevice = true;
            if (e.type === 'mousedown' && isTouchDevice) return; 
            
            isPressing = true;
            isRecordingMedia = false;
            clearTimeout(recordHoldTimer);
            
            recordHoldTimer = setTimeout(() => {
                if (!isPressing) return;
                isRecordingMedia = true;
                if (recordMode === 'voice') startVoice();
                else startCircleVideo();
            }, 300); // 300мс удержания для старта записи
        }

        function handleRecordStop(e) {
            if (e && e.type === 'mouseup' && isTouchDevice) return;
            
            if (!isPressing) return;
            isPressing = false;
            clearTimeout(recordHoldTimer);

            if (isRecordingMedia) {
                if (recordMode === 'voice') stopVoice();
                else stopCircleVideo();
                isRecordingMedia = false;
            } else {
                if (e && !['mouseleave', 'touchcancel', 'pointerleave', 'pointercancel'].includes(e.type)) {
                    toggleRecordMode();
                }
            }
        }

        function handleRecordLeave(e) { 
            if (e.type === 'mouseleave' && isTouchDevice) return;
            if (isPressing) handleRecordStop(e); 
        }

        function toggleRecordMode() {
            recordMode = recordMode === 'voice' ? 'video' : 'voice';
            document.getElementById('record-icon-voice').style.display = recordMode === 'voice' ? 'block' : 'none';
            document.getElementById('record-icon-video').style.display = recordMode === 'video' ? 'block' : 'none';
        }

        function hideCirclePreview() {
            const previewOverlay = document.getElementById('circle-preview-overlay');
            if (!previewOverlay) return;
            const previewVideo = document.getElementById('circle-preview-video');
            
            previewOverlay.classList.remove('visible');
            setTimeout(() => {
                previewOverlay.style.display = 'none';
                if (previewVideo) previewVideo.srcObject = null;
            }, 200); // Match CSS transition
        }

        async function emitMessage(content, type, duration = 0) {
            if (!currentChatUser) return;
            const now = new Date(); const time = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
            let finalContent = content;
            
            if (content && typeof content === 'string' && content.startsWith('data:')) {
                try {
                    const res = await fetch(SERVER_URL + '/api/upload/chat-media', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + localStorage.getItem('monochrome_token')
                        },
                        body: JSON.stringify({ media: content })
                    });
                    const data = await res.json();
                    if (data.success) {
                        finalContent = data.path;
                    } else {
                        return alert('Ошибка загрузки медиа');
                    }
                } catch(e) { return alert('Network error during upload'); }
            }

            const payload = { 
                to: currentChatUser.username, 
                text: finalContent, 
                type, 
                time, 
                duration 
            };
            if (replyContext) {
                payload.replyTo = replyContext;
            }
            socket.emit('private message', payload);
            cancelReply();
            setTimeout(loadRecentChats, 500);
        }

        socket.on('private message', (msg) => {
            // При получении любого сообщения, перезагружаем список чатов,
            // чтобы он отсортировался по-новому и обновилось последнее сообщение.
            loadRecentChats();

            // Далее, если чат открыт, добавляем сообщение в окно.
            if (!currentChatUser) return;
            
            const isGroupMsg = msg.receiver.startsWith('g');
            let chatIsActive = false;
            if (isGroupMsg) {
                chatIsActive = currentChatUser.username === msg.receiver;
            } else {
                const otherUser = (msg.sender === currentUser.username) ? msg.receiver : msg.sender;
                chatIsActive = currentChatUser.username === otherUser;
            }
            if (chatIsActive) {
                appendMessageUI(msg);
            } else {
                // Чат не активен, но мы уже перезагрузили список выше.
            }
        });

        socket.on('user is typing', ({ displayName, chatId }) => {
            if (!typingUsers.has(chatId)) {
                typingUsers.set(chatId, new Set());
            }
            typingUsers.get(chatId).add(displayName);

                        const lastMessageSpan = document.getElementById(`lm-${chatId}`);
            if (lastMessageSpan) {
                lastMessageSpan.innerHTML = `<em class="typing">печатает...</em>`;
            }

            updateTypingIndicator(chatId);
        });

        socket.on('user stopped typing', ({ displayName, chatId }) => {
            const typers = typingUsers.get(chatId);
            if (typingUsers.has(chatId)) {
                typingUsers.get(chatId).delete(displayName);
                if (typingUsers.get(chatId).size === 0) typingUsers.delete(chatId);
            }
            
            // Если в этом чате больше никто не печатает, нужно восстановить последнее сообщение
            if (!typers || typers.size === 0) {
                const lastMessageSpan = document.getElementById(`lm-${chatId}`);
                // Обновляем список, только если мы действительно показывали "печатает..."
                if (lastMessageSpan && lastMessageSpan.querySelector('.typing')) {
                    loadRecentChats(); // Самый надежный способ получить актуальное последнее сообщение
                }
            }
            updateTypingIndicator(chatId); // Обновляем заголовок в любом случае
        });
        
        socket.on('new_comment', (comment) => {
            const countSpan = document.getElementById(`comment-count-${comment.message_id}`);
            if (countSpan) countSpan.textContent = parseInt(countSpan.textContent || 0) + 1;
            
            if (currentCommentMessageId === comment.message_id) {
                appendCommentUI(comment);
            }
        });

        socket.on('user_music_changed', (data) => {
            if (currentChatUser && currentChatUser.username === data.username) {
                currentChatUser.music_status = data.music_status;
                if (document.getElementById('profile-modal').classList.contains('active')) {
                    const pmMusicWidget = document.getElementById('pm-music-widget');
                    if (data.music_status) {
                        pmMusicWidget.style.display = 'flex';
                        pmMusicWidget.classList.add('playing');
                        document.getElementById('pm-music-text').textContent = data.music_status;
                    } else {
                        pmMusicWidget.style.display = 'none';
                    }
                }
            }
        });

        socket.on('message failed', ({ time, error }) => {
            alert(`Не удалось отправить сообщение: ${error}`);
        });

        socket.on('new story', () => { if(typeof loadStories === 'function') loadStories(); });

        socket.on('group_member_removed', ({ groupId, removedUsername, removerUsername }) => {
                        const groupUsername = `g${groupId}`;
            if (removedUsername === currentUser.username) {
                alert(`Вы были удалены из группы.`);
                // Если текущий чат - эта группа, закрываем его
                if (currentChatUser && currentChatUser.username === groupUsername) {
                    closeChatMobile();
                    document.getElementById('message-input-area').style.display = 'none';
                    document.getElementById('messages-area').innerHTML = '';
                    document.getElementById('current-chat-name').textContent = 'Выберите чат';
                }
                // Удаляем чат из списка
                const chatItem = document.querySelector(`.chat-item[data-username="${groupUsername}"]`);
                if (chatItem) chatItem.remove();
            } else {
                // Если открыт этот чат, обновляем инфо
                if (currentChatUser && currentChatUser.username === groupUsername) {
                    openGroupInfoModal(); // Re-fetch details
                }
            }
        });

        socket.on('group_settings_updated', ({ groupId, newSettings }) => {
            if (currentChatUser && currentChatUser.username === `g${groupId}`) {
                currentChatUser.display_name = newSettings.name;
                currentChatUser.public_id = newSettings.public_id;
                selectChat(currentChatUser); // Re-render header
                if (document.getElementById('group-info-modal').classList.contains('active')) {
                    openGroupInfoModal(); // Refresh modal if open
                }
            }
            loadRecentChats(); // Refresh chat list
        });

        function renderMessages(messages) {
            const area = document.getElementById('messages-area');
            area.innerHTML = '';
            
            if (messages.length === 0) {
                area.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted); opacity: 0.5;">РСЃС‚РѕСЂРёСЏ СЃРѕРѕР±С‰РµРЅРёР№ РїСѓСЃС‚Р°</div>';
                return;
            }

            const fragment = document.createDocumentFragment();
            messages.forEach(msg => {
                const msgEl = createMessageElement(msg);
                fragment.appendChild(msgEl);
            });
            
            area.appendChild(fragment);
            area.scrollTop = area.scrollHeight;
            
            // Запускаем отрисовку реакций после вставки в DOM
            messages.forEach(msg => {
                if (msg.reactions && msg.reactions.length > 0) {
                    renderReactions(msg.id, msg.reactions);
                }
            });
        }

        function createMessageElement(msg) {
            const isMine = msg.sender === currentUser.username;
            const div = document.createElement('div');
            div.className = `message ${isMine ? 'mine' : 'other'}`;
            div.id = `msg-${msg.id}`;
            div.dataset.reactions = JSON.stringify(msg.reactions || []);
            
            let content = '';
            const isGroup = currentChatUser && currentChatUser.isGroup;
            let senderNameHTML = '';
            if (isGroup && !isMine) {
                let badges = '';
                if (msg.sender === 'xxx') {
                    badges = '<span class="premium-plate dev">DEV</span><span class="premium-plate admin">ADMIN</span>';
                }
                senderNameHTML = `<div class="message-sender-name">${escapeHTML(msg.sender_display_name || msg.sender)}${badges}</div>`;
            }

            let bubbleClass = 'bubble';

            let replyHTML = '';
            if (msg.reply_to_message_id && msg.reply_snippet) {
                const [sender, ...snippetParts] = msg.reply_snippet.split(': ');
                const snippet = snippetParts.join(': ');
                replyHTML = `
                    <div class="reply-block" onclick="scrollToMessage(${msg.reply_to_message_id})">
                        <b>${escapeHTML(sender)}</b>
                        <p>${escapeHTML(snippet)}</p>
                    </div>
                `;
            }

            let forwardedHTML = '';
                        if (msg.forwarded_from_username) {
                forwardedHTML = `
                    <div class="forwarded-label">
                        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15l5-5-5-5"/></svg>
                        Переслано от @${escapeHTML(msg.forwarded_from_username)}
                    </div>
                `;
            }

            let images = [];
            if (msg.type === 'image') {
                bubbleClass += ' image-bubble';
                content = `<img src="${escapeHTML(getFullUrl(msg.text))}" class="message-img" id="img-${msg.id}" loading="lazy">`;
            } else if (msg.type === 'gallery') {
                try {
                    images = JSON.parse(msg.text).map(getFullUrl);
                    bubbleClass += ' gallery-bubble';
                                        content = `<div class="gallery-grid">${images.map((src, index) => `<img src="${escapeHTML(src)}" class="message-img" id="gallery-${msg.id}-${index}" loading="lazy">`).join('')}</div>`;
                } catch(e) { content = "<i>Ошибка галереи</i>"; }
            } else if (msg.type === 'audio') {
                let barWidth = Math.min(100 + ((msg.duration || 0) * 15), 280);
                content = `<div class="voice-player" style="width: ${barWidth}px;">
                    <button class="play-btn" onclick="playVoice(this, '${escapeHTML(msg.text)}')">
                        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                    <div class="voice-wave voice-dynamic-wave"><div class="voice-progress"></div></div>
                    <audio class="hidden-audio" src="${escapeHTML(getFullUrl(msg.text))}"></audio>
                </div>`;
            } else if (msg.type === 'circle_video') {
                bubbleClass += ' circle-bubble';
                content = `<video class="circle-video" src="${escapeHTML(getFullUrl(msg.text))}" autoplay loop muted playsinline onclick="this.muted = !this.muted"></video>`;
            } else if (msg.type === 'sticker') {
                bubbleClass += ' sticker-bubble';
                content = `<img src="${escapeHTML(getFullUrl(msg.text))}" class="sticker-img" loading="lazy">`;
            } else {
                content = escapeHTML((msg.text || '').toString());
            }

            let commentsHTML = '';
            if (currentChatUser && currentChatUser.type === 'channel') {
                commentsHTML = `<div class="message-comments-btn" onclick="openComments(${msg.id})">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:6px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    Комментарии (<span id="comment-count-${msg.id}">${msg.comment_count || 0}</span>)
                </div>`;
            }

            div.innerHTML = `
                <div class="${bubbleClass}" oncontextmenu="openMessageMenu(event, ${msg.id}, ${isMine})">
                    ${senderNameHTML}
                    ${forwardedHTML}
                    ${replyHTML}
                    ${content}
                </div>
                <div class="message-footer">
                    ${commentsHTML}
                    <div class="message-reactions" id="reactions-${msg.id}"></div>
                    <div class="message-meta">
                        <span class="message-time">${msg.time}</span>
                    </div>
                </div>`;

            // Обработчики для изображений
            if (msg.type === 'image') {
                const img = div.querySelector('.message-img');
                img.onclick = () => openImageViewer([getFullUrl(msg.text)], 0);
            } else if (msg.type === 'gallery' && images.length > 0) {
                div.querySelectorAll('.message-img').forEach((img, i) => {
                    img.onclick = () => openImageViewer(images, i);
                });
            }

            // Навешиваем ховеры для действий
            div.onmouseenter = () => showMessageActionsWithDelay(div);
            div.onmouseleave = () => hideMessageActionsWithDelay(div);

            return div;
        }

        // Старая функция appendMessageUI теперь может использовать createMessageElement
        function appendMessageUI(msg) {
            const area = document.getElementById('messages-area');
            const el = createMessageElement(msg);
            area.appendChild(el);
            area.scrollTop = area.scrollHeight;
            if (msg.reactions && msg.reactions.length > 0) renderReactions(msg.id, msg.reactions);
        }

        function playVoice(btn, src) {
            const audio = btn.parentElement.querySelector('.hidden-audio');
            const icon = btn.querySelector('svg');
            const progress = btn.parentElement.querySelector('.voice-progress');
            
            if (audio.paused) { 
                document.querySelectorAll('audio').forEach(a => { a.pause(); a.currentTime = 0; });
                audio.play(); 
                icon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'; 
            } else { 
                audio.pause(); 
                icon.innerHTML = '<path d="M8 5v14l11-7z"/>'; 
            }
            
            audio.ontimeupdate = () => { if(progress) progress.style.width = (audio.currentTime / audio.duration * 100) + '%'; };
            audio.onended = () => { icon.innerHTML = '<path d="M8 5v14l11-7z"/>'; if(progress) progress.style.width = '0%'; };
        }

        function openDeleteModal(id, mine) {
            messageToDeleteId = id;
            document.getElementById('btn-delete-everyone').style.display = mine ? 'block' : 'none';
            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('delete-modal').classList.add('active');
        }

        // ADMIN MODERN PANEL LOGIC
        function openAdminPanel() {
            closeAllModals();
            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('admin-panel-modal').classList.add('active');
            switchAdminTab('reports'); // Open reports by default
        }

        function switchAdminTab(tabName) {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-content-section').forEach(s => s.classList.remove('active'));
            
            // Highlight the clicked tab
            const tabs = document.querySelectorAll('.admin-tab');
            for (let t of tabs) {
                if (t.textContent.toLowerCase().includes(tabName === 'reports' ? 'жалобы' : (tabName === 'users' ? 'пользователи' : 'логи'))) {
                    t.classList.add('active');
                    break;
                }
            }

            const section = document.getElementById(`admin-section-${tabName}`);
            if (section) section.classList.add('active');
            
            if (tabName === 'users') handleAdminUserSearch();
        }

        function handleAdminUserSearch() {
            const query = document.getElementById('admin-user-search').value.trim();
            socket.emit('admin_search_users', { query });
        }

        socket.on('admin_search_results', (users) => {
                        const list = document.getElementById('admin-users-list');
            list.innerHTML = '';
            if (users.length === 0) {
                list.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Пользователи не найдены</div>';
                return;
            }
            users.forEach(u => {
                const item = document.createElement('div');
                item.className = 'admin-user-item';
                item.innerHTML = `
                                        <div class="admin-user-info">
                        <div class="admin-user-name">${u.display_name} (@${u.username})</div>
                        <div class="admin-user-sub">${u.email || 'Нет почты'} | [${u.is_verified ? 'Verified' : 'Pending'}]</div>
                    </div>
                    <div class="admin-user-actions">
                        ${u.is_banned 
                            ? `<button class="unban-btn" onclick="adminUnban('${u.username}')">Разбанить</button>`
                            : `<button class="ban-btn" onclick="adminBan('${u.username}')">Бан</button>`
                        }
                    </div>
                `;
                list.appendChild(item);
            });
        });

                function adminBan(username) {
            if (confirm(`Забанить ${username}?`)) {
                socket.emit('admin_ban_user', { username });
                handleAdminUserSearch();
            }
        }

        function adminUnban(username) {
            if (confirm(`Разбанить ${username}?`)) {
                socket.emit('admin_unban_user', { username });
                handleAdminUserSearch();
            }
        }

        function executeDelete(type) {
            socket.emit('delete message', { msgId: messageToDeleteId, deleteType: type });
            closeAllModals();
        }

        socket.on('message deleted', (data) => { const el = document.getElementById(`msg-${data.msgId}`); if (el) el.remove(); });

        let activeMenuMsgId = null;
        function openMessageMenu(e, msgId, isMine) {
            e.preventDefault();
            activeMenuMsgId = msgId;
            const menu = document.getElementById('msg-context-menu');
            menu.style.display = 'block';
            menu.classList.add('active');
            
            // Position menu
            let x = e.clientX;
            let y = e.clientY;
            
            // Adjust if near edges
            if (x + 200 > window.innerWidth) x -= 180;
            if (y + 250 > window.innerHeight) y -= 200;
            
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            
            // Set actions
            const msg = allMessages.find(m => m.id === msgId);
            
            document.getElementById('menu-delete').onclick = (ev) => { 
                ev.stopPropagation(); 
                closeMessageMenu(); 
                openDeleteModal(msgId, isMine); 
            };
            document.getElementById('menu-reply').onclick = (ev) => { 
                ev.stopPropagation(); 
                closeMessageMenu();
                showReplyUI(msgId, msg.sender, msg.text, msg.type); 
            };
            document.getElementById('menu-forward').onclick = (ev) => { 
                ev.stopPropagation(); 
                closeMessageMenu(); 
                openForwardModal(msgId); 
            };
            document.getElementById('menu-report').onclick = (ev) => { 
                ev.stopPropagation(); 
                closeMessageMenu(); 
                reportMessage(msgId); 
            };
            document.getElementById('menu-copy').onclick = (ev) => { 
                ev.stopPropagation(); 
                closeMessageMenu();
                if (msg.text) {
                    navigator.clipboard.writeText(msg.text);
                    alert('Текст скопирован');
                }
            };
            
            // Close on click outside (but not if clicking the menu itself)
            setTimeout(() => {
                const closeHandler = (ev) => {
                    if (!menu.contains(ev.target)) {
                        closeMessageMenu();
                        document.removeEventListener('click', closeHandler);
                    }
                };
                document.addEventListener('click', closeHandler);
            }, 10);
        }

        function closeMessageMenu() {
            const menu = document.getElementById('msg-context-menu');
            menu.classList.remove('active');
            menu.style.display = 'none';
        }

        function reportMessage(msgId) {
            const reason = prompt('Введите причину жалобы:');
            if (reason) {
                socket.emit('report_message', { messageId: msgId, reason: reason }, (res) => {
                    if (res && res.success) alert('Жалоба отправлена. Спасибо!');
                    else alert('Ошибка при отправке жалобы.');
                });
            }
        }

        function openForwardModal(msgId) {
            forwardMessageId = msgId;
            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('new-chat-choice-modal').classList.add('active');
        }

        function openAdminPanel() {
            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('admin-panel-modal').classList.add('active');
            switchAdminTab('reports');
        }

        function switchAdminTab(tab) {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            const tabBtn = document.querySelector(`.admin-tab[onclick*="${tab}"]`);
            if (tabBtn) tabBtn.classList.add('active');
            
            document.querySelectorAll('.admin-content-section').forEach(s => s.style.display = 'none');
            const section = document.getElementById(`admin-section-${tab}`);
            if (section) section.style.display = 'block';

            if (tab === 'reports') {
                socket.emit('admin_get_reports', (reports) => {
                    const container = document.getElementById('admin-section-reports');
                    container.innerHTML = '<h3>Последние жалобы</h3>';
                    if (!reports || reports.length === 0) {
                        container.innerHTML += '<p style="padding:20px; text-align:center; opacity:0.5;">Жалоб нет</p>';
                        return;
                    }
                    reports.forEach(r => {
                        const div = document.createElement('div');
                        div.style = 'background:rgba(255,255,255,0.05); padding:12px; border-radius:12px; margin-bottom:12px; border-left:4px solid #ef4444;';
                        div.innerHTML = `
                            <div style="font-size:12px; margin-bottom:4px; opacity:0.7;">От: @${r.reporter} | На: @${r.message_sender}</div>
                            <div style="font-weight:600; margin-bottom:6px;">Причина: ${escapeHTML(r.reason)}</div>
                            <div style="font-style:italic; font-size:13px; background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;">"${escapeHTML(r.message_text || '[Медиа]')}"</div>
                        `;
                        container.appendChild(div);
                    });
                });
            } else if (tab === 'users') {
                handleAdminUserSearch();
            }
        }

        function handleAdminUserSearch() {
            socket.emit('admin_get_users', (users) => {
                const container = document.getElementById('admin-section-users');
                container.innerHTML = '<h3>Пользователи</h3>';
                if (!users || users.length === 0) return;
                users.forEach(u => {
                    const div = document.createElement('div');
                    div.style = 'display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid rgba(255,255,255,0.03);';
                    const banBtn = u.is_banned ? 
                        `<button onclick="adminUnban('${u.username}')" style="background:#2ecc71; padding:6px 12px; border-radius:8px; border:none; color:white; font-weight:600; cursor:pointer;">Разбанить</button>` :
                        `<button onclick="adminBan('${u.username}')" style="background:#ef4444; padding:6px 12px; border-radius:8px; border:none; color:white; font-weight:600; cursor:pointer;">Забанить</button>`;
                    
                    div.innerHTML = `<div><strong>${escapeHTML(u.display_name)}</strong> (@${u.username})</div> <div>${banBtn}</div>`;
                    container.appendChild(div);
                });
            });
        }
        
        function adminBan(username) {
            if (confirm(`Забанить @${username}?`)) {
                socket.emit('admin_ban_user', { username });
                setTimeout(handleAdminUserSearch, 300);
            }
        }

        function adminUnban(username) {
            if (confirm(`Разбанить @${username}?`)) {
                socket.emit('admin_unban_user', { username });
                setTimeout(handleAdminUserSearch, 300);
            }
        }
