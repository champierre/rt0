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
        recognition: null,
        conversationHistory: [],
        isRobotConnected: false,
        device: null,
        txCharacteristic: null,
        rxCharacteristic: null,
        commandResolvers: new Map()
    };

    const elements = {
        chatContainer: document.getElementById('chatContainer'),
        status: document.getElementById('status'),
        micBtn: document.getElementById('micBtn'),
        robotBtn: document.getElementById('robotBtn'),
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
            if (event.error === 'aborted') {
                return;
            }
            setStatus(`エラー: ${event.error}`, true);
            if (state.isRecording && event.error !== 'no-speech') {
                setTimeout(() => {
                    if (state.isRecording && !state.isSpeaking) {
                        try {
                            state.recognition.start();
                        } catch (e) {
                            console.error('Recognition restart error:', e);
                        }
                    }
                }, 100);
            }
        };

        state.recognition.onend = () => {
            if (state.isRecording && !state.isSpeaking) {
                setTimeout(() => {
                    if (state.isRecording && !state.isSpeaking) {
                        try {
                            state.recognition.start();
                        } catch (e) {
                            console.error('Recognition restart error:', e);
                        }
                    }
                }, 300);
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
        }
    ];

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
                    temperature: 0.7,
                    tools: tools
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const message = data.choices[0].message;

            if (message.tool_calls && message.tool_calls.length > 0) {
                state.conversationHistory.push(message);

                // 最初のtool_callのみ実行
                const toolCall = message.tool_calls[0];

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
                }

                // 2回目のAPI呼び出しで応答を取得
                const finalResponse = await fetch(OPENAI_API_URL, {
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

                const finalData = await finalResponse.json();
                const assistantMessage = finalData.choices[0].message.content;

                state.conversationHistory.push({ role: 'assistant', content: assistantMessage });
                addMessage('assistant', assistantMessage);
                speak(assistantMessage);
            } else {
                const assistantMessage = message.content;
                state.conversationHistory.push({ role: 'assistant', content: assistantMessage });
                addMessage('assistant', assistantMessage);
                speak(assistantMessage);
            }

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
            if (state.isRecording) {
                setStatus('聴いています...');
                state.recognition.start();
            } else {
                setStatus('マイクボタンを押して話しかけてください');
            }
        };

        utterance.onerror = () => {
            state.isSpeaking = false;
            if (state.isRecording) {
                setStatus('聴いています...');
                state.recognition.start();
            }
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

        if (response.length >= 2) {
            const key = `${response[0]}-${response[1]}`;
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

    // Robot command: forward
    function setDistance(distance) {
        const arr = new Uint8Array(19);
        arr[0] = 1;
        arr[1] = 8;
        arr[2] = 0;

        const value = distance | 0;
        arr[3] = (value >> 24) & 0xFF;
        arr[4] = (value >> 16) & 0xFF;
        arr[5] = (value >> 8) & 0xFF;
        arr[6] = value & 0xFF;
        return arr;
    }

    // Robot command: rotate
    function setAngle(angle) {
        const arr = new Uint8Array(19);
        arr[0] = 1;
        arr[1] = 12;
        arr[2] = 0;

        const angleValue = (angle * 10) | 0;
        arr[3] = (angleValue >> 24) & 0xFF;
        arr[4] = (angleValue >> 16) & 0xFF;
        arr[5] = (angleValue >> 8) & 0xFF;
        arr[6] = angleValue & 0xFF;
        return arr;
    }

    async function sendRobotCommand(commandData, key, commandName) {
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
        const commandData = setDistance(distance);
        addMessage('system', `🤖 前進: ${distance}mm`);
        await sendRobotCommand(commandData, '1-8', 'Forward command');
        setStatus(`${distance}mm前進完了`);
    }

    async function executeRobotRotate(angle) {
        const commandData = setAngle(angle);
        addMessage('system', `🤖 回転: ${angle}度`);
        await sendRobotCommand(commandData, '1-12', 'Rotate command');
        setStatus(`${angle}度回転完了`);
    }

    init();

    return {
        toggleRecording,
        clearChat,
        openSettings,
        closeSettings,
        saveSettings,
        toggleRobot
    };
})();
