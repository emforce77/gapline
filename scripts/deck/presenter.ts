/** Offline, fitted slide viewing. Export mode keeps every slide at its original print size. */
export const PRESENTER_CONTROLS = `
<nav class="deck-controls" aria-label="Presentation controls">
  <button type="button" data-deck="previous" aria-label="Previous slide" title="Previous slide (←)">←</button>
  <output class="deck-position" aria-live="polite" aria-atomic="true"></output>
  <button type="button" data-deck="next" aria-label="Next slide" title="Next slide (→ or Space)">→</button>
  <button type="button" data-deck="notes">Sources</button>
</nav>`;

export const PRESENTER_CSS = `
.deck-controls { display:none; }
@media screen {
  body.presenting { height:100dvh; overflow:hidden; }
  .presenting #deck-stage { position:relative; width:100%; height:calc(100dvh - 64px); }
  .presenting .slide { display:none; position:absolute; left:50%; top:50%;
    transform:translate(-50%, -50%) scale(var(--deck-scale, 1)); transform-origin:center; }
  .presenting .slide.deck-active { display:block; }
  .presenting .deck-controls { display:flex; height:64px; align-items:center; justify-content:center;
    gap:16px; border-top:1px solid var(--rule); background:var(--screen); }
  .deck-controls button { min-width:44px; height:44px; padding:0 14px; border:1px solid var(--rule);
    border-radius:6px; background:var(--lane); color:var(--ink-100); font:16px var(--sans); cursor:pointer; }
  .deck-controls button:hover:not(:disabled) { border-color:var(--ink-300); }
  .deck-controls button:focus-visible { outline:2px solid var(--amber); outline-offset:3px; }
  .deck-controls button:disabled { opacity:.35; cursor:default; }
  .deck-position { min-width:88px; text-align:center; color:var(--ink-300); font:14px var(--mono); }
  .presenting .nt-p:target { background:var(--lane); outline:2px solid var(--amber); outline-offset:4px; }
}
`;

export const PRESENTER_SCRIPT = `
(() => {
  if (new URLSearchParams(location.search).has('export')) return;
  const slides = Array.from(document.querySelectorAll('.slide'));
  if (!slides.length) return;
  const previous = document.querySelector('[data-deck="previous"]');
  const next = document.querySelector('[data-deck="next"]');
  const notes = document.querySelector('[data-deck="notes"]');
  const position = document.querySelector('.deck-position');
  const firstNote = slides.findIndex(slide => slide.dataset.kind === 'notes');
  const storeKey = 'scene-deck:slide';
  let current = 0;
  let returnTo = 0;
  slides.forEach((slide, index) => {
    slide.id = 'slide-' + (index + 1);
    slide.dataset.screenLabel = String(index + 1).padStart(2, '0') + ' ' + slide.dataset.name;
    slide.setAttribute('aria-label', slide.dataset.screenLabel);
  });
  document.body.classList.add('presenting');
  function fit() {
    const stage = document.querySelector('#deck-stage');
    document.documentElement.style.setProperty('--deck-scale', Math.min(stage.clientWidth / 1920, stage.clientHeight / 1080));
  }
  function show(index, updateHash = true) {
    current = Math.max(0, Math.min(slides.length - 1, index));
    if (slides[current].dataset.kind !== 'notes') returnTo = current;
    slides.forEach((slide, index) => {
      slide.classList.toggle('deck-active', index === current);
      slide.setAttribute('aria-hidden', String(index !== current));
    });
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    notes.textContent = slides[current].dataset.kind === 'notes' ? 'Back to slides' : 'Sources';
    notes.hidden = firstNote < 0;
    position.textContent = String(current + 1).padStart(2, '0') + ' / ' + slides.length;
    if (updateHash) history.replaceState(null, '', '#slide-' + (current + 1));
    try { localStorage.setItem(storeKey, String(current)); } catch {}
    fit();
  }
  function followHash() {
    const target = document.getElementById(location.hash.slice(1));
    const slide = target && target.closest('.slide');
    if (!slide) return false;
    show(slides.indexOf(slide), false);
    return true;
  }
  previous.addEventListener('click', () => show(current - 1));
  next.addEventListener('click', () => show(current + 1));
  notes.addEventListener('click', () => show(slides[current].dataset.kind === 'notes' ? returnTo : firstNote));
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select, [contenteditable]')) return;
    if (event.target.closest('button, a') && (event.key === ' ' || event.key === 'Enter')) return;
    const directions = { ArrowRight:1, ArrowDown:1, PageDown:1, ' ':1, ArrowLeft:-1, ArrowUp:-1, PageUp:-1 };
    if (event.key in directions) {
      event.preventDefault(); show(current + directions[event.key]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); show(event.key === 'Home' ? 0 : slides.length - 1);
    } else if (event.key === 'Escape' && slides[current].dataset.kind === 'notes') {
      event.preventDefault(); show(returnTo);
    }
  });
  window.addEventListener('hashchange', followHash);
  window.addEventListener('resize', fit);
  if (!followHash()) {
    let saved = 0;
    try { saved = Number(localStorage.getItem(storeKey)); } catch {}
    show(Number.isInteger(saved) ? saved : 0);
  }
})();`;
