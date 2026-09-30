"use strict";

/*
  db.js — modelo de dados do ROI Tracker sobre `store.js`.

  Coleções (uma chave por utilizador, valor = JSON):
    user-<username>   → { id, username, password, createdAt, ... }
    user_idx-<id>     → username
    user_counter      → inteiro auto-incremental
    config-<id>       → preferências + parâmetros de risco
    hist-<id>         → [] snapshots diários de banca
    bets-<id>         → [] apostas/operações individuais
    goals-<id>        → [] objetivos personalizados
*/

const store = require("./store");
const { normalizarDia, ymd, nomeDiaSemana } = require("../public/js/analytics.js");

const MAX_APOSTAS = 5000;
const MAX_HISTORICO = 2000;
const MAX_OBJETIVOS = 50;

const k = {
  user: (username) => "user-" + store.safeKeyPart(username),
  userIdx: (id) => "user_idx-" + store.safeKeyPart(id),
  counter: "user_counter",
  config: (id) => "config-" + store.safeKeyPart(id),
  hist: (id) => "hist-" + store.safeKeyPart(id),
  bets: (id) => "bets-" + store.safeKeyPart(id),
  goals: (id) => "goals-" + store.safeKeyPart(id),
};

const agora = () => new Date().toISOString();

function novoId() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

async function lista(chave) {
  const valor = await store.get(chave);
  return Array.isArray(valor) ? valor : [];
}

/* ------------------------------------------------------------------ *
 * Utilizadores
 * ------------------------------------------------------------------ */

async function createUser(username, hashedPassword) {
  const existente = await store.get(k.user(username));
  if (existente) return null;

  const id = await store.incr(k.counter);
  const user = {
    id,
    username,
    password: hashedPassword,
    createdAt: agora(),
    ultimoLogin: null,
    numLogins: 0,
  };
  await store.set(k.user(username), user);
  await store.set(k.userIdx(id), username);
  return user;
}

async function getUserByUsername(username) {
  return store.get(k.user(username));
}

async function getUserById(id) {
  const username = await store.get(k.userIdx(id));
  if (!username) return null;
  return getUserByUsername(String(username));
}

async function updateUser(username, patch) {
  const user = await getUserByUsername(username);
  if (!user) return null;
  const atualizado = { ...user, ...patch, updatedAt: agora() };
  await store.set(k.user(username), atualizado);
  return atualizado;
}

async function registarLogin(username) {
  const user = await getUserByUsername(username);
  if (!user) return null;
  return updateUser(username, {
    ultimoLogin: agora(),
    numLogins: (user.numLogins || 0) + 1,
  });
}

/* ------------------------------------------------------------------ *
 * Configuração
 * ------------------------------------------------------------------ */

const CONFIG_PADRAO = {
  bancaInicial: 0,
  meta: 0,
  roi: 5,
  moeda: "EUR",
  unidade: 2, // % da banca por unidade
  stopLoss: 10, // % de perda diária que dispara o alerta
  stopWin: 20, // % de ganho diário que sugere parar
  kellyFracao: 0.25,
  tema: "dark",
};

async function getConfig(userId) {
  const guardada = await store.get(k.config(userId));
  if (!guardada) return null;
  return { ...CONFIG_PADRAO, ...guardada };
}

async function saveConfig(userId, data) {
  const existente = (await store.get(k.config(userId))) || {};
  const merged = {
    ...CONFIG_PADRAO,
    ...existente,
    ...data,
    dataCriacao: existente.dataCriacao || agora(),
    updatedAt: agora(),
  };
  await store.set(k.config(userId), merged);
  return merged;
}

/* ------------------------------------------------------------------ *
 * Histórico diário
 * ------------------------------------------------------------------ */

function normalizarEntrada(entry) {
  const dia = normalizarDia(entry.dia) || ymd(new Date());
  return {
    dia,
    weekday: entry.weekday || nomeDiaSemana(dia),
    valor: Number(entry.valor),
    roi: Number(entry.roi) || 0,
    fechado: entry.fechado ? 1 : 0,
    nota: typeof entry.nota === "string" ? entry.nota.slice(0, 500) : "",
  };
}

async function getHistorico(userId) {
  const linhas = await lista(k.hist(userId));
  // Normaliza datas legadas ("Mon Sep 29 2025") na leitura.
  return linhas
    .map((l) => ({ ...l, dia: normalizarDia(l.dia) || l.dia }))
    .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
}

async function addHistoricoEntry(userId, entry) {
  const entradas = await getHistorico(userId);
  const nova = normalizarEntrada(entry);
  const i = entradas.findIndex((e) => e.dia === nova.dia);

  if (i >= 0) {
    if (entradas[i].fechado && !entry.forcar) {
      const erro = new Error("Dia já fechado");
      erro.code = "DIA_FECHADO";
      throw erro;
    }
    entradas[i] = { ...entradas[i], ...nova, updatedAt: agora() };
  } else {
    entradas.push({ ...nova, createdAt: agora(), updatedAt: agora() });
  }

  entradas.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
  const cortadas = entradas.slice(-MAX_HISTORICO);
  await store.set(k.hist(userId), cortadas);
  return cortadas;
}

async function fecharDia(userId, dia) {
  const entradas = await getHistorico(userId);
  const alvo = normalizarDia(dia) || ymd(new Date());
  const i = entradas.findIndex((e) => e.dia === alvo);
  if (i < 0) return null;
  entradas[i] = { ...entradas[i], fechado: 1, updatedAt: agora() };
  await store.set(k.hist(userId), entradas);
  return entradas[i];
}

async function reabrirDia(userId, dia) {
  const entradas = await getHistorico(userId);
  const alvo = normalizarDia(dia);
  const i = entradas.findIndex((e) => e.dia === alvo);
  if (i < 0) return null;
  entradas[i] = { ...entradas[i], fechado: 0, updatedAt: agora() };
  await store.set(k.hist(userId), entradas);
  return entradas[i];
}

async function deleteHistoricoEntry(userId, dia) {
  const entradas = await getHistorico(userId);
  const alvo = normalizarDia(dia);
  const restantes = entradas.filter((e) => e.dia !== alvo);
  await store.set(k.hist(userId), restantes);
  return restantes;
}

async function deleteHistorico(userId) {
  await store.set(k.hist(userId), []);
}

async function replaceHistorico(userId, entradas) {
  const limpas = (entradas || [])
    .map(normalizarEntrada)
    .filter((e) => isFinite(e.valor))
    .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0))
    .slice(-MAX_HISTORICO);
  await store.set(k.hist(userId), limpas);
  return limpas;
}

/* ------------------------------------------------------------------ *
 * Apostas / operações
 * ------------------------------------------------------------------ */

function normalizarAposta(aposta) {
  const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return {
    id: aposta.id || novoId(),
    dia: normalizarDia(aposta.dia) || ymd(new Date()),
    descricao: texto(aposta.descricao, 200),
    desporto: texto(aposta.desporto, 60),
    mercado: texto(aposta.mercado, 60),
    tipster: texto(aposta.tipster, 60),
    casa: texto(aposta.casa, 60),
    stake: Number(aposta.stake) || 0,
    odd: Number(aposta.odd) || 0,
    resultado: aposta.resultado || "pendente",
    lucro: Number(aposta.lucro) || 0, // só usado em cashout
    nota: texto(aposta.nota, 500),
  };
}

async function getApostas(userId) {
  return lista(k.bets(userId));
}

async function addAposta(userId, aposta) {
  const apostas = await getApostas(userId);
  const nova = { ...normalizarAposta(aposta), createdAt: agora(), updatedAt: agora() };
  apostas.push(nova);
  await store.set(k.bets(userId), apostas.slice(-MAX_APOSTAS));
  return nova;
}

async function updateAposta(userId, id, patch) {
  const apostas = await getApostas(userId);
  const i = apostas.findIndex((a) => a.id === id);
  if (i < 0) return null;
  const atualizada = {
    ...normalizarAposta({ ...apostas[i], ...patch, id }),
    createdAt: apostas[i].createdAt,
    updatedAt: agora(),
  };
  apostas[i] = atualizada;
  await store.set(k.bets(userId), apostas);
  return atualizada;
}

async function deleteAposta(userId, id) {
  const apostas = await getApostas(userId);
  const restantes = apostas.filter((a) => a.id !== id);
  if (restantes.length === apostas.length) return false;
  await store.set(k.bets(userId), restantes);
  return true;
}

async function replaceApostas(userId, apostas) {
  const limpas = (apostas || [])
    .map((a) => ({ ...normalizarAposta(a), createdAt: a.createdAt || agora(), updatedAt: agora() }))
    .slice(-MAX_APOSTAS);
  await store.set(k.bets(userId), limpas);
  return limpas;
}

/* ------------------------------------------------------------------ *
 * Objetivos
 * ------------------------------------------------------------------ */

async function getObjetivos(userId) {
  return lista(k.goals(userId));
}

async function addObjetivo(userId, objetivo) {
  const objetivos = await getObjetivos(userId);
  const novo = {
    id: objetivo.id || novoId(),
    nome: String(objetivo.nome || "Objetivo").slice(0, 80),
    alvo: Number(objetivo.alvo) || 0,
    prazo: normalizarDia(objetivo.prazo),
    criadoEm: agora(),
    atingidoEm: null,
  };
  objetivos.push(novo);
  await store.set(k.goals(userId), objetivos.slice(0, MAX_OBJETIVOS));
  return novo;
}

async function updateObjetivo(userId, id, patch) {
  const objetivos = await getObjetivos(userId);
  const i = objetivos.findIndex((o) => o.id === id);
  if (i < 0) return null;
  objetivos[i] = { ...objetivos[i], ...patch, id };
  await store.set(k.goals(userId), objetivos);
  return objetivos[i];
}

async function deleteObjetivo(userId, id) {
  const objetivos = await getObjetivos(userId);
  const restantes = objetivos.filter((o) => o.id !== id);
  await store.set(k.goals(userId), restantes);
  return restantes.length !== objetivos.length;
}

/* ------------------------------------------------------------------ *
 * Backup / conta
 * ------------------------------------------------------------------ */

async function exportarTudo(userId) {
  const [config, historico, apostas, objetivos] = await Promise.all([
    getConfig(userId),
    getHistorico(userId),
    getApostas(userId),
    getObjetivos(userId),
  ]);
  return {
    versao: 2,
    exportadoEm: agora(),
    config,
    historico,
    apostas,
    objetivos,
  };
}

async function importarTudo(userId, dados) {
  const resultado = { config: false, historico: 0, apostas: 0, objetivos: 0 };
  if (dados.config) {
    await saveConfig(userId, dados.config);
    resultado.config = true;
  }
  if (Array.isArray(dados.historico)) {
    resultado.historico = (await replaceHistorico(userId, dados.historico)).length;
  }
  if (Array.isArray(dados.apostas)) {
    resultado.apostas = (await replaceApostas(userId, dados.apostas)).length;
  }
  if (Array.isArray(dados.objetivos)) {
    await store.set(k.goals(userId), dados.objetivos.slice(0, MAX_OBJETIVOS));
    resultado.objetivos = Math.min(dados.objetivos.length, MAX_OBJETIVOS);
  }
  return resultado;
}

async function apagarDados(userId) {
  await Promise.all([
    store.set(k.hist(userId), []),
    store.set(k.bets(userId), []),
    store.set(k.goals(userId), []),
  ]);
}

module.exports = {
  CONFIG_PADRAO,
  novoId,
  // utilizadores
  createUser,
  getUserByUsername,
  getUserById,
  updateUser,
  registarLogin,
  // config
  getConfig,
  saveConfig,
  // histórico
  getHistorico,
  addHistoricoEntry,
  fecharDia,
  reabrirDia,
  deleteHistoricoEntry,
  deleteHistorico,
  replaceHistorico,
  // apostas
  getApostas,
  addAposta,
  updateAposta,
  deleteAposta,
  replaceApostas,
  // objetivos
  getObjetivos,
  addObjetivo,
  updateObjetivo,
  deleteObjetivo,
  // backup
  exportarTudo,
  importarTudo,
  apagarDados,
};
