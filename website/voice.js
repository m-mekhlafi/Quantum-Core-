// voice.js — Z-Studio Quantum Voice Engine
// Real-time audio waveform visualization using Web Audio API + Canvas

(() => {
    'use strict';

    const canvas = document.getElementById('waveform-canvas');
    const ctx = canvas?.getContext('2d');
    const voiceOrb = document.getElementById('voice-orb');

    let audioContext = null;
    let analyser = null;
    let animFrameId = null;
    let callStream = null;
    let callRecorder = null;
    const CHUNK_MS = 4000;

    // ── WAVEFORM DRAWING ──
    function drawWaveform() {
        if (!analyser || !ctx || !canvas) return;

        const bufferLength = analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength);

        function draw() {
            animFrameId = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(dataArray);

            // Clear
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Background
            ctx.fillStyle = 'rgba(7, 10, 15, 0.1)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Waveform gradient
            const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
            gradient.addColorStop(0,   'rgba(0, 229, 255, 0.2)');
            gradient.addColorStop(0.5, 'rgba(0, 229, 255, 1.0)');
            gradient.addColorStop(1,   'rgba(0, 229, 255, 0.2)');

            ctx.lineWidth = 2;
            ctx.strokeStyle = gradient;
            ctx.beginPath();

            const sliceWidth = canvas.width / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * canvas.height) / 2;

                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
                x += sliceWidth;
            }

            ctx.lineTo(canvas.width, canvas.height / 2);
            ctx.stroke();

            // Glow effect
            ctx.shadowColor = 'rgba(0, 229, 255, 0.5)';
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Orb pulsing based on audio level
            if (voiceOrb) {
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) sum += Math.abs(dataArray[i] - 128);
                const avg = sum / bufferLength;
                const scale = 1 + (avg / 128) * 0.5;
                voiceOrb.style.transform = `scale(${scale})`;
            }
        }

        draw();
    }

    function stopWaveform() {
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
        if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (voiceOrb) voiceOrb.style.transform = 'scale(1)';
        if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; analyser = null; }
    }

    function startWaveform(stream) {
        stopWaveform();
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            drawWaveform();
        } catch (e) {
            console.error('Waveform init error:', e);
        }
    }

    // ── CALL MODE (تم التعديل لإصلاح مشكلة ffmpeg) ──
    async function startCallMode() {
        if (!window.QuantumApp) return;

        try {
            callStream = await navigator.mediaDevices.getUserMedia({
                audio: { sampleRate: 44100, channelCount: 1, echoCancellation: true, noiseSuppression: true }
            });

            startWaveform(callStream);

            callRecorder = new MediaRecorder(callStream);

            // إرسال الملف عند الإيقاف
            callRecorder.ondataavailable = async (e) => {
                if (e.data?.size > 100) {
                    await window.QuantumApp.sendAudioBlob(e.data);
                }
            };

            callRecorder.onstart = () => {
                window.QuantumApp.setCallMode(true);
                window.QuantumApp.showVoiceOverlay(true, 'Quantum Listening...');
                // إظهار الرسالة مرة واحدة فقط عند بدء المكالمة وليس مع كل مقطع
                if (!window.QuantumApp.callStartedMessageShown) {
                    window.QuantumApp.appendMessage('ai', '📞 Voice call started. Speak naturally.', false);
                    window.QuantumApp.callStartedMessageShown = true;
                }
            };

            callRecorder.onstop = () => {
                // إذا لم يتم إنهاء المكالمة يدوياً، أعد تشغيل التسجيل فوراً للمقطع التالي
                if (window.QuantumApp.isCallMode) {
                    callRecorder.start();
                } else {
                    window.QuantumApp.showVoiceOverlay(false);
                    window.QuantumApp.appendMessage('ai', '📵 Voice call ended.', false);
                    window.QuantumApp.callStartedMessageShown = false; // إعادة ضبط
                    stopWaveform();
                    if (callStream) { callStream.getTracks().forEach(t => t.stop()); callStream = null; }
                }
            };

            // بدء التسجيل الأول
            callRecorder.start();

            // إيقاف التسجيل كل 4 ثوانٍ ليتم تشغيل onstop وإرسال ملف كامل بـ Header صالح
            callRecorder.chunkInterval = setInterval(() => {
                if (callRecorder.state === 'recording' && window.QuantumApp.isCallMode) {
                    callRecorder.stop();
                }
            }, CHUNK_MS);

        } catch (err) {
            console.error('startCallMode error:', err);
            window.QuantumApp.appendMessage('ai', '⚠️ Cannot access microphone for call mode.', false);
        }
    }

    function stopCallMode() {
        window.QuantumApp.setCallMode(false); // تغيير الحالة أولاً لمنع إعادة التشغيل التلقائي
        if (callRecorder && callRecorder.chunkInterval) {
            clearInterval(callRecorder.chunkInterval);
        }
        if (callRecorder && callRecorder.state !== 'inactive') {
            callRecorder.stop();
        }
    }


})();
async function stopTTS() {
    try {
        const r = await fetch('/api/tts-stop', { method: 'POST' });
        const j = await r.json();
        console.log('tts-stop:', j);
        // اختياري: إخفاء overlay أو إعادة ضبط واجهة المستخدم
        if (window.QuantumApp) {
            window.QuantumApp.showVoiceOverlay(false);
        }
    } catch (e) {
        console.error('stop error', e);
    }
}

// ربط الزر
const stopBtn = document.getElementById('ttsStopBtn');
if (stopBtn) stopBtn.addEventListener('click', stopTTS);

// شورت كت: Space أو S
window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.code === 'Space' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        stopTTS();
    }
    // ── EXPOSE API ──
    window.QuantumVoice = { startCallMode, stopCallMode, stopTTS };
});
