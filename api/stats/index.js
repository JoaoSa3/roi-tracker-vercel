"use strict";

/*
  Analítica completa calculada no servidor, com o MESMO módulo que o browser
  usa (`public/js/analytics.js`). Útil para integrações externas e para
  confirmar que o dashboard e a API nunca divergem.
*/

const db = require("../../lib/db");
const { rota } = require("../../lib/http");
const A = require("../../public/js/analytics.js");

module.exports = rota({
  auth: true,
  GET: async ({ user, query }) => {
    const [config, historico, apostas] = await Promise.all([
      db.getConfig(user.id),
      db.getHistorico(user.id),
      db.getApostas(user.id),
    ]);

    const cfg = config || db.CONFIG_PADRAO;
    const r = A.resumo(historico, cfg, apostas);
    const unidade = A.unidadeEmEuros(cfg, r.valorAtual);
    const dias = Math.min(Math.max(Number(query.dias) || 90, 7), 365);

    const simulacao = A.monteCarlo({
      retornos: r.retornos,
      valorInicial: r.valorAtual,
      meta: r.meta,
      roiAlvo: r.roiAlvo,
      dias,
      caminhos: 600,
    });

    // `historico` e `retornos` são séries longas — ficam fora da resposta.
    const { historico: _h, retornos: _r, ...resumoLeve } = r;

    return {
      geradoEm: new Date().toISOString(),
      resumo: resumoLeve,
      unidade,
      limites: A.estadoLimites(r, cfg),
      projecaoDeterministica: A.projecao(r.valorAtual, r.roiAlvo, r.meta),
      simulacao,
      porDiaDaSemana: A.porDiaDaSemana(r.historico),
      porMes: A.porMes(r.historico),
      distribuicao: A.histograma(r.retornos, 11),
      apostasPorTipster: A.agruparApostas(apostas, "tipster", unidade),
      apostasPorMercado: A.agruparApostas(apostas, "mercado", unidade),
      apostasPorDesporto: A.agruparApostas(apostas, "desporto", unidade),
      conquistas: A.conquistas(r),
    };
  },
});
