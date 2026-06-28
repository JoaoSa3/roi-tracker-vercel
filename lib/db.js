const { kv } = require("@vercel/kv");

// Keys:
//   user:<username>  → { id, username, password, createdAt }
//   user_idx:<id>    → username (reverse lookup)
//   config:<userId>  → { bancaInicial, meta, roi, updatedAt }
//   hist:<userId>    → JSON array of { dia, weekday, valor, roi, fechado, createdAt, updatedAt }
//   user_counter      → integer (auto-increment user id)

async function createUser(username, hashedPassword) {
  // Check if username already exists
  const existing = await kv.get("user:" + username);
  if (existing) return null;
  
  const id = await kv.incr("user_counter");
  const user = { id, username, password: hashedPassword, createdAt: new Date().toISOString() };
  await kv.set("user:" + username, JSON.stringify(user));
  await kv.set("user_idx:" + id, username);
  return user;
}

async function getUserByUsername(username) {
  const raw = await kv.get("user:" + username);
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
}

async function getUserById(id) {
  const username = await kv.get("user_idx:" + id);
  if (!username) return null;
  return getUserByUsername(username);
}

async function getConfig(userId) {
  const raw = await kv.get("config:" + userId);
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
}

async function saveConfig(userId, data) {
  const updatedAt = new Date().toISOString();
  const existing = await getConfig(userId) || {};
  const merged = { ...existing, ...data, updatedAt };
  await kv.set("config:" + userId, JSON.stringify(merged));
  return merged;
}

async function getHistorico(userId) {
  const raw = await kv.get("hist:" + userId);
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
}

async function saveHistorico(userId, entries) {
  await kv.set("hist:" + userId, JSON.stringify(entries));
}

async function addHistoricoEntry(userId, entry) {
  const entries = await getHistorico(userId);
  const existingIdx = entries.findIndex(e => e.dia === entry.dia);
  if (existingIdx >= 0) {
    entries[existingIdx] = { ...entries[existingIdx], ...entry, updatedAt: new Date().toISOString() };
  } else {
    entries.push({ ...entry, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  await saveHistorico(userId, entries);
  return entries;
}

async function deleteHistorico(userId) {
  await kv.del("hist:" + userId);
}

module.exports = {
  createUser,
  getUserByUsername,
  getUserById,
  getConfig,
  saveConfig,
  getHistorico,
  saveHistorico,
  addHistoricoEntry,
  deleteHistorico,
};
