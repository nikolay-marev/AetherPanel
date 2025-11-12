const firebaseConfig = {
  apiKey: "AIzaSyBPxmdwUc45Ub7JnjfMqiVQBCE1dDF8154",
  authDomain: "serverpanel-d2e7e.firebaseapp.com",
  databaseURL: "https://serverpanel-d2e7e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "serverpanel-d2e7e",
  storageBucket: "serverpanel-d2e7e.firebasestorage.app",
  messagingSenderId: "237354868444",
  appId: "1:237354868444:web:96af5238fb2a251d4d5e19",
  measurementId: "G-9B5JZXB8RY"
};

try {
  firebase.initializeApp(firebaseConfig);
} catch (error) {
  console.log('Firebase already initialized');
}

const db = firebase.firestore();
const auth = firebase.auth();

document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;
    let serialPort = null;
    let reader = null;
    let writer = null;
    let isConnected = false;
    let startTime = null;
    let isBlinking = false;
    let currentAngle = 90;
    let currentLedState = 'off';
    let currentFilter = 'all';
    let isUpdatingFromRemote = false;
    let currentTemperature = 0;
    let currentHumidity = 0;
    let currentLightLevel = 0;
    let currentLux = 0;
    let currentDistance = 0;

    // Sensor data history for charts
    let sensorHistory = {
        temperature: [],
        humidity: [],
        light: [],
        lux: [],
        distance: []
    };

    function showToast(msg, color = "#4c82ff") {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.borderColor = color;
        toast.style.boxShadow = `0 0 20px ${color}44`;
        toast.style.opacity = "1";
        setTimeout(() => {
            toast.style.opacity = "0";
        }, 4000);
    }

    async function saveArduinoState(state) {
        try {
            await db.collection('arduinoState').doc('current').set({
                ...state,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                lastUpdatedBy: currentUser.email
            });
        } catch (error) {
            console.error('Error saving Arduino state:', error);
        }
    }

    async function loadArduinoState() {
        try {
            const doc = await db.collection('arduinoState').doc('current').get();
            if (doc.exists) {
                return doc.data();
            }
            return null;
        } catch (error) {
            console.error('Error loading Arduino state:', error);
            return null;
        }
    }

    function setupArduinoStateListener() {
        db.collection('arduinoState').doc('current')
            .onSnapshot((doc) => {
                if (doc.exists) {
                    const state = doc.data();
                    updateUIFromGlobalState(state);
                }
            });
    }

    function updateUIFromGlobalState(state) {
        if (state.lastUpdatedBy === currentUser.email) return;
        isUpdatingFromRemote = true;
        if (state.servoAngle !== undefined && state.servoAngle !== currentAngle) {
            currentAngle = state.servoAngle;
            const angleSlider = document.getElementById('angle-slider');
            const angleValue = document.getElementById('angle-value');
            if (angleSlider) angleSlider.value = currentAngle;
            if (angleValue) angleValue.textContent = `${currentAngle}°`;
            updateServoVisualization();
        }
        if (state.ledState !== undefined && state.ledState !== currentLedState) {
            currentLedState = state.ledState;
            updateLedVisualization(currentLedState);
        }
        if (state.isBlinking !== undefined && state.isBlinking !== isBlinking) {
            isBlinking = state.isBlinking;
            updateBlinkButtons(isBlinking);
        }
        setTimeout(() => {
            isUpdatingFromRemote = false;
        }, 100);
    }

    function updateControlIndicator(state) {
        let controlIndicator = document.getElementById('control-indicator');
        if (!controlIndicator) {
            controlIndicator = document.createElement('div');
            controlIndicator.id = 'control-indicator';
            controlIndicator.className = 'control-indicator';
            document.querySelector('.top-bar').appendChild(controlIndicator);
        }
        if (state && state.lastUpdatedBy) {
            const isCurrentUserControlling = state.lastUpdatedBy === currentUser.email;
            controlIndicator.innerHTML = `
                <div class="control-status ${isCurrentUserControlling ? 'you-controlling' : 'other-controlling'}">
                    <i class="fa-solid ${isCurrentUserControlling ? 'fa-user' : 'fa-users'}"></i>
                    <span>${isCurrentUserControlling ? 'You are controlling' : `Controlled by: ${state.lastUpdatedBy}`}</span>
                </div>
            `;
        }
    }

    document.getElementById('navigation').style.display = 'none';
    document.getElementById('top-bar').style.display = 'none';
    document.getElementById('content').style.display = 'none';
    
    showLoginModal();

    function showLoginModal() {
        const modal = document.createElement('div');
        modal.className = 'login-modal';
        modal.id = 'login-modal';
        modal.innerHTML = `
            <div class="login-form">
                <div class="login-header">
                    <h2>AetherPanel</h2>
                </div>
                <div class="input-group">
                    <label>Email Address</label>
                    <input type="email" id="login-email" placeholder="Enter admin email">
                </div>
                <div class="input-group">
                    <label>Password</label>
                    <input type="password" id="login-password" placeholder="Enter admin password">
                </div>
                <button id="login-btn" class="login-button">
                    <i class="fa-solid fa-right-to-bracket"></i> Login
                </button>
                <div class="login-info">
                    <i style="color: #59759c;" class="fa-solid fa-shield"></i>
                    <small>Only pre-registered admin accounts can access this system.</small>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('login-btn').addEventListener('click', handleLogin);
        document.getElementById('login-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleLogin();
        });

        async function handleLogin() {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            if (!email || !password) {
                showToast('Please fill in both email and password', '#ff4c4c');
                return;
            }
            const loginBtn = document.getElementById('login-btn');
            loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
            loginBtn.disabled = true;
            try {
                await auth.signInWithEmailAndPassword(email, password);
                showToast('✅ Login successful!', '#4c82ff');
                document.getElementById('login-modal').remove();
                showMainInterface();
            } catch (error) {
                let errorMessage = 'Login failed';
                switch(error.code) {
                    case 'auth/user-not-found': errorMessage = 'Account not found'; break;
                    case 'auth/wrong-password': errorMessage = 'Incorrect password'; break;
                    case 'auth/invalid-email': errorMessage = 'Invalid email address'; break;
                    case 'auth/user-disabled': errorMessage = 'Account disabled'; break;
                }
                showToast(errorMessage, '#ff4c4c');
                loginBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Login';
                loginBtn.disabled = false;
            }
        }
    }

    function showMainInterface() {
        document.getElementById('navigation').style.display = 'block';
        document.getElementById('top-bar').style.display = 'flex';
        document.getElementById('content').style.display = 'block';
        initializeApp();
    }

    function initializeApp() {
        const navItems = document.querySelectorAll('.nav-item');
        const tabs = document.querySelectorAll('.tab');
        const dropdownContainer = document.querySelector('.dropdown-container');
        const dropdownMenu = document.querySelector('.dropdown-menu');

        function activateTab(tabId) {
            navItems.forEach(item => item.classList.remove('active'));
            tabs.forEach(tab => tab.classList.remove('active'));
            const targetNav = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
            const targetTab = document.getElementById(tabId);
            if (targetNav) targetNav.classList.add('active');
            if (targetTab) targetTab.classList.add('active');
            localStorage.setItem('lastActiveAdminTab', tabId);
        }

        const savedTab = localStorage.getItem('lastActiveAdminTab');
        activateTab(savedTab || 'dashboard');

        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const targetTab = item.getAttribute('data-tab');
                activateTab(targetTab);
            });
        });

        if (dropdownContainer && dropdownMenu) {
            dropdownContainer.addEventListener('click', (event) => {
                event.stopPropagation();
                dropdownMenu.classList.toggle('open');
            });
        }

        document.addEventListener('click', (event) => {
            if (dropdownMenu && dropdownMenu.classList.contains('open') && !dropdownContainer.contains(event.target)) {
                dropdownMenu.classList.remove('open');
            }
        });

        setupArduinoStateListener();
        
        loadArduinoState().then(state => {
            if (state) {
                updateUIFromGlobalState(state);
                updateControlIndicator(state);
            }
        });

        function updateBoardInfo() {
            const boardNameElement = document.querySelector('.hardware-info .info-item:nth-child(1) span:last-child');
            const boardNameEl = document.querySelector('.hardware-header h3');
            if (boardNameElement && boardNameEl && isConnected) {
                boardNameElement.textContent = "Arduino Uno R4 WiFi";
                boardNameEl.textContent = "Arduino Uno R4 WiFi";
            } else if (boardNameElement && boardNameEl && !isConnected) {
                boardNameElement.textContent = "--";
                boardNameEl.textContent = "--";
            }
        }

        async function connectToArduino() {
            try {
                if (!navigator.serial) {
                    showToast("Web Serial API not supported", "#ff4c4c");
                    return;
                }
                serialPort = await navigator.serial.requestPort();
                await serialPort.open({ baudRate: 9600 });
                const textDecoder = new TextDecoderStream();
                serialPort.readable.pipeTo(textDecoder.writable);
                reader = textDecoder.readable.getReader();
                const textEncoder = new TextEncoderStream();
                textEncoder.readable.pipeTo(serialPort.writable);
                writer = textEncoder.writable.getWriter();
                isConnected = true;
                startTime = Date.now();
                updateConnectionStatus(true);
                updateDashboardStats();
                showToast("✅ Arduino connected", "#4c82ff");
                updateBoardInfo();
                readFromArduino();
            } catch (error) {
                console.error('Error:', error);
                showToast("❌ Connection failed", "#ff4c4c");
                isConnected = false;
                updateConnectionStatus(false);
                updateDashboardStats();
            }
        }

        async function disconnectFromArduino() {
            if (reader) {
                await reader.cancel();
                reader = null;
            }
            if (writer) {
                await writer.close();
                writer = null;
            }
            if (serialPort) {
                await serialPort.close();
                serialPort = null;
            }
            isConnected = false;
            startTime = null;
            updateConnectionStatus(false);
            showToast("🔌 Arduino disconnected", "#ff4c4c");
        }

        async function readFromArduino() {
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        reader.releaseLock();
                        break;
                    }
                    if (value) {
                        processArduinoData(value);
                    }
                }
            } catch (error) {
                console.error('Read error:', error);
                if (isConnected) {
                    showToast("❌ Connection lost", "#ff4c4c");
                    isConnected = false;
                    updateConnectionStatus(false);
                }
            }
        }

        async function writeToArduino(data) {
            if (!isConnected || !writer) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return false;
            }
            try {
                await new Promise(resolve => setTimeout(resolve, 50));
                await writer.write(data + '\n');
                console.log('Sent:', data);
                return true;
            } catch (error) {
                console.error('Write error:', error);
                showToast("❌ Send failed", "#ff4c4c");
                return false;
            }
        }

        function processArduinoData(data) {
            console.log('Received:', data);
            
            const lines = data.split('\n');
            lines.forEach(line => {
                line = line.trim();
                if (!line) return;
                
                processSensorData(line);
                
                if (line.includes('STATUS:READY')) {
                    updateConnectionStatus(true);
                    updateDashboardStats();
                }
                else if (line.includes('LED:ON')) {
                    isBlinking = false;
                    currentLedState = 'on';
                    updateLedVisualization('on');
                    updateDashboardStats();
                }
                else if (line.includes('LED:OFF')) {
                    isBlinking = false;
                    currentLedState = 'off';
                    updateLedVisualization('off');
                    updateDashboardStats();
                }
                else if (line.includes('LED:BLINK_STARTED')) {
                    isBlinking = true;
                    currentLedState = 'blink';
                    updateLedVisualization('blink');
                    updateDashboardStats();
                }
                else if (line.includes('SERVO:')) {
                    const angleMatch = line.match(/SERVO:(\d+)/);
                    if (angleMatch) {
                        currentAngle = parseInt(angleMatch[1]);
                        updateServoStatus();
                        updateServoVisualization();
                        updateDashboardStats();
                    }
                }
                else if (line.includes('CMD:')) {
                    console.log('Command echo:', line);
                }
            });
        }

        function processSensorData(data) {
            console.log('Sensor Data:', data);
            
            const tempMatch = data.match(/TEMP:([\d.]+)/);
            const humMatch = data.match(/HUM:([\d.]+)/);
            const lightMatch = data.match(/LIGHT:(\d+)/);
            const luxMatch = data.match(/LUX:([\d.]+)/);
            const distanceMatch = data.match(/DISTANCE:([\d.]+)/);
            
            let dataUpdated = false;
            
            if (tempMatch) {
                currentTemperature = parseFloat(tempMatch[1]);
                updateSensorDisplay('temp-value', currentTemperature.toFixed(1) + '');
                addToSensorHistory('temperature', currentTemperature);
                dataUpdated = true;
            }
            
            if (humMatch) {
                currentHumidity = parseFloat(humMatch[1]);
                updateSensorDisplay('humidity-value', Math.round(currentHumidity) + '');
                addToSensorHistory('humidity', currentHumidity);
                dataUpdated = true;
            }
            
            if (lightMatch) {
                currentLightLevel = parseInt(lightMatch[1]);
                updateSensorDisplay('light-value', currentLightLevel.toString() + ' lux');
                addToSensorHistory('light', currentLightLevel);
                dataUpdated = true;
            }
            
            if (luxMatch) {
                currentLux = parseFloat(luxMatch[1]);
                updateSensorDisplay('lux-value', currentLux.toFixed(1) + ' lux');
                addToSensorHistory('lux', currentLux);
                dataUpdated = true;
            }
            
            if (distanceMatch) {
                currentDistance = parseFloat(distanceMatch[1]);
                updateSensorDisplay('distance-value', currentDistance.toFixed(1) + '');
                addToSensorHistory('distance', currentDistance);
                dataUpdated = true;
            }
            
            if (dataUpdated) {
                updateDashboardStats();
                updateCharts();
            }
        }

        function addToSensorHistory(type, value) {
            const timestamp = Date.now();
            sensorHistory[type].push({
                x: timestamp,
                y: value
            });
            
            // Keep only last 50 readings
            if (sensorHistory[type].length > 50) {
                sensorHistory[type] = sensorHistory[type].slice(-50);
            }
        }

        function updateCharts() {
            updateSimpleChart('temp-chart', sensorHistory.temperature, '°C', '#ff6b6b');
            updateSimpleChart('humidity-chart', sensorHistory.humidity, '%', '#4ecdc4');
            updateSimpleChart('light-chart', sensorHistory.light, ' lux', '#45b7d1');
            updateSimpleChart('lux-chart', sensorHistory.lux, ' lux', '#ffa500');
            updateSimpleChart('distance-chart', sensorHistory.distance, ' cm', '#96ceb4');
        }

        function updateSimpleChart(chartId, data, unit, color) {
            const chartElement = document.getElementById(chartId);
            if (!chartElement) return;

            if (data.length > 0) {
                const latest = data[data.length - 1].y;
                const min = Math.min(...data.map(d => d.y)).toFixed(1);
                const max = Math.max(...data.map(d => d.y)).toFixed(1);
                const trend = data.length > 1 ? 
                    (latest > data[data.length - 2].y ? '↗️' : 
                     latest < data[data.length - 2].y ? '↘️' : '→') : '→';
                
                chartElement.innerHTML = `
                    <div style="text-align: center; padding: 15px;">
                        <div style="font-size: 28px; font-weight: bold; color: ${color}; margin-bottom: 5px;">
                            ${latest}${unit}
                        </div>
                        <div style="font-size: 18px; margin-bottom: 8px;">
                            ${trend}
                        </div>
                        <div style="font-size: 12px; color: #919db1;">
                            Min: ${min}${unit} | Max: ${max}${unit}
                        </div>
                        <div style="font-size: 11px; color: #919db1; margin-top: 3px;">
                            ${data.length} readings
                        </div>
                    </div>
                `;
            } else {
                chartElement.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #919db1;">
                        <div style="font-size: 14px;">No data available</div>
                    </div>
                `;
            }
        }

        function updateSensorDisplay(elementId, value) {
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = value;
            }
        }

        function updateDashboardStats() {
            const servoStatusElement = document.getElementById('servo-status');
            if (servoStatusElement) {
                servoStatusElement.textContent = `${currentAngle}°`;
            }
            const ledStatusElement = document.getElementById('led-status');
            if (ledStatusElement) {
                ledStatusElement.textContent = currentLedState === 'on' ? 'On' : 
                                            currentLedState === 'blink' ? 'Blinking' : 'Off';
            }
            const arduinoStatusElement = document.getElementById('arduino-status');
            if (arduinoStatusElement) {
                arduinoStatusElement.textContent = isConnected ? "Connected" : "Disconnected";
            }
            updateSensorDisplay('dashboard-temp', currentTemperature.toFixed(1) + '°C');
            updateSensorDisplay('dashboard-humidity', Math.round(currentHumidity) + '%');
            updateSensorDisplay('dashboard-light', currentLightLevel.toString());
        }

        function updateConnectionStatus(connected) {
            const statusElement = document.getElementById('status-text');
            const arduinoStatus = document.getElementById('arduino-status');
            const arduinoDetailStatus = document.getElementById('arduino-detail-status');
            const serverStatus = document.querySelector('.server-status');
            if (connected) {
                statusElement.textContent = "Arduino Online";
                arduinoStatus.textContent = "Connected";
                if (arduinoDetailStatus) {
                    arduinoDetailStatus.innerHTML = '<div class="status-indicator connected"></div><span>Connected</span>';
                }
                if (serverStatus) {
                    serverStatus.style.background = "#1f6e4d";
                }
                document.getElementById('last-ping').textContent = new Date().toLocaleTimeString();
                const boardNameElement = document.querySelector('.hardware-info .info-item:nth-child(1) span:last-child');
                if (boardNameElement) {
                    boardNameElement.textContent = "Arduino Uno R4 WiFi";
                }
            } else {
                statusElement.textContent = "Arduino Offline";
                arduinoStatus.textContent = "Disconnected";
                if (arduinoDetailStatus) {
                    arduinoDetailStatus.innerHTML = '<div class="status-indicator disconnected"></div><span>Disconnected</span>';
                }
                if (serverStatus) {
                    serverStatus.style.background = "#ff4c4c";
                }
                document.getElementById('last-ping').textContent = "--";
                const boardNameElement = document.querySelector('.hardware-info .info-item:nth-child(1) span:last-child');
                if (boardNameElement) {
                    boardNameElement.textContent = "--";
                }
            }
        }

        document.getElementById('connect-arduino').addEventListener('click', async (e) => {
            if (!isConnected) {
                await connectToArduino();
            } else {
                await disconnectFromArduino();
            }
        });

        const angleSlider = document.getElementById('angle-slider');
        const angleValue = document.getElementById('angle-value');
        const presetAngleBtns = document.querySelectorAll('.preset-angle-btn');
        const servoArm = document.getElementById('servo-arm');

        function updateServoStatus() {
            const servoStatus = document.getElementById('servo-status');
            const servoDetailStatus = document.getElementById('servo-detail-status');
            const servoStatusText = document.getElementById('servo-status-text');
            if (servoStatus) {
                servoStatus.textContent = `${currentAngle}°`;
            }
            if (servoDetailStatus) {
                servoDetailStatus.textContent = `${currentAngle}°`;
            }
            if (servoStatusText) {
                servoStatusText.textContent = `Ready (${currentAngle}°)`;
            }
            const statusIndicator = document.querySelector('#servo-detail-status')?.parentElement?.querySelector('.status-indicator');
            if (statusIndicator) {
                statusIndicator.className = 'status-indicator stopped';
            }
        }

        function updateServoVisualization() {
            if (servoArm) {
                const rotation = currentAngle - 90;
                servoArm.style.transform = `rotate(${rotation}deg)`;
            }
        }

        presetAngleBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!isConnected) {
                    showToast("❌ Arduino not connected", "#ff4c4c");
                    return;
                }
                const angle = parseInt(btn.getAttribute('data-angle'));
                currentAngle = angle;
                if (angleSlider) angleSlider.value = angle;
                updateServoVisualization();
                if (angleValue) {
                    angleValue.textContent = `${currentAngle}°`;
                }
                const success = await writeToArduino(`SERVO:${currentAngle}`);
                if (success) {
                    showToast(`Servo moving to ${currentAngle}°`, "#4c82ff");
                    await saveArduinoState({
                        servoAngle: currentAngle,
                        ledState: currentLedState,
                        isBlinking: isBlinking,
                        isConnected: true
                    });
                }
            });
        });

        const positionBtns = document.querySelectorAll('.position-btn');
        positionBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!isConnected) {
                    showToast("❌ Arduino not connected", "#ff4c4c");
                    return;
                }
                const angle = parseInt(btn.getAttribute('data-angle'));
                currentAngle = angle;
                if (angleSlider) angleSlider.value = angle;
                updateServoVisualization();
                if (angleValue) {
                    angleValue.textContent = `${currentAngle}°`;
                }
                const success = await writeToArduino(`SERVO:${currentAngle}`);
                if (success) {
                    showToast(`Servo moving to ${currentAngle}°`, "#4c82ff");
                    await saveArduinoState({
                        servoAngle: currentAngle,
                        ledState: currentLedState,
                        isBlinking: isBlinking,
                        isConnected: true
                    });
                }
            });
        });

        angleSlider?.addEventListener('input', () => {
            currentAngle = parseInt(angleSlider.value);
            updateServoVisualization();
            if (angleValue) {
                angleValue.textContent = `${currentAngle}°`;
            }
        });

        angleSlider?.addEventListener('mouseup', async () => {
            if (!isConnected) return;
            const success = await writeToArduino(`SERVO:${currentAngle}`);
            if (success) {
                showToast(`Servo moving to ${currentAngle}°`, "#4c82ff");
                await saveArduinoState({
                    servoAngle: currentAngle,
                    ledState: currentLedState,
                    isBlinking: isBlinking,
                    isConnected: true
                });
            }
        });

        const quickServo0 = document.getElementById('quick-servo-0');
        const quickServo90 = document.getElementById('quick-servo-90');
        const quickServo180 = document.getElementById('quick-servo-180');
        const quickLedOn = document.getElementById('quick-led-on');
        const quickLedOff = document.getElementById('quick-led-off');

        [quickServo0, quickServo90, quickServo180].forEach((btn, index) => {
            btn?.addEventListener('click', async () => {
                if (!isConnected) {
                    showToast("❌ Arduino not connected", "#ff4c4c");
                    return;
                }
                const angles = [0, 90, 180];
                currentAngle = angles[index];
                if (angleSlider) angleSlider.value = currentAngle;
                updateServoVisualization();
                if (angleValue) angleValue.textContent = `${currentAngle}°`;
                
                const success = await writeToArduino(`SERVO:${currentAngle}`);
                if (success) {
                    showToast(`Servo moving to ${currentAngle}°`, "#4c82ff");
                    await saveArduinoState({
                        servoAngle: currentAngle,
                        ledState: currentLedState,
                        isBlinking: isBlinking,
                        isConnected: true
                    });
                }
            });
        });

        quickLedOn?.addEventListener('click', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            currentLedState = 'on';
            updateLedVisualization('on');
            const success = await writeToArduino('LED:ON');
            if (success) {
                await saveArduinoState({
                    servoAngle: currentAngle,
                    ledState: currentLedState,
                    isBlinking: false,
                    isConnected: true
                });
            }
        });

        quickLedOff?.addEventListener('click', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            currentLedState = 'off';
            updateLedVisualization('off');
            const success = await writeToArduino('LED:OFF');
            if (success) {
                await saveArduinoState({
                    servoAngle: currentAngle,
                    ledState: currentLedState,
                    isBlinking: false,
                    isConnected: true
                });
            }
        });

        function updateLedVisualization(state) {
            const ledBulb = document.getElementById('led-bulb');
            const ledModeText = document.getElementById('led-mode-text');
            const ledStatus = document.getElementById('led-status');
            const ledDetailStatus = document.getElementById('led-detail-status');
            
            ledBulb.className = 'led-bulb';
            
            switch(state) {
                case 'on':
                    ledBulb.classList.add('on');
                    if (ledModeText) ledModeText.textContent = 'ON';
                    if (ledStatus) ledStatus.textContent = 'On';
                    if (ledDetailStatus) ledDetailStatus.textContent = 'On';
                    break;
                case 'off':
                    if (ledModeText) ledModeText.textContent = 'OFF';
                    if (ledStatus) ledStatus.textContent = 'Off';
                    if (ledDetailStatus) ledDetailStatus.textContent = 'Off';
                    break;
                case 'blink':
                    ledBulb.classList.add('blink');
                    if (ledModeText) ledModeText.textContent = 'BLINK';
                    if (ledStatus) ledStatus.textContent = 'Blinking';
                    if (ledDetailStatus) ledDetailStatus.textContent = 'Blinking';
                    break;
            }
            
            const statusIndicator = document.querySelector('#led-detail-status')?.parentElement?.querySelector('.status-indicator');
            if (statusIndicator) {
                statusIndicator.className = 'status-indicator';
                if (state === 'on') {
                    statusIndicator.classList.add('on');
                } else if (state === 'blink') {
                    statusIndicator.classList.add('blinking');
                } else {
                    statusIndicator.classList.add('off');
                }
            }
        }

        function updateBlinkButtons(blinking) {
            const patternBtns = document.querySelectorAll('.pattern-btn');
            patternBtns.forEach(btn => {
                if (blinking) {
                    btn.classList.add('active-blink');
                } else {
                    btn.classList.remove('active-blink');
                    const pattern = btn.getAttribute('data-pattern');
                    let icon = '', text = '';
                    switch(pattern) {
                        case 'slow': icon = 'fa-wave-square'; text = 'Slow Blink'; break;
                        case 'fast': icon = 'fa-bolt'; text = 'Fast Blink'; break;
                        case 'pulse': icon = 'fa-heart-pulse'; text = 'Pulse'; break;
                    }
                    btn.innerHTML = `<i class="fa-solid ${icon}"></i> ${text}`;
                }
            });
        }

        const ledBlinkBtn = document.getElementById('led-blink-btn');

        const ledControlOnBtn = document.querySelector('.led-btn[data-state="on"]');
        const ledControlOffBtn = document.querySelector('.led-btn[data-state="off"]');

        ledControlOnBtn?.addEventListener('click', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            const success = await writeToArduino('LED:ON');
            if (success) {
                currentLedState = 'on';
                updateLedVisualization('on');
                await saveArduinoState({
                    servoAngle: currentAngle,
                    ledState: 'on',
                    isBlinking: false,
                    isConnected: true
                });
            }
        });

        ledControlOffBtn?.addEventListener('click', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            const success = await writeToArduino('LED:OFF');
            if (success) {
                currentLedState = 'off';
                updateLedVisualization('off');
                await saveArduinoState({
                    servoAngle: currentAngle,
                    ledState: 'off',
                    isBlinking: false,
                    isConnected: true
                });
            }
        });
        
        ledBlinkBtn?.addEventListener('click', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            const success = await writeToArduino('LED:BLINK');
            if (success) {
                await saveArduinoState({
                    servoAngle: currentAngle,
                    ledState: 'blink',
                    isBlinking: true,
                    isConnected: true
                });
            }
        });
        
        const patternBtns = document.querySelectorAll('.pattern-btn');
        patternBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!isConnected) {
                    showToast("❌ Arduino not connected", "#ff4c4c");
                    return;
                }
                const pattern = btn.getAttribute('data-pattern');
                let command = 'LED:BLINK';
                switch(pattern) {
                    case 'slow': command = 'LED:BLINK,SLOW'; break;
                    case 'fast': command = 'LED:BLINK,FAST'; break;
                    case 'pulse': command = 'LED:BLINK,PULSE'; break;
                }
                const success = await writeToArduino(command);
                if (success) {
                    await saveArduinoState({
                        servoAngle: currentAngle,
                        ledState: 'blink',
                        isBlinking: true,
                        isConnected: true
                    });
                }
            });
        });

        const applyCustomBlinkBtn = document.getElementById('apply-custom-blink');
        applyCustomBlinkBtn?.addEventListener('click', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            const onTime = document.getElementById('blink-on-time').value || 500;
            const offTime = document.getElementById('blink-off-time').value || 500;
            const success = await writeToArduino(`LED:BLINK,CUSTOM,${onTime}`);
            if (success) {
                showToast(`Custom blink: ${onTime}ms interval`, "#4c82ff");
                await saveArduinoState({
                    servoAngle: currentAngle,
                    ledState: 'blink',
                    isBlinking: true,
                    isConnected: true
                });
            }
        });

        setInterval(() => {
            const uptimeElement = document.getElementById('arduino-uptime');
            if (uptimeElement) {
                if (isConnected && startTime) {
                    const uptime = Date.now() - startTime;
                    const hours = Math.floor(uptime / (1000 * 60 * 60));
                    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((uptime % (1000 * 60)) / 1000);
                    uptimeElement.textContent = `${hours}h ${minutes}m ${seconds}s`;
                } else {
                    uptimeElement.textContent = "--"; 
                }
            }
        }, 1000);

        document.addEventListener('visibilitychange', function() {
            if (!document.hidden && isConnected) {
                updateDashboardStats();
            }
        });

        setInterval(() => {
            if (isConnected) {
                updateDashboardStats();
                if (writer) {
                    writeToArduino('STATUS');
                }
            }
        }, 5000);

        auth.onAuthStateChanged(async (user) => {
            if (user) {
                currentUser = user;
                const username = user.email.split('@')[0];
                document.querySelector('.username').textContent = username;
                document.querySelector('.user-avatar').textContent = username.charAt(0).toUpperCase();
                initializeAdminManagement(user);
            }
        });

        document.querySelector('.logout').addEventListener('click', async (e) => {
            e.preventDefault();
            await auth.signOut();
            showToast('Logged out successfully', '#4c82ff');
            location.reload();
        });

        function initializeAdminManagement(user) {
            currentUser = user;
            updateAdminInfo(user);
        }

        function updateAdminInfo(user) {
            const currentAdminEmail = document.getElementById('current-admin-email');
            const accountCreatedDate = document.getElementById('account-created-date');
            const lastLoginDate = document.getElementById('last-login-date');
            if (currentAdminEmail) {
                currentAdminEmail.textContent = user.email;
            }
            if (accountCreatedDate && user.metadata) {
                const created = new Date(user.metadata.creationTime);
                accountCreatedDate.textContent = created.toLocaleDateString();
            }
            if (lastLoginDate && user.metadata) {
                const lastSignIn = new Date(user.metadata.lastSignInTime);
                lastLoginDate.textContent = lastSignIn.toLocaleString();
            }
        }

        const changePasswordBtn = document.getElementById('change-password-btn');
        changePasswordBtn?.addEventListener('click', async () => {
            const currentPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            if (!currentPassword || !newPassword || !confirmPassword) {
                showToast('Please fill all password fields', '#ff4c4c');
                return;
            }
            if (newPassword.length < 6) {
                showToast('New password must be at least 6 characters', '#ff4c4c');
                return;
            }
            if (newPassword !== confirmPassword) {
                showToast('New passwords do not match', '#ff4c4c');
                return;
            }
            try {
                const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, currentPassword);
                await currentUser.reauthenticateWithCredential(credential);
                await currentUser.updatePassword(newPassword);
                showToast('Password changed successfully', '#4c82ff');
                document.getElementById('current-password').value = '';
                document.getElementById('new-password').value = '';
                document.getElementById('confirm-password').value = '';
            } catch (error) {
                console.error('Error changing password:', error);
                let errorMessage = 'Error changing password';
                switch(error.code) {
                    case 'auth/wrong-password':
                        errorMessage = 'Current password is incorrect';
                        break;
                    case 'auth/requires-recent-login':
                        errorMessage = 'Please re-login to change password';
                        break;
                    case 'auth/weak-password':
                        errorMessage = 'New password is too weak';
                        break;
                }
                showToast(errorMessage, '#ff4c4c');
            }
        });

        const deleteAccountBtn = document.getElementById('delete-account-btn');
        deleteAccountBtn?.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to delete your account? This action cannot be undone and all your data will be permanently lost.')) {
                return;
            }
            const password = prompt('Please enter your password to confirm account deletion:');
            if (!password) return;
            try {
                const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, password);
                await currentUser.reauthenticateWithCredential(credential);
                await currentUser.delete();
                showToast('Account deleted successfully', '#4c82ff');
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            } catch (error) {
                console.error('Error deleting account:', error);
                let errorMessage = 'Error deleting account';
                switch(error.code) {
                    case 'auth/wrong-password':
                        errorMessage = 'Incorrect password';
                        break;
                    case 'auth/requires-recent-login':
                        errorMessage = 'Please re-login to delete account';
                        break;
                }
                showToast(errorMessage, '#ff4c4c');
            }
        });

        // Initialize charts on dashboard load
        updateCharts();
    }
});
