"use strict";

const bcrypt = require("bcryptjs");
const db = require("../../lib/db");
const { generateToken, rateLimit } = require("../../lib/auth");
const { rota, erro, ipDoPedido } = require("../../lib/http");

// Hash descartável: comparamos contra ele quando o utilizador não existe, para
// o tempo de resposta não revelar que usernames estão registados.
const HASH_FALSO = bcrypt.hashSync("hash-que-nunca-corresponde", 10);

module.exports = rota({
  POST: async ({ req, body }) => {
    const { username, password } = body;
    if (!username || !password) throw erro(400, "Preenche todos os campos");

    const limite = await rateLimit("login:" + ipDoPedido(req), {
      max: 10,
      janelaSegundos: 300,
    });
    if (!limite.permitido) {
      throw erro(
        429,
        "Demasiadas tentativas. Espera alguns minutos.",
        "RATE_LIMIT"
      );
    }

    const linha = await db.getUserByUsername(username);
    const ok = bcrypt.compareSync(password, linha ? linha.password : HASH_FALSO);
    if (!linha || !ok) throw erro(400, "Credenciais inválidas", "CREDENCIAIS");

    await db.registarLogin(username);

    const user = { id: linha.id, username: linha.username, tokenVersao: linha.tokenVersao };
    return {
      user: { id: user.id, username: user.username },
      token: generateToken(user),
    };
  },
});
