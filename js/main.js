// Запуск приложения после загрузки страницы и таймер партии. Грузится последним.
'use strict';

/* =========================================================================
   ИНИЦИАЛИЗАЦИЯ
   ========================================================================= */
document.addEventListener('visibilitychange', onHomeVisibilityChange);
document.addEventListener('DOMContentLoaded', () => {
  initStockfish();
  updateModeIcon('ai');
  initSettingsPanel();
  initMenuPanel();
  initAuth();
  initProfileView();
  initProfileEditView();
  initAchievementsView();
  initStatsView();
  initAboutView();
  initFeedbackModal();
  initPushSettings();
  showHomeScreen();
  initSupabaseSession();
  openSharedCharacterFromUrl();
  openOnlineGameFromUrl();
  restoreOnlineWrites();
  if (window.Achievements) window.Achievements.init();
});
// Регистрируем ресайз доски партии один раз на весь жизненный цикл страницы
window.addEventListener('resize', () => state.board && state.board.resize());
/* =========================================================================
   ТАЙМЕР
   ========================================================================= */
// Часы идут, если включены в настройках. В партии по ссылке их нет: у каждого игрока
// свои часы в браузере, и они бы разошлись.
function clockEnabled() {
  return state.timeLimited && state.mode !== 'online';
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Часы партии: меньше 20 секунд — с десятыми («00:12.4»), как на chess.com.
// Целые секунды округляем вверх: на старте 10-минутной партии — «10:00».
const CLOCK_TENTHS_BELOW = 20;
function formatClock(seconds) {
  const sec = Math.max(0, seconds);
  if (sec < CLOCK_TENTHS_BELOW) {
    const tenths = Math.floor(sec * 10) / 10;
    return `00:${tenths.toFixed(1).padStart(4, '0')}`;
  }
  return formatTime(Math.ceil(sec));
}

function updateTimerDisplay() {
  const w = $id('timerWhite');
  const b = $id('timerBlack');
  if (w) w.textContent = clockEnabled() ? formatClock(state.timeWhite || 0) : '—';
  if (b) b.textContent = clockEnabled() ? formatClock(state.timeBlack || 0) : '—';
  // Активный игрок: подсвечиваем и таймер, и всю строку игрока
  const turn = state.game && !state.isGameOver ? state.game.turn() : null;
  document.querySelectorAll('.player-bar').forEach(bar => {
    bar.classList.toggle('is-turn', bar.dataset.side === turn);
  });
  [w, b].forEach(el => {
    if (!el) return;
    el.classList.remove('active', 'warning');
    const player = el.dataset.player;
    if (player === turn) {
      el.classList.add('active');
      const time = player === 'w' ? state.timeWhite : state.timeBlack;
      if (time <= 10) el.classList.add('warning');
    }
  });
}

/* Часы считают время по-настоящему, с точностью до долей секунды. Раньше
   таймер раз в секунду отнимал целую секунду и перезапускался на каждом ходе:
   ход быстрее секунды не стоил ничего. Теперь каждые 100 мс списывается
   прошедшее время, а остановка часов (ход, ничья, конец) списывает остаток. */
const CLOCK_TICK_MS = 100;
function chargeClock() {
  if (!state.timerRunning || !state.timerSide || state.timerLastTick == null) return;
  const now = performance.now();
  // Пока открыты подсказки для новичков (js/onboarding.js), время не списывается
  const spent = onboardingOpen() ? 0 : (now - state.timerLastTick) / 1000;
  state.timerLastTick = now;
  if (state.timerSide === 'w') state.timeWhite = Math.max(0, state.timeWhite - spent);
  else state.timeBlack = Math.max(0, state.timeBlack - spent);
}

function stopTimer() {
  chargeClock();
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.timerRunning = false;
  state.timerSide = null;
  state.timerLastTick = null;
}

function moveBeforeFlag(input, options) {
  if (!state.game || state.isGameOver) return null;
  if (clockEnabled()) {
    chargeClock();
    const side = state.game.turn();
    if ((side === 'w' ? state.timeWhite : state.timeBlack) <= 0) {
      handleTimeOut(side);
      return null;
    }
  }
  const move = state.game.move(input, options);
  if (move) stopTimer();
  return move;
}

function startTimer() {
  stopTimer();
  if (!state.game || state.isGameOver) return;
  if (!clockEnabled()) {
    updateTimerDisplay();
    return;
  }
  const turn = state.game.turn();
  const timeLeft = turn === 'w' ? state.timeWhite : state.timeBlack;
  if (timeLeft <= 0) {
    handleTimeOut(turn);
    return;
  }
  state.timerRunning = true;
  state.timerSide = turn;
  state.timerLastTick = performance.now();
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    if (!state.game || state.isGameOver) {
      stopTimer();
      return;
    }
    chargeClock();
    updateTimerDisplay();
    const side = state.timerSide;
    const left = side === 'w' ? state.timeWhite : state.timeBlack;
    if (left <= 0) {
      stopTimer();
      handleTimeOut(side);
    }
  }, CLOCK_TICK_MS);
}

/* Компенсация перетаскивания: пока игрок несёт фигуру по доске, идут его
   часы — после хода возвращаем это время, но не больше полсекунды за ход. */
const DRAG_COMPENSATION_MAX_MS = 500;
let pieceLiftedAt = null;
function notePieceLifted() { pieceLiftedAt = performance.now(); }
function applyMoveTimeBonus(move, isUserMove) {
  if (!clockEnabled() || !move) return;
  let bonus = 0;
  if (isUserMove && pieceLiftedAt != null) {
    bonus = Math.min(DRAG_COMPENSATION_MAX_MS, Math.max(0, performance.now() - pieceLiftedAt)) / 1000;
  }
  pieceLiftedAt = null;
  if (!bonus) return;
  if (move.color === 'w') state.timeWhite += bonus;
  else state.timeBlack += bonus;
}

// Может ли сторона color в принципе поставить мат: только король или король
// с одной лёгкой фигурой без пешек — не может (правила FIDE, 6.9).
function hasMatingMaterial(color) {
  const pieces = [];
  for (const row of state.game.board()) for (const sq of row) if (sq && sq.color === color && sq.type !== 'k') pieces.push(sq.type);
  if (!pieces.length) return false;
  return !(pieces.length === 1 && (pieces[0] === 'n' || pieces[0] === 'b'));
}

function handleTimeOut(color) {
  if (state.isGameOver) return;
  state.isThinking = false;
  setThinkingUI(false);
  closePromotionPicker();
  const loser = color === 'w' ? t('Белые') : t('Чёрные');
  let text;
  let outcome = 'draw';
  const other = color === 'w' ? 'b' : 'w';
  if (!hasMatingMaterial(other)) {
    // Флаг упал, но у соперника не хватает фигур для мата — ничья
    text = t('{loser}: время вышло, но у соперника не хватает фигур для мата — ничья.', { loser });
    state.isGameOver = true;
    stopTimer();
    updateResignButtonLabel();
    reportAchievementGameEnd('draw');
    showResultModal(text, 'draw', 'time', null);
    return;
  }
  if (state.mode === 'friend') {
    const winner = color === 'w' ? t('Чёрные') : t('Белые');
    text = t('{loser} проиграли по времени. Победили {winner}.', { loser, winner });
    outcome = 'character_win';
  } else {
    const playerColor = state.playerColor;
    if (color === playerColor) {
      text = t('Вы проиграли по времени. Победил соперник.');
      outcome = 'character_win';
    } else {
      text = t('Время вышло у соперника. Вы победили!');
      outcome = 'player_win';
    }
  }
  state.isGameOver = true;
  stopTimer();
  updateResignButtonLabel();
  const achvOutcome = state.mode === 'friend' ? 'draw' : (outcome === 'player_win' ? 'win' : 'loss');
  reportAchievementGameEnd(achvOutcome);
  showResultModal(text, outcome, 'time', color === 'w' ? 'b' : 'w');
}

function resetTimers() {
  stopTimer();
  const minutes = state.settings.timeControl || 10;
  state.timeWhite = minutes * 60;
  state.timeBlack = minutes * 60;
  updateTimerDisplay();
  if (clockEnabled() && state.game && !state.isGameOver) {
    startTimer();
  }
}
const container = document.querySelector('.achv-grid-container');

function applySpinEffect() {
  const rect = container.getBoundingClientRect();
  const containerCenter = rect.top + rect.height / 2;
  const halfHeight = rect.height / 2;

  const cards = container.querySelectorAll('.achv-card');
  cards.forEach(card => {
    const cardRect = card.getBoundingClientRect();
    const cardCenter = cardRect.top + cardRect.height / 2;
    const offset = (cardCenter - containerCenter) / halfHeight;
    const clamped = Math.min(1, Math.max(-1, offset));

    // ---- НОВЫЙ КОД С МЁРТВОЙ ЗОНОЙ И ПЛАВНЫМ СТАРТОМ ----
    const DEAD_ZONE = 0.4;          // настройте под себя
    const MAX_ANGLE = 35;           // градусы

    // Наклоняем только карточки у нижнего края — верхние остаются плоскими.
    let factor = 0;
    if (clamped > DEAD_ZONE) {
      const rawFactor = (clamped - DEAD_ZONE) / (1 - DEAD_ZONE);
      factor = rawFactor * rawFactor; // плавный вход
    }

    if (factor === 0) {
      card.style.transform = '';
      card.style.opacity = '';
      return;
    }

    // Карточка «откидывается» назад вокруг своего верхнего края: верх стоит
    // на месте, низ уходит вглубь — проекция только уменьшается и не наезжает
    // на соседние карточки. Перспектива своя у каждой карточки, чтобы эффект
    // не зависел от позиции прокрутки контейнера.
    const angle = -factor * MAX_ANGLE;
    const opacity = 1 - factor * 0.35;

    card.style.transformOrigin = '50% 0';
    card.style.transform = `perspective(900px) rotateX(${angle}deg)`;
    card.style.opacity = opacity;
  });
}

// Обработчик прокрутки с throttle
let ticking = false;
container.addEventListener('scroll', () => {
  if (!ticking) {
    window.requestAnimationFrame(() => {
      applySpinEffect();
      ticking = false;
    });
    ticking = true;
  }
});

// Первый расчёт
applySpinEffect();
