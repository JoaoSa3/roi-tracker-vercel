/*
  analytics.js — motor de cálculo do ROI Tracker.

  Módulo UMD: é carregado tal e qual pelo browser (`window.Analytics`) e pelas
  serverless functions (`require("../../public/js/analytics.js")`), por isso a
  matemática vive num sítio só. Funções puras, sem DOM e sem I/O.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Analytics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MS_DIA = 86400000;
  const DIAS_ANO = 365;

  /* ================================================================ *
   * Datas — sempre em hora local. Nunca `toISOString()` para um dia,
   * porque em Portugal (UTC+1) isso salta para o dia anterior.
   * ================================================================ */

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  /** Date → "YYYY-MM-DD" em hora local. */
  function ymd(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function hoje() {
    return ymd(new Date());
  }

  /**
   * Aceita "YYYY-MM-DD" ou o formato legado `toDateString()`
   * ("Mon Sep 29 2025") gravado pelas versões antigas.
   */
  function normalizarDia(valor) {
    if (!valor) return null;
    const texto = String(valor).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
    const d = new Date(texto);
    return isNaN(d.getTime()) ? null : ymd(d);
  }

  /** "YYYY-MM-DD" → Date local à meia-noite. */
  function paraData(dia) {
    const [a, m, d] = String(dia).split("-").map(Number);
    return new Date(a, (m || 1) - 1, d || 1);
  }

  function diasEntre(inicio, fim) {
    return Math.round((paraData(fim) - paraData(inicio)) / MS_DIA);
  }

  function somarDias(dia, n) {
    const d = paraData(dia);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }

  const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  function nomeDiaSemana(dia) {
    return DIAS_SEMANA[paraData(dia).getDay()];
  }

  /* ================================================================ *
   * Estatística básica
   * ================================================================ */

  function soma(xs) {
    return xs.reduce((a, b) => a + b, 0);
  }

  function media(xs) {
    return xs.length ? soma(xs) / xs.length : 0;
  }

  function desvioPadrao(xs) {
    if (xs.length < 2) return 0;
    const m = media(xs);
    return Math.sqrt(soma(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
  }

  function percentil(ordenados, p) {
    if (!ordenados.length) return 0;
    const pos = (ordenados.length - 1) * p;
    const baixo = Math.floor(pos);
    const cima = Math.ceil(pos);
    if (baixo === cima) return ordenados[baixo];
    return ordenados[baixo] + (ordenados[cima] - ordenados[baixo]) * (pos - baixo);
  }

  function mediana(xs) {
    return percentil([...xs].sort((a, b) => a - b), 0.5);
  }

  /* ================================================================ *
   * Histórico (snapshots diários de banca)
   * ================================================================ */

  /**
   * Normaliza + ordena + recalcula o ROI de cada dia a partir do dia anterior.
   * O ROI gravado pode estar desatualizado se um dia anterior foi editado, por
   * isso é sempre derivado aqui em vez de ser lido do registo.
   */
  function prepararHistorico(rows, bancaInicial) {
    const limpo = (rows || [])
      .map((r) => ({
        ...r,
        dia: normalizarDia(r.dia),
        valor: Number(r.valor),
        fechado: !!r.fechado,
      }))
      .filter((r) => r.dia && isFinite(r.valor))
      .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));

    // Se houver duplicados do mesmo dia, o último a entrar vence.
    const porDia = new Map();
    limpo.forEach((r) => porDia.set(r.dia, r));
    const unicos = [...porDia.values()];

    let base = Number(bancaInicial) || 0;
    return unicos.map((r) => {
      const anterior = base;
      const lucro = r.valor - anterior;
      const roi = anterior > 0 ? (lucro / anterior) * 100 : 0;
      base = r.valor;
      return {
        ...r,
        weekday: r.weekday || nomeDiaSemana(r.dia),
        base: anterior,
        lucro,
        roi,
        lucroAcumulado: r.valor - (Number(bancaInicial) || 0),
      };
    });
  }

  /** Retornos diários em fração (0.05 = +5%). */
  function retornosDiarios(historico) {
    return historico.filter((h) => h.base > 0).map((h) => h.lucro / h.base);
  }

  /* ================================================================ *
   * Drawdown
   * ================================================================ */

  function drawdown(historico, bancaInicial) {
    let pico = Number(bancaInicial) || 0;
    let picoDia = historico.length ? historico[0].dia : hoje();
    let maxQueda = 0;
    let maxInicio = null;
    let maxFim = null;
    const serie = [];

    historico.forEach((h) => {
      if (h.valor >= pico) {
        pico = h.valor;
        picoDia = h.dia;
      }
      const queda = pico > 0 ? ((h.valor - pico) / pico) * 100 : 0;
      serie.push({ dia: h.dia, queda });
      if (queda < maxQueda) {
        maxQueda = queda;
        maxInicio = picoDia;
        maxFim = h.dia;
      }
    });

    const ultimo = historico.length
      ? historico[historico.length - 1]
      : { valor: bancaInicial, dia: hoje() };
    const atual = pico > 0 ? ((ultimo.valor - pico) / pico) * 100 : 0;

    return {
      serie,
      maximo: Math.abs(maxQueda),
      maximoInicio: maxInicio,
      maximoFim: maxFim,
      maximoDuracao: maxInicio && maxFim ? diasEntre(maxInicio, maxFim) : 0,
      atual: Math.abs(Math.min(atual, 0)),
      pico,
      picoDia,
      // Dias desde o último máximo histórico — "há quanto tempo estou preso".
      diasAbaixoDoPico: historico.length ? diasEntre(picoDia, ultimo.dia) : 0,
    };
  }

  /* ================================================================ *
   * Sequências (streaks)
   * ================================================================ */

  function sequencias(historico) {
    let atual = 0;
    let tipo = null;
    let melhorVerde = 0;
    let piorVermelho = 0;
    let corridaVerde = 0;
    let corridaVermelha = 0;

    historico.forEach((h) => {
      if (h.lucro > 0) {
        corridaVerde++;
        corridaVermelha = 0;
        melhorVerde = Math.max(melhorVerde, corridaVerde);
        tipo = "verde";
        atual = corridaVerde;
      } else if (h.lucro < 0) {
        corridaVermelha++;
        corridaVerde = 0;
        piorVermelho = Math.max(piorVermelho, corridaVermelha);
        tipo = "vermelho";
        atual = corridaVermelha;
      } else {
        corridaVerde = 0;
        corridaVermelha = 0;
        tipo = "neutro";
        atual = 0;
      }
    });

    return { atual, tipo, melhorVerde, piorVermelho };
  }

  /* ================================================================ *
   * Agregações
   * ================================================================ */

  function porDiaDaSemana(historico) {
    const baldes = DIAS_SEMANA.map((nome) => ({
      nome,
      dias: 0,
      lucro: 0,
      roiMedio: 0,
      vitorias: 0,
      _rois: [],
    }));
    historico.forEach((h) => {
      const b = baldes[paraData(h.dia).getDay()];
      b.dias++;
      b.lucro += h.lucro;
      b._rois.push(h.roi);
      if (h.lucro > 0) b.vitorias++;
    });
    return baldes.map((b) => ({
      nome: b.nome,
      dias: b.dias,
      lucro: b.lucro,
      roiMedio: media(b._rois),
      taxaAcerto: b.dias ? (b.vitorias / b.dias) * 100 : 0,
    }));
  }

  function porMes(historico) {
    const mapa = new Map();
    historico.forEach((h) => {
      const chave = h.dia.slice(0, 7);
      if (!mapa.has(chave)) {
        mapa.set(chave, { mes: chave, dias: 0, lucro: 0, vitorias: 0, inicio: h.base, fim: h.valor });
      }
      const m = mapa.get(chave);
      m.dias++;
      m.lucro += h.lucro;
      m.fim = h.valor;
      if (h.lucro > 0) m.vitorias++;
    });
    return [...mapa.values()].map((m) => ({
      ...m,
      roi: m.inicio > 0 ? ((m.fim - m.inicio) / m.inicio) * 100 : 0,
      taxaAcerto: m.dias ? (m.vitorias / m.dias) * 100 : 0,
    }));
  }

  function histograma(retornos, nBins) {
    const bins = nBins || 11;
    if (!retornos.length) return [];
    const pct = retornos.map((r) => r * 100);
    const min = Math.min(...pct);
    const max = Math.max(...pct);
    const largura = (max - min) / bins || 1;
    const baldes = Array.from({ length: bins }, (_, i) => ({
      de: min + i * largura,
      ate: min + (i + 1) * largura,
      n: 0,
    }));
    pct.forEach((v) => {
      const i = Math.min(bins - 1, Math.floor((v - min) / largura));
      baldes[i].n++;
    });
    return baldes;
  }

  /* ================================================================ *
   * Monte Carlo — projeção honesta em vez de juro composto perfeito
   * ================================================================ */

  /** PRNG determinístico: o gráfico não muda a cada re-render. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalAleatoria(rand) {
    // Box-Muller
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Reamostra os retornos diários reais (bootstrap) para simular caminhos de
   * banca. Com menos de 5 dias de histórico cai para uma normal centrada no ROI
   * alvo — já dá um intervalo, mas marcamos `fonte: "estimado"`.
   */
  function monteCarlo(opcoes) {
    const {
      retornos = [],
      valorInicial,
      meta,
      dias = 90,
      caminhos = 600,
      roiAlvo = 0,
      limiarRuina = 0.5,
      seed = 1337,
    } = opcoes;

    if (!(valorInicial > 0)) return null;

    const rand = mulberry32(seed);
    const usaBootstrap = retornos.length >= 5;
    const mu = usaBootstrap ? media(retornos) : roiAlvo / 100;
    const sigma = usaBootstrap
      ? desvioPadrao(retornos)
      : Math.max(Math.abs(roiAlvo / 100) * 1.5, 0.01);

    const sorteia = usaBootstrap
      ? () => retornos[Math.floor(rand() * retornos.length)]
      : () => mu + sigma * normalAleatoria(rand);

    const valoresPorDia = Array.from({ length: dias }, () => []);
    const ruina = valorInicial * limiarRuina;
    let atingiram = 0;
    let arruinaram = 0;
    const diasAteMeta = [];
    const finais = [];

    for (let c = 0; c < caminhos; c++) {
      let valor = valorInicial;
      let bateuMeta = false;
      let arruinou = false;
      for (let d = 0; d < dias; d++) {
        valor = Math.max(0, valor * (1 + sorteia()));
        valoresPorDia[d].push(valor);
        if (!arruinou && valor <= ruina) {
          arruinou = true;
          arruinaram++;
        }
        if (!bateuMeta && meta > 0 && valor >= meta) {
          bateuMeta = true;
          atingiram++;
          diasAteMeta.push(d + 1);
        }
      }
      finais.push(valor);
    }

    const bandas = valoresPorDia.map((valores, i) => {
      const ordenados = valores.sort((a, b) => a - b);
      return {
        dia: i + 1,
        p10: percentil(ordenados, 0.1),
        p25: percentil(ordenados, 0.25),
        p50: percentil(ordenados, 0.5),
        p75: percentil(ordenados, 0.75),
        p90: percentil(ordenados, 0.9),
      };
    });

    return {
      fonte: usaBootstrap ? "histórico" : "estimado",
      amostras: retornos.length,
      dias,
      caminhos,
      bandas,
      probabilidadeMeta: (atingiram / caminhos) * 100,
      probabilidadeRuina: (arruinaram / caminhos) * 100,
      limiarRuina: ruina,
      medianaDiasAteMeta: diasAteMeta.length ? Math.round(mediana(diasAteMeta)) : null,
      valorFinalMediano: mediana(finais),
      valorFinalP10: percentil([...finais].sort((a, b) => a - b), 0.1),
      valorFinalP90: percentil([...finais].sort((a, b) => a - b), 0.9),
    };
  }

  /** Projeção determinística clássica (juro composto ao ROI alvo). */
  function projecao(valorAtual, roiAlvoPct, meta) {
    const taxa = roiAlvoPct / 100;
    if (!(valorAtual > 0) || !(meta > 0) || taxa <= 0) return null;
    if (valorAtual >= meta) return { dias: 0, data: hoje(), concluido: true };
    const dias = Math.ceil(Math.log(meta / valorAtual) / Math.log(1 + taxa));
    return { dias, data: somarDias(hoje(), dias), concluido: false };
  }

  /* ================================================================ *
   * Apostas / operações individuais
   * ================================================================ */

  const RESULTADOS = {
    green: (stake, odd) => stake * (odd - 1),
    red: (stake) => -stake,
    "meio-green": (stake, odd) => (stake * (odd - 1)) / 2,
    "meio-red": (stake) => -stake / 2,
    anulada: () => 0,
    pendente: () => 0,
  };

  function lucroAposta(aposta) {
    const stake = Number(aposta.stake) || 0;
    const odd = Number(aposta.odd) || 0;
    if (aposta.resultado === "cashout") return Number(aposta.lucro) || 0;
    const fn = RESULTADOS[aposta.resultado];
    return fn ? fn(stake, odd) : 0;
  }

  function apostaResolvida(aposta) {
    return aposta.resultado && aposta.resultado !== "pendente";
  }

  function estatisticasApostas(apostas, unidadeEur) {
    const todas = apostas || [];
    const resolvidas = todas.filter(apostaResolvida);
    const validas = resolvidas.filter((a) => a.resultado !== "anulada");
    const lucros = resolvidas.map(lucroAposta);
    const lucro = soma(lucros);
    const turnover = soma(resolvidas.map((a) => Number(a.stake) || 0));
    const ganhas = validas.filter((a) => lucroAposta(a) > 0).length;
    const odds = validas.map((a) => Number(a.odd) || 0).filter((o) => o > 1);
    const oddsGanhas = validas
      .filter((a) => lucroAposta(a) > 0)
      .map((a) => Number(a.odd) || 0)
      .filter((o) => o > 1);

    const yield_ = turnover > 0 ? (lucro / turnover) * 100 : 0;
    const taxaAcerto = validas.length ? (ganhas / validas.length) * 100 : 0;
    const oddMedia = media(odds);

    return {
      total: todas.length,
      pendentes: todas.length - resolvidas.length,
      resolvidas: resolvidas.length,
      lucro,
      turnover,
      yield: yield_,
      taxaAcerto,
      oddMedia,
      oddMediaGanhas: media(oddsGanhas),
      stakeMedia: resolvidas.length ? turnover / resolvidas.length : 0,
      unidades: unidadeEur > 0 ? lucro / unidadeEur : null,
      melhor: lucros.length ? Math.max(...lucros) : 0,
      pior: lucros.length ? Math.min(...lucros) : 0,
      // Probabilidade implícita média vs. taxa de acerto real = a "edge".
      edge:
        oddMedia > 1 && validas.length
          ? taxaAcerto - (100 / oddMedia)
          : 0,
    };
  }

  function agruparApostas(apostas, campo, unidadeEur) {
    const mapa = new Map();
    (apostas || []).filter(apostaResolvida).forEach((a) => {
      const chave = (a[campo] || "—").trim() || "—";
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave).push(a);
    });
    return [...mapa.entries()]
      .map(([chave, lista]) => ({
        chave,
        n: lista.length,
        ...estatisticasApostas(lista, unidadeEur),
      }))
      .sort((a, b) => b.lucro - a.lucro);
  }

  /* ================================================================ *
   * Gestão de risco
   * ================================================================ */

  /**
   * Kelly: f* = (b·p − q) / b, com b = odd−1.
   * `fracao` aplica Kelly fracionário (0.25 = quarter Kelly), o que quase toda
   * a gente devia usar — Kelly cheio tem uma variância brutal.
   */
  function kelly(probabilidade, odd, fracao, banca) {
    const p = Number(probabilidade) / 100;
    const b = Number(odd) - 1;
    if (!(p > 0) || !(p < 1) || !(b > 0)) return null;
    const q = 1 - p;
    const completo = (b * p - q) / b;
    const aplicado = completo * (Number(fracao) || 1);
    return {
      completo: completo * 100,
      aplicado: aplicado * 100,
      stakeSugerida: banca > 0 ? Math.max(0, banca * aplicado) : 0,
      vantajosa: completo > 0,
      valorEsperado: (p * b - q) * 100,
      probabilidadeImplicita: (1 / Number(odd)) * 100,
    };
  }

  /**
   * Risco de ruína para stake fixa (aproximação clássica):
   *   RoR = ((1 − edge) / (1 + edge)) ^ (banca / unidade)
   * `edge` aqui é o yield em fração.
   */
  function riscoDeRuina(yieldPct, banca, unidade) {
    const edge = yieldPct / 100;
    if (!(banca > 0) || !(unidade > 0)) return null;
    if (edge <= 0) return 100;
    const unidades = banca / unidade;
    const ror = Math.pow((1 - edge) / (1 + edge), unidades) * 100;
    return Math.max(0, Math.min(100, ror));
  }

  /* ================================================================ *
   * Resumo geral — o que alimenta os cartões do dashboard
   * ================================================================ */

  function resumo(rows, config, apostas) {
    const cfg = config || {};
    const bancaInicial = Number(cfg.bancaInicial) || 0;
    const meta = Number(cfg.meta) || 0;
    const roiAlvo = Number(cfg.roi) || 0;
    const historico = prepararHistorico(rows, bancaInicial);
    const retornos = retornosDiarios(historico);
    const ultimo = historico.length ? historico[historico.length - 1] : null;
    const valorAtual = ultimo ? ultimo.valor : bancaInicial;
    const lucroTotal = valorAtual - bancaInicial;

    const diasVerdes = historico.filter((h) => h.lucro > 0).length;
    const diasVermelhos = historico.filter((h) => h.lucro < 0).length;
    const volatilidade = desvioPadrao(retornos) * 100;
    const roiMedio = media(retornos) * 100;

    // Sharpe anualizado (taxa sem risco = 0): retorno médio / volatilidade.
    const sharpe =
      volatilidade > 0 ? (roiMedio / volatilidade) * Math.sqrt(DIAS_ANO) : 0;

    // Sortino: só penaliza a volatilidade negativa.
    const negativos = retornos.filter((r) => r < 0);
    const downside = desvioPadrao(negativos.length ? negativos : [0]) * 100;
    const sortino = downside > 0 ? (roiMedio / downside) * Math.sqrt(DIAS_ANO) : 0;

    const dd = drawdown(historico, bancaInicial);
    const seq = sequencias(historico);
    const estApostas = estatisticasApostas(apostas, unidadeEmEuros(cfg, valorAtual));

    const progresso =
      meta > bancaInicial
        ? ((valorAtual - bancaInicial) / (meta - bancaInicial)) * 100
        : 0;

    const alvoHoje = ultimo && ultimo.dia === hoje()
      ? ultimo.base * (1 + roiAlvo / 100)
      : valorAtual * (1 + roiAlvo / 100);

    return {
      bancaInicial,
      meta,
      roiAlvo,
      valorAtual,
      lucroTotal,
      crescimentoTotal: bancaInicial > 0 ? (lucroTotal / bancaInicial) * 100 : 0,
      progresso: Math.max(0, Math.min(100, progresso)),
      progressoBruto: progresso,
      dias: historico.length,
      diasVerdes,
      diasVermelhos,
      taxaAcertoDias: historico.length ? (diasVerdes / historico.length) * 100 : 0,
      roiMedio,
      roiMediano: retornos.length ? mediana(retornos) * 100 : 0,
      volatilidade,
      sharpe,
      sortino,
      melhorDia: historico.length
        ? historico.reduce((a, b) => (b.roi > a.roi ? b : a))
        : null,
      piorDia: historico.length
        ? historico.reduce((a, b) => (b.roi < a.roi ? b : a))
        : null,
      alvoHoje,
      faltaParaAlvoHoje: alvoHoje - valorAtual,
      registadoHoje: !!(ultimo && ultimo.dia === hoje()),
      fechadoHoje: !!(ultimo && ultimo.dia === hoje() && ultimo.fechado),
      drawdown: dd,
      sequencias: seq,
      apostas: estApostas,
      riscoRuina: riscoDeRuina(
        estApostas.turnover > 0 ? estApostas.yield : roiMedio,
        valorAtual,
        unidadeEmEuros(cfg, valorAtual)
      ),
      historico,
      retornos,
    };
  }

  /** Valor de 1 unidade em euros, a partir da % de unidade configurada. */
  function unidadeEmEuros(config, banca) {
    const pct = Number((config || {}).unidade);
    if (!(pct > 0) || !(banca > 0)) return 0;
    return (banca * pct) / 100;
  }

  /* ================================================================ *
   * Limites diários (stop-loss / stop-win)
   * ================================================================ */

  function estadoLimites(resumoAtual, config) {
    const cfg = config || {};
    const stopLoss = Number(cfg.stopLoss) || 0;
    const stopWin = Number(cfg.stopWin) || 0;
    const ultimo = resumoAtual.historico[resumoAtual.historico.length - 1];
    if (!ultimo || ultimo.dia !== hoje() || !(ultimo.base > 0)) {
      return { estado: "sem-registo", roiHoje: 0, stopLoss, stopWin };
    }
    const roiHoje = ultimo.roi;
    let estado = "ok";
    if (stopLoss > 0 && roiHoje <= -stopLoss) estado = "stop-loss";
    else if (stopWin > 0 && roiHoje >= stopWin) estado = "stop-win";
    else if (stopLoss > 0 && roiHoje <= -stopLoss * 0.7) estado = "aviso";
    return { estado, roiHoje, stopLoss, stopWin, lucroHoje: ultimo.lucro };
  }

  /* ================================================================ *
   * Conquistas — gamificação leve, tudo derivado, nada gravado
   * ================================================================ */

  function conquistas(r) {
    const lista = [
      {
        id: "primeiro-registo",
        nome: "Primeiro Registo",
        desc: "Registaste a tua banca pela primeira vez",
        ok: r.dias >= 1,
      },
      {
        id: "semana",
        nome: "Uma Semana",
        desc: "7 dias registados",
        ok: r.dias >= 7,
        progresso: Math.min(100, (r.dias / 7) * 100),
      },
      {
        id: "mes",
        nome: "Um Mês",
        desc: "30 dias registados",
        ok: r.dias >= 30,
        progresso: Math.min(100, (r.dias / 30) * 100),
      },
      {
        id: "verde-5",
        nome: "Sequência x5",
        desc: "5 dias verdes seguidos",
        ok: r.sequencias.melhorVerde >= 5,
        progresso: Math.min(100, (r.sequencias.melhorVerde / 5) * 100),
      },
      {
        id: "dobro",
        nome: "Banca a Dobrar",
        desc: "Banca ≥ 2× a inicial",
        ok: r.bancaInicial > 0 && r.valorAtual >= r.bancaInicial * 2,
        progresso: r.bancaInicial > 0
          ? Math.min(100, (r.valorAtual / (r.bancaInicial * 2)) * 100)
          : 0,
      },
      {
        id: "disciplina",
        nome: "Disciplina",
        desc: "Drawdown máximo abaixo de 15%",
        ok: r.dias >= 10 && r.drawdown.maximo < 15,
      },
      {
        id: "consistencia",
        nome: "Consistência",
        desc: "Mais de 60% de dias verdes (10+ dias)",
        ok: r.dias >= 10 && r.taxaAcertoDias > 60,
      },
      {
        id: "meta",
        nome: "Meta Atingida",
        desc: "Chegaste à meta de banca",
        ok: r.meta > 0 && r.valorAtual >= r.meta,
        progresso: r.progresso,
      },
    ];
    return lista.map((c) => ({
      ...c,
      progresso: c.ok ? 100 : Math.round(c.progresso || 0),
    }));
  }

  /* ================================================================ */

  return {
    // datas
    ymd,
    hoje,
    normalizarDia,
    paraData,
    diasEntre,
    somarDias,
    nomeDiaSemana,
    DIAS_SEMANA,
    // estatística
    soma,
    media,
    mediana,
    desvioPadrao,
    percentil,
    // histórico
    prepararHistorico,
    retornosDiarios,
    drawdown,
    sequencias,
    porDiaDaSemana,
    porMes,
    histograma,
    // projeção
    monteCarlo,
    projecao,
    // apostas
    lucroAposta,
    apostaResolvida,
    estatisticasApostas,
    agruparApostas,
    RESULTADOS: Object.keys(RESULTADOS).concat("cashout"),
    // risco
    kelly,
    riscoDeRuina,
    unidadeEmEuros,
    estadoLimites,
    // topo
    resumo,
    conquistas,
  };
});
