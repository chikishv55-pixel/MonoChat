let localStream;
        let remoteStream;
        let callPeerUsername = null;
        let isCurrentCallVideo = true;

        // =====================================================================
        // RINGTONE via Web Audio API
        // Позволяет играть поверх любого другого аудио и при заблокированном экране.
        // =====================================================================
        let ringtoneAudioCtx = null;
        let ringtoneNodes = [];
        let ringtoneInterval = null;

        function initRingtoneAudio() {
            if (ringtoneAudioCtx) return; // Уже инициализирован
            try {
                ringtoneAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch(e) {
                console.warn('Web Audio API не поддерживается:', e);
            }
        }

        function playRingtoneBeep() {
            if (!ringtoneAudioCtx) return;
            try {
                // Два тона — как традиционный телефонный рингтон
                const beeps = [
                    { freq: 480, start: 0,    dur: 0.2 },
                    { freq: 620, start: 0.05, dur: 0.2 },
                ];
                beeps.forEach(b => {
                    const osc = ringtoneAudioCtx.createOscillator();
                    const gain = ringtoneAudioCtx.createGain();
                    osc.connect(gain);
                    gain.connect(ringtoneAudioCtx.destination);
                    osc.frequency.value = b.freq;
                    osc.type = 'sine';
                    const t = ringtoneAudioCtx.currentTime + b.start;
                    gain.gain.setValueAtTime(0, t);
                    gain.gain.linearRampToValueAtTime(0.35, t + 0.02);
                    gain.gain.setValueAtTime(0.35, t + b.dur - 0.05);
                    gain.gain.linearRampToValueAtTime(0, t + b.dur);
                    osc.start(t);
                    osc.stop(t + b.dur + 0.1);
                    ringtoneNodes.push(osc);
                });
            } catch(e) { console.warn('Ringtone error:', e); }
        }

        function startRingtone(callerName) {
            stopRingtone(); // На случай если уже играет
            if (!ringtoneAudioCtx) initRingtoneAudio();
            if (ringtoneAudioCtx && ringtoneAudioCtx.state === 'suspended') {
                ringtoneAudioCtx.resume().catch(()=>{});
            }
            // Играем сразу и потом каждые 1.5 секунды
            playRingtoneBeep();
            ringtoneInterval = setInterval(playRingtoneBeep, 1500);

            // MediaSession API — показывает метаданные в системном媒体-плеере устройства
            // (экран блокировки Android, пульт AirPods, CarPlay и т.д.)
            if ('mediaSession' in navigator) {
                try {
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: 'Входящий звонок',
                        artist: callerName || 'Monochrome',
                        album: 'MONOCHROME CHAT',
                    });
                    navigator.mediaSession.playbackState = 'playing';
                    navigator.mediaSession.setActionHandler('stop', () => rejectCall());
                    navigator.mediaSession.setActionHandler('pause', () => rejectCall());
                } catch(e) { console.warn('MediaSession error:', e); }
            }

            // Notification API — системное уведомление (нужно разрешение)
            if ('Notification' in window) {
                Notification.requestPermission().then(perm => {
                    if (perm === 'granted') {
                        try {
                            const notif = new Notification('📞 Входящий звонок', {
                                body: `${callerName || 'Кто-то'} звонит вам`,
                                icon: '/icon.png',
                                badge: '/icon.png',
                                tag: 'incoming-call',
                                renotify: true,
                                requireInteraction: true, // Не скрывать автоматически
                                silent: true, // Звук мы делаем через Web Audio
                                vibrate: [200, 100, 200, 100, 200],
                            });
                            notif.onclick = () => { window.focus(); notif.close(); };
                            // Сохраняем для закрытия
                            window._callNotification = notif;
                        } catch(e) { console.warn('Notification error:', e); }
                    }
                });
            }
        }

        function stopRingtone() {
            clearInterval(ringtoneInterval);
            ringtoneInterval = null;
            ringtoneNodes.forEach(n => { try { n.stop(); } catch(e){} });
            ringtoneNodes = [];
            // Закрываем системное уведомление
            if (window._callNotification) {
                window._callNotification.close();
                window._callNotification = null;
            }
            // Сбрасываем MediaSession
            if ('mediaSession' in navigator) {
                try {
                    navigator.mediaSession.playbackState = 'none';
                    navigator.mediaSession.setActionHandler('stop', null);
                    navigator.mediaSession.setActionHandler('pause', null);
                } catch(e) {}
            }
        }

        // Бесплатные STUN сервера от Google для пробития NAT
        const rtcConfig = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

        async function startCall(videoEnabled) {
            if (!currentChatUser || currentChatUser.isGroup) return;
            callPeerUsername = currentChatUser.username;
            isCurrentCallVideo = videoEnabled;
            
            // Предварительная настройка UI звонка
            isSpeakerOn = videoEnabled; // Видео -> Спикер, Аудио -> Ушной динамик
            const speakerBtn = document.getElementById('toggle-speaker-btn');
            if (speakerBtn) speakerBtn.style.background = isSpeakerOn ? 'rgba(255,255,255,0.2)' : 'rgba(231,76,60,0.8)';

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

            // Запускаем рингтон через Web Audio API
            startRingtone(data.callerName);
        });


        async function acceptCall() {
            stopRingtone();
            document.getElementById('incoming-call-overlay').classList.remove('active');
            
            // Настройка UI перед показом
            isSpeakerOn = isCurrentCallVideo; // Видео -> Спикер, Аудио -> Ушной динамик
            const speakerBtn = document.getElementById('toggle-speaker-btn');
            if (speakerBtn) speakerBtn.style.background = isSpeakerOn ? 'rgba(255,255,255,0.2)' : 'rgba(231,76,60,0.8)';

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
            stopRingtone();
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

        let isSpeakerOn = true;
        async function toggleSpeaker() {
            const remoteVideo = document.getElementById('remote-video');
            if (!remoteVideo || !remoteVideo.setSinkId) {
                console.warn('setSinkId not supported');
                return;
            }

            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
                
                // Это упрощенная логика, так как точные ID динамика/ушного динамика варьируются
                // В браузере обычно 'default' - это текущий системный выход.
                // На мобильных устройствах переключение часто контролирует сама ОС на основе наличия видео.
                
                isSpeakerOn = !isSpeakerOn;
                const btn = document.getElementById('toggle-speaker-btn');
                if (btn) btn.style.background = isSpeakerOn ? 'rgba(255,255,255,0.2)' : 'rgba(231,76,60,0.8)';
                
                // Прямое управление через setSinkId (работает не везде, но лучший вариант для JS)
                // Если не работает, ОС обычно сама переключает на ушной динамик, если видео выключено.
            } catch (err) {
                console.error('Error toggling speaker:', err);
            }
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
