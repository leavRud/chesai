// Язык интерфейса. Ключ перевода — сам русский текст: t('Сдаться') вернёт его из
// словаря выбранного языка, а если перевода нет, покажет русский оригинал.
// Язык выбирается один раз на загрузку страницы, смена перезагружает её, поэтому
// t() можно звать и в константах. Грузится в <head>, раньше всех скриптов.
// Чтобы добавить язык: словарь по образцу i18n-en.js и строка в UI_DICTIONARIES.
'use strict';

const UI_DICTIONARIES = { ru: {}, en: I18N_EN };
const UI_LOCALES = { ru: 'ru-RU', en: 'en-US' };
// Как нейросети назвать язык ответа: подставляется в промпты, написанные по-русски
const AI_LANGUAGES = { ru: 'по-русски', en: 'на английском языке (in English)' };
const LANGUAGE_KEY = 'chessLanguage';
const RUSSIAN_SPEAKING_LOCALES = ['ru', 'uk', 'be', 'kk'];

function savedLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (UI_DICTIONARIES[saved]) return saved;
  } catch (e) { /* хранилище недоступно */ }
  return null;
}

// Без сохранённого выбора — всегда русский. Язык браузера сам не переключает
// интерфейс: поисковые роботы рендерят страницу с en-US и иначе индексировали бы
// английскую версию по русским запросам. Англоязычным браузерам английский
// предлагается плашкой (offerEnglish ниже).
function detectLanguage() {
  return savedLanguage() || 'ru';
}

function browserPrefersEnglish() {
  const browser = (navigator.language || 'ru').slice(0, 2).toLowerCase();
  return !RUSSIAN_SPEAKING_LOCALES.includes(browser);
}

const uiLang = detectLanguage();
window.uiLang = uiLang; // packs.js работает и на tarify.html, где этого файла нет
const uiLocale = UI_LOCALES[uiLang];
const AI_LANGUAGE = AI_LANGUAGES[uiLang];

function setLanguage(lang) {
  try { localStorage.setItem(LANGUAGE_KEY, lang); } catch (e) { /* без хранилища выбор проживёт до перезагрузки */ }
  window.location.reload();
}

// t('Ход {n}', { n: 5 }) — значения подставляются вместо {имя}
function t(key, vars) {
  const text = UI_DICTIONARIES[uiLang][key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? vars[name] : match));
}

// 1 ход, 2 хода, 5 ходов. В словаре у формы one свой перевод, few и many — общий.
function plural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (uiLang !== 'ru') return t(n === 1 ? one : many);
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

// Переводит статичную разметку index.html: текст элементов и атрибуты с текстом.
// Текст, разбитый ссылками внутри абзаца, переводится по кускам.
const TRANSLATED_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt'];

function translateTextNode(node) {
  const [, before, text, after] = node.nodeValue.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const translated = t(text.replace(/\s+/g, ' '));
  if (translated !== text) node.nodeValue = before + translated + after;
}

function translatePage() {
  if (uiLang === 'ru') return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const tag = walker.currentNode.parentNode.tagName;
    if (tag !== 'SCRIPT' && tag !== 'STYLE') translateTextNode(walker.currentNode);
  }
  TRANSLATED_ATTRIBUTES.forEach((name) => {
    document.querySelectorAll(`[${name}]`).forEach((el) => el.setAttribute(name, t(el.getAttribute(name))));
  });
}

document.documentElement.lang = uiLang;
document.title = t(document.title);

// Плашка «Switch to English?» для браузеров не на русском, пока язык не выбран.
// Текст намеренно по-английски: она для тех, кто не читает по-русски.
// «Оставить русский» запоминает выбор, и плашка больше не появляется.
function offerEnglish() {
  if (savedLanguage() || !browserPrefersEnglish()) return;
  const bar = document.createElement('div');
  bar.className = 'lang-offer';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', 'Language');
  bar.lang = 'en';
  bar.innerHTML =
    '<span class="lang-offer-text">This site is in Russian. Switch to English?</span>' +
    '<button type="button" class="lang-offer-yes">English</button>' +
    '<button type="button" class="lang-offer-no" lang="ru">Оставить русский</button>';
  bar.querySelector('.lang-offer-yes').addEventListener('click', () => setLanguage('en'));
  bar.querySelector('.lang-offer-no').addEventListener('click', () => {
    try { localStorage.setItem(LANGUAGE_KEY, 'ru'); } catch (e) { /* покажется снова при следующем заходе */ }
    bar.remove();
  });
  document.body.appendChild(bar);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', offerEnglish);
else offerEnglish();
