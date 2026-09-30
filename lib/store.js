"use strict";

/*
  store.js — camada de armazenamento key/value com drivers intermutáveis.

  Prioridade de deteção (primeiro que tiver credenciais ganha):
    1. Redis REST  — Vercel KV / Upstash  (leituras E escritas rápidas)
    2. Edge Config — leitura via SDK, escrita via API REST da Vercel (lento, rate-limited)
    3. Memória     — só para `vercel dev` / testes; não sobrevive a cold starts

  Todas as chaves têm de casar com /^[A-Za-z0-9_-]+$/ (limite do Edge Config).
  Usa `safeKeyPart()` para qualquer segmento vindo do utilizador.
*/

const KEY_RE = /^[A-Za-z0-9_-]+$/;

let ecGet;
try {
  ecGet = require("@vercel/edge-config").get;
} catch (e) {
  /* SDK ausente — driver Edge Config fica indisponível */
}

function env(name) {
  return process.env[name] || "";
}

/* ------------------------------------------------------------------ *
 * Deteção de driver
 * ------------------------------------------------------------------ */

function redisCreds() {
  const url =
    env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL") || env("REDIS_REST_URL");
  const token =
    env("KV_REST_API_TOKEN") ||
    env("UPSTASH_REDIS_REST_TOKEN") ||
    env("REDIS_REST_TOKEN");
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

function edgeConfigCreds() {
  const match = env("EDGE_CONFIG").match(/(ecfg_[A-Za-z0-9]+)/);
  const token = env("EDGE_CONFIG_ACCESS_TOKEN");
  if (!match || !token || !ecGet) return null;
  return { configId: match[1], token };
}

/* ------------------------------------------------------------------ *
 * Driver: Redis REST (Vercel KV / Upstash)
 * ------------------------------------------------------------------ */

async function redisCommand(creds, command) {
  const res = await fetch(creds.url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + creds.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("Redis " + res.status + ": " + text.slice(0, 200));
  }
  const json = await res.json();
  return json.result;
}

function redisDriver(creds) {
  return {
    name: "redis",
    async get(key) {
      return decode(await redisCommand(creds, ["GET", key]));
    },
    async set(key, value) {
      await redisCommand(creds, ["SET", key, JSON.stringify(value)]);
    },
    async del(key) {
      await redisCommand(creds, ["DEL", key]);
    },
    async incr(key) {
      return Number(await redisCommand(creds, ["INCR", key]));
    },
    async expire(key, seconds) {
      await redisCommand(creds, ["EXPIRE", key, String(seconds)]);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Driver: Edge Config
 * ------------------------------------------------------------------ */

async function edgeConfigWrite(creds, items) {
  const res = await fetch(
    "https://api.vercel.com/v1/edge-config/" + creds.configId + "/items",
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + creds.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("EdgeConfig " + res.status + ": " + text.slice(0, 200));
  }
}

function edgeConfigDriver(creds) {
  return {
    name: "edge-config",
    async get(key) {
      return decode(await ecGet(key));
    },
    async set(key, value) {
      await edgeConfigWrite(creds, [{ operation: "upsert", key, value }]);
    },
    async del(key) {
      // `delete` rebenta se a chave não existir — ignoramos esse caso.
      try {
        await edgeConfigWrite(creds, [{ operation: "delete", key }]);
      } catch (e) {
        if (!/404|not.*found/i.test(e.message)) throw e;
      }
    },
    async incr(key) {
      const current = Number(await this.get(key)) || 0;
      const next = current + 1;
      await this.set(key, next);
      return next;
    },
    async expire() {
      /* Edge Config não tem TTL — no-op */
    },
  };
}

/* ------------------------------------------------------------------ *
 * Driver: memória
 * ------------------------------------------------------------------ */

const memory = new Map();
const memoryExpiry = new Map();

const memoryDriver = {
  name: "memory",
  async get(key) {
    const expiresAt = memoryExpiry.get(key);
    if (expiresAt && expiresAt < Date.now()) {
      memory.delete(key);
      memoryExpiry.delete(key);
      return null;
    }
    const value = memory.get(key);
    return value === undefined ? null : decode(value);
  },
  async set(key, value) {
    memory.set(key, JSON.parse(JSON.stringify(value)));
  },
  async del(key) {
    memory.delete(key);
    memoryExpiry.delete(key);
  },
  async incr(key) {
    const next = (Number(await this.get(key)) || 0) + 1;
    memory.set(key, next);
    return next;
  },
  async expire(key, seconds) {
    memoryExpiry.set(key, Date.now() + seconds * 1000);
  },
};

/* ------------------------------------------------------------------ *
 * API pública
 * ------------------------------------------------------------------ */

function decode(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return raw;
  }
}

let cachedDriver = null;
let cachedSignature = "";

function driver() {
  // A assinatura evita cache preso quando o ambiente muda entre testes.
  const signature = [
    env("KV_REST_API_URL"),
    env("UPSTASH_REDIS_REST_URL"),
    env("REDIS_REST_URL"),
    env("EDGE_CONFIG"),
  ].join("|");
  if (cachedDriver && signature === cachedSignature) return cachedDriver;

  const redis = redisCreds();
  const edge = redis ? null : edgeConfigCreds();
  cachedDriver = redis
    ? redisDriver(redis)
    : edge
    ? edgeConfigDriver(edge)
    : memoryDriver;
  cachedSignature = signature;
  return cachedDriver;
}

/** Codifica um segmento de chave vindo do utilizador para o alfabeto permitido. */
function safeKeyPart(value) {
  return String(value).replace(
    /[^A-Za-z0-9_-]/g,
    (c) => "-" + c.charCodeAt(0).toString(16) + "-"
  );
}

function assertKey(key) {
  if (!KEY_RE.test(key)) throw new Error("Chave inválida para storage: " + key);
  return key;
}

module.exports = {
  safeKeyPart,
  driverName: () => driver().name,
  isPersistent: () => driver().name !== "memory",
  get: (key) => driver().get(assertKey(key)),
  set: (key, value) => driver().set(assertKey(key), value),
  del: (key) => driver().del(assertKey(key)),
  incr: (key) => driver().incr(assertKey(key)),
  expire: (key, seconds) => driver().expire(assertKey(key), seconds),
};
