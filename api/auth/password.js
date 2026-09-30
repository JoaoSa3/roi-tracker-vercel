"use strict";

const bcrypt = require("bcryptjs");
const db = require("../../lib/db");
const { generateToken, validarCredenciais, rateLimit } = require("../../lib/auth");
const { rota, erro, ipDoPedido } = require("../../lib/http");

module.exports = rota({
  auth: true,
  POST: async ({ req, user, body }) => {
    const { senhaAtual, senhaNova } = body;
    if (!senhaAtual || !senhaNova) throw erro(400, "Preenche todos os campos");

    const limite = await rateLimit("password:" + ipDoPedido(req), {
      max: 5,
      janelaSegundos: 900,
    });
    if (!limite.permitido) throw erro(429, "Demasiadas tentativas.", "RATE_LIMIT");

    const invalido = validarCredenciais(user.username, senhaNova);
    if (invalido) throw erro(400, invalido, "VALIDACAO");

    const linha = await db.getUserByUsername(user.username);
    if (!linha) throw erro(404, "Utilizador não encontrado");
    if (!bcrypt.compareSync(senhaAtual, linha.password))
      throw erro(400, "Senha atual incorreta", "CREDENCIAIS");

    // Incrementar a versão permite invalidar tokens antigos no futuro.
    const atualizado = await db.updateUser(user.username, {
      password: bcrypt.hashSync(senhaNova, 10),
      tokenVersao: (linha.tokenVersao || 0) + 1,
    });

    return { ok: true, token: generateToken(atualizado) };
  },
});
