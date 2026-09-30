# ROI Tracker

Dashboard de gestão de banca: registo diário, análise de apostas individuais,
métricas de risco e projeções Monte Carlo. Corre no Vercel como site estático +
serverless functions, sem build step.

## O que faz

**Registo diário** — snapshot do saldo por dia, com fecho de dia, notas, edição
retroativa e correção de dias antigos. O ROI de cada dia é sempre derivado do dia
anterior, por isso corrigir um dia antigo recalcula tudo o que vem a seguir.

**Apostas individuais** — stake, odd, desporto, mercado, tipster, casa e
resultado (green / red / meio-green / meio-red / anulada / cashout / pendente).
Daí saem yield, turnover, taxa de acerto, odd média e a *edge* implícita (a
diferença entre a probabilidade que a odd implica e a que tu realmente acertas).

**Análise** — distribuição dos resultados diários, lucro por dia da semana,
tabela mensal, e agrupamentos por tipster e por mercado ordenados por lucro.

**Risco** — drawdown máximo e atual (com duração), volatilidade, Sharpe e
Sortino anualizados, risco de ruína, calculadora de Kelly fracionário e limites
diários de stop-loss / stop-win que disparam um aviso no topo do dashboard.

**Projeção Monte Carlo** — em vez de assumir que ganhas exatamente o ROI-alvo
todos os dias, reamostra os teus resultados diários reais 600 vezes e mostra a
banda onde caem 80% dos cenários, a probabilidade de atingir a meta e a
probabilidade de perder metade da banca.

**Metas e conquistas** — objetivos intermédios com prazo e estimativa de data de
chegada, mais oito conquistas derivadas do histórico.

**Modo local** — a app funciona sem conta, guardando tudo em `localStorage`. Ao
criares conta, o que está local é migrado para o servidor.

## Stack

- Frontend: HTML/CSS/JS vanilla + Chart.js 4 (via CDN), sem bundler
- Backend: Vercel Serverless Functions (Node ≥ 18)
- Dados: Vercel KV / Upstash Redis → Edge Config → memória (por esta ordem)

## Correr localmente

```bash
npm install
npm run local      # → http://localhost:3000
```

`npm run local` usa `scripts/dev-local.js`, um servidor mínimo que emula o
runtime da Vercel: serve `public/` como estático e mapeia `/api/<rota>` para os
handlers em `api/`, incluindo rotas dinâmicas (`/api/bets/:id` →
`api/bets/[id].js`). Não precisa de conta na Vercel, ao contrário do
`npm run dev` (`vercel dev`), que exige `vercel login` e projeto ligado.

Sem KV configurado corre com o driver de memória: os dados desaparecem quando
parares o processo. É o esperado em desenvolvimento — `/api/health` avisa-te.

## Deploy

```bash
npm i -g vercel
vercel login
vercel
```

### 1. Base de dados (importante)

Sem storage configurado a app corre em **memória** e os dados desaparecem a cada
cold start. Abre `/api/health` depois do deploy para ver em que driver estás.

**Opção recomendada — Vercel KV (Redis):**

1. Dashboard do Vercel → o teu projeto → **Storage** → **Create Database** → **KV**
2. **Connect to Project** — as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN`
   são injetadas automaticamente

Upstash direto também funciona (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`).

**Alternativa — Edge Config:** define `EDGE_CONFIG` e `EDGE_CONFIG_ACCESS_TOKEN`.
Funciona, mas as escritas passam pela API REST da Vercel, são lentas e têm rate
limits apertados — serve para uso pessoal, não para várias pessoas.

### 2. JWT_SECRET

Settings → Environment Variables → `JWT_SECRET` com uma string longa aleatória:

```bash
openssl rand -hex 32
```

Sem isto as sessões são assinadas com uma chave de desenvolvimento conhecida e
qualquer pessoa pode forjar um token.

### 3. Redeploy

```bash
vercel --prod
```

## API

Todas as rotas exceto `/api/health` e `/api/auth/*` exigem
`Authorization: Bearer <token>`.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/register` | Criar conta (5/hora por IP) |
| POST | `/api/auth/login` | Entrar (10/5min por IP) |
| POST | `/api/auth/password` | Mudar senha |
| GET | `/api/me` | Perfil, totais e driver de storage |
| GET/POST/PATCH | `/api/config` | Parâmetros da banca e de risco |
| GET | `/api/historico` | Snapshots diários |
| POST | `/api/historico` | Upsert de um dia |
| PATCH | `/api/historico` | `{dia, acao: "fechar"\|"reabrir"}` |
| DELETE | `/api/historico[?dia=]` | Apagar um dia ou todos |
| GET/POST | `/api/bets` | Apostas (filtros: `dia`, `de`, `ate`, `resultado`, `tipster`, `limite`) |
| PATCH/DELETE | `/api/bets/:id` | Editar ou apagar uma aposta |
| GET | `/api/stats[?dias=]` | Analítica completa calculada no servidor |
| GET/POST/PATCH/DELETE | `/api/goals` | Objetivos |
| GET/POST/DELETE | `/api/backup` | Exportar, importar (`modo: "fundir"\|"substituir"`), apagar |
| GET | `/api/health` | Diagnóstico — driver, ambiente, avisos |

## Estrutura

```
├── api/                    → Serverless Functions (uma rota por pasta)
│   ├── auth/{login,register,password}.js
│   ├── bets/{index,[id]}.js
│   ├── {config,goals,health,historico,me,stats}/index.js
│   └── backup/index.js
├── lib/
│   ├── store.js            → storage key/value, drivers intermutáveis
│   ├── db.js               → modelo de dados sobre o store
│   ├── auth.js             → JWT, rate limiting, validação
│   └── http.js             → routing, erros, cabeçalhos de segurança
├── scripts/
│   └── dev-local.js        → servidor de dev sem dependência do Vercel CLI
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── analytics.js    → TODA a matemática (partilhado browser + servidor)
│       ├── ui.js           → formatadores, toasts, helpers de DOM
│       ├── api.js          → acesso a dados (servidor ou localStorage)
│       ├── charts.js       → Chart.js
│       └── app.js          → estado, vistas, eventos
├── vercel.json
└── package.json
```

### Uma nota sobre `analytics.js`

É um módulo UMD carregado tal e qual pelo browser (`window.Analytics`) e pelas
serverless functions (`require("../../public/js/analytics.js")`). Isso é
deliberado: o dashboard e o `/api/stats` nunca podem divergir no cálculo de um
ROI ou de um drawdown. `vercel.json` inclui-o explicitamente no bundle das
funções via `functions.includeFiles`.

## Atalhos de teclado

`1`–`7` saltam entre secções · `r` foca o campo de registo · `Esc` fecha modais.

## Notas de migração da v1

- As datas passaram de `toDateString()` (`"Mon Sep 29 2025"`) para ISO
  (`"2025-09-29"`). A leitura converte o formato antigo automaticamente, por isso
  históricos existentes continuam a funcionar.
- O fecho de dia passou a ser gravado no servidor. Na v1 vivia só em
  `localStorage`, logo perdia-se em qualquer outro dispositivo.
- As chaves de utilizador com caracteres fora de `[A-Za-z0-9_-]` (por exemplo um
  `.` no username) são agora codificadas — na v1 essas contas rebentavam a
  escrita no Edge Config.
