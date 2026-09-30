"use strict";

const db = require("../../lib/db");
const { rota, erro } = require("../../lib/http");
const A = require("../../public/js/analytics.js");

module.exports = rota({
  auth: true,

  GET: async ({ user }) => {
    const [objetivos, config, historico] = await Promise.all([
      db.getObjetivos(user.id),
      db.getConfig(user.id),
      db.getHistorico(user.id),
    ]);

    const cfg = config || db.CONFIG_PADRAO;
    const preparado = A.prepararHistorico(historico, cfg.bancaInicial);
    const valorAtual = preparado.length
      ? preparado[preparado.length - 1].valor
      : Number(cfg.bancaInicial) || 0;

    return objetivos.map((o) => {
      const alcance = o.alvo > 0 ? Math.min(100, (valorAtual / o.alvo) * 100) : 0;
      const projecao = A.projecao(valorAtual, cfg.roi, o.alvo);
      return {
        ...o,
        valorAtual,
        progresso: alcance,
        atingido: valorAtual >= o.alvo,
        diasEstimados: projecao ? projecao.dias : null,
        dataEstimada: projecao ? projecao.data : null,
        // Só conseguimos dizer se vai a tempo quando existe um prazo definido.
        noPrazo:
          o.prazo && projecao ? projecao.data <= o.prazo : null,
      };
    });
  },

  POST: async ({ user, body }) => {
    const alvo = Number(body.alvo);
    if (!isFinite(alvo) || alvo <= 0) throw erro(400, "Alvo inválido", "VALIDACAO");
    if (!body.nome) throw erro(400, "Dá um nome ao objetivo", "VALIDACAO");
    return { _status: 201, ...(await db.addObjetivo(user.id, body)) };
  },

  PATCH: async ({ user, body, query }) => {
    const id = query.id || body.id;
    if (!id) throw erro(400, "Falta o id do objetivo", "VALIDACAO");
    const atualizado = await db.updateObjetivo(user.id, id, body);
    if (!atualizado) throw erro(404, "Objetivo não encontrado", "NAO_ENCONTRADO");
    return atualizado;
  },

  DELETE: async ({ user, query }) => {
    if (!query.id) throw erro(400, "Falta o id do objetivo", "VALIDACAO");
    const apagado = await db.deleteObjetivo(user.id, query.id);
    if (!apagado) throw erro(404, "Objetivo não encontrado", "NAO_ENCONTRADO");
    return { ok: true };
  },
});
