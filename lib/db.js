// db.js — Edge Config database adapter for Vercel
// Reads: @vercel/edge-config SDK (ultra-fast)
// Writes: Vercel REST API (authenticated)
// Falls back to in-memory store when Edge Config is not configured

let ecGet, ecGetAll, ecHas;
try {
  const ec = require("@vercel/edge-config");
  ecGet = ec.get;
  ecGetAll = ec.getAll;
  ecHas = ec.has;
} catch (e) {}

const https = require("https");

function getEdgeConfigId() {
  const val = process["env"]["EDGE_CONFIG"] || "";
  const match = val.match(/(ecfg_[a-z0-9]+)/);
  return match ? match[1] : null;
}

function getApiToken() {
  return process["env"]["EDGE_CONFIG_ACCESS_TOKEN"] || "";
}

const hasEdgeConfig = () => getEdgeConfigId();

async function _ecSet(key, value) {
  const configId = getEdgeConfigId();
  const apiToken = getApiToken();
  if (!configId || !apiToken) return;

  const data = JSON.stringify({ items: [{ operation: "upsert", key, value }] });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.vercel.com",
      path: "/v1/edge-config/" + configId + "/items",
      method: "PATCH",
      headers: {
        "Authorization": "Bearer " + apiToken,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else { console.error("EC write error:", res.statusCode, body.substring(0, 200)); resolve(); }
      });
    });
    req.on("error", (e) => { console.error("EC write error:", e.message); resolve(); });
    req.write(data);
    req.end();
  });
}

function _parse(raw) {
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

const memoryStore = { users: {}, userCounter: 0, configs: {}, historico: {} };

async function createUser(username, hashedPassword) {
  if (hasEdgeConfig()) {
    const existing = await ecGet("user:" + username);
    if (existing) return null;
    let counter = (await ecGet("user_counter")) || 0;
    counter++;
    await _ecSet("user_counter", counter);
    const user = { id: counter, username, password: hashedPassword, createdAt: new Date().toISOString() };
    await _ecSet("user:" + username, user);
    await _ecSet("user_idx:" + counter, username);
    return user;
  }
  if (memoryStore.users[username]) return null;
  memoryStore.userCounter++;
  const user = { id: memoryStore.userCounter, username, password: hashedPassword, createdAt: new Date().toISOString() };
  memoryStore.users[username] = user;
  return user;
}

async function getUserByUsername(username) {
  if (hasEdgeConfig()) return _parse(await ecGet("user:" + username));
  return memoryStore.users[username] || null;
}

async function getUserById(id) {
  if (hasEdgeConfig()) {
    const username = await ecGet("user_idx:" + id);
    if (!username) return null;
    return getUserByUsername(typeof username === "string" ? username : String(username));
  }
  return Object.values(memoryStore.users).find(u => u.id === id) || null;
}

async function getConfig(userId) {
  if (hasEdgeConfig()) return _parse(await ecGet("config:" + userId));
  return memoryStore.configs[userId] || null;
}

async function saveConfig(userId, data) {
  const updatedAt = new Date().toISOString();
  const existing = await getConfig(userId) || {};
  const merged = { ...existing, ...data, updatedAt };
  if (hasEdgeConfig()) { await _ecSet("config:" + userId, merged); }
  else { memoryStore.configs[userId] = merged; }
  return merged;
}

async function getHistorico(userId) {
  if (hasEdgeConfig()) return _parse(await ecGet("hist:" + userId)) || [];
  return memoryStore.historico[userId] || [];
}

async function addHistoricoEntry(userId, entry) {
  const entries = await getHistorico(userId);
  const idx = entries.findIndex(e => e.dia === entry.dia);
  if (idx >= 0) entries[idx] = { ...entries[idx], ...entry, updatedAt: new Date().toISOString() };
  else entries.push({ ...entry, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  if (hasEdgeConfig()) { await _ecSet("hist:" + userId, entries); }
  else { memoryStore.historico[userId] = entries; }
  return entries;
}

async function deleteHistorico(userId) {
  if (hasEdgeConfig()) { await _ecSet("hist:" + userId, []); }
  else { delete memoryStore.historico[userId]; }
}

module.exports = {
  createUser, getUserByUsername, getUserById,
  getConfig, saveConfig,
  getHistorico, addHistoricoEntry, deleteHistorico,
};
