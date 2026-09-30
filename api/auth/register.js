"use strict";

const bcrypt = require("bcryptjs");
const db = require("../../lib/db");
const { generateToken, rateLimit, validarCredenciais } = require("../../lib/auth");
const { rota, erro, ipDoPedido } = require("../../lib/http");

module.exports = rota({
  POST: async ({ req, body }) => {
    const { username, password } = body;

    const invalido = validarCredenciais(username, password);
    if (invalido) throw erro(400, invalido, "VALIDACAO");

    const limite = await rateLimit("register:" + ipDoPedido(req), {
      max: 5,
      janelaSegundos: 3600,
    });
    if (!limite.permitido) {
      throw erro(429, "Demasiadas contas criadas a partir deste IP.", "RATE_LIMIT");
    }

    const hashed = bcrypt.hashSync(password, 10);
    const user = await db.createUser(username, hashed);
    if (!user) throw erro(409, "Nome de utilizador indisponível", "USERNAME_OCUPADO");

    return {
      _status: 201,
      user: { id: user.id, username: user.username },
      token: generateToken(user),
    };
  },
});
