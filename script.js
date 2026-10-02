/* ============================================================
   ARRUDA'S FINANCE — múltiplas dívidas, abas, quitadas e Supabase
   ============================================================ */

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const CIRC  = 2 * Math.PI * 55;

let dividas = [];
let activeTabId = null;
let currentUser = null;
let perfilAtual = null; // { telefone, profissao, salario, foto_base64 }
let metas = [];
let lancamentos = [];

/* ── Estado vazio reutilizável (ícone + título + subtítulo + CTA opcional) ── */
function emptyStateHtml({ icon = '📂', title, subtitle = '', ctaLabel = null, ctaId = null }) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <div class="empty-state-title">${title}</div>
      ${subtitle ? `<div class="empty-state-subtitle">${subtitle}</div>` : ''}
      ${ctaLabel ? `<button class="btn-primary empty-state-cta" id="${ctaId}">${ctaLabel}</button>` : ''}
    </div>
  `;
}

/* ── Helpers de cálculo ── */
function isQuitada(d) {
  return d.parcelas.length > 0 && d.parcelas.every(p => p.paga);
}

function hojeInfo() {
  const hoje = new Date();
  return { mesIdx: hoje.getMonth(), ano: hoje.getFullYear() };
}

/* uma parcela é considerada atrasada se ainda não foi paga e o mês/ano dela já passou */
function isAtrasada(p) {
  if (p.paga) return false;
  const { mesIdx, ano } = hojeInfo();
  const pMesIdx = MESES.indexOf(p.mes);
  return (p.ano < ano) || (p.ano === ano && pMesIdx < mesIdx);
}

function calcDivida(d) {
  const total       = d.parcelas.reduce((s, p) => s + p.valor, 0);
  const descontado  = d.parcelas.reduce((s, p) => s + (p.paga ? p.valor : 0), 0);
  const restante    = total - descontado;
  const pct         = total ? Math.round((descontado / total) * 100) : 0;
  const numPagas    = d.parcelas.filter(p => p.paga).length;
  const numFaltam   = d.parcelas.length - numPagas;
  const proxIdx     = d.parcelas.findIndex(p => !p.paga);
  const numAtrasadas = d.parcelas.filter(isAtrasada).length;
  const valorAtrasado = d.parcelas.filter(isAtrasada).reduce((s, p) => s + p.valor, 0);
  const ultimaParcela = d.parcelas.length ? d.parcelas[d.parcelas.length - 1] : null;
  const juros = (d.valorOriginal != null && d.valorOriginal > 0) ? (total - d.valorOriginal) : null;
  return { total, descontado, restante, pct, numPagas, numFaltam, proxIdx, numAtrasadas, valorAtrasado, ultimaParcela, juros };
}

function periodoTexto(d) {
  if (!d.parcelas.length) return '—';
  const anos = [...new Set(d.parcelas.map(p => p.ano))];
  return anos.length === 1 ? `${anos[0]}` : `${anos[0]} / ${anos[anos.length - 1]}`;
}

/* ordena parcelas cronologicamente (ano/mês); usa 'ordem' como desempate */
function chaveData(p) { return p.ano * 12 + MESES.indexOf(p.mes); }
function ordenarParcelas(arr) {
  return arr.slice().sort((a, b) => chaveData(a) - chaveData(b) || a.ordem - b.ordem);
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

let modoAuth = 'login'; // 'login' | 'cadastro' | 'recuperar' | 'nova_senha'

function showAuthScreen() {
  document.getElementById('auth-screen').classList.add('show');
  document.getElementById('app-screen').classList.remove('show');
}

function showAppScreen() {
  document.getElementById('auth-screen').classList.remove('show');
  document.getElementById('app-screen').classList.add('show');
  document.getElementById('header-user-email').textContent = currentUser?.email || '';
  showDividasView();
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
  if (event === 'PASSWORD_RECOVERY') {
    // usuário clicou no link de "esqueci minha senha" — não abre o app
    // direto; pede pra ele definir a nova senha primeiro
    modoAuth = 'nova_senha';
    showAuthScreen();
    atualizarTelaAuth();
    return;
  }
  if (event === 'SIGNED_IN' && session) {
    currentUser = session.user;
    showAppScreen();
    iniciarApp();
  } else if (event === 'SIGNED_OUT') {
    currentUser = null;
    dividas = [];
    activeTabId = null;
    perfilAtual = null;
    metas = [];
    lancamentos = [];
    notificacoesLidas = new Set();
    notificacoesAtuais = [];
    fecharPainelNotificacoes();
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

/* solicita o link de recuperação de senha via Supabase Auth — não existe
   nenhum sistema próprio de recuperação, é o fluxo nativo mesmo */
async function enviarRecuperacaoSenha() {
  const email = document.getElementById('auth-email').value.trim();
  if (!email) { showAuthMsg('Digite seu email pra receber o link de recuperação'); return; }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) { showAuthMsg(traduzErroAuth(error.message)); return; }

  showAuthMsg('Se esse email tiver uma conta, enviamos um link de recuperação. Confira sua caixa de entrada.', true);
}

/* chamado depois que o usuário chega pelo link do email (evento
   PASSWORD_RECOVERY) — define a nova senha usando a sessão temporária
   de recuperação que o próprio Supabase já validou */
async function salvarNovaSenhaRecuperacao() {
  const nova = document.getElementById('auth-nova-senha').value;
  const confirmar = document.getElementById('auth-confirmar-nova-senha').value;

  if (nova.length < 6) { showAuthMsg('A senha precisa ter no mínimo 6 caracteres'); return; }
  if (nova !== confirmar) { showAuthMsg('As senhas não coincidem'); return; }

  const { error } = await supabaseClient.auth.updateUser({ password: nova });
  if (error) { showAuthMsg(traduzErroAuth(error.message)); return; }

  showAuthMsg('Senha atualizada com sucesso! Entrando...', true);
  setTimeout(() => { showAppScreen(); iniciarApp(); }, 900);
}

function alternarModoAuth() {
  modoAuth = modoAuth === 'login' ? 'cadastro' : 'login';
  atualizarTelaAuth();
}

function atualizarTelaAuth() {
  document.getElementById('auth-msg').textContent = '';

  const emailWrap = document.getElementById('auth-campo-email-wrap');
  const senhaWrap = document.getElementById('auth-campo-senha-wrap');
  const novaSenhaWrap = document.getElementById('auth-campos-nova-senha');
  const toggleWrap = document.getElementById('auth-toggle-wrap');
  const forgotWrap = document.getElementById('auth-forgot-wrap');
  const voltarWrap = document.getElementById('auth-voltar-login-wrap');
  const titulo = document.getElementById('auth-titulo');
  const btnConfirmar = document.getElementById('btn-auth-confirmar');

  if (modoAuth === 'recuperar') {
    titulo.textContent = 'Recuperar Senha';
    emailWrap.style.display = 'block';
    senhaWrap.style.display = 'none';
    novaSenhaWrap.style.display = 'none';
    toggleWrap.style.display = 'none';
    forgotWrap.style.display = 'none';
    voltarWrap.style.display = 'flex';
    btnConfirmar.textContent = 'Enviar Link de Recuperação';
  } else if (modoAuth === 'nova_senha') {
    titulo.textContent = 'Defina sua Nova Senha';
    emailWrap.style.display = 'none';
    senhaWrap.style.display = 'none';
    novaSenhaWrap.style.display = 'block';
    toggleWrap.style.display = 'none';
    forgotWrap.style.display = 'none';
    voltarWrap.style.display = 'none';
    btnConfirmar.textContent = 'Salvar Nova Senha';
  } else {
    emailWrap.style.display = 'block';
    senhaWrap.style.display = 'block';
    novaSenhaWrap.style.display = 'none';
    toggleWrap.style.display = 'flex';
    forgotWrap.style.display = modoAuth === 'login' ? 'flex' : 'none';
    voltarWrap.style.display = 'none';
    btnConfirmar.textContent = modoAuth === 'login' ? 'Entrar' : 'Criar Conta';
    titulo.textContent = modoAuth === 'login' ? 'Entrar' : 'Criar Conta';
    document.getElementById('auth-toggle-texto').textContent = modoAuth === 'login'
      ? 'Ainda não tem conta?'
      : 'Já tem uma conta?';
    document.getElementById('btn-auth-toggle').textContent = modoAuth === 'login' ? 'Cadastre-se' : 'Entrar';
  }
}

/* botão principal da auth-screen se comporta diferente conforme o modo atual */
function handleAuthConfirmar() {
  if (modoAuth === 'login') fazerLogin();
  else if (modoAuth === 'cadastro') fazerCadastro();
  else if (modoAuth === 'recuperar') enviarRecuperacaoSenha();
  else if (modoAuth === 'nova_senha') salvarNovaSenhaRecuperacao();
}

/* ============================================================
   CARREGAMENTO DE DADOS (SUPABASE)
   ============================================================ */

async function iniciarApp() {
  await loadDividas();
  await loadPerfil();
  await loadNotificacoesLidas();
  await loadMetas();
  await loadLancamentos();
  activeTabId = dividas.length ? dividas[0].id : null;
  renderTabs();
  renderContent();
  atualizarBadgeENotificacoes();
}

async function loadDividas() {
  const { data, error } = await supabaseClient
    .from('dividas')
    .select('id, titulo, created_at, valor_original, parcelas(id, mes, ano, valor, paga, ordem, pago_em)')
    .order('created_at', { ascending: true });

  if (error) {
    showToast('Erro ao carregar dados: ' + error.message);
    dividas = [];
    return;
  }

  dividas = (data || []).map(d => ({
    id: d.id,
    titulo: d.titulo,
    valorOriginal: d.valor_original,
    parcelas: ordenarParcelas(d.parcelas || []),
  }));
}

/* ============================================================
   SISTEMA DE ALERTAS / CENTRAL DE NOTIFICAÇÕES
   ============================================================
   As notificações não são registros salvos no banco — elas são
   recalculadas a partir do estado real de `dividas` toda vez que
   algo muda (mesma fonte de verdade usada no dashboard e no
   histórico). Só o status de LEITURA é persistido, por uma chave
   determinística baseada no conteúdo da notificação: se as
   parcelas envolvidas mudarem, a chave muda e a notificação volta
   a aparecer como não lida — sem precisar reenviar alerta manual
   nem duplicar dados de dívidas/parcelas numa tabela separada.
   ============================================================ */

let notificacoesLidas = new Set();   // chaves já lidas (persistidas em notificacoes_lidas)
let notificacoesAtuais = [];         // última lista computada
let painelNotificacoesAberto = false;

const LIMIAR_VENCIMENTO_DIAS = 7; // cobre as 3 faixas: hoje, 1-3 dias, 4-7 dias

/* hash curto e estável (djb2) — usado só pra manter a chave de leitura compacta */
function hashChave(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* dias até o vencimento da parcela. A estrutura atual não guarda um dia exato —
   só mês/ano — então parcelas do mês corrente (ainda não atrasadas) são tratadas
   como "vencendo agora" (crítico), e só a partir do próximo mês dá pra calcular
   uma distância em dias real, usando o 1º dia do mês como referência (mesma
   convenção já usada no dashboard e no histórico) */
function diasParaVencimento(p) {
  const { mesIdx: mesAtual, ano: anoAtual } = hojeInfo();
  if (p.ano === anoAtual && MESES.indexOf(p.mes) === mesAtual) return 0;

  const hoje = new Date();
  const hojeSemHora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dataRef = new Date(p.ano, MESES.indexOf(p.mes), 1);
  return Math.round((dataRef - hojeSemHora) / 86400000);
}

/* monta a lista de notificações atuais a partir do estado real das dívidas */
function gerarNotificacoes() {
  const notifs = [];

  /* 1. Parcelas atrasadas — agrupadas numa única notificação */
  const atrasadas = [];
  dividas.forEach(d => d.parcelas.forEach(p => { if (isAtrasada(p)) atrasadas.push({ d, p }); }));
  if (atrasadas.length) {
    const total = atrasadas.reduce((s, x) => s + x.p.valor, 0);
    const idsUnicos = new Set(atrasadas.map(x => x.d.id));
    notifs.push({
      chave: `atrasadas:${hashChave(atrasadas.map(x => x.p.id).sort().join(','))}`,
      cor: 'red',
      icone: '🔴',
      titulo: `Você possui ${atrasadas.length} parcela${atrasadas.length !== 1 ? 's' : ''} atrasada${atrasadas.length !== 1 ? 's' : ''}`,
      subtitulo: `Total atrasado: R$ ${total.toLocaleString('pt-BR')}`,
      acao: () => (idsUnicos.size === 1 ? irParaDivida(atrasadas[0].d.id) : showGeralView()),
    });
  }

  /* 2. Próximos vencimentos — só parcelas não pagas e não atrasadas, por faixa de urgência */
  const pendentes = [];
  dividas.forEach(d => d.parcelas.forEach(p => {
    if (p.paga || isAtrasada(p)) return;
    const dias = diasParaVencimento(p);
    if (dias >= 0 && dias <= LIMIAR_VENCIMENTO_DIAS) pendentes.push({ d, p, dias });
  }));

  const faixas = [
    { id: 'hoje',    min: 0, max: 0, cor: 'red',    icone: '🔴' },
    { id: 'atencao', min: 1, max: 3, cor: 'yellow', icone: '🟡' },
    { id: 'aviso',   min: 4, max: 7, cor: 'orange', icone: '🟠' },
  ];

  faixas.forEach(faixa => {
    const grupo = pendentes.filter(x => x.dias >= faixa.min && x.dias <= faixa.max);
    if (!grupo.length) return;

    const idsUnicos = new Set(grupo.map(x => x.d.id));
    const totalGrupo = grupo.reduce((s, x) => s + x.p.valor, 0);

    let titulo;
    if (grupo.length === 1) {
      titulo = grupo[0].dias === 0 ? '1 parcela vence este mês' : `1 parcela vence em ${grupo[0].dias} dia${grupo[0].dias !== 1 ? 's' : ''}`;
    } else {
      titulo = faixa.id === 'hoje'
        ? `${grupo.length} parcelas vencem este mês`
        : `${grupo.length} parcelas vencem nos próximos ${faixa.max} dias`;
    }

    notifs.push({
      chave: `vencimento_${faixa.id}:${hashChave(grupo.map(x => x.p.id).sort().join(','))}`,
      cor: faixa.cor,
      icone: faixa.icone,
      titulo,
      subtitulo: grupo.length === 1
        ? `${grupo[0].d.titulo} · R$ ${grupo[0].p.valor.toLocaleString('pt-BR')}`
        : `Total: R$ ${totalGrupo.toLocaleString('pt-BR')}`,
      acao: () => (idsUnicos.size === 1 ? irParaDivida(grupo[0].d.id) : showGeralView()),
    });
  });

  /* 3. Dívidas quitadas — uma notificação por dívida; some do não-lidos assim que
        for marcada como lida, e só volta se a dívida "desquitar" e quitar de novo */
  dividas.filter(isQuitada).forEach(d => {
    notifs.push({
      chave: `quitada:${d.id}`,
      cor: 'green',
      icone: '🟢',
      titulo: `Você quitou "${d.titulo}"`,
      subtitulo: 'Parabéns! Essa dívida foi totalmente paga 🎉',
      acao: () => irParaDivida(d.id),
    });
  });

  return notifs;
}

async function loadNotificacoesLidas() {
  if (!currentUser) { notificacoesLidas = new Set(); return; }
  const { data, error } = await supabaseClient
    .from('notificacoes_lidas')
    .select('chave');

  if (error) {
    // tabela pode ainda não existir num ambiente sem a migração — não trava o app
    notificacoesLidas = new Set();
    return;
  }
  notificacoesLidas = new Set((data || []).map(r => r.chave));
}

async function marcarComoLida(chave) {
  if (notificacoesLidas.has(chave)) return;
  notificacoesLidas.add(chave);
  atualizarBadgeENotificacoes();

  const { error } = await supabaseClient
    .from('notificacoes_lidas')
    .upsert({ user_id: currentUser.id, chave }, { onConflict: 'user_id,chave' });
  if (error) console.error('Erro ao marcar notificação como lida:', error.message);
}

async function marcarTodasComoLidas() {
  const naoLidas = notificacoesAtuais.filter(n => !notificacoesLidas.has(n.chave));
  if (!naoLidas.length) return;

  naoLidas.forEach(n => notificacoesLidas.add(n.chave));
  atualizarBadgeENotificacoes();

  const rows = naoLidas.map(n => ({ user_id: currentUser.id, chave: n.chave }));
  const { error } = await supabaseClient.from('notificacoes_lidas').upsert(rows, { onConflict: 'user_id,chave' });
  if (error) console.error('Erro ao marcar todas as notificações como lidas:', error.message);
}

/* recalcula as notificações, atualiza o badge do sino e, se o painel estiver
   aberto, re-renderiza a lista — chamado sempre que dividas/parcelas mudam */
function atualizarBadgeENotificacoes() {
  notificacoesAtuais = gerarNotificacoes();
  const naoLidas = notificacoesAtuais.filter(n => !notificacoesLidas.has(n.chave));

  const badge = document.getElementById('notif-badge');
  if (badge) {
    if (naoLidas.length > 0) {
      badge.textContent = naoLidas.length > 9 ? '9+' : String(naoLidas.length);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  if (painelNotificacoesAberto) renderPainelNotificacoes();
}

function renderPainelNotificacoes() {
  const lista = document.getElementById('notif-panel-list');
  if (!lista) return;

  if (!notificacoesAtuais.length) {
    lista.innerHTML = `<div class="notif-empty">Nenhuma notificação no momento 🎉</div>`;
    return;
  }

  lista.innerHTML = notificacoesAtuais.map(n => {
    const lida = notificacoesLidas.has(n.chave);
    return `
      <div class="notif-item ${n.cor} ${lida ? 'lida' : ''}" data-chave="${n.chave}">
        <div class="notif-item-icone">${n.icone}</div>
        <div class="notif-item-texto">
          <div class="notif-item-titulo">${n.titulo}</div>
          <div class="notif-item-sub">${n.subtitulo}</div>
        </div>
        ${!lida ? `<button class="notif-item-marcar" data-chave="${n.chave}" title="Marcar como lida">✓</button>` : ''}
      </div>`;
  }).join('');

  lista.querySelectorAll('.notif-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.notif-item-marcar')) return;
      const n = notificacoesAtuais.find(x => x.chave === el.dataset.chave);
      if (!n) return;
      marcarComoLida(n.chave);
      fecharPainelNotificacoes();
      n.acao();
    });
  });

  lista.querySelectorAll('.notif-item-marcar').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      marcarComoLida(btn.dataset.chave);
    });
  });
}

function abrirPainelNotificacoes() {
  painelNotificacoesAberto = true;
  document.getElementById('notif-panel').classList.add('show');
  renderPainelNotificacoes();
}

function fecharPainelNotificacoes() {
  painelNotificacoesAberto = false;
  const painel = document.getElementById('notif-panel');
  if (painel) painel.classList.remove('show');
}

function toggleNotificacoes() {
  if (painelNotificacoesAberto) fecharPainelNotificacoes();
  else abrirPainelNotificacoes();
}

/* ============================================================
   PERFIL DO USUÁRIO
   ============================================================ */

const PROFISSOES = [
  'Administrador(a)','Advogado(a)','Agente Comunitário de Saúde','Agricultor(a)','Agrônomo(a)',
  'Ajudante Geral','Almoxarife','Analista Contábil','Analista de Compras','Analista de Marketing',
  'Analista de RH','Analista de Sistemas','Analista de Suporte','Analista Financeiro','Analista Fiscal',
  'Arquiteto(a)','Assistente Administrativo(a)','Assistente Social','Atendente','Auditor(a)',
  'Auxiliar de Cozinha','Auxiliar de Escritório','Auxiliar de Farmácia','Auxiliar de Limpeza',
  'Auxiliar de Logística','Auxiliar de Produção','Auxiliar Veterinário(a)','Babá','Bancário(a)',
  'Barbeiro(a)','Bibliotecário(a)','Biólogo(a)','Biomédico(a)','Bombeiro Civil','Bombeiro Militar',
  'Cabeleireiro(a)','Caixa','Carpinteiro(a)','Carteiro(a)','Chef de Cozinha','Confeiteiro(a)',
  'Consultor(a)','Contador(a)','Coordenador(a) Pedagógico(a)','Copeiro(a)','Corretor(a) de Imóveis',
  'Corretor(a) de Seguros','Costureiro(a)','Cozinheiro(a)','Cozinheiro(a) Industrial','Delegado(a)',
  'Dentista','Designer de Interiores','Designer Gráfico','Desenvolvedor(a) de Software','Diagramador(a)',
  'Diarista','Digitador(a)','Diretor(a) Comercial','Diretor(a) de Escola','Eletricista','Eletrotécnico(a)',
  'Empregado(a) Doméstico(a)','Empresário(a)','Enfermeiro(a)','Encanador(a)','Engenheiro(a) Agrônomo(a)',
  'Engenheiro(a) Civil','Engenheiro(a) de Alimentos','Engenheiro(a) de Produção','Engenheiro(a) Elétrico(a)',
  'Engenheiro(a) Mecânico(a)','Engenheiro(a) Químico(a)','Escriturário(a)','Esteticista','Estoquista',
  'Farmacêutico(a)','Faxineiro(a)','Fisioterapeuta','Fonoaudiólogo(a)','Fotógrafo(a)','Frentista',
  'Garçom / Garçonete','Gerente Administrativo(a)','Gerente Comercial','Gerente de Loja',
  'Gerente de Projetos','Gerente de RH','Gerente Financeiro(a)','Gesseiro(a)','Gestor(a) Público(a)',
  'Guia Turístico(a)','Historiador(a)','Ilustrador(a)','Inspetor(a) de Qualidade',
  'Instrutor(a) de Autoescola','Instrutor(a) de Yoga','Jardineiro(a)','Jornalista','Juiz(a)',
  'Locutor(a)','Maquiador(a)','Marceneiro(a)','Massoterapeuta','Mecânico(a) de Automóveis',
  'Médico(a) Clínico(a) Geral','Médico(a) Especialista','Merendeira','Metalúrgico(a)','Militar',
  'Modelo','Motoboy','Motorista de Aplicativo','Motorista de Caminhão','Motorista de Ônibus',
  'Motorista Particular','Músico(a)','Nutricionista','Nutricionista Esportivo(a)','Office Boy / Office Girl',
  'Operador(a) de Caixa','Operador(a) de Empilhadeira','Operador(a) de Guindaste','Operador(a) de Máquinas',
  'Operador(a) de Telemarketing','Padeiro(a)','Paisagista','Pedagogo(a)','Pedreiro(a)','Personal Trainer',
  'Pescador(a)','Piloto de Avião','Pintor(a)','Piscineiro(a)','Policial Civil','Policial Militar',
  'Porteiro(a)','Professor(a) de Ensino Fundamental','Professor(a) de Ensino Médio',
  'Professor(a) Universitário(a)','Programador(a)','Promotor(a) de Justiça','Promotor(a) de Vendas',
  'Psicólogo(a)','Publicitário(a)','Química(o)','Recepcionista','Recreacionista',
  'Repositor(a) de Mercadorias','Representante Comercial','Repórter','Sacoleiro(a)','Salva-vidas',
  'Segurança','Segurança Eletrônica','Serralheiro(a)','Servente de Obras','Servidor(a) Público(a)',
  'Soldador(a)','Supervisor(a) de Produção','Supervisor(a) de Vendas','Sushiman','Tatuador(a)',
  'Taxista','Técnico(a) Agrícola','Técnico(a) de Enfermagem','Técnico(a) de Informática / TI',
  'Técnico(a) de Manutenção','Técnico(a) de Segurança do Trabalho','Técnico(a) em Contabilidade',
  'Técnico(a) em Edificações','Técnico(a) em Eletrônica','Técnico(a) em Radiologia',
  'Tecnólogo(a) em Logística','Telefonista','Terapeuta Ocupacional','Torneiro(a) Mecânico(a)',
  'Trader','Tradutor(a) / Intérprete','Vendedor(a)','Vendedor(a) Autônomo(a)','Veterinário(a)',
  'Vigilante','Web Designer','Zelador(a)','Zootecnista', 'Estudante', 'Aposentado(a)', 'Desempregado(a)',
  'Autônomo(a) / Freelancer',
];

async function loadPerfil() {
  const { data, error } = await supabaseClient
    .from('perfis')
    .select('*')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (error) {
    showToast('Erro ao carregar perfil: ' + error.message);
    perfilAtual = null;
    return;
  }

  perfilAtual = data || null;
}

function preencherSelectProfissoes(valorAtual) {
  const select = document.getElementById('select-perfil-profissao');
  const listaOrdenada = [...PROFISSOES].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const isOutra = valorAtual && !listaOrdenada.includes(valorAtual);

  let html = `<option value="">Selecione...</option>`;
  html += listaOrdenada.map(p => `<option value="${p}">${p}</option>`).join('');
  html += `<option value="__outra__">Outra (digitar)</option>`;
  select.innerHTML = html;

  const inputOutra = document.getElementById('input-perfil-profissao-outra');
  if (isOutra) {
    select.value = '__outra__';
    inputOutra.value = valorAtual;
    inputOutra.style.display = 'block';
  } else {
    select.value = valorAtual || '';
    inputOutra.value = '';
    inputOutra.style.display = 'none';
  }
}

/* imagem escolhida (base64 redimensionado), pendente de salvar */
let fotoPerfilPendente = undefined; // undefined = não alterada; string = nova; null = removida

function redimensionarImagem(file, maxLado = 320, qualidade = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxLado) {
          height = Math.round(height * (maxLado / width));
          width = maxLado;
        } else if (height > maxLado) {
          width = Math.round(width * (maxLado / height));
          height = maxLado;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', qualidade));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function atualizarAvatarPreview(src) {
  const img = document.getElementById('perfil-avatar-preview');
  const placeholder = document.getElementById('perfil-avatar-placeholder');
  if (src) {
    img.src = src;
    img.classList.add('show');
    placeholder.classList.add('hide');
  } else {
    img.classList.remove('show');
    placeholder.classList.remove('hide');
  }
}

function renderPerfilForm() {
  document.getElementById('perfil-email-label').textContent = perfilAtual?.nome
    ? `${perfilAtual.nome} · ${currentUser?.email || ''}`
    : (currentUser?.email || '');
  document.getElementById('input-perfil-nome').value = perfilAtual?.nome || '';
  document.getElementById('input-perfil-telefone').value = perfilAtual?.telefone || '';
  document.getElementById('input-perfil-salario').value = perfilAtual?.salario ?? '';
  preencherSelectProfissoes(perfilAtual?.profissao || '');

  fotoPerfilPendente = undefined;
  atualizarAvatarPreview(perfilAtual?.foto_base64 || null);

  renderContaInfo();
}

function calcResumoFinanceiro(salario) {
  const hoje = new Date();
  const mesAtual = MESES[hoje.getMonth()];
  const anoAtual = hoje.getFullYear();

  let parcelasMes = 0;
  let restanteTotal = 0;

  dividas.forEach(d => {
    restanteTotal += calcDivida(d).restante;
    d.parcelas.forEach(p => {
      if (!p.paga && p.mes === mesAtual && p.ano === anoAtual) parcelasMes += p.valor;
    });
  });

  const temSalario = salario && salario > 0;
  return {
    parcelasMes,
    restanteTotal,
    pctComprometido: temSalario ? (parcelasMes / salario) * 100 : null,
    qtdSalariosRestante: temSalario ? restanteTotal / salario : null,
  };
}

function renderResumoFinanceiro() {
  const section = document.getElementById('perfil-resumo-section');
  const stats = document.getElementById('perfil-resumo-stats');
  const salario = perfilAtual?.salario;

  if (!dividas.length && !salario) { section.style.display = 'none'; return; }

  const { parcelasMes, restanteTotal, pctComprometido, qtdSalariosRestante } = calcResumoFinanceiro(salario);

  let pctCard, salariosCard, saudeCard = '';
  if (salario && salario > 0) {
    const pctCor = pctComprometido > 50 ? 'pink' : (pctComprometido > 30 ? 'gold' : 'green');
    pctCard = `
      <div class="stat-card ${pctCor}">
        <div class="stat-label">% do Salário Comprometido (mês atual)</div>
        <div class="stat-value">${pctComprometido.toFixed(1)}%</div>
        <div class="stat-sub">R$ ${parcelasMes.toLocaleString('pt-BR')} em parcelas este mês</div>
      </div>`;
    salariosCard = `
      <div class="stat-card blue">
        <div class="stat-label">Dívida Restante em Salários</div>
        <div class="stat-value">${qtdSalariosRestante.toFixed(1)}x</div>
        <div class="stat-sub">equivalente ao seu salário</div>
      </div>`;

    const sobra = calcSobraMes(salario, parcelasMes);
    let selo, seloTexto, seloClasse;
    if (pctComprometido <= 30) { selo = '🟢'; seloTexto = 'Saudável'; seloClasse = 'green'; }
    else if (pctComprometido <= 50) { selo = '🟡'; seloTexto = 'Atenção'; seloClasse = 'gold'; }
    else { selo = '🔴'; seloTexto = 'Crítico'; seloClasse = 'pink'; }

    saudeCard = `
      <div class="stat-card ${seloClasse}">
        <div class="stat-label">Saúde Financeira</div>
        <div class="stat-value">${selo} ${seloTexto}</div>
        <div class="stat-sub">sobra estimada de R$ ${sobra.toLocaleString('pt-BR')} este mês</div>
      </div>`;
  } else {
    pctCard = `
      <div class="stat-card gold">
        <div class="stat-label">Parcelas deste Mês</div>
        <div class="stat-value">R$ ${parcelasMes.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">cadastre seu salário para ver o %</div>
      </div>`;
    salariosCard = '';
  }

  stats.innerHTML = `
    ${pctCard}
    <div class="stat-card blue">
      <div class="stat-label">Saldo Restante Total</div>
      <div class="stat-value">R$ ${restanteTotal.toLocaleString('pt-BR')}</div>
      <div class="stat-sub">somando todas as dívidas ativas</div>
    </div>
    ${salariosCard}
    ${saudeCard}
  `;
  section.style.display = 'block';
}

async function salvarPerfil() {
  const nome = document.getElementById('input-perfil-nome').value.trim();
  const telefone  = document.getElementById('input-perfil-telefone').value.trim();
  const salarioVal = document.getElementById('input-perfil-salario').value;
  const salario   = salarioVal === '' ? null : parseFloat(salarioVal);

  const selectVal = document.getElementById('select-perfil-profissao').value;
  const profissao = selectVal === '__outra__'
    ? document.getElementById('input-perfil-profissao-outra').value.trim()
    : selectVal;

  if (salario !== null && (isNaN(salario) || salario < 0)) {
    showToast('Digite um salário válido');
    return;
  }

  const payload = {
    user_id: currentUser.id,
    nome: nome || null,
    telefone: telefone || null,
    profissao: profissao || null,
    salario,
  };

  if (fotoPerfilPendente !== undefined) {
    payload.foto_base64 = fotoPerfilPendente; // string nova ou null (removida)
  }

  const { data, error } = await supabaseClient
    .from('perfis')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) { showToast('Erro ao salvar perfil: ' + error.message); return; }

  perfilAtual = data;
  fotoPerfilPendente = undefined;
  renderResumoFinanceiro();
  showToast('Perfil salvo com sucesso!');
}

/* ============================================================
   CONTA E SEGURANÇA
   ============================================================ */

/* "Sobre a Conta" — só usa dados que o próprio Supabase Auth já
   devolve na sessão do usuário (created_at, last_sign_in_at). Não
   existe API de cliente pra listar sessões ativas em outros
   dispositivos — isso exigiria a Admin API (service_role), que não
   pode rodar no navegador — então é sinalizado com transparência. */
function renderContaInfo() {
  const lista = document.getElementById('conta-info-lista');
  if (!lista || !currentUser) return;

  const criadaEm = currentUser.created_at ? new Date(currentUser.created_at).toLocaleDateString('pt-BR') : '—';
  const ultimoAcesso = currentUser.last_sign_in_at ? new Date(currentUser.last_sign_in_at).toLocaleString('pt-BR') : '—';
  const emailConfirmado = currentUser.email_confirmed_at ? 'Sim' : 'Não';

  const linhas = [
    ['Email', currentUser.email || '—'],
    ['Conta criada em', criadaEm],
    ['Último acesso', ultimoAcesso],
    ['Email confirmado', emailConfirmado],
  ];

  lista.innerHTML = linhas.map(([label, valor]) => `
    <div class="detalhe-row">
      <div class="detalhe-label">${label}</div>
      <div class="detalhe-value">${valor}</div>
    </div>`).join('') + `
    <p class="modal-hint" style="margin-top:12px;">Por segurança, o navegador não tem acesso a uma lista de sessões ativas em outros dispositivos — use "Sair de todos os dispositivos" se desconfiar de algum acesso indevido.</p>`;
}

/* troca de senha exigindo a senha atual — o SDK do Supabase não tem um
   endpoint de "verificar senha", então a forma correta e suportada é
   tentar um signInWithPassword com a senha atual antes de trocar */
async function alterarSenha() {
  const senhaAtual = document.getElementById('input-senha-atual').value;
  const novaSenha = document.getElementById('input-senha-nova').value;
  const confirmar = document.getElementById('input-senha-nova-confirmar').value;

  if (!senhaAtual) { showToast('Digite sua senha atual'); return; }
  if (novaSenha.length < 6) { showToast('A nova senha precisa ter no mínimo 6 caracteres'); return; }
  if (novaSenha !== confirmar) { showToast('A confirmação não bate com a nova senha'); return; }
  if (novaSenha === senhaAtual) { showToast('A nova senha precisa ser diferente da atual'); return; }

  const { error: erroVerificacao } = await supabaseClient.auth.signInWithPassword({
    email: currentUser.email,
    password: senhaAtual,
  });
  if (erroVerificacao) { showToast('Senha atual incorreta'); return; }

  const { error } = await supabaseClient.auth.updateUser({ password: novaSenha });
  if (error) { showToast('Erro ao atualizar senha: ' + error.message); return; }

  document.getElementById('input-senha-atual').value = '';
  document.getElementById('input-senha-nova').value = '';
  document.getElementById('input-senha-nova-confirmar').value = '';
  showToast('Senha atualizada com sucesso!');
}

async function sairDeTodosDispositivos() {
  const ok = confirm('Isso vai encerrar sua sessão em todos os dispositivos conectados, inclusive este. Continuar?');
  if (!ok) return;
  await supabaseClient.auth.signOut({ scope: 'global' });
}

/* exporta tudo que já está carregado localmente — nenhuma consulta nova
   precisa ser feita, os dados já vêm do próprio Supabase com RLS aplicada */
function exportarDados() {
  const pacote = {
    exportado_em: new Date().toISOString(),
    conta: { email: currentUser?.email, criada_em: currentUser?.created_at },
    perfil: perfilAtual,
    dividas,
    metas,
    lancamentos,
  };

  const blob = new Blob([JSON.stringify(pacote, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `arrudas-finance-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Seus dados foram exportados.');
}

/* ── Exclusão de conta ── */
function abrirExclusaoConta() {
  document.getElementById('input-confirmar-exclusao').value = '';
  document.getElementById('input-senha-exclusao').value = '';
  document.getElementById('exclusao-conta-overlay').classList.add('show');
}

function fecharExclusaoConta() {
  document.getElementById('exclusao-conta-overlay').classList.remove('show');
}

/* Apaga todos os dados do usuário nas tabelas que o próprio cliente tem
   permissão de RLS pra deletar. Isso NÃO remove a conta de login em si —
   deletar de auth.users exige a service_role key, que nunca pode viver
   no navegador. Por isso, se existir a Edge Function "delete-account"
   publicada, ela é chamada também; se não existir, os dados já saem
   completamente apagados e avisamos que a conta de login segue existindo
   até um administrador rodar a função (ou apagar manualmente). */
async function confirmarExclusaoConta() {
  const confirmacao = document.getElementById('input-confirmar-exclusao').value.trim();
  const senha = document.getElementById('input-senha-exclusao').value;

  if (confirmacao !== 'EXCLUIR') { showToast('Digite EXCLUIR pra confirmar'); return; }
  if (!senha) { showToast('Digite sua senha pra confirmar'); return; }

  const { error: erroSenha } = await supabaseClient.auth.signInWithPassword({
    email: currentUser.email,
    password: senha,
  });
  if (erroSenha) { showToast('Senha incorreta'); return; }

  showToast('Excluindo seus dados...');

  for (const d of dividas) {
    await supabaseClient.from('parcelas').delete().eq('divida_id', d.id);
  }
  await supabaseClient.from('dividas').delete().eq('user_id', currentUser.id);
  await supabaseClient.from('metas').delete().eq('user_id', currentUser.id);
  await supabaseClient.from('lancamentos').delete().eq('user_id', currentUser.id);
  await supabaseClient.from('notificacoes_lidas').delete().eq('user_id', currentUser.id);
  await supabaseClient.from('perfis').delete().eq('user_id', currentUser.id);

  let contaRemovida = false;
  try {
    const { error: erroFuncao } = await supabaseClient.functions.invoke('delete-account');
    contaRemovida = !erroFuncao;
  } catch (e) {
    contaRemovida = false;
  }

  fecharExclusaoConta();

  if (contaRemovida) {
    showToast('Sua conta e seus dados foram excluídos.');
  } else {
    showToast('Seus dados foram apagados. Fale com o administrador do sistema pra remover o login definitivamente.');
  }

  await supabaseClient.auth.signOut();
}

/* dispara (ou reinicia) a animação de entrada de uma view */
function fadeInView(el) {
  el.classList.remove('view-fade-in');
  void el.offsetWidth; // força reflow pra reiniciar a animação
  el.classList.add('view-fade-in');
}

const TODAS_AS_VIEWS = ['view-dividas', 'view-perfil', 'view-geral', 'view-historico', 'view-metas', 'view-lancamentos'];

function mostrarView(idAlvo) {
  TODAS_AS_VIEWS.forEach(id => {
    document.getElementById(id).style.display = (id === idAlvo) ? 'block' : 'none';
  });
}

function showDividasView() {
  mostrarView('view-dividas');
  fadeInView(document.getElementById('view-dividas'));
}

function showPerfilView() {
  mostrarView('view-perfil');
  renderPerfilForm();
  renderResumoFinanceiro();
  fadeInView(document.getElementById('view-perfil'));
}

function showGeralView() {
  mostrarView('view-geral');
  renderVisaoGeral();
  fadeInView(document.getElementById('view-geral'));
}

function showHistoricoView() {
  mostrarView('view-historico');
  renderHistorico();
  fadeInView(document.getElementById('view-historico'));
}

function showMetasView() {
  mostrarView('view-metas');
  renderMetas();
  fadeInView(document.getElementById('view-metas'));
}

function showLancamentosView() {
  mostrarView('view-lancamentos');
  renderLancamentos();
  fadeInView(document.getElementById('view-lancamentos'));
}

/* soma, para cada uma das próximas `qtdMeses` (a partir do mês atual),
   o total de parcelas não pagas de TODAS as dívidas que caem naquele mês */
function calcProximosMeses(qtdMeses = 6) {
  const { mesIdx, ano } = hojeInfo();
  const chaveInicio = ano * 12 + mesIdx;
  const porMes = new Map();

  for (let i = 0; i < qtdMeses; i++) {
    const chave = chaveInicio + i;
    porMes.set(chave, { mes: MESES[chave % 12], ano: Math.floor(chave / 12), total: 0 });
  }

  dividas.forEach(d => {
    d.parcelas.forEach(p => {
      if (p.paga) return;
      const chave = p.ano * 12 + MESES.indexOf(p.mes);
      if (porMes.has(chave)) porMes.get(chave).total += p.valor;
    });
  });

  return [...porMes.values()];
}

/* encontra a parcela não paga mais distante no tempo, entre todas as dívidas —
   isso indica quando (em teoria) tudo estará quitado */
function calcPrevisaoQuitacaoTotal() {
  let maxChave = null;
  dividas.forEach(d => {
    d.parcelas.forEach(p => {
      if (!p.paga) {
        const chave = chaveData(p);
        if (maxChave === null || chave > maxChave) maxChave = chave;
      }
    });
  });
  if (maxChave === null) return null;

  const { mesIdx, ano } = hojeInfo();
  const chaveAtual = ano * 12 + mesIdx;
  return {
    mesesRestantes: maxChave - chaveAtual,
    mesFinal: MESES[maxChave % 12],
    anoFinal: Math.floor(maxChave / 12),
  };
}

/* ============================================================
   DASHBOARD FINANCEIRO — cálculos agregados (Visão Geral)
   ============================================================ */

/* filtro de período ativo na seção "Próximos Pagamentos" */
let filtroPeriodoGeral = 'tudo';

/* resumo consolidado de TODAS as dívidas — base dos cards principais */
function calcResumoGeralDashboard() {
  const ativas = dividas.filter(d => !isQuitada(d));
  const quitadas = dividas.filter(isQuitada);

  let totalGeral = 0, totalPagoGeral = 0, atrasadasGeral = 0, valorAtrasadoGeral = 0;
  dividas.forEach(d => {
    const c = calcDivida(d);
    totalGeral += c.total;
    totalPagoGeral += c.descontado;
    atrasadasGeral += c.numAtrasadas;
    valorAtrasadoGeral += c.valorAtrasado;
  });

  const restanteGeral = totalGeral - totalPagoGeral;
  const pctQuitadoGeral = totalGeral ? Math.round((totalPagoGeral / totalGeral) * 100) : 0;

  return {
    totalGeral, totalPagoGeral, restanteGeral, pctQuitadoGeral,
    qtdAtivas: ativas.length, qtdQuitadas: quitadas.length,
    atrasadasGeral, valorAtrasadoGeral,
  };
}

/* janela de meses (chave = ano*12+mesIdx) coberta por cada opção do filtro de período.
   Atrasadas sempre aparecem, independente da janela — ver calcProximosPagamentos. */
function janelaFiltroPeriodo(filtro, chaveAtual, anoAtual) {
  switch (filtro) {
    case 'este_mes':    return { min: chaveAtual, max: chaveAtual };
    case 'proximo_mes': return { min: chaveAtual + 1, max: chaveAtual + 1 };
    case 'ultimos_3':   return { min: chaveAtual, max: chaveAtual + 2 };
    case 'ultimos_6':   return { min: chaveAtual, max: chaveAtual + 5 };
    case 'este_ano':    return { min: anoAtual * 12, max: anoAtual * 12 + 11 };
    default:            return null; // 'tudo' — sem restrição
  }
}

/* lista achatada de todas as parcelas não pagas, com a dívida-mãe anexada */
function listarParcelasPendentes() {
  const lista = [];
  dividas.forEach(d => {
    d.parcelas.forEach(p => { if (!p.paga) lista.push({ divida: d, parcela: p }); });
  });
  return lista;
}

/* próximas parcelas a vencer (atrasadas sempre primeiro), respeitando o filtro de período */
function calcProximosPagamentos(filtro = 'tudo', limite = 8) {
  const { mesIdx, ano } = hojeInfo();
  const chaveAtual = ano * 12 + mesIdx;
  const janela = janelaFiltroPeriodo(filtro, chaveAtual, ano);
  const hojeSemHora = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const todas = listarParcelasPendentes()
    .map(({ divida, parcela }) => {
      const chave = chaveData(parcela);
      const atrasada = isAtrasada(parcela);
      const dataRef = new Date(parcela.ano, MESES.indexOf(parcela.mes), 1);
      const diasDiff = Math.round((dataRef - hojeSemHora) / 86400000);
      return { divida, parcela, chave, atrasada, diasDiff };
    })
    .filter(item => item.atrasada || !janela || (item.chave >= janela.min && item.chave <= janela.max));

  todas.sort((a, b) => (a.atrasada !== b.atrasada) ? (a.atrasada ? -1 : 1) : (a.chave - b.chave));

  return { itens: todas.slice(0, limite), total: todas.length };
}

/* ranking das dívidas que mais merecem atenção (atraso > % restante > proximidade) */
function calcDividasCriticas(limite = 5) {
  const ativas = dividas.filter(d => !isQuitada(d));
  const comMetricas = ativas.map(d => {
    const c = calcDivida(d);
    const pctRestante = c.total ? 100 - c.pct : 100;
    const score = c.numAtrasadas * 100000 + c.valorAtrasado * 10 + pctRestante;
    let prioridade, cor;
    if (c.numAtrasadas > 0) { prioridade = 'Alta';  cor = 'pink'; }
    else if (c.pct < 50)    { prioridade = 'Média'; cor = 'gold'; }
    else                     { prioridade = 'Baixa'; cor = 'blue'; }
    const prox = c.proxIdx >= 0 ? d.parcelas[c.proxIdx] : null;
    return { divida: d, ...c, pctRestante, score, prioridade, cor, prox };
  });
  comMetricas.sort((a, b) => b.score - a.score);
  return comMetricas.slice(0, limite);
}

/* quanto cada dívida ativa representa do total restante geral */
function calcDistribuicaoDividas() {
  const itens = dividas.filter(d => !isQuitada(d)).map(d => ({
    titulo: d.titulo,
    restante: calcDivida(d).restante,
  })).filter(x => x.restante > 0);

  const totalRestante = itens.reduce((s, x) => s + x.restante, 0);
  itens.sort((a, b) => b.restante - a.restante);

  return itens.map(x => ({ ...x, pct: totalRestante ? Math.round((x.restante / totalRestante) * 100) : 0 }));
}

const CORES_DISTRIBUICAO = ['#c8f060', '#60f0c8', '#f060a8', '#f0a060', '#60a8f0', '#a860f0', '#f0e060', '#e08060'];

/* navega para a aba de uma dívida específica (usado pelos cliques na dashboard) */
function irParaDivida(dividaId) {
  showDividasView();
  activeTabId = dividaId;
  renderTabs();
  renderContent();
}

function renderVisaoGeral() {
  const container = document.getElementById('geral-content');

  if (!dividas.length && !lancamentos.length) {
    container.innerHTML = emptyStateHtml({
      icon: '📊',
      title: 'Nenhuma dívida ou lançamento cadastrado ainda',
      subtitle: 'Cadastre uma dívida na aba "Dívidas" ou uma receita/despesa em "Lançamentos" pra começar a ver seu painel completo aqui.',
    });
    return;
  }

  let totalGeral = 0, atrasadasGeral = 0, valorAtrasadoGeral = 0, totalPagoAnoAtual = 0;
  const { mesIdx, ano } = hojeInfo();

  dividas.forEach(d => {
    totalGeral += calcDivida(d).total;
    d.parcelas.forEach(p => {
      if (isAtrasada(p)) { atrasadasGeral++; valorAtrasadoGeral += p.valor; }
      if (p.paga && p.pago_em && new Date(p.pago_em).getFullYear() === ano) totalPagoAnoAtual += p.valor;
    });
  });

  const salario = perfilAtual?.salario;
  const temSalario = salario && salario > 0;
  const { parcelasMes, restanteTotal, pctComprometido, qtdSalariosRestante } = calcResumoFinanceiro(salario);
  const previsaoQuitacao = calcPrevisaoQuitacaoTotal();

  const meses = calcProximosMeses(6);
  const maiorMes = Math.max(1, temSalario ? salario : 0, ...meses.map(m => m.total));

  /* ── novos cálculos do dashboard ── */
  const resumo = calcResumoGeralDashboard();
  const proximosPagamentos = calcProximosPagamentos(filtroPeriodoGeral, 8);
  const dividasCriticas = calcDividasCriticas(5);
  const distribuicao = calcDistribuicaoDividas();
  const quitadasLista = dividas.filter(isQuitada);

  /* ── receitas / despesas / dívidas pagas / saldo do mês atual (item 4) ── */
  const fluxoMesAtual = calcFluxoCaixaMes(ano, mesIdx);

  /* ── Cabeçalho: banner de saúde financeira, ou CTA para cadastrar salário ── */
  let saudeHtml;
  if (temSalario) {
    const sobra = calcSobraMes(salario, parcelasMes);
    let selo, seloTexto, seloClasse;
    if (pctComprometido <= 30) { selo = '🟢'; seloTexto = 'Saudável'; seloClasse = 'green'; }
    else if (pctComprometido <= 50) { selo = '🟡'; seloTexto = 'Atenção'; seloClasse = 'gold'; }
    else { selo = '🔴'; seloTexto = 'Crítico'; seloClasse = 'pink'; }

    saudeHtml = `
      <div class="saude-hero saude-${seloClasse}">
        <div class="saude-hero-left">
          <div class="saude-hero-label">Saúde Financeira</div>
          <div class="saude-hero-value">${selo} ${seloTexto}</div>
          <div class="saude-hero-sub">${pctComprometido.toFixed(1)}% da sua renda mensal está comprometida com dívidas</div>
        </div>
        <div class="saude-hero-right">
          <div class="saude-hero-stat">
            <span class="saude-hero-stat-val" style="color:${sobra >= 0 ? 'var(--accent)' : 'var(--accent3)'}">R$ ${sobra.toLocaleString('pt-BR')}</span>
            <span class="saude-hero-stat-lbl">sobra estimada este mês</span>
          </div>
        </div>
      </div>`;
  } else {
    saudeHtml = `
      <div class="saude-cta">
        <div class="saude-cta-text">💡 Cadastre seu <strong>salário</strong> no Perfil pra ver o quanto da sua renda está comprometida com dívidas e receber um indicador de saúde financeira.</div>
        <button class="btn-secondary" id="btn-geral-ir-perfil">Ir para o Perfil</button>
      </div>`;
  }

  /* ── indicadores textuais dinâmicos ── */
  const proximoGeral = proximosPagamentos.itens[0] || null;
  const indicadoresTextuais = [
    { icone: '📊', html: `Você já quitou <strong>${resumo.pctQuitadoGeral}%</strong> das suas dívidas.` },
    { icone: '💰', html: resumo.restanteGeral > 0 ? `Faltam <strong>R$ ${resumo.restanteGeral.toLocaleString('pt-BR')}</strong> para quitar tudo.` : `Todas as dívidas cadastradas já estão quitadas 🎉` },
    { icone: resumo.atrasadasGeral > 0 ? '⚠️' : '✅', html: resumo.atrasadasGeral > 0 ? `Existem <strong>${resumo.atrasadasGeral}</strong> parcela${resumo.atrasadasGeral !== 1 ? 's' : ''} atrasada${resumo.atrasadasGeral !== 1 ? 's' : ''}.` : `Nenhuma parcela atrasada no momento.` },
    { icone: '📅', html: proximoGeral ? `Seu próximo pagamento é de <strong>R$ ${proximoGeral.parcela.valor.toLocaleString('pt-BR')}</strong> (${proximoGeral.divida.titulo} · ${proximoGeral.parcela.mes}/${proximoGeral.parcela.ano}).` : `Não há pagamentos pendentes no momento.` },
  ];

  /* ── seção: próximos pagamentos ── */
  const opcoesFiltro = [
    ['tudo', 'Tudo'], ['este_mes', 'Este mês'], ['proximo_mes', 'Próximo mês'],
    ['ultimos_3', 'Próximos 3 meses'], ['ultimos_6', 'Próximos 6 meses'], ['este_ano', `Este ano (${ano})`],
  ];
  const proximosPagamentosHtml = !proximosPagamentos.itens.length
    ? `<div class="geral-empty-mini">Nenhuma parcela pendente ${filtroPeriodoGeral !== 'tudo' ? 'nesse período' : ''} 🎉</div>`
    : `
      <div class="pagamentos-list">
        ${proximosPagamentos.itens.map(({ divida, parcela, atrasada, diasDiff }) => {
          const cor = atrasada ? 'pink' : (diasDiff <= 7 ? 'gold' : 'blue');
          const diasLabel = atrasada
            ? `Atrasada`
            : (diasDiff <= 0 ? 'Vence este mês' : `em ${diasDiff} dia${diasDiff !== 1 ? 's' : ''}`);
          return `
          <div class="pagamento-item ${cor}" data-id="${divida.id}">
            <div class="pagamento-dot"></div>
            <div class="pagamento-info">
              <div class="pagamento-titulo">${divida.titulo}</div>
              <div class="pagamento-sub">${parcela.mes}/${parcela.ano}${atrasada ? ' · pagamento em atraso' : ''}</div>
            </div>
            <div class="pagamento-dias">${diasLabel}</div>
            <div class="pagamento-valor">R$ ${parcela.valor.toLocaleString('pt-BR')}</div>
          </div>`;
        }).join('')}
      </div>
      ${proximosPagamentos.total > proximosPagamentos.itens.length ? `<div class="geral-mais-nota">+ ${proximosPagamentos.total - proximosPagamentos.itens.length} outra${(proximosPagamentos.total - proximosPagamentos.itens.length) !== 1 ? 's' : ''} parcela${(proximosPagamentos.total - proximosPagamentos.itens.length) !== 1 ? 's' : ''} no período selecionado</div>` : ''}
    `;

  /* ── seção: dívidas mais críticas ── */
  const criticasHtml = !dividasCriticas.length
    ? `<div class="geral-empty-mini">Nenhuma dívida ativa no momento 🎉</div>`
    : `
      <div class="criticas-grid">
        ${dividasCriticas.map(c => `
          <div class="critica-card ${c.cor}" data-id="${c.divida.id}">
            <div class="critica-top">
              <div class="critica-titulo">${c.divida.titulo}</div>
              <div class="critica-prioridade">${c.prioridade}</div>
            </div>
            <div class="critica-stats">
              ${c.numAtrasadas > 0 ? `<span>⚠️ <b>${c.numAtrasadas}</b> parcela${c.numAtrasadas !== 1 ? 's' : ''} atrasada${c.numAtrasadas !== 1 ? 's' : ''} · <b>R$ ${c.valorAtrasado.toLocaleString('pt-BR')}</b></span>` : `<span>✓ nenhuma parcela atrasada</span>`}
              <span>📉 <b>${c.pctRestante}%</b> ainda restante</span>
              <span>📅 próxima parcela: <b>${c.prox ? `${c.prox.mes}/${c.prox.ano}` : '—'}</b></span>
            </div>
          </div>`).join('')}
      </div>
    `;

  /* ── seção: distribuição das dívidas ── */
  const distribuicaoHtml = !distribuicao.length
    ? `<div class="geral-empty-mini">Nenhum saldo restante para distribuir 🎉</div>`
    : `
      <div class="breakdown-grid">
        ${distribuicao.map((x, i) => {
          const cor = CORES_DISTRIBUICAO[i % CORES_DISTRIBUICAO.length];
          return `
          <div class="breakdown-item">
            <div class="breakdown-item-top">
              <div class="breakdown-dot" style="background:${cor}"></div>
              <div class="breakdown-name">${x.titulo}</div>
              <div class="breakdown-val">${x.pct}%</div>
            </div>
            <div class="breakdown-bar-track">
              <div class="breakdown-bar-fill" style="width:${x.pct}%; background:${cor}"></div>
            </div>
            <div class="breakdown-val" style="font-size:.7rem; color:#888899; font-weight:400;">R$ ${x.restante.toLocaleString('pt-BR')} restantes</div>
          </div>`;
        }).join('')}
      </div>
    `;

  container.innerHTML = `
    ${saudeHtml}

    <div class="geral-section-header">
      <div class="section-title" style="margin-bottom:0;">Fluxo de Caixa do Mês (${MESES[mesIdx]}/${ano})</div>
      <button class="btn-secondary" id="btn-geral-ir-lancamentos">💵 Ver Lançamentos</button>
    </div>
    <div class="stats-grid" style="margin-bottom:32px;">
      <div class="stat-card green">
        <div class="stat-label">Receitas do Mês</div>
        <div class="stat-value">R$ ${fluxoMesAtual.receitas.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">lançamentos de receita ativos este mês</div>
      </div>
      <div class="stat-card pink">
        <div class="stat-label">Despesas do Mês</div>
        <div class="stat-value">R$ ${fluxoMesAtual.despesas.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">lançamentos de despesa ativos este mês</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Dívidas Pagas no Mês</div>
        <div class="stat-value">R$ ${fluxoMesAtual.dividasPagas.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">parcelas efetivamente pagas este mês</div>
      </div>
      <div class="stat-card ${fluxoMesAtual.saldo >= 0 ? 'green' : 'pink'}">
        <div class="stat-label">Saldo do Mês</div>
        <div class="stat-value">R$ ${fluxoMesAtual.saldo.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">receitas − despesas − dívidas pagas</div>
      </div>
    </div>

    <div class="progress-section">
      <div class="section-title">Progresso Geral de Quitação</div>
      <div class="progress-header">
        <span class="progress-label">R$ ${resumo.totalPagoGeral.toLocaleString('pt-BR')} pagos de R$ ${resumo.totalGeral.toLocaleString('pt-BR')}</span>
        <span class="progress-pct">${resumo.pctQuitadoGeral}%</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${resumo.pctQuitadoGeral}%"></div>
      </div>
      <div class="progress-info">
        <span>R$ ${resumo.totalPagoGeral.toLocaleString('pt-BR')} pagos</span>
        <span>R$ ${resumo.restanteGeral.toLocaleString('pt-BR')} restantes</span>
      </div>
    </div>

    <div class="section-title">Resumo Financeiro</div>
    <div class="stats-grid">
      <div class="stat-card blue">
        <div class="stat-label">Total das Dívidas</div>
        <div class="stat-value">R$ ${resumo.totalGeral.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">${dividas.length} dívida${dividas.length !== 1 ? 's' : ''} cadastrada${dividas.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Total Já Pago</div>
        <div class="stat-value">R$ ${resumo.totalPagoGeral.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">em todo o período</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Total Restante</div>
        <div class="stat-value">R$ ${resumo.restanteGeral.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">somando todas as dívidas ativas</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">% Já Quitado</div>
        <div class="stat-value">${resumo.pctQuitadoGeral}%</div>
        <div class="stat-sub">do total geral de dívidas</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Dívidas Ativas</div>
        <div class="stat-value">${resumo.qtdAtivas}</div>
        <div class="stat-sub">ainda com parcelas em aberto</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Dívidas Quitadas</div>
        <div class="stat-value">${resumo.qtdQuitadas}</div>
        <div class="stat-sub">totalmente pagas</div>
      </div>
      <div class="stat-card ${resumo.atrasadasGeral > 0 ? 'pink' : 'blue'}">
        <div class="stat-label">Parcelas Atrasadas</div>
        <div class="stat-value">${resumo.atrasadasGeral}</div>
        <div class="stat-sub">${resumo.atrasadasGeral > 0 ? 'precisam de atenção' : 'nenhuma parcela atrasada 🎉'}</div>
      </div>
      <div class="stat-card ${resumo.valorAtrasadoGeral > 0 ? 'pink' : 'blue'}">
        <div class="stat-label">Valor Total Atrasado</div>
        <div class="stat-value">R$ ${resumo.valorAtrasadoGeral.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">soma das parcelas em atraso</div>
      </div>
    </div>

    <div class="section-title">Indicadores</div>
    <div class="stats-grid">
      <div class="stat-card ${temSalario ? (pctComprometido > 50 ? 'pink' : pctComprometido > 30 ? 'gold' : 'green') : 'gold'}">
        <div class="stat-label">Parcelas deste Mês</div>
        <div class="stat-value">R$ ${parcelasMes.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">${temSalario ? `${pctComprometido.toFixed(1)}% da sua renda` : `${MESES[mesIdx]}/${ano} · cadastre o salário p/ ver %`}</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Total Pago em ${ano}</div>
        <div class="stat-value">R$ ${totalPagoAnoAtual.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">parcelas marcadas como pagas este ano</div>
      </div>
      ${temSalario ? `
      <div class="stat-card blue">
        <div class="stat-label">Dívida Restante em Salários</div>
        <div class="stat-value">${qtdSalariosRestante.toFixed(1)}x</div>
        <div class="stat-sub">equivalente ao seu salário mensal</div>
      </div>` : ''}
      ${previsaoQuitacao ? `
      <div class="stat-card blue">
        <div class="stat-label">Previsão de Quitação Total</div>
        <div class="stat-value">${previsaoQuitacao.mesesRestantes <= 0 ? 'Este mês' : `${previsaoQuitacao.mesesRestantes} ${previsaoQuitacao.mesesRestantes === 1 ? 'mês' : 'meses'}`}</div>
        <div class="stat-sub">última parcela prevista: ${previsaoQuitacao.mesFinal}/${previsaoQuitacao.anoFinal}</div>
      </div>` : ''}
    </div>

    <div class="indicadores-grid" style="margin-bottom:32px;">
      ${indicadoresTextuais.map(i => `
        <div class="indicador-card">
          <div class="indicador-icone">${i.icone}</div>
          <div class="indicador-texto">${i.html}</div>
        </div>`).join('')}
    </div>

    <div class="progress-section">
      <div class="geral-section-header">
        <div class="section-title" style="margin-bottom:0;">Próximos Pagamentos</div>
        <select class="filtro-select" id="select-filtro-periodo">
          ${opcoesFiltro.map(([val, label]) => `<option value="${val}" ${val === filtroPeriodoGeral ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      ${proximosPagamentosHtml}
    </div>

    <div class="progress-section">
      <div class="section-title">Dívidas Mais Críticas</div>
      ${criticasHtml}
    </div>

    ${quitadasLista.length ? `
    <div class="quitadas-resumo" id="quitadas-resumo-card">
      <div class="quitadas-resumo-left">
        <div class="quitadas-resumo-icone">🏆</div>
        <div>
          <div class="quitadas-resumo-titulo">${quitadasLista.length} dívida${quitadasLista.length !== 1 ? 's' : ''} quitada${quitadasLista.length !== 1 ? 's' : ''}</div>
          <div class="quitadas-resumo-sub">Clique para ver os detalhes</div>
        </div>
      </div>
      <div class="quitadas-resumo-seta">→</div>
    </div>` : ''}

    <div class="progress-section" style="margin-top:32px;">
      <div class="section-title">Distribuição das Dívidas (saldo restante)</div>
      ${distribuicaoHtml}
    </div>

    <div class="progress-section">
      <div class="section-title">Previsão dos Próximos 6 Meses</div>
      <div class="timeline-hint">Soma das parcelas não pagas de todas as dívidas, mês a mês${temSalario ? ' · linha tracejada = seu salário · barra rosa = mês que ultrapassa o salário' : ''}</div>
      <div class="mes-bar-list">
        ${meses.map(m => {
          const estoura = temSalario && m.total > salario;
          const salarioPct = temSalario ? Math.min(100, (salario / maiorMes) * 100) : null;
          return `
          <div class="mes-bar-row ${estoura ? 'risco' : ''}">
            <div class="mes-bar-label">${m.mes.slice(0, 3)}/${String(m.ano).slice(2)}</div>
            <div class="mes-bar-track">
              ${temSalario ? `<div class="mes-bar-salario-marker" style="left:${salarioPct}%" title="Seu salário: R$ ${salario.toLocaleString('pt-BR')}"></div>` : ''}
              <div class="mes-bar-fill ${estoura ? 'risco' : ''}" style="width:${m.total ? Math.max(4, (m.total / maiorMes) * 100) : 0}%"></div>
            </div>
            <div class="mes-bar-valor">R$ ${m.total.toLocaleString('pt-BR')}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;

  const btnIrPerfil = document.getElementById('btn-geral-ir-perfil');
  if (btnIrPerfil) btnIrPerfil.addEventListener('click', showPerfilView);

  const btnIrLancamentos = document.getElementById('btn-geral-ir-lancamentos');
  if (btnIrLancamentos) btnIrLancamentos.addEventListener('click', showLancamentosView);

  const selectFiltro = document.getElementById('select-filtro-periodo');
  if (selectFiltro) {
    selectFiltro.addEventListener('change', (e) => {
      filtroPeriodoGeral = e.target.value;
      renderVisaoGeral();
    });
  }

  container.querySelectorAll('.pagamento-item').forEach(el => {
    el.addEventListener('click', () => irParaDivida(el.dataset.id));
  });
  container.querySelectorAll('.critica-card').forEach(el => {
    el.addEventListener('click', () => irParaDivida(el.dataset.id));
  });
  const quitadasCard = document.getElementById('quitadas-resumo-card');
  if (quitadasCard) quitadasCard.addEventListener('click', () => irParaDivida('__quitadas__'));
}

/* ============================================================
   METAS FINANCEIRAS
   ============================================================
   Meta "livre": valor_objetivo e valor_atual ficam salvos na
   própria linha da tabela `metas` e são editados manualmente.

   Meta "vinculada a uma dívida" (divida_id preenchido): objetivo
   e valor atual NÃO são salvos — são calculados ao vivo a partir
   de `calcDivida()`, igual ao resto do app já faz. Isso evita a
   meta "dessincronizar" da dívida real quando uma parcela é paga.
   ============================================================ */

const CATEGORIAS_META = ['Dívida', 'Reserva de Emergência', 'Viagem', 'Casa', 'Educação', 'Saúde', 'Compra', 'Investimento'];

let metaEmEdicao = null; // id da meta sendo editada, ou null pra criação
let tipoMetaModal = 'livre'; // 'livre' | 'divida'

async function loadMetas() {
  const { data, error } = await supabaseClient
    .from('metas')
    .select('id, nome, descricao, categoria, prazo, divida_id, valor_objetivo, valor_atual, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    // tabela pode ainda não existir num ambiente sem a migração — não trava o app
    metas = [];
    return;
  }
  metas = data || [];
}

/* progresso ao vivo de uma meta — funciona igual pra metas livres e vinculadas */
function calcMetaProgresso(meta) {
  let objetivo, atual, dividaNaoEncontrada = false;

  if (meta.divida_id) {
    const d = dividas.find(x => x.id === meta.divida_id);
    if (d) {
      const c = calcDivida(d);
      objetivo = c.total;
      atual = c.descontado;
    } else {
      objetivo = 0; atual = 0; dividaNaoEncontrada = true;
    }
  } else {
    objetivo = meta.valor_objetivo || 0;
    atual = meta.valor_atual || 0;
  }

  const restante = Math.max(0, objetivo - atual);
  const pct = objetivo > 0 ? Math.min(100, Math.round((atual / objetivo) * 100)) : (atual > 0 ? 100 : 0);
  return { objetivo, atual, restante, pct, dividaNaoEncontrada };
}

/* status textual — segue a prioridade: concluída > prazo vencido > prazo próximo > perto de concluir > em andamento */
function calcMetaStatus(meta, progresso) {
  if (progresso.pct >= 100) return { id: 'concluida', label: 'Concluída', cor: 'green', icone: '✅' };

  if (meta.prazo) {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const prazoDate = new Date(meta.prazo + 'T00:00:00');
    const dias = Math.round((prazoDate - hoje) / 86400000);
    if (dias < 0) return { id: 'vencida', label: 'Prazo vencido', cor: 'pink', icone: '⏰' };
    if (dias <= 7) return { id: 'prazo_proximo', label: 'Prazo próximo', cor: 'gold', icone: '⚠️' };
  }

  if (progresso.pct >= 80) return { id: 'proxima', label: 'Próxima de concluir', cor: 'blue', icone: '🔥' };
  return { id: 'andamento', label: 'Em andamento', cor: 'blue', icone: '🚀' };
}

function calcResumoMetas() {
  const linhas = metas.map(m => ({ meta: m, progresso: calcMetaProgresso(m) }));
  const concluidas = linhas.filter(x => x.progresso.pct >= 100);
  const ativas = linhas.filter(x => x.progresso.pct < 100);
  const acumulado = linhas.reduce((s, x) => s + x.progresso.atual, 0);
  const restante = linhas.reduce((s, x) => s + x.progresso.restante, 0);
  return { qtdAtivas: ativas.length, qtdConcluidas: concluidas.length, acumulado, restante };
}

function renderMetas() {
  const container = document.getElementById('metas-content');

  if (!metas.length) {
    container.innerHTML = emptyStateHtml({
      icon: '🎯',
      title: 'Nenhuma meta cadastrada ainda',
      subtitle: 'Crie objetivos como "Reserva de emergência" ou vincule uma meta direto a uma dívida pra acompanhar o progresso automaticamente.',
      ctaLabel: '+ Nova Meta',
      ctaId: 'btn-empty-nova-meta',
    });
    const ctaBtn = document.getElementById('btn-empty-nova-meta');
    if (ctaBtn) ctaBtn.addEventListener('click', () => openMetaModal());
    return;
  }

  const resumo = calcResumoMetas();

  const resumoHtml = `
    <div class="stats-grid" style="margin-bottom:32px;">
      <div class="stat-card blue">
        <div class="stat-label">Metas Ativas</div>
        <div class="stat-value">${resumo.qtdAtivas}</div>
        <div class="stat-sub">ainda em andamento</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Metas Concluídas</div>
        <div class="stat-value">${resumo.qtdConcluidas}</div>
        <div class="stat-sub">objetivo alcançado</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Total Acumulado</div>
        <div class="stat-value">R$ ${resumo.acumulado.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">somando todas as metas</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Total Restante</div>
        <div class="stat-value">R$ ${resumo.restante.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">pra bater todos os objetivos</div>
      </div>
    </div>
  `;

  const cardsHtml = `
    <div class="metas-grid">
      ${metas.map(m => {
        const progresso = calcMetaProgresso(m);
        const status = calcMetaStatus(m, progresso);
        const prazoLabel = m.prazo ? new Date(m.prazo + 'T00:00:00').toLocaleDateString('pt-BR') : null;

        return `
        <div class="meta-card${status.id === 'concluida' ? ' concluida' : ''}" data-id="${m.id}">
          <div class="meta-card-top">
            <div class="meta-card-titulo">🎯 ${m.nome}</div>
            <div class="meta-status ${status.cor}">${status.icone} ${status.label}</div>
          </div>
          ${m.descricao ? `<div class="meta-card-desc">${m.descricao}</div>` : ''}
          ${progresso.dividaNaoEncontrada ? `<div class="meta-card-aviso">⚠️ A dívida vinculada a essa meta não existe mais. Edite pra desvincular ou ajustar.</div>` : ''}

          <div class="progress-header" style="margin-top:14px;">
            <span class="progress-label">R$ <span data-count>${progresso.atual.toLocaleString('pt-BR')}</span> de R$ ${progresso.objetivo.toLocaleString('pt-BR')}</span>
            <span class="progress-pct">${progresso.pct}%</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" style="width:${progresso.pct}%"></div>
          </div>

          <div class="meta-card-meta-info">
            <span>Restante: <b>R$ ${progresso.restante.toLocaleString('pt-BR')}</b></span>
            ${m.categoria ? `<span>${m.categoria}</span>` : ''}
            ${prazoLabel ? `<span>Prazo: ${prazoLabel}</span>` : ''}
            ${m.divida_id ? `<span>🔗 vinculada a uma dívida</span>` : ''}
          </div>

          <div class="meta-card-actions">
            <button class="meta-btn-editar" data-id="${m.id}">✏️ Editar</button>
            <button class="meta-btn-excluir" data-id="${m.id}">🗑️ Excluir</button>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;

  container.innerHTML = resumoHtml + cardsHtml;

  container.querySelectorAll('.meta-btn-editar').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openMetaModal(btn.dataset.id); });
  });
  container.querySelectorAll('.meta-btn-excluir').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); excluirMeta(btn.dataset.id); });
  });
  container.querySelectorAll('.meta-card').forEach(card => {
    card.addEventListener('click', () => {
      const m = metas.find(x => x.id === card.dataset.id);
      if (m && m.divida_id) irParaDivida(m.divida_id);
    });
  });
}

/* ── Modal: criar/editar meta ── */
function preencherSelectCategoriaMeta(valorAtual) {
  const select = document.getElementById('select-meta-categoria');
  const isOutra = valorAtual && !CATEGORIAS_META.includes(valorAtual);
  select.innerHTML = `
    <option value="">Sem categoria</option>
    ${CATEGORIAS_META.map(c => `<option value="${c}" ${c === valorAtual ? 'selected' : ''}>${c}</option>`).join('')}
    <option value="outra" ${isOutra ? 'selected' : ''}>Outra</option>
  `;
  const inputOutra = document.getElementById('input-meta-categoria-outra');
  if (isOutra) {
    inputOutra.style.display = 'block';
    inputOutra.value = valorAtual;
  } else {
    inputOutra.style.display = 'none';
    inputOutra.value = '';
  }
}

function preencherSelectDividaMeta(dividaIdAtual) {
  const select = document.getElementById('select-meta-divida');
  if (!dividas.length) {
    select.innerHTML = `<option value="">Nenhuma dívida cadastrada</option>`;
    return;
  }
  select.innerHTML = dividas.map(d => `<option value="${d.id}" ${d.id === dividaIdAtual ? 'selected' : ''}>${d.titulo}</option>`).join('');
  atualizarPreviewMetaDivida();
}

function atualizarPreviewMetaDivida() {
  const select = document.getElementById('select-meta-divida');
  const preview = document.getElementById('meta-divida-preview');
  const d = dividas.find(x => x.id === select.value);
  if (!d) { preview.textContent = ''; return; }
  const c = calcDivida(d);
  preview.textContent = `Objetivo e valor atual serão calculados automaticamente: R$ ${c.descontado.toLocaleString('pt-BR')} pagos de R$ ${c.total.toLocaleString('pt-BR')} (${c.pct}%).`;
}

function setTipoMetaModal(tipo) {
  tipoMetaModal = tipo;
  document.getElementById('btn-meta-tipo-livre').classList.toggle('active', tipo === 'livre');
  document.getElementById('btn-meta-tipo-divida').classList.toggle('active', tipo === 'divida');
  document.getElementById('bloco-meta-livre').style.display = tipo === 'livre' ? 'block' : 'none';
  document.getElementById('bloco-meta-divida').style.display = tipo === 'divida' ? 'block' : 'none';
}

function openMetaModal(id = null) {
  metaEmEdicao = id;
  const meta = id ? metas.find(x => x.id === id) : null;

  document.getElementById('meta-modal-title').textContent = meta ? 'Editar Meta' : 'Nova Meta';
  document.getElementById('input-meta-nome').value = meta?.nome || '';
  document.getElementById('input-meta-descricao').value = meta?.descricao || '';
  document.getElementById('input-meta-objetivo').value = meta?.valor_objetivo ?? '';
  document.getElementById('input-meta-atual').value = meta?.valor_atual ?? '';
  document.getElementById('input-meta-prazo').value = meta?.prazo || '';

  preencherSelectCategoriaMeta(meta?.categoria || '');
  preencherSelectDividaMeta(meta?.divida_id || (dividas[0]?.id ?? ''));
  setTipoMetaModal(meta?.divida_id ? 'divida' : 'livre');

  document.getElementById('meta-overlay').classList.add('show');
}

function closeMetaModal() {
  document.getElementById('meta-overlay').classList.remove('show');
  metaEmEdicao = null;
}

async function salvarMeta() {
  const nome = document.getElementById('input-meta-nome').value.trim();
  if (!nome) { showToast('Digite um nome para a meta'); return; }

  const descricao = document.getElementById('input-meta-descricao').value.trim() || null;
  const prazo = document.getElementById('input-meta-prazo').value || null;

  const selectCategoria = document.getElementById('select-meta-categoria').value;
  const categoria = selectCategoria === 'outra'
    ? (document.getElementById('input-meta-categoria-outra').value.trim() || null)
    : (selectCategoria || null);

  let payload = { nome, descricao, categoria, prazo, user_id: currentUser.id };

  if (tipoMetaModal === 'divida') {
    const dividaId = document.getElementById('select-meta-divida').value;
    if (!dividaId) { showToast('Selecione uma dívida para vincular'); return; }
    payload.divida_id = dividaId;
    payload.valor_objetivo = null;
    payload.valor_atual = null;
  } else {
    const objetivo = parseFloat(document.getElementById('input-meta-objetivo').value);
    const atual = parseFloat(document.getElementById('input-meta-atual').value) || 0;
    if (isNaN(objetivo) || objetivo <= 0) { showToast('Digite um valor objetivo válido'); return; }
    payload.divida_id = null;
    payload.valor_objetivo = objetivo;
    payload.valor_atual = atual;
  }

  if (metaEmEdicao) {
    const { data, error } = await supabaseClient
      .from('metas')
      .update(payload)
      .eq('id', metaEmEdicao)
      .select()
      .single();
    if (error) { showToast('Erro ao salvar meta: ' + error.message); return; }
    const idx = metas.findIndex(x => x.id === metaEmEdicao);
    if (idx !== -1) metas[idx] = data;
    showToast('Meta atualizada.');
  } else {
    const { data, error } = await supabaseClient
      .from('metas')
      .insert(payload)
      .select()
      .single();
    if (error) { showToast('Erro ao criar meta: ' + error.message); return; }
    metas.push(data);
    showToast('Meta criada.');
  }

  closeMetaModal();
  renderMetas();
}

async function excluirMeta(id) {
  const m = metas.find(x => x.id === id);
  if (!m) return;
  const ok = confirm(`Excluir a meta "${m.nome}"? Essa ação não pode ser desfeita.`);
  if (!ok) return;

  const { error } = await supabaseClient.from('metas').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir meta: ' + error.message); return; }

  metas = metas.filter(x => x.id !== id);
  renderMetas();
  showToast(`Meta "${m.nome}" excluída`);
}

/* ============================================================
   RECEITAS E DESPESAS (LANÇAMENTOS)
   ============================================================
   Uma única tabela `lancamentos` guarda tanto receitas quanto
   despesas (diferenciadas pela coluna `tipo`) — os campos são
   idênticos nos dois casos, então duas tabelas separadas só
   duplicariam schema, RLS e queries sem necessidade real.

   Pagamentos de parcelas de dívidas NUNCA entram nessa tabela —
   eles já são a fonte de verdade em `dividas`/`parcelas`, e o
   cálculo de saldo busca esse valor separadamente (por `pago_em`)
   pra nunca contar o mesmo pagamento duas vezes.

   RECORRÊNCIA: um lançamento recorrente não gera linhas novas no
   banco a cada mês — ele guarda só a data em que começou, e o
   cálculo de "esse lançamento vale pra este mês?" é feito ao vivo
   (mesma ideia já usada nas metas vinculadas a dívida). Editar ou
   excluir a linha original afeta todos os meses futuros de uma vez.
   ============================================================ */

const CATEGORIAS_RECEITA = ['Salário', 'Freelancer', 'Comissão', 'Benefício', 'Outros'];
const CATEGORIAS_DESPESA = ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Compras', 'Contas', 'Outros'];

let tipoLancamentoModal = 'receita'; // 'receita' | 'despesa'
let lancamentoEmEdicao = null;

let filtroLancTipo = 'todos';
let filtroLancCategoria = 'todas';
let filtroLancMes = 'todos';
let filtroLancAno = 'todos';

async function loadLancamentos() {
  const { data, error } = await supabaseClient
    .from('lancamentos')
    .select('id, tipo, descricao, valor, data, categoria, recorrente, observacao, created_at')
    .order('data', { ascending: false });

  if (error) {
    // tabela pode ainda não existir num ambiente sem a migração — não trava o app
    lancamentos = [];
    return;
  }
  lancamentos = data || [];
}

/* chave ano*12+mês a partir de uma data 'YYYY-MM-DD' */
function chaveDataISO(dataStr) {
  const d = new Date(dataStr + 'T00:00:00');
  return d.getFullYear() * 12 + d.getMonth();
}

/* um lançamento "vale" pra um mês/ano específico? Recorrente = a partir da
   data cadastrada, indefinidamente; não recorrente = só no mês exato dele */
function lancamentoAplicaNoMes(l, ano, mesIdx) {
  const chaveAlvo = ano * 12 + mesIdx;
  const chaveLanc = chaveDataISO(l.data);
  return l.recorrente ? chaveLanc <= chaveAlvo : chaveLanc === chaveAlvo;
}

function listarLancamentosDoMes(ano, mesIdx) {
  return lancamentos.filter(l => lancamentoAplicaNoMes(l, ano, mesIdx));
}

/* soma das parcelas efetivamente PAGAS (por pago_em) num mês — é isso, e só
   isso, que representa dinheiro que realmente saiu do bolso com dívidas.
   Não usa o mês/ano nominal da parcela, pra não confundir "venceu esse mês"
   com "foi pago esse mês" (essa distinção já existe no Histórico). */
function calcDividasPagasNoMes(ano, mesIdx) {
  let total = 0;
  dividas.forEach(d => d.parcelas.forEach(p => {
    if (p.paga && p.pago_em) {
      const dp = new Date(p.pago_em);
      if (dp.getFullYear() === ano && dp.getMonth() === mesIdx) total += p.valor;
    }
  }));
  return total;
}

/* Receitas / Despesas / Dívidas pagas / Saldo de um mês específico.
   Saldo = receitas - despesas - pagamentos de dívidas (nunca soma o
   mesmo pagamento em mais de um termo, já que dívidas não viram lançamento) */
function calcFluxoCaixaMes(ano, mesIdx) {
  const doMes = listarLancamentosDoMes(ano, mesIdx);
  const receitas = doMes.filter(l => l.tipo === 'receita').reduce((s, l) => s + l.valor, 0);
  const despesas = doMes.filter(l => l.tipo === 'despesa').reduce((s, l) => s + l.valor, 0);
  const dividasPagas = calcDividasPagasNoMes(ano, mesIdx);
  const saldo = receitas - despesas - dividasPagas;
  return { receitas, despesas, dividasPagas, saldo };
}

/* últimos `qtdMeses` (incluindo o atual), do mais antigo pro mais recente */
function calcEvolucaoSaldo(qtdMeses = 6) {
  const { mesIdx, ano } = hojeInfo();
  const chaveAtual = ano * 12 + mesIdx;
  const resultado = [];
  for (let i = qtdMeses - 1; i >= 0; i--) {
    const chave = chaveAtual - i;
    const anoM = Math.floor(chave / 12);
    const mesM = ((chave % 12) + 12) % 12;
    resultado.push({ ano: anoM, mesIdx: mesM, ...calcFluxoCaixaMes(anoM, mesM) });
  }
  return resultado;
}

/* despesas agrupadas por categoria, a partir de uma lista já filtrada de lançamentos */
function calcDespesasPorCategoria(lista) {
  const mapa = new Map();
  lista.filter(l => l.tipo === 'despesa').forEach(l => {
    mapa.set(l.categoria, (mapa.get(l.categoria) || 0) + l.valor);
  });
  const total = [...mapa.values()].reduce((s, v) => s + v, 0);
  return [...mapa.entries()]
    .map(([categoria, valor]) => ({ categoria, valor, pct: total ? Math.round((valor / total) * 100) : 0 }))
    .sort((a, b) => b.valor - a.valor);
}

function anosDisponiveisLancamentos() {
  const anos = new Set(lancamentos.map(l => new Date(l.data + 'T00:00:00').getFullYear()));
  return [...anos].sort((a, b) => b - a);
}

/* filtros da tela de Lançamentos operam sobre a data real de cada linha —
   não sobre a projeção de recorrência (que é só pro dashboard/gráficos) */
function aplicarFiltrosLancamentos(lista) {
  return lista.filter(l => {
    if (filtroLancTipo !== 'todos' && l.tipo !== filtroLancTipo) return false;
    if (filtroLancCategoria !== 'todas' && l.categoria !== filtroLancCategoria) return false;
    const d = new Date(l.data + 'T00:00:00');
    if (filtroLancMes !== 'todos' && d.getMonth() !== parseInt(filtroLancMes, 10)) return false;
    if (filtroLancAno !== 'todos' && d.getFullYear() !== parseInt(filtroLancAno, 10)) return false;
    return true;
  });
}

function renderLancamentos() {
  const container = document.getElementById('lancamentos-content');

  if (!lancamentos.length) {
    container.innerHTML = emptyStateHtml({
      icon: '💵',
      title: 'Nenhum lançamento cadastrado ainda',
      subtitle: 'Registre suas receitas e despesas do dia a dia pra ter uma visão financeira completa, além das dívidas.',
      ctaLabel: '+ Novo Lançamento',
      ctaId: 'btn-empty-novo-lancamento',
    });
    const cta = document.getElementById('btn-empty-novo-lancamento');
    if (cta) cta.addEventListener('click', () => openLancamentoModal());
    return;
  }

  const anosDisponiveis = anosDisponiveisLancamentos();
  const filtrados = aplicarFiltrosLancamentos(lancamentos)
    .slice()
    .sort((a, b) => new Date(b.data) - new Date(a.data));

  const categoriasTodas = [...new Set([...CATEGORIAS_RECEITA, ...CATEGORIAS_DESPESA])].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const totalReceitas = filtrados.filter(l => l.tipo === 'receita').reduce((s, l) => s + l.valor, 0);
  const totalDespesas = filtrados.filter(l => l.tipo === 'despesa').reduce((s, l) => s + l.valor, 0);
  const saldoFiltrado = totalReceitas - totalDespesas;

  const evolucao = calcEvolucaoSaldo(6);
  const maiorAbsEvolucao = Math.max(1, ...evolucao.map(m => Math.abs(m.saldo)));
  const despesasPorCategoria = calcDespesasPorCategoria(filtrados);

  const filtrosHtml = `
    <div class="historico-filtros">
      <select class="filtro-select" id="lanc-filtro-tipo">
        <option value="todos" ${filtroLancTipo === 'todos' ? 'selected' : ''}>Todos os tipos</option>
        <option value="receita" ${filtroLancTipo === 'receita' ? 'selected' : ''}>💰 Receitas</option>
        <option value="despesa" ${filtroLancTipo === 'despesa' ? 'selected' : ''}>💸 Despesas</option>
      </select>
      <select class="filtro-select" id="lanc-filtro-categoria">
        <option value="todas">Todas as categorias</option>
        ${categoriasTodas.map(c => `<option value="${c}" ${filtroLancCategoria === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <select class="filtro-select" id="lanc-filtro-mes">
        <option value="todos">Todos os meses</option>
        ${MESES.map((m, i) => `<option value="${i}" ${filtroLancMes === String(i) ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <select class="filtro-select" id="lanc-filtro-ano">
        <option value="todos">Todos os anos</option>
        ${anosDisponiveis.map(a => `<option value="${a}" ${filtroLancAno === String(a) ? 'selected' : ''}>${a}</option>`).join('')}
      </select>
    </div>
  `;

  const resumoHtml = `
    <div class="stats-grid" style="margin-bottom:32px;">
      <div class="stat-card green">
        <div class="stat-label">Receitas no Filtro</div>
        <div class="stat-value">R$ ${totalReceitas.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">${filtrados.filter(l => l.tipo === 'receita').length} lançamento(s)</div>
      </div>
      <div class="stat-card pink">
        <div class="stat-label">Despesas no Filtro</div>
        <div class="stat-value">R$ ${totalDespesas.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">${filtrados.filter(l => l.tipo === 'despesa').length} lançamento(s)</div>
      </div>
      <div class="stat-card ${saldoFiltrado >= 0 ? 'green' : 'pink'}">
        <div class="stat-label">Saldo no Filtro</div>
        <div class="stat-value">R$ ${saldoFiltrado.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">receitas − despesas do período filtrado</div>
      </div>
    </div>
  `;

  const evolucaoHtml = `
    <div class="mes-bar-list">
      ${evolucao.map(m => {
        const positivo = m.saldo >= 0;
        const largura = Math.max(4, (Math.abs(m.saldo) / maiorAbsEvolucao) * 100);
        return `
        <div class="mes-bar-row">
          <div class="mes-bar-label">${MESES[m.mesIdx].slice(0, 3)}/${String(m.ano).slice(2)}</div>
          <div class="mes-bar-track">
            <div class="mes-bar-fill ${positivo ? '' : 'risco'}" style="width:${largura}%"></div>
          </div>
          <div class="mes-bar-valor" style="color:${positivo ? 'var(--accent)' : 'var(--accent3)'}">R$ ${m.saldo.toLocaleString('pt-BR')}</div>
        </div>`;
      }).join('')}
    </div>
  `;

  const categoriaHtml = !despesasPorCategoria.length
    ? `<div class="geral-empty-mini">Nenhuma despesa no filtro atual pra distribuir por categoria.</div>`
    : `
      <div class="breakdown-grid">
        ${despesasPorCategoria.map((c, i) => {
          const cor = CORES_DISTRIBUICAO[i % CORES_DISTRIBUICAO.length];
          return `
          <div class="breakdown-item">
            <div class="breakdown-item-top">
              <div class="breakdown-dot" style="background:${cor}"></div>
              <div class="breakdown-name">${c.categoria}</div>
              <div class="breakdown-val">${c.pct}%</div>
            </div>
            <div class="breakdown-bar-track">
              <div class="breakdown-bar-fill" style="width:${c.pct}%; background:${cor}"></div>
            </div>
            <div class="breakdown-val" style="font-size:.7rem; color:#888899; font-weight:400;">R$ ${c.valor.toLocaleString('pt-BR')}</div>
          </div>`;
        }).join('')}
      </div>
    `;

  const listaHtml = !filtrados.length
    ? `<div class="geral-empty-mini">Nenhum lançamento encontrado com os filtros selecionados.</div>`
    : `
      <div class="historico-list">
        ${filtrados.map(l => `
          <div class="lanc-item" data-id="${l.id}">
            <div class="lanc-tipo-badge ${l.tipo}">${l.tipo === 'receita' ? '💰' : '💸'}</div>
            <div class="historico-info">
              <div class="historico-titulo">${l.descricao}</div>
              <div class="historico-sub">${l.categoria} · ${new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR')}${l.recorrente ? ' · 🔁 recorrente' : ''}</div>
            </div>
            <div class="historico-valor" style="color:${l.tipo === 'receita' ? 'var(--accent)' : 'var(--accent3)'}">${l.tipo === 'receita' ? '+' : '−'} R$ ${l.valor.toLocaleString('pt-BR')}</div>
            <button class="lanc-btn-excluir" data-id="${l.id}" title="Excluir">🗑️</button>
          </div>`).join('')}
      </div>
    `;

  container.innerHTML = `
    ${filtrosHtml}
    ${resumoHtml}

    <div class="progress-section">
      <div class="section-title">Evolução do Saldo (últimos 6 meses)</div>
      <div class="timeline-hint">Considera todos os lançamentos (incluindo recorrentes já ativos no mês) menos os pagamentos de dívidas — não é afetado pelos filtros acima</div>
      ${evolucaoHtml}
    </div>

    <div class="progress-section">
      <div class="section-title">Despesas por Categoria</div>
      ${categoriaHtml}
    </div>

    <div class="progress-section">
      <div class="section-title">Todos os Lançamentos</div>
      <div class="timeline-hint">Clique num lançamento pra editar</div>
      ${listaHtml}
    </div>
  `;

  document.getElementById('lanc-filtro-tipo').addEventListener('change', (e) => { filtroLancTipo = e.target.value; renderLancamentos(); });
  document.getElementById('lanc-filtro-categoria').addEventListener('change', (e) => { filtroLancCategoria = e.target.value; renderLancamentos(); });
  document.getElementById('lanc-filtro-mes').addEventListener('change', (e) => { filtroLancMes = e.target.value; renderLancamentos(); });
  document.getElementById('lanc-filtro-ano').addEventListener('change', (e) => { filtroLancAno = e.target.value; renderLancamentos(); });

  container.querySelectorAll('.lanc-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.lanc-btn-excluir')) return;
      openLancamentoModal(el.dataset.id);
    });
  });
  container.querySelectorAll('.lanc-btn-excluir').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); excluirLancamento(btn.dataset.id); });
  });
}

/* ── Modal: criar/editar lançamento ── */
function preencherSelectCategoriaLancamento(tipo, valorAtual) {
  const select = document.getElementById('select-lanc-categoria');
  const lista = tipo === 'receita' ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;
  select.innerHTML = lista.map(c => `<option value="${c}" ${c === valorAtual ? 'selected' : ''}>${c}</option>`).join('');
}

function setTipoLancamentoModal(tipo) {
  tipoLancamentoModal = tipo;
  document.getElementById('btn-lanc-tipo-receita').classList.toggle('active', tipo === 'receita');
  document.getElementById('btn-lanc-tipo-despesa').classList.toggle('active', tipo === 'despesa');
  preencherSelectCategoriaLancamento(tipo, null);
}

function openLancamentoModal(id = null) {
  lancamentoEmEdicao = id;
  const l = id ? lancamentos.find(x => x.id === id) : null;

  document.getElementById('lancamento-modal-title').textContent = l ? 'Editar Lançamento' : 'Novo Lançamento';
  document.getElementById('input-lanc-descricao').value = l?.descricao || '';
  document.getElementById('input-lanc-valor').value = l?.valor ?? '';
  document.getElementById('input-lanc-data').value = l?.data || new Date().toISOString().slice(0, 10);
  document.getElementById('input-lanc-recorrente').checked = !!l?.recorrente;
  document.getElementById('input-lanc-observacao').value = l?.observacao || '';

  const tipo = l?.tipo || 'receita';
  setTipoLancamentoModal(tipo);
  if (l) preencherSelectCategoriaLancamento(tipo, l.categoria);

  document.getElementById('lancamento-overlay').classList.add('show');
}

function closeLancamentoModal() {
  document.getElementById('lancamento-overlay').classList.remove('show');
  lancamentoEmEdicao = null;
}

async function salvarLancamento() {
  const descricao = document.getElementById('input-lanc-descricao').value.trim();
  if (!descricao) { showToast('Digite uma descrição'); return; }

  const valor = parseFloat(document.getElementById('input-lanc-valor').value);
  if (isNaN(valor) || valor <= 0) { showToast('Digite um valor válido'); return; }

  const data = document.getElementById('input-lanc-data').value;
  if (!data) { showToast('Escolha uma data'); return; }

  const categoria = document.getElementById('select-lanc-categoria').value;
  const recorrente = document.getElementById('input-lanc-recorrente').checked;
  const observacao = document.getElementById('input-lanc-observacao').value.trim() || null;

  const payload = { tipo: tipoLancamentoModal, descricao, valor, data, categoria, recorrente, observacao, user_id: currentUser.id };

  if (lancamentoEmEdicao) {
    const { data: row, error } = await supabaseClient
      .from('lancamentos')
      .update(payload)
      .eq('id', lancamentoEmEdicao)
      .select()
      .single();
    if (error) { showToast('Erro ao salvar lançamento: ' + error.message); return; }
    const idx = lancamentos.findIndex(x => x.id === lancamentoEmEdicao);
    if (idx !== -1) lancamentos[idx] = row;
    showToast('Lançamento atualizado.');
  } else {
    const { data: row, error } = await supabaseClient
      .from('lancamentos')
      .insert(payload)
      .select()
      .single();
    if (error) { showToast('Erro ao criar lançamento: ' + error.message); return; }
    lancamentos.push(row);
    showToast(tipoLancamentoModal === 'receita' ? 'Receita adicionada.' : 'Despesa adicionada.');
  }

  closeLancamentoModal();
  renderLancamentos();
}

async function excluirLancamento(id) {
  const l = lancamentos.find(x => x.id === id);
  if (!l) return;
  const ok = confirm(`Excluir o lançamento "${l.descricao}"? Essa ação não pode ser desfeita.`);
  if (!ok) return;

  const { error } = await supabaseClient.from('lancamentos').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir lançamento: ' + error.message); return; }

  lancamentos = lancamentos.filter(x => x.id !== id);
  renderLancamentos();
  showToast(`Lançamento "${l.descricao}" excluído`);
}

/* ============================================================
   HISTÓRICO FINANCEIRO
   ============================================================
   Toda a base de dados já vem carregada em `dividas` (parcelas
   com `paga` e `pago_em`, buscadas em loadDividas). Não é preciso
   nenhuma consulta nova ao Supabase — só reorganizar o que já
   existe em memória.
   ============================================================ */

let filtroHistDivida  = 'todas';
let filtroHistMes     = 'todos';
let filtroHistAno     = 'todos';
let filtroHistPeriodo = 'tudo';
let qtdMesesGrafico    = 6;

/* achata todas as parcelas PAGAS de todas as dívidas, anexando a dívida-mãe
   e a data real do pagamento (quando `pago_em` existe) */
function listarPagamentos() {
  const lista = [];
  dividas.forEach(d => {
    d.parcelas.forEach(p => {
      if (!p.paga) return;
      lista.push({
        divida: d,
        parcela: p,
        dataPagamento: p.pago_em ? new Date(p.pago_em) : null,
      });
    });
  });
  return lista;
}

/* anos que realmente têm pagamento com data registrada — usado só pra
   popular o filtro de ano, sem inventar nenhum ano que não exista nos dados */
function anosDisponiveisPagamentos(pagamentos) {
  const anos = new Set(pagamentos.filter(x => x.dataPagamento).map(x => x.dataPagamento.getFullYear()));
  return [...anos].sort((a, b) => b - a);
}

/* aplica os filtros de dívida / mês / ano / período sobre a lista de pagamentos.
   Pagamentos sem `pago_em` registrado só aparecem quando nenhum filtro baseado
   em data está ativo (não dá pra saber se eles "batem" com um mês/ano/período). */
function aplicarFiltrosHistorico(pagamentos) {
  const { mesIdx, ano } = hojeInfo();
  const chaveAtual = ano * 12 + mesIdx;
  const janelaPeriodo = {
    ultimos_3: chaveAtual - 2,
    ultimos_6: chaveAtual - 5,
    este_ano:  ano * 12,
  };

  const temFiltroData = filtroHistMes !== 'todos' || filtroHistAno !== 'todos' || filtroHistPeriodo !== 'tudo';

  return pagamentos.filter(item => {
    if (filtroHistDivida !== 'todas' && item.divida.id !== filtroHistDivida) return false;

    if (!temFiltroData) return true;
    if (!item.dataPagamento) return false; // sem data + filtro de data ativo → não dá pra confirmar

    const dp = item.dataPagamento;
    if (filtroHistMes !== 'todos' && dp.getMonth() !== parseInt(filtroHistMes, 10)) return false;
    if (filtroHistAno !== 'todos' && dp.getFullYear() !== parseInt(filtroHistAno, 10)) return false;

    if (filtroHistPeriodo !== 'tudo') {
      const chave = dp.getFullYear() * 12 + dp.getMonth();
      const min = filtroHistPeriodo === 'este_ano' ? janelaPeriodo.este_ano : janelaPeriodo[filtroHistPeriodo];
      const max = filtroHistPeriodo === 'este_ano' ? ano * 12 + 11 : chaveAtual;
      if (chave < min || chave > max) return false;
    }
    return true;
  });
}

/* ordena do pagamento mais recente pro mais antigo; sem data registrada vai pro fim,
   ordenado pelo mês/ano da própria parcela como critério de desempate honesto */
function ordenarHistorico(pagamentos) {
  return pagamentos.slice().sort((a, b) => {
    if (a.dataPagamento && b.dataPagamento) return b.dataPagamento - a.dataPagamento;
    if (a.dataPagamento && !b.dataPagamento) return -1;
    if (!a.dataPagamento && b.dataPagamento) return 1;
    return chaveData(b.parcela) - chaveData(a.parcela);
  });
}

/* agrupa pagamentos (com data) por mês calendário real do pagamento */
function calcResumoPorMes(pagamentos) {
  const comData = pagamentos.filter(x => x.dataPagamento);
  const mapa = new Map();

  comData.forEach(({ dataPagamento, parcela }) => {
    const chave = dataPagamento.getFullYear() * 12 + dataPagamento.getMonth();
    if (!mapa.has(chave)) {
      mapa.set(chave, { chave, ano: dataPagamento.getFullYear(), mesIdx: dataPagamento.getMonth(), qtd: 0, total: 0 });
    }
    const bucket = mapa.get(chave);
    bucket.qtd += 1;
    bucket.total += parcela.valor;
  });

  return [...mapa.values()].sort((a, b) => b.chave - a.chave);
}

/* totais do período filtrado — inclui pagamentos sem data no valor/quantidade,
   mas média mensal e "maior mês" só fazem sentido com base nos meses reais */
function calcTotaisHistorico(pagamentosFiltrados, resumoPorMes) {
  const totalPago = pagamentosFiltrados.reduce((s, x) => s + x.parcela.valor, 0);
  const qtdParcelasPagas = pagamentosFiltrados.length;
  const qtdSemData = pagamentosFiltrados.filter(x => !x.dataPagamento).length;

  const qtdMesesComDado = resumoPorMes.length;
  const totalComData = resumoPorMes.reduce((s, m) => s + m.total, 0);
  const mediaMensal = qtdMesesComDado ? totalComData / qtdMesesComDado : 0;

  let maiorMes = null;
  resumoPorMes.forEach(m => { if (!maiorMes || m.total > maiorMes.total) maiorMes = m; });

  return { totalPago, qtdParcelasPagas, qtdSemData, mediaMensal, maiorMes };
}

function labelMes(mesIdx, ano) { return `${MESES[mesIdx]}/${ano}`; }

function renderHistorico() {
  const container = document.getElementById('historico-content');
  const todosPagamentos = listarPagamentos();

  if (!todosPagamentos.length) {
    container.innerHTML = emptyStateHtml({
      icon: '🕓',
      title: 'Nenhum pagamento registrado ainda',
      subtitle: 'Assim que você marcar parcelas como pagas na aba "Dívidas", elas vão aparecer aqui com sua evolução ao longo do tempo.',
    });
    return;
  }

  const anosDisponiveis = anosDisponiveisPagamentos(todosPagamentos);
  const filtrados = ordenarHistorico(aplicarFiltrosHistorico(todosPagamentos));
  const resumoPorMes = calcResumoPorMes(filtrados);
  const totais = calcTotaisHistorico(filtrados, resumoPorMes);

  /* gráfico de evolução: respeita só o filtro de dívida (não mês/ano/período),
     senão o próprio filtro esvaziaria o gráfico que ele deveria ilustrar */
  const pagamentosParaGrafico = filtroHistDivida === 'todas'
    ? todosPagamentos
    : todosPagamentos.filter(x => x.divida.id === filtroHistDivida);
  const resumoGrafico = calcResumoPorMes(pagamentosParaGrafico);
  const janelaGrafico = qtdMesesGrafico === 'tudo' ? resumoGrafico : resumoGrafico.slice(0, qtdMesesGrafico);
  const graficoAsc = janelaGrafico.slice().reverse();
  const maiorValorGrafico = Math.max(1, ...graficoAsc.map(m => m.total));

  /* ── filtros ── */
  const filtrosHtml = `
    <div class="historico-filtros">
      <select class="filtro-select" id="hist-filtro-divida">
        <option value="todas">Todas as dívidas</option>
        ${dividas.map(d => `<option value="${d.id}" ${filtroHistDivida === d.id ? 'selected' : ''}>${d.titulo}</option>`).join('')}
      </select>
      <select class="filtro-select" id="hist-filtro-mes">
        <option value="todos">Todos os meses</option>
        ${MESES.map((m, i) => `<option value="${i}" ${filtroHistMes === String(i) ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <select class="filtro-select" id="hist-filtro-ano">
        <option value="todos">Todos os anos</option>
        ${anosDisponiveis.map(a => `<option value="${a}" ${filtroHistAno === String(a) ? 'selected' : ''}>${a}</option>`).join('')}
      </select>
      <select class="filtro-select" id="hist-filtro-periodo">
        <option value="tudo" ${filtroHistPeriodo === 'tudo' ? 'selected' : ''}>Todo o período</option>
        <option value="ultimos_3" ${filtroHistPeriodo === 'ultimos_3' ? 'selected' : ''}>Últimos 3 meses</option>
        <option value="ultimos_6" ${filtroHistPeriodo === 'ultimos_6' ? 'selected' : ''}>Últimos 6 meses</option>
        <option value="este_ano" ${filtroHistPeriodo === 'este_ano' ? 'selected' : ''}>Este ano</option>
      </select>
    </div>
  `;

  /* ── total pago ── */
  const totalPagoHtml = `
    <div class="stats-grid">
      <div class="stat-card green">
        <div class="stat-label">Total Pago no Período</div>
        <div class="stat-value">R$ ${totais.totalPago.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">${totais.qtdParcelasPagas} parcela${totais.qtdParcelasPagas !== 1 ? 's' : ''} paga${totais.qtdParcelasPagas !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Média Mensal Paga</div>
        <div class="stat-value">R$ ${totais.mediaMensal.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</div>
        <div class="stat-sub">${resumoPorMes.length} mês${resumoPorMes.length !== 1 ? 'es' : ''} com pagamento registrado</div>
      </div>
      <div class="stat-card gold">
        <div class="stat-label">Maior Valor Pago em um Mês</div>
        <div class="stat-value">${totais.maiorMes ? `R$ ${totais.maiorMes.total.toLocaleString('pt-BR')}` : '—'}</div>
        <div class="stat-sub">${totais.maiorMes ? labelMes(totais.maiorMes.mesIdx, totais.maiorMes.ano) : 'sem dados suficientes'}</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Parcelas Pagas (total)</div>
        <div class="stat-value">${totais.qtdParcelasPagas}</div>
        <div class="stat-sub">${totais.qtdSemData > 0 ? `${totais.qtdSemData} sem data de pagamento registrada` : 'todas com data registrada'}</div>
      </div>
    </div>
  `;

  /* ── gráfico de evolução ── */
  const graficoHtml = !graficoAsc.length
    ? `<div class="geral-empty-mini">Ainda não há pagamentos com data registrada para montar o gráfico.</div>`
    : `
      <div class="mes-bar-list">
        ${graficoAsc.map(m => `
          <div class="mes-bar-row">
            <div class="mes-bar-label">${MESES[m.mesIdx].slice(0, 3)}/${String(m.ano).slice(2)}</div>
            <div class="mes-bar-track">
              <div class="mes-bar-fill" style="width:${Math.max(4, (m.total / maiorValorGrafico) * 100)}%"></div>
            </div>
            <div class="mes-bar-valor">R$ ${m.total.toLocaleString('pt-BR')}</div>
          </div>`).join('')}
      </div>
    `;

  /* ── resumo por mês ── */
  const resumoMesHtml = !resumoPorMes.length
    ? `<div class="geral-empty-mini">Nenhum pagamento com data registrada no filtro atual.</div>`
    : `
      <div class="resumo-mes-grid">
        ${resumoPorMes.map(m => `
          <div class="resumo-mes-card">
            <div class="resumo-mes-titulo">${labelMes(m.mesIdx, m.ano)}</div>
            <div class="resumo-mes-qtd">${m.qtd} parcela${m.qtd !== 1 ? 's' : ''} paga${m.qtd !== 1 ? 's' : ''}</div>
            <div class="resumo-mes-valor">R$ ${m.total.toLocaleString('pt-BR')} pagos</div>
          </div>`).join('')}
      </div>
    `;

  /* ── lista de pagamentos ── */
  const listaHtml = !filtrados.length
    ? `<div class="geral-empty-mini">Nenhum pagamento encontrado com os filtros selecionados.</div>`
    : `
      <div class="historico-list">
        ${filtrados.map(({ divida, parcela, dataPagamento }) => `
          <div class="historico-item" data-divida-id="${divida.id}" data-parcela-id="${parcela.id}">
            <div class="historico-data">${dataPagamento ? dataPagamento.toLocaleDateString('pt-BR') : 'Sem data'}</div>
            <div class="historico-info">
              <div class="historico-titulo">${divida.titulo}</div>
              <div class="historico-sub">Parcela de ${parcela.mes}/${parcela.ano}</div>
            </div>
            <div class="historico-valor">R$ ${parcela.valor.toLocaleString('pt-BR')}</div>
          </div>`).join('')}
      </div>
    `;

  container.innerHTML = `
    ${filtrosHtml}
    ${totalPagoHtml}

    <div class="progress-section">
      <div class="geral-section-header">
        <div class="section-title" style="margin-bottom:0;">Evolução dos Pagamentos</div>
        <select class="filtro-select" id="hist-filtro-grafico">
          <option value="6" ${qtdMesesGrafico === 6 ? 'selected' : ''}>Últimos 6 meses</option>
          <option value="12" ${qtdMesesGrafico === 12 ? 'selected' : ''}>Últimos 12 meses</option>
          <option value="tudo" ${qtdMesesGrafico === 'tudo' ? 'selected' : ''}>Tudo</option>
        </select>
      </div>
      <div class="timeline-hint">Soma dos pagamentos com data registrada, por mês${filtroHistDivida !== 'todas' ? ' · filtrado pela dívida selecionada acima' : ''} — não é afetado pelos filtros de mês/ano/período</div>
      ${graficoHtml}
    </div>

    <div class="progress-section">
      <div class="section-title">Resumo por Mês</div>
      ${resumoMesHtml}
    </div>

    <div class="progress-section">
      <div class="section-title">Histórico de Pagamentos</div>
      <div class="timeline-hint">Do mais recente para o mais antigo · clique num pagamento para ver os detalhes da parcela</div>
      ${listaHtml}
    </div>
  `;

  /* ── listeners dos filtros ── */
  document.getElementById('hist-filtro-divida').addEventListener('change', (e) => { filtroHistDivida = e.target.value; renderHistorico(); });
  document.getElementById('hist-filtro-mes').addEventListener('change', (e) => { filtroHistMes = e.target.value; renderHistorico(); });
  document.getElementById('hist-filtro-ano').addEventListener('change', (e) => { filtroHistAno = e.target.value; renderHistorico(); });
  document.getElementById('hist-filtro-periodo').addEventListener('change', (e) => { filtroHistPeriodo = e.target.value; renderHistorico(); });
  document.getElementById('hist-filtro-grafico').addEventListener('change', (e) => {
    qtdMesesGrafico = e.target.value === 'tudo' ? 'tudo' : parseInt(e.target.value, 10);
    renderHistorico();
  });

  container.querySelectorAll('.historico-item').forEach(el => {
    el.addEventListener('click', () => abrirDetalhePagamento(el.dataset.dividaId, el.dataset.parcelaId));
  });
}

/* ── modal de detalhes do pagamento (somente leitura, com atalho pra editar) ── */
let detalheHistoricoAtual = null;

function abrirDetalhePagamento(dividaId, parcelaId) {
  const d = dividas.find(x => x.id === dividaId);
  if (!d) return;
  const idx = d.parcelas.findIndex(p => p.id === parcelaId);
  if (idx === -1) return;
  const p = d.parcelas[idx];

  detalheHistoricoAtual = { dividaId, idx };

  const linhas = [
    ['Dívida', d.titulo],
    ['Parcela', `${p.mes}/${p.ano}`],
    ['Valor', `R$ ${p.valor.toLocaleString('pt-BR')}`],
    ['Status', p.paga ? '✓ Paga' : '○ Pendente'],
    ['Data do Pagamento', p.pago_em ? new Date(p.pago_em).toLocaleString('pt-BR') : 'Não registrada'],
  ];

  document.getElementById('historico-detalhe-lista').innerHTML = linhas.map(([label, valor]) => `
    <div class="detalhe-row">
      <div class="detalhe-label">${label}</div>
      <div class="detalhe-value">${valor}</div>
    </div>`).join('');

  document.getElementById('historico-detalhe-overlay').classList.add('show');
}

function fecharDetalhePagamento() {
  document.getElementById('historico-detalhe-overlay').classList.remove('show');
  detalheHistoricoAtual = null;
}

/* ── Tabs ── */
function renderTabs() {
  const bar = document.getElementById('tab-bar');
  const ativas    = dividas.filter(d => !isQuitada(d));
  const quitadas  = dividas.filter(isQuitada);

  // ordena por urgência: dívidas com parcela atrasada primeiro, depois pela data da próxima parcela
  ativas.sort((a, b) => {
    const ca = calcDivida(a), cb = calcDivida(b);
    if (ca.numAtrasadas !== cb.numAtrasadas) return cb.numAtrasadas - ca.numAtrasadas;
    const proxA = ca.proxIdx >= 0 ? chaveData(a.parcelas[ca.proxIdx]) : Infinity;
    const proxB = cb.proxIdx >= 0 ? chaveData(b.parcelas[cb.proxIdx]) : Infinity;
    return proxA - proxB;
  });

  let html = '';
  ativas.forEach(d => {
    const { numAtrasadas } = calcDivida(d);
    html += `<button class="tab ${d.id === activeTabId ? 'active' : ''}" data-id="${d.id}">${numAtrasadas > 0 ? '⚠️ ' : ''}${d.titulo}</button>`;
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
    content.innerHTML = emptyStateHtml({
      icon: '💳',
      title: 'Nenhuma dívida cadastrada',
      subtitle: 'Comece cadastrando sua primeira dívida — financiamento, cartão, empréstimo, o que for.',
      ctaLabel: '+ Nova Dívida',
      ctaId: 'btn-empty-nova-divida',
    });
    document.getElementById('btn-empty-nova-divida').addEventListener('click', openModal);
    fadeInView(content);
    return;
  }

  if (activeTabId === '__quitadas__') {
    renderQuitadasList(content);
    fadeInView(content);
    return;
  }

  const d = dividas.find(x => x.id === activeTabId);
  if (!d) {
    activeTabId = dividas[0].id;
    renderTabs();
    return renderContent();
  }
  renderDashboard(content, d);
  fadeInView(content);
}

function renderQuitadasList(content) {
  const quitadas = dividas.filter(isQuitada);

  if (!quitadas.length) {
    content.innerHTML = emptyStateHtml({
      icon: '🏆',
      title: 'Nenhuma dívida quitada ainda',
      subtitle: 'Quando todas as parcelas de uma dívida forem marcadas como pagas, ela aparece aqui.',
    });
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
  const { total, descontado, restante, pct, numPagas, numFaltam, proxIdx, numAtrasadas, valorAtrasado, ultimaParcela, juros } = calcDivida(d);
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

  const previsaoLabel = quitada
    ? '🎉 Quitado'
    : (ultimaParcela ? `${ultimaParcela.mes}/${ultimaParcela.ano}` : '—');

  content.innerHTML = `
    <div class="dashboard-header">
      <div>
        <h2 class="dashboard-title">${d.titulo}</h2>
        <div class="dashboard-badge">${periodoTexto(d)} · ${d.parcelas.length} parcelas</div>
        ${numAtrasadas > 0 ? `<div class="dashboard-badge badge-atraso">⚠️ ${numAtrasadas} parcela${numAtrasadas !== 1 ? 's' : ''} atrasada${numAtrasadas !== 1 ? 's' : ''} · R$ ${valorAtrasado.toLocaleString('pt-BR')}</div>` : ''}
      </div>
      <div class="dashboard-actions">
        ${quitada ? `<button class="btn-back" id="btn-voltar-quitadas">← Voltar para Quitadas</button>` : ''}
        <button class="btn-secondary" id="btn-editar-divida" title="Editar dívida inteira">✏️ Editar Dívida</button>
        <button class="btn-secondary" id="btn-add-parcela" title="Adicionar parcela extra">+ Parcela</button>
        <button class="btn-delete" id="btn-delete-divida" title="Excluir dívida">🗑</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card blue">
        <div class="stat-label">Valor Total da Dívida</div>
        <div class="stat-value">R$ ${total.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">${d.parcelas.length} parcelas</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Já Descontado</div>
        <div class="stat-value">R$ ${descontado.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">${numPagas} parcela${numPagas !== 1 ? 's' : ''} paga${numPagas !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Saldo Restante</div>
        <div class="stat-value">R$ ${restante.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">${numFaltam} parcela${numFaltam !== 1 ? 's' : ''} restante${numFaltam !== 1 ? 's' : ''}</div>
      </div>
      <div class="stat-card gold">
        <div class="stat-label">Próxima Parcela</div>
        <div class="stat-value">${proximaLabel}</div>
        <div class="stat-sub">${proximaVal}</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Previsão de Quitação</div>
        <div class="stat-value">${previsaoLabel}</div>
        <div class="stat-sub">${quitada ? 'dívida encerrada' : 'último mês previsto'}</div>
      </div>
      ${juros !== null ? `
      <div class="stat-card pink">
        <div class="stat-label">Juros / Acréscimo</div>
        <div class="stat-value">R$ ${juros.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">sobre o valor original de R$ ${d.valorOriginal.toLocaleString('pt-BR')}</div>
      </div>` : ''}
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
  document.getElementById('btn-add-parcela').addEventListener('click', () => openAddParcelaModal(d.id));
  document.getElementById('btn-editar-divida').addEventListener('click', () => openEditDividaModal(d.id));
}

function renderParcelasGrid(d) {
  const grid = document.getElementById('parcelas-grid');
  grid.innerHTML = '';
  const ultimoIdx = d.parcelas.length - 1;

  d.parcelas.forEach((p, i) => {
    const isGratuita = p.valor === 0;
    const isFinal    = i === ultimoIdx && d.parcelas.length > 1;
    const atrasada   = isAtrasada(p);
    const card = document.createElement('div');
    card.className = `parcela-card ${p.paga ? 'pago' : 'pendente'} ${atrasada ? 'atrasada' : ''}`;
    /* sem animação por cartão: re-renderizar a grade não deve reanimar as 24 parcelas */

    const valorLabel = isGratuita ? 'R$ 0,00' : `R$ ${p.valor.toLocaleString('pt-BR')}`;
    const subLabel = isGratuita ? 'sem desconto' : (isFinal ? 'parcela final' : 'mensal');
    const statusLabel = p.paga ? '✓ Pago' : (atrasada ? '⚠ Atrasada' : '○ Pendente');

    card.innerHTML = `
      <button class="parcela-edit-btn" title="Editar valor desta parcela">✏️</button>
      <div class="parcela-mes">${p.mes}<span style="opacity:.5"> /${String(p.ano).slice(2)}</span></div>
      <div class="parcela-valor">
        ${valorLabel}
        <small>${subLabel}</small>
      </div>
      <div class="parcela-status">${statusLabel}</div>
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
  const pagoEm = novoValor ? new Date().toISOString() : null;

  const { error } = await supabaseClient
    .from('parcelas')
    .update({ paga: novoValor, pago_em: pagoEm })
    .eq('id', p.id);

  if (error) { showToast('Erro ao salvar: ' + error.message); return; }

  p.paga = novoValor;
  p.pago_em = pagoEm;

  const ficouQuitada = isQuitada(d);

  card.classList.remove('just-toggled');
  void card.offsetWidth;
  card.classList.add('just-toggled');

  const valorMsg = p.valor === 0 ? 'mês sem desconto' : `R$ ${p.valor.toLocaleString('pt-BR')} descontados`;
  if (p.paga && ficouQuitada) {
    showToast(`🎉 Parabéns! Dívida quitada — "${d.titulo}" foi totalmente paga!`);
  } else {
    showToast(p.paga ? `Parcela marcada como paga — ${p.mes} (${valorMsg})` : `↩️ ${p.mes} desmarcado`);
  }

  renderTabs();
  renderContent();
  atualizarBadgeENotificacoes();
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
  atualizarBadgeENotificacoes();
  showToast(`Dívida "${d.titulo}" excluída`);
}

/* ── Modal: nova dívida ── */
let modoNovaDivida = 'meses'; // 'meses' | 'total'

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* Gera a lista de valores das parcelas a partir do valor total da dívida
   e do valor que a pessoa pretende pagar por mês. A última parcela recebe
   o resto (quando a divisão não é exata). */
function gerarValoresPorTotal(valorTotal, valorMensal) {
  const valores = [];
  let restante = round2(valorTotal);
  let guard = 0;
  while (restante > 0.005 && guard < 1200) { // guard evita loop infinito
    const valor = restante >= valorMensal ? valorMensal : restante;
    valores.push(round2(valor));
    restante = round2(restante - valor);
    guard++;
  }
  return valores;
}

function setModoNovaDivida(modo) {
  modoNovaDivida = modo;
  document.getElementById('btn-modo-meses').classList.toggle('active', modo === 'meses');
  document.getElementById('btn-modo-total').classList.toggle('active', modo === 'total');
  document.getElementById('bloco-modo-meses').style.display = modo === 'meses' ? 'block' : 'none';
  document.getElementById('bloco-modo-total').style.display = modo === 'total' ? 'block' : 'none';
  atualizarPreviewModoTotal();
}

function atualizarPreviewModoTotal() {
  const preview = document.getElementById('modo-total-preview');
  if (modoNovaDivida !== 'total') { preview.classList.remove('show'); return; }

  const valorTotal  = parseFloat(document.getElementById('input-valor-total').value);
  const valorMensal = parseFloat(document.getElementById('input-valor-mensal').value);

  if (isNaN(valorTotal) || valorTotal <= 0 || isNaN(valorMensal) || valorMensal <= 0) {
    preview.classList.remove('show');
    return;
  }

  const valores = gerarValoresPorTotal(valorTotal, valorMensal);
  const meses = valores.length;
  const ultima = valores[meses - 1];
  const igual = valores.every(v => v === valores[0]);

  let texto;
  if (igual) {
    texto = `Serão <strong>${meses} parcela${meses !== 1 ? 's' : ''}</strong> de R$ ${valores[0].toLocaleString('pt-BR')}.`;
  } else {
    texto = `Serão <strong>${meses} parcelas</strong>: ${meses - 1} de R$ ${valorMensal.toLocaleString('pt-BR')} e a última de R$ ${ultima.toLocaleString('pt-BR')} (ajuste final).`;
  }
  preview.innerHTML = texto;
  preview.classList.add('show');
}

function openModal() {
  const overlay = document.getElementById('modal-overlay');

  document.getElementById('input-titulo').value = '';
  document.getElementById('input-valor').value = '';
  document.getElementById('input-meses').value = '';
  document.getElementById('input-valor-total').value = '';
  document.getElementById('input-valor-mensal').value = '';
  document.getElementById('input-valor-original').value = '';

  setModoNovaDivida('meses');

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
  const mesInicial = parseInt(document.getElementById('input-mes-inicial').value, 10);
  const anoInicial  = parseInt(document.getElementById('input-ano-inicial').value, 10);
  const valorOriginalRaw = document.getElementById('input-valor-original').value;
  const valorOriginalInput = valorOriginalRaw === '' ? null : parseFloat(valorOriginalRaw);

  if (!titulo) { showToast('Digite um título para a dívida'); return; }
  if (isNaN(anoInicial)) { showToast('Digite o ano inicial'); return; }
  if (valorOriginalInput !== null && (isNaN(valorOriginalInput) || valorOriginalInput < 0)) {
    showToast('Digite um valor original válido'); return;
  }

  let valoresParcelas = [];

  if (modoNovaDivida === 'meses') {
    const valor = parseFloat(document.getElementById('input-valor').value);
    const meses = parseInt(document.getElementById('input-meses').value, 10);

    if (isNaN(valor) || valor < 0) { showToast('Digite um valor de parcela válido'); return; }
    if (isNaN(meses) || meses < 1) { showToast('Digite a quantidade de meses'); return; }

    valoresParcelas = Array.from({ length: meses }, () => valor);
  } else {
    const valorTotal  = parseFloat(document.getElementById('input-valor-total').value);
    const valorMensal = parseFloat(document.getElementById('input-valor-mensal').value);

    if (isNaN(valorTotal) || valorTotal <= 0) { showToast('Digite o valor total da dívida'); return; }
    if (isNaN(valorMensal) || valorMensal <= 0) { showToast('Digite quanto pretende pagar por mês'); return; }

    valoresParcelas = gerarValoresPorTotal(valorTotal, valorMensal);
  }

  const { data: novaDividaRow, error: errDivida } = await supabaseClient
    .from('dividas')
    .insert({ titulo, user_id: currentUser.id, valor_original: valorOriginalInput })
    .select()
    .single();

  if (errDivida) { showToast('Erro ao criar dívida: ' + errDivida.message); return; }

  const parcelasParaInserir = [];
  let mes = mesInicial, ano = anoInicial;
  valoresParcelas.forEach((valorParcela, i) => {
    parcelasParaInserir.push({
      divida_id: novaDividaRow.id,
      mes: MESES[mes],
      ano,
      valor: valorParcela,
      paga: false,
      ordem: i,
    });
    mes++;
    if (mes > 11) { mes = 0; ano++; }
  });

  const { data: parcelasInseridas, error: errParcelas } = await supabaseClient
    .from('parcelas')
    .insert(parcelasParaInserir)
    .select();

  if (errParcelas) { showToast('Erro ao criar parcelas: ' + errParcelas.message); return; }

  const novaDivida = {
    id: novaDividaRow.id,
    titulo: novaDividaRow.titulo,
    valorOriginal: novaDividaRow.valor_original,
    parcelas: ordenarParcelas(parcelasInseridas),
  };

  dividas.push(novaDivida);
  activeTabId = novaDivida.id;
  closeModal();
  renderTabs();
  renderContent();
  atualizarBadgeENotificacoes();
  showToast(`Dívida "${titulo}" criada com sucesso! (${valoresParcelas.length} parcelas)`);
}

/* ── Modal: editar valor de uma parcela específica ── */
let parcelaEmEdicao = null; // { dividaId, idx }

function openEditParcelaModal(dividaId, idx) {
  const d = dividas.find(x => x.id === dividaId);
  if (!d) return;
  const p = d.parcelas[idx];
  parcelaEmEdicao = { dividaId, idx };

  const selectMes = document.getElementById('input-edit-mes');
  selectMes.innerHTML = MESES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  selectMes.value = MESES.indexOf(p.mes);
  document.getElementById('input-edit-ano').value = p.ano;

  document.getElementById('edit-parcela-info').textContent = `${p.mes} /${p.ano}`;
  document.getElementById('input-edit-valor').value = p.valor;
  document.getElementById('edit-parcela-overlay').classList.add('show');
  document.getElementById('input-edit-valor').focus();
}

function closeEditParcelaModal() {
  document.getElementById('edit-parcela-overlay').classList.remove('show');
  parcelaEmEdicao = null;
}

/* atualiza a view que estiver visível no momento — necessário porque a edição/exclusão
   de uma parcela pode ser aberta a partir do Histórico ou da Visão Geral, não só da
   aba "Dívidas", e cada uma dessas telas tem seu próprio conteúdo pra recalcular */
function refreshViewAtual() {
  if (document.getElementById('view-historico').style.display === 'block') renderHistorico();
  else if (document.getElementById('view-geral').style.display === 'block') renderVisaoGeral();
  else if (document.getElementById('view-metas').style.display === 'block') renderMetas();
  else if (document.getElementById('view-lancamentos').style.display === 'block') renderLancamentos();
}

async function salvarEdicaoParcela() {
  if (!parcelaEmEdicao) return;
  const { dividaId, idx } = parcelaEmEdicao;
  const d = dividas.find(x => x.id === dividaId);
  if (!d) return;
  const p = d.parcelas[idx];

  const novoValor = parseFloat(document.getElementById('input-edit-valor').value);
  const novoMesIdx = parseInt(document.getElementById('input-edit-mes').value, 10);
  const novoAno = parseInt(document.getElementById('input-edit-ano').value, 10);

  if (isNaN(novoValor) || novoValor < 0) { showToast('Digite um valor válido'); return; }
  if (isNaN(novoAno)) { showToast('Digite um ano válido'); return; }

  const novoMes = MESES[novoMesIdx];

  const { error } = await supabaseClient
    .from('parcelas')
    .update({ valor: novoValor, mes: novoMes, ano: novoAno })
    .eq('id', p.id);

  if (error) { showToast('Erro ao salvar: ' + error.message); return; }

  p.valor = novoValor;
  p.mes = novoMes;
  p.ano = novoAno;
  d.parcelas = ordenarParcelas(d.parcelas);

  closeEditParcelaModal();
  renderTabs();
  renderContent();
  refreshViewAtual();
  atualizarBadgeENotificacoes();
  showToast(`Parcela atualizada: ${novoMes}/${novoAno} — R$ ${novoValor.toLocaleString('pt-BR')}`);
}

async function excluirParcela() {
  if (!parcelaEmEdicao) return;
  const { dividaId, idx } = parcelaEmEdicao;
  const d = dividas.find(x => x.id === dividaId);
  if (!d) return;
  const p = d.parcelas[idx];

  const ok = confirm(`Excluir a parcela de ${p.mes}/${p.ano}? Essa ação não pode ser desfeita.`);
  if (!ok) return;

  const { error } = await supabaseClient.from('parcelas').delete().eq('id', p.id);
  if (error) { showToast('Erro ao excluir parcela: ' + error.message); return; }

  d.parcelas.splice(idx, 1);
  closeEditParcelaModal();
  renderTabs();
  renderContent();
  refreshViewAtual();
  atualizarBadgeENotificacoes();
  showToast(`Parcela de ${p.mes}/${p.ano} excluída`);
}

/* ── Modal: adicionar parcela extra a uma dívida existente ── */
let dividaEmEdicaoParcela = null; // id da dívida recebendo a nova parcela

function openAddParcelaModal(dividaId) {
  const d = dividas.find(x => x.id === dividaId);
  if (!d) return;
  dividaEmEdicaoParcela = dividaId;

  const selectMes = document.getElementById('input-add-mes');
  selectMes.innerHTML = MESES.map((m, i) => `<option value="${i}">${m}</option>`).join('');

  // sugere o mês seguinte ao da última parcela cadastrada (ou o mês atual, se não houver nenhuma)
  let proxMes, proxAno;
  if (d.parcelas.length) {
    const ultima = d.parcelas[d.parcelas.length - 1];
    proxMes = MESES.indexOf(ultima.mes);
    proxAno = ultima.ano;
    proxMes++;
    if (proxMes > 11) { proxMes = 0; proxAno++; }
  } else {
    const hoje = new Date();
    proxMes = hoje.getMonth();
    proxAno = hoje.getFullYear();
  }

  selectMes.value = proxMes;
  document.getElementById('input-add-ano').value = proxAno;
  document.getElementById('input-add-valor').value = '';
  document.getElementById('input-add-paga').checked = false;
  document.getElementById('add-parcela-info').textContent = `Dívida: ${d.titulo}`;

  document.getElementById('add-parcela-overlay').classList.add('show');
  document.getElementById('input-add-valor').focus();
}

function closeAddParcelaModal() {
  document.getElementById('add-parcela-overlay').classList.remove('show');
  dividaEmEdicaoParcela = null;
}

async function salvarNovaParcela() {
  if (!dividaEmEdicaoParcela) return;
  const d = dividas.find(x => x.id === dividaEmEdicaoParcela);
  if (!d) return;

  const mesIdx = parseInt(document.getElementById('input-add-mes').value, 10);
  const ano    = parseInt(document.getElementById('input-add-ano').value, 10);
  const valor  = parseFloat(document.getElementById('input-add-valor').value);
  const paga   = document.getElementById('input-add-paga').checked;

  if (isNaN(ano)) { showToast('Digite o ano da parcela'); return; }
  if (isNaN(valor) || valor < 0) { showToast('Digite um valor válido'); return; }

  const maiorOrdem = d.parcelas.reduce((max, p) => Math.max(max, p.ordem), -1);

  const { data: parcelaInserida, error } = await supabaseClient
    .from('parcelas')
    .insert({
      divida_id: d.id,
      mes: MESES[mesIdx],
      ano,
      valor,
      paga,
      pago_em: paga ? new Date().toISOString() : null,
      ordem: maiorOrdem + 1,
    })
    .select()
    .single();

  if (error) { showToast('Erro ao adicionar parcela: ' + error.message); return; }

  d.parcelas.push(parcelaInserida);
  d.parcelas = ordenarParcelas(d.parcelas);

  closeAddParcelaModal();
  renderTabs();
  renderContent();
  atualizarBadgeENotificacoes();
  showToast(`Parcela de ${MESES[mesIdx]}/${ano} adicionada — tudo reajustado automaticamente`);
}

/* ── Modal: editar dívida inteira (título, valor original, data de início e parcelas) ── */
let dividaEmEdicaoCompleta = null;

function openEditDividaModal(dividaId) {
  const d = dividas.find(x => x.id === dividaId);
  if (!d) return;
  dividaEmEdicaoCompleta = dividaId;

  document.getElementById('input-ed-titulo').value = d.titulo;
  document.getElementById('input-ed-valor-original').value = d.valorOriginal ?? '';

  const selectMes = document.getElementById('input-ed-mes-inicial');
  selectMes.innerHTML = MESES.map((m, i) => `<option value="${i}">${m}</option>`).join('');

  if (d.parcelas.length) {
    const primeira = d.parcelas[0];
    selectMes.value = MESES.indexOf(primeira.mes);
    document.getElementById('input-ed-ano-inicial').value = primeira.ano;
  } else {
    const hoje = new Date();
    selectMes.value = hoje.getMonth();
    document.getElementById('input-ed-ano-inicial').value = hoje.getFullYear();
  }

  renderEdParcelasList(d);

  document.getElementById('edit-divida-overlay').classList.add('show');
  document.getElementById('input-ed-titulo').focus();
}

function closeEditDividaModal() {
  document.getElementById('edit-divida-overlay').classList.remove('show');
  dividaEmEdicaoCompleta = null;
}

/* desenha a lista de parcelas dentro da modal, cada uma com edição inline de valor */
function renderEdParcelasList(d) {
  const list = document.getElementById('ed-parcelas-list');

  if (!d.parcelas.length) {
    list.innerHTML = `<div class="ed-parcelas-empty">Nenhuma parcela cadastrada.</div>`;
    return;
  }

  list.innerHTML = d.parcelas.map((p, i) => `
    <div class="ed-parcela-row" data-idx="${i}">
      <div class="ed-parcela-data">${p.mes.slice(0, 3)}<span>/${String(p.ano).slice(2)}</span></div>
      <div class="ed-parcela-status ${p.paga ? 'pago' : ''}">${p.paga ? '✓ pago' : '○ pendente'}</div>
      <div class="ed-parcela-valor-view">R$ ${p.valor.toLocaleString('pt-BR')}</div>
      <input type="number" class="ed-parcela-valor-input" min="0" step="0.01" value="${p.valor}" style="display:none" />
      <div class="ed-parcela-actions">
        <button class="ed-parcela-btn ed-parcela-edit" title="Editar valor desta parcela">✏️</button>
        <button class="ed-parcela-btn ed-parcela-confirm" title="Salvar" style="display:none">✓</button>
        <button class="ed-parcela-btn ed-parcela-cancel" title="Cancelar" style="display:none">✕</button>
        <button class="ed-parcela-btn ed-parcela-del" title="Excluir parcela">🗑</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.ed-parcela-row').forEach(row => {
    const idx = parseInt(row.dataset.idx, 10);
    const viewEl     = row.querySelector('.ed-parcela-valor-view');
    const inputEl    = row.querySelector('.ed-parcela-valor-input');
    const editBtn    = row.querySelector('.ed-parcela-edit');
    const confirmBtn = row.querySelector('.ed-parcela-confirm');
    const cancelBtn  = row.querySelector('.ed-parcela-cancel');
    const delBtn     = row.querySelector('.ed-parcela-del');

    const entrarModoEdicao = () => {
      viewEl.style.display = 'none';
      inputEl.style.display = 'block';
      editBtn.style.display = 'none';
      confirmBtn.style.display = 'inline-flex';
      cancelBtn.style.display = 'inline-flex';
      inputEl.focus();
      inputEl.select();
    };

    const sairModoEdicao = () => {
      viewEl.style.display = 'block';
      inputEl.style.display = 'none';
      editBtn.style.display = 'inline-flex';
      confirmBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
    };

    editBtn.addEventListener('click', entrarModoEdicao);

    cancelBtn.addEventListener('click', () => {
      inputEl.value = d.parcelas[idx].valor;
      sairModoEdicao();
    });

    confirmBtn.addEventListener('click', () => salvarValorParcelaInline(d.id, idx, inputEl.value));

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') salvarValorParcelaInline(d.id, idx, inputEl.value);
      if (e.key === 'Escape') cancelBtn.click();
    });

    delBtn.addEventListener('click', () => excluirParcelaInline(d.id, idx));
  });
}

/* salva na hora o valor de UMA parcela específica, sem precisar do botão "Salvar Alterações" */
async function salvarValorParcelaInline(dividaId, idx, valorRaw) {
  const d = dividas.find(x => x.id === dividaId);
  if (!d) return;
  const p = d.parcelas[idx];

  const novoValor = parseFloat(valorRaw);
  if (isNaN(novoValor) || novoValor < 0) { showToast('Digite um valor válido'); return; }

  const { error } = await supabaseClient.from('parcelas').update({ valor: novoValor }).eq('id', p.id);
  if (error) { showToast('Erro ao salvar parcela: ' + error.message); return; }

  p.valor = novoValor;
  renderEdParcelasList(d);
  renderTabs();
  renderContent();
  atualizarBadgeENotificacoes();
  showToast(`Parcela de ${p.mes}/${p.ano} atualizada para R$ ${novoValor.toLocaleString('pt-BR')}`);
}

async function excluirParcelaInline(dividaId, idx) {
  const d = dividas.find(x => x.id === dividaId);
  if (!d) return;
  const p = d.parcelas[idx];

  const ok = confirm(`Excluir a parcela de ${p.mes}/${p.ano}? Essa ação não pode ser desfeita.`);
  if (!ok) return;

  const { error } = await supabaseClient.from('parcelas').delete().eq('id', p.id);
  if (error) { showToast('Erro ao excluir parcela: ' + error.message); return; }

  d.parcelas.splice(idx, 1);
  renderEdParcelasList(d);
  renderTabs();
  renderContent();
  atualizarBadgeENotificacoes();
  showToast(`Parcela de ${p.mes}/${p.ano} excluída`);
}

/* salva título, valor original e (se alterada) a data de início — desloca todas as parcelas */
async function salvarEditDivida() {
  if (!dividaEmEdicaoCompleta) return;
  const d = dividas.find(x => x.id === dividaEmEdicaoCompleta);
  if (!d) return;

  const novoTitulo = document.getElementById('input-ed-titulo').value.trim();
  if (!novoTitulo) { showToast('Digite um título válido'); return; }

  const valorOriginalRaw = document.getElementById('input-ed-valor-original').value;
  const novoValorOriginal = valorOriginalRaw === '' ? null : parseFloat(valorOriginalRaw);
  if (novoValorOriginal !== null && (isNaN(novoValorOriginal) || novoValorOriginal < 0)) {
    showToast('Digite um valor original válido'); return;
  }

  const { error: errDivida } = await supabaseClient
    .from('dividas')
    .update({ titulo: novoTitulo, valor_original: novoValorOriginal })
    .eq('id', d.id);

  if (errDivida) { showToast('Erro ao salvar dívida: ' + errDivida.message); return; }

  d.titulo = novoTitulo;
  d.valorOriginal = novoValorOriginal;

  if (d.parcelas.length) {
    const novoMesIdx = parseInt(document.getElementById('input-ed-mes-inicial').value, 10);
    const novoAno = parseInt(document.getElementById('input-ed-ano-inicial').value, 10);

    if (!isNaN(novoAno)) {
      const primeira = d.parcelas[0];
      const deltaMeses = (novoAno * 12 + novoMesIdx) - (primeira.ano * 12 + MESES.indexOf(primeira.mes));

      if (deltaMeses !== 0) {
        const atualizacoes = d.parcelas.map(p => {
          const chaveAtual = p.ano * 12 + MESES.indexOf(p.mes) + deltaMeses;
          const novoAnoP = Math.floor(chaveAtual / 12);
          const novoMesP = MESES[chaveAtual % 12];
          return { p, novoAnoP, novoMesP };
        });

        const resultados = await Promise.all(atualizacoes.map(({ p, novoAnoP, novoMesP }) =>
          supabaseClient.from('parcelas').update({ mes: novoMesP, ano: novoAnoP }).eq('id', p.id)
        ));

        const algumErro = resultados.find(r => r.error);
        if (algumErro) { showToast('Erro ao atualizar datas: ' + algumErro.error.message); return; }

        atualizacoes.forEach(({ p, novoAnoP, novoMesP }) => {
          p.ano = novoAnoP;
          p.mes = novoMesP;
        });
        d.parcelas = ordenarParcelas(d.parcelas);
      }
    }
  }

  closeEditDividaModal();
  renderTabs();
  renderContent();
  atualizarBadgeENotificacoes();
  showToast(`Dívida "${d.titulo}" atualizada com sucesso!`);
}

/* ── Listeners globais ── */
document.getElementById('btn-cancelar-modal').addEventListener('click', closeModal);
document.getElementById('btn-criar-divida').addEventListener('click', criarNovaDivida);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') closeModal();
});

document.getElementById('btn-modo-meses').addEventListener('click', () => setModoNovaDivida('meses'));
document.getElementById('btn-modo-total').addEventListener('click', () => setModoNovaDivida('total'));
document.getElementById('input-valor-total').addEventListener('input', atualizarPreviewModoTotal);
document.getElementById('input-valor-mensal').addEventListener('input', atualizarPreviewModoTotal);

document.getElementById('btn-cancelar-edit-parcela').addEventListener('click', closeEditParcelaModal);
document.getElementById('btn-salvar-edit-parcela').addEventListener('click', salvarEdicaoParcela);
document.getElementById('btn-excluir-parcela').addEventListener('click', excluirParcela);
document.getElementById('edit-parcela-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'edit-parcela-overlay') closeEditParcelaModal();
});

document.getElementById('btn-cancelar-add-parcela').addEventListener('click', closeAddParcelaModal);
document.getElementById('btn-salvar-add-parcela').addEventListener('click', salvarNovaParcela);
document.getElementById('add-parcela-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'add-parcela-overlay') closeAddParcelaModal();
});

document.getElementById('btn-cancelar-edit-divida').addEventListener('click', closeEditDividaModal);
document.getElementById('btn-salvar-edit-divida').addEventListener('click', salvarEditDivida);
document.getElementById('edit-divida-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'edit-divida-overlay') closeEditDividaModal();
});

document.getElementById('btn-auth-confirmar').addEventListener('click', handleAuthConfirmar);
document.getElementById('btn-auth-toggle').addEventListener('click', alternarModoAuth);
document.getElementById('btn-logout').addEventListener('click', fazerLogout);
document.getElementById('btn-esqueci-senha').addEventListener('click', () => {
  modoAuth = 'recuperar';
  atualizarTelaAuth();
});
document.getElementById('btn-voltar-login').addEventListener('click', () => {
  modoAuth = 'login';
  atualizarTelaAuth();
});

['auth-email', 'auth-senha', 'auth-nova-senha', 'auth-confirmar-nova-senha'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-auth-confirmar').click();
  });
});

/* ── Perfil ── */
document.getElementById('btn-perfil').addEventListener('click', showPerfilView);
document.getElementById('btn-voltar-dividas').addEventListener('click', showDividasView);
document.getElementById('btn-salvar-perfil').addEventListener('click', salvarPerfil);

/* ── Conta e Segurança ── */
document.getElementById('btn-sair-conta').addEventListener('click', fazerLogout);
document.getElementById('btn-sair-todos-dispositivos').addEventListener('click', sairDeTodosDispositivos);
document.getElementById('btn-alterar-senha').addEventListener('click', alterarSenha);
document.getElementById('btn-exportar-dados').addEventListener('click', exportarDados);
document.getElementById('btn-abrir-exclusao-conta').addEventListener('click', abrirExclusaoConta);
document.getElementById('btn-cancelar-exclusao-conta').addEventListener('click', fecharExclusaoConta);
document.getElementById('btn-confirmar-exclusao-conta').addEventListener('click', confirmarExclusaoConta);
document.getElementById('exclusao-conta-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'exclusao-conta-overlay') fecharExclusaoConta();
});

/* ── Central de Notificações ── */
document.getElementById('btn-notificacoes').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleNotificacoes();
});
document.getElementById('btn-marcar-todas-lidas').addEventListener('click', (e) => {
  e.stopPropagation();
  marcarTodasComoLidas();
});
document.getElementById('notif-panel').addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { if (painelNotificacoesAberto) fecharPainelNotificacoes(); });

/* ── Visão Geral ── */
document.getElementById('btn-geral').addEventListener('click', showGeralView);
document.getElementById('btn-voltar-dividas-geral').addEventListener('click', showDividasView);

/* ── Histórico Financeiro ── */
document.getElementById('btn-historico').addEventListener('click', showHistoricoView);
document.getElementById('btn-voltar-dividas-historico').addEventListener('click', showDividasView);
document.getElementById('btn-fechar-detalhe-historico').addEventListener('click', fecharDetalhePagamento);
document.getElementById('historico-detalhe-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'historico-detalhe-overlay') fecharDetalhePagamento();
});
document.getElementById('btn-editar-parcela-historico').addEventListener('click', () => {
  if (!detalheHistoricoAtual) return;
  const { dividaId, idx } = detalheHistoricoAtual;
  fecharDetalhePagamento();
  openEditParcelaModal(dividaId, idx);
});

/* ── Metas Financeiras ── */
document.getElementById('btn-metas').addEventListener('click', showMetasView);
document.getElementById('btn-voltar-dividas-metas').addEventListener('click', showDividasView);
document.getElementById('btn-nova-meta').addEventListener('click', () => openMetaModal());
document.getElementById('btn-cancelar-meta').addEventListener('click', closeMetaModal);
document.getElementById('btn-salvar-meta').addEventListener('click', salvarMeta);
document.getElementById('meta-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'meta-overlay') closeMetaModal();
});
document.getElementById('btn-meta-tipo-livre').addEventListener('click', () => setTipoMetaModal('livre'));
document.getElementById('btn-meta-tipo-divida').addEventListener('click', () => setTipoMetaModal('divida'));
document.getElementById('select-meta-divida').addEventListener('change', atualizarPreviewMetaDivida);
document.getElementById('select-meta-categoria').addEventListener('change', (e) => {
  const inputOutra = document.getElementById('input-meta-categoria-outra');
  inputOutra.style.display = e.target.value === 'outra' ? 'block' : 'none';
  if (e.target.value === 'outra') inputOutra.focus();
});

/* ── Receitas e Despesas (Lançamentos) ── */
document.getElementById('btn-lancamentos').addEventListener('click', showLancamentosView);
document.getElementById('btn-voltar-dividas-lancamentos').addEventListener('click', showDividasView);
document.getElementById('btn-novo-lancamento').addEventListener('click', () => openLancamentoModal());
document.getElementById('btn-cancelar-lancamento').addEventListener('click', closeLancamentoModal);
document.getElementById('btn-salvar-lancamento').addEventListener('click', salvarLancamento);
document.getElementById('lancamento-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'lancamento-overlay') closeLancamentoModal();
});
document.getElementById('btn-lanc-tipo-receita').addEventListener('click', () => setTipoLancamentoModal('receita'));
document.getElementById('btn-lanc-tipo-despesa').addEventListener('click', () => setTipoLancamentoModal('despesa'));

document.getElementById('select-perfil-profissao').addEventListener('change', (e) => {
  const inputOutra = document.getElementById('input-perfil-profissao-outra');
  inputOutra.style.display = e.target.value === '__outra__' ? 'block' : 'none';
  if (e.target.value === '__outra__') inputOutra.focus();
});

document.getElementById('btn-trocar-foto').addEventListener('click', () => {
  document.getElementById('input-foto-perfil').click();
});

document.getElementById('input-foto-perfil').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Selecione um arquivo de imagem'); return; }

  try {
    const dataUrl = await redimensionarImagem(file);
    fotoPerfilPendente = dataUrl;
    atualizarAvatarPreview(dataUrl);
  } catch {
    showToast('Não foi possível processar a imagem');
  }
  e.target.value = '';
});

/* ============================================================
   ONBOARDING + PRIMEIROS PASSOS
   ============================================================
   Reaproveita openModal / openLancamentoModal / openMetaModal e o
   campo `salario` do perfil. Estado guardado em `perfis`:
   onboarding_concluido e primeiros_passos_oculto (ver SQL).
   ============================================================ */

/* sobra do mês = salário + receitas extras − parcelas − despesas (fixas incluídas) */
function calcSobraMes(salario, parcelasMes) {
  const { mesIdx, ano } = hojeInfo();
  const f = calcFluxoCaixaMes(ano, mesIdx);
  return salario + f.receitas - parcelasMes - f.despesas;
}

const OB = { passo: 1, objetivo: null, temDivida: null, timer: null, base: null };
const OB_TOTAL = 4;
const OB_OBJETIVOS = ['Quitar dívidas', 'Organizar receitas e despesas', 'Controlar meu orçamento', 'Acompanhar tudo'];

async function salvarFlagsPerfil(flags) {
  if (!currentUser) return;
  const { data, error } = await supabaseClient
    .from('perfis').upsert({ user_id: currentUser.id, ...flags }, { onConflict: 'user_id' }).select().single();
  if (error) { showToast('Não foi possível salvar: ' + error.message); return false; }
  perfilAtual = data;
  return true;
}

function deveMostrarOnboarding() {
  return !perfilAtual?.onboarding_concluido && !dividas.length && !lancamentos.length
    && !metas.length && !(perfilAtual?.salario > 0);
}

function obContagens() {
  return {
    dividas: dividas.length - OB.base.dividas,
    despesas: lancamentos.filter(l => l.tipo === 'despesa' && l.recorrente).length - OB.base.despesas,
  };
}

function abrirOnboarding() {
  if (document.getElementById('ob-overlay')) return;
  Object.assign(OB, { passo: 1, objetivo: null, temDivida: null, novoPasso: true,
    base: { dividas: dividas.length, despesas: lancamentos.filter(l => l.tipo === 'despesa' && l.recorrente).length } });
  const ov = document.createElement('div');
  ov.id = 'ob-overlay'; ov.className = 'ob-overlay';
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  document.body.appendChild(ov);
  ov.addEventListener('click', obClique);
  OB.timer = setInterval(obAtualizarContagem, 500);
  renderOnboarding();
}

function fecharOnboardingUI() {
  clearInterval(OB.timer);
  sairSuave(document.getElementById('ob-overlay'), 'ob-saindo');
}

function obTextoContagem(n, singular, plural, vazio) {
  return n > 0 ? `✓ ${n} ${n === 1 ? singular : plural}` : vazio;
}

function obAtualizarContagem() {
  const el = document.getElementById('ob-contagem');
  if (!el || !OB.base) return;
  const c = obContagens();
  el.textContent = OB.passo === 2
    ? obTextoContagem(c.dividas, 'dívida adicionada', 'dívidas adicionadas', '')
    : obTextoContagem(c.despesas, 'despesa fixa adicionada', 'despesas fixas adicionadas', '');
}

function renderOnboarding() {
  const ov = document.getElementById('ob-overlay');
  if (!ov) return;
  const p = OB.passo;
  let corpo = '', titulo = '', dica = '';

  if (p === 1) {
    titulo = 'Qual é o seu principal objetivo?';
    corpo = `<div class="ob-opcoes">${OB_OBJETIVOS.map(o =>
      `<button class="ob-opcao ${OB.objetivo === o ? 'ativa' : ''}" data-ob="objetivo" data-v="${o}">${o}</button>`).join('')}</div>`;
  } else if (p === 2) {
    titulo = 'Você possui dívidas?';
    corpo = `<div class="ob-opcoes ob-duas">
        <button class="ob-opcao ${OB.temDivida === true ? 'ativa' : ''}" data-ob="divida" data-v="1">Sim</button>
        <button class="ob-opcao ${OB.temDivida === false ? 'ativa' : ''}" data-ob="divida" data-v="0">Não</button></div>
      ${OB.temDivida ? `<button class="btn-primary ob-acao" data-ob="nova-divida">+ Cadastrar minha dívida</button>` : ''}
      <div class="ob-contagem" id="ob-contagem"></div>`;
  } else if (p === 3) {
    titulo = 'Qual é a sua renda mensal?';
    dica = 'Usamos para mostrar quanto sobra depois das parcelas e das despesas. Você pode pular.';
    corpo = `<label class="modal-label" for="ob-salario">Salário ou renda fixa (R$)</label>
      <input type="number" id="ob-salario" class="modal-input" inputmode="decimal" min="0" step="0.01"
        placeholder="Ex: 3000" value="${perfilAtual?.salario ?? ''}" />`;
  } else if (p === 4) {
    titulo = 'Quais são suas despesas fixas?';
    dica = 'Contas que se repetem todo mês, como internet e plano de saúde. Ficam separadas das dívidas: dívida acaba, despesa fixa continua.';
    corpo = `<button class="btn-primary ob-acao" data-ob="nova-despesa">+ Adicionar despesa fixa</button>
      <div class="ob-contagem" id="ob-contagem"></div>`;
  } else {
    const c = obContagens(), renda = perfilAtual?.salario > 0;
    const linha = (ok, sim, nao) => `<li class="${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${ok ? sim : nao}</li>`;
    titulo = '🎉 Tudo pronto!';
    dica = 'Seu painel financeiro está preparado.';
    corpo = `<ul class="ob-resumo">
        ${linha(c.dividas > 0, obTextoContagem(c.dividas, 'dívida adicionada', 'dívidas adicionadas', '').slice(2), 'Nenhuma dívida adicionada')}
        ${linha(renda, 'Renda mensal informada', 'Renda mensal não informada')}
        ${linha(c.despesas > 0, obTextoContagem(c.despesas, 'despesa fixa adicionada', 'despesas fixas adicionadas', '').slice(2), 'Nenhuma despesa fixa adicionada')}
      </ul>`;
  }

  const final = p > OB_TOTAL;
  ov.innerHTML = `<div class="ob-card${OB.novoPasso ? ' ob-entra' : ''}">
    ${final ? '' : `<div class="ob-topo"><span class="ob-passo">Passo ${p} de ${OB_TOTAL}</span>
      <button class="ob-pular" data-ob="pular">Pular por enquanto</button></div>
      <div class="ob-barra"><div class="ob-barra-fill" style="width:${(p / OB_TOTAL) * 100}%"></div></div>`}
    ${p === 1 ? `<div class="ob-boas-vindas">👋 Bem-vindo ao Arruda's Finance!<br><small>Vamos configurar sua vida financeira em poucos passos.</small></div>` : ''}
    <h2 class="ob-titulo">${titulo}</h2>
    ${dica ? `<p class="ob-dica">${dica}</p>` : ''}
    <div class="ob-corpo">${corpo}</div>
    <div class="ob-rodape">
      ${final ? `<button class="btn-primary" data-ob="concluir">Começar a usar o Arruda's Finance</button>` : `
        <button class="btn-secondary" data-ob="voltar" ${p === 1 ? 'style="visibility:hidden"' : ''}>Voltar</button>
        <button class="btn-primary" data-ob="avancar">${p === OB_TOTAL ? 'Finalizar' : 'Continuar'}</button>`}
    </div></div>`;
  OB.novoPasso = false;
  obAtualizarContagem();
}

async function obClique(e) {
  const b = e.target.closest('[data-ob]');
  if (!b) return;
  const acao = b.dataset.ob;
  if (acao === 'objetivo') { OB.objetivo = b.dataset.v; renderOnboarding(); }
  else if (acao === 'divida') { OB.temDivida = b.dataset.v === '1'; renderOnboarding(); }
  else if (acao === 'nova-divida') openModal();
  else if (acao === 'nova-despesa') {
    openLancamentoModal();
    setTipoLancamentoModal('despesa');
    document.getElementById('input-lanc-recorrente').checked = true;
  }
  else if (acao === 'voltar') { OB.passo--; OB.novoPasso = true; renderOnboarding(); }
  else if (acao === 'avancar') {
    if (OB.passo === 3) {
      const v = document.getElementById('ob-salario').value;
      const n = v === '' ? null : parseFloat(v);
      if (n !== null && (isNaN(n) || n < 0)) { showToast('Digite um valor válido'); return; }
      if (n !== null && n !== perfilAtual?.salario && !(await salvarFlagsPerfil({ salario: n }))) return;
    }
    OB.passo++; OB.novoPasso = true; renderOnboarding();
  }
  else if (acao === 'pular') {
    await salvarFlagsPerfil({ onboarding_concluido: true });
    fecharOnboardingUI();
    refreshViewAtual();
  }
  else if (acao === 'concluir') {
    await salvarFlagsPerfil({ onboarding_concluido: true });
    fecharOnboardingUI();
    showGeralView();
  }
}

/* ── Checklist "Primeiros passos" (estado real do sistema) ── */
function primeirosPassosHtml() {
  if (!perfilAtual?.onboarding_concluido || perfilAtual.primeiros_passos_oculto) return '';
  const itens = [
    { ok: dividas.length > 0, txt: 'Criar primeira dívida', acao: 'divida' },
    { ok: perfilAtual.salario > 0 || lancamentos.some(l => l.tipo === 'receita'), txt: 'Informar sua renda mensal', acao: 'renda' },
    { ok: metas.length > 0, txt: 'Criar primeira meta', acao: 'meta' },
  ];
  const feitos = itens.filter(i => i.ok).length;
  const tudo = feitos === itens.length;
  return `<div class="pp-card${tudo ? ' pp-compacto' : ''}" id="primeiros-passos">
    <div class="pp-topo"><div class="pp-titulo">🚀 Primeiros passos</div>
      <button class="pp-fechar" data-pp="fechar" aria-label="Fechar primeiros passos" title="Fechar">✕</button></div>
    <div class="pp-sub">${tudo ? '🎉 Você completou todos os primeiros passos!' : `${feitos} de ${itens.length} concluídos`}</div>
    <div class="pp-barra"><div class="pp-barra-fill" style="width:${(feitos / itens.length) * 100}%"></div></div>
    <div class="pp-lista">${itens.map(i =>
      `<button class="pp-item ${i.ok ? 'ok' : ''}" data-pp="${i.acao}" ${i.ok ? 'disabled' : ''}>
        <span class="pp-check">${i.ok ? '✓' : ''}</span>${i.txt}</button>`).join('')}</div></div>`;
}

const _renderVisaoGeralBase = renderVisaoGeral;
renderVisaoGeral = function () {
  _renderVisaoGeralBase();
  const html = primeirosPassosHtml();
  if (html) document.getElementById('geral-content').insertAdjacentHTML('afterbegin', html);
};

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pp]');
  if (!b) return;
  const a = b.dataset.pp;
  if (a === 'fechar') { if (await salvarFlagsPerfil({ primeiros_passos_oculto: true })) sairSuave(document.getElementById('primeiros-passos')); }
  else if (a === 'divida') { showDividasView(); openModal(); }
  else if (a === 'renda') showPerfilView();
  else if (a === 'meta') { showMetasView(); openMetaModal(); }
});

const _iniciarAppBase = iniciarApp;
iniciarApp = async function () {
  await _iniciarAppBase();
  if (deveMostrarOnboarding()) abrirOnboarding();
};

supabaseClient.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') fecharOnboardingUI(); });

/* ============================================================
   REFINO VISUAL — painel, navegação mobile e carregamento
   (só apresentação: nenhum cálculo ou dado é alterado)
   ============================================================ */
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const G_METADE = new Set(['saldo', 'saude', 'cmp', 'evol', 'proximos', 'criticas', 'distrib', 'previsao']);
const brl = v => 'R$ ' + v.toLocaleString('pt-BR');

/* blocos novos, só de leitura — usam as mesmas funções de cálculo do resto do app */
function blocosCommandCenter() {
  const { mesIdx, ano } = hojeInfo();
  const f = calcFluxoCaixaMes(ano, mesIdx);
  const saidas = f.despesas + f.dividasPagas, total = f.receitas + saidas;
  const cmp = `<div class="cc-painel" data-bloco="cmp"><div class="cc-painel-titulo">Entradas × saídas do mês</div>${
    total > 0 ? `<div class="cc-cmp-barra"><i class="ent" style="width:${(f.receitas / total) * 100}%"></i><i class="sai" style="width:${(saidas / total) * 100}%"></i></div>
      <div class="cc-cmp-leg"><span class="pos">Entradas ${brl(f.receitas)}</span><span class="neg">Saídas ${brl(saidas)}</span></div>
      <div class="cc-cmp-nota">Saídas = despesas + parcelas pagas</div>` : '<div class="at-vazio">Sem movimentações neste mês.</div>'}</div>`;

  const ev = calcEvolucaoSaldo(6);
  const maxV = Math.max(1, ...ev.map(m => Math.max(m.receitas, m.despesas + m.dividasPagas)));
  const temEv = ev.some(m => m.receitas || m.despesas || m.dividasPagas);
  const evol = `<div class="cc-painel" data-bloco="evol"><div class="cc-painel-titulo">Evolução dos últimos 6 meses</div>${
    temEv ? `<div class="cc-evol">${ev.map(m => `<div class="cc-evol-col" title="${MESES[m.mesIdx]}/${m.ano}: saldo ${brl(m.saldo)}">
        <div class="cc-evol-barras"><i class="b ent" style="height:${(m.receitas / maxV) * 100}%"></i><i class="b sai" style="height:${((m.despesas + m.dividasPagas) / maxV) * 100}%"></i></div>
        <span class="cc-evol-mes">${MESES[m.mesIdx].slice(0, 3)}</span>
        <span class="cc-evol-saldo ${m.saldo >= 0 ? 'pos' : 'neg'}">${m.saldo >= 0 ? '+' : '−'}${Math.abs(m.saldo).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span></div>`).join('')}</div>
      <div class="cc-cmp-leg"><span class="pos">Entradas</span><span class="neg">Saídas</span></div>` : '<div class="at-vazio">Ainda sem histórico de movimentações.</div>'}</div>`;

  const alertas = gerarNotificacoes().slice(0, 3);
  const atencao = `<div class="at-card" data-bloco="atencao">${alertas.length
    ? alertas.map(n => `<div class="at-item ${n.cor}"><span>${n.icone}</span><div><b>${n.titulo}</b><small>${n.subtitulo}</small></div></div>`).join('')
    : '<div class="at-vazio">Nenhum alerta no momento. Tudo em dia. ✓</div>'}</div>`;

  const abertas = metas.map(m => { const p = calcMetaProgresso(m); return { m, p, s: calcMetaStatus(m, p) }; })
    .filter(x => x.p.pct < 100).sort((a, b) => b.p.pct - a.p.pct).slice(0, 4);
  const metasHtml = `<div class="at-card" data-bloco="metas">${abertas.length ? abertas.map(x => `
    <div class="at-meta ${x.s.cor}"><div class="at-meta-topo"><b>${escHtml(x.m.nome)}</b><span>${x.p.pct}%</span></div>
      <div class="progress-bar-wrap" style="height:8px;margin:0;"><div class="progress-bar-fill" style="width:${x.p.pct}%"></div></div>
      <div class="at-meta-sub"><span>${brl(x.p.atual)} de ${brl(x.p.objetivo)}</span><span>${x.s.icone} ${x.s.label}</span></div></div>`).join('')
    : '<div class="at-vazio">Nenhuma meta em andamento. Crie uma em Metas.</div>'}</div>`;
  return cmp + evol + atencao + metasHtml;
}

/* reagrupa os blocos que o renderVisaoGeral já montou em seções com hierarquia clara.
   Os elementos são movidos (não recriados), então IDs e listeners continuam valendo. */
function organizarVisaoGeral() {
  const c = document.getElementById('geral-content');
  c.classList.remove('cc-layout');
  if (!c.querySelector('.geral-section-header')) return;
  c.insertAdjacentHTML('beforeend', blocosCommandCenter());

  const mapa = {}, sobras = [];
  let anterior = null, viuSaude = false;
  [...c.children].forEach(el => {
    const t = el.classList.contains('section-title') ? el.textContent
      : (el.querySelector(':scope > .section-title, :scope > .geral-section-header .section-title')?.textContent || '');
    let k = null;
    if (el.id === 'primeiros-passos') k = 'pp';
    else if (el.dataset.bloco) k = el.dataset.bloco;
    else if (el.classList.contains('geral-section-header') && t.includes('Fluxo')) k = 'fluxo-h';
    else if (anterior === 'fluxo-h') k = 'fluxo-g';
    else if (t.includes('Progresso Geral')) k = 'quitacao';
    else if (t.includes('Resumo Financeiro')) k = 'resumo-t';
    else if (anterior === 'resumo-t') k = 'resumo-g';
    else if (t.trim() === 'Indicadores') k = 'ind-t';
    else if (anterior === 'ind-t') k = 'ind-g';
    else if (el.classList.contains('indicadores-grid')) k = 'ind';
    else if (t.includes('Próximos Pagamentos')) k = 'proximos';
    else if (t.includes('Mais Críticas')) k = 'criticas';
    else if (el.classList.contains('quitadas-resumo')) k = 'quitadas';
    else if (t.includes('Distribuição')) k = 'distrib';
    else if (t.includes('Previsão dos')) k = 'previsao';
    else if (!viuSaude) { k = 'saude'; viuSaude = true; }
    anterior = k;
    el.dataset.bloco = k || '';
    el.classList.toggle('g-half', G_METADE.has(k));
    if (k) mapa[k] = el; else sobras.push(el);
  });

  /* o Saldo do Mês sobe do bloco de fluxo para a Visão atual */
  const saldoCard = mapa['fluxo-g'] && [...mapa['fluxo-g'].children].find(x => x.querySelector('.stat-label')?.textContent.includes('Saldo do Mês'));
  if (saldoCard) {
    const w = document.createElement('div');
    w.className = 'cc-saldo g-half'; w.dataset.bloco = 'saldo';
    w.appendChild(saldoCard); mapa.saldo = w;
  }

  const prog = metas.map(calcMetaProgresso);
  const acumulado = prog.reduce((s, p) => s + p.atual, 0), concluidas = prog.filter(p => p.pct >= 100).length;
  const secoes = [
    ['visao', 'Visão atual', 'Como você está neste momento', ['saldo', 'saude']],
    ['fluxo', 'Entradas e saídas', 'Quanto entrou, quanto saiu e como isso evoluiu', ['fluxo-h', 'fluxo-g', 'cmp', 'evol']],
    ['compromissos', 'Compromissos', 'Dívidas, parcelas e vencimentos', ['resumo-t', 'resumo-g', 'quitacao', 'proximos', 'criticas', 'distrib', 'previsao']],
    ['alertas', 'Alertas', 'O que precisa da sua atenção agora', ['atencao']],
    ['metas', 'Metas', metas.length ? `${concluidas} de ${metas.length} concluídas · ${brl(acumulado)} acumulados` : 'Seus objetivos financeiros', ['metas']],
    ['historico', 'Indicadores e histórico', 'Visão geral da sua evolução', ['ind-t', 'ind-g', 'ind', 'quitadas']],
  ];
  const frag = document.createDocumentFragment();
  if (mapa.pp) frag.appendChild(mapa.pp);
  secoes.forEach(([id, titulo, sub, chaves]) => {
    const itens = chaves.map(k => mapa[k]).filter(Boolean);
    if (id === 'historico') itens.push(...sobras);
    if (!itens.length) return;
    const sec = document.createElement('section');
    sec.className = 'cc-secao';
    sec.innerHTML = `<header class="cc-cab"><h2>${titulo}</h2><p>${sub}</p></header><div class="cc-corpo"></div>`;
    itens.forEach(i => sec.querySelector('.cc-corpo').appendChild(i));
    frag.appendChild(sec);
  });
  c.replaceChildren(frag);
  c.classList.add('cc-layout');
}

const _renderVisaoGeralComPP = renderVisaoGeral;
renderVisaoGeral = function () { _renderVisaoGeralComPP(); organizarVisaoGeral(); };

/* esqueleto enquanto os dados carregam */
const _iniciarAppComOB = iniciarApp;
iniciarApp = async function () {
  const alvo = document.getElementById('app-content');
  if (alvo) alvo.innerHTML = '<div class="sk sk-h"></div><div class="sk-grid"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>';
  await _iniciarAppComOB();
};

/* barra de navegação do celular — aciona os botões que já existem */
(function () {
  const nav = document.getElementById('bnav'), mais = document.getElementById('bnav-mais');
  if (!nav || !mais) return;
  const views = { geral: 'view-geral', dividas: 'view-dividas', lancamentos: 'view-lancamentos', metas: 'view-metas' };
  nav.addEventListener('click', e => {
    const b = e.target.closest('[data-nav]'); if (!b) return;
    const a = b.dataset.nav;
    if (a === 'mais') { mais.classList.toggle('show'); return; }
    mais.classList.remove('show');
    if (a === 'dividas') showDividasView(); else document.getElementById('btn-' + a)?.click();
  });
  mais.addEventListener('click', e => {
    const b = e.target.closest('[data-nav]'); if (!b) return;
    mais.classList.remove('show');
    document.getElementById('btn-' + b.dataset.nav)?.click();
  });
  const _mostrarViewBase = mostrarView;
  mostrarView = function (id) {
    _mostrarViewBase(id);
    nav.querySelectorAll('[data-nav]').forEach(b => {
      const v = views[b.dataset.nav];
      b.classList.toggle('ativo', v ? v === id : (b.dataset.nav === 'mais' && ['view-historico', 'view-perfil'].includes(id)));
    });
    const topo = { 'view-geral': 'btn-geral', 'view-lancamentos': 'btn-lancamentos', 'view-historico': 'btn-historico', 'view-metas': 'btn-metas', 'view-perfil': 'btn-perfil' };
    Object.values(topo).forEach(bid => {   /* item ativo também no menu do topo (desktop/tablet) */
      const el = document.getElementById(bid); if (!el) return;
      const ativo = topo[id] === bid;
      el.classList.toggle('ativo', ativo); ativo ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current');
    });
  };
})();

/* ============================================================
   MICROINTERAÇÕES — feedback de estado (nenhuma lógica financeira)
   ============================================================ */
const BTN_SALVAR = '#btn-criar-divida,#btn-salvar-edit-parcela,#btn-salvar-add-parcela,#btn-salvar-edit-divida,#btn-salvar-perfil,#btn-salvar-meta,#btn-salvar-lancamento';
function limparOcupado() {
  document.querySelectorAll('.is-loading').forEach(b => { b.classList.remove('is-loading'); b.removeAttribute('aria-busy'); });
}
/* botão de salvar mostra "salvando" até o app responder (toast) ou por no máximo 3s */
document.addEventListener('click', e => {
  const b = e.target.closest(BTN_SALVAR);
  if (!b || b.classList.contains('is-loading')) return;
  b.classList.add('is-loading'); b.setAttribute('aria-busy', 'true');
  setTimeout(limparOcupado, 3000);
}, true);

/* toast: erro × sucesso, leitura por leitor de tela e tempo maior para erros */
document.getElementById('toast')?.setAttribute('role', 'status');
const _showToastBase = showToast;
showToast = function (msg) {
  _showToastBase(msg);
  limparOcupado();
  const t = document.getElementById('toast');
  const erro = /^(erro|não foi possível|inválid|digite|preencha|informe|selecione|escolha)/i.test(String(msg).trim());
  t.classList.toggle('erro', erro);
  t.setAttribute('role', erro ? 'alert' : 'status');
  if (erro) { clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4800); }
};

/* meta atingida: destaque único no cartão + aviso (a 1ª renderização só registra o ponto de partida) */
const _pctMetas = new Map();
const _renderMetasBase = renderMetas;
renderMetas = function () {
  _renderMetasBase();
  metas.forEach(m => {
    const pct = calcMetaProgresso(m).pct, antes = _pctMetas.get(m.id);
    if (antes !== undefined && antes < 100 && pct >= 100) {
      document.querySelector(`.meta-card[data-id="${m.id}"]`)?.classList.add('meta-conquistada');
      showToast('🎯 Meta atingida: ' + m.nome);
    }
    /* progresso que aumentou (editar valor, pagar parcela de meta vinculada): a barra avança do ponto anterior ao novo */
    const barra = document.querySelector(`.meta-card[data-id="${m.id}"] .progress-bar-fill`);
    if (barra && barra.animate && antes !== undefined && pct > antes && pct > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const dur = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-slow')) || 0.45) * 1500;
      barra.animate([{ clipPath: `inset(0 ${(1 - antes / pct) * 100}% 0 0 round 100px)` }, { clipPath: 'inset(0 0 0 0 round 100px)' }],
        { duration: dur, delay: 80, easing: 'cubic-bezier(.215,.61,.355,1)', fill: 'backwards' });
    }
    _pctMetas.set(m.id, pct);
  });
};

/* Esc fecha o modal do topo (mesmo caminho do clique no fundo) e o painel de notificações; menu "Mais" fecha ao tocar fora */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const abertos = document.querySelectorAll('.modal-overlay.show');
  abertos[abertos.length - 1]?.click();
  if (painelNotificacoesAberto) fecharPainelNotificacoes();
  document.getElementById('fab-menu')?.classList.remove('show');
  document.getElementById('fab')?.setAttribute('aria-expanded', 'false');
  document.getElementById('bnav-mais')?.classList.remove('show');
});
document.addEventListener('click', e => {
  if (!e.target.closest('#bnav, #bnav-mais')) document.getElementById('bnav-mais')?.classList.remove('show');
});

/* ============================================================
   MOBILE — ações rápidas "+" e teclado virtual (reusa os modais existentes)
   ============================================================ */
(function () {
  const fab = document.getElementById('fab'), menu = document.getElementById('fab-menu');
  if (!fab || !menu) return;
  const abrir = { lancamento: () => openLancamentoModal(), divida: () => openModal(), meta: () => openMetaModal() };
  const alternar = (aberto) => { menu.classList.toggle('show', aberto); fab.setAttribute('aria-expanded', String(aberto)); };
  fab.addEventListener('click', () => { document.getElementById('bnav-mais')?.classList.remove('show'); alternar(!menu.classList.contains('show')); });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-fab]'); if (!b) return;
    alternar(false); abrir[b.dataset.fab]();
  });
  document.addEventListener('click', e => { if (!e.target.closest('#fab, #fab-menu')) alternar(false); });
  /* campo focado fica visível acima do teclado virtual */
  document.addEventListener('focusin', e => {
    if (!e.target.closest('.modal') || !matchMedia('(max-width: 720px)').matches) return;
    setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 250);
  });
})();

/* ============================================================
   MOTION EM LISTAS — realce de item novo e saída suave de item excluído
   (envolve os render existentes; não altera dados nem cálculos)
   ============================================================ */
let _excluindo = false;
const _idItem = el => el.dataset.id || el.querySelector('[data-id]')?.dataset.id;
function envolverLista(nome, seletor) {
  const base = window[nome];
  window[nome] = function () {
    const antes = [...document.querySelectorAll(seletor)].map(el => ({
      id: _idItem(el), html: el.outerHTML, pai: el.parentElement, raiz: el.closest('[id]'), classe: el.parentElement.classList[0],
      prox: el.nextElementSibling && _idItem(el.nextElementSibling), ant: el.previousElementSibling && _idItem(el.previousElementSibling) }));
    base.apply(this, arguments);
    if (!antes.length) return;
    const ids = new Set(antes.map(x => x.id)), agora = [...document.querySelectorAll(seletor)];
    agora.forEach(el => { if (!ids.has(_idItem(el))) el.classList.add('item-novo'); });
    if (!_excluindo) return;
    const presentes = new Set(agora.map(_idItem));
    antes.filter(x => !presentes.has(x.id)).forEach(x => {
      let pai = x.pai, ref = null;
      const vizinho = id => id && agora.find(e => _idItem(e) === id);
      if (vizinho(x.prox)) { ref = vizinho(x.prox); pai = ref.parentElement; }
      else if (vizinho(x.ant)) { const a = vizinho(x.ant); pai = a.parentElement; ref = a.nextElementSibling; }
      else if (!pai.isConnected) pai = x.raiz?.isConnected ? (x.classe && x.raiz.querySelector('.' + x.classe)) || x.raiz : null;
      if (!pai) return;
      const t = document.createElement('template'); t.innerHTML = x.html;
      const g = t.content.firstElementChild; g.classList.add('item-saindo'); g.removeAttribute('data-id');
      pai.insertBefore(g, ref || null);
      g.addEventListener('animationend', () => g.remove()); setTimeout(() => g.remove(), 600);
    });
  };
}
envolverLista('renderMetas', '.meta-card');
envolverLista('renderLancamentos', '.lanc-item');
['excluirMeta', 'excluirLancamento'].forEach(nome => {
  const base = window[nome];
  window[nome] = async function () { _excluindo = true; try { return await base.apply(this, arguments); } finally { _excluindo = false; } };
});

/* ============================================================
   TRANSIÇÕES — telas, abas e sobreposições (só apresentação)
   Envolvem as funções existentes; roteamento, autenticação e dados não mudam.
   ============================================================ */
const _reduzMov = matchMedia('(prefers-reduced-motion: reduce)');
const _podeVT = () => 'startViewTransition' in document && !_reduzMov.matches;
const _raiz = document.documentElement;
_raiz.classList.toggle('vt-on', _podeVT());
_reduzMov.addEventListener?.('change', () => _raiz.classList.toggle('vt-on', _podeVT()));

/* some com fade e só então remove do DOM (sem atraso para o usuário: o elemento já é inerte) */
function sairSuave(el, classe = 'saindo-suave') {
  if (!el) return;
  if (_reduzMov.matches) { el.remove(); return; }
  el.classList.add(classe);
  setTimeout(() => el.remove(), 200);
}

/* telas: cross-fade com deslocamento na direção da navegação (Dívidas → Geral → Lançamentos → Histórico → Metas → Perfil) */
const _ORDEM_TELAS = ['view-dividas', 'view-geral', 'view-lancamentos', 'view-historico', 'view-metas', 'view-perfil'];
let _vtAtual = null;
const _ndVT = (nome, el) => el && el.style.setProperty('view-transition-name', nome);
const _mostrarViewSemVT = mostrarView;
mostrarView = function (id) {
  const antigo = TODAS_AS_VIEWS.map(v => document.getElementById(v)).find(e => e && e.style.display === 'block');
  if (!_podeVT() || !antigo || antigo.id === id) return _mostrarViewSemVT.apply(this, arguments);
  _vtAtual?.skipTransition();                                   // navegação rápida: conclui a anterior antes de começar outra
  const self = this, args = arguments;
  _raiz.style.setProperty('--vt-x', Math.sign(_ORDEM_TELAS.indexOf(id) - _ORDEM_TELAS.indexOf(antigo.id)) || 1);
  _ndVT('vt-tela', antigo);
  const t = _vtAtual = document.startViewTransition(() => {
    _ndVT('', antigo);
    _mostrarViewSemVT.apply(self, args);
    _ndVT('vt-tela', document.getElementById(id));
  });
  const fim = () => { _ndVT('', antigo); _ndVT('', document.getElementById(id)); if (_vtAtual === t) _vtAtual = null; };
  t.finished.then(fim, fim);
};

/* login ↔ app: cross-fade só quando a tela realmente muda */
[['showAppScreen', 'app-screen'], ['showAuthScreen', 'auth-screen']].forEach(([nome, alvo]) => {
  const base = window[nome];
  window[nome] = function () {
    const self = this, args = arguments;
    const jaVisivel = document.getElementById(alvo).classList.contains('show');
    const algumaVisivel = document.querySelector('#auth-screen.show, #app-screen.show');
    if (!_podeVT() || jaVisivel || !algumaVisivel) return base.apply(self, args);
    _vtAtual?.skipTransition();
    const t = _vtAtual = document.startViewTransition(() => { base.apply(self, args); });
    const fim = () => { if (_vtAtual === t) _vtAtual = null; };
    t.finished.then(fim, fim);
  };
});

/* abas de dívidas: só quando a aba mudou (atualizar a mesma aba não anima) */
let _abaVista = null;
const _renderContentBase = renderContent;
renderContent = function () {
  const mudou = _abaVista !== null && _abaVista !== activeTabId;
  _renderContentBase.apply(this, arguments);
  _abaVista = activeTabId;
  const c = document.getElementById('app-content');
  if (mudou && c && !_reduzMov.matches) {
    c.classList.remove('aba-troca'); void c.offsetWidth; c.classList.add('aba-troca');
    setTimeout(() => c.classList.remove('aba-troca'), 400);
  }
};

/* ── Início ── */
checkSession();