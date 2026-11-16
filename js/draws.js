// Ничья по соглашению: кнопка «Ничья», предложения соперника и ответы на них.
//
// Кто решает:
//  - персонаж — нейросеть в его образе (и отвечает на предложение, и сама
//    решает, предложить ли ничью), с оценкой позиции от Stockfish;
//  - Stockfish — по оценке позиции: принимает, если не лучше (слабые уровни
//    соглашаются и при небольшом перевесе), сам предлагает в мёртвой равной позиции;
//  - игра вдвоём — второй игрок на том же экране;
//  - партия по ссылке — соперник; предложение хранится на сервере (online.js).
// Правила для всех режимов:
//  - предложить можно с 10-го хода (раньше ничья по соглашению — способ уйти
//    от поражения в рейтинговой партии) и не чаще раза в 5 ходов;
//  - против Stockfish и персонажа — только в свой ход: соперник отвечает,
//    пока часы стоят, а доска ждёт ответа;
//  - предложение соперника остаётся в силе, пока игрок не сделает ход: ход — отказ.
'use strict';

const DRAW_MIN_PLY = 20;          // с 10-го хода
const DRAW_COOLDOWN_PLIES = 10;   // новое предложение той же стороны — через 5 ходов
const CHARACTER_DRAW_CHECK_EVERY = 8;   // персонаж задумывается о ничьей не чаще раза в 4 хода
const CHARACTER_DRAW_AFTER_DECLINE = 20; // после отказа игрока — не раньше чем через 10 ходов

const drawState = {
  offer: null,        // { from: 'player' | 'opponent' | 'w' | 'b', ply }
  deciding: false,    // соперник обдумывает предложение игрока — доска ждёт
  lastOffer: {},      // кто → полуход последнего предложения (для паузы между предложениями)
  lastCharacterCheck: -99,
  declinedByPlayer: 0, // сколько раз игрок отказал персонажу — нейросеть это учитывает
  gameStartedAt: null,
};

function drawPlies() { return state.game ? state.game.history().length : 0; }
function drawSideName(color) { return color === 'w' ? t('Белые') : t('Чёрные'); }
function drawOpponentName() {
  if (state.mode === 'characters' && state.character) return state.character.name;
  if (state.mode === 'online') return state.onlineOpponentName || t('Соперник');
  return 'Stockfish';
}

/* ---------- Состояние и кнопка ---------- */
function resetDrawState() {
  drawState.offer = null;
  drawState.deciding = false;
  drawState.lastOffer = {};
  drawState.lastCharacterCheck = -99;
  drawState.declinedByPlayer = 0;
  drawState.gameStartedAt = state.gameStartedAt;
  renderDrawUi();
}

function clearDrawOffer() {
  drawState.offer = null;
  renderDrawUi();
}

// Кто предлагает, нажимая кнопку: в игре вдвоём — сторона, чей ход
function drawOffererKey() {
  if (state.mode === 'friend') return state.game.turn();
  return 'player';
}

// Почему сейчас нельзя предложить ничью ('' — можно)
function drawBlockReason() {
  if (!state.game || state.isGameOver || state.isReview) return t('Партия окончена');
  if (drawPlies() < DRAW_MIN_PLY) return t('Ничью можно предложить с 10-го хода');
  if (drawState.deciding) return t('Соперник обдумывает предложение');
  if (drawState.offer) return t('Предложение ничьей уже сделано');
  if ((state.mode === 'ai' || state.mode === 'characters') && (state.game.turn() !== state.playerColor || state.isThinking)) {
    return t('Предложить ничью можно в свой ход');
  }
  const last = drawState.lastOffer[drawOffererKey()];
  if (last != null && drawPlies() - last < DRAW_COOLDOWN_PLIES) return t('Новое предложение — через несколько ходов');
  return '';
}

function renderDrawUi() {
  const btn = $id('drawBtn');
  if (btn) {
    // Не disabled: по нажатию на неактивную кнопку покажем, почему сейчас нельзя
    const reason = drawBlockReason();
    btn.classList.toggle('is-unavailable', !!reason);
    btn.setAttribute('aria-disabled', String(!!reason));
    btn.title = reason || t('Предложить ничью');
    btn.classList.toggle('hidden', !state.game || state.isReview);
  }
  const banner = $id('drawOfferBanner');
  if (!banner) return;
  const offer = drawState.offer;
  if (!offer || state.isGameOver) { banner.classList.add('hidden'); return; }
  let text = '';
  let canAnswer = true;
  if (state.mode === 'friend') {
    const from = offer.from;
    text = t('{from} предлагают ничью. {to}, принимаете?', { from: drawSideName(from), to: drawSideName(from === 'w' ? 'b' : 'w') });
  } else if (offer.from === 'opponent') {
    text = t('{name} предлагает ничью.', { name: drawOpponentName() });
  } else {
    text = t('Вы предложили ничью. Ждём ответа соперника.');
    canAnswer = false;
  }
  $id('drawOfferText').textContent = text;
  $id('drawAcceptBtn').classList.toggle('hidden', !canAnswer);
  $id('drawDeclineBtn').classList.toggle('hidden', !canAnswer);
  banner.classList.remove('hidden');
}

// Пока соперник думает над предложением: часы стоят, доска ждёт
function startDrawDecision(statusText) {
  drawState.deciding = true;
  stopTimer();
  setThinkingUI(true);
  $id('statusText').textContent = statusText;
  renderDrawUi();
}
function endDrawDecision() {
  drawState.deciding = false;
  setThinkingUI(false);
  if (!state.isGameOver) { startTimer(); updateStatus(); }
  renderDrawUi();
}

/* ---------- Итог ---------- */
function finishDrawByAgreement() {
  if (!state.game || state.isGameOver) return;
  drawState.offer = null;
  drawState.deciding = false;
  state.isGameOver = true;
  stopTimer();
  setThinkingUI(false);
  updateResignButtonLabel();
  stopBackgroundAnalysis();
  reportAchievementGameEnd('draw');
  let text;
  if (state.mode === 'friend') text = t('Ничья по соглашению.');
  else if (state.mode === 'ai') text = t('Ничья по соглашению со Stockfish.');
  else text = t('Ничья по соглашению: {name}.', { name: drawOpponentName() });
  showResultModal(text, 'draw', 'agreement', null);
}

/* ---------- Оценка позиции для решений соперника ---------- */
// Оценка Stockfish с точки зрения стороны color: сантипешки (мат — ±100000-N)
async function drawEvalFor(color) {
  const fen = state.game.fen();
  let entry = analysisCache.get(fen);
  if (!entry || entry.score == null || entry.depth < 10) {
    await waitForEngine(3000);
    // Не дольше 4 секунд: доска и часы ждут этого решения, а движок может
    // быть занят — тогда берём то, что уже есть в кэше (или решаем без оценки)
    const fresh = await Promise.race([
      analyzePosition(fen, { movetime: 500, minDepth: 10 }),
      new Promise(resolve => setTimeout(() => resolve(null), 4000)),
    ]);
    entry = fresh || analysisCache.get(fen) || entry;
  }
  const abs = scoreAbsoluteWhite(entry, fen);
  if (abs == null) return null;
  return color === 'w' ? abs : -abs;
}

// «ты выигрываешь, примерно +2.3» — словами для нейросети
function describeEvalForCharacter(cp) {
  if (cp == null) return 'оценка позиции неизвестна';
  if (cp > 50000) return `у тебя форсированный мат в ${100000 - cp} ходов`;
  if (cp < -50000) return `тебе грозит форсированный мат в ${cp + 100000} ходов`;
  const pawns = (Math.abs(cp) / 100).toFixed(1);
  if (Math.abs(cp) <= 40) return 'позиция примерно равная';
  if (cp > 0) return cp >= 300 ? `ты заметно выигрываешь, примерно на ${pawns} пешки` : `у тебя небольшой перевес, примерно на ${pawns} пешки`;
  return cp <= -300 ? `ты заметно проигрываешь, примерно на ${pawns} пешки` : `ты чуть хуже, примерно на ${pawns} пешки`;
}

function nonPawnPieces() {
  let n = 0;
  for (const row of state.game.board()) for (const sq of row) if (sq && sq.type !== 'p' && sq.type !== 'k') n++;
  return n;
}

/* ---------- Stockfish ---------- */
// Принимает, если не лучше; слабые уровни (как живые новички) соглашаются и
// при небольшом перевесе: 400 → до +1.3, 1200 → до +0.5, от 1600 → только равенство.
async function stockfishAcceptsDraw() {
  const level = currentAiLevel();
  const cp = await drawEvalFor(state.aiColor);
  if (cp == null || cp > 50000) return false;
  const threshold = level.max ? 10 : 10 + Math.max(0, 1600 - level.elo) / 10;
  return cp <= threshold;
}

// Сам предлагает только в мёртвой равной позиции: с 30-го хода, мало фигур, оценка ±0.15
async function stockfishWantsDraw() {
  if (drawPlies() < 60 || nonPawnPieces() > 6) return false;
  const cp = await drawEvalFor(state.aiColor);
  return cp != null && Math.abs(cp) <= 15;
}

/* ---------- Персонаж: решает нейросеть ---------- */
function characterClockLine() {
  if (!clockEnabled()) return '';
  const mine = state.aiColor === 'w' ? state.timeWhite : state.timeBlack;
  const theirs = state.aiColor === 'w' ? state.timeBlack : state.timeWhite;
  return ` На часах: у тебя ${formatTime(mine)}, у собеседника ${formatTime(theirs)}.`;
}

// kind: 'respond' — ответить на предложение игрока; 'offer' — решить, предлагать ли самому.
// Возвращает { yes, message } или null, если нейросеть недоступна.
async function askCharacterAboutDraw(kind, cp) {
  const c = state.character;
  const drawishness = Number.isFinite(c.drawishness) ? c.drawishness : 30;
  const situation = `Оценка Stockfish для тебя: ${describeEvalForCharacter(cp)}. Идёт ${Math.floor(drawPlies() / 2) + 1}-й ход.${characterClockLine()} Твоя склонность к ничьим: ${drawishness} из 100.`;
  const task = kind === 'respond'
    ? `[Событие: собеседник нажал кнопку «Ничья» — это официальное предложение ничьей прямо сейчас. Твоё решение сразу закончит партию или продолжит её; не отправляй его ничего нажимать.]
[Реши в своём характере, соглашаться ли. Позиция важна: при заметном перевесе обычно играют дальше, в равной или худшей позиции ничья разумна; характер может перевесить. Ответь строго JSON без разметки: {"accept": true или false, "message": "что ты говоришь собеседнику в ответ, 1–2 предложения"}]`
    : `[Событие: сейчас ты можешь официально предложить собеседнику ничью — программа покажет ему твоё предложение с кнопками «Принять» и «Отклонить». Он уже отказывал тебе в ничьей ${drawState.declinedByPlayer} раз.]
[Реши в своём характере, хочешь ли предложить ничью прямо сейчас. Предлагай, только если это разумно по позиции или очень в твоём характере; без причины не предлагай. Ответь строго JSON без разметки: {"offer": true или false, "message": "что ты скажешь собеседнику, предлагая ничью, 1–2 предложения (пусто, если не предлагаешь)"}]`;
  const messages = [
    { role: 'system', content: buildCharacterPersonaPrompt({ forDrawDecision: true }) },
    ...trimHistory(state.chatApiHistory, 8),
    { role: 'user', content: `[Фон: ${describeGameForCharacter()}]\n[${situation}]\n${task}` },
  ];
  try {
    const raw = await provodChat(messages, { temperature: 0.8, kind: 'game', task: 'character' });
    const parsed = JSON.parse(extractJson(raw));
    const yes = kind === 'respond' ? parsed.accept === true || parsed.accept === 'true' : parsed.offer === true || parsed.offer === 'true';
    const message = stripMarkdown(String(parsed.message || '')).replace(/^["«]+|["»]+$/g, '').trim();
    return { yes, message };
  } catch (error) {
    console.error('Нейросеть не решила про ничью:', error);
    return null;
  }
}

async function sayAsCharacter(message) {
  if (!message) return;
  state.chatApiHistory.push({ role: 'assistant', content: message });
  state.pliesSinceCharacterSpoke = 0;
  state.lastAutoReplyTime = Date.now();
  await appendChatMessage('character', message, { typewriter: true });
}

/* ---------- Игрок нажал «Ничья» ---------- */
async function offerDrawFromPlayer() {
  if (drawBlockReason()) return;
  const ply = drawPlies();
  const startedAt = state.gameStartedAt;
  drawState.lastOffer[drawOffererKey()] = ply;

  if (state.mode === 'friend') {
    drawState.offer = { from: state.game.turn(), ply };
    renderDrawUi();
    return;
  }
  if (state.mode === 'online') {
    drawState.offer = { from: 'player', ply, at: Date.now() };
    renderDrawUi();
    const result = await onlineOfferDraw(); // online.js
    if (result === 'agreed') return; // встречное предложение — партию закончит сверка с сервером
    if (result !== 'offered') { clearDrawOffer(); showToast(t('Не удалось предложить ничью. Попробуйте ещё раз.')); }
    return;
  }

  logSystemChat(t('Вы предложили ничью.'));
  if (state.mode === 'ai') {
    startDrawDecision(t('Stockfish обдумывает предложение ничьей…'));
    const t0 = Date.now();
    const accept = await stockfishAcceptsDraw();
    await new Promise(r => setTimeout(r, Math.max(0, 900 - (Date.now() - t0))));
    if (startedAt !== state.gameStartedAt || state.isGameOver) return;
    endDrawDecision();
    if (accept) { logSystemChat(t('Stockfish принимает ничью.')); finishDrawByAgreement(); }
    else { logSystemChat(t('Stockfish отклоняет ничью — игра продолжается.')); showToast(t('Stockfish отклоняет ничью')); }
    return;
  }

  // Персонаж: решает нейросеть в его образе
  const name = state.character ? state.character.name : t('Персонаж');
  startDrawDecision(t('{name} обдумывает предложение ничьей…', { name }));
  setCharacterTyping(true);
  const cp = await drawEvalFor(state.aiColor);
  let decision = await askCharacterAboutDraw('respond', cp);
  if (startedAt !== state.gameStartedAt || state.isGameOver) return;
  setCharacterTyping(false);
  if (!decision) {
    // Нейросеть недоступна — решаем по позиции и склонности к ничьим
    const drawish = (state.character.drawishness ?? 30) >= 60;
    const yes = cp != null && cp < 50000 && (cp <= -50 || (Math.abs(cp) <= 30 && drawish));
    decision = { yes, message: yes ? t('Ничья? Пожалуй, соглашусь.') : t('Нет, я ещё поиграю.') };
  }
  endDrawDecision();
  await sayAsCharacter(decision.message);
  if (startedAt !== state.gameStartedAt || state.isGameOver) return;
  if (decision.yes) finishDrawByAgreement();
  else showToast(t('{name} отклоняет ничью', { name }));
}

/* ---------- Ответ игрока на предложение соперника ---------- */
async function answerDrawOffer(accept) {
  const offer = drawState.offer;
  if (!offer || state.isGameOver) return;
  if (state.mode === 'online') {
    clearDrawOffer();
    const result = await onlineAnswerDraw(accept); // online.js
    if (!accept && result !== 'declined') syncOnlineFromServer();
    return;
  }
  if (accept) { finishDrawByAgreement(); return; }
  clearDrawOffer();
  if (state.mode === 'friend') { showToast(t('Ничья отклонена — игра продолжается')); return; }
  drawState.declinedByPlayer++;
  logSystemChat(t('Вы отклонили ничью.'));
  if (state.mode === 'characters') characterReact('собеседник отклонил твоё предложение ничьей.', true);
}

/* ---------- После каждого хода ---------- */
// Вызывается из onMoveMade (game.js) после проверки конца партии.
function drawAfterMove(move, isUserMove, isOver) {
  if (isOver) { clearDrawOffer(); return; }
  const offer = drawState.offer;
  if (offer) {
    // Ход того, кому предложили, — отказ
    const receiverMoved = state.mode === 'friend'
      ? move.color !== offer.from
      : (offer.from === 'opponent' && isUserMove) || (offer.from === 'player' && !isUserMove);
    if (receiverMoved) {
      clearDrawOffer();
      if (state.mode === 'ai' || state.mode === 'characters') {
        drawState.declinedByPlayer++;
        logSystemChat(t('Вы продолжили партию — предложение ничьей отклонено.'));
      }
    }
  }
  renderDrawUi();
  if (!isUserMove && (state.mode === 'ai' || state.mode === 'characters')) maybeOpponentOffersDraw();
}

// Соперник сам решает, предложить ли ничью (после своего хода, в ход игрока)
async function maybeOpponentOffersDraw() {
  const ply = drawPlies();
  const startedAt = state.gameStartedAt;
  if (ply < DRAW_MIN_PLY || drawState.offer || drawState.deciding || state.isGameOver) return;
  const last = drawState.lastOffer.opponent;
  if (last != null && ply - last < CHARACTER_DRAW_AFTER_DECLINE) return;
  const stillCurrent = () => startedAt === state.gameStartedAt && !state.isGameOver && drawPlies() === ply && !drawState.offer && !drawState.deciding;

  if (state.mode === 'ai') {
    if (!await stockfishWantsDraw() || !stillCurrent()) return;
    drawState.lastOffer.opponent = ply;
    drawState.offer = { from: 'opponent', ply };
    logSystemChat(t('Stockfish предлагает ничью.'));
    playSound('notification');
    renderDrawUi();
    return;
  }

  // Персонаж: сначала дешёвая проверка позиции, потом решение нейросети
  if (!state.character || ply - drawState.lastCharacterCheck < CHARACTER_DRAW_CHECK_EVERY) return;
  if (state.isAsking || state.characterTyping || state.autoReplyPending) return;
  const drawishness = (state.character.drawishness ?? 30) / 100;
  if (Math.random() > 0.25 + 0.5 * drawishness) return;                  // не каждый раз, когда можно
  const cp = await drawEvalFor(state.aiColor);
  if (cp == null || !stillCurrent()) return;
  const late = ply >= 60;
  const equal = Math.abs(cp) <= 40 && (late || drawishness >= 0.4);
  const worse = cp <= -100 && cp >= -400 && drawishness >= 0.3;          // «спасти» худшую позицию
  const dead = nonPawnPieces() <= 4 && Math.abs(cp) <= 80;              // мало фигур, всё ровно
  if (!equal && !worse && !dead) return;
  drawState.lastCharacterCheck = ply;
  const decision = await askCharacterAboutDraw('offer', cp);
  if (!decision || !decision.yes || !stillCurrent()) return;
  drawState.lastOffer.opponent = ply;
  drawState.offer = { from: 'opponent', ply };
  playSound('notification');
  renderDrawUi();
  await sayAsCharacter(decision.message || t('Может, ничья?'));
}

/* ---------- Партия по ссылке: предложение пришло с сервера ---------- */
// drawOfferBy — цвет предложившего из online_games (или null)
function applyOnlineDrawOffer(drawOfferBy) {
  if (state.mode !== 'online' || state.isGameOver) return;
  const had = drawState.offer;
  // Только что предложили сами, а сверка с сервером успела раньше записи — не «отказ»
  if (!drawOfferBy && had && had.from === 'player' && Date.now() - (had.at || 0) < 6000) return;
  if (!drawOfferBy) {
    if (had) {
      if (had.from === 'player') showToast(t('Соперник отклонил ничью'));
      clearDrawOffer();
    }
    return;
  }
  const from = drawOfferBy === state.playerColor ? 'player' : 'opponent';
  if (had && had.from === from) return;
  drawState.offer = { from, ply: drawPlies() };
  if (from === 'opponent') playSound('notification');
  renderDrawUi();
}

/* ---------- Кнопки ---------- */
$id('drawBtn').addEventListener('click', () => {
  playSound('ui');
  const reason = drawBlockReason();
  if (reason) { showToast(reason); return; }
  offerDrawFromPlayer();
});
$id('drawAcceptBtn').addEventListener('click', () => { playSound('ui'); answerDrawOffer(true); });
$id('drawDeclineBtn').addEventListener('click', () => { playSound('ui'); answerDrawOffer(false); });
