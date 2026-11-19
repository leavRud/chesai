// Режим «Против персонажей»: создание персонажа и его карточка.
'use strict';

/* =========================================================================
   РЕЖИМ «ПРОТИВ ПЕРСОНАЖЕЙ» — состояние
   ========================================================================= */
const charState = {
  activeTab: 'name',
  lastInput: null, // { type: 'name'|'desc', value: string }
};

// keepTab — остаться на той вкладке, с которой ушли (возврат с карточки персонажа)
// Гость тоже открывает это окно: придумывает персонажа или выбирает готового.
// Войти просим в последний момент — на «Создать персонажа» (тут нужна нейросеть)
// или на «Играть» в карточке; после входа всё продолжается само (js/share.js).
function openCharacterSetup({ keepTab = false } = {}) {
  hideModal('characterCardModal');
  $id('charSetupError').classList.add('hidden');
  renderPresetCharacters();
  // Как раньше: открывается вкладка «Имя персонажа»
  setCharTab(keepTab ? charState.activeTab : 'name');
  showModal('characterSetupModal');
  $id('characterSetupModal').querySelector('.modal').scrollTop = 0;

  // Заполняем примеры из статистики
  const examplesContainer = document.getElementById('charExamples');
  if (!examplesContainer) return;
  const stats = window.Achievements?.getStats?.();
  const played = stats?.charactersPlayed || [];
  const recent = Array.from(new Set(played)).slice(-4).reverse();
  if (recent.length === 0) {
    examplesContainer.innerHTML = '';
    examplesContainer.style.display = 'none';
  } else {
    examplesContainer.style.display = 'flex';
    examplesContainer.innerHTML = recent.map(name =>
      `<button type="button" class="char-example-chip" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`
    ).join('');
    // Перепривязываем обработчики кликов (если нужны)
    examplesContainer.querySelectorAll('.char-example-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.getElementById('charNameInput').value = chip.dataset.name;
      });
    });
  }
}

/* ---- Готовые персонажи: для тех, кому не хочется придумывать своего ----
   Профиль уже собран, нейросеть для создания не нужна — карточка открывается сразу.
   Идут по возрастанию силы. */
const PRESET_CHARACTERS = [
  {
    id: 'checkers-granny', icon: 'checker', elo: 400,
    white: 'w-italian', defenses: ['scandinavian', 'chigorin'],
    aggression: 20, combination: 10, sacrifice: 15, caution: 40, emotionality: 60, endgame: 10, drawishness: 40,
    ru: {
      name: 'Бабушка Валя',
      shortDescription: 'Уверена, что вы играете в шашки, и каждый раз удивляется, когда вы бьёте не через клетку.',
      style: 'Двигает фигуры как шашки и всё ждёт, когда ей дадут дамку. Если что-то и выигрывает — то по чистой случайности.',
      tone: 'Добрая и рассеянная, путает правила, называет фигуры «шашечками» и угощает.',
      persona: 'Всю жизнь играла в шашки с соседом по даче. Любит варенье, сериалы и внуков, не понимает, зачем коню такая странная походка. Словечки: «а дамку когда?», «внучок», «съешь блинчик».',
    },
    en: {
      name: 'Granny Valya',
      shortDescription: 'Sure you are playing checkers, and surprised every time you capture without jumping.',
      style: 'Moves the pieces like checkers and keeps waiting to be crowned. If she wins anything, it is by pure chance.',
      tone: 'Kind and absent-minded, mixes up the rules, calls the pieces "checkers" and offers treats.',
      persona: 'Has played checkers with her country-house neighbour all her life. Loves jam, TV series and her grandchildren; can\'t see why the knight walks so strangely. Catchphrases: "when do I get a king?", "sweetie", "have a pancake".',
    },
  },
  {
    id: 'dummies-book', icon: 'book-2', elo: 650,
    white: 'w-italian', defenses: ['open-e5', 'qgd'],
    aggression: 30, combination: 15, sacrifice: 10, caution: 50, emotionality: 60, endgame: 10, drawishness: 30,
    shift: {
      elo: 1250, aggression: 45, combination: 60, sacrifice: 20, caution: 55, endgame: 45,
      trigger: { type: 'move', move: 18 },
    },
    ru: {
      name: 'Гоша самоучка',
      shortDescription: 'Читает «Шахматы для чайников» прямо во время партии. Сейчас на 12-й странице — может, к концу и дочитает.',
      style: 'Сначала ходит строго по картинкам из книги и путается. Ближе к концу партии добирается до глав про тактику и эндшпиль и заметно умнеет.',
      tone: 'Восторженный новичок, вслух цитирует книгу и радуется каждому понятому правилу.',
      persona: 'Студент, купил самоучитель на распродаже, чтобы обыграть соседа по общежитию. Любит лапшу быстрого приготовления, закладки и умные слова, не любит, когда торопят. Словечки: «так, страница…», «в книге написано», «а, понял!».',
      startNote: 'ты читаешь самоучитель, сейчас на 12-й странице, и играешь как новичок, сверяясь с картинками.',
      shiftNote: 'ты дочитал главы про тактику и эндшпиль, играешь заметно увереннее и гордо цитируешь книгу.',
    },
    en: {
      name: 'Gosha and His Handbook',
      shortDescription: 'Reads "Chess for Dummies" during the game. He is on page 12 — maybe he\'ll finish it by the end.',
      style: 'At first plays strictly by the pictures in the book and gets confused. Later in the game he reaches the chapters on tactics and endgames and gets noticeably smarter.',
      tone: 'An enthusiastic beginner who quotes the book aloud and is delighted by every rule he understands.',
      persona: 'A student who bought the handbook on sale to beat his dorm neighbour. Loves instant noodles, bookmarks and clever words; hates being rushed. Catchphrases: "okay, page…", "the book says", "oh, got it!".',
      startNote: 'you are reading the handbook, now on page 12, and play like a beginner, checking the pictures.',
      shiftNote: 'you have finished the chapters on tactics and endgames, play much more confidently and proudly quote the book.',
    },
  },
  {
    id: 'colonel', icon: 'medal', elo: 1400,
    white: 'w-scotch', defenses: ['sicilian', 'kid'],
    aggression: 85, combination: 50, sacrifice: 40, caution: 35, emotionality: 90, endgame: 40, drawishness: 5,
    shift: {
      elo: 1000, aggression: 100, combination: 25, sacrifice: 70, caution: 5, endgame: 25,
      trigger: { type: 'queen_lost' },
    },
    ru: {
      name: 'Полковник Громов',
      shortDescription: 'Отставной полковник: ферзя зовёт «генералом», а на пешки орёт, как на новобранцев.',
      style: 'Ведёт фигуры в атаку строем и по уставу. Если потеряет «генерала», впадает в ярость и бросает войска на убой без всякого расчёта.',
      tone: 'Командный голос, армейские словечки и приказы; ворчит, но уважает достойного противника.',
      persona: 'Тридцать лет в строю, теперь командует только шахматными фигурами и рассадой на даче. Любит порядок, марши и крепкий чай, терпеть не может расхлябанность и отступление. Словечки: «отставить!», «рядовой», «пешки, шагом марш!».',
      startNote: 'ты командуешь фигурами уверенно, как на учениях.',
      shiftNote: 'ты потерял «генерала» — своего ферзя, впал в ярость и бросаешь войска в атаку без всякого расчёта.',
    },
    en: {
      name: 'Colonel Gromov',
      shortDescription: 'A retired colonel who calls his queen "the general" and yells at his pawns like recruits.',
      style: 'Marches his pieces into attack in formation and by the book. If he loses "the general", he flies into a rage and throws his troops forward without any calculation.',
      tone: 'A commanding voice, army slang and orders; grumbles but respects a worthy opponent.',
      persona: 'Thirty years in the ranks, now he only commands chess pieces and seedlings at his dacha. Loves order, marches and strong tea; can\'t stand sloppiness or retreat. Catchphrases: "as you were!", "private", "pawns, forward march!".',
      startNote: 'you command your pieces confidently, as if on drill.',
      shiftNote: 'you have lost "the general" — your queen — flown into a rage and throw your troops into attack without any calculation.',
    },
  },
  {
    id: 'computer-87', icon: 'cpu', elo: 1600,
    white: 'w-queens-gambit', defenses: ['open-e5', 'qgd'],
    aggression: 40, combination: 80, sacrifice: 10, caution: 80, emotionality: 5, endgame: 60, drawishness: 40,
    shift: {
      elo: 500, aggression: 55, combination: 15, sacrifice: 40, caution: 10, endgame: 10,
      trigger: { type: 'move', move: 20 },
    },
    ru: {
      name: 'Компьютер «Рк87»',
      shortDescription: 'Шахматный компьютер 1987 года. После 20-го хода перегревается и начинает ходить наугад.',
      style: 'Пока не нагрелся, считает варианты как сильный разрядник и играет строго по теории. После 20-го хода схемы плавятся, и ходы становятся случайными.',
      tone: 'Короткие машинные фразы капслоком; когда перегревается — сбои, обрывки слов и «ОШИБКА».',
      persona: 'Пластиковый корпус, восемь светодиодов и вентилятор, который давно сломан. Любит прохладу, батарейки и правильные дебюты, боится жары и долгих партий. Словечки: «БИП», «РАСЧЁТ ЗАВЕРШЁН», «ТЕМПЕРАТУРА В НОРМЕ».',
      startNote: 'ты исправен, считаешь варианты как сильный разрядник и играешь строго по теории.',
      shiftNote: 'корпус перегрелся, схемы плавятся, ты ходишь почти наугад и сыплешь сбоями.',
    },
    en: {
      name: 'Rk87 Computer',
      shortDescription: 'A chess computer from 1987. After move 20 it overheats and starts moving at random.',
      style: 'While it is cool it calculates like a strong club player and plays by the book. After move 20 its circuits melt and its moves become random.',
      tone: 'Short machine phrases in capitals; when overheating, glitches, broken words and "ERROR".',
      persona: 'A plastic case, eight LEDs and a fan that broke long ago. Loves cool air, batteries and proper openings; fears heat and long games. Catchphrases: "BEEP", "CALCULATION COMPLETE", "TEMPERATURE NORMAL".',
      startNote: 'you are working fine, calculate like a strong club player and play by the book.',
      shiftNote: 'your case has overheated, your circuits are melting, you move almost at random and keep glitching.',
    },
  },
  {
    id: 'cheater', icon: 'headphones', elo: 2400,
    white: 'w-ruy', defenses: ['sicilian-dragon', 'grunfeld'],
    aggression: 60, combination: 95, sacrifice: 40, caution: 70, emotionality: 30, endgame: 90, drawishness: 10,
    shift: {
      elo: 900, aggression: 45, combination: 20, sacrifice: 15, caution: 20, endgame: 15,
      trigger: { type: 'cycle', every: 3 },
    },
    ru: {
      name: 'Подозрительный Валера',
      shortDescription: 'Подключил шахматный движок, но сигнал отстаёт на 3 хода: три хода играет как гроссмейстер, три — как ребёнок.',
      style: 'Пока подсказки доходят, играет безупречно и по теории. Когда сигнал пропадает, ходит сам — и сразу видно, что сам он почти не умеет.',
      tone: 'Нарочито спокойный, отвечает уклончиво, всё время отвлекается на «важное сообщение».',
      persona: 'Уверяет, что просто много тренируется, а наушник — для музыки. Любит энергетики, свой телефон и слово «интуиция», не любит вопросы про наушник. Словечки: «это всё интуиция», «секунду, мама пишет», «я так и задумывал».',
      startNote: 'подсказки из наушника доходят, ты играешь как гроссмейстер и делаешь вид, что всё сам.',
      shiftNote: 'сигнал пропал, подсказки опаздывают, ты играешь сам, путаешься и нервно поглядываешь в телефон.',
    },
    en: {
      name: 'Suspicious Val',
      shortDescription: 'Hooked up a chess engine, but the signal lags 3 moves: three moves like a grandmaster, three like a child.',
      style: 'While the hints arrive he plays flawlessly and by the book. When the signal drops he plays on his own — and it is obvious he can barely play.',
      tone: 'Deliberately calm, answers evasively, keeps getting distracted by an "important message".',
      persona: 'Insists he just trains a lot and the earbud is for music. Loves energy drinks, his phone and the word "intuition"; dislikes questions about the earbud. Catchphrases: "pure intuition", "one sec, my mum is texting", "that was the plan all along".',
      startNote: 'the hints from your earbud are getting through, you play like a grandmaster and pretend it is all you.',
      shiftNote: 'the signal is gone, the hints are late, you play on your own, get confused and glance nervously at your phone.',
    },
  },
];

function presetCharacterProfile(preset) {
  const text = preset[uiLang] || preset.ru;
  const shift = preset.shift && { ...preset.shift, startNote: text.startNote, shiftNote: text.shiftNote };
  return normalizeCharacterProfile({ ...preset, ...text, shift }, { type: 'name', value: text.name });
}

// «Новичок ≈650 Elo» или, если сила меняется, «≈650 → 1250 Elo»
function presetEloHtml(preset) {
  const level = escapeHtml(capitalize(eloDifficultyLabel(preset.elo)));
  const elo = preset.shift ? `≈${preset.elo} → ${preset.shift.elo} Elo` : `≈${preset.elo} Elo`;
  return `<span>${level}</span> <span>${elo}</span>`;
}

function renderPresetCharacters() {
  const box = $id('charPresets');
  if (!box || box.childElementCount) return;
  box.innerHTML = PRESET_CHARACTERS.map(preset => {
    const text = preset[uiLang] || preset.ru;
    return `<button type="button" class="char-preset-card" data-preset="${preset.id}">
      <span class="char-preset-icon" aria-hidden="true">${achievementIconSvg(preset.icon)}</span>
      <span class="char-preset-name">${escapeHtml(text.name)}</span>
      <span class="char-preset-desc">${escapeHtml(text.shortDescription)}</span>
      <span class="char-preset-elo">${presetEloHtml(preset)}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('.char-preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const preset = PRESET_CHARACTERS.find(p => p.id === card.dataset.preset);
      if (!preset) return;
      playSound('ui');
      const profile = presetCharacterProfile(preset);
      state.character = profile;
      charState.lastInput = null; // перегенерировать готового персонажа незачем
      charState.fromLink = false;
      hideModal('characterSetupModal');
      $id('charCardError').classList.add('hidden');
      renderCharacterCard(profile);
      setCharCardLoading(false);
      showModal('characterCardModal');
      trackGoal('character_preset', { id: preset.id });
    });
  });
}

/* ---- Вкладки: имя / свой персонаж (на ней же готовые персонажи) ---- */
function setCharTab(target) {
  charState.activeTab = target;
  document.querySelectorAll('.char-tab').forEach(t => {
    const active = t.dataset.tab === target;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', String(active));
  });
  $id('charNameTab').classList.toggle('hidden', target !== 'name');
  $id('charDescTab').classList.toggle('hidden', target !== 'desc');
}

document.querySelectorAll('.char-tab').forEach(tab => {
  tab.addEventListener('click', () => setCharTab(tab.dataset.tab));
});

document.querySelectorAll('.char-example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $id('charNameInput').value = chip.dataset.name;
  });
});

$id('charSetupBackBtn').addEventListener('click', () => {
  hideModal('characterSetupModal');
  showHomeScreen();
});

$id('charCreateBtn').addEventListener('click', () => {
  playSound('ui');
  const errEl = $id('charSetupError');
  errEl.classList.add('hidden');
  let input;
  if (charState.activeTab === 'name') {
    const value = $id('charNameInput').value.trim();
    if (!value) {
      errEl.textContent = t('Введите имя персонажа.');
      errEl.classList.remove('hidden');
      playSound('error');
      return;
    }
    input = { type: 'name', value };
  } else {
    const value = $id('charDescInput').value.trim();
    if (!value) {
      errEl.textContent = t('Опишите вашего персонажа.');
      errEl.classList.remove('hidden');
      playSound('error');
      return;
    }
    input = { type: 'desc', value };
  }
  // Создаёт персонажа нейросеть — гостя просим войти, после входа создание продолжится
  if (!chatSignedIn) {
    rememberPendingCharacterCreate(input);
    openAuthModal(input.type === 'name'
      ? t('Войдите, и нейросеть создаст персонажа «{name}»', { name: input.value })
      : t('Войдите, и нейросеть создаст вашего персонажа'));
    return;
  }
  charState.lastInput = input;
  charState.fromLink = false;
  hideModal('characterSetupModal');
  trackGoal('character_create', { by: input.type });
  runCharacterGeneration(input);
});

/* ---- Карточка персонажа ---- */
$id('charCardBackBtn').addEventListener('click', () => {
  hideModal('characterCardModal');
  // Персонаж пришёл по ссылке — «Назад» ведёт на главный экран, а не к созданию своего
  if (charState.fromLink) { charState.fromLink = false; showHomeScreen(); return; }
  // Вернулись с карточки своего персонажа — форма создания остаётся раскрытой
  openCharacterSetup({ keepTab: true });
});
$id('charCardRegenBtn').addEventListener('click', () => {
  if (!charState.lastInput) return;
  runCharacterGeneration(charState.lastInput, { fresh: true });
});
/* ---- Цвет игрока против персонажа: белые, чёрные или случайно ----
   Выбор запоминается; «Случайно» бросает жребий при каждом старте. */
const CHAR_COLOR_KEY = 'chessLastCharColor';
let charChosenColor = 'w';
function syncCharColorButtons() {
  document.querySelectorAll('#charColorRow .color-choice-btn').forEach(b => {
    const active = b.dataset.color === charChosenColor;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}
try {
  const saved = localStorage.getItem(CHAR_COLOR_KEY);
  if (['w', 'b', 'r'].includes(saved)) charChosenColor = saved;
} catch (e) { /* хранилище недоступно — по умолчанию белые */ }
syncCharColorButtons();
document.querySelectorAll('#charColorRow .color-choice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    playSound('ui');
    charChosenColor = btn.dataset.color;
    try { localStorage.setItem(CHAR_COLOR_KEY, charChosenColor); } catch (e) { /* не запоминаем */ }
    syncCharColorButtons();
  });
});

$id('charCardPlayBtn').addEventListener('click', () => {
  if (!state.character) return;
  // Гость выбрал или открыл по ссылке персонажа: играть можно после входа, затем партия начнётся сама
  if (!chatSignedIn) {
    rememberPendingSharedCharacter();
    trackGoal('character_play_login');
    openAuthModal(t('Войдите, чтобы сыграть с персонажем «{name}»: им управляет нейросеть', { name: state.character.name }));
    return;
  }
  if (charState.fromLink && state.character.shareId) countSharedCharacterPlay(state.character.shareId);
  charState.fromLink = false;
  hideModal('characterCardModal');
  state.mode = 'characters';
  const color = charChosenColor === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : charChosenColor;
  state.playerColor = color;
  state.aiColor = color === 'w' ? 'b' : 'w';
  state.skillLevel = eloToSkillLevel(state.character.elo);
  if (stockfish && isEngineReady) {
    stockfish.postMessage(`setoption name Skill Level value ${state.skillLevel}`);
  }
  hideHomeScreen();
  initGame();
});

function setCharCardLoading(isLoading) {
  const box = $id('characterCardLoading');
  if (!isLoading && box._tourLoader) box._tourLoader.destroy();
  box.classList.toggle('hidden', !isLoading);
  $id('characterCardBody').classList.toggle('hidden', isLoading);
  $id('charCardPlayBtn').disabled = isLoading;
  $id('charCardRegenBtn').disabled = isLoading;
}

// Сколько ждать персонажа (логи chat-proxy, 17.11.2026): новый через Opus
// 5.5 — 12–29 с, обычно ~16 с; по имени из базы — 2–3 с вместе с сетью.
// Заранее не знаем, есть ли имя в базе, поэтому первые 2,5 с прогресс
// идёт как для базы (до ~60%), потом — спокойно, как для новой генерации.
const CHAR_GEN_EXPECTED_MS = 17000;
const CHAR_CACHE_EXPECTED_MS = 2500;
let charGenToken = 0;

async function runCharacterGeneration(input, { fresh = false } = {}) {
  const token = ++charGenToken;
  showModal('characterCardModal');
  $id('charCardError').classList.add('hidden');
  setCharCardLoading(true);
  const loader = createTourLoader($id('characterCardLoading'), { text: t('Нейросеть создаёт персонажа…') });
  let slowTimer = 0;
  if (input.type === 'name' && !fresh) {
    loader.plan(68, CHAR_CACHE_EXPECTED_MS);
    slowTimer = setTimeout(() => loader.plan(96, CHAR_GEN_EXPECTED_MS - CHAR_CACHE_EXPECTED_MS), CHAR_CACHE_EXPECTED_MS);
  } else {
    loader.plan(96, CHAR_GEN_EXPECTED_MS);
  }
  try {
    const profile = await generateCharacterProfile(input, { fresh });
    clearTimeout(slowTimer);
    await loader.finish();
    if (token !== charGenToken) return;
    state.character = profile;
    renderCharacterCard(profile);
    setCharCardLoading(false);
  } catch (error) {
    clearTimeout(slowTimer);
    if (token !== charGenToken) return;
    console.error('Ошибка генерации персонажа:', error);
    setCharCardLoading(false);
    $id('characterCardBody').classList.add('hidden');
    const errEl = $id('charCardError');
    // Дневные пределы — понятным текстом: «Перегенерировать» тут не поможет
    const limitCodes = ['CHARACTER_LIMIT_REACHED', 'SITE_LIMIT_REACHED', 'GAME_LIMIT_REACHED'];
    errEl.textContent = limitCodes.includes(error.code)
      ? chatErrorMessage(error)
      : t('Не удалось создать персонажа: {error}. Нажмите «Перегенерировать», чтобы попробовать снова.', { error: error.message });
    errEl.classList.remove('hidden');
    playSound('error');
  }
}

/* ---- Генерация профиля персонажа ---- */
function buildCharacterGenSystemPrompt() {
  return `Ты создаёшь игровой профиль шахматного персонажа для приложения. Не преувеличивай умения. 
  Отвечай ТОЛЬКО валидным JSON-объектом без markdown-разметки, без пояснений, без \`\`\`.
  {
  "name": "имя персонажа",
  "shortDescription": "одно короткое предложение о персонаже",
  "style": "1-2 предложения о стиле игры в шахматы",
  "white": "id системы за белых",
  "defenses": ["id защиты против 1.e4", "id защиты против 1.d4"],
  "aggression": число 0-100,
  "combination": число 0-100,
  "sacrifice": число 0-100,
  "caution": число 0-100,
  "emotionality": число 0-100,
  "endgame": число 0-100,
  "drawishness": число 0-100,
  "eloReason": "одна короткая фраза: насколько этот персонаж реально умеет играть в шахматы и почему",
  "elo": число от 400 до 2850,
  "tone": "манера общения персонажа, коротко",
  "persona": "кто он вне шахмат: чем живёт, что любит и не любит, о чём охотно болтает, пара характерных словечек — 2-3 предложения",
  "shift": null
  }
  Поле "shift" — только для персонажа, чья сила прямо по описанию меняется во время партии (перегревается, устаёт, пьянеет, дочитывает учебник, звереет от потерь, подглядывает в подсказки). Всем остальным — null; не придумывай смену сам.
  Если сила меняется, "shift" — второе состояние персонажа, а поля выше — его состояние в начале партии:
  {"elo": число 400–2850 (отличается от начального хотя бы на 300), "aggression", "combination", "sacrifice", "caution", "endgame": числа 0-100 во втором состоянии,
   "trigger": одно из {"type":"move","move":номер своего хода 5–40} — после этого хода, {"type":"queen_lost"} — когда потерял ферзя, {"type":"material_down","points":на сколько очков отстал 2–10}, {"type":"cycle","every":через сколько своих ходов 2–6} — меняется туда и обратно,
   "startNote": "каков он в начале, от второго лица: «ты исправен и считаешь варианты»",
   "shiftNote": "каким становится, от второго лица: «ты перегрелся и ходишь наугад»"}
  Когда и почему сила меняется, обязательно опиши в "shortDescription" или "style" — игрок узнаёт об этом из карточки.
  Все текстовые поля — ${AI_LANGUAGE}. Придумай образ ярко и с характером. 
  Если дано известное имя, опирайся на известные о нём черты и адаптируй их под шахматный стиль и манеру речи.
  Имя и коронные фразы персонажа пиши так, как они звучат в официальном переводе или дубляже на этот язык (Джек Воробей и его «смекаешь?», а не «савви»), без иностранных слов, записанных русскими буквами.
  Если дано произвольное описание — придумай персонажа с нуля строго по этому описанию, включая подходящее имя.
  Числовые черты должны логично соответствовать описанию.

  Рейтинг elo — это реальная сила игры в шахматы, а не известность, ум, богатство или крутость персонажа. Нейросети обычно его завышают — будь строг:
  - 400–700: не играет в шахматы, знает только как ходят фигуры; дети, животные, простоватые и легкомысленные персонажи;
  - 700–1100: иногда играет с друзьями ради развлечения — так играет большинство обычных людей, в том числе знаменитостей;
  - 1100–1500: регулярно играет, знает базовые дебюты и тактику;
  - 1500–1900: сильный любитель, разряд, играет в турнирах;
  - 1900–2300: кандидат в мастера и мастер;
  - 2300–2850: профессиональные шахматисты, гроссмейстеры.
  Если это реальный шахматист — бери его настоящий рейтинг. Если о шахматах персонажа ничего не известно, рейтинг зависит от того, какой у него ум:
  - обычный человек — 600–1100;
  - выдающийся ум в далёкой от игр области (учёный, врач, изобретатель) — 1000–1300: считает лучше большинства, но шахматного опыта нет;
  - прямо известный гений стратегии, тактики, интриг или многоходовых планов, который в сюжете переигрывает противников (Лайт Ягами, L, Шикамару, Тирион Ланнистер), или сильный игрок в сёги, го и другие стратегические игры — 1400–1800: видит ловушки и считает на несколько ходов, но дебютной теории и шахматной техники ему не хватает.
  Выше 1800 — только если игра в шахматы прямо известна о персонаже или указана в описании.
  Учитывай и экранизации, сериалы, игры: если там персонаж играет в шахматы на высоком уровне (Шерлок Холмс против Мориарти, Спок, Бет Хармон), это и есть его сила — ставь 1900–2500 по тому, как сильно он играет.

  Дебютный репертуар выбери под характер, только id из списков ниже (атакующим — острые гамбиты и дракон, осторожным — солидные системы, новичкам — простые):
  "white" — система за белых: ${openingIdsFor('w')};
  "defenses" — ровно две защиты за чёрных, одна против 1.e4: ${openingIdsFor('b', 'e4')};
  и одна против 1.d4: ${openingIdsFor('b', 'd4')}.`;
}

function openingIdsFor(side, against) {
  return Object.entries(OPENING_BOOK)
    .filter(([, opening]) => opening.side === side && (!against || opening.against === against))
    .map(([id, opening]) => `${id} (${opening.name.ru})`)
    .join(', ');
}

function extractJson(text) {
  const cleaned = String(text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return cleaned;
  return cleaned.slice(start, end + 1);
}

function normalizeCharacterProfile(p, input) {
  const clampNum = (v, min, max, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? clamp(n, min, max) : def;
  };
  const fallbackName = input.type === 'name' ? input.value : t('Загадочный соперник');
  const name = String(p.name || fallbackName).trim().slice(0, 40) || fallbackName;
  // Карточка показывает ровно те дебюты, которые персонаж разыгрывает по книге
  const ids = [p.white, ...(Array.isArray(p.defenses) ? p.defenses : [])];
  const repertoire = resolveCharacterRepertoire(ids, p.openings);
  const profile = {
    repertoire,
    name,
    shortDescription: String(p.shortDescription || '').trim().slice(0, 180) || t('Загадочный противник со своим стилем игры.'),
    style: String(p.style || '').trim().slice(0, 320) || t('Играет непредсказуемо, полагаясь на интуицию.'),
    openings: describeCharacterRepertoire(repertoire),
    aggression: clampNum(p.aggression, 0, 100, 50),
    combination: clampNum(p.combination, 0, 100, 50),
    sacrifice: clampNum(p.sacrifice, 0, 100, 30),
    caution: clampNum(p.caution, 0, 100, 50),
    emotionality: clampNum(p.emotionality, 0, 100, 50),
    endgame: clampNum(p.endgame, 0, 100, 50),
    drawishness: clampNum(p.drawishness, 0, 100, 30),
    elo: clampNum(p.elo, 400, 2900, 1000),
    tone: String(p.tone || '').trim().slice(0, 160) || t('Сдержанная, немногословная.'),
    persona: String(p.persona || '').trim().slice(0, 500),
  };
  profile.shift = normalizeCharacterShift(p.shift, profile);
  return profile;
}

/* ---- Персонаж с двумя состояниями ----
   shift — второе состояние: другой Elo и черты, условие перехода и две
   фразы для нейросети (какой персонаж в начале и каким становится).
   Условия: move — после N-го своего хода (разово), queen_lost — потерял
   ферзя (разово), material_down — отстал в материале на N очков (разово),
   cycle — каждые N своих ходов меняется туда и обратно. О разовой смене
   персонаж пишет в чат; Elo во время партии не показывается. */
const SHIFT_TRAITS = ['aggression', 'combination', 'sacrifice', 'caution', 'endgame'];
const SHIFT_TRIGGERS = ['move', 'cycle', 'queen_lost', 'material_down'];
const SHIFT_MIN_ELO_GAP = 150; // меньше — смена незаметна, это обычный персонаж
function normalizeCharacterShift(s, base) {
  if (!s || typeof s !== 'object' || !s.trigger || typeof s.trigger !== 'object') return null;
  const type = SHIFT_TRIGGERS.includes(s.trigger.type) ? s.trigger.type : null;
  if (!type) return null;
  const num = (v, min, max, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? clamp(n, min, max) : def;
  };
  const shift = { elo: num(s.elo, 400, 2900, base.elo) };
  if (Math.abs(shift.elo - base.elo) < SHIFT_MIN_ELO_GAP) return null;
  SHIFT_TRAITS.forEach((k) => { shift[k] = num(s[k], 0, 100, base[k]); });
  const trigger = { type };
  if (type === 'move') trigger.move = num(s.trigger.move, 3, 60, 20);
  if (type === 'cycle') trigger.every = num(s.trigger.every, 1, 10, 3);
  if (type === 'material_down') trigger.points = num(s.trigger.points, 2, 15, 3);
  shift.trigger = trigger;
  shift.startNote = String(s.startNote || '').trim().slice(0, 200);
  shift.shiftNote = String(s.shiftNote || '').trim().slice(0, 200);
  return shift;
}

// Персонажа по имени chat-proxy может отдать из базы уже созданных (если его
// создавали с тем же промптом); fresh — создать заново мимо базы.
async function generateCharacterProfile(input, { fresh = false } = {}) {
  const userMsg = input.type === 'name'
    ? `Имя персонажа: ${input.value}`
    : `Описание персонажа от пользователя: ${input.value}`;
  const messages = [
    { role: 'system', content: buildCharacterGenSystemPrompt() },
    { role: 'user', content: userMsg },
  ];
  const raw = await provodChat(messages, { temperature: 0.95, kind: 'game', task: 'character_create', fresh });
  let profile;
  try {
    profile = JSON.parse(extractJson(raw));
  } catch (e) {
    throw new Error(t('не удалось разобрать ответ нейросети'));
  }
  return normalizeCharacterProfile(profile, input);
}

function eloToSkillLevel(elo) {
  const level = Math.round(((clamp(elo, 500, 2900) - 500) / 2400) * 19) + 1;
  return clamp(level, 1, 20);
}

/* ---- Отрисовка карточки персонажа ---- */
function traitLevelLabel(value) {
  const v = clamp(value, 0, 100);
  if (v < 20) return t('очень низкая');
  if (v < 40) return t('низкая');
  if (v < 60) return t('средняя');
  if (v < 80) return t('высокая');
  return t('очень высокая');
}

function eloDifficultyLabel(elo) {
  const e = clamp(elo, 500, 2900);
  if (e < 900) return t('новичок');
  if (e < 1200) return t('любитель');
  if (e < 1600) return t('уверенный игрок');
  if (e < 2000) return t('кандидат в мастера');
  if (e < 2400) return t('мастер');
  return t('гроссмейстер');
}

const traitColor = (pct) => `hsl(${pct * 1.2}, 80%, 50%)`;
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// next — значение черты во втором состоянии персонажа (если меняется).
// Растёт: за сплошной полосой полупрозрачная до нового значения.
// Падает: сплошная остаётся до стартового значения, а вырез показывает,
// до куда она опустится.
function charBarRow(label, value, next = null) {
  const pct = clamp(value, 0, 100);
  const changes = next != null && next !== pct;
  const to = changes ? clamp(next, 0, 100) : pct;
  const fill = `<span class="char-bar-fill" style="width:${pct}%; background:${traitColor(pct)};"></span>`;
  const ghost = changes && to > pct
    ? `<span class="char-bar-ghost" style="width:${to}%; background:${traitColor(to)};"></span>` : '';
  const notch = changes && to < pct ? `<span class="char-bar-notch" style="left:${to}%;"></span>` : '';
  const nowLabel = traitLevelLabel(pct);
  const nextLabel = traitLevelLabel(to);
  const valueHtml = changes && nextLabel !== nowLabel
    ? `${nowLabel}<span class="char-bar-value-next">→ ${nextLabel}</span>` : nowLabel;
  return `<div class="char-bar-row">
    <span class="char-bar-label">${escapeHtml(label)}</span>
    <span class="char-bar-track" title="${changes ? `${pct}/100 → ${to}/100` : `${pct}/100`}">${ghost}${fill}${notch}</span>
    <span class="char-bar-value">${valueHtml}</span>
  </div>`;
}

// Сверху — сила, с которой персонаж начинает партию; снизу, бледнее, —
// какой она может стать
function renderCharacterElo(profile) {
  const el = $id('charCardElo');
  const now = `<span class="char-card-elo-now">${escapeHtml(capitalize(eloDifficultyLabel(profile.elo)))}<br>≈${profile.elo} Elo</span>`;
  const sh = profile.shift;
  el.classList.toggle('has-shift', !!sh);
  if (!sh) { el.innerHTML = now; el.removeAttribute('title'); return; }
  const arrow = sh.elo > profile.elo ? '↗' : '↘';
  el.innerHTML = `${now}<span class="char-card-elo-next"><span aria-hidden="true">${arrow}</span> ${escapeHtml(capitalize(eloDifficultyLabel(sh.elo)))}<br>≈${sh.elo} Elo</span>`;
  el.title = t('Сила персонажа меняется по ходу партии');
}

function renderCharacterCard(profile) {
  // Перегенерировать можно только созданного нейросетью: у персонажа по ссылке
  // исходного запроса нет, а готовый персонаж и так собран вручную
  $id('charCardRegenBtn').classList.toggle('hidden', !charState.lastInput);
  $id('charCardName').textContent = profile.name;
  $id('charCardDesc').textContent = profile.shortDescription;
  renderCharacterElo(profile);
  const sh = profile.shift || {};
  $id('charCardBars').innerHTML = [
    charBarRow(t('Агрессия'), profile.aggression, sh.aggression),
    charBarRow(t('Тактика'), profile.combination, sh.combination),
    charBarRow(t('Жертвы'), profile.sacrifice, sh.sacrifice),
    charBarRow(t('Осторожность'), profile.caution, sh.caution),
    charBarRow(t('Эндшпиль'), profile.endgame, sh.endgame),
  ].join('');
  $id('charCardStyle').textContent = profile.style;
  $id('charCardTone').textContent = profile.openings ? t('Дебюты: {openings}', { openings: profile.openings }) : '';
}
