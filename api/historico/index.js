"use strict";

const db = require("../../lib/db");
const { rota, erro } = require("../../lib/http");
const A = require("../../public/js/analytics.js");

function validarEntrada(body) {
  const valor = Number(body.valor);
  if (!isFinite(valor)) throw erro(400, "Saldo inválido", "VALIDACAO");
  if (valor < 0) throw erro(400, "O saldo não pode ser negativo", "VALIDACAO");
  if (valor > 1e9) throw erro(400, "Saldo fora do intervalo aceitável", "VALIDACAO");

  const dia = A.normalizarDia(body.dia) || A.hoje();
  if (dia > A.hoje()) throw erro(400, "Não podes registar dias no futuro", "VALIDACAO");

  return { ...body, dia, valor };
}

module.exports = rota({
  auth: true,

  GET: async ({ user }) => db.getHistorico(user.id),

  // Cria ou atualiza o registo de um dia (upsert por data).
  POST: async ({ user, body }) => {
    const entrada = validarEntrada(body);
    try {
      await db.addHistoricoEntry(user.id, entrada);
    } catch (e) {
      if (e.code === "DIA_FECHADO")
        throw erro(409, "Esse dia já está fechado. Reabre-o para editar.", "DIA_FECHADO");
      throw e;
    }
    return { ok: true, dia: entrada.dia };
  },

  // Fecha ou reabre um dia — o antigo `fecharDia()` só mexia no localStorage
  // e perdia-se em qualquer outro dispositivo.
  PATCH: async ({ user, body }) => {
    const dia = A.normalizarDia(body.dia) || A.hoje();
    const alvo =
      body.acao === "reabrir"
        ? await db.reabrirDia(user.id, dia)
        : await db.fecharDia(user.id, dia);
    if (!alvo) throw erro(404, "Não existe registo para esse dia", "SEM_REGISTO");
    return alvo;
  },

  // Sem `?dia=`, apaga o histórico todo.
  DELETE: async ({ user, query }) => {
    if (query.dia) {
      await db.deleteHistoricoEntry(user.id, query.dia);
      return { ok: true, apagado: query.dia };
    }
    await db.deleteHistorico(user.id);
    return { ok: true, apagado: "tudo" };
  },
});
