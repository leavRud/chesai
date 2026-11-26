// Аккаунт и вход.
'use strict';

/* =========================================================================
   АККАУНТ
   -------------------------------------------------------------------------
   getAccount/saveAccount/clearAccount — локальный кэш в localStorage,
   нужен для мгновенной отрисовки профиля без ожидания сети. Источник
   истины — таблица profiles в Supabase; после логина/загрузки сессии
   кэш синхронизируется через fetchProfileFromSupabase().
   ========================================================================= */
const ACCOUNT_STORAGE_KEY = 'chessAccount';

function getAccount() {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveAccount(acc) {
  try { localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(acc)); } catch (e) {}
}
function clearAccount() {
  try { localStorage.removeItem(ACCOUNT_STORAGE_KEY); } catch (e) {}
}

// Подтягивает профиль пользователя из таблицы profiles и обновляет локальный кэш.
async function fetchProfileFromSupabase(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('name, avatar, elo, frame')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  const acc = { uid: userId, name: data.name, avatar: data.avatar || '♟', frame: data.frame || 'none', elo: data.elo ?? 1200 };
  // История рейтинга живёт только в локальном кэше (в profiles её нет):
  // не теряем её при каждой загрузке профиля, иначе график Elo обнуляется.
  const prev = getAccount();
  if (prev && (!prev.uid || prev.uid === userId) && Array.isArray(prev.eloHistory) && prev.eloHistory.length) {
    acc.eloHistory = prev.eloHistory;
    acc.lastEloGameKey = prev.lastEloGameKey;
    const last = acc.eloHistory[acc.eloHistory.length - 1];
    // Рейтинг изменился на другом устройстве — продолжаем график с него
    if (last && last.elo !== acc.elo) {
      acc.eloHistory.push({ n: last.n + 1, elo: acc.elo, delta: acc.elo - last.elo, ts: Date.now() });
    }
  }
  saveAccount(acc);
  return acc;
}

// Открытая вкладка могла остаться со старым локальным кэшем после изменения
// профиля на другом устройстве. Запрашиваем профиль при открытии панели.
let profileRefreshPromise = null;
function refreshAccountProfile() {
  if (profileRefreshPromise) return profileRefreshPromise;
  profileRefreshPromise = (async () => {
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return null;
      const acc = await fetchProfileFromSupabase(user.id);
      if (!acc) return null;
      renderMenuProfile();
      if (getCurrentView() === 'profile') renderProfileView();
      return acc;
    } catch (error) {
      console.error('Не удалось обновить профиль:', error);
      return null;
    }
  })().finally(() => { profileRefreshPromise = null; });
  return profileRefreshPromise;
}

// Записывает изменения профиля (например, новый Elo) в Supabase и локальный кэш.
async function syncProfileToSupabase(userId, patch) {
  const { error } = await sb
    .from('profiles')
    .update(patch)
    .eq('id', userId);
  if (error) console.error('Не удалось сохранить профиль в Supabase:', error);
  return !error;
}

const ELO_HISTORY_LIMIT = 200;

// Гарантирует наличие eloHistory у старых аккаунтов (первая точка = стартовый Elo).
function ensureEloHistory(acc) {
  if (!Array.isArray(acc.eloHistory) || !acc.eloHistory.length) {
    acc.eloHistory = [{ n: 0, elo: Number.isFinite(acc.elo) ? acc.elo : 1200, delta: 0, ts: Date.now() }];
  }
  return acc.eloHistory;
}

/* ---- Рейтинг аккаунта ----
   Считает база (триггер apply_game_rating, миграция 20261115140000) при
   сохранении законченной партии против Stockfish или персонажа: классический
   Elo по результату и силе соперника. Браузер только показывает итог —
   раньше он сам считал рейтинг по точности и только после «Разобрать партию». */
function applyRatedGameResult(row) {
  if (!row || row.rating_delta == null || !Number.isFinite(row.player_elo)) return null;
  const acc = getAccount();
  if (!acc) return null;
  const before = row.player_elo;
  const after = before + row.rating_delta;
  const history = ensureEloHistory(acc);
  acc.elo = after;
  const lastPoint = history[history.length - 1];
  history.push({ n: lastPoint.n + 1, elo: after, delta: row.rating_delta, ts: Date.now() });
  if (history.length > ELO_HISTORY_LIMIT) {
    acc.eloHistory = [history[0], ...history.slice(-(ELO_HISTORY_LIMIT - 1))];
  }
  saveAccount(acc);
  renderMenuProfile();
  if (getCurrentView() === 'stats') renderStatsView();
  if (getCurrentView() === 'profile') renderProfileView();
  window.Achievements?.track?.('rating', { elo: after });
  return { before, after, delta: row.rating_delta };
}

function formatRatingChange(change) {
  const sign = change.delta > 0 ? '+' : change.delta < 0 ? '−' : '±';
  return t('Рейтинг {before} → {after} ({delta})', { before: change.before, after: change.after, delta: `${sign}${Math.abs(change.delta)}` });
}

function renderMenuProfile() {
  const avatarEl = $id('menuAvatar');
  const nameEl = $id('menuProfileName');
  const eloEl = $id('menuProfileElo');
  const authBtn = $id('menuAuthBtn');
  const cardEl = $id('menuProfileCard');
  if (!avatarEl || !nameEl || !eloEl || !authBtn || !cardEl) return;

  const acc = getAccount();
  if (acc) {
    paintAvatar(avatarEl, acc); // js/profile-frames.js
    nameEl.textContent = acc.name || t('Игрок');
    eloEl.textContent = `${Number.isFinite(acc.elo) ? acc.elo : 1200} Elo`;
    eloEl.classList.remove('hidden');
    authBtn.classList.add('hidden');
    cardEl.classList.remove('is-guest');
  } else {
    paintAvatar(avatarEl, {});
    nameEl.textContent = t('Гость');
    eloEl.classList.add('hidden');
    authBtn.classList.remove('hidden');
    cardEl.classList.add('is-guest');
  }
}

/* ---- Мок-авторизация (полностью локальная, без сервера) ----
   Вход — короткое самостоятельное действие, поэтому остаётся обычной
   модалкой (см. правило: модалки — только для коротких действий),
   а не view боковой панели. */
// reason — почему просим войти; показывается строкой под заголовком окна.
function openAuthModal(reason = '') {
  const reasonEl = $id('authReason');
  reasonEl.textContent = reason;
  reasonEl.classList.toggle('hidden', !reason);
  ['authLoginEmail', 'authLoginPassword', 'authRegisterName', 'authRegisterEmail', 'authRegisterPassword', 'authRegisterPassword2',
    'authForgotEmail', 'authResetPassword', 'authResetPassword2'].forEach((id) => {
    const el = $id(id);
    if (el) el.value = '';
  });
  setAuthMode('login');
  updatePasswordStrength('');
  showModal('authModal');
  setTimeout(() => { const el = $id('authLoginEmail'); if (el) el.focus(); }, 50);
}
async function handleLogout() {
  await sb.auth.signOut();
  clearAccount();
  renderMenuProfile();
  if (typeof getCurrentView === 'function' && getCurrentView() === 'profile') renderProfileView();
  showToast(t('Вы вышли из аккаунта'));
}
