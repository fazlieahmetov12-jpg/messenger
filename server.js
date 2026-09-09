const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const CryptoJS = require('crypto-js');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'swift-messenger-secret-key';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'swift-messenger-encryption-key';

// Создание папок
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('data')) fs.mkdirSync('data');

// Файловая база данных
const DB_FILE = path.join(__dirname, 'data', 'database.json');
let db = { users: [], chats: [], messages: [] };

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Ошибка загрузки базы:', err);
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error('Ошибка сохранения базы:', err);
  }
}

loadDatabase();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Настройка multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.random().toString(36).substr(2, 9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function encryptMessage(text) {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

function decryptMessage(encryptedText) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    return encryptedText;
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Регистрация
app.post('/api/register', async (req, res) => {
  try {
    const { username, phone, password } = req.body;
    
    if (!username || !phone || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }
    
    const existingUser = db.users.find(u => u.username === username);
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = generateId();
    
    const user = {
      id: userId,
      username,
      phone,
      password: hashedPassword,
      bio: 'Привет! Я использую Swift Messenger',
      avatar: username.charAt(0).toUpperCase(),
      online: false,
      createdAt: new Date().toISOString()
    };
    
    db.users.push(user);
    
    const chat = {
      id: generateId(),
      name: 'Swift Bot',
      avatar: '🤖',
      type: 'personal',
      members: [username],
      isSystem: true,
      createdAt: new Date().toISOString()
    };
    
    db.chats.push(chat);
    
    const message = {
      id: generateId(),
      chatId: chat.id,
      text: encryptMessage(`Добро пожаловать, ${username}! 👋`),
      encrypted: true,
      sender: 'Swift Bot',
      senderId: 'bot',
      type: 'text',
      readBy: [],
      createdAt: new Date().toISOString()
    };
    
    db.messages.push(message);
    saveDatabase();
    
    const token = jwt.sign({ userId, username }, JWT_SECRET);
    
    res.json({ 
      token, 
      user: { id: userId, username, phone, bio: user.bio, avatar: user.avatar }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = db.users.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ error: 'Неверные данные' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Неверные данные' });
    }
    
    user.online = true;
    saveDatabase();
    
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
    
    res.json({ 
      token, 
      user: { id: user.id, username: user.username, phone: user.phone, bio: user.bio, avatar: user.avatar }
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение чатов
app.get('/api/chats', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => u.id === decoded.userId);
    
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
    
    const chats = db.chats.filter(chat => 
      chat.isSystem || 
      chat.type === 'group' || 
      chat.type === 'channel' ||
      chat.members?.includes(user.username)
    );
    
    res.json(chats);
  } catch (err) {
    res.status(401).json({ error: 'Неверный токен' });
  }
});

// Получение сообщений
app.get('/api/messages/:chatId', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    
    jwt.verify(token, JWT_SECRET);
    
    const messages = db.messages
      .filter(msg => msg.chatId === req.params.chatId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(-100);
    
    const decryptedMessages = messages.map(msg => ({
      ...msg,
      text: msg.encrypted ? decryptMessage(msg.text) : msg.text
    }));
    
    res.json(decryptedMessages);
  } catch (err) {
    res.status(401).json({ error: 'Неверный токен' });
  }
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);
  
  socket.on('userConnected', (data) => {
    const user = db.users.find(u => u.id === data.userId);
    if (user) {
      user.online = true;
      saveDatabase();
    }
    io.emit('userOnline', data);
  });
  
  socket.on('joinChat', (data) => {
    socket.join(data.chatId);
  });
  
  socket.on('sendMessage', (data) => {
    const { chatId, text, userId, username, type } = data;
    
    const message = {
      id: generateId(),
      chatId,
      text: type === 'text' ? encryptMessage(text) : text,
      encrypted: type === 'text',
      sender: username,
      senderId: userId,
      type: type || 'text',
      readBy: [userId],
      createdAt: new Date().toISOString()
    };
    
    db.messages.push(message);
    saveDatabase();
    
    const decryptedMessage = {
      ...message,
      text: message.encrypted ? decryptMessage(message.text) : message.text
    };
    
    io.to(chatId).emit('newMessage', decryptedMessage);
  });
  
  socket.on('typing', (data) => {
    socket.to(data.chatId).emit('userTyping', data);
  });
  
  socket.on('createChat', (data) => {
    const { name, type, userId, username } = data;
    
    const newChat = {
      id: generateId(),
      name,
      avatar: name.charAt(0).toUpperCase(),
      type: type || 'personal',
      members: [username],
      createdBy: userId,
      createdAt: new Date().toISOString()
    };
    
    db.chats.push(newChat);
    saveDatabase();
    
    io.emit('chatCreated', newChat);
  });
  
  socket.on('disconnect', () => {
    console.log('Отключение:', socket.id);
  });
});

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});