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
    let isServoMoving = false;
    let currentLedState = 'off';
    let logs = [];
    let currentFilter = 'all';
    let isUpdatingFromRemote = false;

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
        
        if (state.servoMoving !== undefined && state.servoMoving !== isServoMoving) {
            isServoMoving = state.servoMoving;
            updateServoStatus();
        }
        
        if (state.servoAngle !== undefined && state.servoAngle !== currentAngle) {
            currentAngle = state.servoAngle;
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
                boardNameElement.textContent = "Arduino Uno R3";
                boardNameEl.textContent = "Arduino Uno R3";
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
                
                readFromArduino();
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
            }
        }

        async function writeToArduino(data) {
            if (!isConnected || !writer) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return false;
            }
            try {
                await writer.write(data + '\n');
                console.log('Sent:', data);
                
                if (!isUpdatingFromRemote) {
                    await saveArduinoState({
                        lastCommand: data,
                        isConnected: true,
                        servoMoving: isServoMoving,
                        servoAngle: currentAngle,
                        ledState: currentLedState,
                        isBlinking: isBlinking
                    });
                }
                
                return true;
            } catch (error) {
                console.error('Write error:', error);
                return false;
            }
        }

        function processArduinoData(data) {
            console.log('Received:', data);
            
            if (data.includes('STATUS:READY') || data.includes('READY')) {
                updateConnectionStatus(true);
                updateDashboardStats();
            }
            else if (data.includes('LED:ON') || data.includes('LED_ON')) {
                isBlinking = false;
                currentLedState = 'on';
                updateLedVisualization('on');
                updateDashboardStats();
            }
            else if (data.includes('LED:OFF') || data.includes('LED_OFF')) {
                isBlinking = false;
                currentLedState = 'off';
                updateLedVisualization('off');
                updateDashboardStats();
            }
            else if (data.includes('LED:BLINK_STARTED')) {
                isBlinking = true;
                currentLedState = 'blink';
                updateLedVisualization('blink');
                updateDashboardStats();
            }
            else if (data.includes('MOVED:') || data.includes('ANGLE:')) {
                const angleMatch = data.match(/(MOVED|ANGLE):(\d+)/);
                if (angleMatch) {
                    currentAngle = parseInt(angleMatch[2]);
                    isServoMoving = false;
                    updateServoStatus();
                    updateServoVisualization();
                    updateDashboardStats();
                }
            }
            else if (data.includes('SERVO_STATUS:') || data.includes('STATUS:')) {
                const angleMatch = data.match(/(ANGLE|STATUS):(\d+)/);
                if (angleMatch) {
                    currentAngle = parseInt(angleMatch[2]);
                    updateServoStatus();
                    updateServoVisualization();
                    updateDashboardStats();
                }
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
        }

        function updateConnectionStatus(connected) {
            const statusElement = document.getElementById('status-text');
            const arduinoStatus = document.getElementById('arduino-status');
            const arduinoDetailStatus = document.getElementById('arduino-detail-status');
            const serverStatus = document.querySelector('.server-status');
            
            if (connected) {
                statusElement.textContent = "Arduino Online";
                arduinoStatus.textContent = "Connected";
                arduinoDetailStatus.innerHTML = '<div class="status-indicator connected"></div><span>Connected</span>';
                serverStatus.style.background = "#1f6e4d";
                document.getElementById('last-ping').textContent = new Date().toLocaleTimeString();
                
                const boardNameElement = document.querySelector('.hardware-info .info-item:nth-child(1) span:last-child');
                if (boardNameElement) {
                    boardNameElement.textContent = "Arduino Uno R3";
                }
            } else {
                statusElement.textContent = "Arduino Offline";
                arduinoStatus.textContent = "Disconnected";
                arduinoDetailStatus.innerHTML = '<div class="status-indicator disconnected"></div><span>Disconnected</span>';
                serverStatus.style.background = "#ff4c4c";
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

        const servoMoveBtn = document.getElementById('servo-move-btn');
        const servoStopBtn = document.getElementById('servo-stop-btn');
        const angleSlider = document.getElementById('angle-slider');
        const angleValue = document.getElementById('angle-value');
        const presetAngleBtns = document.querySelectorAll('.preset-angle-btn');
        const servoArm = document.getElementById('servo-arm');

        function updateServoStatus() {
            const servoStatus = document.getElementById('servo-status');
            const servoDetailStatus = document.getElementById('servo-detail-status');
            const servoStatusText = document.getElementById('servo-status-text');
            
            if (servoStatus) {
                servoStatus.textContent = `Stopped at ${currentAngle}°`;
            }
            if (servoDetailStatus) {
                servoDetailStatus.textContent = `Stopped at ${currentAngle}°`;
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

        function updateServoStatusFromArduino(data) {
            if (data.includes('SERVO_ANGLE:')) {
                const angleMatch = data.match(/SERVO_ANGLE:(\d+)/);
                if (angleMatch) {
                    currentAngle = parseInt(angleMatch[1]);
                    isServoMoving = false;
                    updateServoStatus();
                    updateServoVisualization();
                }
            }
            else if (data.includes('SERVO_ANGLE_SET:')) {
                const angleMatch = data.match(/SERVO_ANGLE_SET:(\d+)/);
                if (angleMatch) {
                    currentAngle = parseInt(angleMatch[1]);
                    isServoMoving = false;
                    updateServoStatus();
                    updateServoVisualization();
                }
            }
            else if (data.includes('SERVO:STOPPED')) {
                isServoMoving = false;
                updateServoStatus();
            }
        }

        servoMoveBtn?.addEventListener('click', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            
            isServoMoving = true;
            const success = await writeToArduino(`SERVO:ANGLE:${currentAngle}`);
            if (success) {
                showToast(`Servo moving to ${currentAngle}°`, "#4c82ff");
                addLog('arduino', `Servo moving to ${currentAngle}°`, 'servo');
                
                const servoStatus = document.getElementById('servo-status');
                const servoDetailStatus = document.getElementById('servo-detail-status');
                if (servoStatus) servoStatus.textContent = `Moving to ${currentAngle}°`;
                if (servoDetailStatus) servoDetailStatus.textContent = `Moving to ${currentAngle}°`;
                
                await saveArduinoState({
                    servoMoving: true,
                    servoAngle: currentAngle,
                    ledState: currentLedState,
                    isBlinking: isBlinking,
                    isConnected: true
                });
            }
        });

        servoStopBtn?.addEventListener('click', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            
            const success = await writeToArduino('SERVO:STOP');
            if (success) {
                isServoMoving = false;
                updateServoStatus();
                showToast("Servo stopped", "#4c82ff");
                addLog('arduino', 'Servo stopped', 'servo');
                
                await saveArduinoState({
                    servoMoving: false,
                    servoAngle: currentAngle,
                    ledState: currentLedState,
                    isBlinking: isBlinking,
                    isConnected: true
                });
            }
        });

        angleSlider?.addEventListener('input', () => {
            currentAngle = parseInt(angleSlider.value);
            updateServoVisualization();
            
            if (angleValue) {
                angleValue.textContent = `${currentAngle}°`;
            }
        });

        angleSlider?.addEventListener('change', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            
            const success = await writeToArduino(`SERVO:ANGLE:${currentAngle}`);
            if (success) {
                isServoMoving = true;
                showToast(`Servo moving to ${currentAngle}°`, "#4c82ff");
                addLog('arduino', `Servo angle changed to ${currentAngle}°`, 'servo');
                
                const servoStatus = document.getElementById('servo-status');
                const servoDetailStatus = document.getElementById('servo-detail-status');
                if (servoStatus) servoStatus.textContent = `Moving to ${currentAngle}°`;
                if (servoDetailStatus) servoDetailStatus.textContent = `Moving to ${currentAngle}°`;
                
                await saveArduinoState({
                    servoMoving: true,
                    servoAngle: currentAngle,
                    ledState: currentLedState,
                    isBlinking: isBlinking,
                    isConnected: true
                });
            }
        });

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
                
                const success = await writeToArduino(`SERVO:ANGLE:${currentAngle}`);
                if (success) {
                    isServoMoving = true;
                    showToast(`Servo moving to ${currentAngle}°`, "#4c82ff");
                    addLog('arduino', `Servo preset to ${currentAngle}°`, 'servo');
                    
                    const servoStatus = document.getElementById('servo-status');
                    const servoDetailStatus = document.getElementById('servo-detail-status');
                    if (servoStatus) servoStatus.textContent = `Moving to ${currentAngle}°`;
                    if (servoDetailStatus) servoDetailStatus.textContent = `Moving to ${currentAngle}°`;
                    
                    await saveArduinoState({
                        servoMoving: true,
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
                
                const success = await writeToArduino(`SERVO:ANGLE:${currentAngle}`);
                if (success) {
                    isServoMoving = true;
                    showToast(`Servo moving to ${currentAngle}°`, "#4c82ff");
                    addLog('arduino', `Servo moved to ${currentAngle}° from quick positions`, 'servo');
                    
                    const servoStatus = document.getElementById('servo-status');
                    const servoDetailStatus = document.getElementById('servo-detail-status');
                    if (servoStatus) servoStatus.textContent = `Moving to ${currentAngle}°`;
                    if (servoDetailStatus) servoDetailStatus.textContent = `Moving to ${currentAngle}°`;
                    
                    await saveArduinoState({
                        servoMoving: true,
                        servoAngle: currentAngle,
                        ledState: currentLedState,
                        isBlinking: isBlinking,
                        isConnected: true
                    });
                }
            });
        });

        const ledOnBtn = document.getElementById('led-on-btn');
        const ledOffBtn = document.getElementById('led-off-btn');
        const ledBlinkBtn = document.getElementById('led-blink-btn');
        const ledBtns = document.querySelectorAll('.led-btn');
        const patternBtns = document.querySelectorAll('.pattern-btn');
        const applyCustomBlinkBtn = document.getElementById('apply-custom-blink');

        function updateLedVisualization(state) {
            const ledBulb = document.getElementById('led-bulb');
            const ledModeText = document.getElementById('led-mode-text');
            const ledStatus = document.getElementById('led-status');
            const ledDetailStatus = document.getElementById('led-detail-status');
            
            ledBulb.className = 'led-bulb';
            
            switch(state) {
                case 'on':
                    ledBulb.classList.add('on');
                    ledModeText.textContent = 'ON';
                    ledStatus.textContent = 'On';
                    ledDetailStatus.textContent = 'On';
                    break;
                case 'off':
                    ledModeText.textContent = 'OFF';
                    ledStatus.textContent = 'Off';
                    ledDetailStatus.textContent = 'Off';
                    break;
                case 'blink':
                    ledBulb.classList.add('blink');
                    ledModeText.textContent = 'BLINK';
                    ledStatus.textContent = 'Blinking';
                    ledDetailStatus.textContent = 'Blinking';
                    break;
            }
            
            const statusIndicator = ledDetailStatus.parentElement.querySelector('.status-indicator');
            statusIndicator.className = 'status-indicator';
            
            if (state === 'on') {
                statusIndicator.classList.add('on');
            } else if (state === 'blink') {
                statusIndicator.classList.add('blinking');
            } else {
                statusIndicator.classList.add('off');
            }
        }

        function updateBlinkButtons(blinking) {
            patternBtns.forEach(btn => {
                if (blinking) {
                    btn.classList.add('active-blink');
                    const pattern = btn.getAttribute('data-pattern');
                    btn.innerHTML = `<i class="fa-solid fa-stop"></i> Stop ${pattern}`;
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

        ledOnBtn?.addEventListener('click', () => {
            currentLedState = 'on';
            updateLedVisualization('on');
            writeToArduino('LED:ON');
        });

        ledOffBtn?.addEventListener('click', () => {
            currentLedState = 'off';
            updateLedVisualization('off');
            writeToArduino('LED:OFF');
        });

        ledBlinkBtn?.addEventListener('click', () => {
            if (isBlinking) {
                currentLedState = 'off';
                updateLedVisualization('off');
                writeToArduino('LED:OFF');
            } else {
                currentLedState = 'blink';
                updateLedVisualization('blink');
                writeToArduino('LED:BLINK');
            }
        });

        ledBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const state = btn.getAttribute('data-state');
                currentLedState = state;
                updateLedVisualization(state);
                writeToArduino(`LED:${state.toUpperCase()}`);
            });
        });

        patternBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (isBlinking) {
                    currentLedState = 'off';
                    updateLedVisualization('off');
                    writeToArduino('LED:OFF');
                    return;
                }
                
                const pattern = btn.getAttribute('data-pattern');
                currentLedState = 'blink';
                updateLedVisualization('blink');
                
                let onTime, offTime;
                switch(pattern) {
                    case 'slow': onTime = 1000; offTime = 1000; break;
                    case 'fast': onTime = 200; offTime = 200; break;
                    case 'pulse': onTime = 100; offTime = 500; break;
                    default: onTime = 500; offTime = 500;
                }
                writeToArduino(`LED:BLINK,CUSTOM,ON:${onTime},OFF:${offTime}`);
            });
        });

        applyCustomBlinkBtn?.addEventListener('click', () => {
            const onTime = document.getElementById('blink-on-time').value || 500;
            const offTime = document.getElementById('blink-off-time').value || 500;
            currentLedState = 'blink';
            updateLedVisualization('blink');
            writeToArduino(`LED:BLINK,CUSTOM,ON:${onTime},OFF:${offTime}`);
            showToast(`Custom blink: ${onTime}ms on, ${offTime}ms off`, "#4c82ff");
        });

        const quickServo0 = document.getElementById('quick-servo-0');
        const quickServo90 = document.getElementById('quick-servo-90');
        const quickServo180 = document.getElementById('quick-servo-180');
        const quickLedOn = document.getElementById('quick-led-on');
        const quickLedOff = document.getElementById('quick-led-off');

        quickServo0?.addEventListener('click', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            
            currentAngle = 0;
            const success = await writeToArduino(`SERVO:ANGLE:${currentAngle}`);
            if (success) {
                isServoMoving = true;
                showToast("Servo moving to 0°", "#4c82ff");
                addLog('arduino', 'Servo moved to 0° from quick actions', 'servo');
                
                const servoStatus = document.getElementById('servo-status');
                const servoDetailStatus = document.getElementById('servo-detail-status');
                if (servoStatus) servoStatus.textContent = `Moving to ${currentAngle}°`;
                if (servoDetailStatus) servoDetailStatus.textContent = `Moving to ${currentAngle}°`;
                
                await saveArduinoState({
                    servoMoving: true,
                    servoAngle: currentAngle,
                    ledState: currentLedState,
                    isBlinking: isBlinking,
                    isConnected: true
                });
            }
        });

        quickServo90?.addEventListener('click', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            
            currentAngle = 90;
            const success = await writeToArduino(`SERVO:ANGLE:${currentAngle}`);
            if (success) {
                isServoMoving = true;
                showToast("Servo moving to 90°", "#4c82ff");
                addLog('arduino', 'Servo moved to 90° from quick actions', 'servo');
                
                const servoStatus = document.getElementById('servo-status');
                const servoDetailStatus = document.getElementById('servo-detail-status');
                if (servoStatus) servoStatus.textContent = `Moving to ${currentAngle}°`;
                if (servoDetailStatus) servoDetailStatus.textContent = `Moving to ${currentAngle}°`;
                
                await saveArduinoState({
                    servoMoving: true,
                    servoAngle: currentAngle,
                    ledState: currentLedState,
                    isBlinking: isBlinking,
                    isConnected: true
                });
            }
        });

        quickServo180?.addEventListener('click', async () => {
            if (!isConnected) {
                showToast("❌ Arduino not connected", "#ff4c4c");
                return;
            }
            
            currentAngle = 180;
            const success = await writeToArduino(`SERVO:ANGLE:${currentAngle}`);
            if (success) {
                isServoMoving = true;
                showToast("Servo moving to 180°", "#4c82ff");
                addLog('arduino', 'Servo moved to 180° from quick actions', 'servo');
                
                const servoStatus = document.getElementById('servo-status');
                const servoDetailStatus = document.getElementById('servo-detail-status');
                if (servoStatus) servoStatus.textContent = `Moving to ${currentAngle}°`;
                if (servoDetailStatus) servoDetailStatus.textContent = `Moving to ${currentAngle}°`;
                
                await saveArduinoState({
                    servoMoving: true,
                    servoAngle: currentAngle,
                    ledState: currentLedState,
                    isBlinking: isBlinking,
                    isConnected: true
                });
            }
        });

        quickLedOn?.addEventListener('click', () => {
            currentLedState = 'on';
            updateLedVisualization('on');
            writeToArduino('LED:ON');
        });

        quickLedOff?.addEventListener('click', () => {
            currentLedState = 'off';
            updateLedVisualization('off');
            writeToArduino('LED:OFF');
        });

        function updateSensorData(data) {
            const tempMatch = data.match(/TEMP:([\d.]+)/);
            const humMatch = data.match(/HUM:([\d.]+)/);
            const lightMatch = data.match(/LIGHT:(\d+)/);
            
            if (tempMatch) document.getElementById('temp-value').textContent = tempMatch[1];
            if (humMatch) document.getElementById('humidity-value').textContent = Math.round(humMatch[1]);
            if (lightMatch) document.getElementById('light-value').textContent = lightMatch[1];
        }

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
        }, 500);

        const logsList = document.getElementById('logs-list');
        const filterBtns = document.querySelectorAll('.filter-btn');
        const totalLogsElement = document.getElementById('total-logs');
        const arduinoLogsElement = document.getElementById('arduino-logs');
        const systemLogsElement = document.getElementById('system-logs');

        function initializeLogs() {
            addLog('system', 'System initialized', 'info');
            updateLogStatistics();
        }

        function addLog(type, message, iconType = 'info') {
            const timestamp = new Date().toLocaleTimeString();
            const log = {
                id: Date.now(),
                type: type,
                message: message,
                iconType: iconType,
                timestamp: timestamp,
                date: new Date().toISOString()
            };
            
            logs.unshift(log);
            
            if (logs.length > 100) {
                logs = logs.slice(0, 100);
            }
            
            updateLogsDisplay();
            updateLogStatistics();
            
            if (currentUser) {
                saveLogToFirebase(log);
            }
        }

        function updateLogsDisplay() {
            if (!logsList) return;
            
            const filteredLogs = currentFilter === 'all' 
                ? logs 
                : logs.filter(log => log.type === currentFilter);
            
            logsList.innerHTML = '';
            
            filteredLogs.forEach(log => {
                const logItem = document.createElement('div');
                logItem.className = 'activity-item';
                logItem.innerHTML = `
                    <i class="fa-solid fa-${getLogIcon(log.iconType)}"></i>
                    <span>${log.message}</span>
                    <small>${log.timestamp}</small>
                `;
                logsList.appendChild(logItem);
            });
        }

        function getLogIcon(iconType) {
            const icons = {
                'info': 'circle-info',
                'success': 'circle-check',
                'warning': 'triangle-exclamation',
                'error': 'circle-exclamation',
                'arduino': 'microchip',
                'servo': 'gear',
                'led': 'lightbulb',
                'user': 'user'
            };
            return icons[iconType] || 'circle-info';
        }

        function updateLogStatistics() {
            if (!totalLogsElement) return;
            
            const totalLogs = logs.length;
            const arduinoLogs = logs.filter(log => log.type === 'arduino').length;
            const systemLogs = logs.filter(log => log.type === 'system').length;
            
            totalLogsElement.textContent = totalLogs;
            arduinoLogsElement.textContent = arduinoLogs;
            systemLogsElement.textContent = systemLogs;
        }

        async function saveLogToFirebase(log) {
            try {
                await db.collection('logs').add({
                    ...log,
                    userId: currentUser.uid,
                    userEmail: currentUser.email
                });
            } catch (error) {
                console.error('Error saving log to Firebase:', error);
            }
        }

        async function loadLogsFromFirebase() {
            if (!currentUser) return;
            
            try {
                const snapshot = await db.collection('logs')
                    .where('userId', '==', currentUser.uid)
                    .orderBy('date', 'desc')
                    .limit(50)
                    .get();
                
                snapshot.forEach(doc => {
                    const log = doc.data();
                    if (!logs.find(existingLog => existingLog.id === log.id)) {
                        logs.push(log);
                    }
                });
                
                updateLogsDisplay();
                updateLogStatistics();
            } catch (error) {
                console.error('Error loading logs from Firebase:', error);
            }
        }

        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.getAttribute('data-filter');
                updateLogsDisplay();
            });
        });

        const originalConnectToArduino = connectToArduino;
        connectToArduino = async function() {
            try {
                addLog('system', 'Attempting to connect to Arduino...', 'info');
                await originalConnectToArduino();
                addLog('arduino', 'Arduino connected successfully', 'success');
            } catch (error) {
                addLog('system', 'Failed to connect to Arduino', 'error');
            }
        };

        const originalDisconnectFromArduino = disconnectFromArduino;
        disconnectFromArduino = async function() {
            addLog('arduino', 'Arduino disconnected', 'info');
            await originalDisconnectFromArduino();
        };

        if (servoMoveBtn) {
            servoMoveBtn.addEventListener('click', () => {
                addLog('arduino', `Servo moving to ${currentAngle}°`, 'servo');
            });
        }

        if (servoStopBtn) {
            servoStopBtn.addEventListener('click', () => {
                addLog('arduino', 'Servo stopped', 'servo');
            });
        }

        if (ledOnBtn) {
            ledOnBtn.addEventListener('click', () => {
                addLog('arduino', 'LED turned ON', 'led');
            });
        }

        if (ledOffBtn) {
            ledOffBtn.addEventListener('click', () => {
                addLog('arduino', 'LED turned OFF', 'led');
            });
        }

        if (ledBlinkBtn) {
            ledBlinkBtn.addEventListener('click', () => {
                if (isBlinking) {
                    addLog('arduino', 'LED blinking stopped', 'led');
                } else {
                    addLog('arduino', 'LED blinking started', 'led');
                }
            });
        }

        patternBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const pattern = btn.getAttribute('data-pattern');
                addLog('arduino', `LED ${pattern} blink pattern started`, 'led');
            });
        });

        if (applyCustomBlinkBtn) {
            applyCustomBlinkBtn.addEventListener('click', () => {
                const onTime = document.getElementById('blink-on-time').value || 500;
                const offTime = document.getElementById('blink-off-time').value || 500;
                addLog('arduino', `Custom blink pattern applied (ON: ${onTime}ms, OFF: ${offTime}ms)`, 'led');
            });
        }

        if (quickServo0) {
            quickServo0.addEventListener('click', () => {
                addLog('arduino', 'Servo moved to 0° from quick actions', 'servo');
            });
        }

        if (quickServo90) {
            quickServo90.addEventListener('click', () => {
                addLog('arduino', 'Servo moved to 90° from quick actions', 'servo');
            });
        }

        if (quickServo180) {
            quickServo180.addEventListener('click', () => {
                addLog('arduino', 'Servo moved to 180° from quick actions', 'servo');
            });
        }

        if (quickLedOn) {
            quickLedOn.addEventListener('click', () => {
                addLog('arduino', 'LED turned ON from quick actions', 'led');
            });
        }

        if (quickLedOff) {
            quickLedOff.addEventListener('click', () => {
                addLog('arduino', 'LED turned OFF from quick actions', 'led');
            });
        }

        if (angleSlider) {
            angleSlider.addEventListener('change', () => {
                addLog('arduino', `Servo angle changed to ${currentAngle}°`, 'servo');
            });
        }

        presetAngleBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const angle = parseInt(btn.getAttribute('data-angle'));
                addLog('arduino', `Servo angle preset to ${angle}°`, 'servo');
            });
        });

        auth.onAuthStateChanged(async (user) => {
            if (user) {
                currentUser = user;
                const username = user.email.split('@')[0];
                document.querySelector('.username').textContent = username;
                document.querySelector('.user-avatar').textContent = username.charAt(0).toUpperCase();
                
                addLog('system', `User ${user.email} logged in`, 'user');
                await loadLogsFromFirebase();
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
                addLog('system', 'Attempting to change password', 'user');
                
                const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, currentPassword);
                await currentUser.reauthenticateWithCredential(credential);
                
                await currentUser.updatePassword(newPassword);
                
                showToast('Password changed successfully', '#4c82ff');
                addLog('system', 'Password changed successfully', 'success');
                
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
                addLog('system', `Failed to change password: ${errorMessage}`, 'error');
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
                addLog('system', 'Account deletion requested', 'warning');
                
                const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, password);
                await currentUser.reauthenticateWithCredential(credential);
                
                await currentUser.delete();
                
                showToast('Account deleted successfully', '#4c82ff');
                addLog('system', 'Account deleted', 'error');
                
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
                addLog('system', `Failed to delete account: ${errorMessage}`, 'error');
            }
        });

        initializeLogs();
    }
});
