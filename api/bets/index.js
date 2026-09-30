"use strict";

const db = require("../../lib/db");
const { rota, erro } = require("../../lib/http");
const A = require("../../public/js/analytics.js");

function validarAposta(body) {
  const stake = Number(body.stake);
  const odd = Number(body.odd);

  if (!isFinite(stake) || stake <= 0) throw erro(400, "Stake inválida", "VALIDACAO");
  if (body.resultado !== "cashout" && (!isFinite(odd) || odd < 1))
    throw erro(400, "Odd tem de ser ≥ 1", "VALIDACAO");
  if (body.resultado && !A.RESULTADOS.includes(body.resultado))
    throw erro(400, "Resultado desconhecido: " + body.resultado, "VALIDACAO");

  const dia = A.normalizarDia(body.dia) || A.hoje();
  if (dia > A.hoje()) throw erro(400, "Não podes registar apostas no futuro", "VALIDACAO");

  return { ...body, stake, odd, dia };
}

module.exports = rota({
  auth: true,

  // Filtros opcionais: ?dia=, ?de=&ate=, ?resultado=, ?tipster=, ?limite=
  GET: async ({ user, query }) => {
    let apostas = await db.getApostas(user.id);

    if (query.dia) apostas = apostas.filter((a) => a.dia === A.normalizarDia(query.dia));
    if (query.de) apostas = apostas.filter((a) => a.dia >= A.normalizarDia(query.de));
    if (query.ate) apostas = apostas.filter((a) => a.dia <= A.normalizarDia(query.ate));
    if (query.resultado) apostas = apostas.filter((a) => a.resultado === query.resultado);
    if (query.tipster) apostas = apostas.filter((a) => a.tipster === query.tipster);

    apostas = apostas.sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0));

    const limite = Math.min(Number(query.limite) || 500, 2000);
    return apostas.slice(0, limite).map((a) => ({ ...a, lucroCalculado: A.lucroAposta(a) }));
  },

  POST: async ({ user, body }) => {
    const nova = await db.addAposta(user.id, validarAposta(body));
    return { _status: 201, ...nova, lucroCalculado: A.lucroAposta(nova) };
  },
});
