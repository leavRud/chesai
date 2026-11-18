# chesai — шахматы онлайн с компьютером и нейросетью

**[chesai.ru](https://chesai.ru/)** — бесплатные шахматы в браузере на русском языке. Работает на компьютере и телефоне без установки, есть мини-приложение VK.

- **[Шахматы с компьютером](https://chesai.ru/shakhmaty-s-kompyuterom.html)** — Stockfish 18, три уровня: около 1400, 2150 и 2900 Elo. Без регистрации.
- **[Шахматы с другом по ссылке](https://chesai.ru/shakhmaty-s-drugom.html)** — создаёте ссылку, друг открывает её и сразу играет. Или вдвоём на одном устройстве.
- **[Шахматы с нейросетью](https://chesai.ru/shakhmaty-s-nejrosetyu.html)** — соперники-персонажи со своим характером, стилем и рейтингом. Можно выбрать готового или создать своего.
- **[Разбор партии](https://chesai.ru/razbor-partii.html)** — Stockfish отмечает неточности, ошибки и зевки, ИИ-помощник объясняет ходы простым языком.

## Что в этом репозитории

Это опубликованная версия сайта: отсюда её раздаёт GitHub Pages на домене chesai.ru. Сборки нет — обычные HTML, CSS и JavaScript.

| Путь | Что это |
|---|---|
| `index.html`, `style.css`, `js/` | приложение: доска, режимы, разбор, чат с ИИ-помощником |
| `shakhmaty-*.html`, `razbor-partii.html` | страницы о режимах игры |
| `tarify.html`, `oferta.html`, `privacy.html`, `contacts.html` | тарифы, оферта, политика конфиденциальности, контакты |
| `stockfish/` | движок Stockfish 18 (WebAssembly), считает ходы прямо в браузере |
| `vendor/` | сторонние библиотеки, лицензии — в `vendor/LICENSES.txt` |

## Технологии

- [Stockfish](https://stockfishchess.org/) (WebAssembly) — ходы компьютера и разбор партий
- [chess.js](https://github.com/jhlywa/chess.js) — правила и проверка ходов
- [chessboard.js](https://chessboardjs.com/) — доска
- [Supabase](https://supabase.com/) — аккаунты, история партий, игра по ссылке
- Языковые модели через [Provod.ai](https://provod.ai/) — персонажи и объяснения ходов

## Автор

Максим Чебаков, независимый разработчик. Связаться и сообщить об ошибке — [chesai.ru/contacts.html](https://chesai.ru/contacts.html) или через «Обратную связь» в меню сайта.
