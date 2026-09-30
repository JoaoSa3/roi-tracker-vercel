"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const store = require("./store");

const JWT_SECRET = process.env.JWT_SECRET || "devsecret";
const VALIDADE = process.env.JWT_EXPIRES_IN || "7d";

if (JWT_SECRET === "devsecret" && process.env.VERCEL_ENV === "production") {
  console.warn(
    "[auth] JWT_SECRET não está definido em produção — as sessões são forjáveis. " +
      "Define-o em Settings → Environment Variables."
  );
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, v: user.tokenVersao || 0 },
    JWT_SECRET,
    { expiresIn: VALIDADE }
  );
}

function verifyToken(authHeader) {
  if (!authHeader) return null;
  const partes = String(authHeader).split(" ");
  if (partes.length !== 2 || partes[0] !== "Bearer") return null;
  try {
    return jwt.verify(partes[1], JWT_SECRET);
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Rate limiting — janela fixa sobre o store.
 * Com o driver de memória é por instância (suficiente para dev); com Redis
 * é global e é aí que conta mesmo.
 * ------------------------------------------------------------------ */

async function rateLimit(identificador, { max = 10, janelaSegundos = 300 } = {}) {
  const chave =
    "rl-" +
    store.safeKeyPart(
      crypto.createHash("sha1").update(String(identificador)).digest("hex").slice(0, 24)
    );
  try {
    const n = await store.incr(chave);
    if (n === 1) await store.expire(chave, janelaSegundos);
    return { permitido: n <= max, tentativas: n, max };
  } catch (e) {
    // Um storage em baixo não deve trancar toda a gente fora.
    console.warn("[auth] rate limit indisponível:", e.message);
    return { permitido: true, tentativas: 0, max };
  }
}

const USER_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const PASS_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

function validarCredenciais(username, password) {
  if (!username || !password) return "Preenche todos os campos";
  if (!USER_RE.test(username))
    return "Username inválido. Usa 3-30 caracteres (letras, números, _ . -).";
  if (!PASS_RE.test(password))
    return "Senha fraca. Usa 8+ caracteres com maiúscula, minúscula, dígito e símbolo.";
  return null;
}

/** 0-4, para o medidor de força no registo. */
function forcaSenha(password) {
  const p = String(password || "");
  let pontos = 0;
  if (p.length >= 8) pontos++;
  if (p.length >= 12) pontos++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) pontos++;
  if (/\d/.test(p) && /[\W_]/.test(p)) pontos++;
  return Math.min(4, pontos);
}

module.exports = {
  generateToken,
  verifyToken,
  rateLimit,
  validarCredenciais,
  forcaSenha,
  USER_RE,
  PASS_RE,
};
