// Главный экран: показ/скрытие, выбор режима, модалка цвета и сложности.
'use strict';

/* =========================================================================
   ГЛАВНЫЙ ЭКРАН
   ========================================================================= */
function showHomeScreen() {
  $id('homeScreen').classList.remove('hidden');
  document.querySelector('.app').classList.add('hidden');
  hideModal('colorModal');
  hideModal('characterSetupModal');
  hideModal('characterCardModal');
  initHomeFigures();
  placeModePill();
  scheduleHomeTour(); // подсказки для новичков: если в первый раз не вышло (открыта модалка), покажем сейчас
}
function hideHomeScreen() {
  $id('homeScreen').classList.add('hidden');
  document.querySelector('.app').classList.remove('hidden');
  stopHomeFigures();
  stopHomeSnow();
}

let homeSelectedMode = 'ai';

// Функция для переключения иконки режима
function updateModeIcon(mode) {
  document.querySelectorAll('.mode-icon').forEach(img => {
    const isActive = img.dataset.mode === mode;
    img.classList.toggle('active', isActive);
  });
}

/* ---- Выделение режима: переезжает на новый режим пружинкой, с лёгким перелётом ---- */
const MODE_PILL_SPRING_MS = 380;
const MODE_PILL_SPRING_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const MODE_PILL_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

function placeModePill() {
  const active = document.querySelector('.home-mode-btn.is-active');
  const pill = $id('homeModePill');
  // Режимы стоят столбиком или в ряд (на планшете) — подложка повторяет кнопку целиком
  pill.style.top = `${active.offsetTop}px`;
  pill.style.height = `${active.offsetHeight}px`;
  pill.style.left = `${active.offsetLeft}px`;
  pill.style.width = `${active.offsetWidth}px`;
}

function springModePill() {
  const pill = $id('homeModePill');
  // Начинаем с текущего положения: режим могли сменить посреди анимации
  const { top, height, left, width } = getComputedStyle(pill);
  pill.getAnimations().forEach(animation => animation.cancel());
  placeModePill();
  const smooth = !MODE_PILL_REDUCED_MOTION.matches && !document.documentElement.classList.contains('lite');
  if (!smooth) return;
  pill.animate([
    { top, height, left, width },
    { top: pill.style.top, height: pill.style.height, left: pill.style.left, width: pill.style.width },
  ], { duration: MODE_PILL_SPRING_MS, easing: MODE_PILL_SPRING_EASING });
}

window.addEventListener('resize', placeModePill);
if (document.fonts) document.fonts.ready.then(placeModePill); // размер кнопок зависит от шрифта

document.querySelectorAll('.home-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    homeSelectedMode = mode;
    document.querySelectorAll('.home-mode-btn').forEach(b => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    updateModeIcon(mode);
    springModePill();
  });
});

// Ссылка с посадочной страницы (chesai.ru/?mode=friend): нужный режим уже выбран.
// Параметр убираем из адреса, чтобы он не мешал ссылкам на партию (?g=) и персонажа (?c=).
(function applyLinkedMode() {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');
  if (!mode) return;
  const btn = document.querySelector(`.home-mode-btn[data-mode="${CSS.escape(mode)}"]`);
  if (btn && !btn.classList.contains('is-active')) btn.click();
  params.delete('mode');
  const query = params.toString();
  history.replaceState(history.state, '', location.pathname + (query ? `?${query}` : '') + location.hash);
})();

$id('homePlayText').addEventListener('click', () => {
  playSound('ui');
  state.mode = homeSelectedMode;
  if (state.mode === 'friend') {
    // По ссылке или на одном устройстве — выбор в окне js/online.js
    openFriendModal();
  } else if (state.mode === 'characters') {
    openCharacterSetup();
  } else {
    resetDifficultyChoice();
    showModal('colorModal');
  }
});

/* ---- Модалка цвета/сложности ---- */
let chosenColor = null;
let chosenLevel = null;

/* ---- Уровни Stockfish ----
   Все уровни, кроме «Максимума», играют тем же механизмом, что и персонажи
   (ходы из вариантов движка с откалиброванной долей ошибок, см.
   characterMovePolicy в js/opponents.js), — поэтому рейтинг уровня совпадает
   со шкалой разбора партии. «Максимум» — полная сила Stockfish.
   skill — прежний Skill Level (8/14/20): по нему считаются достижения
   «Лёгкий/Средний/Сложный уровень» и колонка skill_level в истории партий. */
const AI_LEVELS = [
  { id: 1, elo: 400, group: 'novice' }, { id: 2, elo: 600, group: 'novice' }, { id: 3, elo: 800, group: 'novice' },
  { id: 4, elo: 1000, group: 'amateur' }, { id: 5, elo: 1200, group: 'amateur' }, { id: 6, elo: 1400, group: 'amateur' },
  { id: 7, elo: 1600, group: 'club' }, { id: 8, elo: 1800, group: 'club' }, { id: 9, elo: 2000, group: 'club' },
  { id: 10, elo: 2200, group: 'master' }, { id: 11, elo: 2500, group: 'master' },
  { id: 12, elo: 3000, group: 'max', max: true },
];
const AI_GROUP_LABEL = { novice: 'новичок', amateur: 'любитель', club: 'клубный игрок', master: 'мастер', max: 'максимум' };
const DEFAULT_AI_LEVEL = 5;

function aiLevelById(id) { return AI_LEVELS.find(l => l.id === id) || AI_LEVELS.find(l => l.id === DEFAULT_AI_LEVEL); }
function aiLevelSkill(level) { return level.max ? 20 : level.elo <= 1400 ? 8 : 14; }
function currentAiLevel() { return aiLevelById(state.aiLevel); }
// «новичок · ≈600» / «максимум»
function aiLevelLabel(level = currentAiLevel()) {
  return level.max ? t(AI_GROUP_LABEL.max) : `${t(AI_GROUP_LABEL[level.group])} · ≈${level.elo}`;
}
// Рейтинг соперника-Stockfish для разбора, истории и рейтинга аккаунта
function aiOpponentElo() { return currentAiLevel().elo; }
// Старая партия из истории: уровень по сохранённому рейтингу соперника
function aiLevelFromElo(elo) {
  if (!Number.isFinite(elo)) return DEFAULT_AI_LEVEL;
  return AI_LEVELS.reduce((best, l) => (Math.abs(l.elo - elo) < Math.abs(best.elo - elo) ? l : best)).id;
}

function renderAiLevels() {
  const box = $id('aiLevelGrid');
  if (!box || box.childElementCount) return;
  box.innerHTML = AI_LEVELS.map(l => `<button type="button" class="diff-choice-btn diff-level diff-${l.group}" data-level="${l.id}" aria-pressed="false">
      <span class="diff-choice-name"><span class="diff-dot"></span>${l.max ? escapeHtml(t('Макс.')) : l.elo}</span>
      <span class="diff-elo">${escapeHtml(t(AI_GROUP_LABEL[l.group]))}</span>
    </button>`).join('');
  box.querySelectorAll('.diff-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playSound('ui');
      chosenLevel = parseInt(btn.dataset.level, 10);
      syncAiLevelButtons();
      updateStartAiBtn();
    });
  });
}
function syncAiLevelButtons() {
  document.querySelectorAll('#aiLevelGrid .diff-choice-btn').forEach(b => {
    const active = parseInt(b.dataset.level, 10) === chosenLevel;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}

// Модалка открывается с готовым выбором (последний цвет и уровень, по
// умолчанию белые и уровень 1200), поэтому «Начать игру» всегда активна.
function resetDifficultyChoice() {
  renderAiLevels();
  chosenColor = localStorage.getItem('chessLastColor') === 'b' ? 'b' : 'w';
  let saved = parseInt(localStorage.getItem('chessLastAiLevel'), 10);
  if (!AI_LEVELS.some(l => l.id === saved)) {
    // Раньше было три уровня — переносим выбор: лёгкий → 1400, средний → 2200, сложный → максимум
    const legacy = parseInt(localStorage.getItem('chessLastLevel'), 10);
    saved = legacy === 8 ? 6 : legacy === 14 ? 10 : legacy === 20 ? 12 : DEFAULT_AI_LEVEL;
  }
  chosenLevel = saved;
  document.querySelectorAll('#colorModal .color-choice-btn').forEach(b => {
    const active = b.dataset.color === chosenColor;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  syncAiLevelButtons();
  updateStartAiBtn();
}
function updateStartAiBtn() {
  const btn = $id('startAiGameBtn');
  btn.disabled = !(chosenColor && chosenLevel);
  btn.textContent = t('Начать: {color}, {level}', {
    color: chosenColor === 'b' ? t('чёрные') : t('белые'),
    level: aiLevelLabel(aiLevelById(chosenLevel)),
  });
}
document.querySelectorAll('#colorModal .color-choice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    playSound('ui');
    chosenColor = btn.dataset.color;
    document.querySelectorAll('#colorModal .color-choice-btn').forEach(b => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    updateStartAiBtn();
  });
});
$id('colorModalBackBtn').addEventListener('click', () => hideModal('colorModal'));
$id('startAiGameBtn').addEventListener('click', () => {
  playSound('ui');
  if (!chosenColor || !chosenLevel) return;
  state.playerColor = chosenColor;
  state.aiColor = chosenColor === 'w' ? 'b' : 'w';
  state.aiLevel = chosenLevel;
  state.skillLevel = aiLevelSkill(aiLevelById(chosenLevel));
  try {
    localStorage.setItem('chessLastColor', chosenColor);
    localStorage.setItem('chessLastAiLevel', String(chosenLevel));
  } catch (e) { /* хранилище недоступно — просто не запоминаем */ }
  hideModal('colorModal');
  if (stockfish && isEngineReady) {
    stockfish.postMessage(`setoption name Skill Level value ${state.skillLevel}`);
  }
  hideHomeScreen();
  initGame();
});
