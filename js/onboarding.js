// Подсказки для новых игроков: тур по главному экрану и по первой партии.
'use strict';

/* =========================================================================
   ПОДСКАЗКИ ДЛЯ НОВИЧКОВ
   Два тура. Главный экран — при первом заходе, после экрана загрузки.
   Экран партии — в начале первой партии, тексты зависят от режима.
   Каждый шаг подсвечивает элемент (вырез в затемнении) и показывает
   карточку рядом. Пока тур открыт, часы партии стоят (см. chargeClock
   в js/main.js). Пройденный тур запоминается в localStorage; тем, кто
   заходил до появления подсказок, их не показываем. Пункт меню
   «Подсказки» сбрасывает отметки и показывает тур заново.
   Третья подсказка — к первому в жизни достижению: что это и где их смотреть.
   ========================================================================= */
const TOUR_SEEN_KEYS = { home: 'chess_tourHome', game: 'chess_tourGame', achv: 'chess_tourAchv' };
// Эти ключи появляются только после игры или правки настроек — если хоть один есть,
// человек уже был здесь. Тему, акцент, вид доски и фон сайт пишет при первой же
// загрузке, по ним не отличить новичка.
const RETURNING_VISITOR_KEYS = [
  'chessLastColor', 'chessLastAiLevel', 'chessLastLevel', 'chessTimeControl',
  'chessTimeLimited', 'chess_achievements_v1',
];
const TOUR_START_DELAY_MS = 700;

let tourActive = null; // { steps, index, onDone, els }

function onboardingOpen() { return Boolean(tourActive); }

function tourSeen(name) {
  try { return localStorage.getItem(TOUR_SEEN_KEYS[name]) === '1'; } catch (e) { return true; }
}
function markTourSeen(name) {
  try { localStorage.setItem(TOUR_SEEN_KEYS[name], '1'); } catch (e) { /* без хранилища покажется снова */ }
}

// Те, кто заходил раньше, уже знают сайт: отмечаем оба тура пройденными.
// Решение принимается один раз, при самом первом заходе: новичку ставим '0'
// («ещё не видел»). Иначе он стал бы «старым», перезагрузив страницу до показа
// тура или поймав фигуру на фоне главного экрана (это пишет достижение).
(function skipToursForReturningVisitors() {
  try {
    if (localStorage.getItem(TOUR_SEEN_KEYS.home) !== null) return;
    const returning = RETURNING_VISITOR_KEYS.some(k => localStorage.getItem(k) !== null) ||
      Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (returning) { markTourSeen('home'); markTourSeen('game'); }
    else localStorage.setItem(TOUR_SEEN_KEYS.home, '0');
  } catch (e) { /* хранилище недоступно — tourSeen вернёт true, тур не покажется */ }
})();

function isNarrowLayout() { return window.matchMedia('(max-width: 980px)').matches; }
function tourReducedMotion() {
  return document.documentElement.classList.contains('lite') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function anyModalOpen() {
  return Boolean(document.querySelector('.modal-overlay:not(.hidden)')) ||
    Boolean($id('menuOverlay')?.classList.contains('open'));
}

/* ---- Шаги ----
   target — селектор или функция, возвращающая элемент; без target карточка по центру.
   text — абзац, list — строки «жирное — пояснение». */
function homeTourSteps() {
  return [
    {
      hero: true, // крупное окно с конём — первое, что видит новичок
      title: t('Добро пожаловать в chesai'),
      text: t('Шахматы с компьютером, с другом и с персонажами, которых играет нейросеть. Покажем за полминуты, что где.'),
      next: t('Показать'),
      skip: t('Не нужно'),
    },
    {
      target: '.home-mode-select',
      title: t('Выберите, с кем играть'),
      list: [
        [t('Против стокфиша'), t('шахматный движок, 12 уровней — от новичка до максимума.')],
        [t('Против друга'), t('по ссылке на любом устройстве или вдвоём за одним экраном.')],
        [t('Против персонажей'), t('придумайте кого угодно — нейросеть сыграет его характер и будет болтать в чате.')],
      ],
    },
    {
      target: '#homePlayText',
      title: t('Нажмите «Играть»'),
      text: t('Дальше выберете цвет и сложность — или создадите персонажа, или получите ссылку для друга.'),
      pad: 14,
    },
    {
      target: '#homeSettingsBtn',
      title: t('Меню'),
      text: t('Профиль и рейтинг Elo, мои партии, достижения и статистика. В настройках — тема, вид доски, часы и звук. Там же пункт «Подсказки», если захотите посмотреть их снова.'),
      round: true,
      next: t('Понятно'),
    },
  ];
}

function gameTourSteps() {
  const narrow = isNarrowLayout();
  const steps = [
    {
      target: '#board',
      title: state.mode === 'friend' ? t('Ходите по очереди') : t('Как ходить'),
      text: t('Перетащите фигуру на нужную клетку — или нажмите на фигуру, а потом на клетку.'),
      pad: 6,
    },
  ];
  if (clockEnabled()) {
    steps.push({
      target: '#playerBarBottom',
      title: t('Ваши часы'),
      text: t('Время идёт, пока ваш ход. Выключить часы или поменять время можно в настройках. Пока открыты подсказки, часы стоят.'),
    });
  }
  const chatTexts = {
    ai: t('Спросите нейросеть о позиции: почему ход плохой, какие угрозы, что делать дальше. Подсказки по ходу партии можно включить в настройках.'),
    characters: t('Персонаж разговаривает с вами в своём образе — ему можно писать. Но ходы он не подскажет: он ваш соперник.'),
    online: t('Пока идёт партия с человеком, нейросеть молчит. После партии спросите её о любом ходе.'),
    friend: t('Нейросеть ответит на вопросы о позиции, если спросить. Сама она не подсказывает.'),
  };
  steps.push({
    target: narrow ? '.mobile-tabs' : '.chat-card',
    title: state.mode === 'characters' ? t('Чат с соперником') : t('Чат с нейросетью'),
    text: (narrow ? t('Под доской — вкладки «Ходы» и «Чат с ИИ».') + ' ' : '') + (chatTexts[state.mode] || chatTexts.ai),
  });
  steps.push({
    target: '.controls-row',
    title: t('Ничья, сдача, новая игра'),
    text: t('Эти кнопки под доской. А когда партия закончится, нажмите «Разобрать партию» — движок покажет ошибки и лучшие ходы.'),
    next: t('Играть'),
  });
  return steps;
}

/* ---- Показ ---- */
function startTour(steps, onDone) {
  if (tourActive) return;
  const layer = document.createElement('div');
  layer.className = 'tour-layer';
  layer.innerHTML = '<div class="tour-spot" aria-hidden="true"></div>' +
    '<div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle" aria-describedby="tourBody">' +
    '<div class="tour-head"><span class="tour-count"></span><button type="button" class="tour-close" aria-label="' + escapeHtml(t('Закрыть подсказки')) + '">✕</button></div>' +
    '<img class="tour-hero hidden" alt="" width="512" height="341">' +
    '<div class="h2 tour-title" id="tourTitle"></div><div class="tour-body" id="tourBody"></div>' +
    '<div class="tour-actions"><button type="button" class="btn btn-ghost btn-sm tour-skip"></button>' +
    '<button type="button" class="btn btn-ghost btn-sm tour-back"></button>' +
    '<button type="button" class="btn btn-accent btn-sm tour-next"></button></div></div>';
  document.body.appendChild(layer);
  const els = {
    layer,
    spot: layer.querySelector('.tour-spot'),
    card: layer.querySelector('.tour-card'),
    count: layer.querySelector('.tour-count'),
    title: layer.querySelector('.tour-title'),
    hero: layer.querySelector('.tour-hero'),
    body: layer.querySelector('.tour-body'),
    skip: layer.querySelector('.tour-skip'),
    back: layer.querySelector('.tour-back'),
    next: layer.querySelector('.tour-next'),
  };
  if (tourReducedMotion()) layer.classList.add('no-motion');
  tourActive = { steps, index: 0, onDone, els, returnFocus: document.activeElement };

  els.next.addEventListener('click', () => { playSound('ui'); goToTourStep(tourActive.index + 1); });
  els.back.addEventListener('click', () => { playSound('ui'); goToTourStep(tourActive.index - 1); });
  // «Не нужно» на приветствии — отказ от подсказок вообще, тур партии тоже не покажем
  els.skip.addEventListener('click', () => {
    playSound('ui');
    const step = tourActive.steps[tourActive.index];
    if (step.alt) { endTour('done'); step.alt.run(); return; }
    endTour(step.target ? 'skipped' : 'declined');
  });
  layer.querySelector('.tour-close').addEventListener('click', () => endTour());
  document.addEventListener('keydown', onTourKey, true);
  window.addEventListener('resize', scheduleTourLayout);
  window.addEventListener('scroll', scheduleTourLayout, true);

  goToTourStep(0);
  requestAnimationFrame(() => layer.classList.add('is-visible'));
}

function goToTourStep(index) {
  const tour = tourActive;
  if (!tour) return;
  // Шаг, чей элемент сейчас не виден (например, чат свёрнут), пропускаем
  const dir = index >= tour.index ? 1 : -1;
  while (index >= 0 && index < tour.steps.length && tour.steps[index].target && !tourTarget(tour.steps[index])) index += dir;
  if (index >= tour.steps.length) { endTour(); return; }
  if (index < 0) return;
  tour.index = index;
  const step = tour.steps[index];
  const { els } = tour;
  const last = index === tour.steps.length - 1;

  // Крупное приветствие: конь в цвете акцента, как на главном экране
  els.card.classList.toggle('is-hero', Boolean(step.hero));
  els.hero.classList.toggle('hidden', !step.hero);
  if (step.hero && !els.hero.getAttribute('src')) {
    els.hero.addEventListener('load', scheduleTourLayout, { once: true });
    els.hero.src = window.__homeKnightSrc || 'assests/knight.webp';
  }
  els.title.textContent = step.title;
  els.body.replaceChildren();
  if (step.text) {
    const p = document.createElement('p');
    p.textContent = step.text;
    els.body.appendChild(p);
  }
  if (step.list) {
    const ul = document.createElement('ul');
    step.list.forEach(([bold, rest]) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = bold;
      li.append(b, ' — ' + rest);
      ul.appendChild(li);
    });
    els.body.appendChild(ul);
  }
  // Счётчик — без приветствия (шаг без элемента в начале)
  const counted = tour.steps.filter(s => s.target);
  const pos = counted.indexOf(step);
  els.count.textContent = pos >= 0 && counted.length > 1 ? `${pos + 1} / ${counted.length}` : '';
  els.next.textContent = step.next || (last ? t('Понятно') : t('Далее'));
  els.skip.textContent = step.skip || t('Пропустить');
  els.skip.classList.toggle('hidden', last);
  els.back.textContent = t('Назад');
  els.back.classList.toggle('hidden', index === 0 || !tour.steps[index - 1].target);
  // Назад и Пропустить одновременно — тесно: на шагах с «Назад» прячем «Пропустить», крестик остаётся
  if (!els.back.classList.contains('hidden')) els.skip.classList.add('hidden');
  // alt — вторая кнопка с действием вместо «Пропустить» (например, «Открыть достижения»)
  if (step.alt) {
    els.skip.textContent = step.alt.label;
    els.skip.classList.remove('hidden');
    els.back.classList.add('hidden');
  }

  const target = tourTarget(step);
  if (target) {
    const rect = target.getBoundingClientRect();
    const offscreen = rect.top < 0 || rect.bottom > window.innerHeight;
    if (offscreen) target.scrollIntoView({ block: 'center', behavior: tourReducedMotion() ? 'auto' : 'smooth' });
  }
  layoutTour();
  els.next.focus({ preventScroll: true });
}

function tourTarget(step) {
  if (!step.target) return null;
  const el = typeof step.target === 'function' ? step.target() : document.querySelector(step.target);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? el : null;
}

let tourLayoutFrame = null;
function scheduleTourLayout() {
  if (tourLayoutFrame) return;
  tourLayoutFrame = requestAnimationFrame(() => { tourLayoutFrame = null; layoutTour(); });
}

const TOUR_GAP = 14;      // между подсветкой и карточкой
const TOUR_EDGE = 16;     // отступ карточки от края экрана
function layoutTour() {
  const tour = tourActive;
  if (!tour) return;
  const step = tour.steps[tour.index];
  const { spot, card, layer } = tour.els;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const target = tourTarget(step);
  layer.classList.toggle('is-centered', !target);

  if (!target) {
    card.style.left = `${Math.max(TOUR_EDGE, (vw - card.offsetWidth) / 2)}px`;
    card.style.top = `${Math.max(TOUR_EDGE, (vh - card.offsetHeight) / 2)}px`;
    return;
  }

  const r = target.getBoundingClientRect();
  const pad = step.pad ?? 8;
  const box = { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
  spot.style.left = `${box.left}px`;
  spot.style.top = `${box.top}px`;
  spot.style.width = `${box.width}px`;
  spot.style.height = `${box.height}px`;
  spot.style.borderRadius = step.round ? '50%' : getComputedStyle(target).borderRadius === '0px' ? '12px' : `calc(${getComputedStyle(target).borderRadius} + ${pad}px)`;

  // Карточка под подсветкой, если влезает, иначе над ней, иначе сбоку,
  // иначе у нижнего края поверх элемента
  const ch = card.offsetHeight;
  const cw = card.offsetWidth;
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const clampLeft = (x) => Math.min(Math.max(TOUR_EDGE, x), vw - TOUR_EDGE - cw);
  const clampTop = (y) => Math.min(Math.max(TOUR_EDGE, y), vh - TOUR_EDGE - ch);
  const centeredLeft = clampLeft(box.left + box.width / 2 - cw / 2);
  const middleTop = clampTop(box.top + box.height / 2 - ch / 2);
  let left, top;
  if (bottom + TOUR_GAP + ch <= vh - TOUR_EDGE) { left = centeredLeft; top = bottom + TOUR_GAP; }
  else if (box.top - TOUR_GAP - ch >= TOUR_EDGE) { left = centeredLeft; top = box.top - TOUR_GAP - ch; }
  else if (right + TOUR_GAP + cw <= vw - TOUR_EDGE) { left = right + TOUR_GAP; top = middleTop; }
  else if (box.left - TOUR_GAP - cw >= TOUR_EDGE) { left = box.left - TOUR_GAP - cw; top = middleTop; }
  else { left = centeredLeft; top = vh - TOUR_EDGE - ch; }
  card.style.left = `${left}px`;
  card.style.top = `${Math.max(TOUR_EDGE, top)}px`;
}

function onTourKey(e) {
  if (!tourActive) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    endTour();
    return;
  }
  // Фокус не уходит из карточки на страницу под затемнением
  if (e.key === 'Tab') {
    const focusable = [...tourActive.els.card.querySelectorAll('button:not(.hidden)')];
    const i = focusable.indexOf(document.activeElement);
    e.preventDefault();
    const nextIndex = i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
    focusable[nextIndex].focus();
  }
}

function endTour(reason = 'done') {
  const tour = tourActive;
  if (!tour) return;
  tourActive = null;
  document.removeEventListener('keydown', onTourKey, true);
  window.removeEventListener('resize', scheduleTourLayout);
  window.removeEventListener('scroll', scheduleTourLayout, true);
  const { layer } = tour.els;
  layer.classList.remove('is-visible');
  setTimeout(() => layer.remove(), tourReducedMotion() ? 0 : 250);
  if (tour.returnFocus && document.contains(tour.returnFocus)) tour.returnFocus.focus({ preventScroll: true });
  if (tour.onDone) tour.onDone(reason);
}

function onHomeTourDone(reason) {
  markTourSeen('home');
  if (reason === 'declined') markTourSeen('game');
}

/* ---- Когда показывать ---- */
function homeScreenVisible() { return !$id('homeScreen').classList.contains('hidden'); }

// Зовётся, когда спрятан экран загрузки и при каждом возврате на главный экран
function scheduleHomeTour() {
  if (tourSeen('home') || tourActive) return;
  // Пришли по ссылке на партию или персонажа — сначала дело, тур покажем в другой раз
  const params = new URLSearchParams(location.search);
  if (params.has('g') || params.has('c')) return;
  setTimeout(() => {
    if (tourSeen('home') || tourActive || !homeScreenVisible() || anyModalOpen()) return;
    if (typeof loadingScreenHidden !== 'undefined' && !loadingScreenHidden) return;
    startTour(homeTourSteps(), onHomeTourDone);
  }, TOUR_START_DELAY_MS);
}

// Зовётся в конце initGame()
function scheduleGameTour() {
  if (tourSeen('game') || tourActive || state.isReview) return;
  setTimeout(() => {
    if (tourSeen('game') || tourActive || homeScreenVisible() || anyModalOpen() || !state.game || state.isGameOver) return;
    startTour(gameTourSteps(), () => markTourSeen('game'));
  }, TOUR_START_DELAY_MS);
}

// Пункт меню «Подсказки»: показать тур того экрана, где сейчас игрок
function replayOnboarding() {
  try { [TOUR_SEEN_KEYS.home, TOUR_SEEN_KEYS.game].forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
  closeSidePanel();
  setTimeout(() => {
    if (homeScreenVisible()) startTour(homeTourSteps(), onHomeTourDone);
    else if (state.game && !state.isReview) startTour(gameTourSteps(), () => markTourSeen('game'));
  }, 350); // панель меню успевает уехать
}

/* ---- Первое достижение ----
   Самое первое достижение («Первые шаги») открывается в начале первой партии —
   одновременно с туром партии. Поэтому подсказку не показываем сразу, а ждём
   спокойного момента: нет тура, открытых окон и экрана загрузки. Считаем по
   числу полученных достижений, а не по отметке: тем, кто играл до появления
   подсказок, она не покажется. */
const ACHV_HINT_RETRY_MS = 1500;
let pendingFirstAchievement = null;
let achvHintTimer = null;

window.addEventListener('achievement-unlocked', (e) => {
  // Уже ждёт показа (в партии с персонажем «Первые шаги» и «Первый персонаж» приходят разом)
  if (tourSeen('achv') || pendingFirstAchievement) return;
  // Событие приходит сразу после записи достижения — первое, если оно одно
  const summary = window.Achievements?.getSummary?.();
  if (!summary || summary.unlocked !== 1) { markTourSeen('achv'); return; }
  pendingFirstAchievement = e.detail;
  queueAchievementHint(900); // тост «Новое достижение» успевает выехать
});

function queueAchievementHint(delay = ACHV_HINT_RETRY_MS) {
  clearTimeout(achvHintTimer);
  achvHintTimer = setTimeout(showAchievementHintWhenCalm, delay);
}

function showAchievementHintWhenCalm() {
  if (!pendingFirstAchievement || tourSeen('achv')) return;
  const loading = typeof loadingScreenHidden !== 'undefined' && !loadingScreenHidden;
  if (tourActive || anyModalOpen() || loading) { queueAchievementHint(); return; }
  const menuBtn = homeScreenVisible() ? '#homeSettingsBtn' : '#appSettingsBtn';
  const def = pendingFirstAchievement;
  pendingFirstAchievement = null;
  const reward = t('За него — {n} {questions} нейросети.', {
    n: def.reward,
    questions: plural(def.reward, 'бонусный вопрос', 'бонусных вопроса', 'бонусных вопросов'),
  });
  const account = chatSignedIn
    ? t('Награда уже на вашем счету.')
    : t('Войдите в аккаунт, и награда зачислится: достижения из этого браузера перейдут в него.');
  startTour([{
    target: menuBtn,
    round: true,
    title: t('Первое достижение: «{name}»', { name: def.name }),
    text: `${reward} ${account} ${t('Все достижения и сколько осталось до следующих — в меню, раздел «Достижения».')}`,
    next: t('Понятно'),
    alt: {
      label: t('Открыть'),
      run: () => { openSidePanel(); navigateTo('achievements'); },
    },
  }], () => markTourSeen('achv'));
}
