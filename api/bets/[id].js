"use strict";

const db = require("../../lib/db");
const { rota, erro } = require("../../lib/http");
const A = require("../../public/js/analytics.js");

module.exports = rota({
  auth: true,

  PATCH: async ({ user, body, query }) => {
    if (body.resultado && !A.RESULTADOS.includes(body.resultado))
      throw erro(400, "Resultado desconhecido: " + body.resultado, "VALIDACAO");

    const atualizada = await db.updateAposta(user.id, query.id, body);
    if (!atualizada) throw erro(404, "Aposta não encontrada", "NAO_ENCONTRADA");
    return { ...atualizada, lucroCalculado: A.lucroAposta(atualizada) };
  },

  DELETE: async ({ user, query }) => {
    const apagada = await db.deleteAposta(user.id, query.id);
    if (!apagada) throw erro(404, "Aposta não encontrada", "NAO_ENCONTRADA");
    return { ok: true };
  },
});
