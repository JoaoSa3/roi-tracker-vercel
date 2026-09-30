/*
  ui.js — formatadores, notificações e utilitários de DOM.
  Sem estado de aplicação: só coisas que qualquer vista pode usar.
*/
(function (global) {
  "use strict";

  let moedaAtual = "EUR";

  const Fmt = {
    definirMoeda(codigo) {
      if (codigo) moedaAtual = codigo;
    },

    moeda(valor, casas) {
      const n = Number(valor);
      if (!isFinite(n)) return "—";
      try {
        return n.toLocaleString("pt-PT", {
          style: "currency",
          currency: moedaAtual,
          minimumFractionDigits: casas === undefined ? 2 : casas,
          maximumFractionDigits: casas === undefined ? 2 : casas,
        });
      } catch (e) {
        return n.toFixed(2) + " " + moedaAtual;
      }
    },

    /** Versão compacta para eixos: 1,2 k€ em vez de 1 234,00 €. */
    moedaCurta(valor) {
      const n = Number(valor);
      if (!isFinite(n)) return "—";
      const abs = Math.abs(n);
      if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",") + " M";
      if (abs >= 1e4) return (n / 1e3).toFixed(0) + " k";
      if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(".", ",") + " k";
      return n.toFixed(0);
    },

    pct(valor, casas) {
      const n = Number(valor);
      if (!isFinite(n)) return "—";
      return n.toFixed(casas === undefined ? 2 : casas).replace(".", ",") + "%";
    },

    /** Com sinal explícito — para variações onde a direção é a informação. */
    pctSinal(valor, casas) {
      const n = Number(valor);
      if (!isFinite(n)) return "—";
      return (n > 0 ? "+" : "") + Fmt.pct(n, casas);
    },

    moedaSinal(valor, casas) {
      const n = Number(valor);
      if (!isFinite(n)) return "—";
      return (n > 0 ? "+" : "") + Fmt.moeda(n, casas);
    },

    numero(valor, casas) {
      const n = Number(valor);
      if (!isFinite(n)) return "—";
      return n.toFixed(casas === undefined ? 2 : casas).replace(".", ",");
    },

    /** "2026-09-30" → "30 set" */
    dataCurta(dia) {
      if (!dia) return "—";
      const d = global.Analytics.paraData(dia);
      return d.toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
    },

    /** "2026-09-30" → "30 set 2026" */
    dataLonga(dia) {
      if (!dia) return "—";
      const d = global.Analytics.paraData(dia);
      return d.toLocaleDateString("pt-PT", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    },

    /** "2026-09" → "set 2026" */
    mes(chave) {
      if (!chave) return "—";
      const [ano, m] = chave.split("-").map(Number);
      return new Date(ano, m - 1, 1).toLocaleDateString("pt-PT", {
        month: "short",
        year: "numeric",
      });
    },

    relativo(iso) {
      if (!iso) return "nunca";
      const dif = Date.now() - new Date(iso).getTime();
      const min = Math.round(dif / 60000);
      if (min < 1) return "agora mesmo";
      if (min < 60) return `há ${min} min`;
      const horas = Math.round(min / 60);
      if (horas < 24) return `há ${horas} h`;
      const dias = Math.round(horas / 24);
      return dias === 1 ? "ontem" : `há ${dias} dias`;
    },
  };

  /* ---------------------------------------------------------------- *
   * Notificações
   * ---------------------------------------------------------------- */

  const ICONES = { success: "✓", error: "✕", info: "i", warning: "!" };

  function toast(tipo, texto, duracao) {
    const zona = document.getElementById("toasts");
    if (!zona) return;

    const el = document.createElement("div");
    el.className = "toast " + (tipo === "warning" ? "info" : tipo);
    el.setAttribute("role", tipo === "error" ? "alert" : "status");

    const icone = document.createElement("strong");
    icone.textContent = ICONES[tipo] || "i";
    const corpo = document.createElement("span");
    corpo.textContent = texto;

    el.append(icone, corpo);
    zona.appendChild(el);

    setTimeout(() => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 260);
    }, duracao || 3600);
  }

  /* ---------------------------------------------------------------- *
   * DOM
   * ---------------------------------------------------------------- */

  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

  function definirTexto(id, texto) {
    const el = document.getElementById(id);
    if (el) el.textContent = texto;
  }

  function definirHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function mostrar(id, visivel) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", !visivel);
  }

  /** Classe de polaridade a partir de um número. */
  function sinalClasse(n) {
    if (!isFinite(n) || n === 0) return "neutral";
    return n > 0 ? "pos" : "neg";
  }

  /** Escapa texto antes de o meter em innerHTML. */
  function esc(valor) {
    return String(valor === null || valor === undefined ? "" : valor).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  /** Lê um token de cor do CSS para os gráficos acompanharem o tema. */
  function token(nome) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(nome)
      .trim();
  }

  /** Converte um hex do tema para rgba com alfa (bandas e áreas). */
  function alfa(hex, a) {
    const h = String(hex).replace("#", "");
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function confirmar(mensagem) {
    return global.confirm(mensagem);
  }

  function descarregar(nomeFicheiro, conteudo, tipo) {
    const blob = new Blob([conteudo], { type: tipo || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeFicheiro;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  global.UI = {
    Fmt,
    toast,
    $,
    $$,
    definirTexto,
    definirHtml,
    mostrar,
    sinalClasse,
    esc,
    token,
    alfa,
    confirmar,
    descarregar,
  };
})(window);
