// ===== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ =====
let socket = null;
let currentUser = null;
let token = null;
let chats = [];
let messages = {};
let currentChatId = null;
let activeTab = 'all';
let mediaRecorder = null;
let recordedChunks = [];
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let incomingCallData = null;

const settings = {
  darkMode: localStorage.getItem('swift_darkMode') === 'true',
  accentColor: localStorage.getItem('swift_accentColor') || 'blue'
};

const accentColors = {
  blue: '#5eb5f7',
  red: '#ff4444',
  green: '#44cc44',
  orange: '#ff8800',
  purple: '#9944ff',
  pink: '#ff44aa',
  cyan: '#44cccc',
  yellow: '#cccc00'
};

// ===== ИНИЦИАЛИЗАЦИЯ =====
function init() {
  applyTheme();
  applyAccentColor(settings.accentColor);
  
  token = localStorage.getItem('swift_token');
  currentUser = JSON.parse(localStorage.getItem('swift_user'));
  
  if (token && currentUser) {
    showMainApp();
    connectSocket();
    loadChats();
    setupPushNotifications();
  } else {
    showLoginScreen();
  }
}

// ===== PUSH УВЕДОМЛЕНИЯ =====
async function setupPushNotifications() {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array('YOUR_VAPID_PUBLIC_KEY')
      });
      
      await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ subscription })
      });
    } catch (err) {
      console.log('Push-уведомления недоступны');
    }
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  
  return outputArray;
}

// ===== АУТЕНТИФИКАЦИЯ =====
async function login() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  
  if (!username || !password) {
    alert('Введите имя пользователя и пароль');
    return;
  }
  
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (data.error) {
      alert(data.error);
      return;
    }
    
    token = data.token;
    currentUser = data.user;
    
    localStorage.setItem('swift_token', token);
    localStorage.setItem('swift_user', JSON.stringify(currentUser));
    
    showMainApp();
    connectSocket();
    loadChats();
    setupPushNotifications();
  } catch (err) {
    alert('Ошибка соединения с сервером');
  }
}

async function register() {
  const username = document.getElementById('regUsername').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const password = document.getElementById('regPassword').value.trim();
  const confirmPassword = document.getElementById('regConfirmPassword').value.trim();
  
  if (!username || !phone || !password) {
    alert('Заполните все поля');
    return;
  }
  
  if (password !== confirmPassword) {
    alert('Пароли не совпадают');
    return;
  }
  
  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, phone, password })
    });
    
    const data = await response.json();
    
    if (data.error) {
      alert(data.error);
      return;
    }
    
    token = data.token;
    currentUser = data.user;
    
    localStorage.setItem('swift_token', token);
    localStorage.setItem('swift_user', JSON.stringify(currentUser));
    
    showMainApp();
    connectSocket();
    loadChats();
    setupPushNotifications();
  } catch (err) {
    alert('Ошибка соединения с сервером');
  }
}

// ===== SOCKET.IO =====
function connectSocket() {
  socket = io();
  
  socket.on('connect', () => {
    socket.emit('userConnected', {
      userId: currentUser.id,
      username: currentUser.username
    });
  });
  
  socket.on('newMessage', (message) => {
    if (!messages[message.chatId]) {
      messages[message.chatId] = [];
    }
    
    messages[message.chatId].push(message);
    
    if (message.chatId === currentChatId) {
      renderMessages();
      markAsRead(message.chatId);
    }
    
    renderChats();
  });
  
  socket.on('userTyping', (data) => {
    if (data.chatId === currentChatId) {
      document.getElementById('typingIndicator').style.display = 'block';
      document.getElementById('typingIndicator').textContent = `${data.username} печатает...`;
    }
  });
  
  socket.on('userStoppedTyping', (data) => {
    if (data.chatId === currentChatId) {
      document.getElementById('typingIndicator').style.display = 'none';
    }
  });
  
  socket.on('userOnline', (data) => {
    console.log(`${data.username} онлайн`);
  });
  
  socket.on('userOffline', (data) => {
    console.log(`${data.username} офлайн`);
  });
  
  socket.on('incomingCall', (data) => {
    incomingCallData = data;
    document.getElementById('callModal').classList.add('active');
    document.getElementById('callTitle').textContent = 
      data.callType === 'video' ? '📹 Видеозвонок' : '📞 Звонок';
    document.getElementById('callStatus').textContent = `${data.from} звонит...`;
  });
  
  socket.on('callAccepted', (data) => {
    document.getElementById('callStatus').textContent = 'Соединение...';
    document.getElementById('endCallBtn').style.display = 'block';
  });
  
  socket.on('callRejected', () => {
    endCall();
    alert('Звонок отклонён');
  });
  
  socket.on('callEnded', () => {
    endCall();
  });
}

// ===== ОТПРАВКА СООБЩЕНИЙ =====
function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  
  if (!text || !currentChatId || !socket) return;
  
  socket.emit('sendMessage', {
    chatId: currentChatId,
    text,
    userId: currentUser.id,
    username: currentUser.username,
    type: 'text'
  });
  
  input.value = '';
}

function handleTyping() {
  if (socket && currentChatId) {
    socket.emit('typing', {
      chatId: currentChatId,
      username: currentUser.username
    });
  }
}

// ===== ЗАГРУЗКА ФАЙЛОВ =====
async function uploadFile(file) {
  if (!file || !currentChatId) return;
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    
    if (socket) {
      socket.emit('sendMessage', {
        chatId: currentChatId,
        text: file.name,
        userId: currentUser.id,
        username: currentUser.username,
        type: file.type.startsWith('image/') ? 'image' : 'file',
        fileUrl: data.url,
        fileName: data.name,
        fileSize: data.size
      });
    }
  } catch (err) {
    alert('Ошибка загрузки файла');
  }
}

// ===== ГОЛОСОВЫЕ СООБЩЕНИЯ =====
async function startRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    recordedChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      const file = new File([blob], 'voice-message.webm', { type: 'audio/webm' });
      await uploadFile(file);
      
      stream.getTracks().forEach(track => track.stop());
    };
    
    mediaRecorder.start();
    alert('Запись началась. Нажмите 🎤 снова для остановки');
  } catch (err) {
    alert('Ошибка доступа к микрофону');
  }
}

// ===== ВИДЕОЗВОНКИ =====
async function startCall(callType) {
  if (!currentChatId) return;
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video'
    });
    
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('localVideo').style.display = 'block';
    
    if (callType === 'video') {
      document.getElementById('remoteVideo').style.display = 'block';
    }
    
    document.getElementById('callModal').classList.add('active');
    document.getElementById('callTitle').textContent = 
      callType === 'video' ? '📹 Видеозвонок' : '📞 Звонок';
    document.getElementById('callStatus').textContent = 'Вызов...';
    
    // Здесь должна быть WebRTC сигнализация
    // Для простоты используем socket.io
    
    socket.emit('callUser', {
      targetUserId: getTargetUserId(),
      from: currentUser.username,
      fromUserId: currentUser.id,
      callType: callType
    });
  } catch (err) {
    alert('Ошибка доступа к камере/микрофону');
  }
}

function getTargetUserId() {
  const chat = chats.find(c => c.id === currentChatId);
  if (chat && chat.members) {
    const target = chat.members.find(m => m !== currentUser.username);
    return target || '';
  }
  return '';
}

function acceptCall() {
  if (incomingCallData) {
    document.getElementById('callStatus').textContent = 'Соединение...';
    document.getElementById('endCallBtn').style.display = 'block';
    
    socket.emit('answerCall', {
      targetUserId: incomingCallData.fromUserId,
      from: currentUser.username,
      signal: null
    });
  }
}

function rejectCall() {
  if (incomingCallData) {
    socket.emit('rejectCall', {
      targetUserId: incomingCallData.fromUserId,
      from: currentUser.username
    });
  }
  endCall();
}

function endCall() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  document.getElementById('localVideo').style.display = 'none';
  document.getElementById('remoteVideo').style.display = 'none';
  document.getElementById('callModal').classList.remove('active');
  document.getElementById('endCallBtn').style.display = 'none';
  
  incomingCallData = null;
}

// ===== ОТМЕТКА ПРОЧИТАНО =====
function markAsRead(chatId) {
  if (socket) {
    socket.emit('markAsRead', {
      chatId,
      userId: currentUser.id
    });
  }
}

// ===== ОТОБРАЖЕНИЕ =====
function renderChats() {
  const chatList = document.getElementById('chatList');
  chatList.innerHTML = '';
  
  let filteredChats = chats;
  
  if (activeTab === 'groups') filteredChats = chats.filter(c => c.type === 'group');
  if (activeTab === 'channels') filteredChats = chats.filter(c => c.type === 'channel');
  if (activeTab === 'personal') filteredChats = chats.filter(c => c.type === 'personal');
  
  filteredChats.forEach(chat => {
    const chatItem = document.createElement('div');
    chatItem.className = 'chat-item' + (currentChatId === chat.id ? ' active' : '');
    chatItem.onclick = () => openChat(chat.id);
    
    const lastMessage = messages[chat.id]?.slice(-1)[0];
    const preview = lastMessage ? 
      (lastMessage.type === 'image' ? '📷 Фото' : 
       lastMessage.type === 'file' ? '📎 Файл' : 
       lastMessage.type === 'audio' ? '🎤 Голосовое' : 
       lastMessage.text) : 'Нет сообщений';
    
    chatItem.innerHTML = `
      <div class="avatar">${chat.avatar || chat.name.charAt(0)}</div>
      <div class="chat-info">
        <div class="chat-name">${chat.name}</div>
        <div class="chat-preview">${preview}</div>
      </div>
    `;
    
    chatList.appendChild(chatItem);
  });
}

function renderMessages() {
  const container = document.getElementById('messagesContainer');
  container.innerHTML = '';
  
  if (!currentChatId) return;
  
  const chatMessages = messages[currentChatId] || [];
  
  chatMessages.forEach(msg => {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + (msg.senderId === currentUser.id ? 'outgoing' : 'incoming');
    
    let content = msg.text;
    
    if (msg.type === 'image') {
      content = `<img src="${msg.fileUrl}" style="max-width:100%; border-radius:8px;">`;
    } else if (msg.type === 'file') {
      content = `<a href="${msg.fileUrl}" download="${msg.fileName}" style="color:inherit;">📎 ${msg.fileName}</a>`;
    } else if (msg.type === 'audio') {
      content = `<audio controls src="${msg.fileUrl}" style="max-width:200px;"></audio>`;
    }
    
    const readStatus = msg.readBy?.length > 1 ? '✓✓' : '✓';
    
    messageDiv.innerHTML = `
      <div class="message-sender">${msg.sender}</div>
      ${content}
      <div class="message-time">
        ${new Date(msg.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        ${msg.senderId === currentUser.id ? readStatus : ''}
      </div>
    `;
    
    container.appendChild(messageDiv);
  });
  
  container.scrollTop = container.scrollHeight;
}

// ===== НАВИГАЦИЯ =====
function openChat(chatId) {
  currentChatId = chatId;
  renderChats();
  loadMessages(chatId);
  
  if (socket) {
    socket.emit('joinChat', { chatId, userId: currentUser.id });
  }
}

function switchTab(tab, element) {
  activeTab = tab;
  document.querySelectorAll('.sidebar-tab').forEach(el => el.classList.remove('active'));
  element.classList.add('active');
  renderChats();
}

// ===== ЗАГРУЗКА ДАННЫХ =====
async function loadChats() {
  try {
    const response = await fetch('/api/chats', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    chats = await response.json();
    renderChats();
  } catch (err) {
    console.error('Ошибка загрузки чатов:', err);
  }
}

async function loadMessages(chatId) {
  try {
    const response = await fetch(`/api/messages/${chatId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    messages[chatId] = await response.json();
    renderMessages();
  } catch (err) {
    console.error('Ошибка загрузки сообщений:', err);
  }
}

// ===== ТЕМА =====
function selectTheme(theme) {
  settings.darkMode = theme === 'dark';
  localStorage.setItem('swift_darkMode', settings.darkMode);
  applyTheme();
  
  document.getElementById('lightThemeBtn').classList.toggle('active', theme === 'light');
  document.getElementById('darkThemeBtn').classList.toggle('active', theme === 'dark');
}

function applyTheme() {
  if (settings.darkMode) {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
}

function selectColor(color, element) {
  settings.accentColor = color;
  localStorage.setItem('swift_accentColor', color);
  applyAccentColor(color);
  
  document.querySelectorAll('.color-option').forEach(el => el.classList.remove('active'));
  element.classList.add('active');
}

function applyAccentColor(color) {
  const accent = accentColors[color] || accentColors.blue;
  document.documentElement.style.setProperty('--accent', accent);
}

// ===== УТИЛИТЫ =====
function handleKeyPress(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('mainApp').style.display = 'none';
}

function showMainApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainApp').style.display = 'flex';
}

function showRegister() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'flex';
}

function showLogin() {
  document.getElementById('loginForm').style.display = 'flex';
  document.getElementById('registerForm').style.display = 'none';
}

function openSettings() {
  if (currentUser) {
    document.getElementById('usernameInput').value = currentUser.username || '';
    document.getElementById('bioInput').value = currentUser.bio || '';
  }
  document.getElementById('settingsModal').classList.add('active');
}

function saveSettings() {
  if (currentUser) {
    currentUser.username = document.getElementById('usernameInput').value || currentUser.username;
    currentUser.bio = document.getElementById('bioInput').value || '';
    localStorage.setItem('swift_user', JSON.stringify(currentUser));
  }
  document.getElementById('settingsModal').classList.remove('active');
}

function logout() {
  if (socket) socket.disconnect();
  socket = null;
  currentUser = null;
  token = null;
  localStorage.removeItem('swift_token');
  localStorage.removeItem('swift_user');
  document.getElementById('settingsModal').classList.remove('active');
  showLoginScreen();
}

function openCreateModal() {
  document.getElementById('createModal').classList.add('active');
}

function closeCreateModal() {
  document.getElementById('createModal').classList.remove('active');
}

function createChat() {
  const type = document.getElementById('createType').value;
  const name = document.getElementById('createName').value.trim();
  
  if (!name) {
    alert('Введите название');
    return;
  }
  
  if (socket) {
    socket.emit('createChat', {
      name,
      type,
      userId: currentUser.id,
      username: currentUser.username
    });
  }
  
  closeCreateModal();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('hidden');
}

function openModeration() {
  alert('Модерация доступна для групп и каналов');
}

// ===== ЗАПУСК =====
init();