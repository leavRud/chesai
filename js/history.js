// История партий: сохранение законченной партии, раздел «Мои партии», выгрузка PGN
// и повторный разбор старой партии.
'use strict';

/* =========================================================================
   ХРАНЕНИЕ
   Вошедший игрок — таблица game_history в Supabase (видна только ему, RLS).
   Гость — последние партии в localStorage этого браузера. Если запись в базу
   не удалась (нет сети), партия тоже ложится в браузер, чтобы не потеряться.
   ========================================================================= */
const GAME_HISTORY_KEY = 'chessGameHistory';
const GAME_HISTORY_LOCAL_LIMIT = 30;
const GAME_HISTORY_REMOTE_LIMIT = 100;
const GAME_HISTORY_PAGE = 20;
const GAME_HISTORY_COLUMNS = 'id, played_at, mode, player_color, result, reason, summary, opponent, opponent_elo, skill_level, character, pgn, moves, duration_sec, player_elo';

// Запись последней законченной (или открытой из истории) партии — для кнопок PGN в итоге.
let lastGameRecord = null;

function readLocalGames() {
  try {
    const list = JSON.parse(localStorage.getItem(GAME_HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}
function writeLocalGames(list) {
  try { localStorage.setItem(GAME_HISTORY_KEY, JSON.stringify(list.slice(0, GAME_HISTORY_LOCAL_LIMIT))); } catch (e) { /* хранилище недоступно или переполнено */ }
}

async function currentUserId() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    return session?.user?.id || null;
  } catch (e) { return null; }
}

/* ---- Запись законченной партии ---- */
const PGN_RESULT = { w: '1-0', b: '0-1', draw: '1/2-1/2' };

function pgnDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

// Имена сторон для PGN и списка: кто играл белыми, кто чёрными.
function gameSideNames(rec) {
  if (rec.mode === 'friend') return { w: t('Игрок 1'), b: t('Игрок 2') };
  const me = rec.player_name || getAccount()?.name || t('Игрок');
  const opponent = rec.mode === 'ai' ? 'Stockfish' : (rec.opponent || t('Персонаж'));
  return rec.player_color === 'w' ? { w: me, b: opponent } : { w: opponent, b: me };
}

function winnerColorOf(rec) {
  if (rec.result === 'white') return 'w';
  if (rec.result === 'black') return 'b';
  if (rec.result === 'win') return rec.player_color;
  if (rec.result === 'loss') return rec.player_color === 'w' ? 'b' : 'w';
  return null;
}

// PGN — общий формат шахматных партий: открывается в Lichess, Chess.com и любой программе.
function buildPgn(rec, sanMoves) {
  const pgnGame = new Chess();
  sanMoves.forEach((san) => pgnGame.move(san));
  const names = gameSideNames(rec);
  const winner = winnerColorOf(rec);
  const resultTag = winner ? PGN_RESULT[winner] : PGN_RESULT.draw;
  const clean = (s) => String(s).replace(/["\\]/g, '');
  const headers = ['Event', 'chesai', 'Site', 'https://chesai.ru', 'Date', pgnDate(rec.played_at),
    'White', clean(names.w), 'Black', clean(names.b), 'Result', resultTag];
  const myElo = rec.player_elo;
  const oppElo = rec.opponent_elo;
  if (rec.mode !== 'friend') {
    const whiteElo = rec.player_color === 'w' ? myElo : oppElo;
    const blackElo = rec.player_color === 'w' ? oppElo : myElo;
    if (Number.isFinite(whiteElo)) headers.push('WhiteElo', String(whiteElo));
    if (Number.isFinite(blackElo)) headers.push('BlackElo', String(blackElo));
  }
  if (rec.reason === 'time') headers.push('Termination', 'time forfeit');
  pgnGame.header(...headers);
  const pgn = pgnGame.pgn({ newline_char: '\n' }).trim();
  // Сдача и время не видны из позиции — дописываем итог в конец ходов сами.
  return pgn.endsWith(resultTag) ? pgn : `${pgn} ${resultTag}`;
}

// Собирает запись партии, которая только что закончилась.
// winner — цвет победителя ('w' | 'b') или null при ничьей.
function buildGameRecord({ reason, winner, summary }) {
  const mode = state.mode;
  const acc = getAccount();
  const playerColor = mode === 'friend' ? 'w' : state.playerColor;
  let result;
  if (mode === 'friend') result = winner === 'w' ? 'white' : winner === 'b' ? 'black' : 'draw';
  else result = !winner ? 'draw' : (winner === playerColor ? 'win' : 'loss');

  const plies = state.game.history().length;
  const rec = {
    id: `local-${Date.now()}`,
    played_at: new Date().toISOString(),
    mode,
    player_color: playerColor,
    result,
    reason,
    summary: String(summary || '').slice(0, 300),
    opponent: mode === 'characters' && state.character ? state.character.name.slice(0, 100)
      : mode === 'ai' ? 'Stockfish'
      : mode === 'online' ? (state.onlineOpponentName || t('Соперник')).slice(0, 100) : null,
    opponent_elo: mode === 'characters' && state.character ? characterGameElo() : (mode === 'ai' ? aiOpponentElo() : null),
    skill_level: mode === 'ai' ? state.skillLevel : null,
    character: mode === 'characters' && state.character ? state.character : null,
    moves: Math.ceil(plies / 2),
    duration_sec: clamp(Math.round((Date.now() - (state.gameStartedAt || Date.now())) / 1000), 0, 86400),
    player_elo: (mode === 'friend' || mode === 'online') ? null : (Number.isFinite(acc?.elo) ? acc.elo : null),
    player_name: acc?.name || null,
  };
  rec.pgn = buildPgn(rec, state.game.history());
  return rec;
}

// Возвращает изменение рейтинга ({ before, after, delta }) или null:
// рейтинг меняет база при вставке партии (см. applyRatedGameResult в account.js).
async function saveFinishedGame(rec) {
  lastGameRecord = rec;
  return insertGameRecord(rec);
}

async function insertGameRecord(rec) {
  if (!rec.moves) return null; // партия без ходов (сдача сразу) — хранить нечего
  const userId = await currentUserId();
  if (rec.uid && rec.uid !== userId) return null;
  if (userId) {
    const { player_name, id, gameKey, uid, ...row } = rec;
    const { data, error } = await sb.from('game_history').insert(row).select('id, player_elo, rating_delta').single();
    if (!error) {
      rec.id = data.id;
      invalidateAccountGameStats();
      onGameSavedForStreak(userId);
      if (getCurrentView() === 'games') renderGamesView();
      return applyRatedGameResult(data);
    }
    console.warn('Партия не сохранилась в аккаунт, оставляем в браузере:', error.message);
  }
  writeLocalGames([rec, ...readLocalGames()]);
  if (getCurrentView() === 'games') renderGamesView();
  return null;
}

/* ---- Незаконченная партия на этом устройстве ---- */
const PENDING_RATED_KEY = 'chessPendingRatedGame';
const ABANDON_MIN_OWN_MOVES = 2;
let localGameOwner = null;
let activeLocalGame = null;
const localGameTab = newLocalGameId();

function localGameKey(owner) { return `chessActiveGame:${owner || 'guest'}`; }

function newLocalGameId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readLocalGame(owner = localGameOwner) {
  try {
    const draft = JSON.parse(localStorage.getItem(localGameKey(owner)) || 'null');
    if (draft?.version === 1 && draft.owner === owner && typeof draft.id === 'string'
      && ['ai', 'characters', 'friend'].includes(draft.mode) && ['w', 'b'].includes(draft.color)
      && Array.isArray(draft.moves) && (draft.mode !== 'characters' || draft.character)) return draft;
  } catch (e) { /* Не читается сохранение */ }
  return null;
}

function writeLocalGame(draft) {
  try {
    localStorage.setItem(localGameKey(draft.owner), JSON.stringify(draft));
    return true;
  } catch (e) { return false; }
}

function setLocalGameOwner(owner) {
  localGameOwner = owner;
  // Старые версии сохраняли PGN для начисления поражения. Теперь из него
  // можно продолжить игру. В старой записи остатки времени отсутствуют.
  if (owner) {
    try {
      const rec = JSON.parse(localStorage.getItem(PENDING_RATED_KEY) || 'null');
      if (rec?.uid === owner && !readLocalGame(owner)) {
        const game = new Chess();
        if (game.load_pgn(rec.pgn) && writeLocalGame({
          version: 1, owner, id: newLocalGameId(), mode: rec.mode, color: rec.player_color,
          moves: game.history({ verbose: true }).map(uciOf), aiLevel: aiLevelFromElo(rec.opponent_elo),
          skill: rec.skill_level, character: rec.character, elapsed: (rec.duration_sec || 0) * 1000,
          abandon: rec,
        })) localStorage.removeItem(PENDING_RATED_KEY);
      }
    } catch (e) { /* Старая запись повреждена или хранилище недоступно */ }
  }
  updateResumeGameButton();
}

function resumableLocalGame() {
  return readLocalGame() || (localGameOwner ? readLocalGame(null) : null);
}

function updateResumeGameButton() {
  $id('resumeGameBtn').classList.toggle('hidden', !resumableLocalGame());
}

function claimLocalGame(saved) {
  const owner = saved ? saved.owner : localGameOwner;
  const id = saved?.id || newLocalGameId();
  const persisted = !!saved && writeLocalGame({ ...saved, tab: localGameTab });
  return { id, owner, persisted };
}

function ownsLocalGame() {
  if (!activeLocalGame?.persisted) return true;
  const draft = readLocalGame(activeLocalGame.owner);
  return draft?.id === activeLocalGame.id && draft.tab === localGameTab;
}

function saveLocalGame() {
  if (!activeLocalGame || !state.game || state.isReview || state.isGameOver || !ownsLocalGame()) return;
  const { id, owner } = activeLocalGame;
  const current = readLocalGame(owner);
  if (current && current.id !== id) return;
  const moves = state.game.history({ verbose: true });
  const rated = owner && (state.mode === 'ai' || state.mode === 'characters')
    && moves.filter(move => move.color === state.playerColor).length >= ABANDON_MIN_OWN_MOVES;
  const abandon = rated ? buildGameRecord({
    reason: 'abandon', winner: state.aiColor, summary: t('Партия брошена — засчитано поражение.'),
  }) : null;
  const saved = writeLocalGame({
    version: 1, id, owner, tab: localGameTab, mode: state.mode, color: state.playerColor,
    aiLevel: state.aiLevel, skill: state.skillLevel,
    character: state.mode === 'characters' ? state.character : null,
    characterPhase: state.characterPhase, characterEloLog: state.characterEloLog,
    moves: moves.map(uciOf), elapsed: Date.now() - state.gameStartedAt,
    clock: { enabled: state.timeLimited, white: state.timeWhite, black: state.timeBlack },
    abandon,
  });
  if (saved) activeLocalGame.persisted = true;
}

function removeLocalGame(draft) {
  if (!draft || readLocalGame(draft.owner)?.id !== draft.id) return false;
  try { localStorage.removeItem(localGameKey(draft.owner)); } catch (e) { return false; }
  return true;
}

function discardLocalGame(draft) {
  if (!removeLocalGame(draft) || !draft.abandon) return;
  insertGameRecord({ ...draft.abandon, uid: draft.owner }).then(change => {
    if (change) showToast(t('Незаконченная партия засчитана поражением. {rating}', { rating: formatRatingChange(change) }));
  });
}

function confirmNewLocalGame() {
  const draft = readLocalGame();
  if (draft?.moves.length && !confirm(replaceGameMessage(draft.abandon))) return false;
  discardLocalGame(draft);
  return true;
}

function replaceGameMessage(rated) {
  return rated
    ? t('Начать новую игру? Незаконченная партия будет засчитана поражением. Если позиция равная, можно предложить ничью.')
    : t('Начать новую игру? Текущая партия будет потеряна.');
}

$id('resumeGameBtn').addEventListener('click', () => {
  const draft = resumableLocalGame();
  if (!draft) { updateResumeGameButton(); return; }
  const test = new Chess();
  if (!draft.moves.every(uci => replayUciMove(test, uci))) {
    showToast(t('Не удалось открыть партию'));
    return;
  }
  state.mode = draft.mode;
  state.playerColor = draft.color;
  state.aiColor = oppositeColor(draft.color);
  state.aiLevel = aiLevelById(draft.aiLevel).id;
  state.skillLevel = draft.skill ?? aiLevelSkill(aiLevelById(state.aiLevel));
  state.character = draft.character || null;
  hideHomeScreen();
  initGame(draft);
});

function checkpointLocalGame() {
  if (!activeLocalGame) return;
  chargeClock();
  saveLocalGame();
}

window.addEventListener('pagehide', checkpointLocalGame);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) checkpointLocalGame();
});
window.addEventListener('storage', event => {
  if (!event.key?.startsWith('chessActiveGame:')) return;
  if (activeLocalGame && !ownsLocalGame()) {
    resetToModeSelection();
    showToast(t('Партия открыта в другой вкладке.'));
  } else updateResumeGameButton();
});

/* ---- Чтение и удаление ---- */
async function loadGameHistory() {
  const local = readLocalGames().map((g) => ({ ...g, isLocal: true }));
  const userId = await currentUserId();
  let remote = [];
  let remoteFailed = false;
  if (userId) {
    const { data, error } = await sb.from('game_history')
      .select(GAME_HISTORY_COLUMNS)
      .order('played_at', { ascending: false })
      .limit(GAME_HISTORY_REMOTE_LIMIT);
    if (error) remoteFailed = true;
    else remote = data || [];
  }
  const games = [...remote, ...local].sort((a, b) => new Date(b.played_at) - new Date(a.played_at));
  return { games, signedIn: !!userId, remoteFailed };
}

async function deleteSavedGame(rec) {
  if (rec.isLocal) {
    writeLocalGames(readLocalGames().filter((g) => g.id !== rec.id));
    return true;
  }
  const { error } = await sb.from('game_history').delete().eq('id', rec.id);
  return !error;
}

/* ---- Итоги по партиям аккаунта ----
   Счётчики достижений хранятся в браузере, поэтому на новом устройстве профиль
   показывал 0 партий. Партии в game_history общие для всех устройств. */
let accountGameStatsCache = null;
async function fetchAccountGameStats() {
  const userId = await currentUserId();
  if (!userId) return null;
  if (accountGameStatsCache?.userId === userId && Date.now() - accountGameStatsCache.at < 30000) return accountGameStatsCache.stats;
  const { data, error } = await sb.from('game_history').select('result, mode').limit(5000);
  if (error || !data) return null;
  const rated = data.filter((g) => g.mode !== 'friend');
  const stats = {
    games: data.length,
    wins: rated.filter((g) => g.result === 'win').length,
    losses: rated.filter((g) => g.result === 'loss').length,
    draws: rated.filter((g) => g.result === 'draw').length,
    rated: rated.length,
  };
  accountGameStatsCache = { userId, at: Date.now(), stats };
  return stats;
}
// После новой партии кэш устаревает
function invalidateAccountGameStats() { accountGameStatsCache = null; }

/* ---- PGN: скачать и скопировать ---- */
function pgnFileName(rec) {
  const names = gameSideNames(rec);
  const slug = (s) => String(s).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 30) || 'player';
  return `chesai-${pgnDate(rec.played_at).replace(/\./g, '-')}-${slug(names.w)}-vs-${slug(names.b)}.pgn`;
}

function downloadPgn(rec) {
  if (!rec?.pgn) return;
  const blob = new Blob([rec.pgn + '\n'], { type: 'application/x-chess-pgn' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = pgnFileName(rec);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  trackGoal('pgn_export', { via: 'download' });
}

async function copyPgn(rec) {
  if (!rec?.pgn) return;
  try {
    await navigator.clipboard.writeText(rec.pgn);
    showToast(t('PGN скопирован'));
    trackGoal('pgn_export', { via: 'copy' });
  } catch (e) {
    showToast(t('Не удалось скопировать. Скачайте файл PGN.'));
  }
}

/* =========================================================================
   РАЗДЕЛ «МОИ ПАРТИИ»
   ========================================================================= */
let gamesViewItems = [];
let gamesViewShown = 0;
let gamesViewSignedIn = false;

const GAME_REASON_LABEL = {
  mate: t('мат'), resign: t('сдача'), time: t('время'), stalemate: t('пат'), draw: t('ничья'), over: t('конец партии'), abandon: t('брошена'), agreement: t('ничья по соглашению'),
};

function gameResultBadge(rec) {
  if (rec.result === 'win') return { cls: 'win', text: t('Победа') };
  if (rec.result === 'loss') return { cls: 'loss', text: t('Поражение') };
  if (rec.result === 'white') return { cls: 'neutral', text: t('Победа белых') };
  if (rec.result === 'black') return { cls: 'neutral', text: t('Победа чёрных') };
  return { cls: 'draw', text: t('Ничья') };
}

function gameOpponentLabel(rec) {
  if (rec.mode === 'friend') return t('Вдвоём');
  const elo = Number.isFinite(rec.opponent_elo) ? ` · ≈${rec.opponent_elo}` : '';
  // Без «против»: имя персонажа произвольное, в родительный падеж его не поставить
  return (rec.mode === 'ai' ? 'Stockfish' : (rec.opponent || t('Персонаж'))) + elo;
}

function gameItemHtml(rec, i) {
  const badge = gameResultBadge(rec);
  const date = new Date(rec.played_at).toLocaleString(uiLocale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const moves = `${rec.moves} ${plural(rec.moves, 'ход', 'хода', 'ходов')}`;
  const meta = [date, moves, GAME_REASON_LABEL[rec.reason] || ''].filter(Boolean).join(' · ');
  // У гостя все партии в браузере — пометка нужна, только когда рядом есть партии из аккаунта
  const local = rec.isLocal && gamesViewSignedIn ? `<span class="game-item-local">${t('в этом браузере')}</span>` : '';
  return `
    <div class="game-item" data-index="${i}">
      <div class="game-item-head">
        <span class="game-badge game-badge--${badge.cls}">${badge.text}</span>
        <span class="game-item-title">${escapeHtml(gameOpponentLabel(rec))}</span>
      </div>
      <div class="game-item-meta">${escapeHtml(meta)}${local}</div>
      <div class="game-item-actions">
        <button class="btn btn-accent btn-sm" type="button" data-game-action="review">${t('Разобрать')}</button>
        <button class="game-icon-btn" type="button" data-game-action="download" aria-label="${t('Скачать PGN')}" title="${t('Скачать PGN')}">${achievementIconSvg('download')}</button>
        <button class="game-icon-btn" type="button" data-game-action="copy" aria-label="${t('Копировать PGN')}" title="${t('Копировать PGN')}">${achievementIconSvg('copy')}</button>
        <button class="game-icon-btn game-icon-btn--danger" type="button" data-game-action="delete" aria-label="${t('Удалить партию')}" title="${t('Удалить партию')}">${achievementIconSvg('trash')}</button>
      </div>
    </div>`;
}

function renderGamesPage() {
  const list = $id('gamesViewList');
  const next = gamesViewItems.slice(gamesViewShown, gamesViewShown + GAME_HISTORY_PAGE);
  list.insertAdjacentHTML('beforeend', next.map((rec, k) => gameItemHtml(rec, gamesViewShown + k)).join(''));
  gamesViewShown += next.length;
  $id('gamesViewMoreBtn').classList.toggle('hidden', gamesViewShown >= gamesViewItems.length);
}

async function renderGamesView() {
  const list = $id('gamesViewList');
  const note = $id('gamesViewNote');
  list.innerHTML = `<p class="modal-sub">${t('Загружаем партии…')}</p>`;
  $id('gamesViewMoreBtn').classList.add('hidden');
  const { games, signedIn, remoteFailed } = await loadGameHistory();
  gamesViewItems = games;
  gamesViewShown = 0;
  gamesViewSignedIn = signedIn;
  list.innerHTML = '';

  let noteText = '';
  if (remoteFailed) noteText = t('Не удалось загрузить партии из аккаунта. Показаны сохранённые в этом браузере.');
  else if (!signedIn) noteText = t('Партии гостя хранятся только в этом браузере. Войдите, чтобы они сохранялись в аккаунте.');
  note.textContent = noteText;
  note.classList.toggle('hidden', !noteText);

  if (!games.length) {
    list.innerHTML = `<p class="modal-sub">${t('Пока нет сохранённых партий — сыграйте хотя бы один ход, и партия появится здесь.')}</p>`;
    return;
  }
  renderGamesPage();
}

$id('gamesViewMoreBtn').addEventListener('click', () => { playSound('ui'); renderGamesPage(); });

$id('gamesViewList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-game-action]');
  if (!btn) return;
  const item = btn.closest('.game-item');
  const rec = gamesViewItems[Number(item.dataset.index)];
  if (!rec) return;
  playSound('ui');
  const action = btn.dataset.gameAction;
  if (action === 'review') openSavedGame(rec);
  else if (action === 'download') downloadPgn(rec);
  else if (action === 'copy') copyPgn(rec);
  else if (action === 'delete') {
    if (!confirm(t('Удалить эту партию из истории?'))) return;
    btn.disabled = true;
    if (await deleteSavedGame(rec)) {
      renderGamesView();
    } else {
      btn.disabled = false;
      showToast(t('Не удалось удалить партию. Попробуйте ещё раз.'));
    }
  }
});

/* =========================================================================
   ПОВТОРНЫЙ РАЗБОР СТАРОЙ ПАРТИИ
   Партия загружается на экран игры в режиме просмотра: без часов, ходов
   соперника и реплик персонажа. Разбор в этом режиме не меняет рейтинг
   и не засчитывается в достижения (см. state.isReview в analysis.js).
   ========================================================================= */
async function openSavedGame(rec) {
  if (online.started && state.mode === 'online' && !state.isGameOver) {
    showToast(t('Сначала завершите партию по ссылке'));
    return;
  }
  const source = new Chess();
  if (!rec.pgn || !source.load_pgn(rec.pgn)) {
    showToast(t('Не удалось открыть партию'));
    return;
  }
  checkpointLocalGame();
  activeLocalGame = null;
  stopTimer();
  await stopBackgroundAnalysis();

  state.mode = rec.mode;
  state.playerColor = rec.player_color;
  state.aiColor = rec.player_color === 'w' ? 'b' : 'w';
  if (Number.isFinite(rec.skill_level)) state.skillLevel = rec.skill_level;
  if (rec.mode === 'ai') state.aiLevel = aiLevelFromElo(rec.opponent_elo);
  state.character = rec.mode === 'characters' ? (rec.character || null) : null;
  state.onlineOpponentName = rec.mode === 'online' ? (rec.opponent || '') : '';

  // Проигрываем ходы заново: так собираются позиции для разбора и взятые фигуры.
  const game = new Chess();
  state.fenHistory = [game.fen()];
  state.capturedByWhite = [];
  state.capturedByBlack = [];
  source.history({ verbose: true }).forEach((m) => {
    const move = game.move(m.san);
    state.fenHistory.push(game.fen());
    if (move && move.captured) trackCapture(move);
  });
  state.game = game;
  state.isGameOver = true;
  state.isReview = true;
  state.resultText = rec.summary || '';
  state.isThinking = false;
  state.chatDisplay = [];
  state.chatApiHistory = [];
  state.gameStartedAt = Date.now() - (rec.duration_sec || 0) * 1000;
  clearAnalysisCache();
  lastGameRecord = rec;

  closeSidePanel();
  hideHomeScreen();
  hideConnectionBanner();
  $id('chatLog').innerHTML = '';
  state.board?.destroy();
  state.board = Chessboard('board', {
    draggable: false,
    position: game.fen(),
    orientation: rec.player_color === 'w' ? 'white' : 'black',
    pieceTheme: pieceThemeFn,
  });
  resetTimers();
  renderPlayerBars();
  renderMoveList();
  updateStatus();
  const date = new Date(rec.played_at).toLocaleDateString(uiLocale, { day: 'numeric', month: 'long', year: 'numeric' });
  $id('modeLabel').textContent = t('Разбор партии от {date}', { date });

  // Итог партии и сразу разбор
  const outcome = rec.result === 'win' ? 'player_win' : rec.result === 'loss' ? 'character_win' : 'draw';
  $id('resultTitle').textContent = resultTitleFor(rec.reason, outcome);
  $id('resultText').textContent = rec.summary || '';
  renderResultStats(rec.reason);
  $id('characterResultBlock').classList.add('hidden');
  hidePushAsk();
  $id('analysisBlock').classList.add('hidden');
  $id('analysisContent').innerHTML = '';
  $id('requestAnalysisBtn').textContent = t('Разобрать партию');
  // «Ещё раз» с персонажем возможен, только если сохранился его профиль
  $id('rematchBtn').classList.toggle('hidden', (rec.mode === 'characters' && !rec.character) || rec.mode === 'online');
  showModal('resultModal');
  requestAnalysis();
}

/* ---- Кнопки PGN в окне итога ---- */
$id('resultPgnDownloadBtn').addEventListener('click', () => { playSound('ui'); downloadPgn(lastGameRecord); });
$id('resultPgnCopyBtn').addEventListener('click', () => { playSound('ui'); copyPgn(lastGameRecord); });
