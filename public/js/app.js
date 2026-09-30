/*
  app.js — estado, vistas e eventos do ROI Tracker.

  Fluxo: carregar() traz os dados crus → recalcular() deriva tudo com o
  Analytics → renderizar() pinta a vista ativa. Nenhum cálculo vive aqui.
*/
(function (global) {
  "use strict";

  const A = global.Analytics;
  const { Fmt, toast, $, $$, esc, sinalClasse, descarregar, confirmar } = global.UI;
  const Dados = global.Dados;

  const CHAVE_TEMA = "temaROI";
  const CHAVE_MODO_LOCAL = "modoLocalEscolhido";

  const estado = {
    config: null,
    historico: [],
    apostas: [],
    objetivos: [],
    preparado: [],
    janela: [],
    resumo: null,
    simulacao: null,
    periodo: 0, // 0 = tudo
    vista: "resumo",
    filtroResultado: "",
    carregando: false,
  };

  /* ================================================================ *
   * Tema
   * ================================================================ */

  function aplicarTema(tema) {
    const escolhido = tema === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = escolhido;
    try {
      localStorage.setItem(CHAVE_TEMA, escolhido);
    } catch (e) {
      /* ignorado */
    }
    return escolhido;
  }

  function temaGuardado() {
    try {
      return localStorage.getItem(CHAVE_TEMA) || "dark";
    } catch (e) {
      return "dark";
    }
  }

  /* ================================================================ *
   * Carregamento e derivação
   * ================================================================ */

  async function carregar() {
    estado.carregando = true;
    try {
      estado.config = await Dados.config.obter();
    } catch (e) {
      estado.config = null;
    }

    if (!estado.config) {
      estado.carregando = false;
      abrir("overlayBoasVindas");
      return false;
    }

    Fmt.definirMoeda(estado.config.moeda);
    aplicarTema(estado.config.tema || temaGuardado());

    const [historico, apostas, objetivos] = await Promise.all([
      Dados.historico.listar().catch(() => []),
      Dados.apostas.listar().catch(() => []),
      Dados.objetivos.listar().catch(() => []),
    ]);

    estado.historico = historico || [];
    estado.apostas = apostas || [];
    estado.objetivos = objetivos || [];
    estado.carregando = false;

    recalcular();
    return true;
  }

  function recalcular() {
    const cfg = estado.config || Dados.CONFIG_PADRAO;

    // O resumo é sempre sobre a vida toda da banca — o filtro de período
    // recorta a janela dos gráficos, não a base de cálculo.
    estado.resumo = A.resumo(estado.historico, cfg, estado.apostas);
    estado.preparado = estado.resumo.historico;

    if (estado.periodo > 0) {
      const limite = A.somarDias(A.hoje(), -estado.periodo);
      estado.janela = estado.preparado.filter((h) => h.dia >= limite);
    } else {
      estado.janela = estado.preparado;
    }

    estado.simulacao = A.monteCarlo({
      retornos: estado.resumo.retornos,
      valorInicial: estado.resumo.valorAtual,
      meta: estado.resumo.meta,
      roiAlvo: estado.resumo.roiAlvo,
      dias: 90,
      caminhos: 600,
    });
  }

  async function recarregar() {
    const ok = await carregar();
    if (ok) renderizar();
  }

  /* ================================================================ *
   * Navegação
   * ================================================================ */

  const TITULOS = {
    resumo: ["Visão geral", "O estado da banca num relance"],
    registos: ["Registos", "Todos os dias registados, editáveis"],
    apostas: ["Apostas", "Operações individuais e o que elas rendem"],
    analise: ["Análise", "Onde é que o lucro nasce — e onde se perde"],
    risco: ["Risco", "Projeções honestas e travões para os dias maus"],
    metas: ["Metas", "Objetivos intermédios e conquistas"],
    definicoes: ["Definições", "Parâmetros, dados e conta"],
  };

  // O filtro de período só faz sentido onde existem séries temporais.
  const VISTAS_COM_PERIODO = new Set(["resumo", "analise"]);

  function irPara(vista) {
    estado.vista = vista;
    $$(".view").forEach((v) => v.classList.add("hidden"));
    const alvo = document.getElementById("vista-" + vista);
    if (alvo) alvo.classList.remove("hidden");

    $$(".nav button").forEach((b) => {
      if (b.dataset.vista === vista) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });

    const [titulo, subtitulo] = TITULOS[vista] || ["", ""];
    $("#tituloVista").textContent = titulo;
    $("#subtituloVista").textContent = subtitulo;
    $("#filtroPeriodo").classList.toggle("hidden", !VISTAS_COM_PERIODO.has(vista));

    renderizar();
  }

  /* ================================================================ *
   * Render — dispatcher
   * ================================================================ */

  function renderizar() {
    if (!estado.resumo) return;
    renderSidebar();
    renderBannerLimites();

    switch (estado.vista) {
      case "resumo":
        renderResumo();
        break;
      case "registos":
        renderRegistos();
        break;
      case "apostas":
        renderApostas();
        break;
      case "analise":
        renderAnalise();
        break;
      case "risco":
        renderRisco();
        break;
      case "metas":
        renderMetas();
        break;
      case "definicoes":
        renderDefinicoes();
        break;
    }
  }

  function cartao({ label, valor, classe, nota, progresso, progressoClasse, pequeno }) {
    return `
      <div class="stat">
        <span class="label">${esc(label)}</span>
        <span class="value ${pequeno ? "sm" : ""} ${classe || ""}">${valor}</span>
        ${nota ? `<span class="note">${nota}</span>` : ""}
        ${
          progresso !== undefined
            ? `<div class="progress ${progressoClasse || ""}"><span style="width:${Math.max(
                0,
                Math.min(100, progresso)
              )}%"></span></div>`
            : ""
        }
      </div>`;
  }

  function mostrarGrafico(id, temDados, mensagem) {
    const caixa = document.getElementById(id).parentElement;
    const vazio = document.getElementById(id + "-vazio");
    caixa.classList.toggle("hidden", !temDados);
    if (vazio) {
      vazio.classList.toggle("hidden", temDados);
      if (!temDados) vazio.innerHTML = mensagem;
    }
    return temDados;
  }

  /* ================================================================ *
   * Sidebar
   * ================================================================ */

  function renderSidebar() {
    const r = estado.resumo;
    const utilizador = Dados.utilizadorGuardado();
    const servidor = Dados.modo() === "servidor";

    $("#nomeUtilizador").textContent =
      servidor && utilizador ? utilizador.username : "Modo local";
    $("#modoArmazenamento").textContent = servidor
      ? "sincronizado na conta"
      : "só neste dispositivo";
    $("#avatar").textContent =
      servidor && utilizador ? utilizador.username.charAt(0).toUpperCase() : "·";
    $("#btnSessao").textContent = servidor ? "Sair" : "Entrar";

    const btnFechar = $("#btnFecharDia");
    const input = $("#inputSaldo");
    const btnRegistar = $("#btnRegistar");
    const estadoHoje = $("#estadoHoje");

    if (r.fechadoHoje) {
      btnFechar.classList.add("hidden");
      input.disabled = true;
      btnRegistar.disabled = true;
      estadoHoje.innerHTML =
        '<span class="badge good">✓ Dia fechado</span> Até amanhã.';
    } else if (r.registadoHoje) {
      btnFechar.classList.remove("hidden");
      input.disabled = false;
      btnRegistar.disabled = false;
      const hoje = estado.preparado[estado.preparado.length - 1];
      estadoHoje.innerHTML = `Hoje: <strong class="${sinalClasse(
        hoje.roi
      )}">${Fmt.pctSinal(hoje.roi)}</strong> · ${Fmt.moedaSinal(hoje.lucro)}`;
    } else {
      btnFechar.classList.add("hidden");
      input.disabled = false;
      btnRegistar.disabled = false;
      estadoHoje.innerHTML = `Alvo de hoje: <strong>${Fmt.moeda(r.alvoHoje)}</strong>`;
    }
  }

  /* ================================================================ *
   * Banner de limites — stop-loss / stop-win
   * ================================================================ */

  function renderBannerLimites() {
    const limites = A.estadoLimites(estado.resumo, estado.config);
    const zona = $("#bannerLimites");

    const mapa = {
      "stop-loss": {
        classe: "critical",
        icone: "⛔",
        texto: `Bateste o stop-loss diário (${Fmt.pct(limites.roiHoje, 1)} vs limite de −${Fmt.pct(
          limites.stopLoss,
          1
        )}). Fecha o dia e volta amanhã — perseguir perdas é como se perde a banca.`,
      },
      "stop-win": {
        classe: "good",
        icone: "🎯",
        texto: `Atingiste o stop-win diário (${Fmt.pctSinal(
          limites.roiHoje
        )}). Guardar o lucro agora é uma decisão perfeitamente válida.`,
      },
      aviso: {
        classe: "warning",
        icone: "⚠",
        texto: `Estás a aproximar-te do stop-loss (${Fmt.pct(
          limites.roiHoje,
          1
        )} de ${-limites.stopLoss}%). Considera reduzir a stake.`,
      },
    };

    const alerta = mapa[limites.estado];
    zona.innerHTML = alerta
      ? `<div class="alert ${alerta.classe}"><span class="icon">${alerta.icone}</span><span>${alerta.texto}</span></div>`
      : "";
  }

  /* ================================================================ *
   * Vista: visão geral
   * ================================================================ */

  function renderResumo() {
    const r = estado.resumo;
    const projecao = A.projecao(r.valorAtual, r.roiAlvo, r.meta);

    const metaAtingida = r.meta > 0 && r.valorAtual >= r.meta;
    const notaProjecao = metaAtingida
      ? "Meta atingida"
      : r.meta <= 0
      ? "Define uma meta nas Definições"
      : projecao
      ? `${projecao.dias} dias ao ritmo alvo de ${Fmt.pct(r.roiAlvo, 1)}`
      : "Define um ROI alvo positivo";

    $("#cartoesResumo").innerHTML = [
      cartao({
        label: "Banca atual",
        valor: Fmt.moeda(r.valorAtual),
        nota: `${Fmt.moedaSinal(r.lucroTotal)} desde o início · meta ${Fmt.moeda(
          r.meta,
          0
        )}`,
        progresso: r.progresso,
        progressoClasse: r.progresso >= 100 ? "good" : "",
      }),
      cartao({
        label: "Resultado de hoje",
        valor: r.registadoHoje
          ? Fmt.pctSinal(estado.preparado[estado.preparado.length - 1].roi)
          : "—",
        classe: r.registadoHoje
          ? sinalClasse(estado.preparado[estado.preparado.length - 1].roi)
          : "",
        nota: r.registadoHoje
          ? Fmt.moedaSinal(estado.preparado[estado.preparado.length - 1].lucro)
          : `Falta ${Fmt.moeda(Math.max(0, r.faltaParaAlvoHoje))} para o alvo`,
      }),
      cartao({
        label: "Crescimento total",
        valor: Fmt.pctSinal(r.crescimentoTotal, 1),
        classe: sinalClasse(r.crescimentoTotal),
        nota: `${r.dias} ${r.dias === 1 ? "dia registado" : "dias registados"} · ${Fmt.pct(
          r.taxaAcertoDias,
          0
        )} verdes`,
      }),
      cartao({
        label: "Projeção até à meta",
        valor: metaAtingida
          ? "✓"
          : projecao && !projecao.concluido
          ? Fmt.dataCurta(projecao.data)
          : "—",
        pequeno: true,
        nota: notaProjecao,
      }),
      cartao({
        label: "Drawdown atual",
        valor: Fmt.pct(r.drawdown.atual, 1),
        classe: r.drawdown.atual > 0 ? "neg" : "neutral",
        nota: `Máximo histórico: ${Fmt.pct(r.drawdown.maximo, 1)}${
          r.drawdown.diasAbaixoDoPico > 0
            ? ` · ${r.drawdown.diasAbaixoDoPico} dias abaixo do pico`
            : ""
        }`,
      }),
      cartao({
        label: "Sequência",
        valor: r.sequencias.atual > 0 ? `${r.sequencias.atual} dias` : "—",
        classe:
          r.sequencias.tipo === "verde"
            ? "pos"
            : r.sequencias.tipo === "vermelho"
            ? "neg"
            : "",
        nota:
          r.sequencias.tipo === "verde"
            ? `Melhor de sempre: ${r.sequencias.melhorVerde} dias`
            : r.sequencias.tipo === "vermelho"
            ? `Pior de sempre: ${r.sequencias.piorVermelho} dias`
            : "Sem registos ainda",
      }),
    ].join("");

    // ---- gráfico de evolução ----
    const temDados = estado.janela.length > 0;
    $("#notaEvolucao").textContent = temDados
      ? `${estado.janela.length} dias${
          estado.simulacao ? ` · projeção ${estado.simulacao.fonte}` : ""
        }`
      : "";

    $("#legendaEvolucao").innerHTML = temDados
      ? `
      <span><i style="background: var(--series-1)"></i> Banca real</span>
      <span><i class="dashed" style="color: var(--series-1)"></i> Projeção (mediana)</span>
      <span><i class="band" style="background: var(--series-1)"></i> Intervalo p10–p90</span>
      ${estado.resumo.meta > 0 ? '<span><i class="dashed" style="color: var(--ink-muted)"></i> Meta</span>' : ""}`
      : "";

    if (
      mostrarGrafico(
        "graficoEvolucao",
        temDados,
        "Ainda não há registos.<br />Regista o saldo de hoje na barra lateral para o gráfico arrancar."
      )
    ) {
      global.Graficos.evolucao("graficoEvolucao", {
        historico: estado.janela,
        simulacao: estado.simulacao,
        bancaInicial: r.bancaInicial,
        meta: r.meta,
        diasProjecao: 30,
      });
    }

    if (
      mostrarGrafico(
        "graficoRoi",
        temDados,
        "Sem dados para mostrar neste período."
      )
    ) {
      global.Graficos.roiDiario("graficoRoi", estado.janela);
    }

    const diasJanela = new Set(estado.janela.map((h) => h.dia));
    const serieDd = r.drawdown.serie.filter((s) => diasJanela.has(s.dia));
    if (
      mostrarGrafico(
        "graficoDrawdown",
        serieDd.length > 0,
        "Sem dados para mostrar neste período."
      )
    ) {
      global.Graficos.drawdown("graficoDrawdown", serieDd);
    }
  }

  /* ================================================================ *
   * Vista: registos
   * ================================================================ */

  function renderRegistos() {
    const linhas = estado.preparado.slice().reverse();
    $("#contagemRegistos").textContent = `${linhas.length} ${
      linhas.length === 1 ? "registo" : "registos"
    }`;

    if (!linhas.length) {
      $("#tabelaRegistos").innerHTML =
        '<tr class="empty-row"><td colspan="9">Ainda não registaste nenhum dia.</td></tr>';
      return;
    }

    $("#tabelaRegistos").innerHTML = linhas
      .map(
        (h) => `
      <tr>
        <td class="tabular">${Fmt.dataLonga(h.dia)}</td>
        <td>${esc(h.weekday)}</td>
        <td class="num">${Fmt.moeda(h.valor)}</td>
        <td class="num ${sinalClasse(h.lucro)}">${Fmt.moedaSinal(h.lucro)}</td>
        <td class="num ${sinalClasse(h.roi)}">${Fmt.pctSinal(h.roi)}</td>
        <td class="num ${sinalClasse(h.lucroAcumulado)}">${Fmt.moedaSinal(
          h.lucroAcumulado
        )}</td>
        <td>${
          h.fechado
            ? '<span class="badge good">🔒 Fechado</span>'
            : '<span class="badge">Aberto</span>'
        }</td>
        <td>${esc(h.nota || "")}</td>
        <td>
          <div class="btn-row">
            <button class="btn-icon" data-acao="${
              h.fechado ? "reabrir" : "fechar"
            }" data-dia="${h.dia}">${h.fechado ? "Reabrir" : "Fechar"}</button>
            <button class="btn-icon" data-acao="apagar-dia" data-dia="${h.dia}">Apagar</button>
          </div>
        </td>
      </tr>`
      )
      .join("");
  }

  /* ================================================================ *
   * Vista: apostas
   * ================================================================ */

  const ROTULO_RESULTADO = {
    green: ["✓ Green", "good"],
    red: ["✕ Red", "critical"],
    "meio-green": ["◐ Meio green", "good"],
    "meio-red": ["◐ Meio red", "critical"],
    anulada: ["— Anulada", ""],
    cashout: ["↩ Cashout", "warning"],
    pendente: ["⏳ Pendente", "warning"],
  };

  function renderApostas() {
    const stats = estado.resumo.apostas;
    const unidade = A.unidadeEmEuros(estado.config, estado.resumo.valorAtual);

    $("#cartoesApostas").innerHTML = [
      cartao({
        label: "Lucro em apostas",
        valor: Fmt.moedaSinal(stats.lucro),
        classe: sinalClasse(stats.lucro),
        nota:
          stats.unidades !== null && unidade > 0
            ? `${Fmt.numero(stats.unidades, 1)} unidades · 1u = ${Fmt.moeda(unidade)}`
            : "Define a unidade em Risco",
      }),
      cartao({
        label: "Yield",
        valor: Fmt.pctSinal(stats.yield),
        classe: sinalClasse(stats.yield),
        nota: `Sobre ${Fmt.moeda(stats.turnover, 0)} movimentados`,
      }),
      cartao({
        label: "Taxa de acerto",
        valor: Fmt.pct(stats.taxaAcerto, 1),
        nota: `${stats.resolvidas} resolvidas · ${stats.pendentes} pendentes`,
      }),
      cartao({
        label: "Odd média",
        valor: Fmt.numero(stats.oddMedia, 2),
        nota:
          stats.oddMedia > 1
            ? `Implícita ${Fmt.pct(100 / stats.oddMedia, 1)} vs real ${Fmt.pct(
                stats.taxaAcerto,
                1
              )}`
            : "Sem apostas resolvidas",
      }),
    ].join("");

    // Sugestão de stake a partir da unidade configurada.
    $("#sugestaoStake").innerHTML =
      unidade > 0
        ? `Stake de 1 unidade ao ritmo atual: <strong>${Fmt.moeda(
            unidade
          )}</strong> (${Fmt.pct(estado.config.unidade, 1)} de ${Fmt.moeda(
            estado.resumo.valorAtual
          )}).`
        : "";

    preencherDatalists();

    const filtradas = estado.filtroResultado
      ? estado.apostas.filter((a) => a.resultado === estado.filtroResultado)
      : estado.apostas;

    if (!filtradas.length) {
      $("#tabelaApostas").innerHTML =
        '<tr class="empty-row"><td colspan="9">Nenhuma aposta registada com este filtro.</td></tr>';
      return;
    }

    $("#tabelaApostas").innerHTML = filtradas
      .map((a) => {
        const lucro = A.lucroAposta(a);
        const [rotulo, classe] = ROTULO_RESULTADO[a.resultado] || [a.resultado, ""];
        const resolvida = A.apostaResolvida(a);
        return `
        <tr>
          <td class="tabular">${Fmt.dataCurta(a.dia)}</td>
          <td>${esc(a.descricao || "—")}</td>
          <td>${esc(a.mercado || "—")}</td>
          <td>${esc(a.tipster || "—")}</td>
          <td class="num">${Fmt.moeda(a.stake)}</td>
          <td class="num">${a.odd ? Fmt.numero(a.odd, 2) : "—"}</td>
          <td><span class="badge ${classe}">${rotulo}</span></td>
          <td class="num ${resolvida ? sinalClasse(lucro) : ""}">${
          resolvida ? Fmt.moedaSinal(lucro) : "—"
        }</td>
          <td>
            <div class="btn-row">
              ${
                a.resultado === "pendente"
                  ? `<button class="btn-icon" data-acao="resolver" data-id="${esc(
                      a.id
                    )}" data-resultado="green">Green</button>
                     <button class="btn-icon" data-acao="resolver" data-id="${esc(
                       a.id
                     )}" data-resultado="red">Red</button>`
                  : ""
              }
              <button class="btn-icon" data-acao="apagar-aposta" data-id="${esc(
                a.id
              )}">Apagar</button>
            </div>
          </td>
        </tr>`;
      })
      .join("");
  }

  function preencherDatalists() {
    const preencher = (id, campo) => {
      const valores = [
        ...new Set(estado.apostas.map((a) => a[campo]).filter(Boolean)),
      ].sort();
      document.getElementById(id).innerHTML = valores
        .map((v) => `<option value="${esc(v)}"></option>`)
        .join("");
    };
    preencher("listaDesportos", "desporto");
    preencher("listaMercados", "mercado");
    preencher("listaTipsters", "tipster");
  }

  /* ================================================================ *
   * Vista: análise
   * ================================================================ */

  function renderAnalise() {
    const r = estado.resumo;
    const unidade = A.unidadeEmEuros(estado.config, r.valorAtual);

    $("#cartoesAnalise").innerHTML = [
      cartao({
        label: "ROI médio diário",
        valor: Fmt.pctSinal(r.roiMedio),
        classe: sinalClasse(r.roiMedio),
        nota: `Mediana ${Fmt.pctSinal(r.roiMediano)} · alvo ${Fmt.pct(r.roiAlvo, 1)}`,
      }),
      cartao({
        label: "Volatilidade diária",
        valor: Fmt.pct(r.volatilidade, 2),
        nota: "Desvio padrão dos resultados diários",
      }),
      cartao({
        label: "Sharpe anualizado",
        valor: Fmt.numero(r.sharpe, 2),
        classe: sinalClasse(r.sharpe),
        nota:
          r.dias < 10
            ? "Precisa de 10+ dias para ter significado"
            : r.sharpe > 1
            ? "Retorno sólido face ao risco"
            : "Muito risco para o retorno obtido",
      }),
      cartao({
        label: "Sortino",
        valor: Fmt.numero(r.sortino, 2),
        classe: sinalClasse(r.sortino),
        nota: "Como o Sharpe, mas só penaliza as quedas",
      }),
      cartao({
        label: "Melhor dia",
        valor: r.melhorDia ? Fmt.pctSinal(r.melhorDia.roi) : "—",
        classe: "pos",
        nota: r.melhorDia
          ? `${Fmt.dataLonga(r.melhorDia.dia)} · ${Fmt.moedaSinal(r.melhorDia.lucro)}`
          : "",
      }),
      cartao({
        label: "Pior dia",
        valor: r.piorDia ? Fmt.pctSinal(r.piorDia.roi) : "—",
        classe: "neg",
        nota: r.piorDia
          ? `${Fmt.dataLonga(r.piorDia.dia)} · ${Fmt.moedaSinal(r.piorDia.lucro)}`
          : "",
      }),
    ].join("");

    const retornosJanela = A.retornosDiarios(estado.janela);
    const baldes = A.histograma(retornosJanela, 11);

    if (
      mostrarGrafico(
        "graficoDistribuicao",
        baldes.length > 0 && estado.janela.length >= 3,
        "Precisas de pelo menos 3 dias registados para ver a distribuição."
      )
    ) {
      global.Graficos.distribuicao("graficoDistribuicao", baldes);
    }

    const semana = A.porDiaDaSemana(estado.janela);
    if (
      mostrarGrafico(
        "graficoSemana",
        semana.some((d) => d.dias > 0),
        "Sem dados neste período."
      )
    ) {
      global.Graficos.diaDaSemana("graficoSemana", semana);
    }

    // ---- tabela mensal ----
    const meses = A.porMes(estado.preparado).reverse();
    $("#tabelaMeses").innerHTML = meses.length
      ? meses
          .map(
            (m) => `
        <tr>
          <td>${Fmt.mes(m.mes)}</td>
          <td class="num">${m.dias}</td>
          <td class="num ${sinalClasse(m.lucro)}">${Fmt.moedaSinal(m.lucro)}</td>
          <td class="num ${sinalClasse(m.roi)}">${Fmt.pctSinal(m.roi, 1)}</td>
          <td class="num">${Fmt.pct(m.taxaAcerto, 0)}</td>
        </tr>`
          )
          .join("")
      : '<tr class="empty-row"><td colspan="5">Sem registos.</td></tr>';

    renderTabelaGrupo("tabelaTipsters", A.agruparApostas(estado.apostas, "tipster", unidade));
    renderTabelaGrupo("tabelaMercados", A.agruparApostas(estado.apostas, "mercado", unidade));
  }

  function renderTabelaGrupo(id, grupos) {
    if (!grupos.length) {
      document.getElementById(id).innerHTML =
        '<tr class="empty-row"><td colspan="4">Sem apostas resolvidas.</td></tr>';
      return;
    }
    const maximo = Math.max(...grupos.map((g) => Math.abs(g.lucro)), 1);
    document.getElementById(id).innerHTML = grupos
      .map(
        (g) => `
      <tr>
        <td>${esc(g.chave)}</td>
        <td class="num">${g.n}</td>
        <td class="num ${sinalClasse(g.yield)}">${Fmt.pctSinal(g.yield, 1)}</td>
        <td class="num">
          <div class="bar-cell">
            <span class="${sinalClasse(g.lucro)}">${Fmt.moedaSinal(g.lucro)}</span>
            <span class="bar ${g.lucro >= 0 ? "pos" : "neg"}" style="width:${
          (Math.abs(g.lucro) / maximo) * 48
        }px"></span>
          </div>
        </td>
      </tr>`
      )
      .join("");
  }

  /* ================================================================ *
   * Vista: risco
   * ================================================================ */

  function renderRisco() {
    const r = estado.resumo;
    const sim = estado.simulacao;
    const unidade = A.unidadeEmEuros(estado.config, r.valorAtual);

    $("#cartoesRisco").innerHTML = [
      cartao({
        label: "Prob. de atingir a meta",
        valor: sim ? Fmt.pct(sim.probabilidadeMeta, 0) : "—",
        classe: sim && sim.probabilidadeMeta >= 50 ? "pos" : "neg",
        nota: sim
          ? `Em 90 dias, ${sim.caminhos} simulações${
              sim.medianaDiasAteMeta ? ` · mediana ${sim.medianaDiasAteMeta} dias` : ""
            }`
          : "Sem dados suficientes",
      }),
      cartao({
        label: "Prob. de perder metade",
        valor: sim ? Fmt.pct(sim.probabilidadeRuina, 0) : "—",
        classe: sim && sim.probabilidadeRuina > 20 ? "neg" : "",
        nota: sim ? `Cair abaixo de ${Fmt.moeda(sim.limiarRuina, 0)}` : "",
      }),
      cartao({
        label: "Risco de ruína",
        valor: r.riscoRuina === null ? "—" : Fmt.pct(r.riscoRuina, 1),
        classe: r.riscoRuina > 5 ? "neg" : "pos",
        nota: `Fórmula clássica para stake fixa de ${Fmt.moeda(unidade)}`,
      }),
      cartao({
        label: "Drawdown máximo",
        valor: Fmt.pct(r.drawdown.maximo, 1),
        classe: r.drawdown.maximo > 25 ? "neg" : "",
        nota: r.drawdown.maximoInicio
          ? `${Fmt.dataCurta(r.drawdown.maximoInicio)} → ${Fmt.dataCurta(
              r.drawdown.maximoFim
            )} (${r.drawdown.maximoDuracao} dias)`
          : "Sem quedas registadas",
      }),
    ].join("");

    $("#notaMonteCarlo").textContent = sim
      ? sim.fonte === "histórico"
        ? `Baseado em ${sim.amostras} dias reais`
        : "Estimado — poucos dias reais, a usar o ROI alvo"
      : "";

    $("#legendaMonteCarlo").innerHTML = sim
      ? `
      <span><i style="background: var(--series-1)"></i> Cenário mediano</span>
      <span><i class="band" style="background: var(--series-1); opacity:.35"></i> 50% central (p25–p75)</span>
      <span><i class="band" style="background: var(--series-1); opacity:.18"></i> 80% central (p10–p90)</span>
      ${r.meta > 0 ? '<span><i class="dashed" style="color: var(--ink-muted)"></i> Meta</span>' : ""}`
      : "";

    if (
      mostrarGrafico(
        "graficoMonteCarlo",
        !!sim,
        "Regista alguns dias para a simulação ter com que trabalhar."
      )
    ) {
      global.Graficos.monteCarlo("graficoMonteCarlo", sim, r.meta);
    }

    $("#riscoStopLoss").value = estado.config.stopLoss ?? "";
    $("#riscoStopWin").value = estado.config.stopWin ?? "";
    $("#riscoUnidade").value = estado.config.unidade ?? "";
    if (estado.config.kellyFracao) $("#kellyFracao").value = estado.config.kellyFracao;

    $("#resumoRisco").innerHTML = `
      <p class="help">
        Com a banca em <strong>${Fmt.moeda(r.valorAtual)}</strong>, uma unidade vale
        <strong>${Fmt.moeda(unidade)}</strong> e o stop-loss dispara a
        <strong>${Fmt.moeda((r.valorAtual * (estado.config.stopLoss || 0)) / 100)}</strong>
        de perda num dia.
      </p>`;

    calcularKelly();
  }

  function calcularKelly() {
    if (!estado.resumo) return;
    const odd = parseFloat($("#kellyOdd").value);
    const prob = parseFloat($("#kellyProb").value);
    const fracao = parseFloat($("#kellyFracao").value);
    const banca = estado.resumo.valorAtual;
    const k = A.kelly(prob, odd, fracao, banca);

    if (!k) {
      $("#resultadoKelly").innerHTML =
        '<p class="help">Introduz uma odd acima de 1 e uma probabilidade entre 0 e 100.</p>';
      return;
    }

    $("#resultadoKelly").innerHTML = k.vantajosa
      ? `<div class="alert good">
           <span class="icon">✓</span>
           <span>
             Aposta com valor: probabilidade implícita da odd é
             <strong>${Fmt.pct(k.probabilidadeImplicita, 1)}</strong>, tu estimas
             <strong>${Fmt.pct(prob, 1)}</strong>.<br />
             Stake sugerida: <strong>${Fmt.moeda(k.stakeSugerida)}</strong>
             (${Fmt.pct(k.aplicado, 2)} da banca · Kelly completo seria
             ${Fmt.pct(k.completo, 2)}).<br />
             Valor esperado: <strong>${Fmt.pctSinal(k.valorEsperado, 1)}</strong> por unidade apostada.
           </span>
         </div>`
      : `<div class="alert critical">
           <span class="icon">✕</span>
           <span>
             Sem valor: a odd implica <strong>${Fmt.pct(
               k.probabilidadeImplicita,
               1
             )}</strong> e tu só estimas <strong>${Fmt.pct(prob, 1)}</strong>.
             Kelly manda não apostar — o valor esperado é
             <strong>${Fmt.pctSinal(k.valorEsperado, 1)}</strong>.
           </span>
         </div>`;
  }

  /* ================================================================ *
   * Vista: metas
   * ================================================================ */

  function renderMetas() {
    const objetivos = estado.objetivos;

    $("#listaObjetivos").innerHTML = objetivos.length
      ? objetivos
          .map(
            (o) => `
        <div class="stat" style="margin-bottom: 10px">
          <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px">
            <span class="label">${esc(o.nome)}</span>
            <button class="btn-icon" data-acao="apagar-meta" data-id="${esc(
              o.id
            )}">Remover</button>
          </div>
          <span class="value sm">${Fmt.moeda(o.valorAtual, 0)} / ${Fmt.moeda(
              o.alvo,
              0
            )}</span>
          <div class="progress ${o.atingido ? "good" : ""}"><span style="width:${
              o.progresso
            }%"></span></div>
          <span class="note">
            ${
              o.atingido
                ? "✓ Objetivo alcançado"
                : o.diasEstimados !== null
                ? `Estimativa: ${Fmt.dataLonga(o.dataEstimada)} (${o.diasEstimados} dias)`
                : "Define um ROI alvo positivo para estimar"
            }
            ${
              o.prazo && !o.atingido
                ? o.noPrazo
                  ? ` · <span class="pos">dentro do prazo (${Fmt.dataCurta(o.prazo)})</span>`
                  : ` · <span class="neg">fora do prazo (${Fmt.dataCurta(o.prazo)})</span>`
                : ""
            }
          </span>
        </div>`
          )
          .join("")
      : '<p class="help">Sem objetivos. Marcos intermédios tornam a meta final menos abstrata.</p>';

    const conquistas = A.conquistas(estado.resumo);
    const desbloqueadas = conquistas.filter((c) => c.ok).length;
    $("#contagemConquistas").textContent = `${desbloqueadas} de ${conquistas.length}`;

    $("#listaConquistas").innerHTML = conquistas
      .map(
        (c) => `
      <div class="achievement ${c.ok ? "unlocked" : ""}">
        <div class="name">${c.ok ? "✓" : "○"} ${esc(c.nome)}</div>
        <div class="desc">${esc(c.desc)}</div>
        <div class="progress ${c.ok ? "good" : ""}"><span style="width:${
          c.progresso
        }%"></span></div>
      </div>`
      )
      .join("");
  }

  /* ================================================================ *
   * Vista: definições
   * ================================================================ */

  function renderDefinicoes() {
    const c = estado.config;
    $("#cfgBancaInicial").value = c.bancaInicial ?? "";
    $("#cfgMeta").value = c.meta ?? "";
    $("#cfgRoi").value = c.roi ?? "";
    $("#cfgMoeda").value = c.moeda || "EUR";

    const servidor = Dados.modo() === "servidor";
    $("#cartaoConta").classList.toggle("hidden", !servidor);

    if (servidor) {
      $("#infoConta").textContent = "A carregar…";
      Dados.auth
        .perfil()
        .then((p) => {
          $("#infoConta").innerHTML = `
            <strong>${esc(p.username)}</strong> · conta criada em ${Fmt.dataLonga(
            A.ymd(new Date(p.createdAt))
          )}<br />
            ${p.numLogins} ${p.numLogins === 1 ? "sessão" : "sessões"} ·
            último acesso ${Fmt.relativo(p.ultimoLogin)}<br />
            ${p.totais.dias} dias e ${p.totais.apostas} apostas guardados`;
        })
        .catch(() => {
          $("#infoConta").textContent = "Não foi possível carregar o perfil.";
        });
    }

    Dados.diagnostico()
      .then((d) => {
        const avisos = d.avisos.length
          ? d.avisos.map((a) => `<div class="alert warning"><span class="icon">⚠</span><span>${esc(a)}</span></div>`).join("")
          : '<div class="alert good"><span class="icon">✓</span><span>Tudo configurado.</span></div>';
        $("#infoDiagnostico").innerHTML = `
          Armazenamento: <strong>${esc(d.armazenamento)}</strong> ·
          ambiente: <strong>${esc(d.ambiente)}</strong>
          <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px">${avisos}</div>`;
      })
      .catch(() => {
        $("#infoDiagnostico").textContent =
          "API indisponível — a app está a correr só com dados locais.";
      });
  }

  /* ================================================================ *
   * Ações
   * ================================================================ */

  async function comErro(fn, mensagemPadrao) {
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast("error", e.message || mensagemPadrao || "Ocorreu um erro");
    }
  }

  async function registarSaldo() {
    const valor = parseFloat($("#inputSaldo").value);
    if (!isFinite(valor) || valor < 0) {
      toast("error", "Introduz um saldo válido");
      return;
    }
    await comErro(async () => {
      await Dados.historico.guardar({ dia: A.hoje(), valor });
      $("#inputSaldo").value = "";
      await recarregar();
      const hoje = estado.preparado[estado.preparado.length - 1];
      toast(
        "success",
        `Saldo registado · ${Fmt.pctSinal(hoje.roi)} (${Fmt.moedaSinal(hoje.lucro)})`
      );
    }, "Não foi possível registar o saldo");
  }

  async function fecharDiaAtual() {
    if (!confirmar("Fechar o dia de hoje? Deixas de poder registar até amanhã.")) return;
    await comErro(async () => {
      await Dados.historico.fechar(A.hoje());
      await recarregar();
      toast("success", "Dia fechado");
    });
  }

  async function guardarRegistoManual() {
    const dia = $("#registoData").value;
    const valor = parseFloat($("#registoValor").value);
    if (!dia) return toast("error", "Escolhe uma data");
    if (!isFinite(valor) || valor < 0) return toast("error", "Introduz um saldo válido");

    await comErro(async () => {
      await Dados.historico.guardar({ dia, valor, nota: $("#registoNota").value, forcar: true });
      $("#registoValor").value = "";
      $("#registoNota").value = "";
      await recarregar();
      toast("success", "Registo guardado");
    });
  }

  async function guardarAposta() {
    const resultado = $("#apostaResultado").value;
    const stake = parseFloat($("#apostaStake").value);
    const odd = parseFloat($("#apostaOdd").value);

    if (!isFinite(stake) || stake <= 0) return toast("error", "Introduz uma stake válida");
    if (resultado !== "cashout" && (!isFinite(odd) || odd < 1))
      return toast("error", "A odd tem de ser pelo menos 1");

    await comErro(async () => {
      await Dados.apostas.criar({
        dia: $("#apostaData").value || A.hoje(),
        descricao: $("#apostaDescricao").value,
        desporto: $("#apostaDesporto").value,
        mercado: $("#apostaMercado").value,
        tipster: $("#apostaTipster").value,
        stake,
        odd: isFinite(odd) ? odd : 0,
        resultado,
        lucro: parseFloat($("#apostaLucro").value) || 0,
      });
      ["apostaDescricao", "apostaStake", "apostaOdd", "apostaLucro"].forEach((id) => {
        $("#" + id).value = "";
      });
      await recarregar();
      toast("success", "Aposta adicionada");
    });
  }

  async function guardarObjetivo() {
    const nome = $("#metaNome").value.trim();
    const alvo = parseFloat($("#metaAlvo").value);
    if (!nome) return toast("error", "Dá um nome ao objetivo");
    if (!isFinite(alvo) || alvo <= 0) return toast("error", "Introduz um alvo válido");

    await comErro(async () => {
      await Dados.objetivos.criar({ nome, alvo, prazo: $("#metaPrazo").value || null });
      $("#metaNome").value = "";
      $("#metaAlvo").value = "";
      $("#metaPrazo").value = "";
      await recarregar();
      toast("success", "Objetivo criado");
    });
  }

  async function guardarConfig() {
    const dados = {
      bancaInicial: parseFloat($("#cfgBancaInicial").value),
      meta: parseFloat($("#cfgMeta").value),
      roi: parseFloat($("#cfgRoi").value),
      moeda: $("#cfgMoeda").value,
    };
    if (!isFinite(dados.bancaInicial) || dados.bancaInicial < 0)
      return toast("error", "Banca inicial inválida");

    await comErro(async () => {
      await Dados.config.guardar(dados);
      await recarregar();
      toast("success", "Definições guardadas");
    });
  }

  async function guardarRisco() {
    await comErro(async () => {
      await Dados.config.guardar({
        stopLoss: parseFloat($("#riscoStopLoss").value) || 0,
        stopWin: parseFloat($("#riscoStopWin").value) || 0,
        unidade: parseFloat($("#riscoUnidade").value) || 1,
      });
      await recarregar();
      toast("success", "Limites guardados");
    });
  }

  /* ---------------------------- exportação ------------------------- */

  function nomeFicheiro(extensao) {
    return `roi-tracker-${A.hoje()}.${extensao}`;
  }

  async function exportarJson() {
    await comErro(async () => {
      const dados = await Dados.backup.exportar();
      descarregar(nomeFicheiro("json"), JSON.stringify(dados, null, 2), "application/json");
      toast("success", "Backup exportado");
    });
  }

  function paraCsv(cabecalhos, linhas) {
    const escapar = (v) => {
      const s = String(v ?? "");
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cabecalhos, ...linhas].map((l) => l.map(escapar).join(";")).join("\r\n");
  }

  function exportarHistoricoCsv() {
    if (!estado.preparado.length) return toast("error", "Sem dados para exportar");
    const csv = paraCsv(
      ["Data", "Dia", "Saldo", "Lucro", "ROI %", "Acumulado", "Fechado", "Nota"],
      estado.preparado.map((h) => [
        h.dia,
        h.weekday,
        h.valor.toFixed(2),
        h.lucro.toFixed(2),
        h.roi.toFixed(2),
        h.lucroAcumulado.toFixed(2),
        h.fechado ? "sim" : "não",
        h.nota || "",
      ])
    );
    // BOM para o Excel abrir os acentos corretamente.
    descarregar("historico-" + nomeFicheiro("csv"), "﻿" + csv, "text/csv;charset=utf-8");
    toast("success", "Histórico exportado");
  }

  function exportarApostasCsv() {
    if (!estado.apostas.length) return toast("error", "Sem apostas para exportar");
    const csv = paraCsv(
      ["Data", "Descrição", "Desporto", "Mercado", "Tipster", "Stake", "Odd", "Resultado", "Lucro"],
      estado.apostas.map((a) => [
        a.dia,
        a.descricao || "",
        a.desporto || "",
        a.mercado || "",
        a.tipster || "",
        Number(a.stake).toFixed(2),
        a.odd ? Number(a.odd).toFixed(2) : "",
        a.resultado,
        A.apostaResolvida(a) ? A.lucroAposta(a).toFixed(2) : "",
      ])
    );
    descarregar("apostas-" + nomeFicheiro("csv"), "﻿" + csv, "text/csv;charset=utf-8");
    toast("success", "Apostas exportadas");
  }

  function importarBackup(ficheiro) {
    const leitor = new FileReader();
    leitor.onload = async () => {
      await comErro(async () => {
        const dados = JSON.parse(leitor.result);
        const substituir = confirmar(
          "OK = substituir tudo o que está guardado.\nCancelar = fundir com os dados atuais."
        );
        await Dados.backup.importar(dados, substituir ? "substituir" : "fundir");
        await recarregar();
        toast("success", "Backup importado");
      }, "Ficheiro de backup inválido");
    };
    leitor.readAsText(ficheiro);
  }

  /* ---------------------------- autenticação ----------------------- */

  function abrir(id) {
    document.getElementById(id).classList.add("open");
  }

  function fechar(id) {
    document.getElementById(id).classList.remove("open");
  }

  function mostrarErro(id, mensagem) {
    const el = document.getElementById(id);
    el.classList.toggle("hidden", !mensagem);
    if (mensagem) el.querySelector("span:last-child").textContent = mensagem;
  }

  async function entrar() {
    const username = $("#loginUser").value.trim();
    const password = $("#loginPass").value;
    if (!username || !password) return mostrarErro("erroLogin", "Preenche todos os campos");

    try {
      await Dados.auth.entrar(username, password);
      mostrarErro("erroLogin", "");
      $("#loginPass").value = "";
      fechar("overlayLogin");

      const migracao = await Dados.migrarLocalParaServidor();
      if (migracao.dias || migracao.apostas || migracao.config) {
        toast(
          "info",
          `Dados locais migrados: ${migracao.dias} dias, ${migracao.apostas} apostas`,
          5000
        );
      }
      // O que estava em localStorage fica lá como rede de segurança: se a
      // migração falhou a meio, apagá-lo aqui destruía o único original.

      toast("success", "Sessão iniciada");
      await recarregar();
    } catch (e) {
      mostrarErro("erroLogin", e.message);
    }
  }

  async function criarConta() {
    const username = $("#registoUser").value.trim();
    const password = $("#registoPass").value;
    const confirmacao = $("#registoPass2").value;

    if (password !== confirmacao)
      return mostrarErro("erroRegisto", "As senhas não coincidem");

    try {
      await Dados.auth.registar(username, password);
      mostrarErro("erroRegisto", "");
      $("#registoPass").value = "";
      $("#registoPass2").value = "";
      fechar("overlayRegisto");

      await Dados.migrarLocalParaServidor();

      toast("success", "Conta criada");
      await arrancar();
    } catch (e) {
      mostrarErro("erroRegisto", e.message);
    }
  }

  function sair() {
    if (!confirmar("Terminar sessão? Os dados ficam guardados na conta.")) return;
    Dados.auth.sair();
    location.reload();
  }

  async function mudarSenha() {
    const atual = $("#senhaAtual").value;
    const nova = $("#senhaNova").value;
    if (!atual || !nova) return mostrarErro("erroSenha", "Preenche todos os campos");

    try {
      await Dados.auth.mudarSenha(atual, nova);
      mostrarErro("erroSenha", "");
      $("#senhaAtual").value = "";
      $("#senhaNova").value = "";
      fechar("overlaySenha");
      toast("success", "Senha alterada");
    } catch (e) {
      mostrarErro("erroSenha", e.message);
    }
  }

  async function guardarBoasVindas() {
    const bancaInicial = parseFloat($("#bvBancaInicial").value);
    const meta = parseFloat($("#bvMeta").value);
    const roi = parseFloat($("#bvRoi").value);

    if (!isFinite(bancaInicial) || bancaInicial <= 0)
      return mostrarErro("erroBoasVindas", "Introduz a banca inicial");
    if (!isFinite(meta) || meta <= bancaInicial)
      return mostrarErro("erroBoasVindas", "A meta tem de ser maior que a banca inicial");

    try {
      await Dados.config.guardar({ bancaInicial, meta, roi: isFinite(roi) ? roi : 3 });
      mostrarErro("erroBoasVindas", "");
      fechar("overlayBoasVindas");
      await arrancar();
      toast("success", "Tudo pronto. Regista o saldo de hoje na barra lateral.");
    } catch (e) {
      mostrarErro("erroBoasVindas", e.message);
    }
  }

  /* ================================================================ *
   * Eventos
   * ================================================================ */

  function ligarEventos() {
    // navegação
    $$(".nav button").forEach((b) =>
      b.addEventListener("click", () => irPara(b.dataset.vista))
    );

    $$("#filtroPeriodo .segmented button").forEach((b) =>
      b.addEventListener("click", () => {
        estado.periodo = Number(b.dataset.periodo);
        $$("#filtroPeriodo .segmented button").forEach((o) =>
          o.setAttribute("aria-pressed", String(o === b))
        );
        recalcular();
        renderizar();
      })
    );

    // registo rápido
    $("#btnRegistar").addEventListener("click", registarSaldo);
    $("#inputSaldo").addEventListener("keydown", (e) => {
      if (e.key === "Enter") registarSaldo();
    });
    $("#btnFecharDia").addEventListener("click", fecharDiaAtual);

    // registos
    $("#btnGuardarRegisto").addEventListener("click", guardarRegistoManual);
    $("#tabelaRegistos").addEventListener("click", (e) => {
      const botao = e.target.closest("button[data-acao]");
      if (!botao) return;
      const { acao, dia } = botao.dataset;

      if (acao === "fechar") {
        comErro(async () => {
          await Dados.historico.fechar(dia);
          await recarregar();
          toast("success", "Dia fechado");
        });
      } else if (acao === "reabrir") {
        comErro(async () => {
          await Dados.historico.reabrir(dia);
          await recarregar();
          toast("success", "Dia reaberto");
        });
      } else if (acao === "apagar-dia") {
        if (!confirmar(`Apagar o registo de ${Fmt.dataLonga(dia)}?`)) return;
        comErro(async () => {
          await Dados.historico.apagarDia(dia);
          await recarregar();
          toast("success", "Registo apagado");
        });
      }
    });

    // apostas
    $("#btnGuardarAposta").addEventListener("click", guardarAposta);
    $("#apostaResultado").addEventListener("change", (e) => {
      $("#campoCashout").classList.toggle("hidden", e.target.value !== "cashout");
    });
    $("#filtroResultado").addEventListener("change", (e) => {
      estado.filtroResultado = e.target.value;
      renderApostas();
    });
    $("#tabelaApostas").addEventListener("click", (e) => {
      const botao = e.target.closest("button[data-acao]");
      if (!botao) return;
      const { acao, id, resultado } = botao.dataset;

      if (acao === "resolver") {
        comErro(async () => {
          await Dados.apostas.atualizar(id, { resultado });
          await recarregar();
          toast("success", "Aposta resolvida");
        });
      } else if (acao === "apagar-aposta") {
        if (!confirmar("Apagar esta aposta?")) return;
        comErro(async () => {
          await Dados.apostas.apagar(id);
          await recarregar();
          toast("success", "Aposta apagada");
        });
      }
    });

    // risco
    ["kellyOdd", "kellyProb", "kellyFracao"].forEach((id) =>
      $("#" + id).addEventListener("input", calcularKelly)
    );
    $("#btnGuardarRisco").addEventListener("click", guardarRisco);

    // metas
    $("#btnGuardarMeta").addEventListener("click", guardarObjetivo);
    $("#listaObjetivos").addEventListener("click", (e) => {
      const botao = e.target.closest('button[data-acao="apagar-meta"]');
      if (!botao) return;
      if (!confirmar("Remover este objetivo?")) return;
      comErro(async () => {
        await Dados.objetivos.apagar(botao.dataset.id);
        await recarregar();
        toast("success", "Objetivo removido");
      });
    });

    // definições
    $("#btnGuardarConfig").addEventListener("click", guardarConfig);
    $("#btnExportarJson").addEventListener("click", exportarJson);
    $("#btnExportarCsv").addEventListener("click", exportarHistoricoCsv);
    $("#btnExportarApostasCsv").addEventListener("click", exportarApostasCsv);
    $("#btnImportar").addEventListener("click", () => $("#ficheiroImportar").click());
    $("#ficheiroImportar").addEventListener("change", (e) => {
      if (e.target.files[0]) importarBackup(e.target.files[0]);
      e.target.value = "";
    });

    $("#btnApagarHistorico").addEventListener("click", () => {
      if (!confirmar("Apagar TODOS os registos diários? Não há como desfazer.")) return;
      comErro(async () => {
        await Dados.historico.apagarTudo();
        await recarregar();
        toast("success", "Histórico apagado");
      });
    });

    $("#btnResetTotal").addEventListener("click", () => {
      if (!confirmar("Apagar histórico, apostas e objetivos? Não há como desfazer.")) return;
      comErro(async () => {
        if (Dados.modo() === "servidor") {
          await Dados.backup.importar(
            { config: estado.config, historico: [], apostas: [], objetivos: [] },
            "substituir"
          );
        } else {
          Dados.limparLocal();
          await Dados.config.guardar(estado.config);
        }
        await recarregar();
        toast("success", "Dados apagados");
      });
    });

    // tema
    $("#btnTema").addEventListener("click", () => {
      const novo = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      aplicarTema(novo);
      if (estado.config) {
        estado.config.tema = novo;
        Dados.config.guardar({ tema: novo }).catch(() => {});
      }
      renderizar();
    });

    // sessão
    $("#btnSessao").addEventListener("click", () => {
      if (Dados.modo() === "servidor") sair();
      else abrir("overlayLogin");
    });
    $("#btnEntrar").addEventListener("click", entrar);
    $("#btnIrRegisto").addEventListener("click", () => {
      fechar("overlayLogin");
      abrir("overlayRegisto");
    });
    $("#btnVoltarLogin").addEventListener("click", () => {
      fechar("overlayRegisto");
      abrir("overlayLogin");
    });
    $("#btnCriarConta").addEventListener("click", criarConta);
    $("#btnModoLocal").addEventListener("click", async () => {
      try {
        localStorage.setItem(CHAVE_MODO_LOCAL, "1");
      } catch (e) {
        /* ignorado */
      }
      fechar("overlayLogin");
      await arrancar();
    });
    $("#loginPass").addEventListener("keydown", (e) => {
      if (e.key === "Enter") entrar();
    });

    $("#btnMudarSenha").addEventListener("click", () => abrir("overlaySenha"));
    $("#btnCancelarSenha").addEventListener("click", () => fechar("overlaySenha"));
    $("#btnConfirmarSenha").addEventListener("click", mudarSenha);

    // medidor de força da senha
    $("#registoPass").addEventListener("input", (e) => {
      const forca = calcularForca(e.target.value);
      $$("#forcaSenha i").forEach((barra, i) => {
        barra.className = i < forca ? "on-" + forca : "";
      });
      $("#textoForcaSenha").textContent =
        ["", "Muito fraca", "Fraca", "Razoável", "Forte"][forca] || "";
    });

    // boas-vindas
    $("#btnGuardarBoasVindas").addEventListener("click", guardarBoasVindas);

    // atalhos de teclado (1-7 = secções, r = registar, Esc = fechar modais)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        $$(".overlay.open").forEach((o) => o.classList.remove("open"));
        return;
      }
      // Não roubar Ctrl+R, Cmd+1, etc.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.matches("input, select, textarea")) return;

      const vistas = ["resumo", "registos", "apostas", "analise", "risco", "metas", "definicoes"];
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= vistas.length) irPara(vistas[n - 1]);
      if (e.key === "r") {
        e.preventDefault();
        $("#inputSaldo").focus();
      }
    });

    Dados.aoExpirar(() => {
      toast("error", "A sessão expirou. Entra novamente.", 6000);
      setTimeout(() => location.reload(), 1500);
    });
  }

  function calcularForca(senha) {
    let pontos = 0;
    if (senha.length >= 8) pontos++;
    if (senha.length >= 12) pontos++;
    if (/[a-z]/.test(senha) && /[A-Z]/.test(senha)) pontos++;
    if (/\d/.test(senha) && /[\W_]/.test(senha)) pontos++;
    return Math.min(4, pontos);
  }

  /* ================================================================ *
   * Arranque
   * ================================================================ */

  async function arrancar() {
    const hoje = A.hoje();
    $("#registoData").value = hoje;
    $("#registoData").max = hoje;
    $("#apostaData").value = hoje;
    $("#apostaData").max = hoje;
    $("#metaPrazo").min = hoje;

    const ok = await carregar();
    if (ok) {
      irPara(estado.vista);
    }
  }

  function inicializar() {
    aplicarTema(temaGuardado());
    ligarEventos();

    let escolheuLocal = false;
    try {
      escolheuLocal = !!localStorage.getItem(CHAVE_MODO_LOCAL);
    } catch (e) {
      /* ignorado */
    }

    let temDadosLocais = false;
    try {
      temDadosLocais = !!localStorage.getItem(Dados.CHAVES.config);
    } catch (e) {
      /* ignorado */
    }

    // Só interrompemos com o ecrã de login quem ainda não escolheu um caminho.
    if (!Dados.autenticado() && !escolheuLocal && !temDadosLocais) {
      abrir("overlayLogin");
      return;
    }

    arrancar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inicializar);
  } else {
    inicializar();
  }
})(window);
