// ══════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════
let myUsername  = '';
let myAvatar    = '';
let myToken     = '';
let myRoomCode  = '';
let myRoomName  = '';

let typingTimer    = null;
let isTyping       = false;
let activeTypers   = new Set();

// Restore session
try {
  const saved = JSON.parse(sessionStorage.getItem('nexchat_session') || 'null');
  if (saved?.token) {
    myUsername = saved.username;
    myAvatar   = saved.avatar;
    myToken    = saved.token;
  }
} catch {}

// ══════════════════════════════════════════════════════════════════
// SOCKET
// ══════════════════════════════════════════════════════════════════
const socket = io({ autoConnect: true });

// ══════════════════════════════════════════════════════════════════
// DOM REFS
// ══════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

// screens
const authScreen = $('auth-screen');
const roomScreen = $('room-screen');
const chatScreen = $('chat-screen');

// auth
const loginForm        = $('login-form');
const registerForm     = $('register-form');
const loginUsername    = $('login-username');
const loginPassword    = $('login-password');
const loginError       = $('login-error');
const loginBtn         = $('login-btn');
const regUsername      = $('reg-username');
const regPassword      = $('reg-password');
const regConfirm       = $('reg-confirm');
const regError         = $('reg-error');
const registerBtn      = $('register-btn');

// room
const roomWelcome      = $('room-welcome');
const roomAvatar       = $('room-avatar');
const logoutBtn        = $('logout-btn');
const roomNameInput    = $('room-name-input');
const createRoomBtn    = $('create-room-btn');
const createError      = $('create-error');
const roomCodeInput    = $('room-code-input');
const joinRoomBtn      = $('join-room-btn');
const joinError        = $('join-error');

// chat
const sidebar          = $('sidebar');
const sidebarToggle    = $('sidebar-toggle');
const sidebarRoomName  = $('sidebar-room-name');
const sidebarRoomCode  = $('sidebar-room-code');
const sidebarUsername  = $('sidebar-username');
const sidebarAvatar    = $('sidebar-avatar');
const copyCodeBtn      = $('copy-code-btn');
const userCount        = $('user-count');
const onlineList       = $('online-list');
const leaveRoomBtn     = $('leave-room-btn');
const headerRoomName   = $('header-room-name');
const headerRoomCode   = $('header-room-code');
const headerUsername   = $('header-username');
const headerAvatar     = $('header-avatar');
const messagesContainer = $('messages-container');
const messagesList     = $('messages-list');
const typingIndicator  = $('typing-indicator');
const typingText       = $('typing-text');
const messageInput     = $('message-input');
const sendBtn          = $('send-btn');
const locationBtn      = $('location-btn');
const toast            = $('toast');

// ══════════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════════
function showToast(msg, type = '', duration = 2500) {
  toast.textContent = msg;
  toast.className = `show ${type}`;
  setTimeout(() => { toast.className = 'hidden'; }, duration);
}

function setLoading(btn, loading) {
  const span   = btn.querySelector('span');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  if (span) span.style.display = loading ? 'none' : '';
  if (loader) loader.classList.toggle('hidden', !loading);
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  requestAnimationFrame(() => { el.style.animation = ''; });
}
function hideError(el) { el.classList.add('hidden'); }

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function getAvatarColor(username) {
  const colors = ['#4f8ef7','#38d9a9','#f59e0b','#a78bfa','#f87171','#34d399','#60a5fa','#fb923c'];
  let hash = 0;
  for (let c of username) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

function makeAvatar(el, username) {
  const initials = username.substring(0, 2).toUpperCase();
  el.textContent = initials;
  el.style.background = getAvatarColor(username);
}

function saveSession() {
  sessionStorage.setItem('nexchat_session', JSON.stringify({
    token: myToken, username: myUsername, avatar: myAvatar
  }));
}
function clearSession() {
  sessionStorage.removeItem('nexchat_session');
  myToken = ''; myUsername = ''; myAvatar = '';
}

// ══════════════════════════════════════════════════════════════════
// SCREEN NAVIGATION
// ══════════════════════════════════════════════════════════════════
function showScreen(name) {
  authScreen.classList.toggle('hidden', name !== 'auth');
  roomScreen.classList.toggle('hidden', name !== 'room');
  chatScreen.classList.toggle('hidden', name !== 'chat');
}

function goToRoomScreen() {
  roomWelcome.textContent = `Hei, ${myUsername}!`;
  makeAvatar(roomAvatar, myUsername);
  showScreen('room');
}

function goToChatScreen() {
  // Sidebar
  sidebarRoomName.textContent = myRoomName;
  sidebarRoomCode.textContent = myRoomCode;
  makeAvatar(sidebarAvatar, myUsername);
  sidebarUsername.textContent = myUsername;

  // Header
  headerRoomName.textContent = myRoomName;
  headerRoomCode.textContent = myRoomCode;
  headerUsername.textContent = myUsername;
  makeAvatar(headerAvatar, myUsername);

  showScreen('chat');
  setTimeout(() => messageInput.focus(), 100);
}

// ══════════════════════════════════════════════════════════════════
// AUTH: TABS
// ══════════════════════════════════════════════════════════════════
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    tab.classList.add('active');
    $(`${tab.dataset.tab}-form`).classList.add('active');
    hideError(loginError); hideError(regError);
  });
});

// Toggle password visibility
document.querySelectorAll('.toggle-pw').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = $(btn.dataset.target);
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.querySelector('.eye-icon').style.opacity = input.type === 'text' ? '0.5' : '1';
  });
});

// ══════════════════════════════════════════════════════════════════
// AUTH: LOGIN
// ══════════════════════════════════════════════════════════════════
async function doLogin() {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  hideError(loginError);

  if (!username || !password) { showError(loginError, 'Isi semua field!'); return; }

  setLoading(loginBtn, true);
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { showError(loginError, data.error); return; }

    myUsername = data.username;
    myAvatar   = data.avatar;
    myToken    = data.token;
    saveSession();
    goToRoomScreen();
  } catch { showError(loginError, 'Koneksi gagal. Coba lagi.'); }
  finally { setLoading(loginBtn, false); }
}

loginBtn.addEventListener('click', doLogin);
[loginUsername, loginPassword].forEach(el =>
  el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); })
);

// ══════════════════════════════════════════════════════════════════
// AUTH: REGISTER
// ══════════════════════════════════════════════════════════════════
async function doRegister() {
  const username = regUsername.value.trim();
  const password = regPassword.value;
  const confirm  = regConfirm.value;
  hideError(regError);

  if (!username || !password || !confirm) { showError(regError, 'Isi semua field!'); return; }
  if (password !== confirm) { showError(regError, 'Password tidak cocok!'); return; }

  setLoading(registerBtn, true);
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { showError(regError, data.error); return; }

    showToast('Akun berhasil dibuat! Silakan login.', 'success');
    // Switch ke login tab
    regUsername.value = ''; regPassword.value = ''; regConfirm.value = '';
    loginUsername.value = username;
    document.querySelector('[data-tab="login"]').click();
  } catch { showError(regError, 'Koneksi gagal. Coba lagi.'); }
  finally { setLoading(registerBtn, false); }
}

registerBtn.addEventListener('click', doRegister);

// ══════════════════════════════════════════════════════════════════
// ROOM: LOGOUT
// ══════════════════════════════════════════════════════════════════
logoutBtn?.addEventListener('click', () => {
  clearSession();
  showScreen('auth');
});

// ══════════════════════════════════════════════════════════════════
// ROOM: CREATE
// ══════════════════════════════════════════════════════════════════
async function doCreateRoom() {
  const name = roomNameInput.value.trim();
  hideError(createError);
  setLoading(createRoomBtn, true);
  try {
    const res = await fetch('/api/rooms/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, token: myToken })
    });
    const data = await res.json();
    if (!res.ok) { showError(createError, data.error); return; }

    myRoomCode = data.code;
    myRoomName = data.name;
    enterRoom();
  } catch { showError(createError, 'Gagal membuat room.'); }
  finally { setLoading(createRoomBtn, false); }
}

createRoomBtn.addEventListener('click', doCreateRoom);
roomNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doCreateRoom(); });

// ══════════════════════════════════════════════════════════════════
// ROOM: JOIN
// ══════════════════════════════════════════════════════════════════
async function doJoinRoom() {
  const code = roomCodeInput.value.trim().toUpperCase();
  hideError(joinError);
  if (!code || code.length !== 6) { showError(joinError, 'Kode room harus 6 karakter!'); return; }

  setLoading(joinRoomBtn, true);
  try {
    const res = await fetch('/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, token: myToken })
    });
    const data = await res.json();
    if (!res.ok) { showError(joinError, data.error); return; }

    myRoomCode = data.code;
    myRoomName = data.name;
    enterRoom();
  } catch { showError(joinError, 'Gagal bergabung ke room.'); }
  finally { setLoading(joinRoomBtn, false); }
}

joinRoomBtn.addEventListener('click', doJoinRoom);
roomCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') doJoinRoom(); });
roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// ══════════════════════════════════════════════════════════════════
// ENTER ROOM
// ══════════════════════════════════════════════════════════════════
function enterRoom() {
  socket.emit('room:join', { token: myToken, roomCode: myRoomCode });
  goToChatScreen();
}

// ══════════════════════════════════════════════════════════════════
// COPY ROOM CODE
// ══════════════════════════════════════════════════════════════════
copyCodeBtn?.addEventListener('click', () => {
  navigator.clipboard.writeText(myRoomCode).then(() => {
    copyCodeBtn.classList.add('copied');
    copyCodeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Tersalin`;
    setTimeout(() => {
      copyCodeBtn.classList.remove('copied');
      copyCodeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Salin`;
    }, 2000);
  });
});

// ══════════════════════════════════════════════════════════════════
// LEAVE ROOM
// ══════════════════════════════════════════════════════════════════
leaveRoomBtn?.addEventListener('click', () => {
  if (confirm('Keluar dari room?')) {
    myRoomCode = ''; myRoomName = '';
    messagesList.innerHTML = '';
    activeTypers.clear();
    goToRoomScreen();
  }
});

// ══════════════════════════════════════════════════════════════════
// SIDEBAR TOGGLE
// ══════════════════════════════════════════════════════════════════
sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

// ══════════════════════════════════════════════════════════════════
// SEND MESSAGE
// ══════════════════════════════════════════════════════════════════
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit('chat:message', { text });
  messageInput.value = '';
  messageInput.style.height = 'auto';
  stopTyping();
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  handleTyping();
});

// ══════════════════════════════════════════════════════════════════
// TYPING
// ══════════════════════════════════════════════════════════════════
function handleTyping() {
  if (!isTyping) { isTyping = true; socket.emit('chat:typing', true); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 1500);
}
function stopTyping() {
  if (isTyping) { isTyping = false; socket.emit('chat:typing', false); }
  clearTimeout(typingTimer);
}
function updateTypingIndicator() {
  const typers = Array.from(activeTypers);
  if (!typers.length) { typingIndicator.classList.add('hidden'); return; }
  typingIndicator.classList.remove('hidden');
  if (typers.length === 1) typingText.textContent = `${typers[0]} sedang mengetik`;
  else if (typers.length === 2) typingText.textContent = `${typers[0]} dan ${typers[1]} sedang mengetik`;
  else typingText.textContent = `${typers.length} orang sedang mengetik`;
  scrollToBottom();
}

// ══════════════════════════════════════════════════════════════════
// SHARE LOCATION
// ══════════════════════════════════════════════════════════════════
locationBtn.addEventListener('click', () => {
  if (!navigator.geolocation) { showToast('Browser tidak mendukung geolokasi', 'error'); return; }
  locationBtn.classList.add('loading');
  locationBtn.title = 'Mengambil lokasi...';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      let address = null;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
        const d = await r.json();
        address = d.display_name || null;
      } catch {}
      socket.emit('chat:location', { lat, lng, address });
      locationBtn.classList.remove('loading');
      locationBtn.title = 'Bagikan Lokasi';
      showToast('Lokasi berhasil dibagikan!', 'success');
    },
    (err) => {
      locationBtn.classList.remove('loading');
      locationBtn.title = 'Bagikan Lokasi';
      const msgs = { 1: 'Izin lokasi ditolak', 2: 'Lokasi tidak tersedia', 3: 'Timeout' };
      showToast(msgs[err.code] || 'Gagal mengambil lokasi', 'error');
    },
    { timeout: 10000, enableHighAccuracy: true }
  );
});

// ══════════════════════════════════════════════════════════════════
// RENDER MESSAGES
// ══════════════════════════════════════════════════════════════════
function renderMessage(msg) {
  const isMe = msg.username === myUsername;

  if (msg.type === 'location') {
    renderLocationMessage(msg, isMe);
    return;
  }

  // Cek apakah bisa digabung ke grup sebelumnya
  const lastGroup  = messagesList.querySelector('.msg-group:last-child');
  const lastSender = lastGroup?.dataset.sender;
  const lastIsMe   = lastGroup?.classList.contains('me');

  if (lastGroup && lastSender === msg.username && isMe === lastIsMe) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = msg.text;
    const timeEl = lastGroup.querySelector('.msg-time');
    lastGroup.insertBefore(bubble, timeEl);
    if (timeEl) timeEl.textContent = formatTime(msg.timestamp);
  } else {
    const group = document.createElement('div');
    group.className = `msg-group ${isMe ? 'me' : 'other'}`;
    group.dataset.sender = msg.username;

    // Meta (avatar + sender)
    const meta = document.createElement('div');
    meta.className = 'msg-meta';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'avatar-sm';
    avatarEl.style.width = '22px';
    avatarEl.style.height = '22px';
    avatarEl.style.fontSize = '8px';
    makeAvatar(avatarEl, msg.username);
    meta.appendChild(avatarEl);

    if (!isMe) {
      const sender = document.createElement('span');
      sender.className = 'msg-sender';
      sender.textContent = msg.username;
      meta.appendChild(sender);
    }
    group.appendChild(meta);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = msg.text;
    group.appendChild(bubble);

    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = formatTime(msg.timestamp);
    group.appendChild(time);

    messagesList.appendChild(group);
  }
  scrollToBottom();
}

function renderLocationMessage(msg, isMe) {
  const group = document.createElement('div');
  group.className = `msg-group ${isMe ? 'me' : 'other'}`;
  group.dataset.sender = msg.username;

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const avatarEl = document.createElement('div');
  avatarEl.className = 'avatar-sm';
  avatarEl.style.cssText = 'width:22px;height:22px;font-size:8px;';
  makeAvatar(avatarEl, msg.username);
  meta.appendChild(avatarEl);
  if (!isMe) {
    const sender = document.createElement('span');
    sender.className = 'msg-sender';
    sender.textContent = msg.username;
    meta.appendChild(sender);
  }
  group.appendChild(meta);

  const { lat, lng, address } = msg.location;
  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.005},${lat-0.005},${lng+0.005},${lat+0.005}&layer=mapnik&marker=${lat},${lng}`;

  const locBubble = document.createElement('div');
  locBubble.className = 'location-bubble';
  locBubble.innerHTML = `
    <div class="location-map-preview">
      <iframe src="${embedUrl}" loading="lazy" title="Map"></iframe>
    </div>
    <div class="location-info">
      <div class="location-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>
      <div class="location-text">
        <div class="location-label">Lokasi dibagikan</div>
        <div class="location-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        ${address ? `<div class="location-coords" style="margin-top:2px;font-size:9px;max-width:130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${address}">${address}</div>` : ''}
      </div>
      <button class="location-open-btn" onclick="window.open('${mapsUrl}', '_blank')">Buka</button>
    </div>
  `;
  group.appendChild(locBubble);

  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = formatTime(msg.timestamp);
  group.appendChild(time);

  messagesList.appendChild(group);
  scrollToBottom();
}

function renderSystemMessage(msg) {
  const el = document.createElement('div');
  el.className = 'msg-system';
  el.textContent = msg.text;
  messagesList.appendChild(el);
  scrollToBottom();
}

function renderHistory(messages) {
  messagesList.innerHTML = '';
  if (!messages.length) {
    const el = document.createElement('div');
    el.className = 'msg-system';
    el.textContent = 'Belum ada pesan. Mulai percakapan!';
    messagesList.appendChild(el);
    return;
  }
  messages.forEach(renderMessage);
}

// ══════════════════════════════════════════════════════════════════
// RENDER ONLINE USERS
// ══════════════════════════════════════════════════════════════════
function renderOnlineUsers(users) {
  userCount.textContent = users.length;
  onlineList.innerHTML = '';
  users.forEach(({ username }) => {
    const li = document.createElement('li');
    if (username === myUsername) li.classList.add('me');

    const avatar = document.createElement('div');
    avatar.className = 'li-avatar';
    avatar.textContent = username.substring(0, 2).toUpperCase();
    avatar.style.background = username === myUsername ? 'var(--accent)' : getAvatarColor(username);
    avatar.style.color = 'white';

    const dot = document.createElement('div');
    dot.className = 'li-dot';

    const name = document.createElement('span');
    name.textContent = username === myUsername ? `${username} (kamu)` : username;

    li.appendChild(avatar);
    li.appendChild(dot);
    li.appendChild(name);
    onlineList.appendChild(li);
  });
}

// ══════════════════════════════════════════════════════════════════
// SCROLL
// ══════════════════════════════════════════════════════════════════
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ══════════════════════════════════════════════════════════════════
// SOCKET EVENTS
// ══════════════════════════════════════════════════════════════════
socket.on('chat:message',     msg  => renderMessage(msg));
socket.on('system:message',   msg  => renderSystemMessage(msg));
socket.on('users:online',     users => renderOnlineUsers(users));
socket.on('messages:history', msgs => renderHistory(msgs));

socket.on('chat:typing', ({ username, isTyping: typing }) => {
  if (username === myUsername) return;
  typing ? activeTypers.add(username) : activeTypers.delete(username);
  updateTypingIndicator();
});

socket.on('error', ({ message }) => {
  showToast(message, 'error', 3000);
});

socket.on('disconnect', reason => {
  if (reason === 'io server disconnect' || reason === 'transport close') {
    renderSystemMessage({ text: 'Koneksi terputus. Mencoba reconnect...' });
  }
});

socket.on('reconnect', () => {
  if (myUsername && myRoomCode) {
    renderSystemMessage({ text: 'Terhubung kembali!' });
    socket.emit('room:join', { token: myToken, roomCode: myRoomCode });
  }
});

// ══════════════════════════════════════════════════════════════════
// INIT: Cek session
// ══════════════════════════════════════════════════════════════════
if (myToken) {
  goToRoomScreen();
} else {
  showScreen('auth');
}