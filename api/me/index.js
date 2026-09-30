"use strict";

const db = require("../../lib/db");
const store = require("../../lib/store");
const { rota, erro } = require("../../lib/http");

module.exports = rota({
  auth: true,
  GET: async ({ user }) => {
    const linha = await db.getUserById(user.id);
    if (!linha) throw erro(404, "Utilizador não encontrado");

    const [historico, apostas] = await Promise.all([
      db.getHistorico(user.id),
      db.getApostas(user.id),
    ]);

    return {
      id: linha.id,
      username: linha.username,
      createdAt: linha.createdAt,
      ultimoLogin: linha.ultimoLogin,
      numLogins: linha.numLogins || 0,
      totais: { dias: historico.length, apostas: apostas.length },
      armazenamento: {
        driver: store.driverName(),
        persistente: store.isPersistent(),
      },
    };
  },
});
