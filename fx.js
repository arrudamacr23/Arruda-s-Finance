/* ============================================================
   FxCount — contagem progressiva para valores financeiros
   ============================================================
   Mecanismo ÚNICO de contagem do app (não duplicar em outros arquivos).

   COMO USAR EM UM NOVO INDICADOR
   • Basta o elemento folha (sem filhos) ter um destes seletores, ou o atributo
     data-count:   <span data-count>1.250,00</span>
   • data-count="off" desliga a animação para aquele elemento.
   • Depois de inserir elementos fora do fluxo normal: FxCount.refresh().

   COMO FUNCIONA
   • O valor real continua no DOM; a animação só muda o texto de passagem e,
     no último quadro, grava de volta o texto ORIGINAL (valor sempre exato).
   • Roda quando o elemento entra na tela (IntersectionObserver) ou quando os
     dados são carregados e ele já está visível.
   • Cada indicador lembra o último valor mostrado: re-renderizar com o mesmo
     valor NÃO repete a animação; se o valor mudou, conta do antigo ao novo.
   • Duração = token --dur-slow do CSS (mais curta no celular).
   • prefers-reduced-motion: mostra o valor final, sem animação.
   • Um único requestAnimationFrame atende todos os contadores ativos.
   Não altera cálculos nem dados: só lê o texto já renderizado. */
/* ============================================================
   FxReveal — Scroll Reveal + Stagger (aparecer ao entrar na tela)
   ============================================================
   • Cartões, gráficos e listas fazem fade + 10px + escala 0,985 (linhas: só fade + 6px).
   • Vários elementos que entram juntos aparecem em sequência (45ms entre si, no máximo 270ms).
   • Aprimoramento progressivo: o estado "oculto" só existe com a classe html.rv-on, que
     este script adiciona. Sem JS, sem IntersectionObserver ou com movimento reduzido,
     tudo fica visível desde o início. Há também um plano B de 3,5s.
   • Roda UMA vez por elemento a cada visita a uma tela (no máximo 12 por lote); redesenhar a tela por uma ação
     do usuário (marcar parcela, salvar...) não reanima o que já foi visto.
   • Terminada a entrada, as classes são removidas (hover e transições voltam ao normal).
   • Gráficos: ao revelar um cartão com gráfico, ele recebe .ch-go (ver CSS "GRÁFICOS"): barras
     crescem, o donut é desenhado, legendas surgem com fade. Uma vez por sessão: depois, só os valores mudam
     (as transições de largura e de arco do donut já existentes).
   • Para incluir novos componentes, acrescente o seletor em CARTAO ou LINHA.
   Fica ANTES do FxCount de propósito: marca os cartões como ocultos antes de os
   contadores decidirem se começam. */
(function () {
  'use strict';
  const reduzido = matchMedia('(prefers-reduced-motion: reduce)');
  if (!('IntersectionObserver' in window) || reduzido.matches) return;
  const CARTAO = '.stat-card, .saude-hero, .saude-cta, .cc-painel, .at-card, .progress-section, .chart-card, .quitadas-resumo, .meta-card, .perfil-card, .pp-card';
  const LINHA = '.lanc-item, .historico-item, .pagamento-item, .critica-card, .quitada-card, .parcela-card';
  const TODOS = CARTAO + ', ' + LINHA;
  const FORA = '.modal-overlay, .ob-overlay, .notif-panel, header, .bnav, .bnav-mais, .fab-menu, .auth-box, .sk-grid, .item-saindo';
  const mobile = matchMedia('(max-width: 720px)');
  const vistos = new Set();
  /* gráficos: o cartão ganha .ch-go na 1ª vez que aparece na sessão; depois só os valores mudam (transições já existentes) */
  const GRAFICO = '.mes-bar-fill, .breakdown-bar-fill, .progress-bar-fill, .cc-cmp-barra, .cc-evol-barras, .donut-circle, .ch-line, .ch-area, .ch-pt';
  const grafMem = new Set();

  const duracao = () => {
    const t = getComputedStyle(document.documentElement).getPropertyValue('--dur-base').trim();
    const n = parseFloat(t) * (t.endsWith('ms') ? 1 : 1000);
    return n >= 80 && n <= 600 ? n : 220;
  };
  const visivel = el => {
    if (el.offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  };
  function chave(el) {
    const v = el.closest('[id^="view-"]')?.id || 'app', c = el.classList[0];
    return v + '|' + c + '|' + [...document.querySelectorAll((v === 'app' ? '' : '#' + v + ' ') + '.' + c)].indexOf(el);
  }
  function limpar(el) { el.classList.remove('rv', 'rv-in', 'rv-row'); el.style.removeProperty('--rv-delay'); }

  function preparar(el) {
    if (el._rv || el.closest(FORA)) return;
    el._rv = 1;
    if (el.parentElement?.closest(TODOS)) return;               // aninhado: o cartão externo já revela o conjunto
    const k = chave(el);
    if (vistos.has(k)) return;                                  // já revelado nesta visita à tela
    el._rvk = k;
    el.classList.add('rv'); if (el.matches(LINHA)) el.classList.add('rv-row');
    io.observe(el);
    setTimeout(() => { if (el.isConnected && el.classList.contains('rv') && !el.classList.contains('rv-in') && visivel(el)) revelar([el]); }, 3500);
  }

  function revelar(lote) {
    const passo = mobile.matches ? 35 : 45, max = mobile.matches ? 210 : 270, dur = duracao();
    lote.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    lote.forEach((el, i) => {
      const atraso = Math.min(i * passo, max);
      io.unobserve(el);
      if (i >= 12) { vistos.add(el._rvk); limpar(el); window.FxCount?.liberar(el); return; }   // lotes grandes: só os 12 primeiros animam
      el.style.setProperty('--rv-delay', atraso + 'ms');
      el.classList.add('rv-in');
      vistos.add(el._rvk);
      if (el.querySelector(GRAFICO)) {                          // 1ª aparição do gráfico nesta sessão: anima a entrada
        if (!grafMem.has(el._rvk)) {
          grafMem.add(el._rvk);
          el.style.setProperty('--ch-delay', atraso + 'ms'); el.classList.add('ch-go');
          setTimeout(() => { el.classList.remove('ch-go'); el.style.removeProperty('--ch-delay'); }, 2300);
        }
      }
      setTimeout(() => window.FxCount?.liberar(el), atraso);    // os números do cartão começam junto com ele
      setTimeout(() => limpar(el), dur + atraso + 120);
    });
  }

  const io = new IntersectionObserver(es => {
    const lote = [];
    es.forEach(e => { if (!e.target.isConnected) io.unobserve(e.target); else if (e.isIntersecting) lote.push(e.target); });
    if (lote.length) revelar(lote);
  }, { threshold: 0.1, rootMargin: '0px 0px -3% 0px' });

  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType !== 1) return;
    if (n.matches(TODOS)) preparar(n);
    n.querySelectorAll(TODOS).forEach(preparar);
  }))).observe(document.body, { childList: true, subtree: true });

  /* nova visita a uma tela = novo reveal; redesenhos dentro da mesma tela, não */
  if (typeof mostrarView === 'function') {
    const base = mostrarView;
    mostrarView = function (id) {
      vistos.clear();
      const r = base.apply(this, arguments);
      document.getElementById(id)?.querySelectorAll(TODOS).forEach(el => { if (!el.classList.contains('rv')) { el._rv = 0; preparar(el); } });   // elementos já na tela também revelam ao voltar
      return r;
    };
  }

  if (typeof supabaseClient !== 'undefined') supabaseClient.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') grafMem.clear(); });
  reduzido.addEventListener?.('change', () => {
    if (!reduzido.matches) return;
    document.documentElement.classList.remove('rv-on'); document.querySelectorAll('.rv').forEach(limpar);
  });
  document.querySelectorAll(TODOS).forEach(preparar);
  document.documentElement.classList.add('rv-on');
})();

(function () {
  'use strict';
  const SELETORES = ['.stat-value', '.saude-hero-stat-val', '.progress-pct', '.mes-bar-valor', '.breakdown-val',
    '.at-meta-topo > span', '.meta-card-meta-info b', '[data-count]'].join(',');
  const RE = /^(\D*?)([-−+]?[\d.]+(?:,\d+)?)(\D*)$/;
  const reduzido = matchMedia('(prefers-reduced-motion: reduce)');
  const memoria = new Map();       // chave do indicador -> último valor mostrado
  const ativos = new Set();        // contadores em andamento
  let rafId = 0, lote = 0, loteTimer = 0;

  /* "1.250,50" | "111.9" | "−3.000" -> { v, dec, ponto } (pt-BR; ponto só como decimal se tiver 1–2 casas) */
  function numero(c) {
    c = c.replace('−', '-');
    if (c.includes(',')) { const p = c.split(','); return { v: parseFloat(p[0].replace(/\./g, '') + '.' + p[1]), dec: p[1].length, ponto: false }; }
    if (/\.\d{1,2}$/.test(c)) return { v: parseFloat(c), dec: c.split('.').pop().length, ponto: true };
    return { v: parseFloat(c.replace(/\./g, '')), dec: 0, ponto: false };
  }
  const formatar = (v, f) => f.ponto ? v.toFixed(f.dec)
    : v.toLocaleString('pt-BR', { minimumFractionDigits: f.dec, maximumFractionDigits: f.dec });
  const duracao = () => {
    const t = getComputedStyle(document.documentElement).getPropertyValue('--dur-slow').trim();
    const n = parseFloat(t) * (t.endsWith('ms') ? 1 : 1000);
    return n >= 150 && n <= 900 ? n : 450;
  };
  function chave(el) {
    const dono = el.closest('[data-id]'), raiz = dono || el.closest('[id^="view-"]') || document.body;
    const rotulo = el.closest('.stat-card')?.querySelector('.stat-label')?.textContent.trim();
    return (raiz.id || dono?.dataset.id || 'app') + '|' + (rotulo || '#' + [...raiz.querySelectorAll(SELETORES)].indexOf(el));
  }
  const oculto = el => !!el.closest('.rv:not(.rv-in)');          // cartão ainda aguardando o Scroll Reveal
  const visivelAgora = el => {
    if (el.offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  };
  function escrever(el, v) { const f = el._fx; el.textContent = f.pre + formatar(v, f) + f.suf; f.ultimo = el.textContent; }
  function parar(el, finalizar) {
    ativos.delete(el); delete el.dataset.fxAnim;
    if (finalizar && el._fx) el.textContent = el._fx.final;
  }

  function iniciar(el) {
    io?.unobserve(el);
    const f = el._fx;
    f.pendente = false;
    memoria.set(f.k, f.alvo);                                     // só "consome" a animação quando ela de fato roda
    const meta = el.closest('.meta-card, .at-meta');                 // metas: número e barra usam a mesma duração (1,5×) e partida (+80ms)
    f.dur = duracao() * (meta ? 1.5 : 1);
    const noCartao = el.closest('.rv-in, .ch-go');                   // dentro de um cartão revelado, o atraso do cartão já escalona
    f.t0 = performance.now() + (meta ? 80 : noCartao ? 0 : Math.min(lote++ * 45, 225));
    if (!loteTimer) loteTimer = setTimeout(() => { lote = 0; loteTimer = 0; }, 60);
    escrever(el, f.de);
    el.dataset.fxAnim = '1'; ativos.add(el);
    if (!rafId) rafId = requestAnimationFrame(passo);
  }
  function passo(t) {
    ativos.forEach(el => {
      const f = el._fx;
      if (!el.isConnected || el.textContent !== f.ultimo) return parar(el, false);   // trocado por outro código: não interfere
      const k = Math.min(Math.max((t - f.t0) / f.dur, 0), 1);
      if (k >= 1) return parar(el, true);                                            // grava o texto original, exato
      escrever(el, f.de + (f.alvo - f.de) * (1 - Math.pow(1 - k, 3)));
    });
    rafId = ativos.size ? requestAnimationFrame(passo) : 0;
  }

  function preparar(el) {
    if (ativos.has(el) || el.children.length || el.closest('[data-count="off"]')) return;   // em andamento: o texto atual é intermediário
    const txt = el.textContent.trim();
    if (el._fx && el._fx.final === txt) return;                  // já tratado com este valor
    parar(el, false); io?.unobserve(el);
    el._fx = { final: txt };
    const m = RE.exec(txt);
    if (!m || /\//.test(m[1].slice(-1) + m[3].slice(0, 1))) return;   // não é um número simples (ex.: datas)
    const n = numero(m[2]);
    if (!isFinite(n.v) || (n.dec === 0 && n.v >= 1900 && n.v <= 2200 && /[A-Za-zÀ-ú]/.test(m[1]))) return;   // ano
    const k = chave(el), de = memoria.get(k) ?? 0;
    const trivial = n.dec === 0 && Math.abs(n.v - de) <= 5 && !/R\$/.test(m[1]);
    if (reduzido.matches || de === n.v || trivial) { memoria.set(k, n.v); return; }   // sem animação: o valor final já está na tela
    Object.assign(el._fx, { k, de, alvo: n.v, pre: m[1], suf: m[3], dec: n.dec, ponto: n.ponto });
    if (visivelAgora(el) && !oculto(el)) iniciar(el);            // já visível: anima agora
    else { el._fx.pendente = true; io?.observe(el); }            // fora da tela / cartão oculto: anima ao aparecer
  }

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(es => es.forEach(e => {
        const f = e.target._fx;
        if (e.isIntersecting && f && f.alvo !== undefined && !ativos.has(e.target) && !oculto(e.target)) iniciar(e.target);
      }), { threshold: 0.2 }) : null;

  const varrer = () => document.querySelectorAll(SELETORES).forEach(preparar);
  new MutationObserver(muts => {
    // ignora as mudanças que a própria animação causa
    const propria = muts.every(m => (m.target.nodeType === 3 ? m.target.parentElement : m.target)?.closest?.('[data-fx-anim="1"]'));
    if (!propria) varrer();                                       // síncrono: define o valor inicial antes da primeira pintura
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  reduzido.addEventListener?.('change', () => { if (reduzido.matches) [...ativos].forEach(el => parar(el, true)); });
  if (typeof supabaseClient !== 'undefined') supabaseClient.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') memoria.clear(); });

  /* chamado pelo Scroll Reveal quando um cartão aparece: inicia os contadores que estavam esperando dentro dele */
  const liberar = raiz => raiz.querySelectorAll(SELETORES).forEach(el => {
    const f = el._fx;
    if (f && f.pendente && !ativos.has(el) && visivelAgora(el) && !oculto(el)) iniciar(el);
  });
  window.FxCount = { refresh: varrer, selectors: SELETORES, liberar };
  varrer();
})();