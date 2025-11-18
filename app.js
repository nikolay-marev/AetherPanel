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

    let logCounts = {
        total: 0,
        arduino: 0,
        system: 0,
        admin: 0
    };

    function showToast(msg, color = "#3b82f6") {
        try {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #1a2332;
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                border-left: 4px solid ${color};
                box-shadow: 0 0 20px ${color}44;
                z-index: 10000;
                transition: all 0.3s ease;
                opacity: 0;
                transform: translateX(100px);
            `;
            document.body.appendChild(toast);
        }
            toast.textContent = msg;
            toast.style.borderColor = color;
            toast.style.boxShadow = `0 0 20px ${color}44`;
            toast.style.opacity = "1";
            toast.style.transform = "translateX(0)";
            
            setTimeout(() => {
                if (toast) {
                    toast.style.opacity = "0";
                    toast.style.transform = "translateX(100px)";
                }
            }, 4000);
        } catch (error) {
            console.error('Toast error:', error);
        }
    }

    async function saveArduinoState(state) {
        try {
            if (!currentUser || !currentUser.email) return;
            if (!state || typeof state !== 'object') return;
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
        try {
            if (!state || !currentUser || !currentUser.email) return;
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
        } catch (error) {
            console.error('Error updating UI from global state:', error);
            isUpdatingFromRemote = false;
        }
    }

    function updateControlIndicator(state) {
        try {
            let controlIndicator = document.getElementById('control-indicator');
            const topBar = document.querySelector('.top-bar');
            if (!topBar) return;
            
            if (!controlIndicator) {
                controlIndicator = document.createElement('div');
                controlIndicator.id = 'control-indicator';
                controlIndicator.className = 'control-indicator';
                controlIndicator.style.cssText = `
                    margin-left: auto;
                    margin-right: 20px;
                    animation: fadeIn 0.5s ease;
                `;
                topBar.appendChild(controlIndicator);
            }
            if (state && state.lastUpdatedBy) {
            const isCurrentUserControlling = state.lastUpdatedBy === currentUser.email;
            controlIndicator.innerHTML = `
                <div class="control-status ${isCurrentUserControlling ? 'you-controlling' : 'other-controlling'}" 
                     style="animation: slideInRight 0.3s ease">
                    <i class="fa-solid ${isCurrentUserControlling ? 'fa-user' : 'fa-users'}"></i>
                    <span>${isCurrentUserControlling ? 'You are controlling' : `Controlled by: ${state.lastUpdatedBy}`}</span>
                </div>
            `;
            }
        } catch (error) {
            console.error('Error updating control indicator:', error);
        }
    }

    try {
        const nav = document.getElementById('navigation');
        const topBar = document.getElementById('top-bar');
        const content = document.getElementById('content');
        if (nav) nav.style.display = 'none';
        if (topBar) topBar.style.display = 'none';
        if (content) content.style.display = 'none';
        showLoginModal();
    } catch (error) {
        console.error('Initialization error:', error);
    }

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
                    <i style="color: #3b82f6;" class="fa-solid fa-shield"></i>
                    <small>Only pre-registered admin accounts can access this system.</small>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes slideInRight {
                from { transform: translateX(50px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }
            @keyframes blink {
                0%, 50% { opacity: 1; }
                51%, 100% { opacity: 0.3; }
            }
            @keyframes slowBlink {
                0%, 70% { opacity: 1; }
                71%, 100% { opacity: 0.3; }
            }
            @keyframes fastBlink {
                0%, 30% { opacity: 1; }
                31%, 100% { opacity: 0.3; }
            }
            @keyframes pulseEffect {
                0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(76, 130, 255, 0.7); }
                70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(76, 130, 255, 0); }
                100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(76, 130, 255, 0); }
            }
        `;
        document.head.appendChild(style);

        const loginBtn = document.getElementById('login-btn');
        const loginPassword = document.getElementById('login-password');
        if (loginBtn) loginBtn.addEventListener('click', handleLogin);
        if (loginPassword) {
            loginPassword.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleLogin();
            });
        }

        async function handleLogin() {
            try {
                const emailInput = document.getElementById('login-email');
                const passwordInput = document.getElementById('login-password');
                const loginBtn = document.getElementById('login-btn');
                
                if (!emailInput || !passwordInput || !loginBtn) return;
                
                const email = emailInput.value.trim();
                const password = passwordInput.value;
                
                if (!email || !password) {
                    showToast('Please fill in both email and password', '#ff4c4c');
                    return;
                }
                
                if (!email.includes('@') || email.length < 5) {
                    showToast('Invalid email address', '#ff4c4c');
                    return;
                }
                
                loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
                loginBtn.disabled = true;
                loginBtn.style.animation = 'pulseEffect 2s infinite';
                
                await auth.signInWithEmailAndPassword(email, password);
                showToast('Login successful', '#3b82f6');
                const modal = document.getElementById('login-modal');
                if (modal) modal.remove();
                showMainInterface();
            } catch (error) {
                const loginBtn = document.getElementById('login-btn');
                if (!loginBtn) return;
                
                let errorMessage = 'Login failed';
                if (error && error.code) {
                    switch(error.code) {
                        case 'auth/user-not-found': errorMessage = 'Account not found'; break;
                        case 'auth/wrong-password': errorMessage = 'Incorrect password'; break;
                        case 'auth/invalid-email': errorMessage = 'Invalid email address'; break;
                        case 'auth/user-disabled': errorMessage = 'Account disabled'; break;
                        case 'auth/network-request-failed': errorMessage = 'Network error. Check connection'; break;
                    }
                }
                showToast(errorMessage, '#ff4c4c');
                loginBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Login';
                loginBtn.disabled = false;
                loginBtn.style.animation = 'none';
            }
        }
    }

    function showMainInterface() {
        try {
            const nav = document.getElementById('navigation');
            const topBar = document.getElementById('top-bar');
            const content = document.getElementById('content');
            if (nav) nav.style.display = 'block';
            if (topBar) topBar.style.display = 'flex';
            if (content) content.style.display = 'block';
            initializeApp();
        } catch (error) {
            console.error('Error showing main interface:', error);
        }
    }

    function initializeApp() {
        const navItems = document.querySelectorAll('.nav-item');
        const tabs = document.querySelectorAll('.tab');
        const dropdownContainer = document.querySelector('.dropdown-container');
        const dropdownMenu = document.querySelector('.dropdown-menu');

        function activateTab(tabId) {
            try {
                if (!tabId) return;
                navItems.forEach(item => {
                    if (item) {
                        item.classList.remove('active');
                        item.style.transform = 'scale(1)';
                    }
                });
                tabs.forEach(tab => {
                    if (tab) tab.classList.remove('active');
                });
                
                const targetNav = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
                const targetTab = document.getElementById(tabId);
                
                if (targetNav) {
                    targetNav.classList.add('active');
                    targetNav.style.transform = 'scale(1.05)';
                    targetNav.style.transition = 'transform 0.2s ease';
                }
                if (targetTab) {
                    targetTab.classList.add('active');
                    targetTab.style.animation = 'fadeIn 0.3s ease';
                }
                try {
                    localStorage.setItem('lastActiveAdminTab', tabId);
                } catch (e) {
                    console.warn('LocalStorage not available');
                }
            } catch (error) {
                console.error('Error activating tab:', error);
            }
        }

        let savedTab = 'dashboard';
        try {
            savedTab = localStorage.getItem('lastActiveAdminTab') || 'dashboard';
        } catch (e) {
            savedTab = 'dashboard';
        }
        activateTab(savedTab);

        navItems.forEach(item => {
            if (item) {
                item.addEventListener('click', () => {
                    try {
                        const targetTab = item.getAttribute('data-tab');
                        if (targetTab) activateTab(targetTab);
                    } catch (error) {
                        console.error('Error handling nav click:', error);
                    }
                });
            }
        });

        if (dropdownContainer && dropdownMenu) {
            dropdownContainer.addEventListener('click', (event) => {
                event.stopPropagation();
                dropdownMenu.classList.toggle('open');
                if (dropdownMenu.classList.contains('open')) {
                    dropdownMenu.style.animation = 'slideInRight 0.2s ease';
                }
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
            try {
                const boardNameElement = document.querySelector('.hardware-info .info-item:nth-child(1) span:last-child');
                const boardNameEl = document.querySelector('.hardware-header h3');
                if (boardNameElement && boardNameEl) {
                    if (isConnected) {
                        boardNameElement.textContent = "Arduino Uno R4 WiFi";
                        boardNameEl.textContent = "Arduino Uno R4 WiFi";
                    } else {
                        boardNameElement.textContent = "--";
                        boardNameEl.textContent = "--";
                    }
                }
            } catch (error) {
                console.error('Error updating board info:', error);
            }
        }

        async function connectToArduino() {
            try {
                if (!navigator.serial) {
                    showToast("Web Serial API not supported", "#ff4c4c");
                    return;
                }
                if (isConnected) {
                    showToast("Already connected", "#ff4c4c");
                    return;
                }
                serialPort = await navigator.serial.requestPort();
                if (!serialPort) {
                    showToast("No port selected", "#ff4c4c");
                    return;
                }
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
                updateConnectButton();
                updateDashboardStats();
                showToast("Arduino connected", "#3b82f6");
                addLogEntry('Arduino connected successfully', 'arduino', 'fa-microchip');
                updateBoardInfo();
                readFromArduino();
            } catch (error) {
                console.error('Connection error:', error);
                if (error.name === 'NotFoundError') {
                    showToast("No device selected", "#ff4c4c");
                } else if (error.name === 'SecurityError') {
                    showToast("Permission denied", "#ff4c4c");
                } else {
                    showToast("Connection failed", "#ff4c4c");
                }
                isConnected = false;
                updateConnectionStatus(false);
                updateConnectButton();
                updateDashboardStats();
                if (serialPort) {
                    try {
                        await serialPort.close();
                    } catch (e) {}
                    serialPort = null;
                }
            }
        }

        function updateConnectButton() {
            try {
                const connectBtn = document.getElementById('connect-arduino');
                if (!connectBtn) return;
                
                if (isConnected) {
                    connectBtn.innerHTML = '<i class="fa-solid fa-plug-circle-xmark"></i> Disconnect Arduino';
                } else {
                    connectBtn.innerHTML = '<i class="fa-solid fa-plug"></i> Connect Arduino';
                }
            } catch (error) {
                console.error('Error updating connect button:', error);
            }
        }

        async function disconnectFromArduino() {
            try {
                if (reader) {
                    try {
                        await reader.cancel();
                    } catch (e) {}
                    reader = null;
                }
                if (writer) {
                    try {
                        await writer.close();
                    } catch (e) {}
                    writer = null;
                }
                if (serialPort) {
                    try {
                        await serialPort.close();
                    } catch (e) {}
                    serialPort = null;
                }
                isConnected = false;
                startTime = null;
                updateConnectionStatus(false);
                updateConnectButton();
                showToast("Arduino disconnected", "#ff4c4c");
                addLogEntry('Arduino disconnected', 'arduino', 'fa-microchip');
            } catch (error) {
                console.error('Disconnect error:', error);
                isConnected = false;
                updateConnectionStatus(false);
                updateConnectButton();
            }
        }

        async function readFromArduino() {
            try {
                if (!reader) return;
                while (isConnected && reader) {
                    try {
                        const { value, done } = await reader.read();
                        if (done) {
                            if (reader) reader.releaseLock();
                            break;
                        }
                        if (value) {
                            processArduinoData(value);
                        }
                    } catch (readError) {
                        if (readError.name !== 'NetworkError') {
                            throw readError;
                        }
                    }
                }
            } catch (error) {
                console.error('Read error:', error);
                if (isConnected) {
                    showToast("Connection lost", "#ff4c4c");
                    isConnected = false;
                    updateConnectionStatus(false);
                    updateConnectButton();
                    addLogEntry('Connection lost', 'arduino', 'fa-circle-exclamation');
                }
            }
        }

        async function writeToArduino(data) {
            if (!isConnected || !writer) {
                showToast("Arduino not connected", "#ff4c4c");
                return false;
            }
            if (!data || typeof data !== 'string') {
                console.error('Invalid data to send');
                return false;
            }
            try {
                await new Promise(resolve => setTimeout(resolve, 50));
                await writer.write(data + '\n');
                return true;
            } catch (error) {
                console.error('Write error:', error);
                if (error.name === 'NetworkError') {
                    isConnected = false;
                    updateConnectionStatus(false);
                    updateConnectButton();
                    showToast("Connection lost", "#ff4c4c");
                } else {
                    showToast("Send failed", "#ff4c4c");
                }
                return false;
            }
        }

        function processArduinoData(data) {
            try {
                if (!data || typeof data !== 'string') return;
                const lines = data.split('\n');
                lines.forEach(line => {
                    try {
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
                                const angle = parseInt(angleMatch[1]);
                                if (!isNaN(angle) && angle >= 0 && angle <= 180) {
                                    currentAngle = angle;
                                    updateServoStatus();
                                    updateServoVisualization();
                                    updateDashboardStats();
                                }
                            }
                        }
                    } catch (lineError) {
                        console.error('Error processing line:', lineError);
                    }
                });
            } catch (error) {
                console.error('Error processing Arduino data:', error);
            }
        }

        function processSensorData(data) {
            try {
                if (!data || typeof data !== 'string') return;
                
                const tempMatch = data.match(/TEMP:([\d.]+)/);
                const humMatch = data.match(/HUM:([\d.]+)/);
                const lightMatch = data.match(/LIGHT:(\d+)/);
                const luxMatch = data.match(/LUX:([\d.]+)/);
                const distanceMatch = data.match(/DISTANCE:([\d.]+)/);
                
                let dataUpdated = false;
                
                if (tempMatch) {
                    const temp = parseFloat(tempMatch[1]);
                    if (!isNaN(temp) && temp >= -50 && temp <= 150) {
                        currentTemperature = temp;
                        updateSensorDisplay('temp-value', currentTemperature.toFixed(1) + '');
                        addToSensorHistory('temperature', currentTemperature);
                        dataUpdated = true;
                    }
                }
                
                if (humMatch) {
                    const hum = parseFloat(humMatch[1]);
                    if (!isNaN(hum) && hum >= 0 && hum <= 100) {
                        currentHumidity = hum;
                        updateSensorDisplay('humidity-value', Math.round(currentHumidity) + '');
                        addToSensorHistory('humidity', currentHumidity);
                        dataUpdated = true;
                    }
                }
                
                if (lightMatch) {
                    const light = parseInt(lightMatch[1]);
                    if (!isNaN(light) && light >= 0 && light <= 100000) {
                        currentLightLevel = light;
                        updateSensorDisplay('light-value', currentLightLevel.toString() + ' lux');
                        addToSensorHistory('light', currentLightLevel);
                        dataUpdated = true;
                    }
                }
                
                if (luxMatch) {
                    const lux = parseFloat(luxMatch[1]);
                    if (!isNaN(lux) && lux >= 0 && lux <= 100000) {
                        currentLux = lux;
                        updateSensorDisplay('lux-value', currentLux.toFixed(1) + ' lux');
                        addToSensorHistory('lux', currentLux);
                        dataUpdated = true;
                    }
                }
                
                if (distanceMatch) {
                    const dist = parseFloat(distanceMatch[1]);
                    if (!isNaN(dist) && dist >= 0 && dist <= 1000) {
                        currentDistance = dist;
                        updateSensorDisplay('distance-value', currentDistance.toFixed(1) + '');
                        addToSensorHistory('distance', currentDistance);
                        dataUpdated = true;
                    }
                }
                
                if (dataUpdated) {
                    updateDashboardStats();
                    updateCharts();
                }
            } catch (error) {
                console.error('Error processing sensor data:', error);
            }
        }

        function addToSensorHistory(type, value) {
            try {
                if (!sensorHistory[type] || !Array.isArray(sensorHistory[type])) return;
                if (isNaN(value)) return;
                
                const timestamp = Date.now();
                sensorHistory[type].push({
                    x: timestamp,
                    y: value
                });
                
                if (sensorHistory[type].length > 50) {
                    sensorHistory[type] = sensorHistory[type].slice(-50);
                }
            } catch (error) {
                console.error('Error adding to sensor history:', error);
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
            try {
                const chartElement = document.getElementById(chartId);
                if (!chartElement) return;
                if (!data || !Array.isArray(data)) return;

                if (data.length > 0) {
                    const latest = data[data.length - 1].y;
                    if (isNaN(latest)) return;
                    
                    const values = data.map(d => d.y).filter(v => !isNaN(v));
                    if (values.length === 0) return;
                    
                    const min = Math.min(...values).toFixed(1);
                    const max = Math.max(...values).toFixed(1);
                    const trend = data.length > 1 ? 
                        (latest > data[data.length - 2].y ? '↗️' : 
                         latest < data[data.length - 2].y ? '↘️' : '→') : '→';
                    
                    chartElement.innerHTML = `
                        <div style="text-align: center; padding: 15px; animation: fadeIn 0.5s ease;">
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
            } catch (error) {
                console.error('Error updating chart:', error);
            }
        }

        function updateSensorDisplay(elementId, value) {
            try {
                if (!elementId || !value) return;
                const element = document.getElementById(elementId);
                if (element) {
                    element.style.animation = 'pulse 0.3s ease';
                    element.textContent = value;
                    setTimeout(() => {
                        if (element) element.style.animation = '';
                    }, 300);
                }
            } catch (error) {
                console.error('Error updating sensor display:', error);
            }
        }

        function updateDashboardStats() {
            try {
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
                if (!isNaN(currentTemperature)) {
                    updateSensorDisplay('dashboard-temp', currentTemperature.toFixed(1) + '°C');
                }
                if (!isNaN(currentHumidity)) {
                    updateSensorDisplay('dashboard-humidity', Math.round(currentHumidity) + '%');
                }
                if (!isNaN(currentLightLevel)) {
                    updateSensorDisplay('dashboard-light', currentLightLevel.toString());
                }
            } catch (error) {
                console.error('Error updating dashboard stats:', error);
            }
        }

        function updateConnectionStatus(connected) {
            try {
                const statusElement = document.getElementById('status-text');
                const arduinoStatus = document.getElementById('arduino-status');
                const arduinoDetailStatus = document.getElementById('arduino-detail-status');
                const serverStatus = document.querySelector('.server-status');
                const lastPing = document.getElementById('last-ping');
                
                if (connected) {
                    if (statusElement) statusElement.textContent = "Arduino Online";
                    if (arduinoStatus) arduinoStatus.textContent = "Connected";
                    if (arduinoDetailStatus) {
                        arduinoDetailStatus.innerHTML = '<div class="status-indicator connected" style="animation: pulse 2s infinite"></div><span>Connected</span>';
                    }
                    if (serverStatus) {
                        serverStatus.style.background = "#1e40af";
                        serverStatus.style.animation = "pulse 2s infinite";
                    }
                    if (lastPing) lastPing.textContent = new Date().toLocaleTimeString();
                    const boardNameElement = document.querySelector('.hardware-info .info-item:nth-child(1) span:last-child');
                    if (boardNameElement) {
                        boardNameElement.textContent = "Arduino Uno R4 WiFi";
                    }
                } else {
                    if (statusElement) statusElement.textContent = "Arduino Offline";
                    if (arduinoStatus) arduinoStatus.textContent = "Disconnected";
                    if (arduinoDetailStatus) {
                        arduinoDetailStatus.innerHTML = '<div class="status-indicator disconnected"></div><span>Disconnected</span>';
                    }
                    if (serverStatus) {
                        serverStatus.style.background = "#ff4c4c";
                        serverStatus.style.animation = "none";
                    }
                    if (lastPing) lastPing.textContent = "--";
                    const boardNameElement = document.querySelector('.hardware-info .info-item:nth-child(1) span:last-child');
                    if (boardNameElement) {
                        boardNameElement.textContent = "--";
                    }
                }
            } catch (error) {
                console.error('Error updating connection status:', error);
            }
        }

        const connectBtn = document.getElementById('connect-arduino');
        if (connectBtn) {
            updateConnectButton();
            connectBtn.addEventListener('click', async (e) => {
                try {
                    const btn = e.target.closest('button') || e.target;
                    btn.style.animation = 'pulseEffect 0.5s ease';
                    setTimeout(() => {
                        if (btn) btn.style.animation = '';
                    }, 500);
                    
                    if (!isConnected) {
                        await connectToArduino();
                    } else {
                        await disconnectFromArduino();
                    }
                } catch (error) {
                    console.error('Error handling connect button:', error);
                }
            });
        }

        const angleSlider = document.getElementById('angle-slider');
        const angleValue = document.getElementById('angle-value');
        const presetAngleBtns = document.querySelectorAll('.preset-angle-btn');
        const servoArm = document.getElementById('servo-arm');

        function updateServoStatus() {
            try {
                if (isNaN(currentAngle) || currentAngle < 0 || currentAngle > 180) return;
                
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
            } catch (error) {
                console.error('Error updating servo status:', error);
            }
        }

        function updateServoVisualization() {
            try {
                if (!servoArm) return;
                if (isNaN(currentAngle) || currentAngle < 0 || currentAngle > 180) return;
                
                const rotation = currentAngle - 90;
                servoArm.style.transition = 'transform 0.5s ease';
                servoArm.style.transform = `rotate(${rotation}deg)`;
            } catch (error) {
                console.error('Error updating servo visualization:', error);
            }
        }

        presetAngleBtns.forEach(btn => {
            if (btn) {
                btn.addEventListener('click', async () => {
                    try {
                        if (!isConnected) {
                            showToast("Arduino not connected", "#ff4c4c");
                            return;
                        }
                        btn.style.animation = 'pulseEffect 0.3s ease';
                        setTimeout(() => {
                            if (btn) btn.style.animation = '';
                        }, 300);
                        
                        const angle = parseInt(btn.getAttribute('data-angle'));
                        if (isNaN(angle) || angle < 0 || angle > 180) return;
                        
                        currentAngle = angle;
                        if (angleSlider) angleSlider.value = angle;
                        updateServoVisualization();
                        if (angleValue) {
                            angleValue.textContent = `${currentAngle}°`;
                        }
                        const success = await writeToArduino(`SERVO:${currentAngle}`);
                        if (success) {
                            showToast(`Servo moving to ${currentAngle}°`, "#3b82f6");
                            await saveArduinoState({
                                servoAngle: currentAngle,
                                ledState: currentLedState,
                                isBlinking: isBlinking,
                                isConnected: true
                            });
                        }
                    } catch (error) {
                        console.error('Error handling preset angle:', error);
                    }
                });
            }
        });

        const positionBtns = document.querySelectorAll('.position-btn');
        positionBtns.forEach(btn => {
            if (btn) {
                btn.addEventListener('click', async () => {
                    try {
                        if (!isConnected) {
                            showToast("Arduino not connected", "#ff4c4c");
                            return;
                        }
                        btn.style.animation = 'pulseEffect 0.3s ease';
                        setTimeout(() => {
                            if (btn) btn.style.animation = '';
                        }, 300);
                        
                        const angle = parseInt(btn.getAttribute('data-angle'));
                        if (isNaN(angle) || angle < 0 || angle > 180) return;
                        
                        currentAngle = angle;
                        if (angleSlider) angleSlider.value = angle;
                        updateServoVisualization();
                        if (angleValue) {
                            angleValue.textContent = `${currentAngle}°`;
                        }
                        const success = await writeToArduino(`SERVO:${currentAngle}`);
                        if (success) {
                            showToast(`Servo moving to ${currentAngle}°`, "#3b82f6");
                            await saveArduinoState({
                                servoAngle: currentAngle,
                                ledState: currentLedState,
                                isBlinking: isBlinking,
                                isConnected: true
                            });
                        }
                    } catch (error) {
                        console.error('Error handling position button:', error);
                    }
                });
            }
        });

        if (angleSlider) {
            angleSlider.addEventListener('input', () => {
                try {
                    const angle = parseInt(angleSlider.value);
                    if (!isNaN(angle) && angle >= 0 && angle <= 180) {
                        currentAngle = angle;
                        updateServoVisualization();
                        if (angleValue) {
                            angleValue.textContent = `${currentAngle}°`;
                        }
                    }
                } catch (error) {
                    console.error('Error handling slider input:', error);
                }
            });

            angleSlider.addEventListener('mouseup', async () => {
                try {
                    if (!isConnected) return;
                    if (isNaN(currentAngle) || currentAngle < 0 || currentAngle > 180) return;
                    
                    const success = await writeToArduino(`SERVO:${currentAngle}`);
                    if (success) {
                        showToast(`Servo moving to ${currentAngle}°`, "#3b82f6");
                        await saveArduinoState({
                            servoAngle: currentAngle,
                            ledState: currentLedState,
                            isBlinking: isBlinking,
                            isConnected: true
                        });
                    }
                } catch (error) {
                    console.error('Error handling slider mouseup:', error);
                }
            });
        }

        const quickServo0 = document.getElementById('quick-servo-0');
        const quickServo90 = document.getElementById('quick-servo-90');
        const quickServo180 = document.getElementById('quick-servo-180');
        const quickLedOn = document.getElementById('quick-led-on');
        const quickLedOff = document.getElementById('quick-led-off');

        [quickServo0, quickServo90, quickServo180].forEach((btn, index) => {
            if (btn) {
                btn.addEventListener('click', async () => {
                    try {
                        if (!isConnected) {
                            showToast("Arduino not connected", "#ff4c4c");
                            return;
                        }
                        btn.style.animation = 'pulseEffect 0.3s ease';
                        setTimeout(() => {
                            if (btn) btn.style.animation = '';
                        }, 300);
                        
                        const angles = [0, 90, 180];
                        if (index < 0 || index >= angles.length) return;
                        
                        currentAngle = angles[index];
                        if (angleSlider) angleSlider.value = currentAngle;
                        updateServoVisualization();
                        if (angleValue) angleValue.textContent = `${currentAngle}°`;
                        
                        const success = await writeToArduino(`SERVO:${currentAngle}`);
                        if (success) {
                            showToast(`Servo moving to ${currentAngle}°`, "#3b82f6");
                            await saveArduinoState({
                                servoAngle: currentAngle,
                                ledState: currentLedState,
                                isBlinking: isBlinking,
                                isConnected: true
                            });
                        }
                    } catch (error) {
                        console.error('Error handling quick servo:', error);
                    }
                });
            }
        });

        if (quickLedOn) {
            quickLedOn.addEventListener('click', async () => {
                try {
                    if (!isConnected) {
                        showToast("Arduino not connected", "#ff4c4c");
                        return;
                    }
                    quickLedOn.style.animation = 'pulseEffect 0.3s ease';
                    setTimeout(() => {
                        if (quickLedOn) quickLedOn.style.animation = '';
                    }, 300);
                    
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
                        addLogEntry('LED turned ON', 'arduino', 'fa-lightbulb');
                    }
                } catch (error) {
                    console.error('Error handling quick LED on:', error);
                }
            });
        }

        if (quickLedOff) {
            quickLedOff.addEventListener('click', async () => {
                try {
                    if (!isConnected) {
                        showToast("Arduino not connected", "#ff4c4c");
                        return;
                    }
                    quickLedOff.style.animation = 'pulseEffect 0.3s ease';
                    setTimeout(() => {
                        if (quickLedOff) quickLedOff.style.animation = '';
                    }, 300);
                    
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
                        addLogEntry('LED turned OFF', 'arduino', 'fa-lightbulb');
                    }
                } catch (error) {
                    console.error('Error handling quick LED off:', error);
                }
            });
        }

        function updateLedVisualization(state) {
            try {
                if (!state || typeof state !== 'string') return;
                
                const ledBulb = document.getElementById('led-bulb');
                const ledModeText = document.getElementById('led-mode-text');
                const ledStatus = document.getElementById('led-status');
                const ledDetailStatus = document.getElementById('led-detail-status');
                
                if (!ledBulb) return;
                
                ledBulb.className = 'led-bulb';
                ledBulb.style.animation = '';
                
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
                        ledBulb.style.animation = 'blink 1s infinite';
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
                        statusIndicator.style.animation = 'pulse 2s infinite';
                    } else if (state === 'blink') {
                        statusIndicator.classList.add('blinking');
                        statusIndicator.style.animation = 'blink 1s infinite';
                    } else {
                        statusIndicator.classList.add('off');
                        statusIndicator.style.animation = 'none';
                    }
                }
            } catch (error) {
                console.error('Error updating LED visualization:', error);
            }
        }

        function updateBlinkButtons(blinking) {
            try {
                const patternBtns = document.querySelectorAll('.pattern-btn');
                patternBtns.forEach(btn => {
                    if (!btn) return;
                    if (blinking) {
                        btn.classList.add('active-blink');
                        const pattern = btn.getAttribute('data-pattern');
                        switch(pattern) {
                            case 'slow':
                                btn.style.animation = 'slowBlink 2s infinite';
                                break;
                            case 'fast':
                                btn.style.animation = 'fastBlink 0.5s infinite';
                                break;
                            case 'pulse':
                                btn.style.animation = 'pulse 1.5s infinite';
                                break;
                        }
                    } else {
                        btn.classList.remove('active-blink');
                        btn.style.animation = 'none';
                        const pattern = btn.getAttribute('data-pattern');
                        let icon = '', text = '';
                        switch(pattern) {
                            case 'slow': icon = 'fa-wave-square'; text = 'Slow Blink'; break;
                            case 'fast': icon = 'fa-bolt'; text = 'Fast Blink'; break;
                            case 'pulse': icon = 'fa-heart-pulse'; text = 'Pulse'; break;
                        }
                        if (icon && text) {
                            btn.innerHTML = `<i class="fa-solid ${icon}"></i> ${text}`;
                        }
                    }
                });
            } catch (error) {
                console.error('Error updating blink buttons:', error);
            }
        }

        const ledBlinkBtn = document.getElementById('led-blink-btn');
        const ledOnBtn = document.getElementById('led-on-btn');
        const ledOffBtn = document.getElementById('led-off-btn');

        const ledControlOnBtn = document.querySelector('.led-btn[data-state="on"]');
        const ledControlOffBtn = document.querySelector('.led-btn[data-state="off"]');

        if (ledOnBtn) {
            ledOnBtn.addEventListener('click', async () => {
                try {
                    if (!isConnected) {
                        showToast("Arduino not connected", "#ff4c4c");
                        return;
                    }
                    ledOnBtn.style.animation = 'pulseEffect 0.3s ease';
                    setTimeout(() => {
                        if (ledOnBtn) ledOnBtn.style.animation = '';
                    }, 300);
                    
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
                        addLogEntry('LED turned ON', 'arduino', 'fa-lightbulb');
                    }
                } catch (error) {
                    console.error('Error handling LED on:', error);
                }
            });
        }

        if (ledOffBtn) {
            ledOffBtn.addEventListener('click', async () => {
                try {
                    if (!isConnected) {
                        showToast("Arduino not connected", "#ff4c4c");
                        return;
                    }
                    ledOffBtn.style.animation = 'pulseEffect 0.3s ease';
                    setTimeout(() => {
                        if (ledOffBtn) ledOffBtn.style.animation = '';
                    }, 300);
                    
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
                        addLogEntry('LED turned OFF', 'arduino', 'fa-lightbulb');
                    }
                } catch (error) {
                    console.error('Error handling LED off:', error);
                }
            });
        }

        if (ledControlOnBtn) {
            ledControlOnBtn.addEventListener('click', async () => {
                try {
                    if (!isConnected) {
                        showToast("Arduino not connected", "#ff4c4c");
                        return;
                    }
                    ledControlOnBtn.style.animation = 'pulseEffect 0.3s ease';
                    setTimeout(() => {
                        if (ledControlOnBtn) ledControlOnBtn.style.animation = '';
                    }, 300);
                    
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
                        addLogEntry('LED turned ON', 'arduino', 'fa-lightbulb');
                    }
                } catch (error) {
                    console.error('Error handling LED control on:', error);
                }
            });
        }

        if (ledControlOffBtn) {
            ledControlOffBtn.addEventListener('click', async () => {
                try {
                    if (!isConnected) {
                        showToast("Arduino not connected", "#ff4c4c");
                        return;
                    }
                    ledControlOffBtn.style.animation = 'pulseEffect 0.3s ease';
                    setTimeout(() => {
                        if (ledControlOffBtn) ledControlOffBtn.style.animation = '';
                    }, 300);
                    
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
                        addLogEntry('LED turned OFF', 'arduino', 'fa-lightbulb');
                    }
                } catch (error) {
                    console.error('Error handling LED control off:', error);
                }
            });
        }
        
        if (ledBlinkBtn) {
            ledBlinkBtn.addEventListener('click', async () => {
                try {
                    if (!isConnected) {
                        showToast("Arduino not connected", "#ff4c4c");
                        return;
                    }
                    ledBlinkBtn.style.animation = 'pulseEffect 0.3s ease';
                    setTimeout(() => {
                        if (ledBlinkBtn) ledBlinkBtn.style.animation = '';
                    }, 300);
                    
                    const success = await writeToArduino('LED:BLINK');
                    if (success) {
                        currentLedState = 'blink';
                        isBlinking = true;
                        updateLedVisualization('blink');
                        await saveArduinoState({
                            servoAngle: currentAngle,
                            ledState: 'blink',
                            isBlinking: true,
                            isConnected: true
                        });
                        addLogEntry('LED blink started', 'arduino', 'fa-lightbulb');
                    }
                } catch (error) {
                    console.error('Error handling LED blink:', error);
                }
            });
        }
        
        const patternBtns = document.querySelectorAll('.pattern-btn');
        patternBtns.forEach(btn => {
            if (btn) {
                btn.addEventListener('click', async () => {
                    try {
                        if (!isConnected) {
                            showToast("Arduino not connected", "#ff4c4c");
                            return;
                        }
                        btn.style.animation = 'pulseEffect 0.3s ease';
                        setTimeout(() => {
                            if (btn) btn.style.animation = '';
                        }, 300);
                        
                        const pattern = btn.getAttribute('data-pattern');
                        if (!pattern) return;
                        
                        let command = 'LED:BLINK';
                        switch(pattern) {
                            case 'slow': command = 'LED:BLINK,SLOW'; break;
                            case 'fast': command = 'LED:BLINK,FAST'; break;
                            case 'pulse': command = 'LED:BLINK,PULSE'; break;
                        }
                        const success = await writeToArduino(command);
                        if (success) {
                            currentLedState = 'blink';
                            isBlinking = true;
                            updateLedVisualization('blink');
                            await saveArduinoState({
                                servoAngle: currentAngle,
                                ledState: 'blink',
                                isBlinking: true,
                                isConnected: true
                            });
                            addLogEntry(`LED ${pattern} pattern started`, 'arduino', 'fa-lightbulb');
                        }
                    } catch (error) {
                        console.error('Error handling pattern button:', error);
                    }
                });
            }
        });

        const applyCustomBlinkBtn = document.getElementById('apply-custom-blink');
        if (applyCustomBlinkBtn) {
            applyCustomBlinkBtn.addEventListener('click', async () => {
                try {
                    if (!isConnected) {
                        showToast("Arduino not connected", "#ff4c4c");
                        return;
                    }
                    applyCustomBlinkBtn.style.animation = 'pulseEffect 0.3s ease';
                    setTimeout(() => {
                        if (applyCustomBlinkBtn) applyCustomBlinkBtn.style.animation = '';
                    }, 300);
                    
                    const onTimeInput = document.getElementById('blink-on-time');
                    const offTimeInput = document.getElementById('blink-off-time');
                    if (!onTimeInput || !offTimeInput) return;
                    
                    let onTime = parseInt(onTimeInput.value) || 500;
                    let offTime = parseInt(offTimeInput.value) || 500;
                    
                    if (onTime < 100) onTime = 100;
                    if (onTime > 5000) onTime = 5000;
                    if (offTime < 100) offTime = 100;
                    if (offTime > 5000) offTime = 5000;
                    
                    const success = await writeToArduino(`LED:BLINK,CUSTOM,${onTime}`);
                    if (success) {
                        currentLedState = 'blink';
                        isBlinking = true;
                        updateLedVisualization('blink');
                        showToast(`Custom blink: ${onTime}ms interval`, "#3b82f6");
                        await saveArduinoState({
                            servoAngle: currentAngle,
                            ledState: 'blink',
                            isBlinking: true,
                            isConnected: true
                        });
                        addLogEntry(`LED custom blink pattern (${onTime}ms)`, 'arduino', 'fa-lightbulb');
                    }
                } catch (error) {
                    console.error('Error handling custom blink:', error);
                }
            });
        }

        setInterval(() => {
            try {
                const uptimeElement = document.getElementById('arduino-uptime');
                if (uptimeElement) {
                    if (isConnected && startTime) {
                        const uptime = Date.now() - startTime;
                        if (uptime > 0) {
                            const hours = Math.floor(uptime / (1000 * 60 * 60));
                            const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
                            const seconds = Math.floor((uptime % (1000 * 60)) / 1000);
                            uptimeElement.textContent = `${hours}h ${minutes}m ${seconds}s`;
                        }
                    } else {
                        uptimeElement.textContent = "--"; 
                    }
                }
            } catch (error) {
                console.error('Error updating uptime:', error);
            }
        }, 1000);

        document.addEventListener('visibilitychange', function() {
            if (!document.hidden && isConnected) {
                updateDashboardStats();
            }
        });

        setInterval(() => {
            try {
                if (isConnected && writer) {
                    updateDashboardStats();
                    writeToArduino('STATUS').catch(err => {
                        console.error('Status check error:', err);
                    });
                }
            } catch (error) {
                console.error('Error in status interval:', error);
            }
        }, 5000);

        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                try {
                    clearTimeout(searchTimeout);
                    const query = e.target.value.trim().toLowerCase();
                    searchTimeout = setTimeout(() => {
                        performSearch(query);
                    }, 300);
                } catch (error) {
                    console.error('Error handling search input:', error);
                }
            });
            
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    searchInput.value = '';
                    performSearch('');
                }
            });
        }

        function performSearch(query) {
            try {
                const logsList = document.getElementById('logs-list');
                if (!logsList) return;
                
                const logItems = document.querySelectorAll('#logs-list .activity-item');
                if (logItems.length === 0) return;
                
                if (!query || query.length === 0) {
                    logItems.forEach(item => {
                        if (item) {
                            const itemType = item.getAttribute('data-log-type') || 'all';
                            if (currentFilter === 'all' || itemType === currentFilter) {
                                item.style.display = 'flex';
                            } else {
                                item.style.display = 'none';
                            }
                        }
                    });
                    const noResults = logsList.querySelector('.no-results');
                    if (noResults) noResults.remove();
                    return;
                }

                let matchCount = 0;
                const searchQuery = query.toLowerCase().trim();
                
                logItems.forEach(item => {
                    if (!item) return;
                    const text = item.textContent.toLowerCase();
                    const itemType = item.getAttribute('data-log-type') || 'all';
                    const matchesFilter = currentFilter === 'all' || itemType === currentFilter;
                    const matchesSearch = text.includes(searchQuery);
                    
                    if (matchesSearch && matchesFilter) {
                        item.style.display = 'flex';
                        matchCount++;
                    } else {
                        item.style.display = 'none';
                    }
                });

                const existingNoResults = logsList.querySelector('.no-results');
                if (matchCount === 0 && searchQuery.length > 0) {
                    if (existingNoResults) {
                        existingNoResults.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> No results found for "${searchQuery}"`;
                    } else {
                        const noResults = document.createElement('div');
                        noResults.className = 'no-results';
                        noResults.style.cssText = 'text-align: center; padding: 30px; color: var(--text-muted); font-size: 14px;';
                        noResults.innerHTML = `<i class="fa-solid fa-magnifying-glass" style="font-size: 24px; margin-bottom: 10px; display: block; opacity: 0.5;"></i> No results found for "${searchQuery}"`;
                        logsList.appendChild(noResults);
                    }
                } else {
                    if (existingNoResults) existingNoResults.remove();
                }
            } catch (error) {
                console.error('Error performing search:', error);
            }
        }

        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            if (btn) {
                btn.addEventListener('click', () => {
                    try {
                        filterBtns.forEach(b => {
                            if (b) b.classList.remove('active');
                        });
                        btn.classList.add('active');
                        const filter = btn.getAttribute('data-filter');
                        if (filter) {
                            currentFilter = filter;
                            const searchInput = document.getElementById('search-input');
                            if (searchInput && searchInput.value.trim()) {
                                performSearch(searchInput.value.trim().toLowerCase());
                            } else {
                                filterLogs(currentFilter);
                            }
                        }
                    } catch (error) {
                        console.error('Error handling filter button:', error);
                    }
                });
            }
        });

        function filterLogs(filter) {
            try {
                if (!filter) return;
                const searchInput = document.getElementById('search-input');
                const searchQuery = searchInput && searchInput.value.trim() ? searchInput.value.trim().toLowerCase() : '';
                
                const logItems = document.querySelectorAll('#logs-list .activity-item');
                logItems.forEach(item => {
                    if (!item) return;
                    const itemType = item.getAttribute('data-log-type') || 'all';
                    const matchesFilter = filter === 'all' || itemType === filter;
                    
                    if (searchQuery) {
                        const text = item.textContent.toLowerCase();
                        const matchesSearch = text.includes(searchQuery);
                        item.style.display = (matchesFilter && matchesSearch) ? 'flex' : 'none';
                    } else {
                        item.style.display = matchesFilter ? 'flex' : 'none';
                    }
                });
                
                if (searchQuery) {
                    const visibleItems = Array.from(logItems).filter(item => item.style.display === 'flex');
                    const logsList = document.getElementById('logs-list');
                    if (visibleItems.length === 0 && logsList && !logsList.querySelector('.no-results')) {
                        const noResults = document.createElement('div');
                        noResults.className = 'no-results';
                        noResults.style.cssText = 'text-align: center; padding: 20px; color: var(--text-muted);';
                        noResults.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> No results found for "${searchQuery}"`;
                        logsList.appendChild(noResults);
                    } else {
                        const noResults = logsList?.querySelector('.no-results');
                        if (noResults) noResults.remove();
                    }
                } else {
                    const noResults = document.getElementById('logs-list')?.querySelector('.no-results');
                    if (noResults) noResults.remove();
                }
            } catch (error) {
                console.error('Error filtering logs:', error);
            }
        }

        function addLogEntry(message, type = 'system', icon = 'fa-circle-info') {
            try {
                if (!message || typeof message !== 'string') return;
                if (!type || typeof type !== 'string') type = 'system';
                if (!icon || typeof icon !== 'string') icon = 'fa-circle-info';
                
                const logsList = document.getElementById('logs-list');
                if (!logsList) return;
                
                const logItem = document.createElement('div');
                logItem.className = 'activity-item';
                logItem.setAttribute('data-log-type', type);
                const safeMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                logItem.innerHTML = `
                    <i class="fa-solid ${icon}"></i>
                    <span>${safeMessage}</span>
                    <small>${new Date().toLocaleTimeString()}</small>
                `;
                logsList.insertBefore(logItem, logsList.firstChild);
                
                logCounts.total++;
                if (type === 'arduino') logCounts.arduino++;
                else if (type === 'system') logCounts.system++;
                else if (type === 'admin') logCounts.admin++;
                
                const totalLogs = document.getElementById('total-logs');
                const arduinoLogs = document.getElementById('arduino-logs');
                const systemLogs = document.getElementById('system-logs');
                
                if (totalLogs) totalLogs.textContent = logCounts.total;
                if (arduinoLogs) arduinoLogs.textContent = logCounts.arduino;
                if (systemLogs) systemLogs.textContent = logCounts.system;
                
                while (logsList.children.length > 50) {
                    const lastChild = logsList.lastChild;
                    if (lastChild) {
                        const removedType = lastChild.getAttribute('data-log-type');
                        if (removedType === 'arduino' && logCounts.arduino > 0) logCounts.arduino--;
                        else if (removedType === 'system' && logCounts.system > 0) logCounts.system--;
                        else if (removedType === 'admin' && logCounts.admin > 0) logCounts.admin--;
                        if (logCounts.total > 0) logCounts.total--;
                        logsList.removeChild(lastChild);
                    } else {
                        break;
                    }
                }
                
                filterLogs(currentFilter);
            } catch (error) {
                console.error('Error adding log entry:', error);
            }
        }

        addLogEntry('System initialized', 'system', 'fa-circle-info');

        auth.onAuthStateChanged(async (user) => {
            try {
                if (user) {
                    currentUser = user;
                    if (user.email) {
                        const username = user.email.split('@')[0];
                        const usernameEl = document.querySelector('.username');
                        const avatarEl = document.querySelector('.user-avatar');
                        if (usernameEl) usernameEl.textContent = username;
                        if (avatarEl && username) avatarEl.textContent = username.charAt(0).toUpperCase();
                    }
                    initializeAdminManagement(user);
                    addLogEntry('User logged in', 'admin', 'fa-user');
                }
            } catch (error) {
                console.error('Error handling auth state change:', error);
            }
        });

        const logoutBtn = document.querySelector('.logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async (e) => {
                try {
                    e.preventDefault();
                    await auth.signOut();
                    showToast('Logged out successfully', '#3b82f6');
                    setTimeout(() => {
                        location.reload();
                    }, 500);
                } catch (error) {
                    console.error('Error logging out:', error);
                }
            });
        }

        function initializeAdminManagement(user) {
            currentUser = user;
            updateAdminInfo(user);
        }

        function updateAdminInfo(user) {
            try {
                if (!user) return;
                
                const currentAdminEmail = document.getElementById('current-admin-email');
                const accountCreatedDate = document.getElementById('account-created-date');
                const lastLoginDate = document.getElementById('last-login-date');
                
                if (currentAdminEmail && user.email) {
                    currentAdminEmail.textContent = user.email;
                }
                if (accountCreatedDate && user.metadata && user.metadata.creationTime) {
                    try {
                        const created = new Date(user.metadata.creationTime);
                        accountCreatedDate.textContent = created.toLocaleDateString();
                    } catch (e) {
                        accountCreatedDate.textContent = '--';
                    }
                }
                if (lastLoginDate && user.metadata && user.metadata.lastSignInTime) {
                    try {
                        const lastSignIn = new Date(user.metadata.lastSignInTime);
                        lastLoginDate.textContent = lastSignIn.toLocaleString();
                    } catch (e) {
                        lastLoginDate.textContent = '--';
                    }
                }
            } catch (error) {
                console.error('Error updating admin info:', error);
            }
        }

        const changePasswordBtn = document.getElementById('change-password-btn');
        if (changePasswordBtn) {
            changePasswordBtn.addEventListener('click', async () => {
                try {
                    const currentPasswordInput = document.getElementById('current-password');
                    const newPasswordInput = document.getElementById('new-password');
                    const confirmPasswordInput = document.getElementById('confirm-password');
                    
                    if (!currentPasswordInput || !newPasswordInput || !confirmPasswordInput) return;
                    
                    const currentPassword = currentPasswordInput.value;
                    const newPassword = newPasswordInput.value;
                    const confirmPassword = confirmPasswordInput.value;
                    
                    if (!currentPassword || !newPassword || !confirmPassword) {
                        showToast('Please fill all password fields', '#ff4c4c');
                        return;
                    }
                    if (newPassword.length < 6) {
                        showToast('New password must be at least 6 characters', '#ff4c4c');
                        return;
                    }
                    if (newPassword.length > 128) {
                        showToast('Password too long (max 128 characters)', '#ff4c4c');
                        return;
                    }
                    if (newPassword !== confirmPassword) {
                        showToast('New passwords do not match', '#ff4c4c');
                        return;
                    }
                    if (!currentUser || !currentUser.email) {
                        showToast('User not authenticated', '#ff4c4c');
                        return;
                    }
                    
                    changePasswordBtn.style.animation = 'pulseEffect 0.5s ease';
                    changePasswordBtn.disabled = true;
                    
                    const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, currentPassword);
                    await currentUser.reauthenticateWithCredential(credential);
                    await currentUser.updatePassword(newPassword);
                    
                    showToast('Password changed successfully', '#3b82f6');
                    addLogEntry('Password changed', 'admin', 'fa-key');
                    
                    currentPasswordInput.value = '';
                    newPasswordInput.value = '';
                    confirmPasswordInput.value = '';
                } catch (error) {
                    console.error('Password change error:', error);
                    let errorMessage = 'Error changing password';
                    if (error && error.code) {
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
                            case 'auth/network-request-failed':
                                errorMessage = 'Network error. Check connection';
                                break;
                        }
                    }
                    showToast(errorMessage, '#ff4c4c');
                } finally {
                    if (changePasswordBtn) {
                        changePasswordBtn.style.animation = '';
                        changePasswordBtn.disabled = false;
                    }
                }
            });
        }

        const deleteAccountBtn = document.getElementById('delete-account-btn');
        if (deleteAccountBtn) {
            deleteAccountBtn.addEventListener('click', async () => {
                try {
                    if (!confirm('Are you sure you want to delete your account? This action cannot be undone and all your data will be permanently lost.')) {
                        return;
                    }
                    const password = prompt('Please enter your password to confirm account deletion:');
                    if (!password || password.length === 0) return;
                    
                    if (!currentUser || !currentUser.email) {
                        showToast('User not authenticated', '#ff4c4c');
                        return;
                    }
                    
                    deleteAccountBtn.style.animation = 'pulse 0.5s ease';
                    deleteAccountBtn.disabled = true;
                    
                    const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, password);
                    await currentUser.reauthenticateWithCredential(credential);
                    await currentUser.delete();
                    
                    showToast('Account deleted successfully', '#3b82f6');
                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                } catch (error) {
                    console.error('Account deletion error:', error);
                    let errorMessage = 'Error deleting account';
                    if (error && error.code) {
                        switch(error.code) {
                            case 'auth/wrong-password':
                                errorMessage = 'Incorrect password';
                                break;
                            case 'auth/requires-recent-login':
                                errorMessage = 'Please re-login to delete account';
                                break;
                            case 'auth/network-request-failed':
                                errorMessage = 'Network error. Check connection';
                                break;
                        }
                    }
                    showToast(errorMessage, '#ff4c4c');
                    if (deleteAccountBtn) {
                        deleteAccountBtn.style.animation = '';
                        deleteAccountBtn.disabled = false;
                    }
                }
            });
        }

        updateCharts();
        
        window.addEventListener('beforeunload', () => {
            if (isConnected) {
                disconnectFromArduino();
            }
        });
        
        window.addEventListener('error', (event) => {
            console.error('Global error:', event.error);
            addLogEntry('Application error occurred', 'system', 'fa-circle-exclamation');
        });
    }
});
