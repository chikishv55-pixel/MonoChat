// =====================================================================
// MONOCHROME REBORN — WebRTC v2.0
// Исправлено: state machine, обработка ошибок ICE, более надёжный сигнал.
// =====================================================================

// --- Состояние звонка ---
const CallState = {
    IDLE:        'idle',
    DIALING:     'dialing',
    RINGING:     'ringing',
    CONNECTING:  'connecting',
    ACTIVE:      'active',
};

let callState        = CallState.IDLE;
let localStream      = null;
let remoteStream     = null;
let peerConnection   = null;
let callPeerUsername = null;
let isCurrentCallVideo = false;
let isSpeakerOn      = true;
let pendingIceCandidates = [];

// =====================================================================
// РИНГТОН через Web Audio API
// =====================================================================

let ringtoneAudioCtx = null;
let ringtoneNodes    = [];
let ringtoneInterval = null;

function initRingtoneAudio() {
    if (ringtoneAudioCtx) return;
    try {
        ringtoneAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {
        console.warn('[WebRTC] Web Audio API не поддерживается:', e);
    }
}

function playRingtoneBeep() {
    if (!ringtoneAudioCtx) return;
    try {
        const beeps = [
            { freq: 480, start: 0,    dur: 0.2 },
            { freq: 620, start: 0.06, dur: 0.2 },
        ];
        beeps.forEach(b => {
            const osc  = ringtoneAudioCtx.createOscillator();
            const gain = ringtoneAudioCtx.createGain();
            osc.connect(gain);
            gain.connect(ringtoneAudioCtx.destination);
            osc.frequency.value = b.freq;
            osc.type = 'sine';
            const t = ringtoneAudioCtx.currentTime + b.start;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.3, t + 0.025);
            gain.gain.setValueAtTime(0.3, t + b.dur - 0.04);
            gain.gain.linearRampToValueAtTime(0, t + b.dur);
            osc.start(t);
            osc.stop(t + b.dur + 0.1);
            ringtoneNodes.push(osc);
        });
    } catch(e) { console.warn('[WebRTC] Ringtone error:', e); }
}

function startRingtone(callerName) {
    stopRingtone();
    if (!ringtoneAudioCtx) initRingtoneAudio();
    if (ringtoneAudioCtx?.state === 'suspended') {
        ringtoneAudioCtx.resume().catch(() => {});
    }
    playRingtoneBeep();
    ringtoneInterval = setInterval(playRingtoneBeep, 1600);

    // MediaSession API
    if ('mediaSession' in navigator && window.MediaMetadata) {
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: 'Входящий звонок',
                artist: callerName || 'Monochrome',
                album: 'MONOCHROME',
            });
            navigator.mediaSession.playbackState = 'playing';
            navigator.mediaSession.setActionHandler('stop',  () => rejectCall());
            navigator.mediaSession.setActionHandler('pause', () => rejectCall());
        } catch(e) { console.warn('[WebRTC] MediaSession error:', e); }
    }

    // Push-уведомление
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            const notif = new Notification('📞 Входящий звонок', {
                body: `${callerName || 'Кто-то'} звонит вам`,
                icon: '/icon.png',
                tag: 'incoming-call',
                renotify: true,
                requireInteraction: true,
                silent: true,
            });
            notif.onclick = () => { window.focus(); notif.close(); };
            window._callNotification = notif;
        } catch(e) {}
    } else if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
}

function stopRingtone() {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
    ringtoneNodes.forEach(n => { try { n.stop(); } catch(e) {} });
    ringtoneNodes = [];
    if (window._callNotification) {
        window._callNotification.close();
        window._callNotification = null;
    }
    if ('mediaSession' in navigator) {
        try {
            navigator.mediaSession.playbackState = 'none';
            navigator.mediaSession.setActionHandler('stop',  null);
            navigator.mediaSession.setActionHandler('pause', null);
        } catch(e) {}
    }
}

// =====================================================================
// WebRTC — конфигурация (STUN + запасной TURN)
// =====================================================================

const rtcConfig = {
    iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        // Публичный TURN от Metered (лимитированный, но работает в большинстве сетей)
        {
            urls: 'turn:a.relay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject',
        },
    ],
    iceCandidatePoolSize: 10,
};

// =====================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ UI ЗВОНКА
// =====================================================================

function _resetCallUI() {
    const btn = document.getElementById('toggle-speaker-btn');
    if (btn) btn.style.background = isSpeakerOn ? 'rgba(255,255,255,0.15)' : 'rgba(239,68,68,0.8)';

    const videoBtn = document.getElementById('toggle-video-btn');
    if (videoBtn) {
        videoBtn.style.display = isCurrentCallVideo ? 'flex' : 'none';
        videoBtn.style.background = 'rgba(255,255,255,0.15)';
    }
    const audioBtn = document.getElementById('toggle-audio-btn');
    if (audioBtn) audioBtn.style.background = 'rgba(255,255,255,0.15)';
}

function _showCallScreen(show) {
    const overlay = document.getElementById('video-call-overlay');
    if (overlay) overlay.style.display = show ? 'flex' : 'none';
}

// =====================================================================
// ИСХОДЯЩИЙ ЗВОНОК
// =====================================================================

async function startCall(videoEnabled) {
    if (!currentChatUser || currentChatUser.isGroup) return;
    if (callState !== CallState.IDLE) {
        showAlert('Вы уже в звонке.');
        return;
    }

    callPeerUsername   = currentChatUser.username;
    isCurrentCallVideo = videoEnabled;
    isSpeakerOn        = videoEnabled;
    callState          = CallState.DIALING;

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showAlert('Ваш браузер или соединение не поддерживает звонки (требуется HTTPS).', 'Ошибка', '⚠️');
            callState = CallState.IDLE;
            return;
        }
        localStream = await navigator.mediaDevices.getUserMedia({
            video: videoEnabled,
            audio: true,
        });

        const localVideo = document.getElementById('local-video');
        if (localVideo) {
            localVideo.srcObject = videoEnabled ? localStream : null;
            localVideo.style.display = videoEnabled ? 'block' : 'none';
        }

        _resetCallUI();
        _showCallScreen(true);

        socket.emit('start_call', { to: callPeerUsername, isVideo: videoEnabled });

    } catch (err) {
        console.error('[WebRTC] startCall error:', err);
        showAlert('Не удалось получить доступ к камере или микрофону. Проверьте разрешения.');
        callState = CallState.IDLE;
        callPeerUsername = null;
    }
}

// =====================================================================
// ВХОДЯЩИЙ ЗВОНОК
// =====================================================================

socket.on('incoming_call', (data) => {
    // Если уже в звонке — отклоняем автоматически
    if (callState !== CallState.IDLE) {
        socket.emit('reject_call', { to: data.from });
        return;
    }

    closeAllModals();
    callPeerUsername   = data.from;
    isCurrentCallVideo = data.isVideo;
    callState          = CallState.RINGING;

    setAvatarUI('ic-avatar-img', 'ic-avatar-text', getFullUrl(data.callerAvatar), data.callerName);
    document.getElementById('ic-caller-name').textContent = data.callerName;
    document.getElementById('ic-call-type').textContent
        = data.isVideo ? 'Входящий видеозвонок' : 'Входящий аудиозвонок';

    document.getElementById('incoming-call-overlay').classList.add('active');
    startRingtone(data.callerName);
});

// =====================================================================
// ПРИНЯТЬ / ОТКЛОНИТЬ ЗВОНОК
// =====================================================================

async function acceptCall() {
    if (callState !== CallState.RINGING) return;

    stopRingtone();
    document.getElementById('incoming-call-overlay').classList.remove('active');
    isSpeakerOn = isCurrentCallVideo;
    callState   = CallState.CONNECTING;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: isCurrentCallVideo,
            audio: true,
        });

        const localVideo = document.getElementById('local-video');
        if (localVideo) {
            localVideo.srcObject = isCurrentCallVideo ? localStream : null;
            localVideo.style.display = isCurrentCallVideo ? 'block' : 'none';
        }

        _resetCallUI();
        _showCallScreen(true);

        socket.emit('accept_call', { to: callPeerUsername, isVideo: isCurrentCallVideo });
        setupPeerConnection();

    } catch (err) {
        console.error('[WebRTC] acceptCall error:', err);
        showAlert('Ошибка доступа к камере / микрофону');
        rejectCall();
    }
}

function rejectCall() {
    stopRingtone();
    document.getElementById('incoming-call-overlay').classList.remove('active');
    if (callPeerUsername && callState !== CallState.IDLE) {
        socket.emit('reject_call', { to: callPeerUsername });
    }
    _resetState();
}

// =====================================================================
// СИГНАЛИНГ
// =====================================================================

socket.on('call_accepted', async () => {
    if (callState !== CallState.DIALING) return;
    callState = CallState.CONNECTING;
    setupPeerConnection();

    try {
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: isCurrentCallVideo,
        });
        await peerConnection.setLocalDescription(offer);
        socket.emit('webrtc_offer', { to: callPeerUsername, offer });
    } catch (err) {
        console.error('[WebRTC] createOffer error:', err);
        _handleCallError('Ошибка создания подключения');
    }
});

socket.on('call_rejected', () => {
    showAlert('Абонент отклонил вызов');
    cleanupCall();
});

socket.on('call_ended', () => {
    if (callState === CallState.RINGING) {
        rejectCall();
    } else {
        cleanupCall();
    }
});

socket.on('webrtc_offer', async (data) => {
    if (!peerConnection) setupPeerConnection();

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        // Добавляем буферизованные кандидаты
        while (pendingIceCandidates.length) {
            const c = pendingIceCandidates.shift();
            await peerConnection.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.warn('[WebRTC] pending ICE error:', e));
        }
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('webrtc_answer', { to: callPeerUsername, answer });
    } catch (err) {
        console.error('[WebRTC] webrtc_offer error:', err);
        _handleCallError('Ошибка WebRTC соединения');
    }
});

socket.on('webrtc_answer', async (data) => {
    if (!peerConnection) return;
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        callState = CallState.ACTIVE;
    } catch (e) {
        console.error('[WebRTC] setRemoteDescription (answer) error:', e);
    }
});

socket.on('webrtc_ice_candidate', async (data) => {
    if (!data.candidate) return;

    if (peerConnection && peerConnection.remoteDescription) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch(e) {
            console.warn('[WebRTC] addIceCandidate error:', e);
        }
    } else {
        // Буферизуем кандидата, если remoteDescription ещё не установлен
        pendingIceCandidates.push(data.candidate);
    }
});

// =====================================================================
// PEER CONNECTION
// =====================================================================

function setupPeerConnection() {
    // Закрываем старое соединение если есть
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    pendingIceCandidates = [];
    peerConnection = new RTCPeerConnection(rtcConfig);
    remoteStream   = new MediaStream();

    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) remoteVideo.srcObject = remoteStream;

    // Добавляем локальные треки
    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    // Получаем удалённые треки
    peerConnection.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach(track => remoteStream.addTrack(track));
    };

    // ICE кандидаты
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && callPeerUsername) {
            socket.emit('webrtc_ice_candidate', { to: callPeerUsername, candidate: event.candidate });
        }
    };

    // Мониторинг состояния ICE соединения
    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection?.iceConnectionState;
        console.log('[WebRTC] ICE state:', state);

        if (state === 'connected' || state === 'completed') {
            callState = CallState.ACTIVE;
        } else if (state === 'failed') {
            console.error('[WebRTC] ICE connection failed — trying to restart ICE');
            // Попытка перезапуска ICE (работает в Chrome/Firefox)
            if (peerConnection && peerConnection.restartIce) {
                peerConnection.restartIce();
            } else {
                _handleCallError('Соединение потеряно. Проверьте интернет-подключение.');
            }
        } else if (state === 'disconnected') {
            // Даём 5 секунд на восстановление
            console.warn('[WebRTC] ICE disconnected — waiting for recovery...');
            setTimeout(() => {
                if (peerConnection?.iceConnectionState === 'disconnected') {
                    _handleCallError('Соединение разорвано.');
                }
            }, 5000);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection?.connectionState;
        console.log('[WebRTC] Connection state:', state);
        if (state === 'failed') {
            _handleCallError('WebRTC соединение не установлено.');
        }
    };
}

// =====================================================================
// ЗАВЕРШЕНИЕ ЗВОНКА
// =====================================================================

function endCall() {
    if (callPeerUsername) socket.emit('end_call', { to: callPeerUsername });
    cleanupCall();
}

function cleanupCall() {
    stopRingtone();
    document.getElementById('incoming-call-overlay').classList.remove('active');
    _showCallScreen(false);
    _resetState();
}

function _resetState() {
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream)    { localStream.getTracks().forEach(t => t.stop()); localStream = null; }

    const localVideo  = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    if (localVideo)  localVideo.srcObject  = null;
    if (remoteVideo) remoteVideo.srcObject = null;

    callPeerUsername     = null;
    isCurrentCallVideo   = false;
    remoteStream         = null;
    pendingIceCandidates = [];
    callState            = CallState.IDLE;
}

function _handleCallError(message) {
    showAlert(message || 'Ошибка звонка');
    cleanupCall();
}

// =====================================================================
// УПРАВЛЕНИЕ МЕДИА ВО ВРЕМЯ ЗВОНКА
// =====================================================================

function toggleVideo() {
    if (!localStream) return;
    const vt = localStream.getVideoTracks()[0];
    if (!vt) return;
    vt.enabled = !vt.enabled;
    const btn = document.getElementById('toggle-video-btn');
    if (btn) btn.style.background = vt.enabled ? 'rgba(255,255,255,0.15)' : 'rgba(239,68,68,0.8)';
}

function toggleAudio() {
    if (!localStream) return;
    const at = localStream.getAudioTracks()[0];
    if (!at) return;
    at.enabled = !at.enabled;
    const btn = document.getElementById('toggle-audio-btn');
    if (btn) btn.style.background = at.enabled ? 'rgba(255,255,255,0.15)' : 'rgba(239,68,68,0.8)';
}

async function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    const btn = document.getElementById('toggle-speaker-btn');
    if (btn) btn.style.background = isSpeakerOn ? 'rgba(255,255,255,0.15)' : 'rgba(239,68,68,0.8)';

    // setSinkId доступен только в Chrome
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo?.setSinkId) {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const outputs  = devices.filter(d => d.kind === 'audiooutput');
            // Ищем "speakerphone" или ушной динамик
            const target = isSpeakerOn
                ? outputs.find(d => d.label.toLowerCase().includes('speaker')) || outputs[0]
                : outputs.find(d => d.label.toLowerCase().includes('earpiece') || d.label.toLowerCase().includes('receiver')) || outputs[0];
            if (target) await remoteVideo.setSinkId(target.deviceId);
        } catch(e) {
            console.warn('[WebRTC] setSinkId error:', e);
        }
    }
}

// =====================================================================
// КОНЕЦ ФАЙЛА
// =====================================================================

window.startCall = startCall;
window.acceptCall = acceptCall;
window.rejectCall = rejectCall;
window.endCall = endCall;
window.toggleVideo = toggleVideo;
window.toggleSpeaker = toggleSpeaker;
window.toggleAudio = toggleAudio;
