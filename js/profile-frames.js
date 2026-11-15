// Аватарка профиля: своя картинка или фигура, и рамка за достижение.
'use strict';

/* =========================================================================
   РАМКИ ПРОФИЛЯ
   Каждая рамка открывается своим достижением. Список совпадает с функцией
   public.profile_frame_achievement в базе (миграция 20261115120000): сервер
   не даст надеть рамку, если достижения нет.
   ========================================================================= */
const PROFILE_FRAMES = [
  { id: 'none', name: 'Без рамки' },
  { id: 'bronze', name: 'Бронза', achievement: 'first_win' },
  { id: 'silver', name: 'Серебро ветерана', achievement: 'veteran_100' },
  { id: 'flame', name: 'Пламя', achievement: 'streak_10' },
  { id: 'stage', name: 'Сцена', achievement: 'crowd_favorite' },
  { id: 'diamond', name: 'Бриллиант', achievement: 'perfect_game' },
  { id: 'neon', name: 'Неон', achievement: 'terminator' },
  { id: 'grandmaster', name: 'Гроссмейстер', achievement: 'grandmaster_acc' },
  { id: 'legend', name: 'Легенда', achievement: 'legend_1000' },
  { id: 'holo', name: 'Голограмма', achievement: 'meta_100' },
];
const FRAME_CLASSES = PROFILE_FRAMES.map(f => `avatar-frame-${f.id}`);

function frameDef(id) { return PROFILE_FRAMES.find(f => f.id === id) || PROFILE_FRAMES[0]; }
function isFrameUnlocked(id) {
  const def = frameDef(id);
  return !def.achievement || !!window.Achievements?.isUnlocked?.(def.achievement);
}
function frameAchievementName(id) {
  const def = frameDef(id);
  if (!def.achievement) return '';
  const ach = window.Achievements?.getAchievements?.().find(a => a.id === def.achievement);
  return ach ? t(ach.name) : def.achievement;
}

// Своя картинка — ссылка на файл в бакете avatars, иначе это фигура-символ.
function isImageAvatar(avatar) { return typeof avatar === 'string' && /^https:\/\//.test(avatar); }

// Рисует аватар в элементе: картинка или символ плюс класс рамки.
// Рамку, которая перестала быть доступной (вошли в другой аккаунт), не показываем.
function paintAvatar(el, { avatar = '♟', frame = 'none' } = {}) {
  if (!el) return;
  el.classList.remove(...FRAME_CLASSES, 'has-frame', 'has-image');
  const frameId = frame && frame !== 'none' && isFrameUnlocked(frame) ? frame : 'none';
  if (frameId !== 'none') el.classList.add('has-frame', `avatar-frame-${frameId}`);
  if (isImageAvatar(avatar)) {
    el.classList.add('has-image');
    let img = el.querySelector('img.avatar-img');
    if (!img) {
      el.textContent = '';
      img = document.createElement('img');
      img.className = 'avatar-img';
      img.alt = '';
      img.decoding = 'async';
      img.addEventListener('error', () => { el.classList.remove('has-image'); img.remove(); el.textContent = '♟'; });
      el.appendChild(img);
    }
    if (img.getAttribute('src') !== avatar) img.src = avatar;
  } else {
    el.textContent = avatar || '♟';
  }
}

/* =========================================================================
   СВОЯ КАРТИНКА: выбор файла, кадрирование в круг, загрузка
   Картинку уменьшаем на устройстве до 256×256 WebP (обычно 10–30 КБ):
   в бакет уходит только готовая аватарка, а не фото на 5 МБ.
   ========================================================================= */
const AVATAR_SIZE = 256;
const cropState = { img: null, url: null, scale: 1, minScale: 1, x: 0, y: 0 };

function openAvatarCrop(file) {
  if (!file || !/^image\//.test(file.type)) { showToast(t('Выберите картинку')); return; }
  // Ссылку на файл держим, пока открыто окно: по ней же показывается превью
  if (cropState.url) URL.revokeObjectURL(cropState.url);
  const url = URL.createObjectURL(file);
  cropState.url = url;
  const img = new Image();
  img.onload = () => {
    cropState.img = img;
    const view = $id('avatarCropView');
    showModal('avatarCropModal');
    requestAnimationFrame(() => {
      const size = view.clientWidth;
      cropState.minScale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
      cropState.scale = cropState.minScale;
      cropState.x = (size - img.naturalWidth * cropState.scale) / 2;
      cropState.y = (size - img.naturalHeight * cropState.scale) / 2;
      $id('avatarCropZoom').value = '0';
      const imgEl = $id('avatarCropImg');
      imgEl.src = img.src;
      renderCrop();
    });
  };
  img.onerror = () => { URL.revokeObjectURL(url); cropState.url = null; showToast(t('Не удалось открыть картинку')); };
  img.src = url;
}

// Картинка всегда закрывает круг целиком — без пустых краёв.
function clampCrop() {
  const size = $id('avatarCropView').clientWidth;
  const w = cropState.img.naturalWidth * cropState.scale;
  const h = cropState.img.naturalHeight * cropState.scale;
  cropState.x = clamp(cropState.x, size - w, 0);
  cropState.y = clamp(cropState.y, size - h, 0);
}
function renderCrop() {
  clampCrop();
  const imgEl = $id('avatarCropImg');
  imgEl.style.width = `${cropState.img.naturalWidth * cropState.scale}px`;
  imgEl.style.transform = `translate(${cropState.x}px, ${cropState.y}px)`;
}
function setCropScale(next, cx, cy) {
  const prev = cropState.scale;
  cropState.scale = clamp(next, cropState.minScale, cropState.minScale * 4);
  // Масштабируем вокруг точки (центра круга или пальцев), а не от угла
  cropState.x = cx - (cx - cropState.x) * (cropState.scale / prev);
  cropState.y = cy - (cy - cropState.y) * (cropState.scale / prev);
  renderCrop();
}

(function initAvatarCrop() {
  const view = $id('avatarCropView');
  if (!view) return;
  const zoom = $id('avatarCropZoom');
  const pointers = new Map();
  view.addEventListener('pointerdown', (e) => {
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  view.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !cropState.img) return;
    const prev = pointers.get(e.pointerId);
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 2) {
      // Щипок двумя пальцами — масштаб
      const [a, b] = [...pointers.entries()].map(([id, p]) => (id === e.pointerId ? cur : p));
      const [pa, pb] = [...pointers.values()];
      const before = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
      const after = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const rect = view.getBoundingClientRect();
      setCropScale(cropState.scale * (after / before), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      zoom.value = String(Math.round(((cropState.scale / cropState.minScale) - 1) / 3 * 100));
    } else {
      cropState.x += cur.x - prev.x;
      cropState.y += cur.y - prev.y;
      renderCrop();
    }
    pointers.set(e.pointerId, cur);
  });
  const release = (e) => pointers.delete(e.pointerId);
  view.addEventListener('pointerup', release);
  view.addEventListener('pointercancel', release);
  view.addEventListener('wheel', (e) => {
    if (!cropState.img) return;
    e.preventDefault();
    const rect = view.getBoundingClientRect();
    setCropScale(cropState.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - rect.left, e.clientY - rect.top);
    zoom.value = String(Math.round(((cropState.scale / cropState.minScale) - 1) / 3 * 100));
  }, { passive: false });
  zoom.addEventListener('input', () => {
    if (!cropState.img) return;
    const size = view.clientWidth;
    setCropScale(cropState.minScale * (1 + (Number(zoom.value) / 100) * 3), size / 2, size / 2);
  });
  $id('avatarCropCancelBtn').addEventListener('click', () => { playSound('ui'); hideModal('avatarCropModal'); });
  $id('avatarCropSaveBtn').addEventListener('click', saveCroppedAvatar);
  $id('profileAvatarUploadBtn').addEventListener('click', () => { playSound('ui'); $id('profileAvatarFile').click(); });
  $id('profileAvatarFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // тот же файл можно выбрать снова
    if (file) openAvatarCrop(file);
  });
})();

function croppedAvatarBlob() {
  const size = $id('avatarCropView').clientWidth;
  const k = AVATAR_SIZE / size;
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cropState.img, cropState.x * k, cropState.y * k,
    cropState.img.naturalWidth * cropState.scale * k, cropState.img.naturalHeight * cropState.scale * k);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      // Safari старых версий не умеет WebP — тогда JPEG
      if (blob && blob.type === 'image/webp') resolve(blob);
      else canvas.toBlob(resolve, 'image/jpeg', 0.88);
    }, 'image/webp', 0.86);
  });
}

async function saveCroppedAvatar() {
  playSound('ui');
  const btn = $id('avatarCropSaveBtn');
  btn.disabled = true;
  btn.textContent = t('Сохраняю…');
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error(t('Войдите в аккаунт, чтобы загрузить аватарку'));
    const blob = await croppedAvatarBlob();
    if (!blob) throw new Error(t('Не удалось подготовить картинку'));
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${user.id}/avatar.${ext}`;
    const { error } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: blob.type, cacheControl: '3600' });
    if (error) throw error;
    const { data } = sb.storage.from('avatars').getPublicUrl(path);
    // Версия в ссылке — чтобы браузер не показывал старую картинку из кэша
    const url = `${data.publicUrl}?v=${Date.now()}`;
    profileEditDraft.avatar = url;
    renderProfileEditAvatar();
    hideModal('avatarCropModal');
  } catch (error) {
    console.error('Не удалось загрузить аватарку:', error);
    showToast(t('Не удалось загрузить аватарку: {error}', { error: error.message || error }));
  } finally {
    btn.disabled = false;
    btn.textContent = t('Готово');
  }
}

/* =========================================================================
   ВЫБОР В РЕДАКТОРЕ ПРОФИЛЯ
   Черновик живёт до «Сохранить»: отмена ничего не меняет в профиле.
   ========================================================================= */
const profileEditDraft = { avatar: '♟', frame: 'none' };

function startProfileEditDraft(acc) {
  profileEditDraft.avatar = acc.avatar || '♟';
  profileEditDraft.frame = acc.frame && isFrameUnlocked(acc.frame) ? acc.frame : 'none';
  renderProfileEditAvatar();
  renderFramePicker();
}

function renderProfileEditAvatar() {
  paintAvatar($id('profileEditAvatarPreview'), profileEditDraft);
  const isImage = isImageAvatar(profileEditDraft.avatar);
  document.querySelectorAll('#profileAvatarPicker .avatar-choice-btn').forEach(btn => {
    btn.classList.toggle('is-active', !isImage && btn.dataset.avatar === profileEditDraft.avatar);
  });
  $id('profileAvatarUploadBtn').classList.toggle('is-active', isImage);
}

function renderFramePicker() {
  const box = $id('profileFramePicker');
  if (!box) return;
  const avatar = profileEditDraft.avatar;
  box.innerHTML = PROFILE_FRAMES.map((f) => {
    const unlocked = isFrameUnlocked(f.id);
    const active = profileEditDraft.frame === f.id;
    const hint = unlocked ? t(f.name) : t('Откроется за достижение «{name}»', { name: frameAchievementName(f.id) });
    return `<button type="button" class="frame-choice${active ? ' is-active' : ''}${unlocked ? '' : ' is-locked'}" data-frame="${f.id}" title="${escapeHtml(hint)}" aria-pressed="${active}" ${unlocked ? '' : 'aria-disabled="true"'}>
      <span class="frame-choice-avatar"></span>
      <span class="frame-choice-name">${escapeHtml(t(f.name))}</span>
      ${unlocked ? '' : `<span class="frame-choice-lock">${escapeHtml(frameAchievementName(f.id))}</span>`}
    </button>`;
  }).join('');
  box.querySelectorAll('.frame-choice').forEach((btn) => {
    // Превью рисуем мимо проверки открытости: закрытую рамку тоже видно
    const el = btn.querySelector('.frame-choice-avatar');
    el.classList.add('has-frame', `avatar-frame-${btn.dataset.frame}`);
    if (btn.dataset.frame === 'none') el.classList.remove('has-frame');
    if (isImageAvatar(avatar)) {
      el.classList.add('has-image');
      el.innerHTML = `<img class="avatar-img" alt="" src="${escapeHtml(avatar)}">`;
    } else el.textContent = avatar || '♟';
    btn.addEventListener('click', () => {
      if (!isFrameUnlocked(btn.dataset.frame)) {
        playSound('error');
        showToast(t('Откроется за достижение «{name}»', { name: frameAchievementName(btn.dataset.frame) }));
        return;
      }
      playSound('ui');
      profileEditDraft.frame = btn.dataset.frame;
      renderProfileEditAvatar();
      renderFramePicker();
    });
  });
}
