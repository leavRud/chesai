// Партия: запуск, ходы на доске (перетаскивание и тапы), обработка хода.
'use strict';

/* =========================================================================
   ИНИЦИАЛИЗАЦИЯ ИГРЫ
   ========================================================================= */
$id('newGameBtn').addEventListener('click', () => {
  playSound('ui');
  if (state.game && !state.isGameOver && state.game.history().length > 0) {
    // Рейтинговая партия, брошенная после 2 своих ходов, засчитывается поражением (history.js)
    const own = state.game.history({ verbose: true }).filter(m => m.color === state.playerColor).length;
    const rated = (state.mode === 'ai' || state.mode === 'characters') && getAccount()?.uid && own >= ABANDON_MIN_OWN_MOVES;
    const question = rated
      ? t('Начать новую игру? Незаконченная партия будет засчитана поражением. Если позиция равная, можно предложить ничью.')
      : t('Начать новую игру? Текущая партия будет потеряна.');
    if (!confirm(question)) return;
  }
  resetToModeSelection();
});
$id('closeResultBtn').addEventListener('click', resetToModeSelection);
// «Ещё раз» — новая партия с теми же режимом, цветом и сложностью.
$id('rematchBtn').addEventListener('click', () => {
  playSound('ui');
  hideModal('resultModal');
  initGame();
});
$id('moveDetailCloseBtn').addEventListener('click', () => {
  document.getElementById('moveDetailModal').classList.add('hidden');
});
$id('moveDetailModal').addEventListener('click', (e) => {
  if (e.target.id === 'moveDetailModal') e.target.classList.add('hidden');
});

function resetToModeSelection() {
  closePromotionPicker();
  leaveOnlineGame();
  stopTimer();
  hideModal('resultModal');
  hideModal('moveDetailModal');
  showHomeScreen();
}

function initGame() {
  // Прошлая партия брошена недоигранной — засчитываем поражение (history.js)
  settlePendingRatedGame();
  closePromotionPicker();
  state.game = new Chess();
  state.isGameOver = false;
  state.isReview = false; // true — открыта старая партия из «Моих партий»
  state.resultText = '';
  $id('rematchBtn').classList.remove('hidden');
  state.isThinking = false;
  state.chatDisplay = [];
  state.chatApiHistory = [];
  state.capturedByWhite = [];
  state.capturedByBlack = [];
  state.fenHistory = [state.game.fen()];
  state.prevCharacterEval = null;
  state.lastMoveFlavor = null;
  state.lastAutoReplyTime = 0;
  state.autoRepliesThisGame = 0;
  state.lastAutoReplies = [];
  state.autoReplyPending = false;
  state.pliesSinceCharacterSpoke = 0;
  state.characterPhase = 0;
  state.characterEloLog = [];
  state.characterShiftAnnounce = false;
  setCharacterTyping(false);

  // Новая партия — старый кэш анализа больше не актуален
  clearAnalysisCache();
  trackGoal('game_start', { mode: state.mode });

  $id('chatLog').innerHTML = '';
  $id('analysisBlock').classList.add('hidden');
  $id('analysisContent').innerHTML = '';
  $id('requestAnalysisBtn').textContent = t('Разобрать партию');
  hideModal('resultModal');
  hideConnectionBanner();
  state.gameStartedAt = Date.now();
  resetDrawState(); // draws.js
  renderPlayerBars();
  renderMoveList();
  updateStatus();

  const orientation = state.playerColor === 'w' ? 'white' : 'black';
  const config = {
    draggable: true,
    position: 'start',
    orientation,
    pieceTheme: pieceThemeFn,
    onDragStart,
    onDrop,
    onSnapEnd,
    onSnapbackEnd: clearBoardDragPending, // нажатие на месте: копия вернулась
    // В лёгком режиме фигуры встают на место сразу, без полёта по доске
    moveSpeed: state.settings.liteMode ? 0 : 220,
    snapbackSpeed: state.settings.liteMode ? 0 : 260,
    snapSpeed: state.settings.liteMode ? 0 : 90,
  };
  state.board = Chessboard('board', config);
  tapSelectedSquare = null;
  $('#board').off('click.tap').on('click.tap', '.square-55d63', onSquareTap);

  $id('chatInput').placeholder = defaultChatPlaceholder();
  const playerColorName = state.playerColor === 'w' ? t('белыми') : t('чёрными');
  if (state.mode === 'ai') {
    $id('modeLabel').textContent = t('Против нейросети · вы играете {color}', { color: playerColorName });
    $id('chatTitle').textContent = t('Диалог с нейросетью');
    $id('chatHint').textContent = t('Можно спросить в любой момент партии');
  } else if (state.mode === 'characters' && state.character) {
    $id('modeLabel').textContent = t('Против персонажа: {name} · вы играете {color}', { name: state.character.name, color: playerColorName });
    $id('chatTitle').textContent = t('Разговор с соперником — {name}', { name: state.character.name });
    $id('chatHint').textContent = t('{name} — ваш соперник и не даёт подсказок по ходам', { name: state.character.name });
    // У меняющегося персонажа сила во время партии не показывается
    logSystemChat(state.character.shift
      ? t('Вы играете против персонажа «{name}». Он ваш соперник за доской и не будет подсказывать вам ходы.', { name: state.character.name })
      : t('Вы играете против персонажа «{name}» (≈{elo} Elo). Он ваш соперник за доской и не будет подсказывать вам ходы.', { name: state.character.name, elo: state.character.elo }));
    characterReact('партия только начинается. Поздоровайся с собеседником в своём образе.', true);
  } else if (state.mode === 'online') {
    $id('modeLabel').textContent = t('Партия с другом по ссылке · вы играете {color}', { color: playerColorName });
    $id('chatTitle').textContent = t('Диалог с нейросетью');
    $id('chatHint').textContent = t('Во время партии с человеком помощник молчит — спросите после партии');
  } else {
    $id('modeLabel').textContent = t('Игра вдвоём на одном устройстве');
    $id('chatTitle').textContent = t('Диалог с нейросетью');
    $id('chatHint').textContent = t('Нейросеть отвечает только по запросу и не подсказывает сама');
  }
  syncAutoHintAvailability();

  if (!stockfish) initStockfish();

  if (state.mode === 'ai' && state.game.turn() === state.aiColor) {
    setTimeout(requestAiMove, 500);
  } else if (state.mode === 'characters' && state.game.turn() === state.aiColor) {
    setTimeout(requestCharacterMove, 500);
  }
  resetTimers();
  startTimer();

  // Запускаем фоновый анализ стартовой позиции (Infinite Analysis либо
  // короткий анализ — в зависимости от настройки «Режим анализа»), как
  // только движок будет готов. Если следующим ходом должен ответить сам
  // движок (см. выше), searchBestMove сам корректно остановит этот фоновый
  // анализ перед поиском своего хода — конфликта не возникает.
  waitForEngine(4000).then((ready) => {
    if (ready && state.game && !state.isGameOver) startBackgroundAnalysis(state.game.fen());
  });

  // Настройку режима анализа нельзя менять во время партии — обновляем
  // состояние блокировки в панели настроек (если она открыта/будет открыта).
  syncAnalysisModeLock();

  scheduleGameTour(); // подсказки к первой партии, js/onboarding.js

  if (window.Achievements) {
    window.Achievements.track('gameStart', {
      mode: state.mode,
      playerColor: state.playerColor,
      skillLevel: state.skillLevel,
      character: state.mode === 'characters' ? state.character : null,
    });
  }
}

/* =========================================================================
   ВЗАИМОДЕЙСТВИЕ С ДОСКОЙ
   ========================================================================= */
// Кроме перетаскивания ход можно сделать двумя нажатиями: фигура → клетка.
// На телефоне это основной способ. Выбранная фигура хранится здесь.
let tapSelectedSquare = null;

function canUserMoveNow() {
  if (!state.game || state.isGameOver || state.isThinking || pendingPromotion) return false;
  if (drawState.deciding) return false; // соперник обдумывает предложение ничьей (draws.js)
  if ((state.mode === 'ai' || state.mode === 'characters' || state.mode === 'online') && state.game.turn() !== state.playerColor) return false;
  return true;
}

function onDragStart(source, piece) {
  if (!canUserMoveNow()) return false;
  const turn = state.game.turn();
  const isPieceWhite = piece.search(/^w/) !== -1;
  if ((turn === 'w' && !isPieceWhite) || (turn === 'b' && isPieceWhite)) return false;
  notePieceLifted(); // main.js: время перетаскивания вернём на часы
  highlightLegalMoves(source);
}

function onDrop(source, target) {
  // Отпустили на той же клетке — это нажатие, а не перетаскивание:
  // выбираем фигуру (или снимаем выбор при повторном нажатии).
  if (source === target) {
    if (tapSelectedSquare === source) {
      tapSelectedSquare = null;
      clearHighlights();
    } else {
      tapSelectedSquare = source;
      highlightLegalMoves(source);
    }
    return 'snapback';
  }
  tapSelectedSquare = null;
  clearHighlights();
  if (!tryUserMove(source, target)) return 'snapback';
}

// Нажатие на клетку без своей фигуры: пустую или с фигурой соперника.
// Нажатия на свои фигуры обрабатывает onDrop (source === target).
function onSquareTap(e) {
  if (!tapSelectedSquare || !canUserMoveNow()) return;
  const square = $(e.currentTarget).attr('data-square');
  const piece = state.game.get(square);
  if (piece && piece.color === state.game.turn()) return;
  const from = tapSelectedSquare;
  tapSelectedSquare = null;
  clearHighlights();
  const isLegal = state.game.moves({ square: from, verbose: true }).some((m) => m.to === square);
  if (isLegal) tryUserMove(from, square);
}

/* ---- Нажатие на фигуру без рывка ----
   chessboard.js начинает перетаскивание сразу при нажатии: копия фигуры
   прыгает центром под курсор, а при отпускании на той же клетке едет назад.
   Поэтому обычное нажатие (выбор фигуры) выглядело как попытка её унести.
   Пока курсор или палец не сдвинулся на DRAG_THRESHOLD_PX, класс на body
   прячет «летящую» копию и оставляет фигуру на клетке; сдвинули дальше —
   это перетаскивание, класс снимаем. Сам ход по-прежнему делает
   chessboard.js: нажатие на месте приходит в onDrop с source === target. */
const DRAG_THRESHOLD_PX = 6;
const DRAG_PENDING_CLASS = 'board-drag-pending';
let boardPress = null;
let boardPressTimer = 0;

function boardPointerXY(e) {
  const p = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches ? e.changedTouches[0] : e);
  return p ? { x: p.clientX, y: p.clientY } : null;
}

function onBoardPress(e) {
  if (!e.target.closest || !e.target.closest('.piece-417db')) return;
  clearTimeout(boardPressTimer);
  boardPress = boardPointerXY(e);
  document.body.classList.add(DRAG_PENDING_CLASS);
}

function onBoardPressMove(e) {
  if (!boardPress) return;
  const p = boardPointerXY(e);
  if (p && Math.hypot(p.x - boardPress.x, p.y - boardPress.y) > DRAG_THRESHOLD_PX) {
    boardPress = null;
    document.body.classList.remove(DRAG_PENDING_CLASS);
  }
}

function clearBoardDragPending() {
  clearTimeout(boardPressTimer);
  document.body.classList.remove(DRAG_PENDING_CLASS);
}

function onBoardRelease() {
  if (!boardPress) return;
  boardPress = null;
  // Копия ещё едет на место — прячем её, пока chessboard.js не скажет, что
  // доехала (onSnapbackEnd). Таймер — на случай, если анимации не было.
  clearTimeout(boardPressTimer);
  boardPressTimer = setTimeout(clearBoardDragPending, 700);
}

{
  const boardEl = $id('board');
  boardEl.addEventListener('mousedown', onBoardPress, true);
  boardEl.addEventListener('touchstart', onBoardPress, { capture: true, passive: true });
  // На window, как и у chessboard.js: отпускание за пределами страницы тоже ловится
  window.addEventListener('mousemove', onBoardPressMove, { passive: true });
  window.addEventListener('touchmove', onBoardPressMove, { passive: true });
  window.addEventListener('mouseup', onBoardRelease);
  window.addEventListener('touchend', onBoardRelease);
  window.addEventListener('touchcancel', onBoardRelease);
}

/* ---- Превращение пешки: игрок сам выбирает фигуру ---- */
let pendingPromotion = null; // { from, to } — ждём выбора в окне над доской

function isPromotionMove(from, to) {
  return state.game.moves({ square: from, verbose: true }).some((m) => m.to === to && m.flags.includes('p'));
}

function openPromotionPicker(from, to) {
  pendingPromotion = { from, to };
  const color = state.game.turn();
  const picker = $id('promotionPicker');
  picker.querySelectorAll('.promotion-btn').forEach((btn) => {
    btn.querySelector('img').src = pieceThemeFn(color + btn.dataset.piece.toUpperCase());
  });
  picker.classList.remove('hidden');
  picker.querySelector('.promotion-btn').focus();
}

function closePromotionPicker() {
  pendingPromotion = null;
  $id('promotionPicker').classList.add('hidden');
}

$id('promotionPicker').addEventListener('click', (e) => {
  const btn = e.target.closest('.promotion-btn');
  const pending = pendingPromotion;
  closePromotionPicker();
  if (!pending) return;
  if (btn) tryUserMove(pending.from, pending.to, btn.dataset.piece);
  else state.board.position(state.game.fen()); // нажали мимо — ход отменён
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pendingPromotion) {
    closePromotionPicker();
    state.board.position(state.game.fen());
  }
});

// promotion — фигура для превращения ('q' | 'r' | 'b' | 'n'); без неё спросим игрока.
function tryUserMove(from, to, promotion) {
  if (!promotion && isPromotionMove(from, to)) {
    openPromotionPicker(from, to);
    return true;
  }
  const move = state.game.move({ from, to, promotion: promotion || 'q' });
  if (move === null) {
    playSound('error');
    return false;
  }
  state.fenHistory.push(state.game.fen());
  const isUserMove = ((state.mode === 'ai' || state.mode === 'characters' || state.mode === 'online') && move.color === state.playerColor) || state.mode === 'friend';
  onMoveMade(move, isUserMove);
  return true;
}

function onSnapEnd() {
  state.board.position(state.game.fen());
}

function highlightLegalMoves(square) {
  clearHighlights();
  const moves = state.game.moves({ square, verbose: true });
  moves.forEach((m) => {
    const $sq = $(`#board .square-${m.to}`);
    $sq.addClass('highlight-move');
    if (m.flags.includes('c') || m.flags.includes('e')) $sq.addClass('highlight-capture');
  });
  $(`#board .square-${square}`).addClass('highlight-select');
}

function clearHighlights() {
  $('#board .square-55d63').removeClass('highlight-move highlight-capture highlight-select');
}

function clearCheckHighlight() {
  $('#board .square-55d63').removeClass('highlight-check');
}

function getKingSquare(color) {
  const boardArr = state.game.board();
  const files = 'abcdefgh';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = boardArr[r][c];
      if (p && p.type === 'k' && p.color === color) {
        return files[c] + (8 - r);
      }
    }
  }
  return null;
}

/* =========================================================================
   ОБРАБОТКА ХОДА
   ========================================================================= */
function onMoveMade(move, isUserMove = false) {
  tapSelectedSquare = null;
  clearHighlights();
  if (move.captured) {
    const isAi = ((state.mode === 'ai' || state.mode === 'online') && move.color === state.aiColor);
    const flashColor = isAi ? 'red' : 'green';
    animateCapture(move.to, flashColor);
    playSound('capture');
  } else {
    playSound('move');
  }
  state.board.position(state.game.fen());
  if (move.captured) trackCapture(move);
  appendLastMoveRow();
  updateStatus();
  highlightLastMoveFade(move.from, move.to);
  if (state.game.in_check() && !state.game.in_checkmate()) playSound('check');
  if (state.mode === 'characters' && state.character) {
    triggerCharacterEvents(move, isUserMove);
  }
  if (window.Achievements) {
    window.Achievements.track('move', {
      move,
      isUserMove,
      mode: state.mode,
      playerColor: state.playerColor,
      givesCheck: state.game.in_check(),
      board: state.game.board(),
    });
  }
  if (state.mode === 'online' && isUserMove) onlineSendMove(move);
  if (isUserMove) markPendingRatedGame(); // брошенная партия = поражение (history.js)
  // После хода перезапускаем таймер
  if (!state.isGameOver) {
    stopTimer(); // списывает время хода тому, кто ходил
    applyMoveTimeBonus(move, isUserMove); // компенсация перетаскивания фигуры (main.js)
    startTimer();
  }
  const isOver = checkGameOver();
  drawAfterMove(move, isUserMove, isOver); // ничьи: ход — отказ, соперник может предложить (draws.js)
  // Останавливаем анализ предыдущей позиции (сохраняя результат в кэш) и,
  // если партия продолжается, тут же запускаем фоновый анализ новой позиции.
  // Промис не ждём — это не должно блокировать отрисовку хода.
  advanceBackgroundAnalysis();
  if (isOver) return;
  resetAutoHintTimer();
  if (state.mode === 'ai' && state.game.turn() === state.aiColor) {
    setTimeout(requestAiMove, 350);
  } else if (state.mode === 'characters' && state.game.turn() === state.aiColor) {
    setTimeout(requestCharacterMove, 350);
  }
}

function trackCapture(move) {
  const capturedColor = move.color === 'w' ? 'b' : 'w';
  const glyph = capturedColor === 'w' ? WHITE_GLYPH[move.captured] : BLACK_GLYPH[move.captured];
  if (move.color === 'w') state.capturedByWhite.push(glyph);
  else state.capturedByBlack.push(glyph);
  renderCaptured();
}

const GLYPH_VALUE = { '♙': 1, '♟': 1, '♘': 3, '♞': 3, '♗': 3, '♝': 3, '♖': 5, '♜': 5, '♕': 9, '♛': 9 };

function renderCaptured() {
  $id('capturedWhite').textContent = state.capturedByWhite.join('');
  $id('capturedBlack').textContent = state.capturedByBlack.join('');
  // Перевес по материалу показываем у того, кто впереди: «+2».
  const sum = (list) => list.reduce((n, g) => n + (GLYPH_VALUE[g] || 0), 0);
  const diff = sum(state.capturedByWhite) - sum(state.capturedByBlack);
  document.querySelectorAll('.player-bar').forEach(bar => {
    const adv = bar.dataset.side === 'w' ? diff : -diff;
    bar.querySelector('.pb-advantage').textContent = adv > 0 ? `+${adv}` : '';
  });
}

// Сверху — соперник, снизу — тот, за кого играют (в режиме «вдвоём» — белые).
// Таймер и взятые фигуры каждой стороны переезжают в строку этой стороны.
function renderPlayerBars() {
  const bottomSide = state.mode === 'friend' ? 'w' : state.playerColor;
  const topSide = bottomSide === 'w' ? 'b' : 'w';
  const acc = getAccount();
  const describe = (side) => {
    const king = side === 'w' ? '♔' : '♚';
    if (state.mode === 'friend') {
      return { king, name: side === 'w' ? t('Белые') : t('Чёрные'), meta: side === 'w' ? t('Игрок 1') : t('Игрок 2') };
    }
    if (state.mode === 'online' && side !== state.playerColor) {
      return { king, name: state.onlineOpponentName || t('Соперник'), meta: t('Друг по ссылке') };
    }
    if (side === state.playerColor) {
      return { king, name: acc?.name || t('Вы'), meta: acc ? t('Рейтинг {elo}', { elo: acc.elo ?? 1200 }) : t('Гость'), own: true };
    }
    if (state.mode === 'characters' && state.character) {
      return { king, name: state.character.name, meta: state.character.shift ? t('Персонаж') : t('≈{elo} Эло', { elo: state.character.elo }) };
    }
    const label = aiLevelLabel();
    return { king, name: 'Stockfish', meta: label[0].toUpperCase() + label.slice(1) };
  };
  [[$id('playerBarTop'), topSide], [$id('playerBarBottom'), bottomSide]].forEach(([bar, side]) => {
    const info = describe(side);
    bar.dataset.side = side;
    // У своей плашки — аватар и рамка профиля; цвет фигур подсказывает
    // маленький король в углу. Без своей картинки и рамки — король, как раньше.
    const avatarEl = bar.querySelector('.pb-avatar');
    const showProfile = info.own && acc && (isImageAvatar(acc.avatar) || (acc.frame && acc.frame !== 'none' && isFrameUnlocked(acc.frame)));
    avatarEl.classList.toggle('pb-avatar-profile', !!showProfile);
    if (showProfile) {
      paintAvatar(avatarEl, acc);
      avatarEl.dataset.king = info.king;
    } else {
      paintAvatar(avatarEl, { avatar: info.king });
      delete avatarEl.dataset.king;
    }
    bar.querySelector('.pb-name-text').textContent = info.name;
    bar.querySelector('.pb-meta').textContent = info.meta;
    bar.querySelector('.pb-material').prepend($id(side === 'w' ? 'capturedWhite' : 'capturedBlack'));
    bar.appendChild($id(side === 'w' ? 'timerWhite' : 'timerBlack'));
  });
  renderCaptured();
  updateTimerDisplay();
}

function moveRowHtml(move, i, fenBefore) {
  const num = Math.floor(i / 2) + 1;
  const prefix = i % 2 === 0 ? `${num}.` : '';
  return `<div class="move-row" data-fen="${fenBefore}" data-san="${move.san}" data-index="${i}">
      <span class="move-num">${prefix}</span>
      <span class="move-white">${i % 2 === 0 ? move.san : ''}</span>
      <span class="move-black">${i % 2 === 1 ? move.san : ''}</span>
    </div>`;
}

function scrollMoveListToEnd() {
  const wrap = document.querySelector('.move-list-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

// Полная перестройка списка ходов — только для случаев, когда история
// могла измениться целиком (новая партия, открытие/просмотр партии и т.п.)
function renderMoveList() {
  const history = state.game ? state.game.history({ verbose: true }) : [];
  const fens = state.fenHistory;
  let html = '';
  for (let i = 0; i < history.length; i++) {
    html += moveRowHtml(history[i], i, fens[i] || '');
  }
  $id('moveList').innerHTML = html;
  scrollMoveListToEnd();
}

// Добавляет в DOM только последний сыгранный ход, без пересборки всего
// списка — раньше renderMoveList() пересоздавал innerHTML целиком после
// каждого хода, что было лишней перерисовкой DOM на длинных партиях.
function appendLastMoveRow() {
  const history = state.game ? state.game.history({ verbose: true }) : [];
  if (!history.length) return;
  const i = history.length - 1;
  const fenBefore = state.fenHistory[i] || '';
  $id('moveList').insertAdjacentHTML('beforeend', moveRowHtml(history[i], i, fenBefore));
  scrollMoveListToEnd();
}

// Разбор хода открывается только после партии: во время игры он показывал бы
// оценку Stockfish и лучший ход — по сути подсказку.
document.getElementById('moveList').addEventListener('click', function (e) {
  const row = e.target.closest('.move-row');
  if (!row || (state.game && !state.isGameOver)) return;
  const fen = row.dataset.fen;
  const san = row.dataset.san;
  if (fen && san) openMoveDetail(fen, san);
});

function updateStatus() {
  const game = state.game;
  clearCheckHighlight();
  let text;
  const sideLabel = game.turn() === 'w' ? t('Белые') : t('Чёрные');
  if (game.in_checkmate()) {
    text = t('Мат! {side} получают мат.', { side: sideLabel });
    // Заматованного короля видно сразу, ещё до окна с итогом
    const matedKing = getKingSquare(game.turn());
    if (matedKing) $(`#board .square-${matedKing}`).addClass('highlight-check highlight-mate');
  } else if (game.in_check()) {
    text = t('{side} под шахом.', { side: sideLabel });
    const kingSq = getKingSquare(game.turn());
    if (kingSq) $(`#board .square-${kingSq}`).addClass('highlight-check');
  } else if (game.in_stalemate()) {
    text = t('Пат.');
  } else if (game.in_draw()) {
    text = t('Ничья.');
  } else if (state.isGameOver) {
    // Сдача или время: по позиции не видно, что партия кончилась
    text = state.resultText || t('Партия окончена.');
  } else {
    text = game.turn() === 'w' ? t('Ход: белые.') : t('Ход: чёрные.');
    if (state.mode === 'ai' && game.turn() === state.aiColor) text += ` ${t('Нейросеть думает…')}`;
    else if (state.mode === 'online' && game.turn() === state.aiColor) text += ` ${t('Ход соперника…')}`;
    else if (state.mode === 'characters' && game.turn() === state.aiColor) {
      text += ` ${t('{name} думает…', { name: state.character ? state.character.name : t('Персонаж') })}`;
    }
  }
  $id('statusText').textContent = text;
  updateResignButtonLabel();
  updateTimerDisplay();
}

function updateResignButtonLabel() {
  const btn = $id('resignBtn');
  $id('moveList').classList.toggle('is-reviewable', !!state.isGameOver);
  if (state.isGameOver) { btn.disabled = true; return; }
  btn.disabled = false;
  if (state.mode === 'friend') {
    const toMove = state.game.turn() === 'w' ? t('белых') : t('чёрных');
    btn.textContent = t('Сдаться (за {side})', { side: toMove });
  } else {
    btn.textContent = t('Сдаться');
  }
}

function computeMateInfo() {
  const hist = state.game.history({ verbose: true });
  const lastMove = hist[hist.length - 1];
  if (!lastMove) return {};
  const board = state.game.board();
  let bishops = 0, knights = 0;
  board.forEach(row => row.forEach(p => {
    if (p && p.color === lastMove.color) {
      if (p.type === 'b') bishops++;
      if (p.type === 'n') knights++;
    }
  }));
  return { matingPiece: lastMove.piece, matingSideBishops: bishops, matingSideKnights: knights };
}

function reportAchievementGameEnd(outcome, extra = {}) {
  trackGoal('game_end', { mode: state.mode, outcome });
  if (!window.Achievements) return;
  const game = state.game;
  const mateInfo = game && game.in_checkmate() ? computeMateInfo() : {};
  const ownTimeLeft = state.timeLimited
    ? (state.playerColor === 'w' ? state.timeWhite : state.timeBlack)
    : null;
  window.Achievements.track('gameEnd', Object.assign({
    outcome,
    mode: state.mode,
    skillLevel: state.skillLevel,
    characterElo: state.character ? characterGameElo() : null,
    checkmate: !!(game && game.in_checkmate()),
    stalemate: !!(game && game.in_stalemate()),
    threefold: !!(game && game.in_threefold_repetition()),
    ownTimeLeft,
  }, mateInfo, extra));
}

function checkGameOver() {
  const game = state.game;
  if (!game.game_over()) return false;
  stopTimer();
  state.isGameOver = true;
  updateResignButtonLabel();
  let text;
  let outcome = 'draw';
  let reason = 'draw';
  let winnerColor = null;
  if (game.in_checkmate()) {
    reason = 'mate';
    winnerColor = game.turn() === 'w' ? 'b' : 'w';
    const winner = winnerColor === 'w' ? t('Белые') : t('Чёрные');
    text = t('Мат! Победили {winner}.', { winner });
    outcome = winnerColor === state.playerColor ? 'player_win' : 'character_win';
  } else if (game.in_stalemate()) {
    text = t('Пат. Ничья.');
    reason = 'stalemate';
  } else if (game.in_threefold_repetition()) {
    text = t('Ничья по троекратному повторению позиции.');
  } else if (game.insufficient_material()) {
    text = t('Ничья: недостаточно материала для мата.');
  } else if (game.in_draw()) {
    text = t('Ничья по правилу 50 ходов.');
  } else {
    text = t('Игра окончена.');
    reason = 'over';
  }
  // Партии с человеком не дают достижений: две вкладки — и победа «в кармане»
  const achvOutcome = (state.mode === 'friend' || state.mode === 'online') ? 'draw' : (outcome === 'player_win' ? 'win' : (outcome === 'character_win' ? 'loss' : 'draw'));
  reportAchievementGameEnd(achvOutcome);
  if (state.mode === 'online') onlineReportFinish(winnerColor || 'draw', reason === 'mate' || reason === 'stalemate' ? reason : 'draw');
  // После мата доска остаётся на виду: ход доезжает, король мигает красным —
  // и только потом окно итога. Раньше оно закрывало доску сразу, и на телефоне
  // матующий ход соперника было не разглядеть.
  const revealMs = reason === 'mate' ? (winnerColor === state.playerColor ? MATE_REVEAL_WIN_MS : MATE_REVEAL_LOSS_MS) : 0;
  showResultModal(text, outcome, reason, winnerColor, { revealMs });
  return true;
}
const MATE_REVEAL_LOSS_MS = 2600;
const MATE_REVEAL_WIN_MS = 1600;

// Чем закончилась партия: reason определяет заголовок и подпись в итоговом окне
const RESULT_REASON_LABEL = {
  mate: t('Мат'),
  resign: t('Сдача'),
  time: t('Время вышло'),
  stalemate: t('Пат'),
  draw: t('Ничья'),
  agreement: t('Ничья по соглашению'),
  over: t('Партия окончена'),
};

function resultTitleFor(reason, outcome) {
  if (reason === 'stalemate' || reason === 'draw' || reason === 'agreement' || outcome === 'draw' && reason === 'time') return t('Ничья');
  if (state.mode === 'friend') return t('Партия окончена');
  if (outcome === 'player_win') return t('Победа!');
  if (outcome === 'character_win') return t('Поражение');
  return t('Партия окончена');
}

// Цифры для итога: число ходов, сколько шла партия и сколько фигур взял игрок.
function renderResultStats(reason) {
  const plies = state.game ? state.game.history().length : 0;
  const fullMoves = Math.ceil(plies / 2);
  const seconds = state.gameStartedAt ? Math.round((Date.now() - state.gameStartedAt) / 1000) : 0;
  const myCaptures = state.mode === 'friend'
    ? state.capturedByWhite.length + state.capturedByBlack.length
    : (state.playerColor === 'w' ? state.capturedByWhite : state.capturedByBlack).length;

  $id('resultEyebrow').textContent = `${RESULT_REASON_LABEL[reason]} · ${t('{n}-й ход', { n: fullMoves })}`;
  $id('resultStatMoves').textContent = String(fullMoves);
  $id('resultStatMoves').nextElementSibling.textContent = plural(fullMoves, 'ход', 'хода', 'ходов');
  $id('resultStatTime').textContent = formatTime(seconds);
  $id('resultStatCaptured').textContent = String(myCaptures);
  const pieces = plural(myCaptures, 'фигура', 'фигуры', 'фигур');
  $id('resultStatCaptured').nextElementSibling.textContent = state.mode === 'friend'
    ? t('{pieces} взято', { pieces })
    : t('{pieces} взяли вы', { pieces });
}

// winner — цвет победителя ('w' | 'b') или null при ничьей: нужен для истории и PGN.
function showResultModal(text, outcome = 'draw', reason = 'over', winner = null, { revealMs = 0 } = {}) {
  clearPendingRatedGame(); // доиграна — брошенной не считается
  clearDrawOffer(); // висящее предложение ничьей больше не в силе
  const ratingEl = $id('resultRating');
  ratingEl.textContent = '';
  ratingEl.classList.add('hidden');
  const savedForGame = state.gameStartedAt;
  saveFinishedGame(buildGameRecord({ reason, winner, summary: text })).then((change) => {
    if (!change || savedForGame !== state.gameStartedAt) return;
    ratingEl.textContent = formatRatingChange(change);
    ratingEl.dataset.trend = change.delta > 0 ? 'up' : change.delta < 0 ? 'down' : 'flat';
    ratingEl.classList.remove('hidden');
  });
  state.resultText = text;
  updateStatus(); // пишет итог под доской
  if (outcome === 'player_win') playSound('win');
  else if (outcome === 'character_win') playSound('lose');
  // Персонаж обдумывает партию, пока игрок смотрит на доску
  const isCharacterGame = state.mode === 'characters' && state.character;
  if (isCharacterGame) {
    renderCharacterResultLoading();
    generateCharacterEndSummary(text, outcome, reason);
  }
  const gameStartedAt = state.gameStartedAt;
  const open = () => {
    if (gameStartedAt !== state.gameStartedAt) return; // за паузу начали новую партию
    fillResultModal(text, outcome, reason, !!isCharacterGame);
  };
  if (revealMs > 0) setTimeout(open, revealMs);
  else open();
}

function fillResultModal(text, outcome, reason, isCharacterGame) {
  $id('resultTitle').textContent = resultTitleFor(reason, outcome);
  $id('resultText').textContent = text;
  renderResultStats(reason);
  $id('characterResultBlock').classList.toggle('hidden', !isCharacterGame);
  // Реванш по ссылке — новой ссылкой с главного экрана
  $id('rematchBtn').classList.toggle('hidden', state.mode === 'online');
  showModal('resultModal');
  maybeShowPushAsk();
}

$id('resignBtn').addEventListener('click', () => {
  playSound('ui');
  if (state.isGameOver) return;
  let text;
  let outcome = 'character_win';
  if (state.mode === 'ai') {
    text = t('Вы сдались. Победила нейросеть.');
  } else if (state.mode === 'characters') {
    text = t('Вы сдались. Победил(а) {name}.', { name: state.character ? state.character.name : t('персонаж') });
  } else if (state.mode === 'online') {
    text = t('Вы сдались. Победил(а) {name}.', { name: state.onlineOpponentName || t('соперник') });
    onlineReportFinish(null, 'resign');
  } else {
    const toMove = state.game.turn() === 'w' ? t('Белые') : t('Чёрные');
    const winner = state.game.turn() === 'w' ? t('Чёрные') : t('Белые');
    text = t('{loser} сдались. Победили {winner}.', { loser: toMove, winner });
    outcome = 'draw';
  }
  state.isGameOver = true;
  updateResignButtonLabel();
  // Партия окончена сдачей — останавливаем фоновый анализ и сохраняем
  // в кэш последний накопленный результат для текущей позиции.
  stopBackgroundAnalysis();
  const achvOutcome = state.mode === 'friend' ? 'draw' : 'loss';
  reportAchievementGameEnd(achvOutcome);
  // Сдаётся игрок, а вдвоём — сторона, чей сейчас ход
  const resigned = state.mode === 'friend' ? state.game.turn() : state.playerColor;
  showResultModal(text, outcome, 'resign', resigned === 'w' ? 'b' : 'w');
});

// Долгое нажатие на фигуру или доску на Android открывало меню браузера
// («Скачать изображение», сведения об SVG): -webkit-touch-callout в CSS
// понимает только Safari на iPhone. Здесь меню отключаем для всех браузеров —
// на главной доске, мини-досках разбора и кнопках выбора фигуры.
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest && e.target.closest('.board-b72b1, img.piece-417db, [data-piece]')) e.preventDefault();
});
