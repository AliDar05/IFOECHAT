// ══════════════════════════════════════════════════════════════════
// create-admin.js
// Jalankan SEKALI untuk membuat akun admin pertama:
//   node create-admin.js
// ══════════════════════════════════════════════════════════════════

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore }        = require("firebase-admin/firestore");
const crypto                  = require("crypto");

const serviceAccount = require("./serviceAccountKey.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ─── GANTI INI ───────────────────────────────────────────────────
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin1234";  // ganti dengan password kuat!
// ─────────────────────────────────────────────────────────────────

function hashPassword(p) {
  return crypto.createHash("sha256").update(p).digest("hex");
}

async function main() {
  await db.collection("admins").doc(ADMIN_USERNAME.toLowerCase()).set({
    username: ADMIN_USERNAME,
    password: hashPassword(ADMIN_PASSWORD),
    createdAt: new Date().toISOString()
  });
  console.log(`✅ Admin "${ADMIN_USERNAME}" berhasil dibuat!`);
  console.log(`   Login di: http://localhost:3000/admin.html`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });