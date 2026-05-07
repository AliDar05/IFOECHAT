// ══════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════
let myUsername   = '';
let myAvatar     = '';
let myToken      = '';
let myRoomCode   = '';
let myRoomName   = '';

let typingTimer  = null;
let isTyping     = false;
let activeTypers = new Set();

const hiddenForMe = new Set();

// Files staged for sending
let pendingFiles = [];

// Restore session
try {
  const s = JSON.parse(sessionStorage.getItem('ic_session') || 'null');
  if (s?.token) { myUsername = s.username; myAvatar = s.avatar; myToken = s.token; }
} catch {}

// ══════════════════════════════════════════════════════════════════
// SOCKET
// ══════════════════════════════════════════════════════════════════
const socket = io({ autoConnect: true });

// ══════════════════════════════════════════════════════════════════
// DOM REFS
// ══════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

const authScreen  = $('auth-screen');
const roomScreen  = $('room-screen');
const chatScreen  = $('chat-screen');

const loginError    = $('login-error');
const loginBtn      = $('login-btn');
const regError      = $('reg-error');
const registerBtn   = $('register-btn');

const roomWelcome   = $('room-welcome');
const roomAvatar    = $('room-avatar');
const createError   = $('create-error');
const createRoomBtn = $('create-room-btn');
const joinError     = $('join-error');
const joinRoomBtn   = $('join-room-btn');

const sidebar          = $('sidebar');
const sidebarBackdrop  = $('sidebar-backdrop');
const sidebarToggle    = $('sidebar-toggle');
const sidebarCloseBtn  = $('sidebar-close-btn');
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
const attachBtn        = $('attach-btn');
const fileInput        = $('file-input');
const filePreviewBar   = $('file-preview-bar');
const filePreviewList  = $('file-preview-list');
const filePreviewClear = $('file-preview-clear');
const contextMenu      = $('context-menu');
const toast            = $('toast');
const leaveModal       = $('leave-modal');
const leaveCancelBtn   = $('leave-cancel-btn');
const leaveConfirmBtn  = $('leave-confirm-btn');
const lightbox         = $('lightbox');
const lightboxImg      = $('lightbox-img');
const lightboxClose    = $('lightbox-close');
const lightboxDownload = $('lightbox-download');
const lightboxBackdrop = $('lightbox-backdrop');

// ══════════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════════
let toastTimer;
function showToast(msg, type = '', duration = 2500) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = `show ${type}`;
  toastTimer = setTimeout(() => { toast.className = 'hidden'; }, duration);
}

function setLoading(btn, on) {
  btn.disabled = on;
  btn.querySelector('span').style.display  = on ? 'none' : '';
  btn.querySelector('.btn-loader').classList.toggle('hidden', !on);
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  requestAnimationFrame(() => el.style.animation = '');
}
function hideError(el) { el.classList.add('hidden'); }

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hari ini';
  if (d.toDateString() === yesterday.toDateString()) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const AVATAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899'];
function getAvatarColor(username) {
  let h = 0;
  for (const c of username) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function makeAvatar(el, username) {
  el.textContent = username.substring(0, 2).toUpperCase();
  el.style.background = getAvatarColor(username);
}

function saveSession() {
  sessionStorage.setItem('ic_session', JSON.stringify({ token: myToken, username: myUsername, avatar: myAvatar }));
}
function clearSession() {
  sessionStorage.removeItem('ic_session');
  myToken = ''; myUsername = ''; myAvatar = '';
}

function isImageFile(name) {
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name);
}
function getFileExt(name) {
  return name.split('.').pop().toUpperCase().slice(0, 4);
}

// Convert file to base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
  sidebarRoomName.textContent  = myRoomName;
  sidebarRoomCode.textContent  = myRoomCode;
  makeAvatar(sidebarAvatar,  myUsername); sidebarUsername.textContent = myUsername;
  headerRoomName.textContent   = myRoomName;
  headerRoomCode.textContent   = myRoomCode;
  headerUsername.textContent   = myUsername;
  makeAvatar(headerAvatar,   myUsername);
  showScreen('chat');
  // Di mobile: sidebar selalu mulai tersembunyi supaya tombol toggle kelihatan
  if (window.innerWidth <= 640) {
    sidebar.classList.remove('open');
    sidebar.classList.add('collapsed');
    sidebarBackdrop.classList.remove('visible');
  }
  setTimeout(() => messageInput.focus(), 100);
}

// ══════════════════════════════════════════════════════════════════
// AUTH — TABS
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

document.querySelectorAll('.toggle-pw').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = $(btn.dataset.target);
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.querySelector('.eye-icon').style.opacity = input.type === 'text' ? '0.45' : '1';
  });
});

// ══════════════════════════════════════════════════════════════════
// AUTH — LOGIN
// ══════════════════════════════════════════════════════════════════
async function doLogin() {
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  hideError(loginError);
  if (!username || !password) { showError(loginError, 'Isi semua field!'); return; }
  setLoading(loginBtn, true);
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const d = await r.json();
    if (!r.ok) { showError(loginError, d.error); return; }
    myUsername = d.username; myAvatar = d.avatar; myToken = d.token;

    // Cek apakah admin → redirect ke admin.html
    if (d.isAdmin) {
      localStorage.setItem('adminToken', d.token);
      window.location.href = '/admin.html';
      return;
    }

    saveSession(); goToRoomScreen();
  } catch { showError(loginError, 'Koneksi gagal.'); }
  finally { setLoading(loginBtn, false); }
}
loginBtn.addEventListener('click', doLogin);
['login-username','login-password'].forEach(id =>
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));

// ══════════════════════════════════════════════════════════════════
// AUTH — REGISTER
// ══════════════════════════════════════════════════════════════════
async function doRegister() {
  const username = $('reg-username').value.trim();
  const password = $('reg-password').value;
  const confirm  = $('reg-confirm').value;
  hideError(regError);
  if (!username || !password || !confirm) { showError(regError, 'Isi semua field!'); return; }
  if (password !== confirm) { showError(regError, 'Password tidak cocok!'); return; }
  setLoading(registerBtn, true);
  try {
    const r = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const d = await r.json();
    if (!r.ok) { showError(regError, d.error); return; }
    showToast('Akun berhasil dibuat! Silakan login.', 'success');
    $('reg-username').value = ''; $('reg-password').value = ''; $('reg-confirm').value = '';
    $('login-username').value = username;
    document.querySelector('[data-tab="login"]').click();
  } catch { showError(regError, 'Koneksi gagal.'); }
  finally { setLoading(registerBtn, false); }
}
registerBtn.addEventListener('click', doRegister);

// ══════════════════════════════════════════════════════════════════
// ROOM — LOGOUT
// ══════════════════════════════════════════════════════════════════
$('logout-btn')?.addEventListener('click', () => { clearSession(); showScreen('auth'); });

// ══════════════════════════════════════════════════════════════════
// ROOM — CREATE
// ══════════════════════════════════════════════════════════════════
async function doCreateRoom() {
  const name = $('room-name-input').value.trim();
  hideError(createError);
  setLoading(createRoomBtn, true);
  try {
    const r = await fetch('/api/rooms/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, token: myToken })
    });
    const d = await r.json();
    if (!r.ok) { showError(createError, d.error); return; }
    myRoomCode = d.code; myRoomName = d.name; enterRoom();
  } catch { showError(createError, 'Gagal membuat room.'); }
  finally { setLoading(createRoomBtn, false); }
}
createRoomBtn.addEventListener('click', doCreateRoom);
$('room-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') doCreateRoom(); });

// ══════════════════════════════════════════════════════════════════
// ROOM — JOIN
// ══════════════════════════════════════════════════════════════════
async function doJoinRoom() {
  const code = $('room-code-input').value.trim().toUpperCase();
  hideError(joinError);
  if (!code || code.length !== 6) { showError(joinError, 'Kode room harus 6 karakter!'); return; }
  setLoading(joinRoomBtn, true);
  try {
    const r = await fetch('/api/rooms/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, token: myToken })
    });
    const d = await r.json();
    if (!r.ok) { showError(joinError, d.error); return; }
    myRoomCode = d.code; myRoomName = d.name; enterRoom();
  } catch { showError(joinError, 'Gagal bergabung.'); }
  finally { setLoading(joinRoomBtn, false); }
}
joinRoomBtn.addEventListener('click', doJoinRoom);
$('room-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') doJoinRoom(); });
$('room-code-input').addEventListener('input', function() {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// ══════════════════════════════════════════════════════════════════
// ENTER ROOM
// ══════════════════════════════════════════════════════════════════
function enterRoom() {
  hiddenForMe.clear();
  pendingFiles = [];
  messagesList.innerHTML = '';
  socket.emit('room:join', { token: myToken, roomCode: myRoomCode });
  goToChatScreen();
}

// ══════════════════════════════════════════════════════════════════
// COPY ROOM CODE
// ══════════════════════════════════════════════════════════════════
copyCodeBtn?.addEventListener('click', () => {
  navigator.clipboard.writeText(myRoomCode).then(() => {
    copyCodeBtn.classList.add('copied');
    copyCodeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Tersalin`;
    setTimeout(() => {
      copyCodeBtn.classList.remove('copied');
      copyCodeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Salin`;
    }, 2000);
  });
});

// ══════════════════════════════════════════════════════════════════
// LEAVE ROOM — Modal
// ══════════════════════════════════════════════════════════════════
leaveRoomBtn?.addEventListener('click', () => {
  leaveModal.classList.remove('hidden');
});
leaveCancelBtn?.addEventListener('click', () => {
  leaveModal.classList.add('hidden');
});
leaveConfirmBtn?.addEventListener('click', () => {
  socket.emit('room:leave');
  leaveModal.classList.add('hidden');
  myRoomCode = ''; myRoomName = '';
  hiddenForMe.clear();
  pendingFiles = [];
  filePreviewBar.classList.add('hidden');
  filePreviewList.innerHTML = '';
  messagesList.innerHTML = '';
  activeTypers.clear();
  goToRoomScreen();
});
// Click outside modal to close
leaveModal?.addEventListener('click', e => {
  if (e.target === leaveModal) leaveModal.classList.add('hidden');
});

// ══════════════════════════════════════════════════════════════════
// SIDEBAR TOGGLE — works on ALL screen sizes
// ══════════════════════════════════════════════════════════════════
function openSidebar() {
  if (window.innerWidth <= 640) {
    sidebar.classList.add('open');
    sidebar.classList.remove('collapsed');
    sidebarBackdrop.classList.add('visible');
  } else {
    sidebar.classList.remove('collapsed');
  }
}
function closeSidebar() {
  if (window.innerWidth <= 640) {
    sidebar.classList.remove('open');
    sidebar.classList.add('collapsed');
  } else {
    sidebar.classList.add('collapsed');
  }
  sidebarBackdrop.classList.remove('visible');
}
function isSidebarOpen() {
  if (window.innerWidth <= 640) {
    return sidebar.classList.contains('open');
  }
  return !sidebar.classList.contains('collapsed');
}
sidebarToggle.addEventListener('click', () => {
  isSidebarOpen() ? closeSidebar() : openSidebar();
});
sidebarCloseBtn?.addEventListener('click', closeSidebar);
sidebarBackdrop.addEventListener('click', closeSidebar);
window.addEventListener('resize', () => {
  if (window.innerWidth > 640) sidebarBackdrop.classList.remove('visible');
});

// ══════════════════════════════════════════════════════════════════
// FILE ATTACHMENT
// ══════════════════════════════════════════════════════════════════
attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files);
  if (!files.length) return;
  files.forEach(f => {
    if (f.size > 10 * 1024 * 1024) {
      showToast(`File "${f.name}" terlalu besar (maks 10MB)`, 'error');
      return;
    }
    pendingFiles.push(f);
  });
  fileInput.value = '';
  renderFilePreview();
});

function renderFilePreview() {
  filePreviewList.innerHTML = '';
  if (!pendingFiles.length) {
    filePreviewBar.classList.add('hidden');
    return;
  }
  filePreviewBar.classList.remove('hidden');

  pendingFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';

    if (isImageFile(file.name)) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      item.appendChild(img);
    } else {
      const iconBox = document.createElement('div');
      iconBox.className = 'preview-file-icon';
      iconBox.innerHTML = `<span>${getFileExt(file.name)}</span>`;
      item.appendChild(iconBox);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'preview-remove';
    removeBtn.innerHTML = '×';
    removeBtn.onclick = () => {
      pendingFiles.splice(idx, 1);
      renderFilePreview();
    };
    item.appendChild(removeBtn);
    filePreviewList.appendChild(item);
  });
}

filePreviewClear.addEventListener('click', () => {
  pendingFiles = [];
  renderFilePreview();
});

// ══════════════════════════════════════════════════════════════════
// CONTEXT MENU
// ══════════════════════════════════════════════════════════════════
let ctxTargetMsgId = null;
let ctxTargetGroup = null;
let longPressTimer = null;

function showContextMenu(x, y, msgId, bubbleEl, isOwn) {
  ctxTargetMsgId = msgId;
  ctxTargetGroup = bubbleEl;
  contextMenu.innerHTML = '';

  const isLocationBubble = bubbleEl.classList.contains('location-bubble');
  const isFileBubble     = bubbleEl.classList.contains('file-bubble');
  const timeEl = bubbleEl.querySelector('.msg-time');
  let bubbleText = '';
  if (!isLocationBubble && !isFileBubble) {
    const clone = bubbleEl.cloneNode(true);
    clone.querySelector('.msg-time')?.remove();
    bubbleText = clone.textContent.trim();
  }

  if (bubbleText) {
    const copyItem = makeCtxItem(
      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
      'Salin Pesan', false
    );
    copyItem.addEventListener('click', () => {
      navigator.clipboard.writeText(bubbleText).then(() => showToast('Pesan disalin ✓', 'success'));
      hideContextMenu();
    });
    contextMenu.appendChild(copyItem);
  }

  const delMeItem = makeCtxItem(
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
    'Hapus untuk Saya', true
  );
  delMeItem.addEventListener('click', () => { deleteForMe(msgId, bubbleEl); hideContextMenu(); });
  contextMenu.appendChild(delMeItem);

  if (isOwn) {
    contextMenu.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-divider' }));
    const delAllItem = makeCtxItem(
      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
      'Hapus untuk Semua', true
    );
    delAllItem.addEventListener('click', () => { deleteForAll(msgId); hideContextMenu(); });
    contextMenu.appendChild(delAllItem);
  }

  contextMenu.classList.remove('hidden');
  const mw = contextMenu.offsetWidth  || 200;
  const mh = contextMenu.offsetHeight || 110;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = x, top = y;
  if (left + mw > vw - 8) left = vw - mw - 8;
  if (top  + mh > vh - 8) top  = y - mh;
  if (top < 8) top = 8;
  contextMenu.style.left = left + 'px';
  contextMenu.style.top  = top  + 'px';
}

function makeCtxItem(iconSvg, label, isDanger) {
  const el = document.createElement('div');
  el.className = 'ctx-item' + (isDanger ? ' danger' : '');
  el.innerHTML = `${iconSvg}<span>${label}</span>`;
  return el;
}
function hideContextMenu() {
  contextMenu.classList.add('hidden');
  ctxTargetMsgId = null; ctxTargetGroup = null;
}

function deleteForMe(msgId, bubbleEl) {
  if (!msgId || !bubbleEl) return;
  hiddenForMe.add(String(msgId));
  bubbleEl.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
  bubbleEl.style.opacity = '0';
  bubbleEl.style.transform = 'scale(0.94)';
  setTimeout(() => {
    const group = bubbleEl.closest('.msg-group');
    bubbleEl.remove();
    if (group && !group.querySelector('.bubble, .location-bubble, .file-bubble')) group.remove();
  }, 240);
  showToast('Dihapus untuk kamu', '', 2000);
}

function deleteForAll(msgId) {
  if (!msgId) return;
  socket.emit('chat:delete', { msgId: String(msgId), roomCode: myRoomCode });
  showToast('Dihapus untuk semua', '', 2000);
}

document.addEventListener('click', e => {
  if (!contextMenu.classList.contains('hidden') && !contextMenu.contains(e.target)) hideContextMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideContextMenu(); lightboxClose.click(); leaveModal.classList.add('hidden'); } });

messagesList.addEventListener('contextmenu', e => {
  const bubble = e.target.closest('.bubble[data-msg-id], .location-bubble[data-msg-id], .file-bubble[data-msg-id]');
  if (!bubble) return;
  e.preventDefault();
  const group = bubble.closest('.msg-group');
  const isOwn = group?.classList.contains('me') ?? false;
  showContextMenu(e.clientX, e.clientY, bubble.dataset.msgId, bubble, isOwn);
});

messagesList.addEventListener('pointerdown', e => {
  const bubble = e.target.closest('.bubble[data-msg-id], .location-bubble[data-msg-id], .file-bubble[data-msg-id]');
  if (!bubble) return;
  longPressTimer = setTimeout(() => {
    const group = bubble.closest('.msg-group');
    const isOwn = group?.classList.contains('me') ?? false;
    const r = bubble.getBoundingClientRect();
    showContextMenu(r.left + r.width / 2, r.top, bubble.dataset.msgId, bubble, isOwn);
  }, 500);
});
messagesList.addEventListener('pointerup',    () => clearTimeout(longPressTimer));
messagesList.addEventListener('pointercancel',() => clearTimeout(longPressTimer));
messagesList.addEventListener('pointermove',  () => clearTimeout(longPressTimer));

// ══════════════════════════════════════════════════════════════════
// LIGHTBOX
// ══════════════════════════════════════════════════════════════════
function openLightbox(src) {
  lightboxImg.src = src;
  lightboxDownload.href = src;
  lightbox.classList.remove('hidden');
}
lightboxClose.addEventListener('click', () => lightbox.classList.add('hidden'));
lightboxBackdrop.addEventListener('click', () => lightbox.classList.add('hidden'));

// ══════════════════════════════════════════════════════════════════
// SEND MESSAGE
// ══════════════════════════════════════════════════════════════════
async function sendMessage() {
  const text = messageInput.value.trim();
  const hasFiles = pendingFiles.length > 0;

  if (!text && !hasFiles) return;

  // Send files first
  if (hasFiles) {
    const filesToSend = [...pendingFiles];
    pendingFiles = [];
    renderFilePreview();

    for (const file of filesToSend) {
      try {
        const dataUrl = await fileToBase64(file);
        socket.emit('chat:file', {
          name: file.name,
          size: file.size,
          mimeType: file.type,
          dataUrl,
          caption: text && filesToSend.indexOf(file) === filesToSend.length - 1 ? text : ''
        });
      } catch {
        showToast(`Gagal mengirim file: ${file.name}`, 'error');
      }
    }
    if (text) {
      messageInput.value = '';
      messageInput.style.height = 'auto';
      stopTyping();
      return; // caption already sent with last file
    }
  }

  if (text) {
    socket.emit('chat:message', { text });
    messageInput.value = '';
    messageInput.style.height = 'auto';
    stopTyping();
  }
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
  const typers = [...activeTypers];
  if (!typers.length) { typingIndicator.classList.add('hidden'); return; }
  typingIndicator.classList.remove('hidden');
  if (typers.length === 1)      typingText.textContent = `${typers[0]} mengetik`;
  else if (typers.length === 2) typingText.textContent = `${typers[0]} & ${typers[1]} mengetik`;
  else                          typingText.textContent = `${typers.length} orang mengetik`;
  scrollToBottom();
}

// ══════════════════════════════════════════════════════════════════
// SHARE LOCATION
// ══════════════════════════════════════════════════════════════════
locationBtn.addEventListener('click', () => {
  if (!navigator.geolocation) { showToast('Browser tidak mendukung lokasi', 'error'); return; }
  locationBtn.classList.add('loading');
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      let address = null;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
        const d = await r.json();
        address = d.display_name || null;
      } catch {}
      socket.emit('chat:location', { lat, lng, address });
      locationBtn.classList.remove('loading');
      showToast('Lokasi dibagikan!', 'success');
    },
    err => {
      locationBtn.classList.remove('loading');
      const m = { 1: 'Izin lokasi ditolak', 2: 'Lokasi tidak tersedia', 3: 'Timeout' };
      showToast(m[err.code] || 'Gagal mendapatkan lokasi', 'error');
    },
    { timeout: 10000, enableHighAccuracy: true }
  );
});

// ══════════════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════════════
let lastDateLabel = '';

function maybeAddDateDivider(iso) {
  const label = fmtDate(iso);
  if (label !== lastDateLabel) {
    lastDateLabel = label;
    const div = document.createElement('div');
    div.className = 'date-divider';
    div.textContent = label;
    messagesList.appendChild(div);
  }
}

function renderMessage(msg) {
  if (hiddenForMe.has(String(msg.id))) return;
  maybeAddDateDivider(msg.timestamp);

  if (msg.type === 'location') { renderLocationMessage(msg); return; }
  if (msg.type === 'file')     { renderFileMessage(msg); return; }

  const isMe = msg.username === myUsername;
  const time  = fmtTime(msg.timestamp);

  const lastGroup  = messagesList.querySelector('.msg-group:last-child');
  const lastSender = lastGroup?.dataset.sender;
  const lastIsMe   = lastGroup?.classList.contains('me');

  if (lastGroup && lastSender === msg.username && isMe === lastIsMe) {
    const bubble = makeBubble(msg.text, time, msg.id);
    lastGroup.appendChild(bubble);
    lastGroup.dataset.msgId = msg.id;
  } else {
    const group = document.createElement('div');
    group.className = `msg-group ${isMe ? 'me' : 'other'}`;
    group.dataset.sender = msg.username;
    group.dataset.msgId  = msg.id;
    if (!isMe) {
      const senderEl = document.createElement('div');
      senderEl.className = 'msg-sender-name';
      senderEl.style.color = getAvatarColor(msg.username);
      senderEl.textContent = msg.username;
      group.appendChild(senderEl);
    }
    group.appendChild(makeBubble(msg.text, time, msg.id));
    messagesList.appendChild(group);
  }
  scrollToBottom();
}

function makeBubble(text, time, msgId) {
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (msgId != null) bubble.dataset.msgId = String(msgId);
  bubble.textContent = text;
  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = time;
  bubble.appendChild(timeEl);
  return bubble;
}

function renderFileMessage(msg) {
  const isMe = msg.username === myUsername;
  const time  = fmtTime(msg.timestamp);
  const { name, size, mimeType, dataUrl, caption } = msg.file;
  const isImg = isImageFile(name) || (mimeType && mimeType.startsWith('image/'));

  const group = document.createElement('div');
  group.className = `msg-group ${isMe ? 'me' : 'other'}`;
  group.dataset.sender = msg.username;
  group.dataset.msgId  = String(msg.id);

  if (!isMe) {
    const senderEl = document.createElement('div');
    senderEl.className = 'msg-sender-name';
    senderEl.style.color = getAvatarColor(msg.username);
    senderEl.textContent = msg.username;
    group.appendChild(senderEl);
  }

  const fileBubble = document.createElement('div');
  fileBubble.className = 'file-bubble';
  fileBubble.dataset.msgId = String(msg.id);

  if (isImg) {
    const imgEl = document.createElement('img');
    imgEl.className = 'bubble-img';
    imgEl.src = dataUrl;
    imgEl.alt = name;
    imgEl.loading = 'lazy';
    imgEl.addEventListener('click', () => openLightbox(dataUrl));
    fileBubble.appendChild(imgEl);

    const capDiv = document.createElement('div');
    capDiv.className = 'bubble-img-caption';
    if (caption) {
      capDiv.textContent = caption;
    }
    const timeEl = document.createElement('span');
    timeEl.className = 'msg-time';
    timeEl.textContent = time;
    capDiv.appendChild(timeEl);
    fileBubble.appendChild(capDiv);
  } else {
    const infoDiv = document.createElement('div');
    infoDiv.className = 'file-only-info';
    infoDiv.innerHTML = `
      <div class="file-icon-box">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div class="file-meta">
        <div class="file-name" title="${name}">${name}</div>
        <div class="file-size">${fmtFileSize(size)}</div>
      </div>
      <a href="${dataUrl}" download="${name}" class="file-dl-btn" title="Unduh">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </a>
    `;
    const timeEl = document.createElement('span');
    timeEl.className = 'msg-time';
    timeEl.textContent = time;
    infoDiv.appendChild(timeEl);
    fileBubble.appendChild(infoDiv);
  }

  group.appendChild(fileBubble);
  messagesList.appendChild(group);
  scrollToBottom();
}

function renderLocationMessage(msg) {
  const isMe = msg.username === myUsername;
  const { lat, lng, address } = msg.location;
  const mapsUrl  = `https://www.google.com/maps?q=${lat},${lng}`;
  const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.004},${lat-0.004},${lng+0.004},${lat+0.004}&layer=mapnik&marker=${lat},${lng}`;

  const group = document.createElement('div');
  group.className = `msg-group ${isMe ? 'me' : 'other'}`;
  group.dataset.sender = msg.username;
  group.dataset.msgId  = msg.id;

  if (!isMe) {
    const senderEl = document.createElement('div');
    senderEl.className = 'msg-sender-name';
    senderEl.style.color = getAvatarColor(msg.username);
    senderEl.textContent = msg.username;
    group.appendChild(senderEl);
  }

  const locBubble = document.createElement('div');
  locBubble.className = 'location-bubble';
  locBubble.dataset.msgId = String(msg.id);
  locBubble.innerHTML = `
    <div class="location-map-preview">
      <iframe src="${embedUrl}" loading="lazy" title="Map"></iframe>
    </div>
    <div class="location-info">
      <div class="location-pin-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>
      <div class="location-text">
        <div class="location-label">Lokasi dibagikan</div>
        <div class="location-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        ${address ? `<div class="location-address" title="${address}">${address}</div>` : ''}
      </div>
      <span class="loc-msg-time">${fmtTime(msg.timestamp)}</span>
      <button class="location-open-btn" onclick="window.open('${mapsUrl}','_blank')">Buka ↗</button>
    </div>
  `;
  group.appendChild(locBubble);
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
  lastDateLabel = '';
  if (!messages.length) {
    const el = document.createElement('div');
    el.className = 'msg-system';
    el.textContent = 'Belum ada pesan. Mulai obrolan! 👋';
    messagesList.appendChild(el);
    return;
  }
  messages.forEach(m => {
    if (!hiddenForMe.has(String(m.id))) renderMessage(m);
  });
}

function removeMsgById(msgId) {
  const el = messagesList.querySelector(`.bubble[data-msg-id="${msgId}"], .location-bubble[data-msg-id="${msgId}"], .file-bubble[data-msg-id="${msgId}"]`);
  if (!el) return;
  el.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
  el.style.opacity = '0';
  el.style.transform = 'scale(0.94)';
  setTimeout(() => {
    const group = el.closest('.msg-group');
    el.remove();
    if (group && !group.querySelector('.bubble, .location-bubble, .file-bubble')) group.remove();
  }, 240);
}

// ══════════════════════════════════════════════════════════════════
// ONLINE USERS — HEADER AVATAR CLUSTER
// ══════════════════════════════════════════════════════════════════
const headerOnlineAvatars = $('header-online-avatars');
const onlineTooltip       = $('online-tooltip');
let tooltipOpen = false;

function renderOnlineUsers(users) {
  // keep hidden list in sync (used by userCount only)
  userCount && (userCount.textContent = users.length);

  // ── Build avatar cluster ─────────────────────────────────────
  headerOnlineAvatars.innerHTML = '';
  const MAX_SHOWN = 5;
  const shown = users.slice(0, MAX_SHOWN);
  const extra = users.length - MAX_SHOWN;

  shown.forEach(({ username }) => {
    const av = document.createElement('div');
    av.className = 'cluster-avatar';
    av.textContent = username.substring(0, 2).toUpperCase();
    av.style.background = getAvatarColor(username);
    av.title = username;
    av.addEventListener('click', toggleOnlineTooltip);
    headerOnlineAvatars.appendChild(av);
  });

  if (extra > 0) {
    const more = document.createElement('div');
    more.className = 'cluster-more';
    more.textContent = `+${extra}`;
    headerOnlineAvatars.appendChild(more);
  }

  // count pill
  let pill = headerOnlineAvatars.parentElement.querySelector('.online-count-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.className = 'online-count-pill';
    pill.innerHTML = `<span class="online-dot"></span><span class="pill-count"></span>`;
    headerOnlineAvatars.parentElement.appendChild(pill);
    pill.addEventListener('click', toggleOnlineTooltip);
  }
  pill.querySelector('.pill-count').textContent = `${users.length} online`;

  // ── Rebuild tooltip content ──────────────────────────────────
  onlineTooltip.innerHTML = `
    <div class="tooltip-header">
      <span class="online-dot"></span>
      ${users.length} Online
    </div>
  `;
  users.forEach(({ username }) => {
    const row = document.createElement('div');
    row.className = 'tooltip-user' + (username === myUsername ? ' is-me' : '');

    const av = document.createElement('div');
    av.className = 'tooltip-avatar';
    av.textContent = username.substring(0, 2).toUpperCase();
    av.style.background = getAvatarColor(username);

    const name = document.createElement('span');
    name.className = 'tooltip-name';
    name.textContent = username;

    row.appendChild(av);
    row.appendChild(name);
    if (username === myUsername) {
      const badge = document.createElement('span');
      badge.className = 'tooltip-you-badge';
      badge.textContent = 'Kamu';
      row.appendChild(badge);
    }
    onlineTooltip.appendChild(row);
  });
}

function toggleOnlineTooltip() {
  tooltipOpen = !tooltipOpen;
  onlineTooltip.classList.toggle('hidden', !tooltipOpen);
}

// Click anywhere outside cluster closes tooltip
document.addEventListener('click', (e) => {
  const cluster = $('header-online-cluster');
  if (!cluster) return;
  if (cluster.contains(e.target)) {
    // handled by pill & avatars click listeners — don't double-fire
  } else if (tooltipOpen) {
    tooltipOpen = false;
    onlineTooltip.classList.add('hidden');
  }
});

// ══════════════════════════════════════════════════════════════════
// SCROLL
// ══════════════════════════════════════════════════════════════════
function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// ══════════════════════════════════════════════════════════════════
// SOCKET EVENTS
// ══════════════════════════════════════════════════════════════════
socket.on('chat:message',     msg   => renderMessage(msg));
socket.on('system:message',   msg   => renderSystemMessage(msg));
socket.on('users:online',     users => renderOnlineUsers(users));
socket.on('messages:history', msgs  => renderHistory(msgs));

socket.on('chat:typing', ({ username, isTyping: typing }) => {
  if (username === myUsername) return;
  typing ? activeTypers.add(username) : activeTypers.delete(username);
  updateTypingIndicator();
});

socket.on('chat:deleted', ({ msgId }) => removeMsgById(String(msgId)));
socket.on('error', ({ message }) => showToast(message, 'error', 3000));
// Admin: user di-kick / di-ban / di-suspend
socket.on('admin:kicked', ({ message }) => {
  showToast(message || 'Kamu telah dikeluarkan oleh admin.', 'error', 5000);
  clearSession();
  // Kembali ke layar auth setelah 2 detik
  setTimeout(() => {
    myRoomCode = '';
    myRoomName = '';
    showScreen('auth');
  }, 2000);
});
 
// Admin: room dihapus
socket.on('admin:room_deleted', ({ message }) => {
  showToast(message || 'Room ini telah dihapus oleh admin.', 'error', 5000);
  myRoomCode = '';
  myRoomName = '';
  setTimeout(() => goToRoomScreen(), 2000);
});

socket.on('disconnect', reason => {
  if (['io server disconnect','transport close'].includes(reason)) {
    renderSystemMessage({ text: 'Koneksi terputus…', timestamp: new Date().toISOString() });
  }
});
socket.on('reconnect', () => {
  if (myUsername && myRoomCode) {
    renderSystemMessage({ text: 'Terhubung kembali ✓', timestamp: new Date().toISOString() });
    socket.emit('room:join', { token: myToken, roomCode: myRoomCode });
  }
});

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
if (myToken) goToRoomScreen(); else showScreen('auth');