"use strict";

const db = require("../../lib/db");
const { rota, erro } = require("../../lib/http");

// Cada campo com o seu intervalo aceitável — a validação vive aqui e não
// espalhada pelos handlers.
const CAMPOS = {
  bancaInicial: { min: 0, max: 1e9 },
  meta: { min: 0, max: 1e9 },
  roi: { min: -100, max: 100 },
  unidade: { min: 0.1, max: 100 },
  stopLoss: { min: 0, max: 100 },
  stopWin: { min: 0, max: 1000 },
  kellyFracao: { min: 0.01, max: 1 },
};

const TEMAS = ["dark", "light"];

function validar(body) {
  const limpo = {};

  for (const [campo, { min, max }] of Object.entries(CAMPOS)) {
    if (body[campo] === undefined || body[campo] === null || body[campo] === "") continue;
    const n = Number(body[campo]);
    if (!isFinite(n)) throw erro(400, `Campo "${campo}" tem de ser numérico`, "VALIDACAO");
    if (n < min || n > max)
      throw erro(400, `Campo "${campo}" tem de estar entre ${min} e ${max}`, "VALIDACAO");
    limpo[campo] = n;
  }

  if (body.moeda) limpo.moeda = String(body.moeda).slice(0, 3).toUpperCase();
  if (body.tema && TEMAS.includes(body.tema)) limpo.tema = body.tema;

  if (limpo.meta !== undefined && limpo.bancaInicial !== undefined && limpo.meta > 0) {
    if (limpo.meta <= limpo.bancaInicial)
      throw erro(400, "A meta tem de ser superior à banca inicial", "VALIDACAO");
  }

  return limpo;
}

module.exports = rota({
  auth: true,
  GET: async ({ user }) => {
    const config = await db.getConfig(user.id);
    return { _status: 200, _valor: config };
  },
  POST: async ({ user, body }) => db.saveConfig(user.id, validar(body)),
  PATCH: async ({ user, body }) => db.saveConfig(user.id, validar(body)),
});
