/* ============================================================
   ARRUDA'S FINANCE — múltiplas dívidas, abas, quitadas e Supabase
   ============================================================ */

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const CIRC  = 2 * Math.PI * 55;

let dividas = [];
let activeTabId = null;
let currentUser = null;

/* ── Helpers de cálculo ── */
function isQuitada(d) {
  return d.parcelas.length > 0 && d.parcelas.every(p => p.paga);
}

function calcDivida(d) {
  const total       = d.parcelas.reduce((s, p) => s + p.valor, 0);
  const descontado  = d.parcelas.reduce((s, p) => s + (p.paga ? p.valor : 0), 0);
  const restante    = total - descontado;
  const pct         = total ? Math.round((descontado / total) * 100) : 0;
  const numPagas    = d.parcelas.filter(p => p.paga).length;
  const numFaltam   = d.parcelas.length - numPagas;
  const proxIdx     = d.parcelas.findIndex(p => !p.paga);
  return { total, descontado, restante, pct, numPagas, numFaltam, proxIdx };
}

function periodoTexto(d) {
  if (!d.parcelas.length) return '—';
  const anos = [...new Set(d.parcelas.map(p => p.ano))];
  return anos.length === 1 ? `${anos[0]}` : `${anos[0]} / ${anos[anos.length - 1]}`;
}

/* ── Toast ── */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */

let modoAuth = 'login'; // 'login' | 'cadastro'

function showAuthScreen() {
  document.getElementById('auth-screen').classList.add('show');
  document.getElementById('app-screen').classList.remove('show');
}

function showAppScreen() {
  document.getElementById('auth-screen').classList.remove('show');
  document.getElementById('app-screen').classList.add('show');
  document.getElementById('header-user-email').textContent = currentUser?.email || '';
}

async function checkSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    currentUser = session.user;
    showAppScreen();
    await iniciarApp();
  } else {
    showAuthScreen();
  }
}

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    currentUser = session.user;
    showAppScreen();
    iniciarApp();
  } else if (event === 'SIGNED_OUT') {
    currentUser = null;
    dividas = [];
    activeTabId = null;
    showAuthScreen();
  }
});

function showAuthMsg(msg, isSuccess = false) {
  const el = document.getElementById('auth-msg');
  el.textContent = msg;
  el.style.color = isSuccess ? 'var(--accent)' : 'var(--accent3)';
}

function traduzErroAuth(msg) {
  if (msg.includes('Invalid login credentials')) return 'Email ou senha incorretos';
  if (msg.includes('User already registered')) return 'Já existe uma conta com esse email';
  if (msg.includes('Password should be at least')) return 'Senha muito curta (mínimo 6 caracteres)';
  return msg;
}

async function fazerLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const senha = document.getElementById('auth-senha').value;
  if (!email || !senha) { showAuthMsg('Preencha email e senha'); return; }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
  if (error) { showAuthMsg(traduzErroAuth(error.message)); return; }
}

async function fazerCadastro() {
  const email = document.getElementById('auth-email').value.trim();
  const senha = document.getElementById('auth-senha').value;
  if (!email || !senha) { showAuthMsg('Preencha email e senha'); return; }
  if (senha.length < 6) { showAuthMsg('A senha precisa ter no mínimo 6 caracteres'); return; }

  const { error } = await supabaseClient.auth.signUp({ email, password: senha });
  if (error) { showAuthMsg(traduzErroAuth(error.message)); return; }

  showAuthMsg('Conta criada! Você já pode entrar.', true);
  modoAuth = 'login';
  atualizarTelaAuth();
}

async function fazerLogout() {
  await supabaseClient.auth.signOut();
}

function alternarModoAuth() {
  modoAuth = modoAuth === 'login' ? 'cadastro' : 'login';
  atualizarTelaAuth();
}

function atualizarTelaAuth() {
  document.getElementById('auth-msg').textContent = '';
  document.getElementById('btn-auth-confirmar').textContent = modoAuth === 'login' ? 'Entrar' : 'Criar Conta';
  document.getElementById('auth-titulo').textContent = modoAuth === 'login' ? 'Entrar' : 'Criar Conta';
  document.getElementById('auth-toggle-texto').textContent = modoAuth === 'login'
    ? 'Ainda não tem conta?'
    : 'Já tem uma conta?';
  document.getElementById('btn-auth-toggle').textContent = modoAuth === 'login' ? 'Cadastre-se' : 'Entrar';
}

/* ============================================================
   CARREGAMENTO DE DADOS (SUPABASE)
   ============================================================ */

async function iniciarApp() {
  await loadDividas();
  activeTabId = dividas.length ? dividas[0].id : null;
  renderTabs();
  renderContent();
}

async function loadDividas() {
  const { data, error } = await supabaseClient
    .from('dividas')
    .select('id, titulo, created_at, parcelas(id, mes, ano, valor, paga, ordem)')
    .order('created_at', { ascending: true });

  if (error) {
    showToast('Erro ao carregar dados: ' + error.message);
    dividas = [];
    return;
  }

  dividas = (data || []).map(d => ({
    id: d.id,
    titulo: d.titulo,
    parcelas: (d.parcelas || []).slice().sort((a, b) => a.ordem - b.ordem),
  }));
}

/* ── Tabs ── */
function renderTabs() {
  const bar = document.getElementById('tab-bar');
  const ativas    = dividas.filter(d => !isQuitada(d));
  const quitadas  = dividas.filter(isQuitada);

  let html = '';
  ativas.forEach(d => {
    html += `<button class="tab ${d.id === activeTabId ? 'active' : ''}" data-id="${d.id}">${d.titulo}</button>`;
  });
  html += `<button class="tab tab-quitadas ${activeTabId === '__quitadas__' ? 'active' : ''}" data-id="__quitadas__">✓ Quitadas (${quitadas.length})</button>`;
  html += `<button class="tab tab-add" id="btn-add-divida">+ Nova Dívida</button>`;

  bar.innerHTML = html;

  bar.querySelectorAll('.tab[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTabId = btn.dataset.id;
      renderTabs();
      renderContent();
    });
  });
  document.getElementById('btn-add-divida').addEventListener('click', openModal);
}

/* ── Conteúdo principal ── */
function renderContent() {
  const content = document.getElementById('app-content');

  if (!dividas.length) {
    content.innerHTML = `<div class="quitadas-empty">Nenhuma dívida cadastrada.<br/>Clique em <strong>+ Nova Dívida</strong> para começar.</div>`;
    return;
  }

  if (activeTabId === '__quitadas__') {
    renderQuitadasList(content);
    return;
  }

  const d = dividas.find(x => x.id === activeTabId);
  if (!d) {
    activeTabId = dividas[0].id;
    renderTabs();
    return renderContent();
  }
  renderDashboard(content, d);
}

function renderQuitadasList(content) {
  const quitadas = dividas.filter(isQuitada);

  if (!quitadas.length) {
    content.innerHTML = `<div class="quitadas-empty">Nenhuma dívida quitada ainda.<br/>Quando todas as parcelas de uma dívida forem marcadas como pagas, ela aparece aqui.</div>`;
    return;
  }

  let html = `<div class="quitadas-grid">`;
  quitadas.forEach(d => {
    const { total, numPagas } = calcDivida(d);
    html += `
      <div class="quitada-card" data-id="${d.id}">
        <div class="qc-check">✓</div>
        <div class="qc-title">${d.titulo}</div>
        <div class="qc-info">${numPagas} parcelas · ${periodoTexto(d)}</div>
        <div class="qc-total">R$ ${total.toLocaleString('pt-BR')} quitados</div>
      </div>`;
  });
  html += `</div>`;
  content.innerHTML = html;

  content.querySelectorAll('.quitada-card').forEach(card => {
    card.addEventListener('click', () => {
      activeTabId = card.dataset.id;
      renderTabs();
      renderContent();
    });
  });
}

/* ── Dashboard de uma dívida ── */
function renderDashboard(content, d) {
  const { total, descontado, restante, pct, numPagas, numFaltam, proxIdx } = calcDivida(d);
  const quitada = isQuitada(d);

  let proximaLabel = '—', proximaVal = '—';
  if (proxIdx >= 0) {
    const p = d.parcelas[proxIdx];
    proximaLabel = p.mes;
    proximaVal = `R$ ${p.valor.toLocaleString('pt-BR')} a descontar`;
  } else if (d.parcelas.length) {
    proximaLabel = '🎉 Quitado!';
    proximaVal = 'Dívida encerrada';
  }

  content.innerHTML = `
    <div class="dashboard-header">
      <div>
        <h2 class="dashboard-title">${d.titulo}</h2>
        <div class="dashboard-badge">${periodoTexto(d)} · ${d.parcelas.length} parcelas</div>
      </div>
      <div class="dashboard-actions">
        ${quitada ? `<button class="btn-back" id="btn-voltar-quitadas">← Voltar para Quitadas</button>` : ''}
        <button class="btn-delete" id="btn-delete-divida" title="Excluir dívida">🗑</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card green">
        <div class="stat-label">Valor Total da Dívida</div>
        <div class="stat-value">R$ ${total.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">${d.parcelas.length} parcelas</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Já Descontado</div>
        <div class="stat-value">R$ ${descontado.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">${numPagas} parcela${numPagas !== 1 ? 's' : ''} paga${numPagas !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card pink">
        <div class="stat-label">Saldo Restante</div>
        <div class="stat-value">R$ ${restante.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">${numFaltam} parcela${numFaltam !== 1 ? 's' : ''} restante${numFaltam !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card gold">
        <div class="stat-label">Próxima Parcela</div>
        <div class="stat-value">${proximaLabel}</div>
        <div class="stat-sub">${proximaVal}</div>
      </div>
    </div>

    <div class="progress-section">
      <div class="section-title">Progresso Geral</div>
      <div class="progress-header">
        <span class="progress-label">Dívida quitada</span>
        <span class="progress-pct">${pct}%</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="progress-info">
        <span>R$ ${descontado.toLocaleString('pt-BR')} descontados</span>
        <span>R$ ${total.toLocaleString('pt-BR')} total</span>
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-card">
        <div class="section-title">Parcelas pagas</div>
        <div class="donut-wrap">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="55" fill="none" stroke="#1e1e2e" stroke-width="18"/>
            <circle id="donut-pagas" class="donut-circle" cx="70" cy="70" r="55"
              fill="none" stroke="url(#g1)" stroke-width="18"
              stroke-dasharray="0 ${CIRC}" stroke-linecap="round"/>
            <defs>
              <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#60f0c8"/>
                <stop offset="100%" stop-color="#c8f060"/>
              </linearGradient>
            </defs>
          </svg>
          <div class="donut-center">
            <div class="val" id="d-pagas">0</div>
            <div class="lbl">de ${d.parcelas.length}</div>
          </div>
        </div>
      </div>
      <div class="chart-card">
        <div class="section-title">% da dívida quitada</div>
        <div class="donut-wrap">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="55" fill="none" stroke="#1e1e2e" stroke-width="18"/>
            <circle id="donut-pct" class="donut-circle" cx="70" cy="70" r="55"
              fill="none" stroke="url(#g2)" stroke-width="18"
              stroke-dasharray="0 ${CIRC}" stroke-linecap="round"/>
            <defs>
              <linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#f060a8"/>
                <stop offset="100%" stop-color="#c8f060"/>
              </linearGradient>
            </defs>
          </svg>
          <div class="donut-center">
            <div class="val" id="d-pct">0%</div>
            <div class="lbl">quitado</div>
          </div>
        </div>
      </div>
    </div>

    <div class="timeline-section">
      <div class="section-title">Cronograma de Parcelas</div>
      <div class="timeline-hint">Clique na parcela para marcar/desmarcar como paga · use o ✏️ para editar o valor</div>
      <div class="parcelas-grid" id="parcelas-grid"></div>
    </div>

    <div class="footer-note">Dados salvos na nuvem (Supabase) · Sincronizado com sua conta</div>
  `;

  renderParcelasGrid(d);

  // anima os donuts depois de montar o DOM
  setTimeout(() => {
    const arcPagas = d.parcelas.length ? (numPagas / d.parcelas.length) * CIRC : 0;
    const arcPct   = total ? (descontado / total) * CIRC : 0;
    document.getElementById('donut-pagas').style.strokeDasharray = `${arcPagas} ${CIRC}`;
    document.getElementById('donut-pct').style.strokeDasharray   = `${arcPct} ${CIRC}`;
    document.getElementById('d-pagas').textContent = numPagas;
    document.getElementById('d-pct').textContent   = `${pct}%`;
  }, 80);

  const backBtn = document.getElementById('btn-voltar-quitadas');
  if (backBtn) backBtn.addEventListener('click', () => {
    activeTabId = '__quitadas__';
    renderTabs();
    renderContent();
  });

  document.getElementById('btn-delete-divida').addEventListener('click', () => excluirDivida(d.id));
}

function renderParcelasGrid(d) {
  const grid = document.getElementById('parcelas-grid');
  grid.innerHTML = '';
  const ultimoIdx = d.parcelas.length - 1;

  d.parcelas.forEach((p, i) => {
    const isGratuita = p.valor === 0;
    const isFinal    = i === ultimoIdx && d.parcelas.length > 1;
    const card = document.createElement('div');
    card.className = `parcela-card ${p.paga ? 'pago' : 'pendente'}`;
    card.style.animation = `fadeUp .5s ease ${0.35 + i * 0.05}s both`;

    const valorLabel = isGratuita ? 'R$ 0,00' : `R$ ${p.valor.toLocaleString('pt-BR')}`;
    const subLabel = isGratuita ? 'sem desconto' : (isFinal ? 'parcela final' : 'mensal');

    card.innerHTML = `
      <button class="parcela-edit-btn" title="Editar valor desta parcela">✏️</button>
      <div class="parcela-mes">${p.mes}<span style="opacity:.5"> /${String(p.ano).slice(2)}</span></div>
      <div class="parcela-valor">
        ${valorLabel}
        <small>${subLabel}</small>
      </div>
      <div class="parcela-status">${p.paga ? '✓ Pago' : '○ Pendente'}</div>
      <div class="check-icon">✓</div>
      <div class="parcela-number">#${String(i + 1).padStart(2, '0')}</div>
    `;

    const editBtn = card.querySelector('.parcela-edit-btn');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditParcelaModal(d.id, i);
    });

    card.addEventListener('click', () => toggleParcela(d.id, i, card));
    grid.appendChild(card);
  });
}

/* ── Marcar/desmarcar parcela como paga ── */
async function toggleParcela(dividaId, idx, card) {
  const d = dividas.find(x => x.id === dividaId);
  if (!d) return;

  const p = d.parcelas[idx];
  const novoValor = !p.paga;

  const { error } = await supabaseClient
    .from('parcelas')
    .update({ paga: novoValor })
    .eq('id', p.id);

  if (error) { showToast('Erro ao salvar: ' + error.message); return; }

  p.paga = novoValor;

  const ficouQuitada = isQuitada(d);

  card.classList.remove('just-toggled');
  void card.offsetWidth;
  card.classList.add('just-toggled');

  const valorMsg = p.valor === 0 ? 'mês sem desconto' : `R$ ${p.valor.toLocaleString('pt-BR')} descontados`;
  if (p.paga && ficouQuitada) {
    showToast(`🎉 "${d.titulo}" foi totalmente quitada!`);
  } else {
    showToast(p.paga ? `${p.mes} marcado como pago — ${valorMsg}!` : `↩️ ${p.mes} desmarcado`);
  }

  renderTabs();
  renderContent();
}

/* ── Excluir dívida ── */
async function excluirDivida(id) {
  const d = dividas.find(x => x.id === id);
  if (!d) return;
  const ok = confirm(`Excluir a dívida "${d.titulo}"? Essa ação não pode ser desfeita.`);
  if (!ok) return;

  const { error } = await supabaseClient.from('dividas').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir: ' + error.message); return; }

  dividas = dividas.filter(x => x.id !== id);
  activeTabId = dividas.length ? dividas[0].id : null;
  renderTabs();
  renderContent();
  showToast(`Dívida "${d.titulo}" excluída`);
}

/* ── Modal: nova dívida ── */
function openModal() {
  const overlay = document.getElementById('modal-overlay');

  document.getElementById('input-titulo').value = '';
  document.getElementById('input-valor').value = '';
  document.getElementById('input-meses').value = '';

  const selectMes = document.getElementById('input-mes-inicial');
  selectMes.innerHTML = MESES.map((m, i) => `<option value="${i}">${m}</option>`).join('');

  const hoje = new Date();
  selectMes.value = hoje.getMonth();
  document.getElementById('input-ano-inicial').value = hoje.getFullYear();

  overlay.classList.add('show');
  document.getElementById('input-titulo').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('show');
}

async function criarNovaDivida() {
  const titulo = document.getElementById('input-titulo').value.trim();
  const valor  = parseFloat(document.getElementById('input-valor').value);
  const meses  = parseInt(document.getElementById('input-meses').value, 10);
  const mesInicial = parseInt(document.getElementById('input-mes-inicial').value, 10);
  const anoInicial  = parseInt(document.getElementById('input-ano-inicial').value, 10);

  if (!titulo) { showToast('Digite um título para a dívida'); return; }
  if (isNaN(valor) || valor < 0) { showToast('Digite um valor de parcela válido'); return; }
  if (isNaN(meses) || meses < 1) { showToast('Digite a quantidade de meses'); return; }
  if (isNaN(anoInicial)) { showToast('Digite o ano inicial'); return; }

  const { data: novaDividaRow, error: errDivida } = await supabaseClient
    .from('dividas')
    .insert({ titulo, user_id: currentUser.id })
    .select()
    .single();

  if (errDivida) { showToast('Erro ao criar dívida: ' + errDivida.message); return; }

  const parcelasParaInserir = [];
  let mes = mesInicial, ano = anoInicial;
  for (let i = 0; i < meses; i++) {
    parcelasParaInserir.push({
      divida_id: novaDividaRow.id,
      mes: MESES[mes],
      ano,
      valor,
      paga: false,
      ordem: i,
    });
    mes++;
    if (mes > 11) { mes = 0; ano++; }
  }

  const { data: parcelasInseridas, error: errParcelas } = await supabaseClient
    .from('parcelas')
    .insert(parcelasParaInserir)
    .select();

  if (errParcelas) { showToast('Erro ao criar parcelas: ' + errParcelas.message); return; }

  const novaDivida = {
    id: novaDividaRow.id,
    titulo: novaDividaRow.titulo,
    parcelas: parcelasInseridas.slice().sort((a, b) => a.ordem - b.ordem),
  };

  dividas.push(novaDivida);
  activeTabId = novaDivida.id;
  closeModal();
  renderTabs();
  renderContent();
  showToast(`Dívida "${titulo}" criada com sucesso!`);
}

/* ── Modal: editar valor de uma parcela específica ── */
let parcelaEmEdicao = null; // { dividaId, idx }

function openEditParcelaModal(dividaId, idx) {
  const d = dividas.find(x => x.id === dividaId);
  if (!d) return;
  const p = d.parcelas[idx];
  parcelaEmEdicao = { dividaId, idx };

  document.getElementById('edit-parcela-info').textContent = `${p.mes} /${p.ano}`;
  document.getElementById('input-edit-valor').value = p.valor;
  document.getElementById('edit-parcela-overlay').classList.add('show');
  document.getElementById('input-edit-valor').focus();
}

function closeEditParcelaModal() {
  document.getElementById('edit-parcela-overlay').classList.remove('show');
  parcelaEmEdicao = null;
}

async function salvarEdicaoParcela() {
  if (!parcelaEmEdicao) return;
  const { dividaId, idx } = parcelaEmEdicao;
  const d = dividas.find(x => x.id === dividaId);
  if (!d) return;
  const p = d.parcelas[idx];

  const novoValor = parseFloat(document.getElementById('input-edit-valor').value);
  if (isNaN(novoValor) || novoValor < 0) { showToast('Digite um valor válido'); return; }

  const { error } = await supabaseClient
    .from('parcelas')
    .update({ valor: novoValor })
    .eq('id', p.id);

  if (error) { showToast('Erro ao salvar: ' + error.message); return; }

  p.valor = novoValor;
  closeEditParcelaModal();
  renderTabs();
  renderContent();
  showToast(`Valor de ${p.mes} atualizado para R$ ${novoValor.toLocaleString('pt-BR')}`);
}

/* ── Listeners globais ── */
document.getElementById('btn-cancelar-modal').addEventListener('click', closeModal);
document.getElementById('btn-criar-divida').addEventListener('click', criarNovaDivida);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') closeModal();
});

document.getElementById('btn-cancelar-edit-parcela').addEventListener('click', closeEditParcelaModal);
document.getElementById('btn-salvar-edit-parcela').addEventListener('click', salvarEdicaoParcela);
document.getElementById('edit-parcela-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'edit-parcela-overlay') closeEditParcelaModal();
});

document.getElementById('btn-auth-confirmar').addEventListener('click', () => {
  if (modoAuth === 'login') fazerLogin();
  else fazerCadastro();
});
document.getElementById('btn-auth-toggle').addEventListener('click', alternarModoAuth);
document.getElementById('btn-logout').addEventListener('click', fazerLogout);

['auth-email', 'auth-senha'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-auth-confirmar').click();
  });
});

/* ── Início ── */
checkSession();