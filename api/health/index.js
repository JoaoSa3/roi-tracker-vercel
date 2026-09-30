"use strict";

/*
  Diagnóstico sem autenticação. Não devolve segredos — só diz que driver de
  armazenamento apanhou e se o JWT_SECRET foi configurado, que é exatamente o
  que costuma estar errado num deploy novo.
*/

const store = require("../../lib/store");
const { rota } = require("../../lib/http");

module.exports = rota({
  GET: async () => {
    const driver = store.driverName();
    const jwtConfigurado = !!process.env.JWT_SECRET;

    const avisos = [];
    if (driver === "memory")
      avisos.push(
        "Sem storage persistente: os dados desaparecem a cada cold start. " +
          "Liga um Vercel KV (ou Upstash) ao projeto."
      );
    if (!jwtConfigurado)
      avisos.push("JWT_SECRET não está definido — as sessões usam a chave de dev.");

    return {
      ok: avisos.length === 0,
      armazenamento: driver,
      persistente: store.isPersistent(),
      jwtConfigurado,
      ambiente: process.env.VERCEL_ENV || "local",
      avisos,
      hora: new Date().toISOString(),
    };
  },
});
