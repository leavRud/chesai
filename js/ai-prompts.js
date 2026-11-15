// Готовые факты о позиции для промптов нейросети.
// Модели плохо читают FEN и путают знак оценки: «−79 с точки зрения хода»
// одни понимают как перевес чёрных, другие — белых, а связку или висящую
// фигуру по FEN почти не видят. Поэтому всё это программа считает сама и
// отдаёт словами, а модели остаётся только объяснить.
// Чистые функции (нужен только Chess из chess.js) — их же загружает
// тестовый прогон моделей вне браузера.
'use strict';

const AI_PIECE_NAMES = { p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король' };
const AI_PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const AI_SIDE = { w: 'белые', b: 'чёрные' };
const AI_SIDE_ADJ = { w: 'белый', b: 'чёрный' };
const AI_SIDE_ADJ_F = { w: 'белая', b: 'чёрная' }; // пешка, ладья

function aiPieceLabel(color, type) {
  const adj = type === 'p' || type === 'r' ? AI_SIDE_ADJ_F[color] : AI_SIDE_ADJ[color];
  return `${adj} ${AI_PIECE_NAMES[type]}`;
}

/* ---- Оценка словами ----
   scoreWhite — оценка с точки зрения белых в сантипешках; маты кодируются
   как ±(100000 − N), как в engine.js. */
function aiScoreWords(scoreWhite) {
  if (scoreWhite == null) return 'оценки нет';
  if (Math.abs(scoreWhite) >= 90000) {
    const n = 100000 - Math.abs(scoreWhite);
    const side = scoreWhite > 0 ? 'белые' : 'чёрные';
    return n <= 0 ? 'на доске мат' : `${side} ставят мат в ${n} ${n === 1 ? 'ход' : n < 5 ? 'хода' : 'ходов'}`;
  }
  const pawns = Math.abs(scoreWhite) / 100;
  if (pawns < 0.3) return pawns < 0.05 ? 'равно' : `примерно равно (у ${scoreWhite > 0 ? 'белых' : 'чёрных'} +${pawns.toFixed(1)})`;
  const side = scoreWhite > 0 ? 'белых' : 'чёрных';
  const size = pawns < 1 ? 'небольшой' : pawns < 2.5 ? 'заметный' : pawns < 5 ? 'большой' : 'решающий';
  return `${size} перевес ${side}, около ${pawns.toFixed(1)} пешки`;
}

// «для тебя (чёрные) позиция хуже» — чтобы модель не пересчитывала знак сама
function aiScoreForPlayer(scoreWhite, playerColor) {
  if (scoreWhite == null || !playerColor) return '';
  const mine = playerColor === 'w' ? scoreWhite : -scoreWhite;
  const who = `игрок (${AI_SIDE[playerColor]})`;
  if (Math.abs(mine) >= 90000) return mine > 0 ? `${who} ставит мат` : `${who} получает мат`;
  if (Math.abs(mine) < 30) return `для игрока (${AI_SIDE[playerColor]}) позиция примерно равная`;
  return `для игрока (${AI_SIDE[playerColor]}) позиция ${mine > 0 ? 'лучше' : 'хуже'}`;
}

/* ---- Линия ходов в записи SAN с номерами: «8...Nb4 9.Bb3 c6» ---- */
function aiPvToSan(fen, pv, maxPlies = 8) {
  if (!pv) return '';
  const g = new Chess(fen);
  const parts = fen.split(' ');
  let moveNo = parseInt(parts[5], 10) || 1;
  let turn = parts[1];
  const out = [];
  const ucis = (Array.isArray(pv) ? pv : String(pv).trim().split(/\s+/)).slice(0, maxPlies);
  for (const u of ucis) {
    const mv = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length === 5 ? u[4] : 'q' });
    if (!mv) break;
    if (turn === 'w') out.push(`${moveNo}.${mv.san}`);
    else out.push(out.length === 0 ? `${moveNo}...${mv.san}` : mv.san);
    if (turn === 'b') moveNo++;
    turn = turn === 'w' ? 'b' : 'w';
  }
  return out.join(' ');
}

// «белый конь c3→d5, взял чёрную пешку d5, шах»
function aiDescribeMove(mv) {
  if (!mv) return '';
  if (mv.flags && (mv.flags.includes('k') || mv.flags.includes('q'))) {
    return `${AI_SIDE[mv.color]} сделали рокировку в ${mv.flags.includes('k') ? 'короткую' : 'длинную'} сторону`;
  }
  let s = `${aiPieceLabel(mv.color, mv.piece)} ${mv.from}→${mv.to}`;
  if (mv.captured) s += `, взятие: ${aiPieceLabel(mv.color === 'w' ? 'b' : 'w', mv.captured)} ${mv.flags && mv.flags.includes('e') ? '(на проходе)' : mv.to}`;
  if (mv.promotion) s += `, превращение в ${AI_PIECE_NAMES[mv.promotion]}`;
  if (/[+#]$/.test(mv.san || '')) s += mv.san.endsWith('#') ? ', мат' : ', шах';
  return s;
}

/* ---- Геометрия: кто бьёт поле, связки ---- */
const AI_FILES = 'abcdefgh';
function aiBoardMap(game) {
  const map = {};
  game.board().forEach((row, i) => row.forEach((sq, f) => { if (sq) map[AI_FILES[f] + (8 - i)] = sq; }));
  return map;
}
function aiSq(f, r) { return f >= 0 && f < 8 && r >= 1 && r <= 8 ? AI_FILES[f] + r : null; }
const AI_ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const AI_DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

// Фигуры цвета color, которые бьют поле sq (без учёта связок своих фигур)
function aiAttackers(map, sq, color) {
  const f = AI_FILES.indexOf(sq[0]);
  const r = +sq[1];
  const res = [];
  const take = (s, types) => { const p = s && map[s]; if (p && p.color === color && types.includes(p.type)) res.push({ ...p, square: s }); };
  const dir = color === 'w' ? -1 : 1; // пешка бьёт вперёд по диагонали — ищем её позади поля
  take(aiSq(f - 1, r + dir), ['p']); take(aiSq(f + 1, r + dir), ['p']);
  for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) take(aiSq(f + df, r + dr), ['n']);
  for (const [df, dr] of [...AI_ORTH, ...AI_DIAG]) take(aiSq(f + df, r + dr), ['k']);
  for (const [dirs, types] of [[AI_ORTH, ['r', 'q']], [AI_DIAG, ['b', 'q']]]) {
    for (const [df, dr] of dirs) {
      for (let i = 1; i < 8; i++) {
        const s = aiSq(f + df * i, r + dr * i);
        if (!s) break;
        if (map[s]) { take(s, types); break; }
      }
    }
  }
  return res;
}

// Связки: своя фигура стоит между своим королём (или ферзём) и чужой
// дальнобойной фигурой. С королём фигура уйти не может вовсе, с ферзём —
// может, но тогда ферзь попадает под бой.
function aiPins(map, color) {
  const pins = [];
  const targets = Object.keys(map).filter((s) => map[s].color === color && (map[s].type === 'k' || map[s].type === 'q'));
  for (const behindSq of targets) {
    const behind = map[behindSq];
    const f = AI_FILES.indexOf(behindSq[0]);
    const r = +behindSq[1];
    for (const [dirs, types] of [[AI_ORTH, ['r', 'q']], [AI_DIAG, ['b', 'q']]]) {
      for (const [df, dr] of dirs) {
        let own = null;
        for (let i = 1; i < 8; i++) {
          const s = aiSq(f + df * i, r + dr * i);
          if (!s) break;
          const p = map[s];
          if (!p) continue;
          if (!own) { if (p.color === color && p.type !== 'k') { own = { ...p, square: s }; continue; } break; }
          // Ферзя «прикрывает» только фигура дешевле ферзя от фигуры дешевле ферзя
          const counts = behind.type === 'k' || (own.type !== 'q' && p.type !== 'q');
          if (p.color !== color && types.includes(p.type) && counts) {
            pins.push({ piece: own, by: { ...p, square: s }, behind: { ...behind, square: behindSq }, absolute: behind.type === 'k' });
          }
          break;
        }
      }
    }
  }
  return pins;
}

// Лежит ли sq на отрезке между a и b (включая b) — по этой линии связанная фигура ходить может
function aiOnSegment(a, b, sq) {
  const [af, ar, bf, br, sf, sr] = [a, b, sq].flatMap((s) => [AI_FILES.indexOf(s[0]), +s[1]]);
  const cross = (bf - af) * (sr - ar) - (br - ar) * (sf - af);
  if (cross !== 0) return false;
  return Math.min(af, bf) <= sf && sf <= Math.max(af, bf) && Math.min(ar, br) <= sr && sr <= Math.max(ar, br) && sq !== a;
}

function aiPieceList(map, color) {
  const order = ['k', 'q', 'r', 'b', 'n', 'p'];
  return order.map((t) => {
    const sqs = Object.keys(map).filter((s) => map[s].color === color && map[s].type === t).sort();
    if (!sqs.length) return null;
    const name = t === 'p' ? (sqs.length > 1 ? 'пешки' : 'пешка') : AI_PIECE_NAMES[t];
    return `${name} ${sqs.join(' ')}`;
  }).filter(Boolean).join(', ');
}

/* ---- Блок «ФАКТЫ О ПОЗИЦИИ» ----
   Расстановка словами, шах, связки и все фигуры под боем с нападающими и
   защитниками. Висящие и «под ударом более дешёвой фигуры» помечены. */
function aiPositionFacts(fen, { placement = true } = {}) {
  const g = new Chess(fen);
  const map = aiBoardMap(g);
  const turn = g.turn();
  const lines = [];
  if (placement) {
    lines.push(`Белые: ${aiPieceList(map, 'w')}.`);
    lines.push(`Чёрные: ${aiPieceList(map, 'b')}.`);
  }
  lines.push(`Сейчас ход: ${AI_SIDE[turn]}.`);
  if (g.in_checkmate()) lines.push(`Мат: ${AI_SIDE[turn]} получили мат.`);
  else if (g.in_check()) lines.push(`Шах: ${AI_SIDE_ADJ[turn]} король под шахом.`);
  const absolutePins = [];
  for (const color of ['w', 'b']) {
    for (const pin of aiPins(map, color)) {
      const who = `${aiPieceLabel(color, pin.piece.type)} ${pin.piece.square}`;
      const by = `${aiPieceLabel(pin.by.color, pin.by.type)} ${pin.by.square}`;
      if (pin.absolute) {
        absolutePins.push(pin);
        lines.push(`Связка: ${who} не может уйти с линии — за этой фигурой король ${pin.behind.square}, по линии бьёт ${by}.`);
      } else {
        lines.push(`Связка с ферзём: ${who} прикрывает ферзя ${pin.behind.square}, по линии бьёт ${by} — если эта фигура уйдёт, ферзь окажется под боем.`);
      }
    }
  }
  // Фигура, связанная с королём, бьёт только по линии связки
  const canMoveTo = (a, sq) => {
    const pin = absolutePins.find((x) => x.piece.square === a.square);
    return !pin || aiOnSegment(pin.behind.square, pin.by.square, sq);
  };
  const threats = [];
  for (const sq of Object.keys(map).sort()) {
    const p = map[sq];
    if (p.type === 'k') continue;
    const enemy = p.color === 'w' ? 'b' : 'w';
    let attackers = aiAttackers(map, sq, enemy).filter((a) => canMoveTo(a, sq));
    let defenders = aiAttackers(map, sq, p.color).filter((a) => canMoveTo(a, sq));
    // Король отбирает фигуру, только если поле больше никто не бьёт
    if (attackers.length > 1) defenders = defenders.filter((d) => d.type !== 'k');
    // Король бьёт только незащищённую фигуру
    if (defenders.length) attackers = attackers.filter((a) => a.type !== 'k');
    if (!attackers.length) continue;
    const cheapest = Math.min(...attackers.map((a) => AI_PIECE_VALUES[a.type]));
    const mark = !defenders.length ? ' — БЕЗ ЗАЩИТЫ'
      : cheapest < AI_PIECE_VALUES[p.type] ? ' — нападает более дешёвая фигура'
      : attackers.length > defenders.length ? ' — нападающих больше, чем защитников' : '';
    const list = (arr) => arr.map((a) => `${AI_PIECE_NAMES[a.type]} ${a.square}`).join(', ');
    threats.push({ own: p.color, text: `${aiPieceLabel(p.color, p.type)} ${sq}: нападают ${list(attackers)}; ${defenders.length ? `защищают ${list(defenders)}` : 'защиты нет'}${mark}.` });
  }
  if (g.in_checkmate()) return lines.join('\n');
  if (!threats.length) lines.push('Под боем нет ни одной фигуры.');
  else {
    // Сначала то, что может взять сторона, которая сейчас ходит
    for (const t of threats.filter((x) => x.own !== turn)) lines.push(`Под боем (${AI_SIDE[turn]} могут взять прямо сейчас): ${t.text}`);
    for (const t of threats.filter((x) => x.own === turn)) lines.push(`Под боем (угроза для ${AI_SIDE[turn] === 'белые' ? 'белых' : 'чёрных'}): ${t.text}`);
  }
  return lines.join('\n');
}

/* ---- Чат: блок STOCKFISH ---- */
// sf = { entry: {bestMove, score, depth, seldepth, pv}, alternatives: [{san, score}] },
// score — с точки зрения стороны, которая ходит в fen.
function formatStockfishContextBlock(fen, sf, playerColor = null) {
  if (!sf || !sf.entry || sf.entry.score == null) {
    return '\nSTOCKFISH: анализ этой позиции ещё не готов (недостаточная глубина).';
  }
  const { entry, alternatives } = sf;
  const toWhite = (s) => (fen.split(' ')[1] === 'w' ? s : -s);
  const white = toWhite(entry.score);
  const forPlayer = aiScoreForPlayer(white, playerColor);
  let bestSan = entry.bestMove;
  let bestWords = '';
  try {
    const g = new Chess(fen);
    const mv = g.move({ from: entry.bestMove.slice(0, 2), to: entry.bestMove.slice(2, 4), promotion: entry.bestMove.length === 5 ? entry.bestMove[4] : 'q' });
    if (mv) { bestSan = mv.san; bestWords = aiDescribeMove(mv); }
  } catch (e) { /* оставляем UCI */ }
  let block = `\nSTOCKFISH (глубина ${entry.depth}):\nОценка: ${aiScoreWords(white)}${forPlayer ? `; ${forPlayer}` : ''}.\nЛучший ход: ${bestSan}${bestWords ? ` (${bestWords})` : ''}.`;
  const line = aiPvToSan(fen, entry.pv);
  if (line) block += `\nГлавная линия (лучшая игра обеих сторон): ${line}`;
  if (alternatives && alternatives.length) {
    block += `\nALTERNATIVES:\n${alternatives.map((a, i) => `${i + 1}. ${a.san} — ${aiScoreWords(toWhite(a.score))}`).join('\n')}`;
  }
  return block;
}

/* ---- Чат: системный промпт ассистента ---- */
function buildPositionSystemPrompt(lengthRule, language) {
  return `Ты — шахматный тренер внутри приложения. Общайся с игроком ${language}. ${lengthRule}
В каждом сообщении тебе присылают позицию, историю ходов, блок ФАКТЫ О ПОЗИЦИИ, блок STOCKFISH и вопрос игрока.
Как работать с данными:
- Оценку и лучший ход бери только из блока STOCKFISH. Оценка там уже переведена в слова (чей перевес и для игрока лучше или хуже) — повторяй её смысл, не пересчитывай знак сам.
- Где стоят фигуры, что под боем, что защищено и что связано — бери из блока ФАКТЫ, он посчитан программой по доске и точнее твоего чтения FEN. Не утверждай, что фигура нападает на поле или стоит на поле, если этого нет в фактах или в главной линии.
- Объясняя лучший ход, опирайся на главную линию: какую угрозу создаёт первый ход и чем отвечает соперник. Ходы из линии можно называть.
- Ты НЕ придумываешь и не подбираешь лучший ход самостоятельно: называй bestMove из STOCKFISH или ход из ALTERNATIVES. Если блока STOCKFISH нет или анализ не готов — так и скажи, не гадай.
Отвечай на конкретный вопрос: угрозы, оценка ходов, одна-две идеи, без длинных планов.
Называй фигуры по-русски вместе с полем (конь d5), ходы можно писать в записи из линий (Nb4).
Отвечай простым текстом, без markdown-разметки (никаких **, #, списков через - или цифры).`;
}

/* ---- Окно «Анализ хода»: промпт объяснения ----
   mv — ход из chess.js (verbose), линии — строки UCI от Stockfish. */
function buildMoveExplainPrompt({ fenBefore, fenAfter, mv, bestUci, bestPv, replyPv, evalWhiteBefore, evalWhiteAfter, winBefore, winAfter, verdictLabel, language }) {
  const mover = AI_SIDE[mv.color];
  const isBest = bestUci && (mv.from + mv.to) === bestUci.slice(0, 4);
  const bestSan = bestUci ? (aiPvToSan(fenBefore, bestUci, 1).replace(/^\d+\.(\.\.)?/, '') || bestUci) : null;
  const cap = (s) => (s == null ? null : Math.max(-1000, Math.min(1000, s)));
  const sign = mv.color === 'w' ? 1 : -1;
  const before = cap(evalWhiteBefore);
  const after = cap(evalWhiteAfter);
  let change = '';
  if (before != null && after != null) {
    const delta = ((after - before) * sign) / 100;
    change = Math.abs(delta) < 0.2 ? 'Оценка почти не изменилась.'
      : delta < 0 ? `${mover[0].toUpperCase() + mover.slice(1)} потеряли около ${Math.abs(delta).toFixed(1)} пешки по оценке.`
      : `${mover[0].toUpperCase() + mover.slice(1)} улучшили оценку примерно на ${delta.toFixed(1)} пешки.`;
  }
  const replyLine = aiPvToSan(fenAfter, replyPv);
  const bestLine = aiPvToSan(fenBefore, bestPv || bestUci);
  const lines = [
    `Позиция до хода (FEN): ${fenBefore}`,
    `Ходили: ${mover}. Сыгранный ход: ${mv.san} (${aiDescribeMove(mv)}).`,
    `Категория хода по Stockfish: ${verdictLabel || 'неизвестно'}.`,
    `Оценка до хода: ${aiScoreWords(evalWhiteBefore)}. После хода: ${aiScoreWords(evalWhiteAfter)}. ${change}`,
  ];
  if (winBefore != null && winAfter != null) lines.push(`Шансы ходивших (${mover}) на победу: ${Math.round(winBefore)}% → ${Math.round(winAfter)}%.`);
  if (replyLine) lines.push(`Что Stockfish ждёт после сыгранного хода (лучшая игра обеих сторон): ${replyLine}`);
  if (isBest) lines.push('Сыгранный ход совпадает с лучшим ходом Stockfish.');
  else if (bestSan) lines.push(`Лучший ход по Stockfish вместо сыгранного: ${bestSan}${bestLine ? `, линия: ${bestLine}` : ''}.`);
  lines.push('', 'ФАКТЫ О ПОЗИЦИИ ПОСЛЕ ХОДА (посчитаны программой по доске):', aiPositionFacts(fenAfter, { placement: false }));
  lines.push('', `Объясни человеческим языком, почему ход ${mv.san} получил такую оценку: что он делает и что упускает или чем опасен.
Опирайся на линию «что Stockfish ждёт после сыгранного хода» и на факты: они показывают настоящую причину оценки. Не придумывай угроз и ходов, которых нет в линиях и фактах.${!isBest && bestSan ? ` Коротко скажи, чем лучше ${bestSan}.` : ''}
Если ход лучший или почти не уступает лучшему, так и скажи и не раздувай разницу. Не называй других «лучших ходов», кроме хода Stockfish.
2-3 предложения ${language}, простым текстом, без markdown.`);
  return lines.join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = { aiScoreWords, aiScoreForPlayer, aiPvToSan, aiDescribeMove, aiPositionFacts, formatStockfishContextBlock, buildPositionSystemPrompt, buildMoveExplainPrompt };
}
