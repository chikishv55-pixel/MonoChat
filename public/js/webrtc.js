let localStream;
        let remoteStream;
        let callPeerUsername = null;
        let isCurrentCallVideo = true;

        // Бесплатные STUN сервера от Google для пробития NAT
        const rtcConfig = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

        async function startCall(videoEnabled) {
            if (!currentChatUser || currentChatUser.isGroup) return;
            callPeerUsername = currentChatUser.username;
            isCurrentCallVideo = videoEnabled;
            
            // Предварительная настройка UI звонка
            document.getElementById('toggle-video-btn').style.display = videoEnabled ? 'flex' : 'none';
            document.getElementById('toggle-video-btn').style.background = 'rgba(255,255,255,0.2)';
            document.getElementById('toggle-audio-btn').style.background = 'rgba(255,255,255,0.2)';

            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: videoEnabled, audio: true });
                if (videoEnabled) {
                    document.getElementById('local-video').style.display = 'block';
                    document.getElementById('local-video').srcObject = localStream;
                } else {
                    document.getElementById('local-video').srcObject = null;
                }
                
                document.getElementById('video-call-overlay').style.display = 'flex';
                socket.emit('start_call', { to: callPeerUsername, isVideo: videoEnabled });
            } catch (err) { alert('Не удалось получить доступ к камере или микрофону. Проверьте разрешения.'); callPeerUsername = null; }
        }

        socket.on('incoming_call', (data) => {
            if (callPeerUsername) {
                socket.emit('reject_call', { to: data.from }); // Уже разговариваем
                return;
            }
            closeAllModals();
            callPeerUsername = data.from;
            isCurrentCallVideo = data.isVideo;

            setAvatarUI('ic-avatar-img', 'ic-avatar-text', getFullUrl(data.callerAvatar), data.callerName);
            document.getElementById('ic-caller-name').textContent = data.callerName;
            document.getElementById('ic-call-type').textContent = data.isVideo ? 'Входящий видеозвонок' : 'Входящий аудиозвонок';
            document.getElementById('incoming-call-overlay').classList.add('active');

            const ringtone = document.getElementById('ringtone');
            ringtone.play().catch(e => console.warn("Не удалось воспроизвести рингтон:", e));
        });

        async function acceptCall() {
            const ringtone = document.getElementById('ringtone');
            ringtone.pause();
            ringtone.currentTime = 0;
            document.getElementById('incoming-call-overlay').classList.remove('active');
            
            // Настройка UI перед показом
            document.getElementById('toggle-video-btn').style.display = isCurrentCallVideo ? 'flex' : 'none';
            document.getElementById('toggle-video-btn').style.background = 'rgba(255,255,255,0.2)';
            document.getElementById('toggle-audio-btn').style.background = 'rgba(255,255,255,0.2)';

            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: isCurrentCallVideo, audio: true });
                if (isCurrentCallVideo) {
                    document.getElementById('local-video').style.display = 'block';
                    document.getElementById('local-video').srcObject = localStream;
                } else {
                    document.getElementById('local-video').srcObject = null;
                }
                document.getElementById('video-call-overlay').style.display = 'flex';
                
                socket.emit('accept_call', { to: callPeerUsername, isVideo: isCurrentCallVideo });
                setupPeerConnection();
            } catch (err) {
                alert('Ошибка доступа к камере/микрофону');
                rejectCall();
            }
        }

        function rejectCall() {
            const ringtone = document.getElementById('ringtone');
            ringtone.pause();
            ringtone.currentTime = 0;
            document.getElementById('incoming-call-overlay').classList.remove('active');
            if (callPeerUsername) socket.emit('reject_call', { to: callPeerUsername });
            callPeerUsername = null;
        }

        socket.on('call_accepted', async () => {
            setupPeerConnection();
            try {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('webrtc_offer', { to: callPeerUsername, offer });
            } catch (err) {
                console.error("Ошибка создания offer:", err);
                cleanupCall();
            }
        });

        socket.on('call_rejected', () => { 
            alert('Абонент отклонил вызов'); 
            cleanupCall(); 
        });
        socket.on('call_ended', () => {
            if (document.getElementById('incoming-call-overlay').classList.contains('active')) {
                rejectCall(); // Если звонок еще не принят, просто сбрасываем
            } else {
                cleanupCall(); // Если звонок уже идет
            }
        });

        function setupPeerConnection() {
            peerConnection = new RTCPeerConnection(rtcConfig);
            remoteStream = new MediaStream();
            document.getElementById('remote-video').srcObject = remoteStream;

            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

            peerConnection.ontrack = (event) => { event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track)); };
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) socket.emit('webrtc_ice_candidate', { to: callPeerUsername, candidate: event.candidate });
            };
        }

        socket.on('webrtc_offer', async (data) => {
            if (!peerConnection) setupPeerConnection();
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit('webrtc_answer', { to: callPeerUsername, answer });
            } catch (err) {
                console.error("Ошибка обработки offer:", err);
                cleanupCall();
            }
        });

        socket.on('webrtc_answer', async (data) => { 
            if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(e => console.error("Ошибка setRemoteDescription (answer):", e)); 
        });
        socket.on('webrtc_ice_candidate', async (data) => { 
            if (peerConnection && data.candidate) await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => console.error("Ошибка addIceCandidate:", e)); 
        });

        function endCall() {
            if (callPeerUsername) socket.emit('end_call', { to: callPeerUsername });
            cleanupCall();
        }

        function cleanupCall() {
            if (peerConnection) { peerConnection.close(); peerConnection = null; }
            if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
            callPeerUsername = null;
            document.getElementById('local-video').srcObject = null;
            document.getElementById('remote-video').srcObject = null;
            document.getElementById('video-call-overlay').style.display = 'none';
        }

        function toggleVideo() {
            if (!localStream) return;
            const vt = localStream.getVideoTracks()[0];
            if (vt) { vt.enabled = !vt.enabled; document.getElementById('toggle-video-btn').style.background = vt.enabled ? 'rgba(255,255,255,0.2)' : 'rgba(231,76,60,0.8)'; }
        }

        function toggleAudio() {
            if (!localStream) return;
            const at = localStream.getAudioTracks()[0];
            if (at) { at.enabled = !at.enabled; document.getElementById('toggle-audio-btn').style.background = at.enabled ? 'rgba(255,255,255,0.2)' : 'rgba(231,76,60,0.8)'; }
        }

        // ==========================================
        // ЭМОДЗИ И СТИКЕРЫ
        // ==========================================
        function toggleEmojiPicker() { document.getElementById('emoji-picker').classList.toggle('active'); }
        function switchEmojiTab(tabId) {
            document.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.emoji-content').forEach(c => c.classList.remove('active'));
            document.querySelector(`.emoji-tab[onclick*="${tabId}"]`).classList.add('active');
            document.getElementById(`tab-${tabId}`).classList.add('active');
        }
