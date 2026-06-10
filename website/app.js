// app.js — Z-Studio Quantum Core v2.0
// Full client-side logic: chat, markdown, code highlighting, file attach, voice, rooms.

(() => {
    'use strict';

    // ── DOM REFS ──
    const chatListEl       = document.getElementById('chat-list');
    const newChatBtn       = document.getElementById('new-chat-btn');
    const tempToggle       = document.getElementById('temp-chat-toggle');
    const tempBadge        = document.getElementById('temp-badge');
    const tempIndicator    = document.getElementById('temp-indicator');
    const messageContainer = document.getElementById('message-container');
    const welcomeState     = document.getElementById('welcome-state');
    const chatTitle        = document.getElementById('current-chat-title');
    const userInput        = document.getElementById('user-message-input');
    const sendBtn          = document.getElementById('send-btn');
    const attachBtn        = document.getElementById('attach-btn');
    const fileSelector     = document.getElementById('file-selector');
    const filePrev         = document.getElementById('file-preview');
    const filePrevName     = document.getElementById('file-preview-name');
    const fileRemoveBtn    = document.getElementById('file-remove-btn');
    const voiceBtn         = document.getElementById('voice-btn');
    const callModeBtn      = document.getElementById('call-mode-btn');
    const voiceOverlay     = document.getElementById('voice-overlay');
    const voiceStatusText  = document.getElementById('voice-status-text');
    const voiceEndBtn      = document.getElementById('voice-end-btn');
    const clearChatBtn     = document.getElementById('clear-chat-btn');
    const inputGroup       = document.getElementById('input-group');
    const sidebarToggle    = document.getElementById('sidebar-toggle');
    const sidebar          = document.querySelector('.sidebar');
    const loadingScreen    = document.getElementById('loading-screen');
    const appContainer     = document.getElementById('app-container');
    const loaderBar        = document.getElementById('loader-bar');
    const stopVoiceBtn = document.getElementById('stop-voice-btn');

    // ── STATE ──
    let rooms        = [];
    let activeRoom   = 'cybersecurity';
    let isRecording  = false;
    let isCallMode   = false;
    let pendingFile  = null;
    let conversationHistory = []; // For context memory

    // ── CONFIGURE MARKED.JS ──
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,
            gfm: true,
            highlight: (code, lang) => {
                if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                    return hljs.highlight(code, { language: lang }).value;
                }
                return typeof hljs !== 'undefined' ? hljs.highlightAuto(code).value : code;
            }
        });
    }

    // ── LOADING SCREEN ──
    function simulateLoading() {
        return new Promise(resolve => {
            let progress = 0;
            const steps = [
                { val: 20, delay: 100 }, { val: 45, delay: 250 },
                { val: 70, delay: 400 }, { val: 88, delay: 550 },
                { val: 100, delay: 750 }
            ];
            steps.forEach(s => {
                setTimeout(() => {
                    if (loaderBar) loaderBar.style.width = s.val + '%';
                    if (s.val === 100) setTimeout(resolve, 200);
                }, s.delay);
            });
        });
    }

    async function initApp() {
        await simulateLoading();
        if (loadingScreen) loadingScreen.classList.add('fade-out');
        if (appContainer) { appContainer.style.display = 'flex'; }
        await fetchRooms();
    }

    // ── HELPERS ──
    function safeText(t) { return String(t || '').trim(); }

    function now() {
        return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    function escapeHtml(str) {
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    }

    function showVoiceOverlay(show, statusText = 'Quantum Listening...') {
        if (!voiceOverlay) return;
        if (show) {
            voiceOverlay.classList.remove('voice-overlay-hidden');
            if (voiceStatusText) voiceStatusText.textContent = statusText;
        } else {
            voiceOverlay.classList.add('voice-overlay-hidden');
        }
    }

    function hideWelcome() {
        if (welcomeState && welcomeState.parentNode) {
            welcomeState.style.opacity = '0';
            welcomeState.style.transition = 'opacity 0.3s ease';
            setTimeout(() => welcomeState.remove(), 300);
        }
    }

    // ── MARKDOWN RENDERER ──
    function renderMarkdown(rawText) {
        if (typeof marked === 'undefined') {
            return `<pre style="white-space:pre-wrap">${escapeHtml(rawText)}</pre>`;
        }
        // Parse the markdown
        let html = marked.parse(rawText);

        // Wrap code blocks with custom header + copy button
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        tempDiv.querySelectorAll('pre').forEach(preEl => {
            const codeEl = preEl.querySelector('code');
            if (!codeEl) return;

            // Detect language from class
            let lang = 'code';
            const match = codeEl.className.match(/language-(\w+)/);
            if (match) lang = match[1];

            // Apply highlight.js if not already applied
            if (typeof hljs !== 'undefined' && !codeEl.dataset.highlighted) {
                hljs.highlightElement(codeEl);
            }

            // Build wrapper
            const wrapper = document.createElement('div');
            wrapper.className = 'code-block-wrapper';

            const header = document.createElement('div');
            header.className = 'code-block-header';
            header.innerHTML = `
                <span class="code-lang-label">${escapeHtml(lang)}</span>
                <button class="copy-code-btn" data-code="">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                    </svg>
                    Copy
                </button>
            `;

            // Store raw code in button dataset
            header.querySelector('.copy-code-btn').dataset.code = codeEl.textContent;

            preEl.parentNode.insertBefore(wrapper, preEl);
            wrapper.appendChild(header);
            wrapper.appendChild(preEl);
        });

        return tempDiv.innerHTML;
    }

    // ── COPY CODE HANDLER (event delegation) ──
    messageContainer.addEventListener('click', e => {
        const btn = e.target.closest('.copy-code-btn');
        if (!btn) return;
        const code = btn.dataset.code || '';
        navigator.clipboard.writeText(code).then(() => {
            btn.classList.add('copied');
            btn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                Copied!
            `;
            setTimeout(() => {
                btn.classList.remove('copied');
                btn.innerHTML = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                    </svg>
                    Copy
                `;
                btn.dataset.code = code;
            }, 2000);
        }).catch(() => {
            // Fallback for older browsers
            const ta = document.createElement('textarea');
            ta.value = code;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    });

    // ── APPEND MESSAGE ──
    function appendMessage(sender, text, renderMd = true) {
        hideWelcome();

        const isUser = sender === 'user';
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isUser ? 'user-wrapper' : 'ai-wrapper'}`;

        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.textContent = isUser ? '👤' : '⚡';

        const inner = document.createElement('div');
        inner.style.display = 'flex';
        inner.style.flexDirection = 'column';
        inner.style.gap = '4px';
        inner.style.maxWidth = '680px';

        const meta = document.createElement('div');
        meta.className = 'message-meta';
        const senderSpan = document.createElement('span');
        senderSpan.className = 'message-sender';
        senderSpan.textContent = isUser ? 'You' : 'Quantum';
        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.textContent = now();
        meta.appendChild(senderSpan);
        meta.appendChild(timeSpan);

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';

        if (!isUser && renderMd) {
            bubble.innerHTML = renderMarkdown(text);
        } else {
            bubble.textContent = text;
        }

        inner.appendChild(meta);
        inner.appendChild(bubble);

        if (isUser) {
            wrapper.appendChild(inner);
            wrapper.appendChild(avatarEl);
        } else {
            wrapper.appendChild(avatarEl);
            wrapper.appendChild(inner);
        }

        messageContainer.appendChild(wrapper);
        messageContainer.scrollTo({ top: messageContainer.scrollHeight, behavior: 'smooth' });

        return wrapper;
    }

    // ── THINKING INDICATOR ──
    function showThinking() {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper ai-wrapper';
        wrapper.id = 'thinking-indicator';

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = '⚡';

        const bubble = document.createElement('div');
        bubble.className = 'thinking-bubble';
        bubble.innerHTML = `
            <span style="color:var(--text-secondary);font-size:12px;">Quantum is thinking</span>
            <div class="thinking-dots">
                <span></span><span></span><span></span>
            </div>
        `;

        wrapper.appendChild(avatar);
        wrapper.appendChild(bubble);
        messageContainer.appendChild(wrapper);
        messageContainer.scrollTo({ top: messageContainer.scrollHeight, behavior: 'smooth' });
        return wrapper;
    }

    function removeThinking() {
        const el = document.getElementById('thinking-indicator');
        if (el) el.remove();
    }

    // ── ROOMS ──
    async function fetchRooms() {
        try {
            const res = await fetch('/api/rooms');
            if (!res.ok) throw new Error('Failed to fetch rooms');
            rooms = await res.json();
            renderRooms();
        } catch (err) { console.error('fetchRooms:', err); }
    }

    function renderRooms() {
        chatListEl.innerHTML = '';
        rooms.forEach(r => {
            const li = document.createElement('li');
            li.dataset.roomId = r.id;
            li.className = 'room-item';
            li.innerHTML = `
                <div style="display:flex;align-items:center;gap:10px;overflow:hidden;flex:1;">
                    <span style="font-family:var(--font-mono);color:var(--accent-primary);font-size:14px;flex-shrink:0;">#</span>
                    <div style="overflow:hidden;">
                        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                            ${escapeHtml(r.title || r.id)}
                        </div>
                        <div style="font-size:11px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                            ${escapeHtml(r.id)}
                        </div>
                    </div>
                </div>
                <button class="room-menu-trigger" title="Options">⋮</button>
            `;

            // Click on room (not on menu btn)
            li.addEventListener('click', e => {
                if (!e.target.closest('.room-menu-trigger') && !e.target.closest('.room-context-menu')) {
                    setActiveRoom(r.id, r.title);
                }
            });

            // Context menu trigger
            const menuBtn = li.querySelector('.room-menu-trigger');
            menuBtn.addEventListener('click', e => {
                e.stopPropagation();
                closeAllContextMenus();
                showContextMenu(li, r);
            });

            chatListEl.appendChild(li);
        });

        // Restore active room
        const found = rooms.find(r => r.id === activeRoom);
        if (!found && rooms.length) setActiveRoom(rooms[0].id, rooms[0].title);
        else if (found) {
            Array.from(chatListEl.children).forEach(li => {
                li.classList.toggle('active', li.dataset.roomId === activeRoom);
            });
        }
    }

    function showContextMenu(li, room) {
        const existing = li.querySelector('.room-context-menu');
        if (existing) { existing.remove(); return; }

        const menu = document.createElement('div');
        menu.className = 'room-context-menu';
        menu.style.display = 'flex';
        menu.innerHTML = `
            <button class="menu-action-rename">✏️ Rename</button>
            <button class="menu-action-delete">🗑 Delete</button>
        `;

        menu.querySelector('.menu-action-rename').addEventListener('click', async e => {
            e.stopPropagation();
            menu.remove();
            const newTitle = prompt('New room name:', room.title || room.id);
            if (newTitle && newTitle.trim()) {
                await renameRoom(room.id, newTitle.trim());
            }
        });

        menu.querySelector('.menu-action-delete').addEventListener('click', async e => {
            e.stopPropagation();
            menu.remove();
            if (confirm(`Delete room "${room.title || room.id}"? All messages will be lost.`)) {
                await deleteRoom(room.id);
            }
        });

        li.appendChild(menu);
        setTimeout(() => document.addEventListener('click', closeAllContextMenus, { once: true }), 10);
    }

    function closeAllContextMenus() {
        document.querySelectorAll('.room-context-menu').forEach(m => m.remove());
    }

    async function renameRoom(id, title) {
        try {
            await fetch('/api/rooms', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, title })
            });
            await fetchRooms();
        } catch(e) { console.error('renameRoom:', e); }
    }

    async function deleteRoom(id) {
        try {
            await fetch(`/api/rooms/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (activeRoom === id) {
                activeRoom = 'cybersecurity';
                messageContainer.innerHTML = '';
                messageContainer.appendChild(welcomeState);
                welcomeState.style.display = '';
                welcomeState.style.opacity = '1';
            }
            await fetchRooms();
        } catch(e) { console.error('deleteRoom:', e); }
    }

    async function setActiveRoom(roomId, title) {
        activeRoom = roomId;
        chatTitle.textContent = title || roomId;
        conversationHistory = [];
        Array.from(chatListEl.children).forEach(li => {
            li.classList.toggle('active', li.dataset.roomId === roomId);
        });
        await fetchMessages(roomId);
    }

    async function fetchMessages(roomId) {
        try {
            const res = await fetch(`/api/messages/${encodeURIComponent(roomId)}`);
            if (!res.ok) throw new Error('Failed');
            const messages = await res.json();
            messageContainer.innerHTML = '';
            if (!messages.length) {
                const ws = welcomeState.cloneNode(true);
                ws.id = 'welcome-state';
                messageContainer.appendChild(ws);
                ws.querySelectorAll('.suggestion-chip').forEach(chip => {
                    chip.addEventListener('click', () => useSuggestionDirect(chip.textContent));
                });
            } else {
                messages.forEach(m => {
                    appendMessage(m.sender, m.text, m.sender === 'ai');
                    conversationHistory.push({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text });
                });
            }
        } catch (err) { console.error('fetchMessages:', err); }
    }

    // ── SEND TEXT MESSAGE ──
    async function sendTextMessage(text, isTemp = false) {
        if (!text) return;
        if (stopVoiceBtn) stopVoiceBtn.classList.add('active-stop');

        appendMessage('user', text, false);
        userInput.value = '';
        autoResizeTextarea();
        sendBtn.disabled = true;

        // Build context window (last 10 exchanges = 20 messages)
        conversationHistory.push({ role: 'user', content: text });
        const contextWindow = conversationHistory.slice(-20);

        const thinking = showThinking();

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    room_id: activeRoom,
                    message: text,
                    is_temp: isTemp,
                    history: contextWindow
                })
            });
            if (!res.ok) throw new Error('API error: ' + res.status);
            const data = await res.json();
            removeThinking();
            const aiText = data.response || '[No response from Quantum Core]';
            appendMessage('ai', aiText, true);
            conversationHistory.push({ role: 'assistant', content: aiText });
        } catch (err) {
            removeThinking();
            appendMessage('ai', `⚠️ Error reaching Quantum Core: ${err.message}`, false);
            conversationHistory.pop(); // Remove the failed user message from history
        } finally {
            sendBtn.disabled = false;
            userInput.focus();
        }
    }

    // ── SEND AUDIO ──
    async function sendAudioBlob(blob) {
        const mime = blob.type || 'audio/webm';
        let ext = 'webm';
        if (stopVoiceBtn) stopVoiceBtn.classList.add('active-stop');
        if (mime.includes('wav')) ext = 'wav';
        else if (mime.includes('ogg')) ext = 'ogg';
        else if (mime.includes('mp3') || mime.includes('mpeg')) ext = 'mp3';

        const form = new FormData();
        form.append('audio', blob, `rec.${ext}`);
        form.append('room_id', activeRoom);

        showVoiceOverlay(true, 'Processing voice...');

        try {
            const res = await fetch('/api/voice-call', { method: 'POST', body: form });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.user_text) appendMessage('user', `🎙 ${data.user_text}`, false);
            if (data.ai_response) appendMessage('ai', data.ai_response, true);
            return data;
        } catch (err) {
            appendMessage('ai', `⚠️ Voice error: ${err.message}`, false);
            return null;
        } finally {
            showVoiceOverlay(false);
        }
    }

    // ── AUTO RESIZE TEXTAREA ──
    function autoResizeTextarea() {
        userInput.style.height = 'auto';
        userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
    }

    userInput.addEventListener('input', autoResizeTextarea);

    userInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

    sendBtn.addEventListener('click', () => {
        const text = safeText(userInput.value);
        if (!text && !pendingFile) return;
        const isTemp = tempToggle?.checked;

        if (pendingFile) {
            sendTextMessage(`📎 (File: ${pendingFile.name})\n\n${pendingFile.content}`, isTemp);
            pendingFile = null;
            filePrev.style.display = 'none';
        } else {
            sendTextMessage(text, isTemp);
        }
    });

    // ── FILE ATTACH ──
    attachBtn.addEventListener('click', () => fileSelector.click());

    fileSelector.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const content = await file.text();
            pendingFile = { name: file.name, content };
            filePrevName.textContent = file.name;
            filePrev.style.display = 'flex';
        } catch (err) {
            appendMessage('ai', '⚠️ Could not read file.', false);
        }
        fileSelector.value = '';
    });

    fileRemoveBtn.addEventListener('click', () => {
        pendingFile = null;
        filePrev.style.display = 'none';
    });

    // ── INCOGNITO MODE ──
    tempToggle.addEventListener('change', () => {
        const active = tempToggle.checked;
        tempBadge.style.display = active ? 'block' : 'none';
        tempIndicator.style.display = active ? 'flex' : 'none';
        inputGroup.classList.toggle('temp-active', active);
    });

    // ── CLEAR CHAT ──
    clearChatBtn.addEventListener('click', () => {
        if (!confirm('Clear all visible messages?')) return;
        messageContainer.innerHTML = '';
        conversationHistory = [];
        // Re-add welcome state
        const ws = document.createElement('div');
        ws.className = 'welcome-state';
        ws.id = 'welcome-state';
        ws.innerHTML = `
            <div class="welcome-icon">⚡</div>
            <h2 class="welcome-title">Z-Studio Quantum Core</h2>
            <p class="welcome-sub">Your fully local, offline AI interface. Ask anything.</p>
            <div class="welcome-suggestions">
                <button class="suggestion-chip">Explain how neural networks work</button>
                <button class="suggestion-chip">Write a Python web scraper</button>
                <button class="suggestion-chip">Analyze common cybersecurity threats</button>
                <button class="suggestion-chip">Help me debug my code</button>
            </div>
        `;
        ws.querySelectorAll('.suggestion-chip').forEach(c => {
            c.addEventListener('click', () => useSuggestionDirect(c.textContent));
        });
        messageContainer.appendChild(ws);
    });

    // ── SUGGESTION CHIPS ──
    window.useSuggestion = (el) => useSuggestionDirect(el.textContent);

    function useSuggestionDirect(text) {
        userInput.value = text;
        autoResizeTextarea();
        sendBtn.click();
    }

    // ── NEW ROOM ──
    newChatBtn.addEventListener('click', async () => {
        const id = prompt('New room ID (letters, numbers, hyphens):');
        if (!id || !id.trim()) return;
        const cleanId = id.trim().toLowerCase().replace(/\s+/g, '-');
        const title = prompt('Room title:', cleanId) || cleanId;
        try {
            const res = await fetch('/api/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: cleanId, title })
            });
            if (!res.ok) throw new Error('Failed');
            await fetchRooms();
            setActiveRoom(cleanId, title);
        } catch (err) { alert('Could not create room: ' + err.message); }
    });

    // ── SIDEBAR TOGGLE ──
    sidebarToggle.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('mobile-open');
        } else {
            sidebar.classList.toggle('collapsed');
        }
    });

    // Close mobile sidebar when clicking outside
    document.addEventListener('click', e => {
        if (window.innerWidth <= 768 &&
            sidebar.classList.contains('mobile-open') &&
            !sidebar.contains(e.target)) {
            sidebar.classList.remove('mobile-open');
        }
    });

    // ── VOICE NOTE (single-shot) ──
    voiceBtn.addEventListener('click', async () => {
        if (!isRecording) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const recorder = new MediaRecorder(stream);
                const chunks = [];
                recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
                recorder.onstart = () => {
                    isRecording = true;
                    voiceBtn.classList.add('recording-active');
                    voiceBtn.title = 'Click to stop recording';
                };
                recorder.onstop = async () => {
                    isRecording = false;
                    voiceBtn.classList.remove('recording-active');
                    voiceBtn.title = 'Voice Note';
                    stream.getTracks().forEach(t => t.stop());
                    await sendAudioBlob(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
                };
                recorder.start();
                voiceBtn._recorder = recorder;
            } catch (err) {
                appendMessage('ai', '⚠️ Microphone access denied.', false);
            }
        } else {
            voiceBtn._recorder?.stop();
        }
    });

    // ── VOICE CALL MODE ──
    callModeBtn.addEventListener('click', () => {
        if (!isCallMode) {
            window.QuantumVoice?.startCallMode();
        } else {
            window.QuantumVoice?.stopCallMode();
        }
    });

    // Voice overlay end button
    voiceEndBtn?.addEventListener('click', () => {
        if (isCallMode) {
            window.QuantumVoice?.stopCallMode();
        } else {
            showVoiceOverlay(false);
        }
    });

    // ── EXPOSE STATE FOR VOICE.JS ──
    window.QuantumApp = {
        get activeRoom() { return activeRoom; },
        get isCallMode() { return isCallMode; },
        setCallMode: (v) => {
            isCallMode = v;
            callModeBtn.classList.toggle('call-active', v);
        },
        showVoiceOverlay,
        appendMessage,
        sendAudioBlob
    };
    // ── STOP VOICE LOGIC (Pro Version) ──
    async function stopQuantumVoice() {
        if (stopVoiceBtn) stopVoiceBtn.classList.remove('active-stop'); // إخفاء الزر فوراً
        try {
            await fetch('/api/stop-audio', { method: 'POST' });
            console.log('[+] Quantum Voice interrupted.');
        } catch (err) {
            console.error('[-] Failed to interrupt voice:', err);
        }
    }

    if (stopVoiceBtn) {
        stopVoiceBtn.addEventListener('click', stopQuantumVoice);
    }

    // شورت كت كيبورد: زر Escape (Esc) لإيقاف الصوت باحترافية
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            stopQuantumVoice();
        }
    });

    // ── START APP ──
    initApp();

})();