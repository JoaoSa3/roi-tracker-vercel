"use strict";

const db = require("../../lib/db");
const { rota, erro } = require("../../lib/http");

module.exports = rota({
  auth: true,

  // Snapshot completo da conta — o ficheiro que o botão "Exportar" descarrega.
  GET: async ({ user }) => db.exportarTudo(user.id),

  // Restauro. `modo: "substituir"` limpa antes de importar; o predefinido
  // (fundir) mantém o que já lá está e sobrepõe por data/id.
  POST: async ({ user, body }) => {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw erro(400, "Backup inválido", "VALIDACAO");
    if (!body.config && !body.historico && !body.apostas)
      throw erro(400, "O ficheiro não contém dados reconhecíveis", "VALIDACAO");

    if (body.modo === "substituir") await db.apagarDados(user.id);

    if (body.modo !== "substituir" && Array.isArray(body.historico)) {
      const atual = await db.getHistorico(user.id);
      const porDia = new Map(atual.map((e) => [e.dia, e]));
      body.historico.forEach((e) => porDia.set(e.dia, { ...porDia.get(e.dia), ...e }));
      body.historico = [...porDia.values()];
    }

    if (body.modo !== "substituir" && Array.isArray(body.apostas)) {
      const atual = await db.getApostas(user.id);
      const porId = new Map(atual.map((a) => [a.id, a]));
      body.apostas.forEach((a) => porId.set(a.id, { ...porId.get(a.id), ...a }));
      body.apostas = [...porId.values()];
    }

    return { ok: true, importado: await db.importarTudo(user.id, body) };
  },

  // Apaga os dados do utilizador (mantém a conta). Exige confirmação explícita.
  DELETE: async ({ user, query }) => {
    if (query.confirmar !== "sim")
      throw erro(400, "Falta ?confirmar=sim", "CONFIRMACAO");
    await db.apagarDados(user.id);
    return { ok: true };
  },
});
