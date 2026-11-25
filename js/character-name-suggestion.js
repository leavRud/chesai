// Возвращает true ровно для одной вставки, потери, замены или перестановки соседей.
function differsByOneCharacter(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  if (a.length > b.length) return differsByOneCharacter(b, a);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1);
  if (a.slice(i + 1) === b.slice(i + 1)) return true;
  return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}

function suggestCharacterName(input, catalog) {
  const key = input.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (key.length < 4 || Object.hasOwn(catalog, key)) return null;
  let candidate = null;
  for (const [known, name] of Object.entries(catalog)) {
    if (known.length < 4 || !differsByOneCharacter(key, known)) continue;
    if (candidate && candidate !== name) return null;
    candidate = name;
  }
  return candidate;
}

(function setupCharacterSuggestion() {
  const field = document.getElementById('charNameInput');
  const choice = document.getElementById('charNameSuggestion');
  const create = document.getElementById('charCreateBtn');
  let suggestion = null;

  function refresh() {
    suggestion = suggestCharacterName(field.value, CHARACTER_NAME_CATALOG);
    choice.hidden = !suggestion;
    choice.classList.toggle('hidden', !suggestion);
    choice.textContent = suggestion ? t('Возможно, вы имели в виду «{name}»?', { name: suggestion }) : '';
  }

  field.addEventListener('input', refresh);
  field.addEventListener('focus', refresh);
  document.getElementById('charExamples').addEventListener('click', refresh);
  choice.addEventListener('click', () => {
    refresh();
    if (!suggestion) return;
    field.value = suggestion;
    refresh();
    create.click();
  });
})();
