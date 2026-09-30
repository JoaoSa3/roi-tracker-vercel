/*
  api.js — acesso a dados com dois modos, atrás de uma única interface.

    modo "servidor" → /api/*, sincronizado entre dispositivos
    modo "local"    → localStorage, para usar sem conta

  As vistas chamam sempre `Dados.*` e nunca sabem em que modo estão. Ao entrar
  na conta, o que estiver em local é migrado para o servidor.
*/
(function (global) {
  "use strict";

  const A = global.Analytics;

  const CHAVES = {
    token: "authToken",
    user: "authUser",
    config: "configROI",
    historico: "bancaHistorico",
    apostas: "apostasROI",
    objetivos: "objetivosROI",
  };

  /* ---------------------------------------------------------------- *
   * localStorage com tolerância a falhas (modo privado, quota cheia)
   * ---------------------------------------------------------------- */

  function ler(chave, fallback) {
    try {
      const bruto = localStorage.getItem(chave);
      return bruto ? JSON.parse(bruto) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function escrever(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch (e) {
      console.warn("localStorage indisponível:", e);
      return false;
    }
  }

  function apagar(chave) {
    try {
      localStorage.removeItem(chave);
    } catch (e) {
      /* ignorado */
    }
  }

  /* ---------------------------------------------------------------- *
   * Cliente HTTP
   * ---------------------------------------------------------------- */

  class ApiErro extends Error {
    constructor(mensagem, status, code) {
      super(mensagem);
      this.status = status;
      this.code = code;
    }
  }

  const token = () => ler(CHAVES.token, null);
  const autenticado = () => !!token();

  let aoExpirarSessao = () => {};

  async function pedir(caminho, opcoes = {}) {
    const headers = { ...(opcoes.headers || {}) };
    if (opcoes.body) headers["Content-Type"] = "application/json";
    const t = token();
    if (t) headers["Authorization"] = "Bearer " + t;

    let res;
    try {
      res = await fetch(caminho, {
        ...opcoes,
        headers,
        body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
      });
    } catch (e) {
      throw new ApiErro("Sem ligação ao servidor", 0, "REDE");
    }

    if (res.status === 204) return null;

    const texto = await res.text();
    let dados = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch (e) {
      dados = null;
    }

    if (!res.ok) {
      if (res.status === 401) {
        apagar(CHAVES.token);
        apagar(CHAVES.user);
        aoExpirarSessao();
      }
      throw new ApiErro(
        (dados && dados.error) || "Erro " + res.status,
        res.status,
        dados && dados.code
      );
    }
    return dados;
  }

  function qs(params) {
    const p = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") p.set(k, v);
    });
    const s = p.toString();
    return s ? "?" + s : "";
  }

  /* ---------------------------------------------------------------- *
   * Implementação local (sem conta)
   * ---------------------------------------------------------------- */

  const CONFIG_PADRAO = {
    bancaInicial: 0,
    meta: 0,
    roi: 5,
    moeda: "EUR",
    unidade: 2,
    stopLoss: 10,
    stopWin: 20,
    kellyFracao: 0.25,
    tema: "dark",
  };

  const local = {
    config: {
      obter: () => {
        const c = ler(CHAVES.config, null);
        return c ? { ...CONFIG_PADRAO, ...c } : null;
      },
      guardar: (dados) => {
        const atual = ler(CHAVES.config, {}) || {};
        const novo = {
          ...CONFIG_PADRAO,
          ...atual,
          ...dados,
          dataCriacao: atual.dataCriacao || new Date().toISOString(),
        };
        escrever(CHAVES.config, novo);
        return novo;
      },
    },

    historico: {
      listar: () => ler(CHAVES.historico, []),
      guardar: (entrada) => {
        const linhas = ler(CHAVES.historico, []);
        const dia = A.normalizarDia(entrada.dia) || A.hoje();
        const i = linhas.findIndex((l) => A.normalizarDia(l.dia) === dia);
        // `forcar` é uma instrução do pedido, não um campo do registo — se
        // ficasse gravado, todas as escritas futuras desse dia vinham forçadas.
        const { forcar, ...campos } = entrada;
        const nova = {
          ...campos,
          dia,
          weekday: entrada.weekday || A.nomeDiaSemana(dia),
          fechado: entrada.fechado ? 1 : 0,
        };
        if (i >= 0) {
          if (linhas[i].fechado && !entrada.forcar) {
            throw new ApiErro("Esse dia já está fechado.", 409, "DIA_FECHADO");
          }
          linhas[i] = { ...linhas[i], ...nova };
        } else {
          linhas.push(nova);
        }
        linhas.sort((a, b) => (a.dia < b.dia ? -1 : 1));
        escrever(CHAVES.historico, linhas);
        return { ok: true, dia };
      },
      marcar: (dia, acao) => {
        const linhas = ler(CHAVES.historico, []);
        const alvo = A.normalizarDia(dia);
        const i = linhas.findIndex((l) => A.normalizarDia(l.dia) === alvo);
        if (i < 0) throw new ApiErro("Sem registo nesse dia", 404, "SEM_REGISTO");
        linhas[i].fechado = acao === "reabrir" ? 0 : 1;
        escrever(CHAVES.historico, linhas);
        return linhas[i];
      },
      apagarDia: (dia) => {
        const alvo = A.normalizarDia(dia);
        escrever(
          CHAVES.historico,
          ler(CHAVES.historico, []).filter((l) => A.normalizarDia(l.dia) !== alvo)
        );
        return { ok: true };
      },
      apagarTudo: () => {
        escrever(CHAVES.historico, []);
        return { ok: true };
      },
    },

    apostas: {
      listar: () =>
        ler(CHAVES.apostas, [])
          .slice()
          .sort((a, b) => (a.dia < b.dia ? 1 : -1))
          .map((a) => ({ ...a, lucroCalculado: A.lucroAposta(a) })),
      criar: (aposta) => {
        const lista = ler(CHAVES.apostas, []);
        const nova = {
          ...aposta,
          id: "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          dia: A.normalizarDia(aposta.dia) || A.hoje(),
          createdAt: new Date().toISOString(),
        };
        lista.push(nova);
        escrever(CHAVES.apostas, lista);
        return nova;
      },
      atualizar: (id, patch) => {
        const lista = ler(CHAVES.apostas, []);
        const i = lista.findIndex((a) => a.id === id);
        if (i < 0) throw new ApiErro("Aposta não encontrada", 404);
        lista[i] = { ...lista[i], ...patch, id };
        escrever(CHAVES.apostas, lista);
        return lista[i];
      },
      apagar: (id) => {
        escrever(
          CHAVES.apostas,
          ler(CHAVES.apostas, []).filter((a) => a.id !== id)
        );
        return { ok: true };
      },
    },

    objetivos: {
      listar: () => {
        const config = local.config.obter() || CONFIG_PADRAO;
        const historico = A.prepararHistorico(
          ler(CHAVES.historico, []),
          config.bancaInicial
        );
        const valorAtual = historico.length
          ? historico[historico.length - 1].valor
          : Number(config.bancaInicial) || 0;

        return ler(CHAVES.objetivos, []).map((o) => {
          const projecao = A.projecao(valorAtual, config.roi, o.alvo);
          return {
            ...o,
            valorAtual,
            progresso: o.alvo > 0 ? Math.min(100, (valorAtual / o.alvo) * 100) : 0,
            atingido: valorAtual >= o.alvo,
            diasEstimados: projecao ? projecao.dias : null,
            dataEstimada: projecao ? projecao.data : null,
            noPrazo: o.prazo && projecao ? projecao.data <= o.prazo : null,
          };
        });
      },
      criar: (objetivo) => {
        const lista = ler(CHAVES.objetivos, []);
        const novo = {
          ...objetivo,
          id: "l" + Date.now().toString(36),
          alvo: Number(objetivo.alvo) || 0,
          prazo: A.normalizarDia(objetivo.prazo),
          criadoEm: new Date().toISOString(),
        };
        lista.push(novo);
        escrever(CHAVES.objetivos, lista);
        return novo;
      },
      apagar: (id) => {
        escrever(
          CHAVES.objetivos,
          ler(CHAVES.objetivos, []).filter((o) => o.id !== id)
        );
        return { ok: true };
      },
    },
  };

  /* ---------------------------------------------------------------- *
   * Interface unificada
   * ---------------------------------------------------------------- */

  const Dados = {
    ApiErro,
    CHAVES,
    CONFIG_PADRAO,

    modo: () => (autenticado() ? "servidor" : "local"),
    autenticado,
    utilizadorGuardado: () => ler(CHAVES.user, null),
    aoExpirar: (fn) => {
      aoExpirarSessao = fn;
    },

    auth: {
      entrar: async (username, password) => {
        const r = await pedir("/api/auth/login", {
          method: "POST",
          body: { username, password },
        });
        escrever(CHAVES.token, r.token);
        escrever(CHAVES.user, r.user);
        return r.user;
      },
      registar: async (username, password) => {
        const r = await pedir("/api/auth/register", {
          method: "POST",
          body: { username, password },
        });
        escrever(CHAVES.token, r.token);
        escrever(CHAVES.user, r.user);
        return r.user;
      },
      sair: () => {
        apagar(CHAVES.token);
        apagar(CHAVES.user);
      },
      perfil: () => pedir("/api/me"),
      mudarSenha: async (senhaAtual, senhaNova) => {
        const r = await pedir("/api/auth/password", {
          method: "POST",
          body: { senhaAtual, senhaNova },
        });
        if (r && r.token) escrever(CHAVES.token, r.token);
        return r;
      },
    },

    config: {
      obter: () => (autenticado() ? pedir("/api/config") : local.config.obter()),
      guardar: (dados) =>
        autenticado()
          ? pedir("/api/config", { method: "POST", body: dados })
          : local.config.guardar(dados),
    },

    historico: {
      listar: () => (autenticado() ? pedir("/api/historico") : local.historico.listar()),
      guardar: (entrada) =>
        autenticado()
          ? pedir("/api/historico", { method: "POST", body: entrada })
          : local.historico.guardar(entrada),
      fechar: (dia) =>
        autenticado()
          ? pedir("/api/historico", { method: "PATCH", body: { dia, acao: "fechar" } })
          : local.historico.marcar(dia, "fechar"),
      reabrir: (dia) =>
        autenticado()
          ? pedir("/api/historico", { method: "PATCH", body: { dia, acao: "reabrir" } })
          : local.historico.marcar(dia, "reabrir"),
      apagarDia: (dia) =>
        autenticado()
          ? pedir("/api/historico" + qs({ dia }), { method: "DELETE" })
          : local.historico.apagarDia(dia),
      apagarTudo: () =>
        autenticado()
          ? pedir("/api/historico", { method: "DELETE" })
          : local.historico.apagarTudo(),
    },

    apostas: {
      listar: (filtros) =>
        autenticado() ? pedir("/api/bets" + qs(filtros)) : local.apostas.listar(),
      criar: (aposta) =>
        autenticado()
          ? pedir("/api/bets", { method: "POST", body: aposta })
          : local.apostas.criar(aposta),
      atualizar: (id, patch) =>
        autenticado()
          ? pedir("/api/bets/" + encodeURIComponent(id), { method: "PATCH", body: patch })
          : local.apostas.atualizar(id, patch),
      apagar: (id) =>
        autenticado()
          ? pedir("/api/bets/" + encodeURIComponent(id), { method: "DELETE" })
          : local.apostas.apagar(id),
    },

    objetivos: {
      listar: () => (autenticado() ? pedir("/api/goals") : local.objetivos.listar()),
      criar: (objetivo) =>
        autenticado()
          ? pedir("/api/goals", { method: "POST", body: objetivo })
          : local.objetivos.criar(objetivo),
      apagar: (id) =>
        autenticado()
          ? pedir("/api/goals" + qs({ id }), { method: "DELETE" })
          : local.objetivos.apagar(id),
    },

    /** Estatísticas do servidor — no modo local calculamos no browser. */
    estatisticas: (dias) =>
      autenticado() ? pedir("/api/stats" + qs({ dias })) : null,

    diagnostico: () => pedir("/api/health"),

    backup: {
      exportar: async () => {
        if (autenticado()) return pedir("/api/backup");
        return {
          versao: 2,
          exportadoEm: new Date().toISOString(),
          config: local.config.obter(),
          historico: ler(CHAVES.historico, []),
          apostas: ler(CHAVES.apostas, []),
          objetivos: ler(CHAVES.objetivos, []),
        };
      },
      importar: async (dados, modo) => {
        if (autenticado()) {
          return pedir("/api/backup", { method: "POST", body: { ...dados, modo } });
        }
        if (dados.config) local.config.guardar(dados.config);
        if (Array.isArray(dados.historico)) escrever(CHAVES.historico, dados.historico);
        if (Array.isArray(dados.apostas)) escrever(CHAVES.apostas, dados.apostas);
        if (Array.isArray(dados.objetivos)) escrever(CHAVES.objetivos, dados.objetivos);
        return { ok: true };
      },
    },

    /**
     * Migra o que existir em localStorage para a conta, depois de entrar.
     * Só envia o que o servidor ainda não tem — nunca sobrepõe dados do servidor.
     */
    migrarLocalParaServidor: async () => {
      if (!autenticado()) return { migrado: false };
      const resultado = { config: false, dias: 0, apostas: 0 };

      const configLocal = ler(CHAVES.config, null);
      if (configLocal) {
        const remoto = await Dados.config.obter().catch(() => null);
        if (!remoto) {
          await Dados.config.guardar(configLocal);
          resultado.config = true;
        }
      }

      const historicoLocal = ler(CHAVES.historico, []);
      if (historicoLocal.length) {
        const remoto = await Dados.historico.listar().catch(() => []);
        if (!remoto.length) {
          for (const entrada of historicoLocal) {
            try {
              await Dados.historico.guardar({ ...entrada, fechado: 0 });
              resultado.dias++;
            } catch (e) {
              console.warn("Falhou a migração do dia", entrada.dia, e);
            }
          }
        }
      }

      const apostasLocais = ler(CHAVES.apostas, []);
      if (apostasLocais.length) {
        const remoto = await Dados.apostas.listar().catch(() => []);
        if (!remoto.length) {
          for (const aposta of apostasLocais) {
            try {
              await Dados.apostas.criar(aposta);
              resultado.apostas++;
            } catch (e) {
              console.warn("Falhou a migração da aposta", aposta.id, e);
            }
          }
        }
      }

      return { migrado: true, ...resultado };
    },

    limparLocal: () => {
      [CHAVES.config, CHAVES.historico, CHAVES.apostas, CHAVES.objetivos].forEach(apagar);
    },
  };

  global.Dados = Dados;
})(window);
