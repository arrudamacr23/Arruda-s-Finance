/* ============================================================
   ARRUDA'S FINANCE — múltiplas dívidas, abas, quitadas e Supabase
   ============================================================ */

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const CIRC  = 2 * Math.PI * 55;

let dividas = [];
let activeTabId = null;
let currentUser = null;
let perfilAtual = null; // { telefone, profissao, salario, foto_base64 }

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

let modoAuth = 'login'; // 'login' | 'cadastro'

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
  if (event === 'SIGNED_IN' && session) {
    currentUser = session.user;
    showAppScreen();
    iniciarApp();
  } else if (event === 'SIGNED_OUT') {
    currentUser = null;
    dividas = [];
    activeTabId = null;
    perfilAtual = null;
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
  await loadPerfil();
  activeTabId = dividas.length ? dividas[0].id : null;
  renderTabs();
  renderContent();
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
  document.getElementById('perfil-email-label').textContent = currentUser?.email || '';
  document.getElementById('input-perfil-telefone').value = perfilAtual?.telefone || '';
  document.getElementById('input-perfil-salario').value = perfilAtual?.salario ?? '';
  preencherSelectProfissoes(perfilAtual?.profissao || '');

  fotoPerfilPendente = undefined;
  atualizarAvatarPreview(perfilAtual?.foto_base64 || null);
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

    const sobra = salario - parcelasMes;
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

/* dispara (ou reinicia) a animação de entrada de uma view */
function fadeInView(el) {
  el.classList.remove('view-fade-in');
  void el.offsetWidth; // força reflow pra reiniciar a animação
  el.classList.add('view-fade-in');
}

function showDividasView() {
  document.getElementById('view-dividas').style.display = 'block';
  document.getElementById('view-perfil').style.display = 'none';
  document.getElementById('view-geral').style.display = 'none';
  fadeInView(document.getElementById('view-dividas'));
}

function showPerfilView() {
  document.getElementById('view-dividas').style.display = 'none';
  document.getElementById('view-perfil').style.display = 'block';
  document.getElementById('view-geral').style.display = 'none';
  renderPerfilForm();
  renderResumoFinanceiro();
  fadeInView(document.getElementById('view-perfil'));
}

function showGeralView() {
  document.getElementById('view-dividas').style.display = 'none';
  document.getElementById('view-perfil').style.display = 'none';
  document.getElementById('view-geral').style.display = 'block';
  renderVisaoGeral();
  fadeInView(document.getElementById('view-geral'));
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

  if (!dividas.length) {
    container.innerHTML = emptyStateHtml({
      icon: '📊',
      title: 'Nenhuma dívida cadastrada ainda',
      subtitle: 'Cadastre sua primeira dívida na aba "Dívidas" pra começar a ver seu painel completo aqui.',
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

  /* ── Cabeçalho: banner de saúde financeira, ou CTA para cadastrar salário ── */
  let saudeHtml;
  if (temSalario) {
    const sobra = salario - parcelasMes;
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
    card.style.animation = `fadeUp .5s ease ${0.35 + i * 0.05}s both`;

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

/* ── Perfil ── */
document.getElementById('btn-perfil').addEventListener('click', showPerfilView);
document.getElementById('btn-voltar-dividas').addEventListener('click', showDividasView);
document.getElementById('btn-salvar-perfil').addEventListener('click', salvarPerfil);

/* ── Visão Geral ── */
document.getElementById('btn-geral').addEventListener('click', showGeralView);
document.getElementById('btn-voltar-dividas-geral').addEventListener('click', showDividasView);

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

/* ── Início ── */
checkSession();