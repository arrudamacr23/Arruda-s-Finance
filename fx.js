/* Efeito de contagem nos indicadores (.stat-value).
   Anima do valor anterior até o novo, então marcar uma parcela como paga
   "move" os números em vez de trocá-los de repente. Não altera dados nem script.js. */
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ultimo = new Map();
  const RE = /^(\D*?)(-?[\d.]+(?:,\d+)?)(\D*)$/;
  const num = s => parseFloat(s.replace(/\./g, '').replace(',', '.'));

  function animar(el) {
    const txt = el.textContent.trim();
    const m = RE.exec(txt);
    if (!m || el.dataset.fxAnim === '1') return;
    const [, pre, corpo, suf] = m;
    const dec = corpo.includes(',') ? corpo.split(',')[1].length : 0;
    const alvo = num(corpo);
    const label = el.closest('.stat-card')?.querySelector('.stat-label')?.textContent || '';
    const chave = (el.closest('[id^="view-"]')?.id || '') + '|' + label;
    const de = ultimo.get(chave) ?? 0;
    ultimo.set(chave, alvo);
    if (de === alvo) { el.dataset.fxFinal = txt; return; }
    const fmt = v => pre + v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
    const dur = 450, t0 = performance.now();
    el.dataset.fxAnim = '1';
    (function passo(t) {
      const k = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - k, 3);
      el.textContent = k < 1 ? fmt(de + (alvo - de) * e) : txt;
      if (k < 1) requestAnimationFrame(passo);
      else { el.dataset.fxAnim = '0'; el.dataset.fxFinal = txt; }
    })(t0);
  }

  const varrer = () => document.querySelectorAll('.stat-value').forEach(el => {
    if (el.dataset.fxAnim !== '1' && el.textContent.trim() !== el.dataset.fxFinal) animar(el);
  });
  /* agrupa mudanças por quadro e ignora as que a própria animação causa */
  let agendado = false;
  new MutationObserver(muts => {
    const propria = muts.every(m => ((m.target.nodeType === 3 ? m.target.parentElement : m.target))?.closest?.('.stat-value[data-fx-anim="1"]'));
    if (agendado || propria) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; varrer(); });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();