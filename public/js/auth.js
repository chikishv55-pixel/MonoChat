function showLogin() { document.getElementById('login-card').classList.remove('hidden'); document.getElementById('register-card').classList.add('hidden'); }
        function showRegister() { document.getElementById('login-card').classList.add('hidden'); document.getElementById('register-card').classList.remove('hidden'); }
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
            document.getElementById('profile-name').textContent = user.display_name;
            document.getElementById('profile-username-label').textContent = '@' + user.username;
            updateAllMyAvatars(user.avatar, user.display_name);
            updateMyMusicUI(user.music_status);
            
            socket.emit('get contacts', (contacts) => {
                myContacts = {};
                contacts.forEach(c => myContacts[c.contact_username] = c.alias);
                document.getElementById('auth-screen').classList.remove('active');
                document.getElementById('chat-screen').classList.add('active');
                loadRecentChats();
                loadStories();
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
                } else alert(res.message);
            } catch (err) { alert('Ошибка'); }
        }

        async function register() {
            const displayName = document.getElementById('reg-displayname').value.trim();
            const username = document.getElementById('reg-username').value.trim();
            const password = document.getElementById('reg-password').value;
            const passwordCheck = document.getElementById('reg-password2').value;
            if (password !== passwordCheck) return alert('Пароли не совпадают');
            if(!username || !displayName || !password) return alert('Заполните все поля');
            try {
                const response = await fetch(SERVER_URL + '/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, displayName, password, fcmToken: localStorage.getItem('fcm_token') || fcmToken })
                });
                const res = await response.json();
                if (res.success) {
                    localStorage.setItem('monochrome_token', res.token);
                    socket.auth = { token: res.token };
                    socket.disconnect().connect();
                    authSuccess(res.user);
                } else alert(res.message);
            } catch (err) { alert('Ошибка'); }
        }
