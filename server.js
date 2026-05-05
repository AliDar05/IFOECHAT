const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 20e6
});

app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Firebase Admin Init ───────────────────────────────────────────
// GANTI JADI INI
const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
};
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ── Helper Firestore ──────────────────────────────────────────────
async function getUser(username) {
  const doc = await db.collection("users").doc(username.toLowerCase()).get();
  return doc.exists ? doc.data() : null;
}
async function saveUser(username, data) {
  await db.collection("users").doc(username.toLowerCase()).set(data);
}
async function getRoom(code) {
  const doc = await db.collection("rooms").doc(code.toUpperCase()).get();
  return doc.exists ? doc.data() : null;
}
async function saveRoom(code, data) {
  await db.collection("rooms").doc(code.toUpperCase()).set(data);
}
async function loadRoomMessages(roomCode) {
  const snap = await db.collection("messages")
    .where("roomCode", "==", roomCode)
    .orderBy("timestamp", "asc")
    .limitToLast(200)
    .get();
  return snap.docs.map(d => d.data());
}
async function saveRoomMessage(roomCode, msg) {
  await db.collection("messages").doc(String(msg.id)).set({ ...msg, roomCode });
}
async function deleteRoomMessage(msgId) {
  await db.collection("messages").doc(String(msgId)).delete();
}

// ── Hash password ─────────────────────────────────────────────────
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Serve static files ────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.use(express.static(path.join(__dirname, "public")));

// ── In-memory state ───────────────────────────────────────────────
const activeTokens = new Map();   // token → { username, avatar }
const onlineUsers  = new Map();   // socketId → { username, avatar, roomCode }
const roomUsers    = new Map();   // roomCode → Set of socketIds
const adminTokens  = new Map();   // adminToken → { username }

// ── Audit Log (in-memory + Firestore) ────────────────────────────
const auditLog = [];

async function writeAudit(adminUsername, action, target, description, reason = "") {
  const entry = {
    id: Date.now(),
    adminUsername,
    action,
    target,
    description,
    reason,
    timestamp: new Date().toISOString()
  };
  auditLog.unshift(entry);
  if (auditLog.length > 500) auditLog.pop(); // keep last 500 in memory
  try {
    await db.collection("audit_log").doc(String(entry.id)).set(entry);
  } catch (e) { console.error("Audit write error:", e); }
}

// ── Messages per Hour tracking ────────────────────────────────────
// Stores count for each hour slot [0..23] for the last 24h
const msgHourCounts = new Array(24).fill(0);
let msgHourBase = new Date().getHours(); // reset reference

function recordMessage() {
  const h = new Date().getHours();
  msgHourCounts[h] = (msgHourCounts[h] || 0) + 1;
}

// ── Admin Middleware ──────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: "Akses ditolak. Token admin tidak valid." });
  }
  req.adminUser = adminTokens.get(token);
  next();
}

// ═════════════════════════════════════════════════════════════════
// REST: Regular Routes
// ═════════════════════════════════════════════════════════════════

// Register
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username dan password wajib diisi" });

    const hashedPassword = hashPassword(password);

    // Cek apakah admin
    const adminDoc = await db.collection("admins").doc(username.toLowerCase()).get();
    if (adminDoc.exists) {
      const admin = adminDoc.data();
      if (admin.password !== hashedPassword) return res.status(401).json({ error: "Password salah" });

      const token = crypto.randomBytes(32).toString("hex");
      adminTokens.set(token, { username: admin.username });
      return res.json({ success: true, username: admin.username, isAdmin: true, token });
    }

    // Cek user biasa
    const user = await getUser(username);
    if (!user) return res.status(401).json({ error: "Username tidak ditemukan" });
    if (user.password !== hashedPassword) return res.status(401).json({ error: "Password salah" });

    if (user.banned) return res.status(403).json({ error: "Akun ini telah di-banned. Hubungi admin." });

    if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
      const until = new Date(user.suspendedUntil).toLocaleString("id-ID");
      return res.status(403).json({ error: `Akun disuspend hingga ${until}.` });
    }

    const token = crypto.randomBytes(32).toString("hex");
    activeTokens.set(token, { username: user.username, avatar: user.avatar });
    res.json({ success: true, username: user.username, avatar: user.avatar, isAdmin: false, token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Terjadi kesalahan server" });
  }
});
// Create Room
app.post("/api/rooms/create", async (req, res) => {
  try {
    const { name, token } = req.body;
    const userInfo = activeTokens.get(token);
    if (!userInfo) return res.status(401).json({ error: "Tidak terautentikasi" });

    let code;
    do { code = generateRoomCode(); } while (await getRoom(code));

    const roomData = {
      code,
      name: name || `Room ${code}`,
      createdBy: userInfo.username,
      createdAt: new Date().toISOString()
    };
    await saveRoom(code, roomData);
    res.json({ success: true, code, name: roomData.name });
  } catch (err) {
    console.error("Create room error:", err);
    res.status(500).json({ error: "Terjadi kesalahan server" });
  }
});

// Join Room
app.post("/api/rooms/join", async (req, res) => {
  try {
    const { code, token } = req.body;
    const userInfo = activeTokens.get(token);
    if (!userInfo) return res.status(401).json({ error: "Tidak terautentikasi" });

    const room = await getRoom(code?.toUpperCase());
    if (!room) return res.status(404).json({ error: "Room tidak ditemukan" });

    res.json({ success: true, code: room.code, name: room.name });
  } catch (err) {
    console.error("Join room error:", err);
    res.status(500).json({ error: "Terjadi kesalahan server" });
  }
});

// ═════════════════════════════════════════════════════════════════
// REST: ADMIN Routes
// ═════════════════════════════════════════════════════════════════

// Admin Login
app.post("/api/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username dan password wajib" });

    // Admin accounts are stored in Firestore under 'admins' collection
    const doc = await db.collection("admins").doc(username.toLowerCase()).get();
    if (!doc.exists) return res.status(401).json({ error: "Admin tidak ditemukan" });

    const admin = doc.data();
    if (admin.password !== hashPassword(password)) return res.status(401).json({ error: "Password salah" });

    const token = crypto.randomBytes(32).toString("hex");
    adminTokens.set(token, { username: admin.username });

    console.log(`[ADMIN] Login: ${admin.username}`);
    res.json({ success: true, username: admin.username, token });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: "Terjadi kesalahan server" });
  }
});

// Dashboard Stats
app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  try {
    // Count total users
    const usersSnap = await db.collection("users").get();
    const totalUsers = usersSnap.size;

    // Count total messages (last 24h)
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const msgsSnap = await db.collection("messages").orderBy("timestamp", "desc").limit(1000).get();
    const totalMessages = msgsSnap.size;

    // Active rooms (has users online)
    const activeRooms = roomUsers.size;

    // Online users count
    const onlineCount = onlineUsers.size;

    // Online user list with room info
    const onlineUserList = [];
    onlineUsers.forEach((u, sid) => {
      onlineUserList.push({ username: u.username, avatar: u.avatar, roomCode: u.roomCode });
    });

    // Messages per hour (24 slots)
    const msgPerHour = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: msgHourCounts[i] || 0
    }));

    // Recent audit (last 10)
    const recentAudit = auditLog.slice(0, 10);

    res.json({
      totalUsers,
      totalMessages,
      activeRooms,
      onlineUsers: onlineCount,
      onlineUserList,
      msgPerHour,
      recentAudit
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ error: "Gagal memuat dashboard" });
  }
});

// Audit Log
app.get("/api/admin/audit", requireAdmin, async (req, res) => {
  try {
    // Try Firestore first, fallback to in-memory
    const snap = await db.collection("audit_log")
      .orderBy("timestamp", "desc")
      .limit(200)
      .get();
    const logs = snap.docs.map(d => d.data());
    res.json({ logs });
  } catch (err) {
    res.json({ logs: auditLog });
  }
});

// Get All Users
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection("users").orderBy("createdAt", "desc").get();
    const users = snap.docs.map(d => {
      const u = d.data();
      return {
        username: u.username,
        createdAt: u.createdAt,
        banned: u.banned || false,
        suspendedUntil: u.suspendedUntil || null
      };
    });
    res.json({ users });
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ error: "Gagal memuat daftar user" });
  }
});

// Ban User
app.post("/api/admin/users/ban", requireAdmin, async (req, res) => {
  try {
    const { username, reason } = req.body;
    if (!username) return res.status(400).json({ error: "Username wajib" });

    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: "User tidak ditemukan" });

    await db.collection("users").doc(username.toLowerCase()).update({
      banned: true,
      bannedAt: new Date().toISOString(),
      bannedReason: reason || ""
    });

    // Disconnect the user if online
    kickUserFromSystem(username, "Akun Anda telah di-banned oleh admin.");

    await writeAudit(req.adminUser.username, "ban", username, `Mem-ban user ${username}`, reason || "");
    console.log(`[ADMIN] ${req.adminUser.username} banned ${username}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Ban error:", err);
    res.status(500).json({ error: "Gagal ban user" });
  }
});

// Unban User
app.post("/api/admin/users/unban", requireAdmin, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Username wajib" });

    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: "User tidak ditemukan" });

    await db.collection("users").doc(username.toLowerCase()).update({
      banned: false,
      bannedAt: null,
      bannedReason: null
    });

    await writeAudit(req.adminUser.username, "unban", username, `Meng-unban user ${username}`);
    console.log(`[ADMIN] ${req.adminUser.username} unbanned ${username}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Unban error:", err);
    res.status(500).json({ error: "Gagal unban user" });
  }
});

// Suspend User
app.post("/api/admin/users/suspend", requireAdmin, async (req, res) => {
  try {
    const { username, hours, reason } = req.body;
    if (!username || !hours) return res.status(400).json({ error: "Username dan durasi wajib" });

    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: "User tidak ditemukan" });

    const suspendedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    await db.collection("users").doc(username.toLowerCase()).update({
      suspendedUntil,
      suspendReason: reason || ""
    });

    // Disconnect if online
    kickUserFromSystem(username, `Akun Anda disuspend selama ${hours} jam oleh admin.`);

    await writeAudit(req.adminUser.username, "suspend", username,
      `Suspend user ${username} selama ${hours} jam`, reason || "");
    console.log(`[ADMIN] ${req.adminUser.username} suspended ${username} for ${hours}h`);
    res.json({ success: true, suspendedUntil });
  } catch (err) {
    console.error("Suspend error:", err);
    res.status(500).json({ error: "Gagal suspend user" });
  }
});

// Kick User from Room
app.post("/api/admin/users/kick", requireAdmin, async (req, res) => {
  try {
    const { username, reason } = req.body;
    if (!username) return res.status(400).json({ error: "Username wajib" });

    let kicked = false;
    onlineUsers.forEach((u, sid) => {
      if (u.username.toLowerCase() === username.toLowerCase()) {
        const socket = io.sockets.sockets.get(sid);
        if (socket) {
          socket.emit("admin:kicked", {
            message: reason || "Kamu telah di-kick dari room oleh admin."
          });
          leaveRoom(socket, u.roomCode, u.username);
          onlineUsers.delete(sid);
          kicked = true;
        }
      }
    });

    if (!kicked) return res.status(404).json({ error: "User tidak ditemukan dalam room manapun" });

    await writeAudit(req.adminUser.username, "kick", username,
      `Kick user ${username} dari room`, reason || "");
    console.log(`[ADMIN] ${req.adminUser.username} kicked ${username}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Kick error:", err);
    res.status(500).json({ error: "Gagal kick user" });
  }
});

// Get All Rooms
app.get("/api/admin/rooms", requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection("rooms").orderBy("createdAt", "desc").get();
    const rooms = snap.docs.map(d => {
      const r = d.data();
      // Count online users in this room
      const sockIds = roomUsers.get(r.code) || new Set();
      return {
        code: r.code,
        name: r.name,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        onlineCount: sockIds.size
      };
    });
    res.json({ rooms });
  } catch (err) {
    console.error("Get rooms error:", err);
    res.status(500).json({ error: "Gagal memuat daftar room" });
  }
});

// Delete Room (admin)
app.delete("/api/admin/rooms/:code", requireAdmin, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const room = await getRoom(code);
    if (!room) return res.status(404).json({ error: "Room tidak ditemukan" });

    // Kick everyone in the room
    const sockIds = roomUsers.get(code) || new Set();
    sockIds.forEach(sid => {
      const socket = io.sockets.sockets.get(sid);
      if (socket) {
        socket.emit("admin:room_deleted", { message: "Room ini telah dihapus oleh admin." });
        socket.leave(code);
        onlineUsers.delete(sid);
      }
    });
    roomUsers.delete(code);

    // Delete room doc
    await db.collection("rooms").doc(code).delete();

    // Delete all messages in this room
    const msgsSnap = await db.collection("messages").where("roomCode", "==", code).get();
    const batch = db.batch();
    msgsSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    await writeAudit(req.adminUser.username, "delete_room", code,
      `Menghapus room ${code} (${room.name})`);
    console.log(`[ADMIN] ${req.adminUser.username} deleted room ${code}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete room error:", err);
    res.status(500).json({ error: "Gagal hapus room" });
  }
});

// Get Messages (with filter)
app.get("/api/admin/messages", requireAdmin, async (req, res) => {
  try {
    const { roomCode, username } = req.query;
    let query = db.collection("messages").orderBy("timestamp", "desc").limit(100);

    if (roomCode) query = db.collection("messages")
      .where("roomCode", "==", roomCode.toUpperCase())
      .orderBy("timestamp", "desc")
      .limit(100);

    const snap = await query.get();
    let messages = snap.docs.map(d => d.data());

    if (username) {
      messages = messages.filter(m => m.username?.toLowerCase() === username.toLowerCase());
    }

    res.json({ messages });
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Gagal memuat pesan" });
  }
});

// Delete Message (admin — any room)
app.delete("/api/admin/messages/:msgId", requireAdmin, async (req, res) => {
  try {
    const { msgId } = req.params;

    // Get message info first for audit
    const msgDoc = await db.collection("messages").doc(String(msgId)).get();
    const msgData = msgDoc.exists ? msgDoc.data() : null;

    await deleteRoomMessage(msgId);

    // Broadcast deletion to room
    if (msgData?.roomCode) {
      io.to(msgData.roomCode).emit("chat:deleted", { msgId: String(msgId) });
    }

    await writeAudit(req.adminUser.username, "delete_msg", msgId,
      `Hapus pesan ${msgId}${msgData ? ` dari ${msgData.username} di room ${msgData.roomCode}` : ""}`);
    console.log(`[ADMIN] ${req.adminUser.username} deleted message ${msgId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Admin delete message error:", err);
    res.status(500).json({ error: "Gagal hapus pesan" });
  }
});

// ── Helper: kick user from entire system ─────────────────────────
function kickUserFromSystem(username, message) {
  onlineUsers.forEach((u, sid) => {
    if (u.username.toLowerCase() === username.toLowerCase()) {
      const socket = io.sockets.sockets.get(sid);
      if (socket) {
        socket.emit("admin:kicked", { message });
        leaveRoom(socket, u.roomCode, u.username);
        socket.disconnect(true);
      }
      onlineUsers.delete(sid);
    }
  });
  // Revoke their tokens
  activeTokens.forEach((v, k) => {
    if (v.username.toLowerCase() === username.toLowerCase()) activeTokens.delete(k);
  });
}

// ═════════════════════════════════════════════════════════════════
// Socket.io Logic
// ═════════════════════════════════════════════════════════════════
io.on("connection", (socket) => {
  console.log(`[+] Socket terhubung: ${socket.id}`);

  // 1. Join room
  socket.on("room:join", async ({ token, roomCode }) => {
    try {
      const userInfo = activeTokens.get(token);
      if (!userInfo) { socket.emit("error", { message: "Sesi tidak valid, silakan login ulang" }); return; }

      const room = await getRoom(roomCode);
      if (!room) { socket.emit("error", { message: "Room tidak ditemukan" }); return; }

      // Check ban/suspend again on join
      const user = await getUser(userInfo.username);
      if (user?.banned) {
        socket.emit("admin:kicked", { message: "Akun Anda telah di-banned." });
        activeTokens.delete(token);
        return;
      }
      if (user?.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
        socket.emit("admin:kicked", { message: "Akun Anda sedang disuspend." });
        activeTokens.delete(token);
        return;
      }

      const prevInfo = onlineUsers.get(socket.id);
      if (prevInfo?.roomCode) leaveRoom(socket, prevInfo.roomCode, prevInfo.username);

      onlineUsers.set(socket.id, { ...userInfo, roomCode });
      socket.join(roomCode);

      if (!roomUsers.has(roomCode)) roomUsers.set(roomCode, new Set());
      roomUsers.get(roomCode).add(socket.id);

      console.log(`[JOIN] ${userInfo.username} masuk room ${roomCode}`);

      const history = await loadRoomMessages(roomCode);
      socket.emit("messages:history", history);

      io.to(roomCode).emit("system:message", {
        text: `${userInfo.username} bergabung ke room`,
        timestamp: new Date().toISOString()
      });

      broadcastRoomUsers(roomCode);
    } catch (err) {
      console.error("room:join error:", err);
      socket.emit("error", { message: "Gagal masuk room" });
    }
  });

  // 2. Chat message
  socket.on("chat:message", async (data) => {
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

      await saveRoomMessage(userInfo.roomCode, msg);
      recordMessage();
      io.to(userInfo.roomCode).emit("chat:message", msg);
      console.log(`[MSG] ${userInfo.username}@${userInfo.roomCode}: ${data.text}`);
    } catch (err) {
      console.error("chat:message error:", err);
      socket.emit("error", { message: "Gagal mengirim pesan" });
    }
  });

  // 3. Share location
  socket.on("chat:location", async (data) => {
    try {
      const userInfo = onlineUsers.get(socket.id);
      if (!userInfo) return;
      const msg = {
        id: Date.now(),
        username: userInfo.username,
        avatar: userInfo.avatar,
        type: "location",
        location: { lat: data.lat, lng: data.lng, address: data.address || null },
        timestamp: new Date().toISOString()
      };
      await saveRoomMessage(userInfo.roomCode, msg);
      recordMessage();
      io.to(userInfo.roomCode).emit("chat:message", msg);
    } catch (err) {
      console.error("chat:location error:", err);
    }
  });

  // 3b. Send file
  socket.on("chat:file", async (data) => {
    try {
      const userInfo = onlineUsers.get(socket.id);
      if (!userInfo) return;
      if (!data.dataUrl || !data.name) return;
      if (data.dataUrl.length > 12 * 1024 * 1024) { socket.emit("error", { message: "File terlalu besar (maks 10MB)" }); return; }

      const msg = {
        id: Date.now(),
        username: userInfo.username,
        avatar: userInfo.avatar,
        type: "file",
        file: {
          name: data.name,
          size: data.size || 0,
          mimeType: data.mimeType || "application/octet-stream",
          dataUrl: data.dataUrl,
          caption: data.caption || ""
        },
        timestamp: new Date().toISOString()
      };
      await saveRoomMessage(userInfo.roomCode, msg);
      recordMessage();
      io.to(userInfo.roomCode).emit("chat:message", msg);
    } catch (err) {
      console.error("chat:file error:", err);
      socket.emit("error", { message: "Gagal mengirim file" });
    }
  });

  // 4. Typing indicator
  socket.on("chat:typing", (isTyping) => {
    const userInfo = onlineUsers.get(socket.id);
    if (!userInfo) return;
    socket.to(userInfo.roomCode).emit("chat:typing", { username: userInfo.username, isTyping });
  });

  // 5. Delete message (by user — own messages only)
  socket.on("chat:delete", async ({ msgId }) => {
    try {
      const userInfo = onlineUsers.get(socket.id);
      if (!userInfo) return;
      await deleteRoomMessage(msgId);
      io.to(userInfo.roomCode).emit("chat:deleted", { msgId: String(msgId) });
      console.log(`[DEL] ${userInfo.username} hapus pesan ${msgId}`);
    } catch (err) {
      console.error("chat:delete error:", err);
    }
  });

  // 6. Leave room
  socket.on("room:leave", () => {
    const userInfo = onlineUsers.get(socket.id);
    if (!userInfo) return;
    leaveRoom(socket, userInfo.roomCode, userInfo.username);
    onlineUsers.delete(socket.id);
  });

  // 7. Disconnect
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
  if (roomUsers.has(roomCode)) roomUsers.get(roomCode).delete(socket.id);
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
  console.log(`🛡️  Admin panel: http://localhost:${PORT}/admin.html`);
});