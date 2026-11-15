// Детали хода (мини-доска) и разбор партии.
'use strict';

/* =========================================================================
   ЗАГРУЗЧИК С КОНЁМ
   Конь прыгает внутри кольца. Без процента кольцо крутится, с процентом —
   заполняется по ходу работы (разбор партии).
   ========================================================================= */
const KNIGHT_SRC_BY_ACCENT = {
  gold: 'assests/knight.webp',
  maroon: 'assests/knight-red.webp',
  blue: 'assests/knight-blue.webp',
  green: 'assests/knight-green.webp',
};
const KNIGHT_RING_LENGTH = 2 * Math.PI * 28;

function knightLoaderHtml(text, { determinate = false } = {}) {
  const src = KNIGHT_SRC_BY_ACCENT[document.documentElement.dataset.accent] || KNIGHT_SRC_BY_ACCENT.gold;
  return `<div class="knight-loader${determinate ? ' is-determinate' : ''}" role="status">
    <div class="knight-loader-stage">
      <svg class="knight-loader-ring" viewBox="0 0 64 64" aria-hidden="true">
        <circle class="knight-loader-track" cx="32" cy="32" r="28"></circle>
        <circle class="knight-loader-arc" cx="32" cy="32" r="28"
          style="stroke-dasharray:${KNIGHT_RING_LENGTH.toFixed(1)};stroke-dashoffset:${determinate ? KNIGHT_RING_LENGTH.toFixed(1) : (KNIGHT_RING_LENGTH * 0.72).toFixed(1)}"></circle>
      </svg>
      <img class="knight-loader-img" src="${src}" alt="">
      <span class="knight-loader-shadow" aria-hidden="true"></span>
    </div>
    <div class="knight-loader-text">${escapeHtml(text)}</div>
  </div>`;
}
function setKnightLoaderProgress(root, percent, text) {
  const arc = root.querySelector('.knight-loader-arc');
  if (arc) arc.style.strokeDashoffset = (KNIGHT_RING_LENGTH * (1 - clamp(percent, 0, 100) / 100)).toFixed(1);
  const label = root.querySelector('.knight-loader-text');
  if (label && text != null) label.textContent = text;
}

/* =========================================================================
   ОЦЕНКА ОДНОГО ХОДА
   Общая для разбора партии и для окна «Анализ хода» (в т.ч. по клику на
   ход в списке ходов, когда разбора ещё не было).
   ========================================================================= */
// Пороги качества хода — по падению шансов на победу (как на lichess), а не по
// сырым сантипешкам: «+12 → +9» ничего не меняет, а «+1 → −2» — серьёзная ошибка.
const WIN_DROP_INACCURACY = 10;
const WIN_DROP_MISTAKE = 20;
const WIN_DROP_BLUNDER = 30;
// Ход несёт информацию об уровне, только пока партия не решена: в позиции
// «+10» любой ход «точный» и ничего не говорит о силе игрока.
const DECIDED_EVAL = 700;
// Первые ходы почти всегда «как по книге» — лучшим ходом партии их не считаем.
const OPENING_PLIES = 12;

function classifyWinDrop(drop) {
  if (drop >= WIN_DROP_BLUNDER) return 'blunder';
  if (drop >= WIN_DROP_MISTAKE) return 'mistake';
  if (drop >= WIN_DROP_INACCURACY) return 'inaccuracy';
  return 'ok';
}
function moveAccuracyFromWinDrop(drop) {
  return clamp(103.1668 * Math.exp(-0.04354 * Math.max(0, drop)) - 3.1669, 0, 100);
}

// Для уровня игры оценку режем не на ±10, а на ±15 пешках, и мат дороже
// любого материала: иначе зевки в уже решённой позиции и упущенный мат
// выглядели «бесплатными». Потерю одного хода ограничиваем 6 пешками —
// один зевок ферзя не должен один перевешивать всю партию.
// Мат в N тоже различаем: «мат в 9» → «мат в 4» у проигрывающего — это
// отданная фигура (28.Be1?? Qxe1), а не «ничего не изменилось».
const LEVEL_EVAL_CAP = 1200;
const LEVEL_MATE_BASE = 1500;
const LEVEL_MOVE_LOSS_CAP = 600;
function levelScore(score) {
  if (score == null) return null;
  if (score > 50000) return LEVEL_MATE_BASE - Math.min(100000 - score, 25) * 10; // мат в N за нас: 1250…1490
  if (score < -50000) return -(LEVEL_MATE_BASE - Math.min(score + 100000, 25) * 10); // мат в N нам
  return clamp(score, -LEVEL_EVAL_CAP, LEVEL_EVAL_CAP);
}

// before/after — записи анализа (score относительно стороны, чей ход в FEN).
// flags.book — ход по дебютной теории, flags.forced — единственный ход:
// оба ничего не говорят о силе игрока и в точность и уровень не идут.
function buildMoveItem(move, ply, fenBefore, fenAfter, before, after, flags = {}) {
  const whiteBefore = scoreAbsoluteWhite(before, fenBefore);
  const whiteAfter = scoreAbsoluteWhite(after, fenAfter);
  const sign = move.color === 'w' ? 1 : -1;
  const capBefore = whiteBefore == null ? null : cappedCp(whiteBefore) * sign;
  const capAfter = whiteAfter == null ? null : cappedCp(whiteAfter) * sign;
  const known = capBefore != null && capAfter != null;
  // Сыгран лучший ход движка — потери нет по определению. Разница оценок
  // «до» и «после» здесь — только шум от разной глубины счёта.
  const playedBest = !!(before && before.bestMove && before.bestMove.slice(0, 4) === move.from + move.to);
  const loss = known && !playedBest ? Math.max(0, capBefore - capAfter) : 0;
  const winBefore = capBefore != null ? winChance(capBefore) : null;
  const winAfter = capAfter != null ? winChance(capAfter) : null;
  const winDrop = known && !playedBest ? Math.max(0, winBefore - winAfter) : 0;
  let classification = known ? classifyWinDrop(winDrop) : 'ok';
  // Был форсированный мат, а после хода его нет: в выигранной позиции шансы
  // почти не меняются, но это всё равно промах.
  const mateBefore = whiteBefore != null && whiteBefore * sign > 50000;
  const mateAfter = whiteAfter != null && whiteAfter * sign > 50000;
  const missedMate = known && !playedBest && mateBefore && !mateAfter;
  if (missedMate && classification === 'ok') classification = 'inaccuracy';
  const lb = whiteBefore == null ? null : levelScore(whiteBefore * sign);
  const la = whiteAfter == null ? null : levelScore(whiteAfter * sign);
  const levelLoss = known && !playedBest ? Math.min(LEVEL_MOVE_LOSS_CAP, Math.max(0, lb - la)) : 0;
  // Ход в уже решённой позиции идёт в уровень с меньшим весом, но идёт
  const decidedness = known ? Math.min(Math.abs(lb), Math.abs(la)) : LEVEL_EVAL_CAP;
  const counts = known && !flags.book && !flags.forced;
  const levelWeight = counts ? clamp((1000 - decidedness) / 300, 0.25, 1) : 0;
  return {
    move, ply, fenBefore, fenAfter,
    bestMove: before && before.bestMove || null,
    playedMove: move.san,
    evalWhiteBefore: whiteBefore, // как есть, с матами — для подписи «мат в N»
    evalWhiteAfter: whiteAfter,
    evalBefore: capBefore, // с точки зрения ходившего, обрезано до ±10 пешек
    evalAfter: capAfter,
    winBefore, winAfter, winDrop,
    accuracy: known ? moveAccuracyFromWinDrop(winDrop) : null,
    depth: before && before.depth || 0,
    pv: before && before.pv || null,
    loss,
    delta: move.color === 'w' ? -loss : loss, // сохранено для обратной совместимости (achievements.js)
    classification,
    critical: classification === 'mistake' || classification === 'blunder',
    informative: counts,
    decided: known && Math.abs(capBefore) >= DECIDED_EVAL && Math.abs(capAfter) >= DECIDED_EVAL,
    book: !!flags.book,
    forced: !!flags.forced,
    playedBest, missedMate, levelLoss, levelWeight,
  };
}

const MOVE_CLASS_LABELS = {
  best: 'Лучший ход',
  ok: 'Хороший ход',
  inaccuracy: 'Неточность',
  mistake: 'Ошибка',
  blunder: 'Зевок',
};
function moveVerdict(item) {
  if (!item || item.evalBefore == null || item.evalAfter == null) return null;
  const isEngineBest = item.bestMove && item.move && (item.move.from + item.move.to) === item.bestMove.slice(0, 4);
  if (item.classification === 'ok' && (isEngineBest || item.loss <= 10)) return 'best';
  return item.classification;
}

// «+1.4», «−0.3», «мат в 3»
function formatEval(whiteScore) {
  if (whiteScore == null) return '—';
  if (Math.abs(whiteScore) >= 90000) {
    const n = 100000 - Math.abs(whiteScore);
    const side = whiteScore > 0 ? t('белым') : t('чёрным');
    return n <= 0 ? t('мат') : t('мат {side} в {n}', { side, n });
  }
  const pawns = whiteScore / 100;
  if (Math.abs(pawns) < 0.05) return '0.0';
  return `${pawns > 0 ? '+' : '−'}${Math.abs(pawns).toFixed(1)}`;
}
function moveNumberLabel(item) {
  const fullMove = parseInt((item.fenBefore || '').split(' ')[5], 10) || Math.floor(item.ply / 2) + 1;
  return item.move.color === 'w' ? `${fullMove}.` : `${fullMove}…`;
}
function uciToSan(fen, uci) {
  if (!uci) return null;
  try {
    const g = new Chess(fen);
    const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length === 5 ? uci[4] : 'q' });
    return mv ? mv.san : uci;
  } catch (e) { return uci; }
}

/* =========================================================================
   СТРЕЛКИ НА МИНИ-ДОСКЕ
   Толстая полупрозрачная стрелка с широким наконечником; ход коня рисуется
   уголком, как его и видит глаз. Вся стрелка — одна группа с общей
   прозрачностью, поэтому стык стержня и наконечника не темнеет.
   ========================================================================= */
const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW_COLORS = {
  best: '#5CB87A',
  ok: '#7FB2E5',
  inaccuracy: '#E3B341',
  mistake: '#E8873A',
  blunder: '#E05555',
  engine: '#5CB87A',
  neutral: 'var(--gold)',
};

function squareCenter(sq, flipped) {
  const file = 'abcdefgh'.indexOf(sq[0]);
  const rank = parseInt(sq[1], 10) - 1;
  const x = (file + 0.5) * 12.5;
  const y = (7 - rank + 0.5) * 12.5;
  return flipped ? { x: 100 - x, y: 100 - y } : { x, y };
}

function drawBoardArrow(svg, from, to, color, { flipped = false, opacity = 0.9, width = 1.9, dashed = false } = {}) {
  const a = squareCenter(from, flipped);
  const b = squareCenter(to, flipped);
  const df = Math.abs('abcdefgh'.indexOf(from[0]) - 'abcdefgh'.indexOf(to[0]));
  const dr = Math.abs(parseInt(from[1], 10) - parseInt(to[1], 10));
  const isKnightJump = (df === 1 && dr === 2) || (df === 2 && dr === 1);
  // Уголок коня: сначала на две клетки, потом на одну
  const points = [a];
  if (isKnightJump) points.push(dr === 2 ? { x: a.x, y: b.y } : { x: b.x, y: a.y });

  const prev = points[points.length - 1];
  const len = Math.hypot(b.x - prev.x, b.y - prev.y) || 1;
  const ux = (b.x - prev.x) / len;
  const uy = (b.y - prev.y) / len;
  const headLen = 4.4;
  const headHalf = 2.9;
  const tip = { x: b.x + ux * 1.6, y: b.y + uy * 1.6 };
  const base = { x: tip.x - ux * headLen, y: tip.y - uy * headLen };
  points.push({ x: base.x + ux * 0.6, y: base.y + uy * 0.6 }); // стержень заходит под наконечник

  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'board-arrow');
  g.setAttribute('opacity', String(opacity));
  g.style.color = color;

  const shaft = document.createElementNS(SVG_NS, 'polyline');
  shaft.setAttribute('points', points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '));
  shaft.setAttribute('fill', 'none');
  shaft.setAttribute('stroke', 'currentColor');
  shaft.setAttribute('stroke-width', String(width));
  shaft.setAttribute('stroke-linecap', 'round');
  shaft.setAttribute('stroke-linejoin', 'round');
  if (dashed) shaft.setAttribute('stroke-dasharray', '2.6 2');
  g.appendChild(shaft);

  const head = document.createElementNS(SVG_NS, 'polygon');
  const px = -uy;
  const py = ux;
  head.setAttribute('points', [
    `${tip.x.toFixed(2)},${tip.y.toFixed(2)}`,
    `${(base.x + px * headHalf).toFixed(2)},${(base.y + py * headHalf).toFixed(2)}`,
    `${(base.x - px * headHalf).toFixed(2)},${(base.y - py * headHalf).toFixed(2)}`,
  ].join(' '));
  head.setAttribute('fill', 'currentColor');
  head.setAttribute('stroke', 'currentColor');
  head.setAttribute('stroke-width', '0.8');
  head.setAttribute('stroke-linejoin', 'round');
  g.appendChild(head);

  svg.appendChild(g);
}

function highlightDetailSquares(from, to, verdict) {
  document.querySelectorAll('#moveDetailBoard [data-square]').forEach((el) => {
    el.classList.remove('md-sq-from', 'md-sq-to');
    el.removeAttribute('data-verdict');
  });
  const fromEl = document.querySelector(`#moveDetailBoard [data-square="${from}"]`);
  const toEl = document.querySelector(`#moveDetailBoard [data-square="${to}"]`);
  if (fromEl) fromEl.classList.add('md-sq-from');
  if (toEl) { toEl.classList.add('md-sq-to'); if (verdict) toEl.dataset.verdict = verdict; }
}

/* =========================================================================
   ОКНО «АНАЛИЗ ХОДА»
   ========================================================================= */
let moveDetailBoard = null;
let moveDetailToken = 0;
let moveDetailItem = null; // оценка хода, открытого сейчас (null — ещё считается)
// Разбор последней партии: окно хода берёт отсюда готовые оценки, а не
// пересчитывает их заново.
let lastMoveAnalysis = [];

function renderMoveDetailFacts(item) {
  const factsEl = $id('moveDetailFacts');
  const verdict = moveVerdict(item);
  if (!verdict) { factsEl.innerHTML = ''; return; }
  const bestSan = uciToSan(item.fenBefore, item.bestMove);
  const winB = Math.round(item.winBefore);
  const winA = Math.round(item.winAfter);
  const winDelta = winA - winB;
  const lossPawns = (item.loss / 100).toFixed(1);
  const accuracy = Math.round(item.accuracy);
  const isEngineBest = verdict === 'best' && bestSan === item.move.san;

  const verdictNote = {
    best: isEngineBest ? t('Совпадает с первой линией Stockfish') : t('Почти не уступает лучшему ходу'),
    ok: t('Позиция сохранена, есть ход чуть точнее'),
    inaccuracy: t('Небольшая потеря, позиция ещё держится'),
    mistake: t('Заметно ухудшает позицию'),
    blunder: t('Резко меняет оценку партии'),
  }[verdict];

  factsEl.innerHTML = `
    <div class="md-verdict" data-verdict="${verdict}">
      <span class="md-verdict-dot" aria-hidden="true"></span>
      <div class="md-verdict-text">
        <b>${t(MOVE_CLASS_LABELS[verdict])}</b>
        <span>${escapeHtml(verdictNote)}</span>
      </div>
      <div class="md-verdict-score" title="${escapeHtml(t('Точность хода'))}"><b>${accuracy}%</b><span>${t('точность')}</span></div>
    </div>

    <div class="md-win">
      <div class="md-win-head">
        <span>${t('Шансы на победу у {side}', { side: item.move.color === 'w' ? t('белых') : t('чёрных') })}</span>
        <b>${winB}% → ${winA}% <em class="${winDelta < 0 ? 'is-down' : 'is-up'}">${winDelta > 0 ? '+' : winDelta < 0 ? '−' : '±'}${Math.abs(winDelta)}</em></b>
      </div>
      <div class="md-win-track">
        <span class="md-win-fill" style="width:${winA}%"></span>
        <span class="md-win-marker" style="left:${winB}%" title="${escapeHtml(t('до хода'))}"></span>
      </div>
    </div>

    <div class="md-tiles">
      <div class="md-tile"><span>${t('Оценка')}</span><b>${formatEval(item.evalWhiteBefore)} → ${formatEval(item.evalWhiteAfter)}</b></div>
      <div class="md-tile"><span>${t('Потеря')}</span><b>${item.loss < 5 ? t('нет') : t('{n} пешки', { n: lossPawns })}</b></div>
      <div class="md-tile md-tile-best"><span>${t('Лучший по Stockfish')}</span><b>${isEngineBest ? `${escapeHtml(item.move.san)} ✓` : escapeHtml(bestSan || '—')}</b></div>
    </div>`;
}

// chessboard.js округляет размер доски до кратного 8 пикселей, поэтому слой
// со стрелками подгоняем ровно под саму доску, а не под её контейнер.
function alignArrowLayer() {
  const svg = $id('moveDetailArrow');
  const boardEl = document.querySelector('#moveDetailBoard .board-b72b1');
  const box = svg.parentElement;
  if (!boardEl || !box) return;
  const b = boardEl.getBoundingClientRect();
  const c = box.getBoundingClientRect();
  svg.style.left = `${b.left - c.left}px`;
  svg.style.top = `${b.top - c.top}px`;
  svg.style.width = `${b.width}px`;
  svg.style.height = `${b.height}px`;
}

function drawMoveDetailArrows(item, playedMove) {
  const svg = $id('moveDetailArrow');
  svg.innerHTML = '';
  alignArrowLayer();
  const legend = $id('moveDetailLegend');
  const verdict = moveVerdict(item);
  const playedColor = verdict ? ARROW_COLORS[verdict] : ARROW_COLORS.neutral;
  const bestUci = item && item.bestMove;
  const sameAsBest = bestUci && playedMove && bestUci.slice(0, 4) === playedMove.from + playedMove.to;

  if (bestUci && !sameAsBest) {
    drawBoardArrow(svg, bestUci.slice(0, 2), bestUci.slice(2, 4), ARROW_COLORS.engine, { opacity: 0.85, width: 1.6, dashed: true });
  }
  if (playedMove) drawBoardArrow(svg, playedMove.from, playedMove.to, playedColor);
  if (playedMove) highlightDetailSquares(playedMove.from, playedMove.to, verdict);

  const rows = [];
  if (playedMove) rows.push(`<span class="md-legend-item"><i style="background:${playedColor}"></i>${t('Сыгранный ход')}</span>`);
  if (bestUci && !sameAsBest) rows.push(`<span class="md-legend-item"><i class="is-dashed" style="background:${ARROW_COLORS.engine}"></i>${t('Лучший ход')}</span>`);
  legend.innerHTML = rows.join('');
}

async function openMoveDetail(fenBefore, san, label = null) {
  const token = ++moveDetailToken;
  moveDetailItem = null;
  const modal = $id('moveDetailModal');
  const badgeEl = $id('moveDetailBadge');
  const sanEl = $id('moveDetailSan');
  const commentEl = $id('moveDetailComment');
  const loadingEl = $id('moveDetailLoading');
  const factsEl = $id('moveDetailFacts');

  $id('moveDetailTitle').textContent = t('Анализ хода');
  commentEl.innerHTML = '';
  commentEl.classList.add('hidden');
  factsEl.innerHTML = '';
  $id('moveDetailArrow').innerHTML = '';
  $id('moveDetailLegend').innerHTML = '';
  loadingEl.innerHTML = knightLoaderHtml(t('Stockfish изучает позицию…'));
  loadingEl.classList.remove('hidden');
  modal.classList.remove('hidden');

  badgeEl.className = 'move-detail-badge';
  const isFriend = state.mode === 'friend';
  if (label === 'best') {
    badgeEl.innerHTML = achievementIconSvg('circle-check') + (isFriend ? t('Лучший ход партии') : t('Ваш лучший ход'));
    badgeEl.classList.add('is-visible', 'is-best');
  } else if (label === 'worst') {
    badgeEl.innerHTML = achievementIconSvg('circle-x') + (isFriend ? t('Худший ход партии') : t('Ваша главная ошибка'));
    badgeEl.classList.add('is-visible', 'is-worst');
  }

  const tempGame = new Chess(fenBefore);
  const playedMove = tempGame.move(san);
  const fenAfter = playedMove ? tempGame.fen() : null;
  const ply = state.fenHistory.indexOf(fenBefore);

  const sideText = fenBefore.split(' ')[1] === 'w' ? t('ход белых') : t('ход чёрных');
  const fullMove = parseInt(fenBefore.split(' ')[5], 10) || 1;
  sanEl.innerHTML = `<b>${fullMove}${fenBefore.split(' ')[1] === 'w' ? '.' : '…'} ${escapeHtml(san)}</b><span>${sideText}</span>`;

  // Позиция ДО хода: на ней видно и сыгранный ход, и то, что было лучше
  if (!moveDetailBoard) {
    moveDetailBoard = Chessboard('moveDetailBoard', {
      position: fenBefore,
      draggable: false,
      pieceTheme: pieceThemeFn,
      showNotation: true,
    });
    window.addEventListener('resize', () => {
      if (!moveDetailBoard) return;
      moveDetailBoard.resize();
      alignArrowLayer();
      // resize() перерисовывает клетки — возвращаем подсветку хода
      const mv = moveDetailItem && moveDetailItem.move;
      if (mv) highlightDetailSquares(mv.from, mv.to, moveVerdict(moveDetailItem));
    });
  } else {
    moveDetailBoard.position(fenBefore, false);
  }
  requestAnimationFrame(() => {
    if (token !== moveDetailToken || !moveDetailBoard) return;
    moveDetailBoard.resize();
    moveDetailBoard.position(fenBefore, false);
    if (playedMove) drawMoveDetailArrows(moveDetailItem, playedMove);
  });
  if (!playedMove) {
    console.warn('Не удалось выполнить ход из SAN:', san);
    loadingEl.classList.add('hidden');
    return;
  }

  try {
    let item = lastMoveAnalysis.find(m => m.fenBefore === fenBefore && m.move.san === san) || null;
    if (!item || !item.bestMove || item.evalBefore == null) {
      const before = await analyzePosition(fenBefore, { movetime: 600 });
      const after = await analyzePosition(fenAfter, { movetime: 500 });
      item = buildMoveItem(playedMove, ply >= 0 ? ply : 0, fenBefore, fenAfter, before, after);
    }
    if (token !== moveDetailToken) return;

    moveDetailItem = item;
    renderMoveDetailFacts(item);
    drawMoveDetailArrows(item, playedMove);

    if (!chatSignedIn) {
      loadingEl.classList.add('hidden');
      commentEl.textContent = t('Объяснение от нейросети доступно после входа в аккаунт.');
      commentEl.classList.remove('hidden');
      return;
    }

    setKnightLoaderProgress(loadingEl, 0, t('Нейросеть объясняет ход…'));
    const verdict = moveVerdict(item);
    // Ответ движка на сыгранный ход — главное для объяснения: без него модель
    // не видит, чем ход опровергается (например, шах Сb4+ после Сxd8).
    let afterEntry = analysisCache.get(fenAfter);
    if (!afterEntry || !afterEntry.pv) afterEntry = await analyzePosition(fenAfter, { movetime: 500 });
    if (token !== moveDetailToken) return;
    const prompt = buildMoveExplainPrompt({ // js/ai-prompts.js
      fenBefore, fenAfter, mv: playedMove,
      bestUci: item.bestMove, bestPv: item.pv, replyPv: afterEntry && afterEntry.pv,
      evalWhiteBefore: item.evalWhiteBefore, evalWhiteAfter: item.evalWhiteAfter,
      winBefore: item.winBefore, winAfter: item.winAfter,
      verdictLabel: MOVE_CLASS_LABELS[verdict], language: AI_LANGUAGE,
    });
    const reply = await provodChat([{ role: 'user', content: prompt }], { temperature: 0.4, task: 'move' });
    if (token !== moveDetailToken) return;
    commentEl.textContent = stripMarkdown(reply) || t('Не удалось получить комментарий.');
  } catch (error) {
    if (token !== moveDetailToken) return;
    commentEl.textContent = chatErrorMessage(error);
  } finally {
    if (token === moveDetailToken) {
      loadingEl.classList.add('hidden');
      if (commentEl.textContent) commentEl.classList.remove('hidden');
    }
  }
}

/* =========================================================================
   АНАЛИЗ ПАРТИИ
   ========================================================================= */
function startProgress() {
  const loadingEl = $id('analysisLoading');
  loadingEl.innerHTML = knightLoaderHtml(t('Подготовка анализа…'), { determinate: true });
}
function updateProgress(step, total, san) {
  const percent = Math.round((step / total) * 100);
  setKnightLoaderProgress($id('analysisLoading'), percent, san
    ? t('Проверка хода: {san} ({percent}%)', { san, percent })
    : t('Анализ начальной позиции… ({percent}%)', { percent }));
}
function stopProgress(success = true) {
  if (success) setKnightLoaderProgress($id('analysisLoading'), 100, t('Готово'));
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

// Насколько заранее известна сила стороны: у персонажа — его заявленный
// рейтинг, у Stockfish — рейтинг выбранного уровня. У игрока — неизвестна.
function knownSideElo(color) {
  if (state.mode === 'friend' || color === state.playerColor) return null;
  if (state.mode === 'characters' && state.character) return state.character.elo;
  if (state.mode === 'ai') return aiOpponentElo();
  return null;
}

// Уровень игры в этой партии — по средней потере за ход (взвешенной: ходы
// в уже решённой позиции весят меньше, книжные и единственные ходы не идут).
// К заявленному рейтингу соперника и к рейтингу аккаунта больше не
// подтягиваем: разбор показывает, как сыграно, а заявленное — рядом.
const ELO_MIN_MOVES = 3;
const ELO_MIN_RATED_MOVES = 10; // с этого числа ходов уровень показывается в разборе
function estimateSideElo(items) {
  const counted = items.filter(m => m.informative && m.levelWeight > 0);
  const n = counted.length;
  if (n < ELO_MIN_MOVES) return { elo: null, moves: n };
  const weight = counted.reduce((sum, m) => sum + m.levelWeight, 0);
  const avgLoss = counted.reduce((sum, m) => sum + m.levelLoss * m.levelWeight, 0) / weight;
  return { elo: eloFromAvgCpl(avgLoss), avgLoss, moves: n };
}

// Точность партии — как на lichess: среднее из взвешенного по «остроте»
// позиции и гармонического среднего точностей ходов. Простое среднее
// завышало точность: десяток лёгких ходов прятал один зевок.
function gameAccuracy(items) {
  const scored = items.filter(m => m.accuracy != null && !m.book && !m.forced);
  if (!scored.length) return null;
  const wSum = scored.reduce((sum, m) => sum + (m.volatility || 1), 0);
  const weighted = scored.reduce((sum, m) => sum + m.accuracy * (m.volatility || 1), 0) / wSum;
  const harmonic = scored.length / scored.reduce((sum, m) => sum + 1 / Math.max(m.accuracy, 1), 0);
  return (weighted + harmonic) / 2;
}

// Вес хода по «остроте»: разброс шансов белых в окне вокруг хода (lichess).
function attachVolatility(items) {
  if (!items.length) return;
  const wins = [items[0].move.color === 'w' ? items[0].winBefore : 100 - items[0].winBefore];
  items.forEach(m => wins.push(m.winAfter == null ? wins[wins.length - 1] : (m.move.color === 'w' ? m.winAfter : 100 - m.winAfter)));
  const size = clamp(Math.floor(wins.length / 10), 2, 8);
  const windows = [];
  for (let i = 0; i < size - 2; i++) windows.push(wins.slice(0, size));
  for (let i = 0; i + size <= wins.length; i++) windows.push(wins.slice(i, i + size));
  items.forEach((m, i) => {
    const w = windows[Math.min(i, windows.length - 1)] || [];
    const mean = avg(w);
    const sd = Math.sqrt(avg(w.map(x => (x - mean) ** 2)));
    m.volatility = clamp(sd, 0.5, 12);
  });
}

// Какие ходы партии сыграны по дебютной книге (js/openings.js): начало
// партии совпадает с одним из вариантов книги.
function bookPliesCount(moves) {
  const sans = moves.map(m => stripSanMarks(m.san));
  let best = 0;
  for (const opening of Object.values(OPENING_BOOK)) {
    for (const line of opening.lines) {
      let k = 0;
      while (k < line.length && k < sans.length && line[k] === sans[k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

function sideStats(items, color) {
  const own = items.filter(m => m.move.color === color);
  const counted = own.filter(m => !m.book && !m.forced);
  const count = (cls) => own.filter(m => m.classification === cls).length;
  const prior = knownSideElo(color);
  const est = estimateSideElo(own);
  return {
    moves: own.length,
    accuracy: gameAccuracy(own) ?? 0,
    avgCpl: avg(counted.map(m => m.loss)),
    inaccuracies: count('inaccuracy'),
    mistakes: count('mistake'),
    blunders: count('blunder'),
    elo: est.elo,
    eloMoves: est.moves,
    knownElo: prior,
  };
}

// Ход, которым стоит гордиться: после дебюта, точный и заметно улучшивший
// положение (обычно — наказание за ошибку соперника).
function pickBestMove(items) {
  const pool = items.filter(m => m.ply >= OPENING_PLIES && m.classification === 'ok' && m.loss <= 25 && m.winAfter != null);
  if (!pool.length) return null;
  let best = null;
  let bestValue = -Infinity;
  for (const m of pool) {
    const prevOwn = items.find(p => p.ply === m.ply - 2);
    const swing = prevOwn && prevOwn.winAfter != null ? m.winAfter - prevOwn.winAfter : 0;
    const flags = m.move.flags || '';
    const value = swing + (flags.includes('c') ? 3 : 0) + (m.move.san.includes('+') ? 2 : 0) - m.loss * 0.05;
    if (value > bestValue) { bestValue = value; best = m; }
  }
  return best;
}
function pickWorstMove(items) {
  let worst = null;
  for (const m of items) {
    if (m.classification === 'ok') continue; // хороший ход ошибкой не называем
    if (!worst || m.winDrop > worst.winDrop || (m.winDrop === worst.winDrop && m.loss > worst.loss)) worst = m;
  }
  return worst;
}

// Считает moveAnalysis + агрегированную статистику (Accuracy/CPL/Elo/…) по
// уже имеющемуся набору evaluations. Чистая функция без обращений к
// Stockfish — используется и для быстрого предварительного прохода, и для
// уточнённого результата после фонового доуглубления (ТЗ п.2).
function computeGameStats(fens, moves, evaluations) {
  const moveAnalysis = [];
  const bookPlies = bookPliesCount(moves);
  for (let j = 0; j < moves.length; j++) {
    if (!evaluations[j]) continue;
    const flags = { book: j < bookPlies, forced: new Chess(fens[j]).moves().length === 1 };
    moveAnalysis.push(buildMoveItem(moves[j], j, fens[j], fens[j + 1], evaluations[j], evaluations[j + 1], flags));
  }
  attachVolatility(moveAnalysis);
  const white = sideStats(moveAnalysis, 'w');
  const black = sideStats(moveAnalysis, 'b');

  // Лучший и худший ход — ходы игрока (в игре вдвоём — любой стороны)
  const mine = state.mode === 'friend' ? moveAnalysis : moveAnalysis.filter(m => m.move.color === state.playerColor);

  return {
    moveAnalysis, white, black,
    accuracyWhite: white.accuracy, accuracyBlack: black.accuracy,
    avgCplWhite: white.avgCpl, avgCplBlack: black.avgCpl,
    eloWhite: white.elo, eloBlack: black.elo,
    statsWhite: white, statsBlack: black,
    bestMoveObj: pickBestMove(mine),
    worstMoveObj: pickWorstMove(mine),
  };
}

// Счётчик запусков Review Analysis — если пользователь запустил новый анализ
// (или он же — «Обновить анализ») пока предыдущий ещё фоново уточнялся,
// старое фоновое уточнение узнаёт об этом (runId !== analysisRunId) и
// прекращает себя, не затирая уже более новый результат.
let analysisRunId = 0;

async function requestAnalysis() {
  const btn = $id('requestAnalysisBtn');
  const loading = $id('analysisLoading');
  const content = $id('analysisContent');
  const block = $id('analysisBlock');

  block.classList.remove('hidden');
  loading.classList.remove('hidden');
  content.innerHTML = '';
  btn.disabled = true;
  trackGoal('analysis_request');

  startProgress();

  const runId = ++analysisRunId;

  try {
    const fens = state.fenHistory;
    const moves = state.game.history({ verbose: true });
    if (fens.length < 2) throw new Error(t('Недостаточно ходов для анализа.'));

    await waitForEngine(3000);
    if (!isEngineReady) throw new Error(t('Движок Stockfish не готов. Обновите страницу и попробуйте снова.'));

    // Если последняя позиция партии всё ещё анализируется в фоне (Infinite
    // Analysis) — останавливаем и сохраняем в кэш то, что уже накоплено.
    await stopBackgroundAnalysis();

    const weakPc = state.settings.analysisMode === 'weak';
    const baseDepth = weakPc ? ANALYSIS_TARGET.weakReviewBaseDepth : ANALYSIS_TARGET.reviewBaseDepth;
    const criticalDepth = weakPc ? ANALYSIS_TARGET.weakReviewCriticalDepth : ANALYSIS_TARGET.reviewCriticalDepth;

    // ФАЗА 1 (быстрая, ТЗ п.2): берём то, что уже накоплено в общем кэше
    // (в т.ч. из Live Analysis во время партии), и только для полностью
    // непроанализированных позиций делаем короткий разовый скан.
    const total = fens.length;
    const prelimEvaluations = [];
    for (let i = 0; i < fens.length; i++) {
      const result = analysisCache.get(fens[i]) || await analyzePosition(fens[i], { movetime: 250 });
      prelimEvaluations.push(result);
      updateProgress(i + 1, total, moves[i] ? moves[i].san : null);
    }

    const prelimStats = computeGameStats(fens, moves, prelimEvaluations);
    stopProgress(true);
    renderAnalysis(prelimStats, moves.length, t('Уточняю анализ партии в фоне…'), { refining: true });
    hideConnectionBanner();

    // ФАЗА 2 (фоновая, ТЗ п.2): доуглубляем и пересчитываем, не блокируя окно.
    refineGameAnalysis(runId, fens, moves, weakPc, baseDepth, criticalDepth);
  } catch (error) {
    console.error('Ошибка анализа:', error);
    content.innerHTML = `<p class="analysis-error">${t('Не удалось получить анализ.')} ${escapeHtml(error.message)}</p>`;
    showConnectionBanner(t('Ошибка: {error}', { error: error.message }));
  } finally {
    loading.classList.add('hidden');
    btn.disabled = false;
    btn.textContent = t('Обновить анализ');
  }
}

// Фоновое углубление уже показанного предварительного результата (ТЗ п.2).
async function refineGameAnalysis(runId, fens, moves, weakPc, baseDepth, criticalDepth) {
  try {
    while (analysisQueue.length) {
      if (runId !== analysisRunId) return;
      await processAnalysisQueueOnce();
    }
    if (runId !== analysisRunId) return;

    // Потеря хода — разность оценок «до» и «после». Если «до» досчитано в фоне
    // до глубины 22, а «после» — до 14, разность — шум глубины, а не ошибка.
    // Поэтому позицию «после» считаем не мельче, чем «до» минус один полуход.
    const evaluations = [];
    for (let i = 0; i < fens.length; i++) {
      if (runId !== analysisRunId) return;
      const prevDepth = i > 0 && evaluations[i - 1] ? evaluations[i - 1].depth || 0 : 0;
      const minDepth = clamp(prevDepth - 1, baseDepth, criticalDepth);
      const result = await analyzePosition(fens[i], { minDepth });
      evaluations.push(result);
    }
    if (runId !== analysisRunId) return;

    let stats = computeGameStats(fens, moves, evaluations);

    // Критические ходы (ТЗ п.5/11): позицию ДО хода — глубже и с MultiPV.
    const criticalItems = stats.moveAnalysis.filter(m => m.critical).sort((a, b) => b.winDrop - a.winDrop).slice(0, weakPc ? 3 : 8);
    for (const item of criticalItems) {
      if (runId !== analysisRunId) return;
      try {
        const deep = await analyzePosition(item.fenBefore, { minDepth: criticalDepth });
        if (deep) { item.depth = deep.depth; item.bestMove = deep.bestMove; item.pv = deep.pv; }
        // И позицию после хода — той же глубины, чтобы досчёт менял и оценку хода
        await analyzePosition(item.fenAfter, { minDepth: criticalDepth - 1 });
        const candidates = await searchTopMoves(item.fenBefore, { movetime: weakPc ? 500 : 900, multipv: weakPc ? 2 : 3 });
        item.alternatives = describeCandidateMoves(item.fenBefore, candidates);
      } catch (e) { /* если доанализ не удался — оставляем базовый результат */ }
    }
    if (runId !== analysisRunId) return;

    // Берём досчитанные оценки из кэша: раньше пересчёт шёл по старым, и
    // глубокий счёт ошибок менял только показанный лучший ход, но не вердикт.
    const refinedEvaluations = fens.map((fen, i) => analysisCache.get(fen) || evaluations[i]);
    stats = computeGameStats(fens, moves, refinedEvaluations);
    stats.moveAnalysis.forEach((m) => {
      const refined = criticalItems.find(c => c.fenBefore === m.fenBefore && c.move.san === m.move.san);
      if (refined) { m.depth = refined.depth; m.bestMove = refined.bestMove; m.pv = refined.pv; m.alternatives = refined.alternatives; }
    });

    const pgn = state.game.pgn();
    let comment = chatSignedIn ? t('Комментарий недоступен.') : t('Комментарий нейросети к партии появится после входа в аккаунт.');
    if (chatSignedIn) try {
      const prompt = `Партия в шахматы (PGN): ${pgn}
Точность белых (расчёт движка): ${stats.accuracyWhite.toFixed(1)}%, средняя потеря centipawn: ${stats.avgCplWhite.toFixed(0)}.
Точность чёрных: ${stats.accuracyBlack.toFixed(1)}%, средняя потеря centipawn: ${stats.avgCplBlack.toFixed(0)}.
Лучший ход игрока: ${stats.bestMoveObj ? stats.bestMoveObj.move.san : '—'}.
Главная ошибка игрока: ${stats.worstMoveObj ? stats.worstMoveObj.move.san : '—'}.
Дай короткий (2-3 предложения) комментарий о партии ${AI_LANGUAGE} простым текстом, без markdown-разметки.`;
      const raw = await provodChat([{ role: 'user', content: prompt }], { temperature: 0.4, task: 'move' });
      comment = stripMarkdown(raw) || comment;
    } catch (e) {
      console.error('Ошибка комментария ИИ:', e);
    }

    if (runId !== analysisRunId) return; // пользователь успел запустить новый анализ — не затираем его результат

    renderAnalysis(stats, moves.length, comment);

    // Старая партия из «Моих партий»: разбор только для просмотра — иначе
    // повторные разборы двигали бы рейтинг и копили достижения за анализ.
    if (state.isReview) return;
    if (window.Achievements) {
      const evaluationsAbsoluteWhite = fens.map((fen, i) => scoreAbsoluteWhite(refinedEvaluations[i], fen));
      window.Achievements.trackAnalysis({
        accuracyWhite: stats.accuracyWhite, accuracyBlack: stats.accuracyBlack,
        eloWhite: stats.eloWhite, eloBlack: stats.eloBlack,
        moveAnalysis: stats.moveAnalysis, evaluationsAbsoluteWhite,
      });
    }
    // Рейтинг аккаунта разбор больше не трогает: его считает база по
    // результату партии (см. applyRatedGameResult в account.js).
  } catch (error) {
    console.error('Ошибка фонового уточнения анализа:', error);
  }
}

function sideTitle(color) {
  if (state.mode === 'friend') return color === 'w' ? t('Белые') : t('Чёрные');
  if (color === state.playerColor) return t('Вы');
  if (state.mode === 'characters' && state.character) return state.character.name;
  if (state.mode === 'online') return state.onlineOpponentName || t('Соперник');
  return 'Stockfish';
}

function eloCell(side) {
  // По трём-пяти дебютным ходам «уровень ~1900» — шум: оценку показываем с того же
  // числа ходов, с которого партия влияет на рейтинг. У соперника с известной силой — его рейтинг.
  if (side.elo == null || side.eloMoves < ELO_MIN_RATED_MOVES) {
    // Мало ходов, чтобы судить об уровне: у соперника с известной силой — его рейтинг
    if (side.knownElo != null) return `≈${side.knownElo}<small>${t('заявлено')}</small>`;
    return `<span class="muted">${t('мало ходов')}</span>`;
  }
  const known = side.knownElo != null ? `<small>${t('заявлено ≈{elo}', { elo: side.knownElo })}</small>` : '';
  return `~${side.elo}${known}`;
}

function moveCardHtml(kind, item) {
  const verdict = moveVerdict(item);
  const title = kind === 'best'
    ? (state.mode === 'friend' ? t('Лучший ход партии') : t('Ваш лучший ход'))
    : (state.mode === 'friend' ? t('Худший ход партии') : t('Ваша главная ошибка'));
  const winDelta = Math.round(item.winAfter - item.winBefore);
  const detail = kind === 'best'
    ? t('{label} · шансы {win}%', { label: t(MOVE_CLASS_LABELS[verdict] || 'Хороший ход'), win: Math.round(item.winAfter) })
    : t('{label} · шансы {delta}%', { label: t(MOVE_CLASS_LABELS[verdict] || 'Неточность'), delta: `${winDelta > 0 ? '+' : '−'}${Math.abs(winDelta)}` });
  return `<button type="button" class="move-card move-card-${kind}" data-fen="${escapeHtml(item.fenBefore)}" data-san="${escapeHtml(item.move.san)}">
    <span class="move-card-icon">${achievementIconSvg(kind === 'best' ? 'circle-check' : 'circle-x')}</span>
    <span class="move-card-text"><span>${title}</span><small>${escapeHtml(detail)}</small></span>
    <span class="move-card-san"><small>${moveNumberLabel(item)}</small>${escapeHtml(item.move.san)}</span>
  </button>`;
}

function renderAnalysis(stats, totalPly, comment, { refining = false } = {}) {
  lastMoveAnalysis = stats.moveAnalysis;
  const content = $id('analysisContent');
  const first = state.mode === 'friend' ? 'w' : state.playerColor;
  const second = first === 'w' ? 'b' : 'w';
  const side = { w: stats.white, b: stats.black };
  const A = side[first];
  const B = side[second];
  const triple = (s) => `<span class="ac-errors"><i class="is-inacc">${s.inaccuracies}</i><i class="is-mistake">${s.mistakes}</i><i class="is-blunder">${s.blunders}</i></span>`;

  let html = `<div class="analysis-compare">
    <div class="ac-row ac-head"><span>${Math.ceil(totalPly / 2)} ${plural(Math.ceil(totalPly / 2), 'ход', 'хода', 'ходов')}</span><b>${escapeHtml(sideTitle(first))}</b><b>${escapeHtml(sideTitle(second))}</b></div>
    <div class="ac-row"><span>${t('Точность')}</span><b>${A.accuracy.toFixed(0)}%</b><b>${B.accuracy.toFixed(0)}%</b></div>
    <div class="ac-row"><span>${t('Уровень игры')}</span><b>${eloCell(A)}</b><b>${eloCell(B)}</b></div>
    <div class="ac-row"><span title="${escapeHtml(t('Средняя потеря за ход, в сотых долях пешки (CPL)'))}">${t('Средняя потеря')}</span><b>${A.avgCpl.toFixed(0)}</b><b>${B.avgCpl.toFixed(0)}</b></div>
    <div class="ac-row"><span>${t('Неточности · ошибки · зевки')}</span><b>${triple(A)}</b><b>${triple(B)}</b></div>
  </div>`;

  if (stats.bestMoveObj || stats.worstMoveObj) {
    html += `<div class="move-cards">${stats.bestMoveObj ? moveCardHtml('best', stats.bestMoveObj) : ''}${stats.worstMoveObj ? moveCardHtml('worst', stats.worstMoveObj) : ''}</div>`;
  }

  html += `<p class="analysis-comment">${escapeHtml(comment)}</p>`;
  if (refining) {
    html += `<p class="analysis-disclaimer analysis-refining">${achievementIconSvg('hourglass')}${t('Быстрый предварительный результат — Stockfish продолжает углублять анализ в фоне, значения скоро уточнятся.')}</p>`;
  }
  html += `<p class="analysis-disclaimer">${t('Уровень — по средней потере за ход: ходы в уже решённой позиции весят меньше, дебютная теория и единственные ходы не считаются. Это грубая оценка этой партии; рейтинг аккаунта меняется по результату и силе соперника.')}</p>`;
  content.innerHTML = html;

  content.querySelectorAll('.move-card').forEach(card => {
    card.addEventListener('click', () => {
      const label = card.classList.contains('move-card-best') ? 'best'
        : card.classList.contains('move-card-worst') ? 'worst' : null;
      openMoveDetail(card.dataset.fen, card.dataset.san, label);
      if (label === 'best' && window.Achievements && !state.isReview) window.Achievements.trackBestMoveView();
    });
  });
}

$id('requestAnalysisBtn').addEventListener('click', requestAnalysis);
