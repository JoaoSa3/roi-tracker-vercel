// db.js — Dual-mode database: Vercel KV (production) or in-memory (fallback)
// When Vercel KV env vars are present, it uses KV for persistent storage
// Otherwise falls back to in-memory store (data lost on cold start, but client
// side localStorage syncs data back on each request)

let kv = null;
try {
  const kvModule = require("@vercel/kv");
  kv = kvModule.kv;
} catch (e) {
  // KV not available
}

const hasKV = () => kv && process.env.KV_REST_API_URL;

// In-memory fallback store
const memoryStore = {
  users: {},
  userCounter: 0,
  configs: {},
  historico: {},
};

function _parse(raw) {
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function createUser(username, hashedPassword) {
  if (hasKV()) {
    const existing = await kv.get("user:" + username);
    if (existing) return null;
    const id = await kv.incr("user_counter");
    const user = { id, username, password: hashedPassword, createdAt: new Date().toISOString() };
    await kv.set("user:" + username, JSON.stringify(user));
    await kv.set("user_idx:" + id, username);
    return user;
  }
  // Memory fallback
  if (memoryStore.users[username]) return null;
  memoryStore.userCounter++;
  const user = { id: memoryStore.userCounter, username, password: hashedPassword, createdAt: new Date().toISOString() };
  memoryStore.users[username] = user;
  return user;
}

async function getUserByUsername(username) {
  if (hasKV()) {
    const raw = await kv.get("user:" + username);
    return _parse(raw);
  }
  return memoryStore.users[username] || null;
}

async function getUserById(id) {
  if (hasKV()) {
    const username = await kv.get("user_idx:" + id);
    if (!username) return null;
    return getUserByUsername(username);
  }
  return Object.values(memoryStore.users).find(u => u.id === id) || null;
}

async function getConfig(userId) {
  if (hasKV()) {
    const raw = await kv.get("config:" + userId);
    return _parse(raw);
  }
  return memoryStore.configs[userId] || null;
}

async function saveConfig(userId, data) {
  const updatedAt = new Date().toISOString();
  const existing = await getConfig(userId) || {};
  const merged = { ...existing, ...data, updatedAt };
  if (hasKV()) {
    await kv.set("config:" + userId, JSON.stringify(merged));
  } else {
    memoryStore.configs[userId] = merged;
  }
  return merged;
}

async function getHistorico(userId) {
  if (hasKV()) {
    const raw = await kv.get("hist:" + userId);
    return _parse(raw) || [];
  }
  return memoryStore.historico[userId] || [];
}

async function addHistoricoEntry(userId, entry) {
  const entries = await getHistorico(userId);
  const existingIdx = entries.findIndex(e => e.dia === entry.dia);
  if (existingIdx >= 0) {
    entries[existingIdx] = { ...entries[existingIdx], ...entry, updatedAt: new Date().toISOString() };
  } else {
    entries.push({ ...entry, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  if (hasKV()) {
    await kv.set("hist:" + userId, JSON.stringify(entries));
  } else {
    memoryStore.historico[userId] = entries;
  }
  return entries;
}

async function deleteHistorico(userId) {
  if (hasKV()) {
    await kv.del("hist:" + userId);
  } else {
    delete memoryStore.historico[userId];
  }
}

module.exports = {
  createUser, getUserByUsername, getUserById,
  getConfig, saveConfig,
  getHistorico, addHistoricoEntry, deleteHistorico,
};
