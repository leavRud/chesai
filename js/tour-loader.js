// Загрузчик «обход конём»: конь обходит доску 5×5, каждая клетка — 4%.
'use strict';

/* =========================================================================
   ЗАГРУЗЧИК «ОБХОД КОНЁМ»
   Проценты частично настоящие, частично расчётные. Вызывающий код говорит,
   до скольких процентов дойти и за сколько примерно (plan), и отмечает
   настоящий прогресс (reach). Между отметками прогресс ползёт сам и к
   концу этапа замедляется, но верхнюю границу этапа не переходит — если
   работа затянулась, полоса идёт медленнее, а не застревает. finish()
   быстро досчитывает обход до 25-й клетки, даже если ответ пришёл раньше.

   Длительности в местах вызова подобраны по логам chat-proxy за 17.11.2026:
   объяснение хода (Gemini 3.7 Flash) — 4–9 с, обычно ~6,5 с; новый персонаж
   (Opus 5.5) — 12–29 с; персонаж из базы — доли секунды на сервере.
   ========================================================================= */

// Замкнутого обхода 5×5 не существует, этот начинается в углу и
// заканчивается в центре соседнего ряда. Число — номер хода.
const TOUR_BOARD = [
  [1, 14, 9, 20, 3],
  [24, 19, 2, 15, 10],
  [13, 8, 23, 4, 21],
  [18, 25, 6, 11, 16],
  [7, 12, 17, 22, 5],
];
const TOUR_PATH = (() => {
  const path = [];
  TOUR_BOARD.forEach((row, r) => row.forEach((n, c) => { path[n - 1] = [c, r]; }));
  return path;
})();
const TOUR_SQUARES = TOUR_PATH.length;
// Доля оставшегося пути, которую этап проходит за ожидаемое время (~85%)
const TOUR_PLAN_RATE = Math.log(1 / 0.15);

function tourLoaderMarkup(text, compact) {
  let cells = '';
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      cells += `<rect class="tour-cell${(r + c) % 2 ? ' is-dark' : ''}" data-cell="${r * 5 + c}" x="${c * 20}" y="${r * 20}" width="20" height="20"></rect>`;
    }
  }
  return `<div class="tour-loader${compact ? ' is-compact' : ''}" role="status" aria-live="polite">
    <div class="tour-loader-board">
      <svg viewBox="0 0 100 100" aria-hidden="true">${cells}<polyline class="tour-trail"></polyline></svg>
      <span class="tour-knight" aria-hidden="true">♞</span>
    </div>
    <div class="tour-loader-info">
      <span class="tour-loader-percent">0%</span>
      <span class="tour-loader-text">${escapeHtml(text)}</span>
    </div>
  </div>`;
}

function createTourLoader(host, { text = '', compact = false } = {}) {
  if (host._tourLoader) host._tourLoader.destroy();
  host.innerHTML = tourLoaderMarkup(text, compact);
  const root = host.firstElementChild;
  const cells = [...root.querySelectorAll('.tour-cell')];
  const trail = root.querySelector('.tour-trail');
  const knight = root.querySelector('.tour-knight');
  const percentEl = root.querySelector('.tour-loader-percent');
  const textEl = root.querySelector('.tour-loader-text');

  const s = {
    p: 0,          // показанный процент
    floor: 0,      // настоящий прогресс: ниже него не опускаемся
    cap: 0,        // граница текущего этапа
    rate: 0,       // скорость подползания к границе, 1/мс
    finish: null,  // { from, start, duration, resolve } во время досчёта
    shownSquare: -1,
    shownPercent: -1,
    last: performance.now(),
    raf: 0,
    alive: true,
  };

  function render() {
    const square = Math.min(TOUR_SQUARES - 1, Math.max(0, Math.ceil(s.p / (100 / TOUR_SQUARES)) - 1));
    if (square !== s.shownSquare) {
      s.shownSquare = square;
      const points = [];
      TOUR_PATH.forEach(([c, r], i) => {
        cells[r * 5 + c].classList.toggle('is-visited', i <= square);
        if (i <= square) points.push(`${c * 20 + 10},${r * 20 + 10}`);
      });
      trail.setAttribute('points', points.join(' '));
      const [c, r] = TOUR_PATH[square];
      knight.style.transform = `translate(${c * 100}%, ${r * 100}%)`;
    }
    const percent = Math.floor(s.p);
    if (percent !== s.shownPercent) {
      s.shownPercent = percent;
      percentEl.textContent = `${percent}%`;
    }
  }

  function frame(now) {
    if (!s.alive) return;
    const dt = Math.min(250, now - s.last);
    s.last = now;
    if (s.finish) {
      const f = s.finish;
      const k = Math.min(1, (now - f.start) / f.duration);
      s.p = f.from + (100 - f.from) * k;
      if (k >= 1) {
        render();
        s.finish = null;
        setTimeout(f.resolve, 220); // даём увидеть 100% и последний ход коня
        return;
      }
    } else {
      if (s.p < s.floor) s.p += (s.floor - s.p) * Math.min(1, dt / 140);
      if (s.p < s.cap) s.p += (s.cap - s.p) * (1 - Math.exp(-s.rate * dt));
    }
    render();
    s.raf = requestAnimationFrame(frame);
  }

  const api = {
    // Этап: дойти до `to`% примерно за expectedMs
    plan(to, expectedMs) {
      if (!s.alive || s.finish) return api;
      s.cap = Math.max(s.p, Math.min(99, to));
      s.rate = TOUR_PLAN_RATE / Math.max(200, expectedMs);
      return api;
    },
    // Настоящий прогресс: дошли до percent%
    reach(percent) {
      if (!s.alive || s.finish) return api;
      s.floor = Math.max(s.floor, Math.min(99, percent));
      s.cap = Math.max(s.cap, s.floor);
      return api;
    },
    setText(value) {
      if (s.alive && value != null) textEl.textContent = value;
      return api;
    },
    // Быстро досчитать до 100%: конь допрыгивает оставшиеся клетки
    finish(value) {
      if (value != null) api.setText(value);
      if (!s.alive) return Promise.resolve();
      if (s.finish) return new Promise(resolve => { const prev = s.finish.resolve; s.finish.resolve = () => { prev(); resolve(); }; });
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        s.p = 100;
        render();
        return Promise.resolve();
      }
      const left = 100 - s.p;
      const duration = Math.max(160, Math.min(650, left * 9));
      return new Promise(resolve => {
        // Во вкладке в фоне кадры анимации не идут — результат всё равно
        // показываем, досчёт просто не будет виден
        let done = false;
        const once = () => { if (!done) { done = true; resolve(); } };
        setTimeout(once, duration + 400);
        s.finish = { from: s.p, start: performance.now(), duration, resolve: once };
        cancelAnimationFrame(s.raf);
        s.last = performance.now();
        s.raf = requestAnimationFrame(frame);
      });
    },
    destroy() {
      if (!s.alive) return;
      s.alive = false;
      cancelAnimationFrame(s.raf);
      if (s.finish) { s.finish.resolve(); s.finish = null; }
      if (host._tourLoader === api) host._tourLoader = null;
    },
  };

  host._tourLoader = api;
  render();
  s.raf = requestAnimationFrame(frame);
  return api;
}
