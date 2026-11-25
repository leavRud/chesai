// Мелкие утилиты: $id, модалки, clamp, экранирование, тосты.
'use strict';

/* =========================================================================
   УТИЛИТЫ
   ========================================================================= */
function $id(id) { return document.getElementById(id); }
const modalTriggers = new WeakMap();
function modalTabStops(el) {
  return [...el.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')]
    .filter(item => item.getClientRects().length);
}
function showModal(id) {
  const el = $id(id);
  if (!el.classList.contains('hidden')) return;
  el.classList.remove('hidden');
  if (el.querySelector('[data-keyboard-modal]')) {
    modalTriggers.set(el, document.activeElement);
    modalTabStops(el)[0]?.focus();
  }
}
function hideModal(id) {
  const el = $id(id);
  el.classList.add('hidden');
  const trigger = modalTriggers.get(el);
  modalTriggers.delete(el);
  if (trigger?.getClientRects().length) trigger.focus({ preventScroll: true });
}
document.addEventListener('keydown', (event) => {
  const modal = [...document.querySelectorAll('.modal-overlay:not(.hidden)')].at(-1);
  if (!modal?.querySelector('[data-keyboard-modal]')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    const cancel = modal.querySelector('#onlineCancelBtn');
    if (cancel?.getClientRects().length) cancel.click();
    else hideModal(modal.id);
  } else if (event.key === 'Tab') {
    const stops = modalTabStops(modal);
    const first = stops[0];
    const last = stops.at(-1);
    const outside = !stops.includes(document.activeElement);
    if (outside || document.activeElement === (event.shiftKey ? first : last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }
});
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, m => m.replace(/```/g, '').trim())
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .trim();
}
// Провайдер иногда вставляет в ответ модели одиночный перевод строки в случайное
// место — посреди слова («белые т\nратят») или перед пробелом («на\n f5»). Текст
// показывается с сохранением переносов, и абзац рвётся. Убираем только такие
// переносы: абзацы (\n\n), пункты списков и строки с заглавной буквы остаются.
function fixStrayLineBreaks(text) {
  return String(text ?? '')
    // «слово \nслово» — пробел уже стоит перед переносом
    .replace(/([ \t])\r?\n(?![\r\n])/g, '$1')
    // «слово\n слово» — пробел после переноса, и это не пункт списка
    .replace(/([^\r\n])\r?\n(?= (?![-*+•] |\d+[.)] ))/g, '$1')
    // «сло\nво», «пешку\n, а» — перенос перед строчной буквой или знаком препинания
    .replace(/(\S)\r?\n(?=[a-zа-яё,.;:!?)»])/g, '$1');
}
function isHomeCellOccupied(row, col) {
  if (!figureState) return false;
  for (const enemy of figureState.enemies) {
    if (enemy.row === row && enemy.col === col) return true;
  }
  return false;
}
function showConnectionBanner(text) {
  $id('connectionBannerText').textContent = text;
  $id('connectionBanner').classList.remove('hidden');
  playSound('error');
}
function hideConnectionBanner() {
  $id('connectionBanner').classList.add('hidden');
}
// Тост — строчка из бланка записи партии: номер «хода» и сообщение.
// Номер — счётчик сообщений за сессию, как ходы в бланке.
let toastMoveNumber = 0;
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toastMoveNumber += 1;
  toast.querySelector('.toast-no').textContent = `${toastMoveNumber}.`;
  toast.querySelector('.toast-text').textContent = message;
  clearTimeout(toast._hideTimer);
  clearTimeout(toast._removeTimer);
  // Новый тост поверх ещё видимого — заново «кладём» карточку
  toast.classList.remove('show');
  toast.classList.remove('hidden');
  void toast.offsetWidth;
  toast.classList.add('show');
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove('show');
    toast._removeTimer = setTimeout(() => toast.classList.add('hidden'), 450);
  }, 3200);
}
function onHomeVisibilityChange() {
  homePageVisible = !document.hidden;

  if (!figureState) return;

  if (homePageVisible) {
    startEnemySpawner();
  } else {
    stopEnemySpawner();
  }
}
