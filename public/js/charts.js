/*
  charts.js — os gráficos do dashboard (Chart.js).

  Regras que este ficheiro respeita, e que convém não quebrar:
    · um eixo y por gráfico, nunca dois;
    · cores categóricas por ordem fixa, lidas dos tokens CSS (seguem o tema);
    · verde/vermelho só para lucro/prejuízo, que é estado, não identidade;
    · grelha e eixos em linha sólida fina — tracejado significa "projeção";
    · legenda desenhada em HTML, para identidade não depender só da cor;
    · tooltip em todos os gráficos, mas nenhum valor existe só lá dentro:
      as tabelas das vistas são a versão acessível dos mesmos dados.
*/
(function (global) {
  "use strict";

  const { Fmt, token, alfa } = global.UI;
  const graficos = new Map();

  const cores = () => ({
    serie1: token("--series-1"),
    serie2: token("--series-2"),
    bom: token("--good"),
    critico: token("--critical"),
    aviso: token("--warning"),
    tinta: token("--ink"),
    tinta2: token("--ink-2"),
    mudo: token("--ink-muted"),
    grelha: token("--grid"),
    eixo: token("--axis"),
    superficie: token("--surface"),
  });

  /* ---------------------------------------------------------------- *
   * Opções comuns
   * ---------------------------------------------------------------- */

  function opcoesBase(c, extra) {
    return {
      maintainAspectRatio: false,
      responsive: true,
      animation: { duration: 400 },
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 4, right: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c.superficie,
          titleColor: c.tinta,
          bodyColor: c.tinta2,
          borderColor: c.eixo,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          boxPadding: 4,
          ...(extra && extra.tooltip),
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: c.eixo },
          ticks: {
            color: c.mudo,
            font: { size: 10 },
            maxRotation: 0,
            autoSkipPadding: 14,
          },
        },
        y: {
          grid: { color: c.grelha, drawTicks: false },
          border: { display: false },
          ticks: { color: c.mudo, font: { size: 10 }, padding: 8 },
        },
      },
    };
  }

  /** Destaca a linha do zero num eixo que atravessa valores negativos. */
  function linhaZero(c) {
    return (ctx) => (ctx.tick && ctx.tick.value === 0 ? c.eixo : c.grelha);
  }

  function render(idCanvas, configuracao) {
    const canvas = document.getElementById(idCanvas);
    if (!canvas) return null;
    if (graficos.has(idCanvas)) graficos.get(idCanvas).destroy();
    const g = new global.Chart(canvas, configuracao);
    graficos.set(idCanvas, g);
    return g;
  }

  function destruirTodos() {
    graficos.forEach((g) => g.destroy());
    graficos.clear();
  }

  /* ---------------------------------------------------------------- *
   * Evolução da banca + projeção: ritmo atual e ritmo alvo a juro
   * composto, sobre a faixa de cenários do Monte Carlo
   * ---------------------------------------------------------------- */

  function evolucao(
    idCanvas,
    { historico, simulacao, bancaInicial, meta, diasProjecao, ritmoAtual, ritmoAlvo }
  ) {
    const c = cores();
    const nProj = simulacao ? Math.min(simulacao.bandas.length, diasProjecao || 30) : 0;

    const etiquetas = historico
      .map((h) => Fmt.dataCurta(h.dia))
      .concat(Array.from({ length: nProj }, (_, i) => `+${i + 1}d`));

    const real = historico.map((h) => h.valor);
    const ultimoValor = real.length ? real[real.length - 1] : bancaInicial;
    const ultimoIndice = Math.max(0, real.length - 1);

    // As séries projetadas arrancam no último ponto real, para a linha não
    // aparecer "solta" no gráfico.
    const projetar = (chave) => {
      if (!simulacao) return [];
      const vazio = new Array(ultimoIndice).fill(null);
      return vazio
        .concat([ultimoValor])
        .concat(simulacao.bandas.slice(0, nProj).map((b) => b[chave]));
    };

    // Juro composto a uma taxa diária fixa (%), a partir do mesmo ponto.
    const compor = (pct) =>
      new Array(ultimoIndice)
        .fill(null)
        .concat(
          Array.from({ length: nProj + 1 }, (_, d) => ultimoValor * Math.pow(1 + pct / 100, d))
        );

    const datasets = [];

    if (simulacao) {
      datasets.push({
        label: "p10",
        data: projetar("p10"),
        borderColor: "transparent",
        backgroundColor: alfa(c.serie1, 0.12),
        pointRadius: 0,
        fill: "+1",
        tension: 0.3,
        order: 4,
      });
      datasets.push({
        label: "p90",
        data: projetar("p90"),
        borderColor: "transparent",
        pointRadius: 0,
        fill: false,
        tension: 0.3,
        order: 4,
      });
    }

    // O ritmo que a banca está mesmo a ter, seja ele qual for — mesmo negativo.
    if (nProj && Number.isFinite(ritmoAtual)) {
      datasets.push({
        label: `Ritmo atual (${Fmt.pctSinal(ritmoAtual)}/dia)`,
        data: compor(ritmoAtual),
        borderColor: c.serie1,
        borderWidth: 2,
        borderDash: [5, 4],
        pointRadius: 0,
        fill: false,
        order: 2,
      });
    }

    if (nProj && ritmoAlvo > 0) {
      datasets.push({
        label: `Ritmo alvo (${Fmt.pct(ritmoAlvo, 1)}/dia)`,
        data: compor(ritmoAlvo),
        borderColor: c.serie2,
        borderWidth: 2,
        borderDash: [2, 3],
        pointRadius: 0,
        fill: false,
        order: 3,
      });
    }

    datasets.push({
      label: "Banca real",
      data: real,
      borderColor: c.serie1,
      backgroundColor: alfa(c.serie1, 0.1),
      borderWidth: 2,
      pointRadius: real.length > 60 ? 0 : 3,
      pointHoverRadius: 6,
      pointBackgroundColor: c.serie1,
      pointBorderColor: c.superficie,
      pointBorderWidth: 2,
      fill: true,
      tension: 0.25,
      order: 1,
    });

    if (meta > 0) {
      datasets.push({
        label: "Meta",
        data: new Array(etiquetas.length).fill(meta),
        borderColor: c.mudo,
        borderWidth: 1,
        borderDash: [3, 3],
        pointRadius: 0,
        fill: false,
        order: 5,
      });
    }

    const opcoes = opcoesBase(c);
    opcoes.plugins.tooltip.callbacks = {
      // As bandas aparecem numa linha só, em vez de duas entradas soltas.
      label: (ctx) => {
        if (ctx.dataset.label === "p90") return null;
        if (ctx.dataset.label === "p10") {
          const p90 = ctx.chart.data.datasets[1].data[ctx.dataIndex];
          if (p90 === null || ctx.parsed.y === null) return null;
          return `Intervalo provável: ${Fmt.moeda(ctx.parsed.y, 0)} – ${Fmt.moeda(p90, 0)}`;
        }
        return `${ctx.dataset.label}: ${Fmt.moeda(ctx.parsed.y)}`;
      },
    };
    opcoes.scales.y.ticks.callback = (v) => Fmt.moedaCurta(v);

    return render(idCanvas, { type: "line", data: { labels: etiquetas, datasets }, options: opcoes });
  }

  /* ---------------------------------------------------------------- *
   * ROI diário — barras acima/abaixo de zero
   * ---------------------------------------------------------------- */

  function roiDiario(idCanvas, historico) {
    const c = cores();
    const opcoes = opcoesBase(c);

    opcoes.plugins.tooltip.callbacks = {
      label: (ctx) => {
        const h = historico[ctx.dataIndex];
        return [
          `ROI: ${Fmt.pctSinal(h.roi)}`,
          `Lucro: ${Fmt.moedaSinal(h.lucro)}`,
          `Banca: ${Fmt.moeda(h.valor)}`,
        ];
      },
      title: (itens) => Fmt.dataLonga(historico[itens[0].dataIndex].dia),
    };
    opcoes.scales.y.ticks.callback = (v) => Fmt.pct(v, 1);
    opcoes.scales.y.grid.color = linhaZero(c);

    return render(idCanvas, {
      type: "bar",
      data: {
        labels: historico.map((h) => Fmt.dataCurta(h.dia)),
        datasets: [
          {
            label: "ROI diário",
            data: historico.map((h) => h.roi),
            backgroundColor: historico.map((h) =>
              h.roi >= 0 ? alfa(c.bom, 0.85) : alfa(c.critico, 0.85)
            ),
            borderRadius: 4,
            borderSkipped: false,
            categoryPercentage: 0.75,
            barPercentage: 0.9,
          },
        ],
      },
      options: opcoes,
    });
  }

  /* ---------------------------------------------------------------- *
   * Drawdown — uma série, magnitude de queda desde o pico
   * ---------------------------------------------------------------- */

  function drawdown(idCanvas, serie) {
    const c = cores();
    const opcoes = opcoesBase(c);

    opcoes.plugins.tooltip.callbacks = {
      label: (ctx) => `Queda desde o pico: ${Fmt.pct(ctx.parsed.y, 1)}`,
      title: (itens) => Fmt.dataLonga(serie[itens[0].dataIndex].dia),
    };
    opcoes.scales.y.ticks.callback = (v) => Fmt.pct(v, 0);
    opcoes.scales.y.max = 0;

    return render(idCanvas, {
      type: "line",
      data: {
        labels: serie.map((s) => Fmt.dataCurta(s.dia)),
        datasets: [
          {
            label: "Drawdown",
            data: serie.map((s) => s.queda),
            borderColor: c.critico,
            backgroundColor: alfa(c.critico, 0.15),
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.2,
          },
        ],
      },
      options: opcoes,
    });
  }

  /* ---------------------------------------------------------------- *
   * Distribuição de resultados diários
   * ---------------------------------------------------------------- */

  function distribuicao(idCanvas, baldes) {
    const c = cores();
    const opcoes = opcoesBase(c);

    opcoes.interaction = { mode: "nearest", intersect: true };
    opcoes.plugins.tooltip.callbacks = {
      title: (itens) => {
        const b = baldes[itens[0].dataIndex];
        return `ROI entre ${Fmt.pct(b.de, 1)} e ${Fmt.pct(b.ate, 1)}`;
      },
      label: (ctx) => `${ctx.parsed.y} ${ctx.parsed.y === 1 ? "dia" : "dias"}`,
    };
    opcoes.scales.y.ticks.precision = 0;

    return render(idCanvas, {
      type: "bar",
      data: {
        labels: baldes.map((b) => Fmt.numero(b.de, 1) + "%"),
        datasets: [
          {
            label: "Dias",
            data: baldes.map((b) => b.n),
            // Categorias ordenadas por valor de ROI: polaridade é significado.
            backgroundColor: baldes.map((b) =>
              b.ate <= 0 ? alfa(c.critico, 0.8) : alfa(c.bom, 0.8)
            ),
            borderRadius: 4,
            borderSkipped: false,
            categoryPercentage: 0.9,
            barPercentage: 0.92,
          },
        ],
      },
      options: opcoes,
    });
  }

  /* ---------------------------------------------------------------- *
   * Desempenho por dia da semana — uma medida, uma cor
   * ---------------------------------------------------------------- */

  function diaDaSemana(idCanvas, dados) {
    const c = cores();
    const opcoes = opcoesBase(c);
    const comDados = dados.filter((d) => d.dias > 0);

    opcoes.interaction = { mode: "nearest", intersect: true };
    opcoes.plugins.tooltip.callbacks = {
      label: (ctx) => {
        const d = comDados[ctx.dataIndex];
        return [
          `Lucro total: ${Fmt.moedaSinal(d.lucro)}`,
          `ROI médio: ${Fmt.pctSinal(d.roiMedio)}`,
          `${d.dias} ${d.dias === 1 ? "dia" : "dias"} · ${Fmt.pct(d.taxaAcerto, 0)} verdes`,
        ];
      },
    };
    opcoes.scales.y.ticks.callback = (v) => Fmt.moedaCurta(v);
    opcoes.scales.y.grid.color = linhaZero(c);

    return render(idCanvas, {
      type: "bar",
      data: {
        labels: comDados.map((d) => d.nome),
        datasets: [
          {
            label: "Lucro",
            data: comDados.map((d) => d.lucro),
            backgroundColor: comDados.map((d) =>
              d.lucro >= 0 ? alfa(c.bom, 0.8) : alfa(c.critico, 0.8)
            ),
            borderRadius: 4,
            borderSkipped: false,
            categoryPercentage: 0.7,
            barPercentage: 0.85,
          },
        ],
      },
      options: opcoes,
    });
  }

  /* ---------------------------------------------------------------- *
   * Leque Monte Carlo — p10/p25 · p50 · p75/p90
   * ---------------------------------------------------------------- */

  function monteCarlo(idCanvas, simulacao, meta) {
    const c = cores();
    if (!simulacao) return null;

    const b = simulacao.bandas;
    const etiquetas = b.map((x) => "+" + x.dia + "d");

    const datasets = [
      {
        label: "p10",
        data: b.map((x) => x.p10),
        borderColor: "transparent",
        backgroundColor: alfa(c.serie1, 0.1),
        pointRadius: 0,
        fill: "+1",
        tension: 0.2,
      },
      {
        label: "p90",
        data: b.map((x) => x.p90),
        borderColor: "transparent",
        pointRadius: 0,
        fill: false,
        tension: 0.2,
      },
      {
        label: "p25",
        data: b.map((x) => x.p25),
        borderColor: "transparent",
        backgroundColor: alfa(c.serie1, 0.2),
        pointRadius: 0,
        fill: "+1",
        tension: 0.2,
      },
      {
        label: "p75",
        data: b.map((x) => x.p75),
        borderColor: "transparent",
        pointRadius: 0,
        fill: false,
        tension: 0.2,
      },
      {
        label: "Cenário mediano",
        data: b.map((x) => x.p50),
        borderColor: c.serie1,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        fill: false,
        tension: 0.2,
      },
    ];

    if (meta > 0) {
      datasets.push({
        label: "Meta",
        data: new Array(b.length).fill(meta),
        borderColor: c.mudo,
        borderWidth: 1,
        borderDash: [3, 3],
        pointRadius: 0,
        fill: false,
      });
    }

    const opcoes = opcoesBase(c);
    opcoes.plugins.tooltip.callbacks = {
      label: (ctx) => {
        const rotulos = {
          p10: "Pessimista (10%)",
          p25: "Fraco (25%)",
          p75: "Bom (75%)",
          p90: "Otimista (90%)",
        };
        const nome = rotulos[ctx.dataset.label] || ctx.dataset.label;
        return `${nome}: ${Fmt.moeda(ctx.parsed.y, 0)}`;
      },
    };
    opcoes.scales.y.ticks.callback = (v) => Fmt.moedaCurta(v);

    return render(idCanvas, {
      type: "line",
      data: { labels: etiquetas, datasets },
      options: opcoes,
    });
  }

  global.Graficos = {
    evolucao,
    roiDiario,
    drawdown,
    distribuicao,
    diaDaSemana,
    monteCarlo,
    destruirTodos,
  };
})(window);
