// db.js — Edge Config database adapter for Vercel
// Uses Edge Config for persistent storage (auto-detected via env vars)
// Falls back to in-memory store when Edge Config is not configured

let edgeConfig = null;
try {
  const { get, set } = require("@vercel/edge-config");
  edgeConfig = { get, set };
} catch (e) {
  // Edge Config not available
}

const hasEdgeConfig = () => edgeConfig && process.env.EDGE_CONFIG;

// In-memory fallback store
const memoryStore = {
  users: {},
  userCounter: 0,
  configs: {},
  historico: {},
};

async function _ecGet(key) {
  try {
    return await edgeConfig.get(key);
  } catch (e) {
    console.error("Edge Config get error:", e.message);
    return null;
  }
}

async function _ecSet(key, value) {
  try {
    await edgeConfig.set(key, value);
  } catch (e) {
    console.error("Edge Config set error:", e.message);
  }
}

function _parse(raw) {
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function createUser(username, hashedPassword) {
  if (hasEdgeConfig()) {
    const existing = await _ecGet("user:" + username);
    if (existing) return null;
    let counter = (await _ecGet("user_counter")) || 0;
    counter++;
    await _ecSet("user_counter", counter);
    const user = { id: counter, username, password: hashedPassword, createdAt: new Date().toISOString() };
    await _ecSet("user:" + username, user);
    await _ecSet("user_idx:" + counter, username);
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
  if (hasEdgeConfig()) {
    const raw = await _ecGet("user:" + username);
    return _parse(raw);
  }
  return memoryStore.users[username] || null;
}

async function getUserById(id) {
  if (hasEdgeConfig()) {
    const username = await _ecGet("user_idx:" + id);
    if (!username) return null;
    return getUserByUsername(typeof username === "string" ? username : String(username));
  }
  return Object.values(memoryStore.users).find(u => u.id === id) || null;
}

async function getConfig(userId) {
  if (hasEdgeConfig()) {
    const raw = await _ecGet("config:" + userId);
    return _parse(raw);
  }
  return memoryStore.configs[userId] || null;
}

async function saveConfig(userId, data) {
  const updatedAt = new Date().toISOString();
  const existing = await getConfig(userId) || {};
  const merged = { ...existing, ...data, updatedAt };
  if (hasEdgeConfig()) {
    await _ecSet("config:" + userId, merged);
  } else {
    memoryStore.configs[userId] = merged;
  }
  return merged;
}

async function getHistorico(userId) {
  if (hasEdgeConfig()) {
    const raw = await _ecGet("hist:" + userId);
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
  if (hasEdgeConfig()) {
    await _ecSet("hist:" + userId, entries);
  } else {
    memoryStore.historico[userId] = entries;
  }
  return entries;
}

async function deleteHistorico(userId) {
  // Edge Config doesn't support delete, so we set to empty
  if (hasEdgeConfig()) {
    await _ecSet("hist:" + userId, []);
  } else {
    delete memoryStore.historico[userId];
  }
}

module.exports = {
  createUser, getUserByUsername, getUserById,
  getConfig, saveConfig,
  getHistorico, addHistoricoEntry, deleteHistorico,
};
