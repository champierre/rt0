const app = (() => {
    const API_KEY_STORAGE = 'openai_api_key';
    const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
    const MODEL = 'gpt-4o-mini';

    let state = {
        isRecording: false,
        isSpeaking: false,
        recognition: null,
        conversationHistory: []
    };

    const elements = {
        chatContainer: document.getElementById('chatContainer'),
        status: document.getElementById('status'),
        micBtn: document.getElementById('micBtn'),
        apiKeyInput: document.getElementById('apiKey'),
        settingsModal: document.getElementById('settingsModal')
    };

    function init() {
        loadApiKey();
        setupSpeechRecognition();
    }

    function loadApiKey() {
        const apiKey = localStorage.getItem(API_KEY_STORAGE);
        if (apiKey) elements.apiKeyInput.value = apiKey;
    }

    function setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setStatus('お使いのブラウザは音声認識に対応していません', true);
            return;
        }

        state.recognition = new SpeechRecognition();
        state.recognition.lang = 'ja-JP';
        state.recognition.continuous = false;
        state.recognition.interimResults = false;

        state.recognition.onstart = () => setStatus('聴いています...');

        state.recognition.onresult = async (event) => {
            const transcript = event.results[0][0].transcript;
            addMessage('user', transcript);
            await sendToOpenAI(transcript);
        };

        state.recognition.onerror = (event) => {
            setStatus(`エラー: ${event.error}`, true);
            if (state.isRecording) {
                setTimeout(() => state.isRecording && state.recognition.start(), 100);
            }
        };

        state.recognition.onend = () => {
            if (state.isRecording && !state.isSpeaking) {
                setTimeout(() => {
                    if (state.isRecording && !state.isSpeaking) {
                        state.recognition.start();
                    }
                }, 100);
            }
        };
    }

    function toggleRecording() {
        if (!state.recognition) {
            setStatus('音声認識が利用できません', true);
            return;
        }

        if (state.isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }

    function startRecording() {
        const apiKey = localStorage.getItem(API_KEY_STORAGE);
        if (!apiKey) {
            setStatus('APIキーが設定されていません', true);
            openSettings();
            return;
        }
        state.recognition.start();
        state.isRecording = true;
        elements.micBtn.classList.add('recording');
    }

    function stopRecording() {
        state.isRecording = false;
        state.isSpeaking = false;
        state.recognition.stop();
        speechSynthesis.cancel();
        elements.micBtn.classList.remove('recording');
        setStatus('マイクボタンを押して話しかけてください');
    }

    async function sendToOpenAI(text) {
        const apiKey = localStorage.getItem(API_KEY_STORAGE);
        if (!apiKey) {
            setStatus('APIキーが設定されていません', true);
            return;
        }

        setStatus('考えています...');
        state.conversationHistory.push({ role: 'user', content: text });

        try {
            const response = await fetch(OPENAI_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: MODEL,
                    messages: state.conversationHistory,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const assistantMessage = data.choices[0].message.content;

            state.conversationHistory.push({ role: 'assistant', content: assistantMessage });
            addMessage('assistant', assistantMessage);
            speak(assistantMessage);

        } catch (error) {
            setStatus(`エラー: ${error.message}`, true);
            state.conversationHistory.pop();
        }
    }

    function speak(text) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ja-JP';

        utterance.onstart = () => {
            state.isSpeaking = true;
            setStatus('話しています...');
        };

        utterance.onend = () => {
            state.isSpeaking = false;
            setStatus('聴いています...');
            if (state.isRecording) state.recognition.start();
        };

        speechSynthesis.speak(utterance);
    }

    function addMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        messageDiv.textContent = content;
        elements.chatContainer.appendChild(messageDiv);
        elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
    }

    function setStatus(message, isError = false) {
        elements.status.textContent = message;
        elements.status.className = 'status' + (isError ? ' error' : '');
    }

    function clearChat() {
        elements.chatContainer.innerHTML = '';
        state.conversationHistory = [];
        setStatus('マイクボタンを押して話しかけてください');
    }

    function openSettings() {
        elements.settingsModal.classList.add('active');
    }

    function closeSettings() {
        elements.settingsModal.classList.remove('active');
    }

    function saveSettings() {
        const apiKey = elements.apiKeyInput.value.trim();
        if (apiKey) {
            localStorage.setItem(API_KEY_STORAGE, apiKey);
            closeSettings();
            setStatus('設定を保存しました');
        } else {
            alert('APIキーを入力してください');
        }
    }

    init();

    return {
        toggleRecording,
        clearChat,
        openSettings,
        closeSettings,
        saveSettings
    };
})();
