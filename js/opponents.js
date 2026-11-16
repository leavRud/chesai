// Ходы соперника: Stockfish и персонажи, их реакции и итоговая карточка партии.
'use strict';

/* =========================================================================
   ХОД НЕЙРОСЕТИ (STOCKFISH)
   ========================================================================= */
function pickFallbackMove() {
  const verboseMoves = state.game.moves({ verbose: true });
  const captures = verboseMoves.filter((m) => m.flags.includes('c') || m.flags.includes('e'));
  const pool = captures.length ? captures : verboseMoves;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return state.game.move({ from: chosen.from, to: chosen.to, promotion: 'q' });
}

function setThinkingUI(isThinking) {
  $id('thinkingIndicator').classList.toggle('hidden', !isThinking);
}

// Партию начали раньше, чем догрузился движок: вместо «Ход соперника» честно
// пишем, чего ждём. Следующий updateStatus() вернёт обычный текст.
function showEngineLoadingStatus() {
  if (!isEngineReady && isEngineLoading) $id('statusText').textContent = t('Загружаю движок…');
}

// Соперник уровня «Stockfish ≈1200»: средние черты характера, без дебютной
// книги и реплик. Сила — та же откалиброванная, что у персонажей.
function neutralAiPlayer(elo) {
  return { elo, caution: 50, emotionality: 50, aggression: 50, sacrifice: 30, combination: 50, endgame: 50 };
}

async function requestAiMove() {
  if (!state.game || state.isGameOver || state.game.turn() !== state.aiColor) return;
  state.isThinking = true;
  setThinkingUI(true);
  updateStatus();

  const level = currentAiLevel(); // js/home-screen.js
  const fenForSearch = state.game.fen();
  const gameStartedAt = state.gameStartedAt;
  showEngineLoadingStatus();
  await waitForEngine(3000);

  let moveObj = null;
  if (level.max) {
    // «Максимум» — полная сила движка
    const moveUci = await searchBestMove(fenForSearch, { movetime: movetimeForSkill(20) });
    if (gameStartedAt !== state.gameStartedAt || state.game.fen() !== fenForSearch) return;
    if (moveUci) moveObj = applyUciMove(moveUci);
  } else {
    const player = neutralAiPlayer(level.elo);
    const movetime = movetimeForSkill(eloToSkillLevel(level.elo));
    const candidates = await searchTopMoves(fenForSearch, { movetime, multipv: characterMovePolicy(player).multipv });
    if (gameStartedAt !== state.gameStartedAt || state.game.fen() !== fenForSearch) return;
    if (candidates.length) moveObj = applyUciMove(pickCharacterMove(fenForSearch, candidates, player).move);
  }
  if (moveObj === null) {
    moveObj = pickFallbackMove();
  }
  if (moveObj) {
    state.fenHistory.push(state.game.fen());
    onMoveMade(moveObj, false);
  }
  state.isThinking = false;
  setThinkingUI(false);
  updateStatus();
}

/* =========================================================================
   ХОД ПЕРСОНАЖА (STOCKFISH + СТИЛЬ ЛИЧНОСТИ)
   Stockfish отвечает только за качество ходов. Нейросеть НЕ ищет ход сама —
   она лишь выбирает между несколькими примерно равноценными вариантами,
   которые предложил движок, ориентируясь на характер персонажа.
   ========================================================================= */
function applyUciMove(uci) {
  if (!uci) return null;
  const from = uci.substring(0, 2);
  const to = uci.substring(2, 4);
  const promotion = uci.length === 5 ? uci[4] : 'q';
  return state.game.move({ from, to, promotion });
}

async function searchTopMoves(fen, { movetime = 900, multipv = 3 } = {}) {
  // Освобождаем движок от фонового анализа ДО постановки задачи в очередь
  // (см. подробный комментарий в searchBestMove).
  await stopBackgroundAnalysis();
  return queueEngineTask(() => new Promise((resolve) => {
    if (!stockfish || !isEngineReady) { resolve([]); return; }
    let resolved = false;
    const lines = new Map();
    const finish = () => {
      if (resolved) return;
      resolved = true;
      stockfish.removeEventListener('message', handler);
      clearTimeout(timer);
      stockfish.postMessage('setoption name MultiPV value 1');
      const arr = Array.from(lines.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v)
        .filter(v => v && v.move);
      resolve(arr);
    };
    const handler = (e) => {
      const msg = e.data;
      if (typeof msg !== 'string') return;
      if (msg.startsWith('info') && msg.indexOf(' pv ') !== -1) {
        const parts = msg.split(' ');
        const mpvIdx = parts.indexOf('multipv');
        const scoreIdx = parts.indexOf('score');
        const pvIdx = parts.indexOf('pv');
        if (mpvIdx !== -1 && scoreIdx !== -1 && pvIdx !== -1) {
          const n = parseInt(parts[mpvIdx + 1], 10);
          let score = null;
          if (parts[scoreIdx + 1] === 'cp') {
            score = parseInt(parts[scoreIdx + 2], 10);
          } else if (parts[scoreIdx + 1] === 'mate') {
            const mateIn = parseInt(parts[scoreIdx + 2], 10);
            score = mateIn > 0 ? 100000 - mateIn : -100000 - mateIn;
          }
          const move = parts[pvIdx + 1];
          if (Number.isFinite(n) && move && score !== null) lines.set(n, { move, score });
        }
      }
      if (msg.startsWith('bestmove')) finish();
    };
    const timer = setTimeout(finish, movetime + 4000);
    stockfish.addEventListener('message', handler);
    stockfish.postMessage('position fen ' + fen);
    stockfish.postMessage(`setoption name MultiPV value ${multipv}`);
    stockfish.postMessage(`go movetime ${movetime}`);
  }));
}

function describeCandidateMoves(fen, candidates) {
  return candidates.map((cand) => {
    const g2 = new Chess(fen);
    const from = cand.move.substring(0, 2);
    const to = cand.move.substring(2, 4);
    const promotion = cand.move.length === 5 ? cand.move[4] : 'q';
    const mv = g2.move({ from, to, promotion });
    if (!mv) return null;
    const tags = [];
    if (mv.flags.includes('c') || mv.flags.includes('e')) tags.push('взятие');
    if (g2.in_check()) tags.push('шах');
    if (mv.flags.includes('k') || mv.flags.includes('q')) tags.push('рокировка');
    if (mv.flags.includes('p')) tags.push('превращение');
    return { san: mv.san, uci: cand.move, score: cand.score, tags, isCapture: mv.flags.includes('c') || mv.flags.includes('e') };
  }).filter(Boolean);
}

const traitK = (v) => clamp(Number(v) || 0, 0, 100) / 100;

// Заявленный рейтинг → «внутренний» уровень ошибок персонажа. Подобрано
// 15.11.2026 симуляцией: персонажи играли сами с собой (по 16 партий на
// уровень), игру оценивали разбором по шкале из js/engine.js (откалибрована
// на партиях lichess), затем кривую «уровень → потеря» обратили. Без поправки
// сила росла с рейтингом слишком круто. По одной партии разброс ±200 и больше.
const CHARACTER_POLICY_ELO = [
  [300, 657], [400, 836], [500, 920], [700, 982], [950, 1083], [1200, 1179],
  [1500, 1300], [1800, 1438], [2100, 1558], [2400, 1761], [2600, 1996], [2850, 2213],
];
function characterPolicyElo(elo) {
  const tbl = CHARACTER_POLICY_ELO;
  const e = Number(elo) || 1000;
  if (e <= tbl[0][0]) return tbl[0][1];
  for (let i = 1; i < tbl.length; i++) {
    if (e <= tbl[i][0]) {
      const [a, x] = tbl[i - 1];
      const [b, y] = tbl[i];
      return x + (y - x) * (e - a) / (b - a);
    }
  }
  return tbl[tbl.length - 1][1];
}

// Сила персонажа. Skill Level движка здесь не помогает: ходы персонажа берутся
// из строк MultiPV (честные оценки), а не из bestmove, который Stockfish
// намеренно портит на низком уровне. Поэтому слабость задаём сами:
//  - temperature — насколько охотно персонаж играет ход хуже лучшего:
//    чем она выше, тем чаще выбор падает на слабые варианты;
//  - blunderChance — шанс «зевка»: ход, который движок даже не рассматривал;
//  - multipv — слабым показываем больше вариантов, сильным только лучшие.
// Всё считается от «внутреннего» уровня (characterPolicyElo), чтобы игра в
// разборе выходила около заявленного рейтинга.
// Осторожность делает игру точнее, эмоциональность — неровнее. Влияние черт
// на силу намеренно небольшое (около ±100 Elo): калибровка сделана для
// средних черт (50/50), и рейтинг в карточке должен оставаться честным.
// Стиль черты меняют сильнее — см. бонусы в pickCharacterMove.
const CALIBRATED_TEMPERATURE_MULT = 1.232;
const CALIBRATED_BLUNDER_MULT = 1.24;
function characterMovePolicy(c) {
  const policyElo = characterPolicyElo(c.elo);
  const strength = clamp((policyElo - 500) / 2400, 0, 1); // 0 — новичок, 1 — гроссмейстер
  const caution = traitK(c.caution ?? 50);
  const emotion = traitK(c.emotionality ?? 50);
  const temperatureMult = CALIBRATED_TEMPERATURE_MULT * (1 + 0.2 * (0.5 - caution) + 0.1 * (emotion - 0.5));
  const temperature = Math.max(6, cplForElo(policyElo) * temperatureMult);
  const blunderMult = CALIBRATED_BLUNDER_MULT * (1 + 0.3 * (0.5 - caution));
  const blunderChance = (1 - strength) ** 3 * 0.24 * blunderMult;
  // Плавно от 8 вариантов у новичка до 4 у гроссмейстера. Раньше было три
  // ступени, и на границе (~1340) потеря за ход скачком падала с 65 до 53:
  // уровни между ~1300 и ~1750 персонаж изобразить не мог.
  const multipv = Math.round(8 - 4 * strength);
  // Насколько охотно забирает подставленное: даже новичок обычно видит
  // висящую фигуру (800 → ~65%, 1200 → ~75%, 2000+ → ~90%). Раньше 1200
  // проходил мимо бесплатной фигуры так же часто, как 800.
  const noticeFree = 0.6 + 0.35 * strength;
  return { strength, caution, temperature, blunderChance, multipv, noticeFree };
}

// «Зевок» как у живого игрока: не случайный ход из всех (раньше персонаж
// ни с того ни с сего играл a4 или Kf1 и выглядел нелепо), а естественный —
// развитие, взятие, шах, ход центральной пешкой, — который движок не
// рассматривал, потому что после него что-то повисло.
const NATURAL_PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function naturalBlunderMove(fen, candidates) {
  const game = new Chess(fen);
  const engineMoves = new Set(candidates.map(c => c.move.slice(0, 4)));
  const back = game.turn() === 'w' ? '1' : '8';
  const plies = game.history().length + (parseInt(fen.split(' ')[5], 10) - 1) * 2;
  const options = game.moves({ verbose: true }).filter(m => !engineMoves.has(m.from + m.to));
  if (!options.length) return null;
  const weights = options.map((m) => hangFactor(game, m) * naturalMoveWeight(m, back, plies));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  let chosen = options[0];
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) { chosen = options[i]; break; }
  }
  return { move: chosen.from + chosen.to + (chosen.promotion || ''), score: null };
}

// Живой игрок зевает чаще пешку или лёгкую фигуру, чем ферзя: ферзя под бой
// пешкой или конём ставят редко. Раньше зевок не смотрел, что повиснет, и
// персонаж на 850 отдавал ферзя за коня одним ходом (17.Qc2?? Nxc2).
const HANG_FACTOR = { q: 0.1, r: 0.25, b: 0.55, n: 0.55, p: 0.85, k: 1 };
function hangFactor(game, m) {
  game.move(m);
  const attackers = game.moves({ verbose: true }).filter(r => r.to === m.to && r.captured);
  game.undo();
  if (!attackers.length) return 1;
  const piece = m.promotion || m.piece;
  const cheapest = Math.min(...attackers.map(a => NATURAL_PIECE_VALUE[a.piece] || 0));
  return cheapest < NATURAL_PIECE_VALUE[piece] ? HANG_FACTOR[piece] : 0.85;
}

function naturalMoveWeight(m, back, plies) {
  let w = 1;
  if (m.captured) w += 2 + NATURAL_PIECE_VALUE[m.captured] / 2;
  if (m.san.includes('+')) w += 2;
  if (m.flags.includes('k') || m.flags.includes('q')) w += 2;
  if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === back) w += 2.5; // развитие
  if (m.piece === 'p' && (m.from[0] === 'd' || m.from[0] === 'e')) w += 1.5;
  if (m.piece === 'k' && !m.flags.includes('k') && !m.flags.includes('q')) w *= 0.15;
  if (m.piece === 'p' && (m.from[0] === 'a' || m.from[0] === 'h')) w *= 0.4;
  if (m.piece === 'q' && plies < 16) w *= 0.5; // ранний выход ферзя — реже
  return w;
}

// Оценка для выбора хода. Раньше она обрезалась до ±10 пешек, как в разборе,
// и за этой чертой все ходы выглядели одинаково: в проигранной позиции
// персонаж раздавал фигуры подряд (28.Be1?? Qxe1), а в выигранной не ставил
// мат. Здесь мат дороже любого материала, а материал считается до ±25 пешек.
function choiceScore(score) {
  if (score == null) return 0;
  if (score > 50000) return 3000 - (100000 - score) * 10; // мат в N за нас
  if (score < -50000) return -3000 + (score + 100000) * 10; // мат в N нам
  return clamp(score, -2500, 2500);
}

// Человеческие привычки: не гонять фигуру туда-обратно (6.Qe2 7.Qd1,
// 9.Rb1 12.Ra1), в дебюте развивать фигуры, а не играть Na3 и ранний ферзь.
// Сдвигают выбор только между близкими по силе ходами.
function humanMoveBonus(d, ctx) {
  const from = d.uci.slice(0, 2);
  const to = d.uci.slice(2, 4);
  let bonus = 0;
  if (ctx.lastOwn && ctx.lastOwn.from === to && ctx.lastOwn.to === from) bonus -= 60;
  if (ctx.plies < 20) {
    const piece = ctx.game.get(from);
    if (piece && (piece.type === 'n' || piece.type === 'b') && from[1] === ctx.back) bonus += 15;
    if (piece && piece.type === 'n' && (to[0] === 'a' || to[0] === 'h')) bonus -= 30;
    if (piece && piece.type === 'q' && ctx.plies < 12) bonus -= 25;
  }
  return bonus;
}

// Выбор хода по характеру — локально, без нейросети. Каждому варианту движка
// даём вес по потере оценки (чем слабее персонаж, тем меньше его это
// волнует) и по вкусу персонажа: агрессивные тянутся к взятиям и шахам,
// любители жертв — к рискованным взятиям, осторожные — к рокировке.
// Ход выбирается случайно пропорционально весу.
function pickCharacterMove(fen, candidates, c = state.character) {
  const policy = characterMovePolicy(c);
  const topScore = choiceScore(candidates[0].score);
  // Подставили фигуру — лучший ход на 2+ пешки сильнее остальных. Чаще всего
  // персонаж это видит и забирает; зевнуть ход в ответ здесь было бы нелепо.
  const freeGap = candidates.length > 1 ? topScore - choiceScore(candidates[1].score) : 0;
  if (freeGap >= 200 && Math.random() < policy.noticeFree) return candidates[0];

  if (Math.random() < policy.blunderChance) {
    const blunder = naturalBlunderMove(fen, candidates);
    if (blunder) return blunder;
  }
  const described = describeCandidateMoves(fen, candidates);
  if (described.length <= 1) return candidates[0];
  const game = new Chess(fen);
  const history = state.game ? state.game.history({ verbose: true }) : [];
  const ctx = {
    game,
    back: game.turn() === 'w' ? '1' : '8',
    plies: (parseInt(fen.split(' ')[5], 10) - 1) * 2 + (game.turn() === 'b' ? 1 : 0),
    lastOwn: history.length >= 2 ? history[history.length - 2] : null,
  };

  const logits = described.map((d) => {
    let bonus = 0;
    if (d.isCapture) bonus += 25 * traitK(c.aggression) + 20 * traitK(c.sacrifice);
    if (d.tags.includes('шах')) bonus += 30 * traitK(c.aggression) + 15 * traitK(c.combination);
    if (d.tags.includes('рокировка')) bonus += 25 * policy.caution;
    if (d.isCapture && traitK(c.endgame) > 0.6) bonus += 10; // любители эндшпиля охотно меняются
    bonus += humanMoveBonus(d, ctx);
    const loss = topScore - choiceScore(d.score);
    return (-loss + bonus) / policy.temperature;
  });
  const maxLogit = Math.max(...logits);
  const weights = logits.map(l => Math.exp(l - maxLogit));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  let chosen = described[0];
  for (let i = 0; i < described.length; i++) {
    r -= weights[i];
    if (r <= 0) { chosen = described[i]; break; }
  }
  return candidates.find(cd => cd.move === chosen.uci) || candidates[0];
}

function detectCharacterMoveFlavor(chosenScore, topScore, moveObj) {
  state.lastMoveFlavor = null;
  if (chosenScore == null || topScore == null || !moveObj) return;
  const isTactical = moveObj.flags.includes('c') || moveObj.flags.includes('e');
  const deficit = topScore - chosenScore;
  if (deficit >= 40 && isTactical) {
    state.lastMoveFlavor = 'sacrifice';
  } else if (deficit <= 5 && isTactical && chosenScore >= 150) {
    state.lastMoveFlavor = 'goodCombo';
  }
  if (state.prevCharacterEval != null) {
    const swing = topScore - state.prevCharacterEval;
    if (swing >= 150 && !state.lastMoveFlavor) {
      state.lastMoveFlavor = 'opponentMistake';
    }
  }
  state.prevCharacterEval = topScore;
}

/* ---- Сколько персонаж «думает» над ходом ----
   Живой соперник не ходит мгновенно: от 1 до 6 секунд. В дебюте ходит
   быстрее (ходы знакомые), в миттельшпиле и эндшпиле — дольше, очевидный
   ответ (забрать подставленную фигуру) — быстро. Когда на часах мало
   времени, ускоряется, чтобы не просрочить. */
const THINK_MIN_MS = 1000;
const THINK_MAX_MS = 6000;
function characterThinkMs(game, { obvious = false, book = false } = {}) {
  const plies = game.history().length;
  let pieces = 0; // фигуры кроме пешек и королей — по ним видно эндшпиль
  for (const row of game.board()) for (const sq of row) if (sq && sq.type !== 'p' && sq.type !== 'k') pieces++;
  let base;
  if (book || plies < 12) base = 1000 + Math.random() * 1000;         // дебют: 1–2 с
  else if (pieces <= 6) base = 3000 + Math.random() * 3000;          // эндшпиль: 3–6 с
  else base = 2000 + Math.random() * 3000;                           // миттельшпиль: 2–5 с
  if (obvious) base = Math.min(base, 1000 + Math.random() * 600);
  let ms = clamp(base, THINK_MIN_MS, THINK_MAX_MS);
  if (clockEnabled()) { // js/main.js
    const left = state.aiColor === 'w' ? state.timeWhite : state.timeBlack;
    // Меньше двух минут — думает пропорционально меньше; меньше 20 секунд —
    // почти сразу (полсекунды), как человек в цейтноте.
    if (left < 20) ms = 300 + Math.random() * 300;
    else if (left < 120) ms = Math.max(500, ms * left / 120);
  }
  return ms;
}

// Ждёт, пока с начала раздумья пройдёт ms. false — пока ждали, партия
// сменилась или закончилась, и ход делать уже не нужно.
async function waitThinkTime(startedAt, ms, fen, gameStartedAt) {
  const rest = ms - (Date.now() - startedAt);
  if (rest > 0) await new Promise(r => setTimeout(r, rest));
  return !state.isGameOver && gameStartedAt === state.gameStartedAt && state.game.fen() === fen;
}

async function requestCharacterMove() {
  if (!state.game || state.isGameOver || state.game.turn() !== state.aiColor || !state.character) return;
  state.isThinking = true;
  setThinkingUI(true);
  updateStatus();

  const fen = state.game.fen();
  const thinkStartedAt = Date.now();
  const gameStartedAt = state.gameStartedAt;

  // Пока партия идёт по его защите — ходит по книге, а не по движку: так
  // дебют совпадает с тем, что написано в карточке персонажа.
  const bookSan = pickBookMove(state.character, state.game, state.aiColor);
  if (bookSan) {
    const ready = await waitThinkTime(thinkStartedAt, characterThinkMs(state.game, { book: true }), fen, gameStartedAt);
    if (!ready) {
      if (gameStartedAt === state.gameStartedAt) { state.isThinking = false; setThinkingUI(false); }
      return;
    }
    const bookMove = state.game.move(bookSan, { sloppy: true });
    if (bookMove) {
      state.lastMoveFlavor = null;
      state.fenHistory.push(state.game.fen());
      onMoveMade(bookMove, false);
      state.isThinking = false;
      setThinkingUI(false);
      updateStatus();
      return;
    }
  }

  let movetime = movetimeForSkill(state.skillLevel);
  // В цейтноте и сам поиск короче — иначе персонаж просрочит время
  const clockLeft = state.aiColor === 'w' ? state.timeWhite : state.timeBlack;
  if (clockEnabled() && clockLeft < 20) movetime = Math.min(movetime, 250);
  showEngineLoadingStatus();
  await waitForEngine(3000);
  const { multipv } = characterMovePolicy(state.character);
  const candidates = await searchTopMoves(fen, { movetime, multipv });

  let moveObj = null;
  let chosenScore = null;
  const topScore = candidates.length ? candidates[0].score : null;

  if (candidates.length) {
    const target = pickCharacterMove(fen, candidates);
    // Забрать подставленное — очевидно, долго над этим не думают
    const obvious = candidates.length > 1 && choiceScore(candidates[0].score) - choiceScore(candidates[1].score) >= 200 && target.move === candidates[0].move;
    if (!await waitThinkTime(thinkStartedAt, characterThinkMs(state.game, { obvious }), fen, gameStartedAt)) {
      if (gameStartedAt === state.gameStartedAt) { state.isThinking = false; setThinkingUI(false); }
      return;
    }
    moveObj = applyUciMove(target.move);
    chosenScore = target.score;
  }

  if (moveObj === null) {
    moveObj = pickFallbackMove();
    chosenScore = null;
  }

  if (moveObj) {
    detectCharacterMoveFlavor(chosenScore, topScore, moveObj);
    state.fenHistory.push(state.game.fen());
    onMoveMade(moveObj, false);
  }
  state.isThinking = false;
  setThinkingUI(false);
  updateStatus();
}

/* ---- Реакции персонажа на события партии ---- */
// Один и тот же образ для чата с игроком и для реплик по ходу партии.
// Персонаж всегда помнит, что прямо сейчас играет с игроком в шахматы.
// На вопросы отвечает по-человечески и по существу (не сводит любой вопрос к
// шахматам), а сам заговаривает только о партии — с опорой на разговор.
// Слово «собеседник» в пометках — это и есть соперник по партии: модели
// прямо сказано, что третьих лиц нет. Раньше указания вида «Поприветствуйте
// соперника» звучали как просьба посредника, и персонаж отвечал ему про
// игрока: «посмотрим, разглядит ли этот ваш противник мой план».
// forDrawDecision — промпт для решения о ничьей (draws.js): там собеседник уже
// нажал кнопку, и правило «в чате ничью не принимай, жми кнопку» сбивало
// персонажа — он отвечал «хочешь ничью, жми кнопку».
function buildCharacterPersonaPrompt({ forDrawDecision = false } = {}) {
  const c = state.character;
  const acc = typeof getAccount === 'function' ? getAccount() : null;
  const playerName = acc && acc.name ? String(acc.name).slice(0, 24) : '';
  return `Ты — ${c.name}. ${c.shortDescription}
Прямо сейчас ты сидишь за шахматной доской напротив человека, играешь с ним партию и переговариваешься. Он и есть твой соперник; дальше он называется «собеседник».${playerName ? ` Его настоящее имя — ${playerName}.` : ''} Кроме вас двоих здесь никого нет. Ты живая личность со своим характером, юмором и настроением, а не бот.
Как ты играешь: ${c.style}
Как ты говоришь: ${c.tone}${c.persona ? `\nО тебе: ${c.persona}` : ''}

Правила:
- Всегда говори прямо с собеседником, лицом к лицу: «ты» или «вы» — как принято у твоего персонажа. Никогда не говори о нём в третьем лице («этот твой противник», «мой соперник», «он») и не обращайся к кому-то третьему — зрителям, ведущему, помощнику.
- Обращение к собеседнику — одно на реплику. Если у твоего персонажа есть привычное прозвище для собеседника (Рик зовёт всех «Морти», старый пират — «салагой»), зови так и не добавляй в ту же реплику настоящее имя. По настоящему имени обращайся редко — не чаще раза в несколько реплик и никогда вместе с прозвищем.
- Пометки в квадратных скобках пишет программа, а не собеседник: [Фон: …] — что сейчас на доске, [Событие: …] — что только что случилось в партии. Не отвечай на них как на чужие слова, не цитируй и не упоминай их.
- Ты всегда помнишь, что идёт партия: кто как сходил, как складывается игра, о чём вы уже говорили.
- Когда собеседник что-то спрашивает или говорит, отвечай по существу и по-человечески, даже если это не о шахматах: не переводи каждую реплику в шахматы и не притягивай шахматные метафоры. Можно коротко вернуться к партии, если это к месту.
- Когда говоришь сам, без вопроса собеседника, — говори о партии: о ходах, ситуации на доске, своих планах и настроении от игры. Опирайся на то, о чём вы уже говорили: подхвати шутку, напомни сказанное, ответь на старую подколку.
- Говори как человек: ${AI_LANGUAGE}, от первого лица, 1–3 предложения, без списков, кавычек и разметки. Можно шутить, спорить, ворчать — в своём характере. Не будь услужливым ассистентом.
- Знаменитые фразы и словечки персонажа говори так, как они звучат в официальном переводе или дубляже на этом языке (у Джека Воробья по-русски — «смекаешь?», а не «савви»). Не вставляй иностранные слова, записанные русскими буквами, если так не говорят в переводе.
- Не повторяйся: коронную фразу или своё полное имя — не чаще чем в одной реплике из нескольких, и не начинай реплики одинаково.
${forDrawDecision ? '' : '- Ничью официально предлагают и принимают кнопкой «Ничья», а не в разговоре. Если собеседник в чате просит ничью — ответь в своём характере и скажи, чтобы предложил её кнопкой; сам в чате ничью не принимай и не объявляй.\n'}- Ты соперник: не подсказывай собеседнику ходы и не оценивай позицию в его пользу, даже намёком. Если просят — откажи по-своему.
- Ходы бери только из [Фон]: там перечислены последние ходы и кто их сделал. Не называй ходов, которых там нет, и не объявляй, какой ход сделаешь следующим — его выбираешь не ты в разговоре, а партия.`;
}

// Короткая сводка партии для пометок [Фон: …]: цвет, номер хода, последние
// ходы и материал. Без FEN — модели нужен смысл, а не координаты.
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function describeGameForCharacter() {
  const game = state.game;
  const history = game.history({ verbose: true });
  const myColor = state.aiColor === 'w' ? 'белыми' : 'чёрными';
  const moveNo = Math.floor(history.length / 2) + 1;
  // Словами и с автором: по одной записи «g6» модель решала, что это ход ферзя
  const recent = history.slice(-4)
    .map((mv) => `${mv.color === state.aiColor ? 'ты' : 'собеседник'} ${mv.san} (${aiDescribeMove(mv)})`)
    .join('; ');
  let mine = 0;
  let theirs = 0;
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq) continue;
      if (sq.color === state.aiColor) mine += PIECE_VALUES[sq.type];
      else theirs += PIECE_VALUES[sq.type];
    }
  }
  const diff = mine - theirs;
  const material = diff === 0 ? 'материал равный'
    : diff > 0 ? `у тебя больше материала на ${diff}` : `у собеседника больше материала на ${-diff}`;
  const turn = game.turn() === state.aiColor ? 'сейчас твой ход' : 'сейчас ход собеседника';
  return `ты играешь ${myColor}, ход ${moveNo}${recent ? `, последние ходы: ${recent}` : ', партия только началась'}, ${material}, ${turn}`;
}

const CHARACTER_REPLY_COOLDOWN_MS = 30000;
const CHARACTER_QUIET_PLIES = 12;    // столько полуходов тишины, прежде чем персонаж может заговорить сам
const CHARACTER_QUIET_CHANCE = 0.5;  // чтобы реплики не звучали строго по расписанию

async function characterReact(context, isAuto = false) {
  if (state.mode !== 'characters' || !state.character) return;
  const gameStartedAt = state.gameStartedAt;
  if (isAuto) {
    // Отмечаем сразу, а не после ответа: иначе за время запроса уйдёт второй
    state.autoReplyPending = true;
    state.lastAutoReplyTime = Date.now();
    state.pliesSinceCharacterSpoke = 0;
  }
  // Пока персонаж пишет сам, игрок ждёт: поле ввода заблокировано
  setCharacterTyping(true);
  try {
    // Последние реплики разговора — чтобы персонаж не забывал, о чём вы только что говорили.
    const messages = [
      { role: 'system', content: buildCharacterPersonaPrompt() },
      ...trimHistory(state.chatApiHistory, 10),
      { role: 'user', content: `[Фон: ${describeGameForCharacter()}]\n[Событие: ${context}]\n[Собеседник сейчас молчит. Скажи ему сам одну-две фразы о партии в своём образе, учитывая ваш разговор.]` },
    ];
    const reply = await provodChat(messages, { temperature: 1.0, kind: 'game', task: 'character' });
    const clean = stripMarkdown(reply).replace(/^["«]+|["»]+$/g, '').trim();
    // Пока шёл запрос, игрок начал новую партию или партия закончилась —
    // реплика уже не к месту: после мата за персонажа говорит итоговое окно
    if (!clean || gameStartedAt !== state.gameStartedAt) return;
    if (isAuto && state.isGameOver) return;

    if (isAuto) {
      // проверка на дубликат среди последних 5 реплик
      if (state.lastAutoReplies.includes(clean)) return;
      state.lastAutoReplies.push(clean);
      if (state.lastAutoReplies.length > 5) state.lastAutoReplies.shift();
    }

    // добавить в историю чата (API) – для контекста
    state.chatApiHistory.push({ role: 'assistant', content: clean });
    // добавить в отображение и дождаться, пока текст допечатается
    await appendChatMessage('character', clean, { typewriter: true });
  } catch (error) {
    console.error('Ошибка реплики персонажа:', error);
    if (error.code === 'GAME_LIMIT_REACHED' && !state.gameLimitNotified && gameStartedAt === state.gameStartedAt) {
      state.gameLimitNotified = true;
      logSystemChat(chatErrorMessage(error));
    }
  } finally {
    if (gameStartedAt === state.gameStartedAt) {
      if (isAuto) state.autoReplyPending = false;
      setCharacterTyping(false);
    }
  }
}

function triggerCharacterEvents(move, isUserMove) {
  if (state.mode !== 'characters' || !state.character) return;
  state.pliesSinceCharacterSpoke++;
  const flavor = state.lastMoveFlavor;
  state.lastMoveFlavor = null;
  const game = state.game;
  // Партия окончена — в чат персонаж больше не пишет: его слова о партии
  // (настроение, любимый момент, комментарий) показывает итоговое окно.
  if (game.game_over()) return;
  // Игрок ждёт ответа на свой вопрос — не перебиваем его самостоятельной
  // репликой, иначе в чате окажутся два ответа подряд.
  if (state.isAsking || state.characterTyping) return;
  // Не чаще раза в CHARACTER_REPLY_COOLDOWN_MS
  const isBusy = state.autoReplyPending || Date.now() - state.lastAutoReplyTime < CHARACTER_REPLY_COOLDOWN_MS;
  if (isBusy) return;
  let event = null;
  if (!isUserMove && move.captured === 'q') {
    event = 'captured_queen';
  } else if (isUserMove && move.captured === 'q') {
    event = 'player_captured_queen';
  } else if (!isUserMove && flavor === 'sacrifice') {
    event = 'sacrifice';
  } else if (!isUserMove && flavor === 'goodCombo') {
    event = 'good_combo';
  } else if (!isUserMove && flavor === 'opponentMistake') {
    event = 'opponent_mistake';
  } else if (game.in_check()) {
    event = isUserMove ? 'player_gives_check' : 'character_gives_check';
  } else if (!isUserMove && state.pliesSinceCharacterSpoke >= CHARACTER_QUIET_PLIES && Math.random() < CHARACTER_QUIET_CHANCE) {
    event = 'quiet';
  }
  if (!event) return;
  // От лица персонажа: «ты» — это он сам, «собеседник» — игрок напротив.
  const contexts = {
    captured_queen: `ты взял ферзя собеседника ходом ${move.san}.`,
    sacrifice: `ты сделал рискованное взятие ходом ${move.san}, как любишь.`,
    good_combo: `ты нашёл сильный тактический удар ходом ${move.san}.`,
    opponent_mistake: 'собеседник только что заметно ошибся.',
    character_gives_check: `ты объявил собеседнику шах ходом ${move.san}.`,
    player_gives_check: 'собеседник только что объявил тебе шах.',
    player_captured_queen: 'собеседник только что взял твоего ферзя.',
    quiet: `партия идёт спокойно, ты только что сыграл ${move.san}. Скажи собеседнику что-нибудь о партии: как тебе игра, что задумал, подколи его за недавний ход или вспомни, о чём вы говорили.`,
  };
  if (event) {
    const context = contexts[event];
    if (context) {
      // Проверка на дублирование контекста? – можно по самому тексту, но в characterReact проверим
      characterReact(context, true); // isAuto = true
    }
  }
}

/* ---- Итоговая карточка партии против персонажа ---- */
// Нейросеть выбирает настроение из этого списка, карточка показывает его иконкой
const CHARACTER_MOOD_ICONS = {
  happy: 'mood-happy',
  calm: 'mood-smile',
  neutral: 'mood-neutral',
  sad: 'mood-sad',
  angry: 'mood-angry',
  surprised: 'mood-surprised',
};
// Последняя реплика персонажа об итоге партии — попадает на карточку «Поделиться»
let lastCharacterResult = null;

function renderCharacterResultLoading() {
  lastCharacterResult = null;
  $id('characterResultContent').innerHTML = `<p class="analysis-loading">${t('Персонаж обдумывает партию…')}</p>`;
}

// moment — { ply, move, fenAfter, line } или null, если показать на доске нечего
function renderCharacterResult({ mood, favoriteMoment, comment, moment = null }) {
  const c = state.character;
  lastCharacterResult = { mood, favoriteMoment, comment, moment };
  const momentRow = moment
    // В строке — только надпись и стрелка; фраза персонажа и ход — в окне
    ? `<button type="button" class="char-result-row char-result-moment" id="charFavMomentBtn" aria-haspopup="dialog">
        <span>${t('Любимый момент')}</span>
        <span class="char-result-moment-arrow" aria-hidden="true">›</span>
      </button>`
    : `<div class="char-result-row"><span>${t('Любимый момент')}</span><b>${escapeHtml(favoriteMoment)}</b></div>`;
  $id('characterResultContent').innerHTML = `
    <div class="char-result-head">
      <span class="char-result-icon">♞</span>
      <span class="char-result-name">${escapeHtml(c ? c.name : '')}</span>
      <span class="char-result-mood">${achievementIconSvg(CHARACTER_MOOD_ICONS[mood])}</span>
    </div>
    ${momentRow}
    <p class="char-result-comment">${escapeHtml(comment)}</p>
  `;
  const btn = $id('charFavMomentBtn');
  if (btn) btn.addEventListener('click', () => { playSound('ui'); openFavoriteMoment(); });
}

/* ---- Любимый момент: ход на доске и реплика персонажа ----
   Нейросеть не придумывает ход сама — выбирает из моментов, которые нашла
   программа (взятия, шахи, мат, превращения, резкие повороты оценки), иначе
   она называет ходы, которых в партии не было. */
function momentMoveLabel(moment) {
  const fullMove = Math.floor(moment.ply / 2) + 1;
  return `${fullMove}${moment.move.color === 'w' ? '.' : '…'} ${moment.move.san}`;
}

const KEY_MOMENT_LIMIT = 6;
function collectKeyMoments() {
  const history = state.game ? state.game.history({ verbose: true }) : [];
  const fens = state.fenHistory;
  const sign = state.aiColor === 'w' ? 1 : -1;
  const scored = history.map((move, ply) => {
    let interest = 0;
    if (move.captured) interest += PIECE_VALUES[move.captured] || 1;
    if (move.san.endsWith('#')) interest += 20;
    else if (move.san.includes('+')) interest += 1.5;
    if (move.promotion) interest += 6;
    // Резкий поворот в пользу персонажа — обычно ошибка игрока или удачный удар
    const before = scoreAbsoluteWhite(analysisCache.get(fens[ply]), fens[ply]);
    const after = scoreAbsoluteWhite(analysisCache.get(fens[ply + 1]), fens[ply + 1]);
    if (before != null && after != null) {
      const swing = (cappedCp(after) - cappedCp(before)) * sign;
      if (swing > 150) interest += Math.min(8, swing / 100);
    }
    if (ply < 8) interest *= 0.3; // дебютные размены редко запоминаются
    return { ply, move, fenAfter: fens[ply + 1] || null, interest };
  }).filter(m => m.fenAfter);
  let picked = scored.filter(m => m.interest > 0)
    .sort((a, b) => b.interest - a.interest)
    .slice(0, KEY_MOMENT_LIMIT);
  if (!picked.length) picked = scored.slice(-3);
  return picked.sort((a, b) => a.ply - b.ply);
}

function describeKeyMoments(moments) {
  return moments.map((m, i) => {
    const who = m.move.color === state.aiColor ? 'ты' : 'соперник';
    return `${i + 1}) ${momentMoveLabel(m)} — ход делал ${who}: ${aiDescribeMove(m.move)}`;
  }).join('\n');
}

let favMomentBoard = null;
function openFavoriteMoment() {
  const moment = lastCharacterResult && lastCharacterResult.moment;
  if (!moment) return;
  const c = state.character;
  const mine = moment.move.color === state.aiColor;
  $id('favMomentTitle').textContent = lastCharacterResult.favoriteMoment && lastCharacterResult.favoriteMoment !== '—'
    ? lastCharacterResult.favoriteMoment : t('Любимый момент');
  $id('favMomentSan').innerHTML = `<b>${escapeHtml(momentMoveLabel(moment))}</b><span>${mine ? escapeHtml(t('ход {name}', { name: c ? c.name : t('персонажа') })) : t('ваш ход')}</span>`;
  $id('favMomentName').textContent = c ? c.name : '';
  $id('favMomentLine').textContent = moment.line || lastCharacterResult.favoriteMoment;
  $id('favMomentArrow').innerHTML = '';
  showModal('favMomentModal');
  const orientation = state.playerColor === 'b' ? 'black' : 'white';
  // Доску строим, когда окно уже видно: chessboard.js меряет контейнер
  requestAnimationFrame(() => {
    if (!favMomentBoard) {
      favMomentBoard = Chessboard('favMomentBoard', { position: moment.fenAfter, orientation, draggable: false, pieceTheme: pieceThemeFn, showNotation: false });
    } else {
      favMomentBoard.orientation(orientation);
      favMomentBoard.resize();
      favMomentBoard.position(moment.fenAfter, false);
    }
    const { from, to } = moment.move;
    document.querySelectorAll('#favMomentBoard [data-square]').forEach((el) => {
      el.classList.toggle('md-sq-from', el.dataset.square === from);
      el.classList.toggle('md-sq-to', el.dataset.square === to);
    });
    const svg = $id('favMomentArrow');
    const boardEl = document.querySelector('#favMomentBoard .board-b72b1');
    if (boardEl) {
      const b = boardEl.getBoundingClientRect();
      const box = svg.parentElement.getBoundingClientRect();
      Object.assign(svg.style, { left: `${b.left - box.left}px`, top: `${b.top - box.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    }
    drawBoardArrow(svg, from, to, mine ? 'var(--accent)' : ARROW_COLORS.neutral, { flipped: orientation === 'black' });
  });
}
$id('favMomentCloseBtn').addEventListener('click', () => hideModal('favMomentModal'));
$id('favMomentModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) hideModal('favMomentModal'); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$id('favMomentModal').classList.contains('hidden')) hideModal('favMomentModal');
});

// Как закончилась партия — словами от лица персонажа. Раньше нейросети
// уходил текст для игрока («Вы проиграли по времени…»), и персонаж, выиграв
// по времени, говорил «формально ты выиграл по времени».
function characterOutcomeLine(outcome, reason) {
  const won = outcome === 'character_win';
  const lost = outcome === 'player_win';
  if (outcome === 'draw') {
    if (reason === 'agreement') return 'вы с соперником договорились о ничьей';
    if (reason === 'stalemate') return 'партия закончилась патом — ничья';
    if (reason === 'time') return 'время на часах кончилось, но для мата не хватало фигур — ничья';
    return 'партия закончилась вничью по правилам (повторение позиции, правило 50 ходов или не хватает фигур для мата)';
  }
  if (reason === 'mate') return won ? 'ты поставил сопернику мат — ты победил' : 'соперник поставил тебе мат — ты проиграл';
  if (reason === 'time') return won ? 'у соперника кончилось время на часах — ты победил по времени' : 'у тебя кончилось время на часах — ты проиграл по времени';
  if (reason === 'resign') return won ? 'соперник сдался — ты победил' : 'ты сдался — соперник победил';
  return won ? 'ты выиграл партию' : lost ? 'ты проиграл партию' : 'партия закончилась';
}

async function generateCharacterEndSummary(resultText, outcome, reason = 'over') {
  const c = state.character;
  if (!c) return;
  const gameStartedAt = state.gameStartedAt;
  const pgn = state.game ? state.game.pgn() : '';
  const moments = collectKeyMoments();
  const prompt = `Ты — ${c.name}. ${c.shortDescription}
Как ты играешь: ${c.style}
Как ты говоришь: ${c.tone}
Ты только что доиграл партию в шахматы с соперником. Итог: ${characterOutcomeLine(outcome, reason)}.
История партии (PGN): ${pgn || '—'}
Заметные моменты партии (посчитаны программой по доске):
${describeKeyMoments(moments) || '—'}

Выбери из этого списка свой любимый момент — тот, что тебе как персонажу запомнился больше всего, — и скажи о нём пару слов сопернику.
Пиши ${AI_LANGUAGE}, от первого лица, обращаясь прямо к сопернику на «ты» или «вы» (как принято у твоего персонажа), без разметки. Знаменитые фразы персонажа — как в официальном переводе или дубляже, без иностранных слов русскими буквами.
Ответь СТРОГО валидным JSON без markdown и пояснений, в формате:
{"mood":"твоё настроение, одно слово из списка: ${Object.keys(CHARACTER_MOOD_ICONS).join(', ')}","momentNumber":номер момента из списка,"favoriteMoment":"короткое название момента, до 8 слов","momentLine":"что ты говоришь сопернику об этом ходе, 1–2 предложения","comment":"твой итоговый комментарий о партии, 1–2 предложения"}`;
  const fallbackMood = outcome === 'character_win' ? 'calm' : (outcome === 'player_win' ? 'sad' : 'neutral');
  const clean = (v) => stripMarkdown(String(v || '')).replace(/^["«]+|["»]+$/g, '').trim();
  try {
    const raw = await provodChat([{ role: 'user', content: prompt }], { temperature: 0.85, kind: 'game', task: 'character' });
    if (gameStartedAt !== state.gameStartedAt) return; // уже идёт новая партия
    const parsed = JSON.parse(extractJson(raw));
    const mood = String(parsed.mood || '').trim().toLowerCase();
    const idx = parseInt(parsed.momentNumber, 10) - 1;
    // Номер вне списка — берём самый яркий момент, а не выдуманный ход
    const base = moments[idx] || moments.slice().sort((a, b) => b.interest - a.interest)[0] || null;
    const line = clean(parsed.momentLine);
    renderCharacterResult({
      mood: CHARACTER_MOOD_ICONS[mood] ? mood : fallbackMood,
      favoriteMoment: clean(parsed.favoriteMoment) || t('Момент, который запомнится надолго.'),
      comment: clean(parsed.comment) || t('Хорошая была партия.'),
      moment: base ? { ply: base.ply, move: base.move, fenAfter: base.fenAfter, line } : null,
    });
  } catch (error) {
    console.error('Ошибка итогового комментария персонажа:', error);
    if (gameStartedAt !== state.gameStartedAt) return;
    renderCharacterResult({ mood: fallbackMood, favoriteMoment: '—', comment: t('Комментарий персонажа сейчас недоступен.') });
    lastCharacterResult = null; // заглушка не попадает на картинку «Поделиться»
  }
}
