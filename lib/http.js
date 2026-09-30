"use strict";

/*
  http.js — plumbing partilhado pelas serverless functions.

  Dá a cada rota: routing por método, parsing seguro do body, cabeçalhos de
  segurança, erros uniformes e um wrapper de autenticação — para os handlers
  ficarem só com a lógica de negócio.
*/

const { verifyToken } = require("./auth");

class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function erro(status, message, code) {
  return new ApiError(status, message, code);
}

function cabecalhosSeguranca(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
}

/** O runtime Node da Vercel já faz o parse, mas não contamos com isso. */
async function lerJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      throw erro(400, "JSON inválido");
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) {
    throw erro(400, "JSON inválido");
  }
}

/**
 * Constrói um handler a partir de um mapa de métodos.
 *
 *   module.exports = rota({
 *     auth: true,
 *     GET: async ({ user }) => ({ ola: user.username }),
 *   });
 *
 * O valor devolvido é serializado como JSON (200). Para outro status, devolve
 * `{ _status: 201, ...corpo }` ou lança `erro(...)`.
 */
function rota(definicao) {
  const { auth = false, ...metodos } = definicao;
  const permitidos = Object.keys(metodos).filter((m) => m === m.toUpperCase());

  return async function handler(req, res) {
    cabecalhosSeguranca(res);

    if (req.method === "OPTIONS") {
      res.setHeader("Allow", permitidos.join(", "));
      return res.status(204).end();
    }

    const fn = metodos[req.method];
    if (!fn) {
      res.setHeader("Allow", permitidos.join(", "));
      return res
        .status(405)
        .json({ error: "Método não permitido", code: "METODO_INVALIDO" });
    }

    try {
      let user = null;
      if (auth) {
        user = verifyToken(req.headers["authorization"]);
        if (!user) throw erro(401, "Sessão inválida ou expirada", "NAO_AUTENTICADO");
      }

      const body = ["POST", "PUT", "PATCH"].includes(req.method)
        ? await lerJson(req)
        : {};

      const resultado = await fn({ req, res, user, body, query: req.query || {} });

      if (res.writableEnded) return undefined;
      if (resultado === undefined) return res.status(204).end();

      const { _status, ...corpo } =
        resultado && typeof resultado === "object" && !Array.isArray(resultado)
          ? resultado
          : { _status: 200, _valor: resultado };

      const payload = "_valor" in corpo ? corpo._valor : corpo;
      return res.status(_status || 200).json(payload);
    } catch (e) {
      if (e instanceof ApiError) {
        return res.status(e.status).json({ error: e.message, code: e.code });
      }
      console.error("Erro não tratado em", req.url, e);
      return res
        .status(500)
        .json({ error: "Erro interno do servidor", code: "ERRO_INTERNO" });
    }
  };
}

function ipDoPedido(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "desconhecido";
}

module.exports = { rota, erro, ApiError, lerJson, ipDoPedido };
