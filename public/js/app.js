
/*
  app.js
  Lógica principal do ROI Tracker
*/

let config = JSON.parse(localStorage.getItem('configROI')) || null;
let historico = JSON.parse(localStorage.getItem('bancaHistorico')) || [];
let chart;

// Authentication helpers
function getAuthToken() {
  return localStorage.getItem('authToken');
}

function authFetch(path, opts = {}) {
  const headers = opts.headers || {};
  const token = getAuthToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  opts.headers = headers;
  return fetch(path, opts);
}

function showLogin() {
  document.getElementById('loginOverlay').style.display = 'grid';
  document.getElementById('registerOverlay').style.display = 'none';
}
function hideLogin() {
  document.getElementById('loginOverlay').style.display = 'none';
}

function showRegister() {
  document.getElementById('registerOverlay').style.display = 'grid';
  document.getElementById('loginOverlay').style.display = 'none';
}
function hideRegister() {
  document.getElementById('registerOverlay').style.display = 'none';
}

// Small toast/message helper
function showMessage(type, text, timeout = 3500) {
  const el = document.createElement('div');
  el.innerText = text;
  el.style.position = 'fixed';
  el.style.right = '18px';
  el.style.top = '18px';
  el.style.padding = '10px 14px';
  el.style.borderRadius = '8px';
  el.style.zIndex = 9999;
  el.style.color = '#fff';
  el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.6)';
  if (type === 'error') el.style.background = 'rgba(239,68,68,0.95)';
  else if (type === 'success') el.style.background = 'rgba(34,197,94,0.95)';
  else el.style.background = 'rgba(59,130,246,0.95)';
  document.body.appendChild(el);
  setTimeout(() => { el.style.transition = '0.25s'; el.style.opacity = '0'; setTimeout(()=>el.remove(), 250); }, timeout);
}

async function login() {
  const username = document.getElementById('loginUser').value;
  const password = document.getElementById('loginPass').value;
  if (!username || !password) return alert('Preencher os campos');
  const res = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username, password }) });
  const j = await res.json();
  if (!res.ok) { document.getElementById('loginMsg').innerText = j.error || 'Erro'; document.getElementById('loginMsg').style.display = 'block'; return; }
  localStorage.setItem('authToken', j.token);
  localStorage.setItem('authUser', JSON.stringify(j.user));
  document.getElementById('loginMsg').style.display = 'none';
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  hideLogin();
  showMessage('success','Sessão iniciada');
  initFromServer();
}

async function registerUser() {
  const username = document.getElementById('registerUser').value;
  const password = document.getElementById('registerPass').value;
  const passConfirm = document.getElementById('registerPassConfirm').value;
  // client-side validation
  const validation = validateSignup(username, password, passConfirm);
  if (validation) { document.getElementById('registerMsg').innerText = validation; document.getElementById('registerMsg').style.display = 'block'; return; }
  const res = await fetch('/api/auth/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username, password }) });
  const j = await res.json();
  if (!res.ok) { document.getElementById('registerMsg').innerText = j.error || 'Erro'; document.getElementById('registerMsg').style.display = 'block'; return; }
  localStorage.setItem('authToken', j.token);
  localStorage.setItem('authUser', JSON.stringify(j.user));
  document.getElementById('registerMsg').style.display = 'none';
  document.getElementById('registerUser').value = '';
  document.getElementById('registerPass').value = '';
  document.getElementById('registerPassConfirm').value = '';
  hideRegister();
  showMessage('success','Conta criada');
  initFromServer();
}

function validateSignup(u,p,pc) {
  if (!u || !p || !pc) return 'Preencher os campos';
  if (p !== pc) return 'As senhas não coincidem';
  const userRe = /^[a-zA-Z0-9_.-]{3,30}$/;
  const passRe = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
  if (!userRe.test(u)) return 'Username inválido. Use 3-30 chars (letters, numbers, _ . -).';
  if (!passRe.test(p)) return 'Senha fraca. Use 8+ chars, maiúscula, minúscula, dígito e símbolo.';
  return null;
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUser');
  location.reload();
}

function toggleConfig() {
  const overlay = document.getElementById('configOverlay');
  overlay.style.display = (overlay.style.display === 'grid') ? 'none' : 'grid';
}

function guardarConfig() {
  config = {
    bancaInicial: parseFloat(document.getElementById('bancaInicial').value),
    meta: parseFloat(document.getElementById('metaBanca').value),
    roi: parseFloat(document.getElementById('roiMeta').value),
    dataCriacao: config?.dataCriacao || new Date().toISOString()
  };
  localStorage.setItem('configROI', JSON.stringify(config));
  // sync to server if logged
  const token = getAuthToken();
  if (token) {
    authFetch('/api/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ bancaInicial: config.bancaInicial, meta: config.meta, roi: config.roi }) })
      .then(r => { if (!r.ok) showMessage('error','Erro ao gravar config'); else showMessage('success','Config guardada'); })
      .catch(()=> showMessage('error','Erro ao gravar config'));
  }
  location.reload();
}

function resetTotal() {
  if (confirm("Tens a certeza? Isto apagará todo o teu histórico!")) {
    const token = getAuthToken();
    if (token) {
      authFetch('/api/historico', { method: 'DELETE' }).then(r=> { if (r.ok) showMessage('success','Histórico apagado'); else showMessage('error','Erro ao apagar'); }).catch(()=>showMessage('error','Erro ao apagar'));
    }
    localStorage.clear();
    location.reload();
  }
}

function getBaseCalculo() {
  if (!config) return 0; // config not loaded yet
  const hoje = new Date().toDateString();
  if (historico.length === 0) return config.bancaInicial;
  const ultimo = historico[historico.length - 1];
  if (ultimo.dia === hoje) return (historico.length > 1) ? historico[historico.length - 2].valor : config.bancaInicial;
  return ultimo.valor;
}

function fecharDia() {
  if (!confirm("Fechar o dia? Só poderás registar novamente amanhã.")) return;
  const hoje = new Date().toDateString();
  if (historico.length > 0 && historico[historico.length - 1].dia === hoje) {
    historico[historico.length - 1].fechado = true;
    localStorage.setItem('bancaHistorico', JSON.stringify(historico));
    verificarBloqueio();
  }
}

function verificarBloqueio() {
  const hoje = new Date().toDateString();
  const ultimo = historico[historico.length - 1];
  const btnRegistar = document.getElementById('btnRegistar');
  const btnFechar = document.getElementById('btnFecharDia');
  const input = document.getElementById('bancaAtual');
  const msg = document.getElementById('msgBloqueio');

  if (ultimo && ultimo.dia === hoje) {
    btnFechar.style.display = ultimo.fechado ? 'none' : 'block';
    if (ultimo.fechado) {
      btnRegistar.disabled = true;
      input.disabled = true;
      msg.style.display = 'block';
    }
  }
}

function exportarCSV() {
  // if logged in, fetch from server
  const token = getAuthToken();
  const doExport = (rows) => {
    if (!rows || rows.length === 0) return alert('Sem dados.');
    let csv = "Data,Valor,ROI,Fechado\n";
    rows.forEach(h => csv += `${h.dia},${h.valor},${(h.roi||0).toFixed(2)}%,${h.fechado}\n`);
    const meses = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
    const dI = new Date(rows[0].dia);
    const dF = new Date();
    const nome = `${dI.getDate()}${meses[dI.getMonth()]}${dI.getFullYear()}-${dF.getDate()}${meses[dF.getMonth()]}${dF.getFullYear()}.csv`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
  };

  if (token) {
    authFetch('/api/historico').then(r => { if (!r.ok) throw new Error('err'); return r.json(); }).then(doExport).catch(()=>showMessage('error','Erro ao exportar'));
  } else {
    doExport(historico);
  }
}

function atualizarInterface(valorAtual, roiDia) {
  if (!config) return;
  const baseDia = getBaseCalculo();
  const crescTotal = ((valorAtual - config.bancaInicial) / config.bancaInicial) * 100;
  const lucro = valorAtual - config.bancaInicial;
  const percConcluido = lucro > 0 ? (lucro / config.meta) * 100 : 0;
  const valorAlvoHoje = baseDia * (1 + (config.roi / 100));

  document.getElementById('saldoAtual').innerText = valorAtual.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  document.getElementById('progressBar').style.width = Math.min(percConcluido, 100) + '%';
  document.getElementById('percConcluido').innerText = percConcluido.toFixed(2) + '% concluído';
  
  document.getElementById('roiDia').innerHTML = `<span class="${roiDia >= 0 ? 'positive' : 'negative'}">${roiDia.toFixed(2)}%</span>`;
  
  if (valorAtual >= valorAlvoHoje) {
    const diasAv = Math.log(valorAtual / valorAlvoHoje) / Math.log(1 + (config.roi / 100));
    document.getElementById('faltaHoje').innerHTML = `<span class="positive">+${diasAv.toFixed(1)} dias avançados</span>`;
  } else {
    document.getElementById('faltaHoje').innerText = `Falta ${(valorAlvoHoje - valorAtual).toFixed(2)}€ p/ meta`;
  }

  document.getElementById('crescimentoTotal').innerText = crescTotal.toFixed(1) + '%';
  document.getElementById('notaObjetivo').innerText = `Falta crescer ${( (config.meta - valorAtual)/valorAtual * 100 ).toFixed(0)}%`;
  
  if (valorAtual < config.meta) {
    const diasRes = Math.ceil(Math.log(config.meta / valorAtual) / Math.log(1 + (config.roi / 100)));
    let dAlvo = new Date(); dAlvo.setDate(dAlvo.getDate() + diasRes);
    document.getElementById('previsaoDias').innerText = dAlvo.toLocaleDateString('pt-PT', {day:'numeric', month:'short'});
    document.getElementById('alvoAmanha').innerText = `Objetivo amanhã: +${(valorAtual * (config.roi/100)).toFixed(2)}€`;
  } else {
    document.getElementById('previsaoDias').innerText = "CONCLUÍDO";
  }
}

function registarDia() {
  if (!config) {
    showMessage('error', 'Carrega a página e define a configuração primeiro');
    return;
  }
  const v = parseFloat(document.getElementById('bancaAtual').value);
  if (isNaN(v)) return;
  const hoje = new Date().toDateString();
  const base = getBaseCalculo();
  const roi = ((v - base) / base) * 100;
  const entry = { dia: hoje, weekday: new Date().toLocaleDateString('pt-PT', {weekday:'short'}), valor: v, roi: roi, fechado: false };
  const token = getAuthToken();
  if (token) {
    authFetch('/api/historico', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(entry) })
      .then(r => { if (!r.ok) throw new Error('err'); return r.json(); })
      .then(()=> { fetchHistoricoFromServer(); showMessage('success','Registo guardado'); })
      .catch(()=> showMessage('error','Erro ao registar'));
  } else {
    if (historico.length && historico[historico.length - 1].dia === hoje) {
      historico[historico.length - 1].valor = v;
      historico[historico.length - 1].roi = roi;
    } else {
      historico.push(entry);
    }
    localStorage.setItem('bancaHistorico', JSON.stringify(historico));
    atualizarInterface(v, roi);
    atualizarGrafico();
    verificarBloqueio();
    document.getElementById('bancaAtual').value = "";
  }
}

function atualizarGrafico() {
  const labels = historico.map(h => h.weekday);
  const dataReal = historico.map(h => h.valor);
  const labelsProj = [...labels];
  const dataProj = new Array(Math.max(0, dataReal.length - 1)).fill(null);
  let vRef = dataReal.length ? dataReal[dataReal.length - 1] : config.bancaInicial;
  dataProj.push(vRef);
  for (let i = 1; i <= 5; i++) { labelsProj.push(`+${i}d`); vRef *= (1 + (config.roi / 100)); dataProj.push(vRef); }

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('grafico'), {
    type: 'line',
    data: { 
      labels: labelsProj, 
      datasets: [
        { label: 'Histórico', data: dataReal, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4, pointRadius: 4 },
        { label: 'Projeção', data: dataProj, borderColor: 'rgba(161, 161, 170, 0.4)', borderDash: [5, 5], fill: false, tension: 0.4, pointRadius: 0 }
      ] 
    },
    options: { 
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { 
        y: { grid: { color: '#27272a' }, ticks: { color: '#71717a', font: { size: 10 } } }, 
        x: { grid: { display: false }, ticks: { color: '#71717a', font: { size: 10 } } } 
      }
    }
  });
}

// Server sync helpers
async function fetchHistoricoFromServer() {
  try {
    const res = await authFetch('/api/historico');
    if (!res.ok) throw new Error('not ok');
    const rows = await res.json();
    const serverRows = rows.map(r => ({ dia: r.dia, weekday: r.weekday, valor: r.valor, roi: r.roi, fechado: !!r.fechado }));
    // if server has no rows but localStorage has data, migrate local -> server
    const local = JSON.parse(localStorage.getItem('bancaHistorico')) || [];
    if ((!serverRows || serverRows.length === 0) && local && local.length > 0) {
      // migrate each local entry to server (upsert)
      for (const e of local) {
        try { await authFetch('/api/historico', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(e) }); } catch (e) { console.warn('migrate historico item failed', e); }
      }
      // reload from server
      return fetchHistoricoFromServer();
    }
    historico = serverRows;
    localStorage.setItem('bancaHistorico', JSON.stringify(historico));
    if (historico.length) { const ultimo = historico[historico.length - 1].valor; const roi = historico[historico.length - 1].roi || 0; atualizarInterface(ultimo, roi); atualizarGrafico(); verificarBloqueio(); }
  } catch (e) { console.warn('Could not load historico from server', e); }
}

async function fetchConfigFromServer() {
  try {
    const res = await authFetch('/api/config');
    if (!res.ok) throw new Error('no config');
    const c = await res.json();
    const localConfig = JSON.parse(localStorage.getItem('configROI')) || null;
    if (c) {
      config = { bancaInicial: c.bancaInicial, meta: c.meta, roi: c.roi, dataCriacao: new Date().toISOString() };
      localStorage.setItem('configROI', JSON.stringify(config));
    } else if (localConfig) {
      // migrate local config to server
      await authFetch('/api/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ bancaInicial: localConfig.bancaInicial, meta: localConfig.meta, roi: localConfig.roi }) });
      // re-fetch config
      return fetchConfigFromServer();
    } else {
      // no config anywhere -> prompt user to set config
      toggleConfig();
    }
  } catch (e) { console.warn('No config on server'); }
}

async function initFromServer() {
  // fetch config first (and migrate local config if present)
  await fetchConfigFromServer();
  // then fetch historico (and migrate local historico if present)
  await fetchHistoricoFromServer();
}

// Init
const token = getAuthToken();
if (token) {
  // try to initialize from server
  initFromServer();
} else {
  // if user not logged, show login overlay
  showLogin();
}

if (config) {
  const ultimo = historico.length ? historico[historico.length - 1].valor : config.bancaInicial;
  const roi = historico.length ? historico[historico.length - 1].roi : 0;
  atualizarInterface(ultimo, roi);
  if (historico.length) { atualizarGrafico(); verificarBloqueio(); }
} else { toggleConfig(); }
