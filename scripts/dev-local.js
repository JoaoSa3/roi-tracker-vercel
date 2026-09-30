"use strict";

/*
  dev-local.js — servidor de desenvolvimento sem depender do `vercel dev`
  (que exige login e ligação a um projeto na Vercel).

  Emula o runtime Node da Vercel: serve `public/` como estático e mapeia
  `/api/<rota>` para os handlers em `api/`, incluindo rotas dinâmicas como
  `/api/bets/:id` → `api/bets/[id].js`.

    npm run local          → http://localhost:3000

  Sem KV configurado corre com o driver de memória: os dados desaparecem
  quando parares o processo. É o esperado em desenvolvimento.
*/

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const RAIZ = path.join(__dirname, "..");
const PUBLICO = path.join(RAIZ, "public");
const PORTA = Number(process.env.PORT) || 3000;

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "dev-secret-nao-usar-em-producao";
  console.log("· JWT_SECRET não definido — a usar uma chave de desenvolvimento.");
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/* ------------------------------------------------------------------ *
 * Resolução de rotas da API (igual à convenção de ficheiros da Vercel)
 * ------------------------------------------------------------------ */

function resolverApi(caminho) {
  const partes = caminho.replace(/^\/api\/?/, "").split("/").filter(Boolean);

  // Exata: /api/a/b → api/a/b.js ou api/a/b/index.js
  const exatos = [
    path.join(RAIZ, "api", ...partes) + ".js",
    path.join(RAIZ, "api", ...partes, "index.js"),
  ];
  for (const f of exatos) if (fs.existsSync(f)) return { ficheiro: f, params: {} };

  // Dinâmica: o último segmento vira [param]
  if (partes.length >= 2) {
    const pasta = path.join(RAIZ, "api", ...partes.slice(0, -1));
    if (fs.existsSync(pasta)) {
      const dinamico = fs
        .readdirSync(pasta)
        .find((n) => /^\[.+\]\.js$/.test(n));
      if (dinamico) {
        const nome = dinamico.slice(1, -4).replace(/\]$/, "");
        return {
          ficheiro: path.join(pasta, dinamico),
          params: { [nome]: decodeURIComponent(partes[partes.length - 1]) },
        };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Adaptadores req/res no formato que os handlers esperam
 * ------------------------------------------------------------------ */

function lerCorpo(req) {
  return new Promise((resolve) => {
    const pedacos = [];
    req.on("data", (c) => pedacos.push(c));
    req.on("end", () => {
      if (!pedacos.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(pedacos).toString("utf8")));
      } catch (e) {
        resolve({});
      }
    });
  });
}

function adaptarRes(res) {
  res.status = (codigo) => {
    res.statusCode = codigo;
    return res;
  };
  res.json = (corpo) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(corpo));
    return res;
  };
  return res;
}

/* ------------------------------------------------------------------ *
 * Servidor
 * ------------------------------------------------------------------ */

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const inicio = Date.now();

  const registar = () =>
    console.log(
      `  ${String(res.statusCode).padEnd(3)} ${req.method.padEnd(6)} ${url.pathname}` +
        ` (${Date.now() - inicio}ms)`
    );

  if (url.pathname.startsWith("/api/")) {
    const rota = resolverApi(url.pathname);
    if (!rota) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Rota não encontrada: " + url.pathname }));
      return registar();
    }

    req.query = { ...Object.fromEntries(url.searchParams), ...rota.params };
    if (["POST", "PUT", "PATCH"].includes(req.method)) req.body = await lerCorpo(req);
    adaptarRes(res);

    try {
      // `delete require.cache` dá hot-reload aos handlers sem reiniciar.
      delete require.cache[require.resolve(rota.ficheiro)];
      await require(rota.ficheiro)(req, res);
    } catch (e) {
      console.error(e);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    return registar();
  }

  // Estático
  let relativo = url.pathname === "/" ? "/index.html" : url.pathname;
  const ficheiro = path.join(PUBLICO, path.normalize(relativo).replace(/^[\\/]+/, ""));

  if (!ficheiro.startsWith(PUBLICO)) {
    res.statusCode = 403;
    res.end("Proibido");
    return registar();
  }
  if (!fs.existsSync(ficheiro) || fs.statSync(ficheiro).isDirectory()) {
    res.statusCode = 404;
    res.end("Não encontrado");
    return registar();
  }

  res.setHeader("Content-Type", TIPOS[path.extname(ficheiro)] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.end(fs.readFileSync(ficheiro));
  registar();
});

servidor.listen(PORTA, () => {
  const store = require("../lib/store");
  console.log(`\n  ROI Tracker → http://localhost:${PORTA}`);
  console.log(`  Armazenamento: ${store.driverName()}`);
  if (!store.isPersistent())
    console.log("  (memória — os dados perdem-se ao parar o processo)\n");
  else console.log("");
});
