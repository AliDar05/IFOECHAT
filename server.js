const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6
});

app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ROOMS_FILE = path.join(DATA_DIR, "rooms.json");

// ── Pastikan folder & file data ada ──────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "{}");
if (!fs.existsSync(ROOMS_FILE)) fs.writeFileSync(ROOMS_FILE, "{}");

// ── Helper file ───────────────────────────────────────────────────
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch { return {}; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Hash password ─────────────────────────────────────────────────
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// ── Generate room code ────────────────────────────────────────────
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Get messages file for room ────────────────────────────────────
function getRoomMessagesFile(roomCode) {
  return path.join(DATA_DIR, `messages_${roomCode}.json`);
}

function loadRoomMessages(roomCode) {
  try {
    const file = getRoomMessagesFile(roomCode);
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch { return []; }
}

function saveRoomMessage(roomCode, msg) {
  try {
    const file = getRoomMessagesFile(roomCode);
    const messages = loadRoomMessages(roomCode);
    messages.push(msg);
    const trimmed = messages.slice(-200);
    fs.writeFileSync(file, JSON.stringify(trimmed, null, 2));
  } catch (err) {
    console.error("Error saving message:", err.message);
  }
}

// ── Serve static files ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── REST: Register ────────────────────────────────────────────────
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username dan password wajib diisi" });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: "Username harus 3-20 karakter" });
  if (password.length < 4) return res.status(400).json({ error: "Password minimal 4 karakter" });

  const users = readJSON(USERS_FILE);
  if (users[username.toLowerCase()]) return res.status(400).json({ error: "Username sudah digunakan" });

  users[username.toLowerCase()] = {
    username,
    password: hashPassword(password),
    createdAt: new Date().toISOString(),
    avatar: username.substring(0, 2).toUpperCase()
  };
  writeJSON(USERS_FILE, users);
  res.json({ success: true, username });
});

// ── REST: Login ───────────────────────────────────────────────────
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username dan password wajib diisi" });

  const users = readJSON(USERS_FILE);
  const user = users[username.toLowerCase()];
  if (!user) return res.status(401).json({ error: "Username tidak ditemukan" });
  if (user.password !== hashPassword(password)) return res.status(401).json({ error: "Password salah" });

  const token = crypto.randomBytes(32).toString("hex");
  // Simpan token sementara di memory
  activeTokens.set(token, { username: user.username, avatar: user.avatar });

  res.json({ success: true, username: user.username, avatar: user.avatar, token });
});

// ── REST: Create Room ─────────────────────────────────────────────
app.post("/api/rooms/create", (req, res) => {
  const { name, token } = req.body;
  const userInfo = activeTokens.get(token);
  if (!userInfo) return res.status(401).json({ error: "Tidak terautentikasi" });

  const rooms = readJSON(ROOMS_FILE);
  let code;
  do { code = generateRoomCode(); } while (rooms[code]);

  rooms[code] = {
    code,
    name: name || `Room ${code}`,
    createdBy: userInfo.username,
    createdAt: new Date().toISOString()
  };
  writeJSON(ROOMS_FILE, rooms);
  res.json({ success: true, code, name: rooms[code].name });
});

// ── REST: Join Room ───────────────────────────────────────────────
app.post("/api/rooms/join", (req, res) => {
  const { code, token } = req.body;
  const userInfo = activeTokens.get(token);
  if (!userInfo) return res.status(401).json({ error: "Tidak terautentikasi" });

  const rooms = readJSON(ROOMS_FILE);
  const room = rooms[code?.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room tidak ditemukan" });

  res.json({ success: true, code: room.code, name: room.name });
});

// ── In-memory state ───────────────────────────────────────────────
const activeTokens = new Map();      // token → { username, avatar }
const onlineUsers  = new Map();      // socketId → { username, avatar, roomCode }
const roomUsers    = new Map();      // roomCode → Set of socketIds

// ── Socket.io Logic ───────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[+] Socket terhubung: ${socket.id}`);

  // 1. Join room
  socket.on("room:join", ({ token, roomCode }) => {
    const userInfo = activeTokens.get(token);
    if (!userInfo) {
      socket.emit("error", { message: "Sesi tidak valid, silakan login ulang" });
      return;
    }

    const rooms = readJSON(ROOMS_FILE);
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("error", { message: "Room tidak ditemukan" });
      return;
    }

    // Leave room sebelumnya kalau ada
    const prevInfo = onlineUsers.get(socket.id);
    if (prevInfo?.roomCode) {
      leaveRoom(socket, prevInfo.roomCode, prevInfo.username);
    }

    onlineUsers.set(socket.id, { ...userInfo, roomCode });
    socket.join(roomCode);

    if (!roomUsers.has(roomCode)) roomUsers.set(roomCode, new Set());
    roomUsers.get(roomCode).add(socket.id);

    console.log(`[JOIN] ${userInfo.username} masuk room ${roomCode}`);

    // Kirim histori pesan
    socket.emit("messages:history", loadRoomMessages(roomCode));

    // Broadcast system message
    io.to(roomCode).emit("system:message", {
      text: `${userInfo.username} bergabung ke room 🎉`,
      timestamp: new Date().toISOString()
    });

    // Update online users di room ini
    broadcastRoomUsers(roomCode);
  });

  // 2. Chat message
  socket.on("chat:message", (data) => {
    try {
      const userInfo = onlineUsers.get(socket.id);
      if (!userInfo) return;

      const msg = {
        id: Date.now(),
        username: userInfo.username,
        avatar: userInfo.avatar,
        text: data.text,
        type: "text",
        timestamp: new Date().toISOString()
      };

      saveRoomMessage(userInfo.roomCode, msg);
      io.to(userInfo.roomCode).emit("chat:message", msg);
      console.log(`[MSG] ${userInfo.username}@${userInfo.roomCode}: ${data.text}`);
    } catch (err) {
      console.error("Error:", err.message);
      socket.emit("error", { message: "Gagal mengirim pesan" });
    }
  });

  // 3. Share location
  socket.on("chat:location", (data) => {
    try {
      const userInfo = onlineUsers.get(socket.id);
      if (!userInfo) return;

      const msg = {
        id: Date.now(),
        username: userInfo.username,
        avatar: userInfo.avatar,
        type: "location",
        location: {
          lat: data.lat,
          lng: data.lng,
          address: data.address || null
        },
        timestamp: new Date().toISOString()
      };

      saveRoomMessage(userInfo.roomCode, msg);
      io.to(userInfo.roomCode).emit("chat:message", msg);
    } catch (err) {
      console.error("Error:", err.message);
    }
  });

  // 4. Typing indicator
  socket.on("chat:typing", (isTyping) => {
    const userInfo = onlineUsers.get(socket.id);
    if (!userInfo) return;
    socket.to(userInfo.roomCode).emit("chat:typing", {
      username: userInfo.username,
      isTyping
    });
  });

  // 5. Disconnect
  socket.on("disconnect", () => {
    const userInfo = onlineUsers.get(socket.id);
    if (userInfo) {
      leaveRoom(socket, userInfo.roomCode, userInfo.username);
      onlineUsers.delete(socket.id);
    }
  });
});

function leaveRoom(socket, roomCode, username) {
  socket.leave(roomCode);
  if (roomUsers.has(roomCode)) {
    roomUsers.get(roomCode).delete(socket.id);
  }
  io.to(roomCode).emit("system:message", {
    text: `${username} meninggalkan room`,
    timestamp: new Date().toISOString()
  });
  broadcastRoomUsers(roomCode);
}

function broadcastRoomUsers(roomCode) {
  const socketIds = roomUsers.get(roomCode) || new Set();
  const users = [];
  socketIds.forEach(id => {
    const u = onlineUsers.get(id);
    if (u) users.push({ username: u.username, avatar: u.avatar });
  });
  io.to(roomCode).emit("users:online", users);
}

// ── Start server ──────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅ Server jalan di http://localhost:${PORT}`);
});