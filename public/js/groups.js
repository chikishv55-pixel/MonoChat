function openNewChatChoiceModal() {
            closeAllModals();
            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('new-chat-choice-modal').classList.add('active');
        }

        socket.on('reaction updated', (data) => {
            const msgEl = document.getElementById(`msg-${data.messageId}`);
            if (msgEl) {
                let reactions = JSON.parse(msgEl.dataset.reactions || '[]');
                if (data.action === 'added') {
                    reactions.push({ message_id: data.messageId, reactor_username: data.reactorUsername, emoji: data.emoji });
                } else if (data.action === 'removed') {
                    reactions = reactions.filter(r => !(r.reactor_username === data.reactorUsername && r.emoji === data.emoji));
                }
                msgEl.dataset.reactions = JSON.stringify(reactions);
                renderReactions(data.messageId, reactions);
            }
        });

        function renderReactions(messageId, reactions) {
            const container = document.getElementById(`reactions-${messageId}`);
            if (!container) return;
            container.innerHTML = '';
            if (!reactions || reactions.length === 0) return;

            const reactionCounts = {};
            const userReactions = new Set();
            reactions.forEach(r => {
                if (!reactionCounts[r.emoji]) reactionCounts[r.emoji] = 0;
                reactionCounts[r.emoji]++;
                if (r.reactor_username === currentUser?.username) userReactions.add(r.emoji);
            });

            for (const [emoji, count] of Object.entries(reactionCounts)) {
                const pill = document.createElement('div');
                pill.className = `reaction-pill ${userReactions.has(emoji) ? 'active' : ''}`;
                pill.innerHTML = `<span>${emoji}</span> <span class="reaction-count">${count > 1 ? count : ''}</span>`;
                pill.onclick = () => clientToggleReaction(messageId, emoji);
                container.appendChild(pill);
            }
        }

        // --- Функции создания групп ---

        function openCreateChatModal() {
            newGroupMembers.clear();
            document.getElementById('new-group-name').value = '';
            const searchInput = document.getElementById('new-group-member-search');
            searchInput.value = '';
            document.getElementById('new-group-search-results').innerHTML = '';
            updateNewGroupMembersUI();

            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('create-chat-modal').classList.add('active');

            searchInput.oninput = () => {
                const query = searchInput.value.trim();
                if (query.length > 1) {
                    socket.emit('search users', query, (users) => {
                        const resultsContainer = document.getElementById('new-group-search-results');
                        resultsContainer.innerHTML = '';
                        users.forEach(user => {
                            if (newGroupMembers.has(user.username)) return;
                            const userDiv = document.createElement('div');
                            userDiv.className = 'search-result-item';
                            userDiv.innerHTML = `<b>${escapeHTML(user.display_name)}</b> <span class="username-tag">@${escapeHTML(user.username)}</span>`;
                            userDiv.onclick = () => {
                                newGroupMembers.add(user.username);
                                updateNewGroupMembersUI();
                                searchInput.value = '';
                                resultsContainer.innerHTML = '';
                                searchInput.focus();
                            };
                            resultsContainer.appendChild(userDiv);
                        });
                    });
                } else {
                    document.getElementById('new-group-search-results').innerHTML = '';
                }
            };
        }

        function updateNewGroupMembersUI() {
            const membersList = document.getElementById('new-group-members-list');
            membersList.innerHTML = '';
            newGroupMembers.forEach(username => {
                const memberTag = document.createElement('span');
                memberTag.className = 'member-tag';
                memberTag.textContent = username;
                const removeBtn = document.createElement('button');
                removeBtn.className = 'member-tag-remove';
                removeBtn.textContent = ' ×';
                removeBtn.onclick = () => { newGroupMembers.delete(username); updateNewGroupMembersUI(); };
                memberTag.appendChild(removeBtn);
                membersList.appendChild(memberTag);
            });
        }

        function openCreateChatModal(type = 'group') {
            closeAllModals();
            newGroupMembers.clear();
            document.getElementById('new-group-name').value = '';
            document.getElementById('new-group-name').parentElement.style.display = 'block';
            const searchInput = document.getElementById('new-group-member-search');
            searchInput.value = '';
            document.getElementById('new-group-search-results').innerHTML = '';
            updateNewGroupMembersUI();

            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('create-chat-modal').classList.add('active');

            const createBtn = document.querySelector('#create-chat-modal .modal-btn');
            const title = document.querySelector('#create-chat-modal h3');
            if (type === 'channel') {
                title.textContent = 'Создать новый канал';
                createBtn.textContent = 'Создать канал';
                createBtn.onclick = () => createChat('channel');
            } else {
                title.textContent = 'Создать новую группу';
                createBtn.textContent = 'Создать группу';
                createBtn.onclick = () => createChat('group');
            }

            searchInput.oninput = () => {
                const query = searchInput.value.trim();
                if (query.length > 1) {
                    socket.emit('search users', query, (users) => {
                        const resultsContainer = document.getElementById('new-group-search-results');
                        resultsContainer.innerHTML = '';
                        users.forEach(user => {
                            if (newGroupMembers.has(user.username) || user.isGroup) return;
                            const userDiv = document.createElement('div');
                            userDiv.className = 'search-result-item';
                            userDiv.innerHTML = `<b>${escapeHTML(user.display_name)}</b> <span class="username-tag">@${escapeHTML(user.username)}</span>`;
                            userDiv.onclick = () => {
                                newGroupMembers.add(user.username);
                                updateNewGroupMembersUI();
                                searchInput.value = '';
                                resultsContainer.innerHTML = '';
                                searchInput.focus();
                            };
                            resultsContainer.appendChild(userDiv);
                        });
                    });
                } else {
                    document.getElementById('new-group-search-results').innerHTML = '';
                }
            };
        }

        function createChat(type) {
            const groupName = document.getElementById('new-group-name').value.trim();
            if (!groupName) return alert('Введите название.');
            if (newGroupMembers.size === 0 && type === 'group') return alert('Добавьте хотя бы одного участника в группу.');

            const membersArray = Array.from(newGroupMembers);
            socket.emit('create_chat', { name: groupName, type: type, members: membersArray }, (res) => {
                if (res.success) {
                    closeAllModals();
                    loadRecentChats();
                    const newChatObject = { username: `g${res.chat.id}`, display_name: res.chat.name, avatar: res.chat.avatar, isGroup: true, isOnline: false, type: res.chat.type };
                    setTimeout(() => selectChat(newChatObject), 200); // Небольшая задержка для рендера списка
                } else {
                    alert(`Ошибка: ${res.message}`);
                }
            });
        }

        // --- Функции своего профиля ---
        function openMyProfileModal() {
            document.getElementById('my-profile-view').classList.remove('hidden');
            document.getElementById('my-profile-edit').classList.add('hidden');

            updateAllMyAvatars(currentUser.avatar, currentUser.display_name);
            document.getElementById('my-profile-name-modal').textContent = currentUser.display_name;
            document.getElementById('my-profile-username-modal').textContent = '@' + currentUser.username;
            document.getElementById('my-profile-bio').textContent = currentUser.bio || 'Нет описания';
            document.getElementById('my-profile-bdate').textContent = currentUser.birth_date ? `Дата рождения: ${new Date(currentUser.birth_date).toLocaleDateString()}` : 'Дата рождения не указана';

            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('my-profile-modal').classList.add('active');
        }

        function enterEditProfileMode() {
            document.getElementById('my-profile-view').classList.add('hidden');
            document.getElementById('my-profile-edit').classList.remove('hidden');

            setAvatarUI('edit-profile-avatar-img', 'edit-profile-avatar-text', currentUser.avatar, currentUser.display_name);
            document.getElementById('edit-profile-name').value = currentUser.display_name;
            document.getElementById('edit-profile-bio').value = currentUser.bio || '';
            document.getElementById('edit-profile-bdate').value = currentUser.birth_date || '';
        }

        function exitEditProfileMode() {
            document.getElementById('my-profile-view').classList.remove('hidden');
            document.getElementById('my-profile-edit').classList.add('hidden');
        }

        function saveProfile() {
            const data = {
                displayName: document.getElementById('edit-profile-name').value.trim(),
                bio: document.getElementById('edit-profile-bio').value.trim(),
                birthDate: document.getElementById('edit-profile-bdate').value,
            };
            if (!data.displayName) return alert('Имя не может быть пустым.');

            socket.emit('update_profile', data, (res) => {
                if (res.success) {
                    // Обновляем данные без перезагрузки чатов
                    currentUser = res.user;
                    localStorage.setItem('monochrome_user', JSON.stringify(res.user));
                    document.getElementById('profile-name').textContent = res.user.display_name;
                    updateAllMyAvatars(res.user.avatar, res.user.display_name);
                    openMyProfileModal(); // Переоткрываем модалку с обновленными данными
                } else { alert('Ошибка: ' + (res.message || 'Не удалось сохранить профиль.')); }
            });
        }

        // --- Функции просмотра изображений ---

        function openImageViewer(sources, index) {
            imageViewerData.sources = sources;
            imageViewerData.currentIndex = index;
            
            const viewer = document.getElementById('image-viewer');
            viewer.classList.add('active');
            
            updateImageViewer();
        }

        function closeImageViewer() {
            document.getElementById('image-viewer').classList.remove('active');
        }

        function nextImage() {
            if (imageViewerData.currentIndex < imageViewerData.sources.length - 1) {
                imageViewerData.currentIndex++;
                updateImageViewer();
            }
        }

        function prevImage() {
            if (imageViewerData.currentIndex > 0) {
                imageViewerData.currentIndex--;
                updateImageViewer();
            }
        }

        function updateImageViewer() {
            const { sources, currentIndex } = imageViewerData;
            document.getElementById('iv-image').src = sources[currentIndex];
            const counter = document.getElementById('iv-counter');
            const prevBtn = document.querySelector('.iv-prev');
            const nextBtn = document.querySelector('.iv-next');
            counter.style.display = sources.length > 1 ? 'block' : 'none';
            counter.textContent = `${currentIndex + 1} / ${sources.length}`;
            prevBtn.style.display = currentIndex > 0 ? 'flex' : 'none';
            nextBtn.style.display = currentIndex < sources.length - 1 ? 'flex' : 'none';
        }

        // --- Функции управления группами ---

        function openGroupInfoModal() {
            if (!currentChatUser || !currentChatUser.isGroup) return;
            const groupId = currentChatUser.username; // e.g. "g123"

            socket.emit('get_group_details', groupId, (res) => {
                if (!res.success) return alert(res.message);
                
                const { group, members, myRole } = res;
                currentChatUser.groupData = group; // Cache group data

                setAvatarUI('gi-avatar-img', 'gi-avatar-text', group.avatar, group.name);
                document.getElementById('gi-name').textContent = group.name;
                document.getElementById('gi-id').textContent = group.public_id ? `@${group.public_id}` : `ID: ${group.id}`;

                const membersList = document.getElementById('gi-members-list');
                membersList.innerHTML = '';
                members.forEach(member => {
                    const item = document.createElement('div');
                    item.className = 'group-member-item';
                    const safeDisplayName = escapeHTML(member.display_name);
                    const avatarHTML = member.avatar ? `<img class="chat-avatar" src="${escapeHTML(getFullUrl(member.avatar))}">` : `<div class="chat-avatar">${safeDisplayName.substring(0,2).toUpperCase()}</div>`;
                    const removeBtnHTML = (myRole === 'admin' && member.role !== 'admin' && member.username !== currentUser.username)
                        ? `<button class="remove-member-btn" onclick="removeGroupMember('${member.username}')">×</button>`
                        : '';

                    item.innerHTML = `
                        ${avatarHTML}
                        <div class="group-member-info">
                            <div class="name">${safeDisplayName}</div>
                            <div class="role">${member.role === 'admin' ? 'Администратор' : 'Участник'}</div>
                        </div>
                        ${removeBtnHTML}
                    `;
                    membersList.appendChild(item);
                });

                const isAdmin = myRole === 'admin';
                document.getElementById('gi-add-member-btn').style.display = isAdmin ? 'block' : 'none';
                document.getElementById('gi-edit-btn').style.display = isAdmin ? 'block' : 'none';

                document.getElementById('main-overlay').classList.add('active');
                document.getElementById('group-info-modal').classList.add('active');
            });
        }

        function removeGroupMember(usernameToRemove) {
            if (!confirm(`Вы уверены, что хотите удалить @${usernameToRemove} из группы?`)) return;
            const groupId = currentChatUser.username.substring(1);
            socket.emit('remove_group_member', { groupId, usernameToRemove }, (res) => {
                if (res.success) {
                    openGroupInfoModal(); // Refresh the list
                } else {
                    alert(`Ошибка: ${res.message}`);
                }
            });
        }

        function leaveGroup() {
            if (!confirm('Вы уверены, что хотите покинуть эту группу?')) return;
            const groupId = currentChatUser.username.substring(1);
            socket.emit('remove_group_member', { groupId, usernameToRemove: currentUser.username }, (res) => {
                if (res.success) {
                    closeAllModals();
                } else {
                    alert(`Ошибка: ${res.message}`);
                }
            });
        }

        function openAddMembersModal() {
            // Re-using the create chat modal for adding members
            openCreateChatModal();
            document.querySelector('#create-chat-modal h3').textContent = 'Добавить участников';
            document.getElementById('new-group-name').parentElement.style.display = 'none'; // Hide name input
            const addBtn = document.querySelector('#create-chat-modal .modal-btn');
            addBtn.textContent = 'Добавить';
            addBtn.onclick = addMembersToGroup;
        }

        function addMembersToGroup() {
            if (newGroupMembers.size === 0) return alert('Выберите участников для добавления.');
            const groupId = currentChatUser.username.substring(1);
            const membersArray = Array.from(newGroupMembers);
            socket.emit('add_group_members', { groupId, members: membersArray }, (res) => {
                if (res.success) {
                    closeAllModals();
                    openGroupInfoModal(); // Refresh list
                } else {
                    alert(`Ошибка: ${res.message}`);
                }
            });
        }

        function openEditGroupModal() {
            const groupData = currentChatUser.groupData;
            if (!groupData) return alert('Сначала откройте информацию о группе.');
            document.getElementById('edit-group-name').value = groupData.name;
            document.getElementById('edit-group-public-id').value = groupData.public_id || '';
            document.getElementById('edit-group-visibility').value = groupData.visibility;
            document.getElementById('edit-group-modal').classList.add('active');
        }

        function saveGroupSettings() {
            const groupId = currentChatUser.username.substring(1);
            const settings = {
                name: document.getElementById('edit-group-name').value.trim(),
                public_id: document.getElementById('edit-group-public-id').value.trim(),
                visibility: document.getElementById('edit-group-visibility').value
            };
            if (!settings.name) return alert('Название группы не может быть пустым.');

            socket.emit('update_group_settings', { groupId, settings }, (res) => {
                if (res.success) {
                    closeAllModals();
                } else {
                    alert(`Ошибка: ${res.message}`);
                }
            });
        }

        // --- Музыкальный статус ---
        function updateMyMusicUI(status) {
            const widget = document.getElementById('my-music-widget');
            const text = document.getElementById('my-music-text');
            if (status) {
                widget.classList.add('playing');
                text.textContent = status;
            } else {
                widget.classList.remove('playing');
                text.textContent = 'Установить музыку...';
            }
        }

        function promptMusicStatus() {
            closeAllModals();
            document.getElementById('music-input').value = currentUser.music_status || '';
            document.getElementById('main-overlay').classList.add('active');
            document.getElementById('music-modal').classList.add('active');
        }

        function saveMusicStatus() {
            const status = document.getElementById('music-input').value.trim();
            socket.emit('update_music_status', status, (res) => {
                if(res.success) { authSuccess({...currentUser, music_status: res.music_status}); closeAllModals(); }
            });
        }

        function clearMusicStatus() {
            socket.emit('update_music_status', null, (res) => {
                if(res.success) { authSuccess({...currentUser, music_status: null}); closeAllModals(); }
            });
        }

        function updateTypingIndicator(chatId) {
            if (currentChatUser && currentChatUser.username === chatId) {
                const statusText = document.getElementById('current-chat-status-text');
                const typers = typingUsers.get(chatId);

                if (typers && typers.size > 0) {
                    const names = Array.from(typers).map(escapeHTML);
                    if (names.length === 1) {
                        statusText.textContent = `${names[0]} печатает...`;
                    } else if (names.length === 2) {
                        statusText.textContent = `${names[0]} и ${names[1]} печатают...`;
                    } else {
                        statusText.textContent = `${names[0]} и еще ${names.length - 1} печатают...`;
                    }
                    statusText.classList.add('typing');
                } else {
                    // Revert to original status
                    statusText.classList.remove('typing');
                    if (currentChatUser.isGroup) {
                        statusText.textContent = currentChatUser.type === 'channel' ? 'Канал' : 'Группа';
                    } else {
                        statusText.textContent = currentChatUser.isOnline ? 'в сети' : 'офлайн';
                    }
                }
            }
        }

        function updateAllMyAvatars(avatarUrl, displayName) {
            setAvatarUI('pm-avatar-img', 'pm-avatar-text', avatarUrl, displayName);
            setAvatarUI('my-profile-avatar-img', 'my-profile-avatar-text', avatarUrl, displayName);
            setAvatarUI('edit-profile-avatar-img', 'edit-profile-avatar-text', avatarUrl, displayName);
        }

        function setAvatarUI(imgId, textId, data, name) {
            const imgEl = document.getElementById(imgId);
            if (!imgEl) return; // Safety check
            const container = imgEl.parentElement;
            if (container) {
                container.innerHTML = `<img id="${imgId}" src="" style="display:none" class="avatar-img-actual">
                                      <div id="${textId}" style="display:none" class="avatar-text-actual"></div>`;
                const img = document.getElementById(imgId); 
                const txt = document.getElementById(textId);
                const finalData = data && data.startsWith('/uploads/') ? `${getFullUrl(data)}?t=${new Date().getTime()}` : data;
                
                if (finalData) {
                    if (isVideoPath(data)) {
                        container.innerHTML = `<video id="${imgId}" src="${finalData}" autoplay loop muted playsinline class="avatar-img-actual" style="display:flex; object-fit:cover; width:100%; height:100%"></video>
                                              <div id="${textId}" style="display:none" class="avatar-text-actual"></div>`;
                    } else {
                        img.src = finalData; img.style.display = 'flex'; txt.style.display = 'none';
                    }
                } else {
                    img.style.display = 'none'; txt.style.display = 'flex'; txt.textContent = name ? name.substring(0,2).toUpperCase() : '??';
                }
            }
        }

        function logout() { localStorage.removeItem('monochrome_user'); localStorage.removeItem('monochrome_token'); window.location.reload(); }

        // ==========================================
        // WEBRTC ВИДЕОЗВОНКИ
        // ==========================================
        let peerConnection;
