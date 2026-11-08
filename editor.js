/* ─── State ─────────────────────────────────────────────────────── */
let wordList = [];
let hasClaudeKey = false;
let acDebounceTimer = null;
let acSuggestions = [];
let acSelectedIdx = -1;

const enInput = document.getElementById('en-input');
const koInput = document.getElementById('ko-input');
const dropdown = document.getElementById('ac-dropdown');
const tbody = document.getElementById('word-tbody');

/* ─── Init ──────────────────────────────────────────────────────── */
async function init() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    hasClaudeKey = cfg.hasClaudeKey;
  } catch { hasClaudeKey = false; }

  if (!hasClaudeKey) {
    document.getElementById('no-key-notice').classList.remove('hidden');
  } else {
    document.getElementById('btn-batch-tips').classList.remove('hidden');
  }
}

/* ─── Autocomplete ──────────────────────────────────────────────── */
enInput.addEventListener('input', () => {
  clearTimeout(acDebounceTimer);
  const val = enInput.value.trim();
  if (val.length < 2) { closeDropdown(); return; }
  acDebounceTimer = setTimeout(() => fetchSuggestions(val), 300);
});

enInput.addEventListener('keydown', e => {
  if (dropdown.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acSelectedIdx = Math.min(acSelectedIdx + 1, acSuggestions.length - 1);
    updateDropdownHighlight();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acSelectedIdx = Math.max(acSelectedIdx - 1, -1);
    updateDropdownHighlight();
  } else if (e.key === 'Enter') {
    if (acSelectedIdx >= 0) {
      e.preventDefault();
      selectWord(acSuggestions[acSelectedIdx]);
    }
  } else if (e.key === 'Escape') {
    closeDropdown();
  }
});

enInput.addEventListener('blur', () => {
  setTimeout(closeDropdown, 150);
});

async function fetchSuggestions(val) {
  try {
    const res = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(val)}*&max=10`);
    const data = await res.json();
    acSuggestions = data.map(d => d.word);
    renderDropdown();
  } catch { closeDropdown(); }
}

function renderDropdown() {
  if (acSuggestions.length === 0) { closeDropdown(); return; }
  dropdown.innerHTML = '';
  acSuggestions.forEach((word, i) => {
    const li = document.createElement('li');
    li.textContent = word;
    li.addEventListener('mousedown', e => { e.preventDefault(); selectWord(word); });
    dropdown.appendChild(li);
  });
  acSelectedIdx = -1;

  const rect = enInput.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  dropdown.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  dropdown.style.width = rect.width + 'px';
  dropdown.classList.remove('hidden');
}

function updateDropdownHighlight() {
  dropdown.querySelectorAll('li').forEach((li, i) => {
    li.classList.toggle('ac-active', i === acSelectedIdx);
  });
}

function closeDropdown() {
  dropdown.classList.add('hidden');
  acSuggestions = [];
  acSelectedIdx = -1;
}

async function selectWord(word) {
  enInput.value = word;
  closeDropdown();
  fetchKoreanMeaning(word);
  koInput.focus();
}

/* ─── Korean auto-fill ──────────────────────────────────────────── */
async function fetchKoreanMeaning(word) {
  koInput.placeholder = '번역 중...';
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ko`
    );
    const data = await res.json();
    const translated = data?.responseData?.translatedText || '';
    if (translated && translated !== word) {
      koInput.value = translated;
    }
  } catch {}
  koInput.placeholder = '한국어 뜻 (자동완성 또는 직접 입력)';
}

/* ─── Add Word ──────────────────────────────────────────────────── */
document.getElementById('btn-add').addEventListener('click', addWord);
koInput.addEventListener('keydown', e => { if (e.key === 'Enter') addWord(); });

function addWord() {
  const en = enInput.value.trim();
  const ko = koInput.value.trim();
  if (!en || !ko) {
    if (!en) enInput.classList.add('input-error');
    if (!ko) koInput.classList.add('input-error');
    setTimeout(() => {
      enInput.classList.remove('input-error');
      koInput.classList.remove('input-error');
    }, 600);
    return;
  }
  wordList.push({ en, ko, en_tip: '', ko_tip: '' });
  renderTable();
  enInput.value = '';
  koInput.value = '';
  enInput.focus();
}

/* ─── Table Render ──────────────────────────────────────────────── */
function renderTable() {
  document.getElementById('word-count').textContent = wordList.length;
  const emptyRow = document.getElementById('empty-row');

  if (wordList.length === 0) {
    tbody.innerHTML = '';
    tbody.appendChild(emptyRow || createEmptyRow());
    return;
  }

  tbody.innerHTML = '';
  wordList.forEach((w, idx) => {
    tbody.appendChild(buildRow(w, idx));
  });
}

function createEmptyRow() {
  const tr = document.createElement('tr');
  tr.id = 'empty-row';
  tr.innerHTML = '<td colspan="6" class="empty-msg">단어를 추가하면 여기에 표시됩니다.</td>';
  return tr;
}

function buildRow(w, idx) {
  const tr = document.createElement('tr');

  const tdNum = document.createElement('td');
  tdNum.className = 'row-num-cell';
  tdNum.textContent = idx + 1;

  const tdEn = document.createElement('td');
  tdEn.className = 'en-cell';
  tdEn.textContent = w.en;

  const tdKo = document.createElement('td');
  tdKo.className = 'ko-cell';
  tdKo.textContent = w.ko;

  const tdEnTip = document.createElement('td');
  tdEnTip.className = 'tip-cell';
  tdEnTip.id = `en-tip-${idx}`;
  renderTipCell(tdEnTip, w.en_tip, idx, 'en');

  const tdKoTip = document.createElement('td');
  tdKoTip.className = 'tip-cell';
  tdKoTip.id = `ko-tip-${idx}`;
  renderTipCell(tdKoTip, w.ko_tip, idx, 'ko');

  const tdDel = document.createElement('td');
  const btnDel = document.createElement('button');
  btnDel.className = 'del-btn';
  btnDel.textContent = '🗑';
  btnDel.title = '삭제';
  btnDel.addEventListener('click', () => {
    wordList.splice(idx, 1);
    renderTable();
  });
  tdDel.appendChild(btnDel);

  tr.append(tdNum, tdEn, tdKo, tdEnTip, tdKoTip, tdDel);
  return tr;
}

function renderTipCell(td, tip, idx, type) {
  td.innerHTML = '';
  if (tip) {
    td.textContent = tip;
    return;
  }
  if (!hasClaudeKey) {
    td.textContent = '-';
    return;
  }
  const btn = document.createElement('button');
  btn.className = 'tip-gen-btn';
  btn.textContent = '생성';
  btn.addEventListener('click', () => generateTip(idx, btn));
  td.appendChild(btn);
}

/* ─── Tip Generation ────────────────────────────────────────────── */
async function generateTip(idx, triggerBtn) {
  const w = wordList[idx];
  const enTipCell = document.getElementById(`en-tip-${idx}`);
  const koTipCell = document.getElementById(`ko-tip-${idx}`);

  if (enTipCell) enTipCell.innerHTML = '<span class="tip-spinner"></span>';
  if (koTipCell) koTipCell.innerHTML = '<span class="tip-spinner"></span>';

  try {
    const res = await fetch('/api/generate-tips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: w.en, meaning: w.ko }),
    });
    const data = await res.json();

    if (data.skipped) {
      if (enTipCell) enTipCell.textContent = '-';
      if (koTipCell) koTipCell.textContent = '-';
      return;
    }

    wordList[idx].en_tip = data.en_tip || '';
    wordList[idx].ko_tip = data.ko_tip || '';

    if (enTipCell) renderTipCell(enTipCell, wordList[idx].en_tip, idx, 'en');
    if (koTipCell) renderTipCell(koTipCell, wordList[idx].ko_tip, idx, 'ko');
  } catch {
    if (enTipCell) { enTipCell.textContent = '실패'; enTipCell.style.color = 'var(--danger)'; }
    if (koTipCell) { koTipCell.textContent = '실패'; koTipCell.style.color = 'var(--danger)'; }
  }
}

/* ─── Batch Tip Generation ──────────────────────────────────────── */
document.getElementById('btn-batch-tips').addEventListener('click', async () => {
  const btn = document.getElementById('btn-batch-tips');
  const pending = wordList
    .map((w, i) => i)
    .filter(i => !wordList[i].en_tip && !wordList[i].ko_tip);

  if (pending.length === 0) return;
  btn.disabled = true;

  for (let n = 0; n < pending.length; n++) {
    btn.textContent = `✨ 생성 중... (${n + 1}/${pending.length})`;
    await generateTip(pending[n], null);
  }

  btn.textContent = '✨ 팁 전체 자동생성';
  btn.disabled = false;
});

/* ─── Save ──────────────────────────────────────────────────────── */
function buildFilename() {
  const group = document.getElementById('group-input').value.trim();
  const book  = document.getElementById('book-input').value.trim();
  const chap  = document.getElementById('filename-input').value.trim();
  const parts = [group, book, chap].filter(Boolean);
  return parts.join('/');
}

function updatePathPreview() {
  const preview = document.getElementById('path-preview');
  const full = buildFilename();
  preview.textContent = full ? `저장 경로: words/${full}.txt` : '';
}

['group-input', 'book-input', 'filename-input'].forEach(id => {
  document.getElementById(id).addEventListener('input', updatePathPreview);
});

document.getElementById('btn-save').addEventListener('click', saveWords);
document.getElementById('filename-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveWords();
});

async function saveWords() {
  const filename = buildFilename();
  const statusEl = document.getElementById('save-status');
  statusEl.textContent = '';
  statusEl.className = 'save-status';

  if (!filename) {
    statusEl.textContent = '⚠️ 단원명을 입력해주세요.';
    statusEl.classList.add('err');
    return;
  }
  if (wordList.length === 0) {
    statusEl.textContent = '⚠️ 저장할 단어가 없습니다.';
    statusEl.classList.add('err');
    return;
  }

  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = '저장 중...';

  try {
    const res = await fetch('/api/save-words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, words: wordList }),
    });
    const data = await res.json();

    if (data.ok) {
      statusEl.classList.add('ok');
      statusEl.innerHTML =
        `✅ <strong>words/${data.filename}.txt</strong> 저장 완료! (${data.count}개) &nbsp;` +
        `<a href="/?file=${encodeURIComponent(data.filename)}" class="quiz-link">퀴즈로 열기 →</a>`;
    } else {
      statusEl.classList.add('err');
      statusEl.textContent = `❌ 저장 실패: ${data.error}`;
    }
  } catch (e) {
    statusEl.classList.add('err');
    statusEl.textContent = `❌ 오류: ${e.message}`;
  }

  btn.disabled = false;
  btn.textContent = '저장하기';
}

/* ─── Boot ──────────────────────────────────────────────────────── */
init();
renderTable();
