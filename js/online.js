// Игра с другом по ссылке (chesai.ru/?g=<id>).
// Партия хранится в Supabase (online_games, см. миграцию 20261111160000_online_games.sql):
// ходы пишутся функцией online_move по секретному токену игрока, сопернику ход
// приходит мгновенно через Realtime broadcast, а раз в несколько секунд браузер
// сверяется с базой — на случай потерянного сообщения или перезагрузки страницы.
// Вход не нужен: друг играет гостем. Часов в такой партии нет, помощник молчит до конца партии.
'use strict';

const ONLINE_ID_RE = /^[0-9a-f]{10}$/;
const ONLINE_POLL_MS = 3000;
const online = {
  id: null, token: null, color: null, started: false,
  channel: null, channelReady: false, pendingMessages: [],
  pollTimer: null, syncing: false, revision: 0, confirmedPly: 0,
};
let onlineChosenColor = 'r';

/* ---------- Мелочи ---------- */
function onlineSeatKey(id) { return `chessOnline:${id}`; }
function saveOnlineSeat(id, token, color) {
  try { localStorage.setItem(onlineSeatKey(id), JSON.stringify({ token, color })); } catch (e) { /* без хранилища не продолжить после перезагрузки */ }
}
function readOnlineSeat(id) {
  try {
    const seat = JSON.parse(localStorage.getItem(onlineSeatKey(id)) || 'null');
    return seat && seat.token && (seat.color === 'w' || seat.color === 'b') ? seat : null;
  } catch (e) { return null; }
}
function forgetOnlineSeat(id) {
  try { localStorage.removeItem(onlineSeatKey(id)); } catch (e) { /* нечего удалять */ }
}
function onlineGameUrl(id) { return appLink('g', id); }
function myOnlineName() { return (getAccount()?.name || t('Гость')).slice(0, 40); }
// Гость без аккаунта приходит с именем «Гость» — на экране зовём его просто соперником
function isGuestName(name) { return !name || name === 'Гость' || name === t('Гость'); }
function displayOpponentName(name) { return isGuestName(name) ? t('Соперник') : name; }
function oppositeColor(c) { return c === 'w' ? 'b' : 'w'; }
function uciOf(move) { return move.from + move.to + (move.promotion || ''); }
function rpcErrorCode(error) { return ((error && error.message) || '').match(/[A-Z_]{6,}/)?.[0] || ''; }

// ?g=<id> в адресе: перезагрузка страницы возвращает в ту же партию.
function setOnlineUrl(id) {
  const params = new URLSearchParams(location.search);
  if (id) params.set('g', id); else params.delete('g');
  const q = params.toString();
  history.replaceState(history.state, '', location.pathname + (q ? `?${q}` : '') + location.hash);
}

async function fetchOnlineGame(id) {
  const { data, error } = await onlineRpc('get_online_game', { p_id: id });
  if (error) throw error;
  return data?.[0] || null;
}

/* ---------- Realtime ---------- */
function connectOnlineChannel(id) {
  disconnectOnlineChannel();
  const revision = online.revision;
  online.channelReady = false;
  online.channel = sb.channel(`online-${id}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'msg' }, ({ payload }) => {
      if (revision === online.revision && payload) syncOnlineFromServer();
    })
    .subscribe((status) => {
      if (revision !== online.revision) return;
      if (status !== 'SUBSCRIBED') { online.channelReady = false; return; }
      online.channelReady = true;
      const queued = online.pendingMessages.splice(0);
      queued.forEach(sendOnlineMessage);
    });
}

function disconnectOnlineChannel() {
  if (online.channel) sb.removeChannel(online.channel);
  online.channel = null;
  online.channelReady = false;
  online.pendingMessages = [];
}

function sendOnlineMessage(payload) {
  if (!online.channel) return;
  if (!online.channelReady) { online.pendingMessages.push(payload); return; }
  online.channel.send({ type: 'broadcast', event: 'msg', payload }).catch(() => {});
}

function startOnlinePolling() {
  stopOnlinePolling();
  online.pollTimer = setInterval(() => syncOnlineFromServer(), ONLINE_POLL_MS);
}
function stopOnlinePolling() {
  clearInterval(online.pollTimer);
  online.pollTimer = null;
}

/* ---------- Очередь ходов и завершения ---------- */
const ONLINE_WRITES_PREFIX = 'chessOnlineWrites:';
const onlineWrites = new Map();
let onlineRetryTimer = null;

function restoreOnlineWrites() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(ONLINE_WRITES_PREFIX)) continue;
      const id = key.slice(ONLINE_WRITES_PREFIX.length);
      try {
        const write = JSON.parse(localStorage.getItem(key));
        if (ONLINE_ID_RE.test(id) && write?.token && (write.move || write.finish) && !onlineWrites.has(id)) {
          onlineWrites.set(id, { ...write, id, sending: false });
        }
      } catch (e) { /* Одна повреждённая запись не мешает восстановить другие. */ }
    }
  } catch (e) { /* При закрытом хранилище очередь работает в памяти. */ }
  if (onlineWrites.size && !onlineRetryTimer) onlineRetryTimer = setInterval(retryOnlineWrites, ONLINE_POLL_MS);
  retryOnlineWrites();
}

function saveOnlineWrites(write) {
  const { id, token, move, finish } = write;
  const pending = move || finish;
  if (!pending) onlineWrites.delete(id);
  try {
    const key = ONLINE_WRITES_PREFIX + id;
    if (pending) localStorage.setItem(key, JSON.stringify({ token, move, finish }));
    else localStorage.removeItem(key);
  } catch (e) { /* Переподключение продолжит отправку из памяти. */ }
  if (onlineWrites.size && !onlineRetryTimer) onlineRetryTimer = setInterval(retryOnlineWrites, ONLINE_POLL_MS);
  if (!onlineWrites.size && onlineRetryTimer) {
    clearInterval(onlineRetryTimer);
    onlineRetryTimer = null;
  }
}

function onlineHasPending() {
  const write = onlineWrites.get(online.id);
  return !!(write?.move || write?.finish);
}

function onlineWriteForCurrentGame() {
  let write = onlineWrites.get(online.id);
  if (!write) {
    write = { id: online.id, token: online.token, move: null, finish: null, sending: false };
    onlineWrites.set(write.id, write);
  }
  return write;
}

function retryOnlineWrites() {
  for (const write of onlineWrites.values()) flushOnlineWrites(write);
}

window.addEventListener('online', () => {
  retryOnlineWrites();
  if (online.id) syncOnlineFromServer();
  else if (!state.game && !pendingOnlineInvite) openOnlineGameFromUrl();
});

async function onlineRpc(name, params) {
  const request = sb.rpc(name, params);
  if (typeof request.abortSignal === 'function' && typeof AbortSignal.timeout === 'function') {
    return request.abortSignal(AbortSignal.timeout(8000));
  }
  return request;
}

function showOnlineWriteStatus(text) {
  const status = $id('connectionBannerText');
  if (status.textContent !== text) status.textContent = text;
  $id('connectionBanner').classList.remove('hidden');
}

async function flushOnlineWrites(write) {
  if (write.sending) return;
  write.sending = true;
  const { id, token } = write;
  try {
    if (write.move) {
      const { ply, uci } = write.move;
      const { error } = await onlineRpc('online_move', { p_id: id, p_token: token, p_ply: ply, p_move: uci });
      if (error) {
        const code = rpcErrorCode(error);
        if (!['OUT_OF_SYNC', 'NOT_YOUR_TURN', 'NOT_ACTIVE', 'BAD_MOVE', 'BAD_TOKEN', 'NOT_FOUND'].includes(code)) throw error;
        const row = await fetchOnlineGame(id);
        const applied = row?.moves?.[ply - 1] === uci;
        if (!applied && write.finish?.reason !== 'resign') write.finish = null;
        if (row?.status !== 'active' || code === 'BAD_TOKEN') write.finish = null;
        if (applied && online.id === id) {
          online.confirmedPly = Math.max(online.confirmedPly, ply);
          sendOnlineMessage({ type: 'move' });
        } else if (online.id === id && row?.status === 'active') {
          showToast(t('Сервер отклонил ход. Позиция обновлена.'));
        }
      } else if (online.id === id) {
        online.confirmedPly = Math.max(online.confirmedPly, ply);
        sendOnlineMessage({ type: 'move' });
      }
      write.move = null;
      // Если закрыли вкладку между сохранением хода и отправкой сдачи,
      // после перезапуска повторяем только оставшуюся операцию.
      saveOnlineWrites(write);
    }
    if (write.finish) {
      const { result, reason } = write.finish;
      const { error } = await onlineRpc('online_finish', { p_id: id, p_token: token, p_result: result, p_reason: reason });
      if (error && !['NOT_FOUND', 'BAD_TOKEN'].includes(rpcErrorCode(error))) throw error;
      write.finish = null;
      saveOnlineWrites(write);
      if (!error && online.id === id) sendOnlineMessage({ type: 'finish' });
    }
    if (online.id === id) {
      hideConnectionBanner();
      syncOnlineFromServer();
    }
  } catch (e) {
    if (online.id === id) showOnlineWriteStatus(t('Связь прервалась. Повторим отправку автоматически.'));
  } finally {
    write.sending = false;
    saveOnlineWrites(write);
  }
}

function onlineSendMove(move) {
  const write = onlineWriteForCurrentGame();
  write.move = { ply: state.game.history().length, uci: uciOf(move) };
  saveOnlineWrites(write);
  flushOnlineWrites(write);
}

function onlineReportFinish(result, reason) {
  if (!online.id) return;
  const write = onlineWriteForCurrentGame();
  if (write.finish) return;
  write.finish = { result: result || 'draw', reason };
  saveOnlineWrites(write);
  updateResignButtonLabel();
  showOnlineWriteStatus(t('Подтверждаем завершение партии…'));
  flushOnlineWrites(write);
}

function reportOnlineBoardEnd(allowPendingMove = false) {
  if (!state.game.game_over() || (!allowPendingMove && onlineHasPending())) return;
  const winner = state.game.in_checkmate() ? oppositeColor(state.game.turn()) : null;
  onlineReportFinish(winner, winner ? 'mate' : state.game.in_stalemate() ? 'stalemate' : 'draw');
}

/* ---------- Сверка с базой ---------- */
async function syncOnlineFromServer() {
  if (!online.id || online.syncing) return;
  const id = online.id;
  const revision = online.revision;
  const game = state.game;
  online.syncing = true;
  try {
    const row = await fetchOnlineGame(id);
    if (revision !== online.revision || online.id !== id || !row) return;
    if (!online.started) {
      if (row.status !== 'waiting') startOnlineGame(row);
      return;
    }
    if (state.mode !== 'online' || state.game !== game) return;
    const remote = row.moves || [];
    if (remote.length < online.confirmedPly) return;
    online.confirmedPly = remote.length;
    const local = state.game.history({ verbose: true }).map(uciOf);
    const pendingMove = onlineWrites.get(id)?.move;
    const hasOptimisticMove = row.status === 'active' && pendingMove?.ply === local.length && local.at(-1) === pendingMove.uci;
    const samePrefix = remote.slice(0, local.length).every((move, i) => move === local[i]);
    if (!samePrefix || (remote.length < local.length && !hasOptimisticMove)) {
      rebuildOnlineGame(remote);
    } else {
      for (const uci of remote.slice(local.length)) {
        if (!applyRemoteMove(uci)) { rebuildOnlineGame(remote); break; }
      }
    }
    if (row.status === 'finished') {
      const write = onlineWrites.get(id);
      if (write) {
        write.move = null;
        write.finish = null;
        saveOnlineWrites(write);
      }
      hideConnectionBanner();
      if (!state.isGameOver) finishFromServer(row);
      stopOnlinePolling();
    } else {
      applyOnlineDrawOffer(row.draw_offer_by || null);
      reportOnlineBoardEnd();
    }
  } catch (e) {
    // Нет сети — попробуем на следующем такте.
  } finally {
    if (revision === online.revision) online.syncing = false;
  }
}

function applyRemoteMove(uci) {
  const move = replayUciMove(state.game, uci);
  if (!move) return false;
  state.fenHistory.push(state.game.fen());
  onMoveMade(move, false);
  return true;
}

function rebuildOnlineGame(moves) {
  closePromotionPicker();
  state.game = new Chess();
  state.fenHistory = [state.game.fen()];
  state.capturedByWhite = [];
  state.capturedByBlack = [];
  replayGameMoves(moves);
}

// Соперник сдался, согласились на ничью (или конец партии, который мы пропустили).
function finishFromServer(row) {
  if (row.reason === 'agreement') {
    forgetOnlineSeat(online.id);
    finishDrawByAgreement(); // draws.js
    return;
  }
  const winner = row.result;
  if (row.reason !== 'resign' && checkGameOver({ fromOnlineServer: true })) {
    forgetOnlineSeat(online.id);
    return;
  }
  const iWon = winner === state.playerColor;
  const name = state.onlineOpponentName || t('Соперник');
  state.isGameOver = true;
  stopTimer();
  updateResignButtonLabel();
  stopBackgroundAnalysis();
  reportAchievementGameEnd('draw');
  forgetOnlineSeat(online.id);
  const outcome = winner === 'draw' ? 'draw' : iWon ? 'player_win' : 'character_win';
  const text = row.reason === 'resign'
    ? (iWon ? t('{name} сдаётся. Вы победили!', { name }) : t('Вы сдались.'))
    : t('Партия окончена.');
  showResultModal(text, outcome, row.reason, winner === 'draw' ? null : winner);
}

/* ---------- Ничья по соглашению ----------
   Предложение хранится в партии на сервере: сообщение Realtime только
   будит соперника, а что на самом деле предложено — он берёт из базы. */
async function onlineDrawRpc(fn, args) {
  if (!online.id || onlineHasPending()) return null;
  const revision = online.revision;
  const { data, error } = await sb.rpc(fn, { p_id: online.id, p_token: online.token, ...args });
  if (revision !== online.revision) return null;
  if (error) {
    if (rpcErrorCode(error) === 'TOO_EARLY') showToast(t('Ничью можно предложить с 10-го хода'));
    console.warn('Ничья в партии по ссылке:', error.message);
    return null;
  }
  sendOnlineMessage({ type: 'draw' });
  if (data === 'agreed') syncOnlineFromServer();
  return data;
}
function onlineOfferDraw() { return onlineDrawRpc('online_offer_draw', {}); }
function onlineAnswerDraw(accept) { return onlineDrawRpc('online_answer_draw', { p_accept: !!accept }); }

/* ---------- Начало партии ---------- */
function startOnlineGame(row) {
  checkpointLocalGame();
  online.started = true;
  hideModal('friendModal');
  hideModal('onlineJoinModal');
  state.mode = 'online';
  state.playerColor = online.color;
  state.aiColor = oppositeColor(online.color);
  const iAmCreator = online.color === row.creator_color;
  state.onlineOpponentName = displayOpponentName(iAmCreator ? row.joiner_name : row.creator_name);
  hideHomeScreen();
  initGame();
  const moves = row.moves || [];
  online.confirmedPly = moves.length;
  const pending = onlineWrites.get(online.id);
  const pendingMove = pending?.move;
  replayGameMoves(row.status === 'active' && pendingMove?.ply === moves.length + 1 ? [...moves, pendingMove.uci] : moves);
  if (row.status === 'finished') {
    finishFromServer(row);
    return;
  }
  applyOnlineDrawOffer(row.draw_offer_by || null);
  startOnlinePolling();
  if (pending) {
    showOnlineWriteStatus(t('Связь прервалась. Повторим отправку автоматически.'));
    updateResignButtonLabel();
    flushOnlineWrites(pending);
  } else reportOnlineBoardEnd();
}

// Уходим из партии (новая игра, главный экран). Незаконченная партия — сдача.
function leaveOnlineGame() {
  if (!online.id) return;
  if (online.started && state.mode === 'online' && state.game && !state.isGameOver && !state.game.game_over()) {
    onlineReportFinish(null, 'resign');
  }
  detachOnlineGame();
}

function detachOnlineGame() {
  stopOnlinePolling();
  disconnectOnlineChannel();
  online.revision++;
  online.id = null;
  online.token = null;
  online.started = false;
  online.syncing = false;
  online.confirmedPly = 0;
  setOnlineUrl(null);
}

/* =========================================================================
   ОКНО «ИГРА С ДРУГОМ»
   ========================================================================= */
function syncOnlineColorButtons() {
  document.querySelectorAll('#onlineColorRow .color-choice-btn').forEach(b => {
    const active = b.dataset.color === onlineChosenColor;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}

function showFriendStep(step) {
  $id('friendChoiceStep').classList.toggle('hidden', step !== 'choice');
  $id('friendWaitStep').classList.toggle('hidden', step !== 'wait');
}

function openFriendModal() {
  $id('friendError').classList.add('hidden');
  $id('onlineCreateBtn').disabled = false;
  syncOnlineColorButtons();
  showFriendStep('choice');
  showModal('friendModal');
}

function showOnlineWaiting(id) {
  $id('onlineLinkInput').value = onlineGameUrl(id);
  showFriendStep('wait');
  showModal('friendModal');
  $id('onlineLinkInput').focus({ preventScroll: true });
}

document.querySelectorAll('#onlineColorRow .color-choice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    playSound('ui');
    onlineChosenColor = btn.dataset.color;
    syncOnlineColorButtons();
  });
});

$id('friendLocalBtn').addEventListener('click', () => {
  playSound('ui');
  if (!confirmNewLocalGame()) return;
  hideModal('friendModal');
  state.mode = 'friend';
  state.playerColor = 'w';
  state.aiColor = 'b';
  hideHomeScreen();
  initGame();
});

$id('friendBackBtn').addEventListener('click', () => { playSound('ui'); hideModal('friendModal'); });

$id('onlineCreateBtn').addEventListener('click', async () => {
  playSound('ui');
  const btn = $id('onlineCreateBtn');
  btn.disabled = true;
  $id('friendError').classList.add('hidden');
  const { data, error } = await sb.rpc('create_online_game', { p_color: onlineChosenColor, p_name: myOnlineName() });
  btn.disabled = false;
  const row = data?.[0];
  if (error || !row) {
    $id('friendError').textContent = t('Не удалось создать партию. Проверьте интернет и попробуйте ещё раз.');
    $id('friendError').classList.remove('hidden');
    playSound('error');
    return;
  }
  online.id = row.id;
  online.token = row.token;
  online.color = row.color;
  online.started = false;
  saveOnlineSeat(row.id, row.token, row.color);
  setOnlineUrl(row.id);
  connectOnlineChannel(row.id);
  startOnlinePolling();
  showOnlineWaiting(row.id);
  trackGoal('online_create');
});

$id('onlineShareBtn').addEventListener('click', async () => {
  playSound('ui');
  if (!online.id) return;
  const outcome = await shareOrCopy({
    title: 'chesai',
    text: t('Сыграем в шахматы? Я жду тебя за доской:'),
    url: onlineGameUrl(online.id),
  });
  if (outcome === 'copied') showToast(t('Ссылка скопирована — отправьте её другу'));
  if (outcome === 'shared' || outcome === 'copied') trackGoal('online_share', { via: outcome });
});

$id('onlineCopyBtn').addEventListener('click', async () => {
  playSound('ui');
  const input = $id('onlineLinkInput');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (e) {
    input.select();
    document.execCommand('copy');
  }
  showToast(t('Ссылка скопирована — отправьте её другу'));
});

// Отмена приглашения: партия останется в базе неначатой и удалится через 3 дня.
$id('onlineCancelBtn').addEventListener('click', () => {
  playSound('ui');
  if (online.id) forgetOnlineSeat(online.id);
  detachOnlineGame();
  hideModal('friendModal');
});

/* ---------- Приглашение по ссылке ---------- */
let pendingOnlineInvite = null;
let onlineOpenRetry = null;

async function openOnlineGameFromUrl(retry = false) {
  clearTimeout(onlineOpenRetry);
  if (retry && (state.game || online.id)) return;
  const id = new URLSearchParams(location.search).get('g');
  if (id === null) return;
  if (!ONLINE_ID_RE.test(id)) { setOnlineUrl(null); showToast(t('Ссылка на партию повреждена')); return; }
  let row;
  const game = state.game;
  try {
    row = await fetchOnlineGame(id);
  } catch (e) {
    if (!retry) showToast(t('Не удалось открыть партию. Проверьте интернет'));
    if (readOnlineSeat(id)) onlineOpenRetry = setTimeout(() => openOnlineGameFromUrl(true), ONLINE_POLL_MS);
    return;
  }
  if (new URLSearchParams(location.search).get('g') !== id || online.id || state.game !== game) return;
  if (!row) { setOnlineUrl(null); showToast(t('Партия по ссылке не найдена')); return; }

  const seat = readOnlineSeat(id);
  if (seat) {
    // Своя партия: создатель обновил страницу или игрок вернулся к доске
    online.id = id;
    online.token = seat.token;
    online.color = seat.color;
    online.started = false;
    connectOnlineChannel(id);
    if (row.status === 'waiting') { startOnlinePolling(); showOnlineWaiting(id); }
    else startOnlineGame(row);
    return;
  }
  if (row.status !== 'waiting') {
    setOnlineUrl(null);
    showToast(row.status === 'active' ? t('В этой партии уже играют двое') : t('Эта партия уже закончилась'));
    return;
  }
  pendingOnlineInvite = { id, row };
  const myColor = oppositeColor(row.creator_color);
  $id('onlineJoinTitle').textContent = isGuestName(row.creator_name)
    ? t('Вас зовут сыграть в шахматы')
    : t('{name} зовёт вас сыграть в шахматы', { name: row.creator_name });
  $id('onlineJoinText').textContent = myColor === 'w'
    ? t('Вы играете белыми и ходите первым. Регистрация не нужна.')
    : t('Вы играете чёрными. Регистрация не нужна.');
  $id('onlineJoinError').classList.add('hidden');
  $id('onlineJoinBtn').disabled = false;
  showModal('onlineJoinModal');
  trackGoal('online_link_open');
}

$id('onlineJoinBtn').addEventListener('click', async () => {
  playSound('ui');
  if (!pendingOnlineInvite) return;
  const { id, row } = pendingOnlineInvite;
  const btn = $id('onlineJoinBtn');
  btn.disabled = true;
  const name = myOnlineName();
  const { data, error } = await sb.rpc('join_online_game', { p_id: id, p_name: name });
  const seat = data?.[0];
  if (error || !seat) {
    btn.disabled = false;
    const code = rpcErrorCode(error);
    $id('onlineJoinError').textContent = code === 'NOT_WAITING'
      ? t('Кто-то уже занял место за доской. Попросите друга прислать новую ссылку.')
      : t('Не получилось присоединиться. Проверьте интернет и попробуйте ещё раз.');
    $id('onlineJoinError').classList.remove('hidden');
    playSound('error');
    return;
  }
  pendingOnlineInvite = null;
  online.id = id;
  online.token = seat.token;
  online.color = seat.color;
  online.started = false;
  saveOnlineSeat(id, seat.token, seat.color);
  connectOnlineChannel(id);
  sendOnlineMessage({ type: 'joined' });
  trackGoal('online_join');
  startOnlineGame({ ...row, status: 'active', joiner_name: name, moves: [] });
});

$id('onlineJoinLaterBtn').addEventListener('click', () => {
  playSound('ui');
  pendingOnlineInvite = null;
  setOnlineUrl(null);
  hideModal('onlineJoinModal');
});
