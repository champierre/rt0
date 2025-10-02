const app = (() => {
    const API_KEY_STORAGE = 'openai_api_key';
    const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
    const MODEL = 'gpt-4o-mini';

    // Root robot Bluetooth UUIDs
    const ROOT_SERVICE_UUID = '48c5d828-ac2a-442d-97a3-0c9822b04979';
    const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    const TX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
    const RX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

    let state = {
        isRecording: false,
        isSpeaking: false,
        isProcessing: false,
        recognition: null,
        conversationHistory: [],
        isRobotConnected: false,
        device: null,
        txCharacteristic: null,
        rxCharacteristic: null,
        commandResolvers: new Map(),
        commandSequence: 0,
        voiceEnabled: false
    };

    const elements = {
        chatContainer: document.getElementById('chatContainer'),
        status: document.getElementById('status'),
        micBtn: document.getElementById('micBtn'),
        robotBtn: document.getElementById('robotBtn'),
        voiceBtn: document.getElementById('voiceBtn'),
        apiKeyInput: document.getElementById('apiKey'),
        settingsModal: document.getElementById('settingsModal')
    };

    function init() {
        loadApiKey();
        setupSpeechRecognition();
        setupMicButton();
        initializeConversation();
    }

    function initializeConversation() {
        state.conversationHistory = [
            {
                role: 'system',
                content: 'あなたはロボットを制御するアシスタントです。ユーザーの指示に従ってロボットを動かしてください。\n\n重要な注意事項：\n- 絵や図形を描く場合は、必ず最初にpen_downツールを使ってペンを下ろしてください\n- 描画が完了したら、必ずpen_upツールを使ってペンを上げてください\n- ペンを下ろさずに移動すると、線が描かれません'
            }
        ];
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
            if (state.isProcessing) {
                return;
            }
            const transcript = event.results[0][0].transcript;
            addMessage('user', transcript);
            await sendToOpenAI(transcript);
        };

        state.recognition.onerror = (event) => {
            if (event.error === 'aborted' || event.error === 'no-speech') {
                return;
            }
            setStatus(`エラー: ${event.error}`, true);
        };

        state.recognition.onend = () => {
            if (state.isRecording) {
                stopRecording();
            }
        };
    }

    function setupMicButton() {
        elements.micBtn.addEventListener('mousedown', () => {
            if (!state.isProcessing) {
                startRecording();
            }
        });

        elements.micBtn.addEventListener('mouseup', () => {
            if (state.isRecording && !state.isProcessing) {
                // 音声認識は自動的に終了するまで待つ
            }
        });

        elements.micBtn.addEventListener('mouseleave', () => {
            if (state.isRecording && !state.isProcessing) {
                // 音声認識は自動的に終了するまで待つ
            }
        });

        // タッチデバイス対応
        elements.micBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (!state.isProcessing) {
                startRecording();
            }
        });

        elements.micBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            if (state.isRecording && !state.isProcessing) {
                // 音声認識は自動的に終了するまで待つ
            }
        });
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
        if (!state.recognition) {
            return;
        }
        const apiKey = localStorage.getItem(API_KEY_STORAGE);
        if (!apiKey) {
            setStatus('APIキーが設定されていません', true);
            openSettings();
            return;
        }
        try {
            state.recognition.start();
            state.isRecording = true;
            elements.micBtn.classList.add('recording');
        } catch (e) {
            // Ignore if already started
        }
    }

    function stopRecording() {
        state.isRecording = false;
        state.isSpeaking = false;
        state.recognition.stop();
        speechSynthesis.cancel();
        elements.micBtn.classList.remove('recording');
        setStatus('マイクボタンを押して話しかけてください');
    }

    const tools = [
        {
            type: 'function',
            function: {
                name: 'move_robot_forward',
                description: 'ロボットを指定した距離（ミリメートル）だけ前進させます',
                parameters: {
                    type: 'object',
                    properties: {
                        distance: {
                            type: 'number',
                            description: '前進する距離（ミリメートル）。デフォルトは100mm'
                        }
                    },
                    required: []
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'rotate_robot',
                description: 'ロボットを指定した角度（度）だけ回転させます。正の値で時計回り、負の値で反時計回り',
                parameters: {
                    type: 'object',
                    properties: {
                        angle: {
                            type: 'number',
                            description: '回転する角度（度）。正の値で時計回り、負の値で反時計回り。デフォルトは90度'
                        }
                    },
                    required: []
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'pen_up',
                description: 'ロボットのペンを上げます',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: []
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'pen_down',
                description: 'ロボットのペンを下げます',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: []
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'play_note',
                description: 'ロボットから指定した周波数の音を指定した時間鳴らします',
                parameters: {
                    type: 'object',
                    properties: {
                        frequency: {
                            type: 'number',
                            description: '音の周波数（Hz）。デフォルトは440Hz（ラの音）'
                        },
                        duration: {
                            type: 'number',
                            description: '音を鳴らす時間（ミリ秒）。デフォルトは1000ms'
                        }
                    },
                    required: []
                }
            }
        }
    ];

    async function sendToOpenAI(text) {
        const apiKey = localStorage.getItem(API_KEY_STORAGE);
        if (!apiKey) {
            setStatus('APIキーが設定されていません', true);
            return;
        }

        state.isProcessing = true;
        elements.micBtn.disabled = true;
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
                    temperature: 0.7,
                    tools: tools
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            let data = await response.json();
            let message = data.choices[0].message;

            // tool_callsがある限り実行を続ける（最大10回）
            let loopCount = 0;
            const maxLoops = 10;
            while (message.tool_calls && message.tool_calls.length > 0 && loopCount < maxLoops) {
                loopCount++;
                state.conversationHistory.push(message);

                // すべてのtool_callsを順次実行
                for (const toolCall of message.tool_calls) {
                    await executeToolCall(toolCall);
                }

                // 次のAPI呼び出し
                const nextResponse = await fetch(OPENAI_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: MODEL,
                        messages: state.conversationHistory,
                        temperature: 0.7,
                        tools: tools
                    })
                });

                data = await nextResponse.json();
                message = data.choices[0].message;
            }

            // 最終的な応答メッセージ
            if (message.content) {
                state.conversationHistory.push({ role: 'assistant', content: message.content });
                addMessage('assistant', message.content);
                speak(message.content);
            } else {
                state.conversationHistory.push({ role: 'assistant', content: '' });
                state.isProcessing = false;
                elements.micBtn.disabled = false;
                setStatus('マイクボタンを押して話しかけてください');
            }

        } catch (error) {
            setStatus(`エラー: ${error.message}`, true);
            state.conversationHistory.pop();
            state.isProcessing = false;
            elements.micBtn.disabled = false;
        }
    }

    async function executeToolCall(toolCall) {
        if (toolCall.function.name === 'move_robot_forward') {
            const args = JSON.parse(toolCall.function.arguments);
            const distance = args.distance || 100;
            await executeRobotForward(distance);

            state.conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `ロボットを${distance}mm前進させました`
            });
        } else if (toolCall.function.name === 'rotate_robot') {
            const args = JSON.parse(toolCall.function.arguments);
            const angle = args.angle || 90;
            await executeRobotRotate(angle);

            state.conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `ロボットを${angle}度回転させました`
            });
        } else if (toolCall.function.name === 'pen_up') {
            await executeRobotPenUp();

            state.conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: 'ペンを上げました'
            });
        } else if (toolCall.function.name === 'pen_down') {
            await executeRobotPenDown();

            state.conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: 'ペンを下げました'
            });
        } else if (toolCall.function.name === 'play_note') {
            const args = JSON.parse(toolCall.function.arguments);
            const frequency = args.frequency || 440;
            const duration = args.duration || 1000;
            await executeRobotPlayNote(frequency, duration);

            state.conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `${frequency}Hzの音を${duration}ms鳴らしました`
            });
        } else {
            state.conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Unknown tool: ${toolCall.function.name}`
            });
        }
    }

    function speak(text) {
        if (!state.voiceEnabled) {
            finishSpeaking();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ja-JP';

        utterance.onstart = () => {
            state.isSpeaking = true;
            setStatus('話しています...');
        };

        utterance.onend = () => finishSpeaking();
        utterance.onerror = () => finishSpeaking();

        speechSynthesis.speak(utterance);
    }

    function finishSpeaking() {
        state.isSpeaking = false;
        state.isProcessing = false;
        elements.micBtn.disabled = false;
        setStatus('マイクボタンを押して話しかけてください');
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
        initializeConversation();
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

    async function toggleRobot() {
        if (state.isRobotConnected) {
            await disconnectRobot();
        } else {
            await connectRobot();
        }
    }

    async function connectRobot() {
        try {
            if (!navigator.bluetooth) {
                throw new Error('このブラウザはWeb Bluetooth APIに対応していません');
            }

            setStatus('ロボットを検索中...');

            state.device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [ROOT_SERVICE_UUID] }],
                optionalServices: [UART_SERVICE_UUID]
            });

            setStatus('接続中...');
            const server = await state.device.gatt.connect();

            const service = await server.getPrimaryService(UART_SERVICE_UUID);
            state.txCharacteristic = await service.getCharacteristic(TX_CHAR_UUID);
            state.rxCharacteristic = await service.getCharacteristic(RX_CHAR_UUID);

            await state.rxCharacteristic.startNotifications();
            state.rxCharacteristic.addEventListener('characteristicvaluechanged', handleRobotResponse);

            state.isRobotConnected = true;
            elements.robotBtn.classList.add('connected');
            elements.robotBtn.textContent = '🤖 切断';
            setStatus('ロボットに接続しました');

            state.device.addEventListener('gattserverdisconnected', onDisconnected);
        } catch (error) {
            setStatus(`接続エラー: ${error.message}`, true);
        }
    }

    async function disconnectRobot() {
        try {
            if (state.device && state.device.gatt.connected) {
                if (state.rxCharacteristic) {
                    state.rxCharacteristic.removeEventListener('characteristicvaluechanged', handleRobotResponse);
                    await state.rxCharacteristic.stopNotifications();
                }

                state.device.gatt.disconnect();
            }

            state.isRobotConnected = false;
            state.device = null;
            state.txCharacteristic = null;
            state.rxCharacteristic = null;
            elements.robotBtn.classList.remove('connected');
            elements.robotBtn.textContent = '🤖 接続';
            setStatus('ロボットから切断しました');
        } catch (error) {
            setStatus(`切断エラー: ${error.message}`, true);
        }
    }

    function onDisconnected() {
        state.isRobotConnected = false;
        state.device = null;
        state.txCharacteristic = null;
        state.rxCharacteristic = null;
        elements.robotBtn.classList.remove('connected');
        elements.robotBtn.textContent = '🤖 接続';
        setStatus('ロボットが切断されました');
    }

    function handleRobotResponse(event) {
        const value = event.target.value;
        const response = new Uint8Array(value.buffer);

        if (response.length >= 3) {
            const key = `${response[0]}-${response[1]}-${response[2]}`;
            const resolver = state.commandResolvers.get(key);
            if (resolver) {
                resolver();
                state.commandResolvers.delete(key);
            }
        }
    }

    // CRC8 calculation
    function generateCrc8Table() {
        const polynomial = 0x07;
        const table = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            let crc = i;
            for (let j = 0; j < 8; j++) {
                if (crc & 0x80) {
                    crc = (crc << 1) ^ polynomial;
                } else {
                    crc <<= 1;
                }
            }
            table[i] = crc & 0xFF;
        }
        return table;
    }

    const crcTable = generateCrc8Table();

    function crc8(data) {
        let crc = 0x00;
        for (let i = 0; i < data.length; i++) {
            crc = crcTable[(crc ^ data[i]) & 0xFF];
        }
        return crc;
    }

    function appendCrc(value) {
        const newValue = new Uint8Array(value.length + 1);
        newValue.set(value);
        newValue[19] = crc8(value);
        return newValue;
    }

    function createRobotCommand(deviceId, commandId, packetId, value) {
        const arr = new Uint8Array(19);
        arr[0] = deviceId;
        arr[1] = commandId;
        arr[2] = packetId & 0xFF;
        arr[3] = (value >> 24) & 0xFF;
        arr[4] = (value >> 16) & 0xFF;
        arr[5] = (value >> 8) & 0xFF;
        arr[6] = value & 0xFF;
        return arr;
    }

    function setDistance(distance, packetId) {
        return createRobotCommand(1, 8, packetId, distance | 0);
    }

    function setAngle(angle, packetId) {
        return createRobotCommand(1, 12, packetId, (angle * 10) | 0);
    }

    function setPenPosition(position, packetId) {
        const arr = new Uint8Array(19);
        arr[0] = 2; // Device ID: Marker/Eraser
        arr[1] = 0; // Command ID: Set position
        arr[2] = packetId & 0xFF;
        arr[3] = position; // 0 = up, 1 = down
        return arr;
    }

    function setSound(frequency, duration, packetId) {
        const arr = new Uint8Array(19);
        arr[0] = 5; // Device ID: Sound
        arr[1] = 0; // Command ID: Play Note
        arr[2] = packetId & 0xFF;

        // Frequency: 32-bit (Byte 3-6)
        const freqValue = frequency | 0;
        arr[3] = (freqValue >> 24) & 0xFF;
        arr[4] = (freqValue >> 16) & 0xFF;
        arr[5] = (freqValue >> 8) & 0xFF;
        arr[6] = freqValue & 0xFF;

        // Duration: 16-bit (Byte 7-8)
        const durValue = duration | 0;
        arr[7] = (durValue >> 8) & 0xFF;
        arr[8] = durValue & 0xFF;

        return arr;
    }

    async function sendRobotCommand(commandData, key) {
        if (!state.txCharacteristic) {
            setStatus('ロボットに接続されていません', true);
            throw new Error('Not connected to Root robot');
        }

        return new Promise(async (resolve, reject) => {
            state.commandResolvers.set(key, () => {
                resolve({ status: 'completed' });
            });

            const commandWithCrc = appendCrc(commandData);

            try {
                await state.txCharacteristic.writeValue(commandWithCrc);

                setTimeout(() => {
                    if (state.commandResolvers.has(key)) {
                        state.commandResolvers.delete(key);
                        reject(new Error('Command timeout'));
                    }
                }, 10000);
            } catch (error) {
                state.commandResolvers.delete(key);
                setStatus(`コマンド送信エラー: ${error.message}`, true);
                reject(error);
            }
        });
    }

    async function executeRobotForward(distance) {
        const packetId = (++state.commandSequence) & 0xFF;
        const commandData = setDistance(distance, packetId);
        const key = `1-8-${packetId}`;
        addMessage('system', `🤖 前進: ${distance}mm`);
        await sendRobotCommand(commandData, key);
        setStatus(`${distance}mm前進完了`);
    }

    async function executeRobotRotate(angle) {
        const packetId = (++state.commandSequence) & 0xFF;
        const commandData = setAngle(angle, packetId);
        const key = `1-12-${packetId}`;
        addMessage('system', `🤖 回転: ${angle}度`);
        await sendRobotCommand(commandData, key);
        setStatus(`${angle}度回転完了`);
    }

    async function executeRobotPenUp() {
        const packetId = (++state.commandSequence) & 0xFF;
        const commandData = setPenPosition(0, packetId);
        const key = `2-0-${packetId}`;
        addMessage('system', '🤖 ペンを上げる');
        await sendRobotCommand(commandData, key);
        setStatus('ペンを上げました');
    }

    async function executeRobotPenDown() {
        const packetId = (++state.commandSequence) & 0xFF;
        const commandData = setPenPosition(1, packetId);
        const key = `2-0-${packetId}`;
        addMessage('system', '🤖 ペンを下げる');
        await sendRobotCommand(commandData, key);
        setStatus('ペンを下げました');
    }

    async function executeRobotPlayNote(frequency, duration) {
        const packetId = (++state.commandSequence) & 0xFF;
        const commandData = setSound(frequency, duration, packetId);
        const key = `5-0-${packetId}`;
        addMessage('system', `🤖 音を鳴らす: ${frequency}Hz ${duration}ms`);
        await sendRobotCommand(commandData, key);
        setStatus(`${frequency}Hz ${duration}ms の音を鳴らしました`);
    }

    function toggleVoice() {
        state.voiceEnabled = !state.voiceEnabled;
        elements.voiceBtn.textContent = state.voiceEnabled ? '🔊 音声ON' : '🔇 音声OFF';
    }

    init();

    return {
        toggleRecording,
        clearChat,
        openSettings,
        closeSettings,
        saveSettings,
        toggleRobot,
        toggleVoice
    };
})();
