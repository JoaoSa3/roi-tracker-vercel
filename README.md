# ROI Tracker — Vercel Edition

Dashboard para tracking de banca e ROI diário, otimizado para deploy no Vercel.

## Stack
- Frontend: HTML / CSS / JS (vanilla) + Chart.js
- Backend: Vercel Serverless Functions (Node.js)
- Database: Vercel KV (Redis)

## Deploy no Vercel

### 1. Criar projeto no Vercel
```bash
npm i -g vercel
vercel login
vercel
```

### 2. Configurar Vercel KV
1. Vai ao dashboard do Vercel → o teu projeto → **Storage**
2. Clica **Create Database** → escolhe **KV (Redis)**
3. Dá o nome `roi-tracker-kv` (ou outro)
4. Clica **Connect to Project** → seleciona o teu projeto
5. As env vars (`KV_URL`, `KV_REST_API_URL`, etc.) são injetadas automaticamente

### 3. Configurar JWT_SECRET
No dashboard do Vercel → Settings → Environment Variables:
- `JWT_SECRET` = uma string aleatória longa (ex: `openssl rand -hex 32`)

### 4. Redeploy
Após configurar o KV e JWT_SECRET, faz redeploy:
```bash
vercel --prod
```

## Estrutura
```
roi-tracker-vercel/
├── api/              → Serverless Functions
│   ├── auth/
│   │   ├── login.js
│   │   └── register.js
│   ├── config/
│   │   └── index.js
│   ├── historico/
│   │   └── index.js
│   └── me/
│       └── index.js
├── lib/
│   ├── auth.js       → JWT helpers
│   └── db.js         → Vercel KV database layer
├── public/           → Frontend estático
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── vercel.json
├── package.json
└── README.md
```

## Notas
- As API routes são automaticamente servidas em `/api/*` pelo Vercel
- O frontend está em `public/` e é servido como ficheiros estáticos
- Os dados persistem no Vercel KV (Redis) — sobrevivem a cold starts
- O plano Hobby (gratuito) do Vercel KV oferece 256MB de storage
