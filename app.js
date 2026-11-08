/* ─── Base path (works on GitHub Pages subdirectory or root) ────── */
const BASE = location.href.replace(/[^/]*(\?.*)?$/, '');

/* ─── State ─────────────────────────────────────────────────────── */
let allWords = [];
let words = [];
let mode = 'en-ko';
let isRandom = false;
let results = {};       // globalIdx → 'correct' | 'wrong' | 'revealed'
let currentPage = 0;
const PAGE_SIZE = 10;

// 오답 복습 모드
let isWrongMode = false;
let savedWords = [];    // 복습 진입 전 words 백업
let savedResults = {};  // 복습 진입 전 results 백업

// 게임
let streak = 0;
let xp = 0;
const XP_PER_LEVEL = 100;

// STT
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const hasSpeech = !!SpeechRecognition;
let activeRecognition = null;

const fileParam = new URLSearchParams(window.location.search).get('file') || 'words';

/* ─── Helpers ───────────────────────────────────────────────────── */
function totalPages() { return Math.max(1, Math.ceil(words.length / PAGE_SIZE)); }
function pageWords()  { return words.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE); }
function pageOffset() { return currentPage * PAGE_SIZE; }
function getTip(word) { return mode === 'en-ko' ? (word.en_tip || '') : (word.ko_tip || ''); }

function normalize(s) {
  return s
    .replace(/\(.*?\)/g, '')   // 괄호 안 내용 제거
    .replace(/[~～]/g, '')      // 물결표 제거
    .replace(/\s+/g, '')
    .toLowerCase();
}

/* ─── Init ──────────────────────────────────────────────────────── */
const isGip = fileParam.includes('/gip_en/') || fileParam.startsWith('gip_en/');

async function init() {
  const titleEl = document.querySelector('.logo');
  if (titleEl) titleEl.textContent = `📖 ${fileParam}`;
  document.title = `${fileParam} — 단어 암기장`;

  if (isGip) {
    mode = 'ko-en';
    document.getElementById('btn-en-ko').classList.remove('active');
    document.getElementById('btn-en-ko').classList.add('hidden');
    document.getElementById('btn-ko-en').classList.add('active');
  }

  let allWordsData;
  try {
    const res = await fetch(`${BASE}words/${fileParam}.txt`);
    if (!res.ok) throw new Error('단어 파일을 불러올 수 없습니다.');
    const text = await res.text();
    allWordsData = text.split('\n').flatMap(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return [];
      const parts = line.split(';', 4);
      if (parts.length < 2) return [];
      return [{ en: parts[0].trim(), ko: parts[1].trim(), en_tip: (parts[2] || '').trim(), ko_tip: (parts[3] || '').trim() }];
    });
  } catch (e) {
    document.getElementById('word-list').innerHTML =
      `<div class="error-msg">⚠️ ${e.message}</div>`;
    return;
  }

  allWords = allWordsData;
  words = [...allWords];
  updateGameUI();
  reset();

  const pathParts = fileParam.split('/');
  const songJsonPath = `${BASE}words/` + pathParts.slice(0, -1).join('/') + '/_songs.json';
  fetch(songJsonPath)
    .then(r => r.ok ? r.json() : {})
    .then(songs => {
      const song_url = songs[pathParts[pathParts.length - 1]] || '';
      if (song_url) {
        const btn = document.getElementById('btn-song');
        btn.href = song_url;
        btn.classList.remove('hidden');
      }
    })
    .catch(() => {});
}

/* ─── Game UI ───────────────────────────────────────────────────── */
function updateGameUI() {
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpInLevel = xp % XP_PER_LEVEL;
  document.getElementById('streak-count').textContent = streak;
  document.getElementById('level-count').textContent = level;
  document.getElementById('xp-label').textContent = `${xp} XP`;
  document.getElementById('xp-bar-fill').style.width = (xpInLevel / XP_PER_LEVEL * 100) + '%';
  const streakStat = document.getElementById('streak-stat');
  streakStat.classList.toggle('streak-active', streak >= 3);
}

function addXP(amount, el) {
  xp += amount;
  updateGameUI();
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const floater = document.createElement('div');
  floater.className = 'xp-float';
  floater.textContent = `+${amount} XP`;
  floater.style.left = rect.left + 'px';
  floater.style.top = (rect.top + window.scrollY - 10) + 'px';
  document.body.appendChild(floater);
  setTimeout(() => floater.remove(), 1000);
}

function showStreakToast(n) {
  const toast = document.createElement('div');
  toast.className = 'streak-toast';
  toast.textContent = `🔥 ${n}연속 정답!`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

/* ─── STT ───────────────────────────────────────────────────────── */
function showSttError(code) {
  const msgs = {
    'not-allowed':  '마이크 권한이 차단되어 있습니다. 브라우저 설정에서 허용해주세요.',
    'network':      'HTTPS가 필요합니다. HTTP에서는 음성인식이 동작하지 않습니다.',
    'no-speech':    '음성이 감지되지 않았습니다. 다시 시도해주세요.',
    'aborted':      '음성인식이 중단되었습니다.',
  };
  const msg = msgs[code] || `음성인식 오류: ${code}`;
  const toast = document.createElement('div');
  toast.className = 'stt-error-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}


function startRecognition(input, micBtn, submitFn) {
  if (activeRecognition) {
    activeRecognition.stop();
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = mode === 'en-ko' ? 'ko-KR' : 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  activeRecognition = recognition;

  const originalPlaceholder = input.placeholder;
  micBtn.classList.add('listening');
  input.placeholder = '말하세요...';

  recognition.onresult = e => {
    input.value = e.results[0][0].transcript;
  };

  recognition.onend = () => {
    micBtn.classList.remove('listening');
    input.placeholder = originalPlaceholder;
    activeRecognition = null;
    if (input.value.trim()) submitFn();
  };

  recognition.onerror = e => {
    micBtn.classList.remove('listening');
    input.placeholder = originalPlaceholder;
    activeRecognition = null;
    showSttError(e.error);
  };

  recognition.start();
}

/* ─── Reset (새 단어 세트 시작) ─────────────────────────────────── */
function reset() {
  results = {};
  streak = 0;
  xp = 0;
  updateGameUI();
  currentPage = 0;
  render();
}

/* ─── Render ────────────────────────────────────────────────────── */
function render() {
  updateProgress();
  updatePagination();

  const list = document.getElementById('word-list');
  list.innerHTML = '';
  document.getElementById('completion-banner').classList.add('hidden');

  const offset = pageOffset();
  pageWords().forEach((word, localIdx) => {
    const globalIdx = offset + localIdx;
    list.appendChild(buildRow(word, globalIdx, localIdx));
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─── Build Row ─────────────────────────────────────────────────── */
function buildRow(word, globalIdx, localIdx) {
  const prompt = mode === 'en-ko' ? word.en : word.ko;
  const answers = mode === 'en-ko'
    ? word.ko.split('/').map(s => normalize(s))
    : word.en.split('/').map(s => normalize(s));
  const correctDisplay = mode === 'en-ko' ? word.ko : word.en;

  const row = document.createElement('div');
  row.className = 'word-row';

  // 이미 채점된 상태 복원
  const prevResult = results[globalIdx];
  if (prevResult) {
    row.classList.add(prevResult);
    if (prevResult === 'correct') row.classList.add('done');
  }

  const num = document.createElement('span');
  num.className = 'row-num';
  num.textContent = globalIdx + 1;

  const promptEl = document.createElement('span');
  promptEl.className = 'row-prompt';
  if (isGip) {
    prompt.split('/').forEach((part, i, arr) => {
      promptEl.appendChild(document.createTextNode(part.trim()));
      if (i < arr.length - 1) promptEl.appendChild(document.createElement('br'));
    });
  } else {
    promptEl.textContent = prompt;
  }

  const inputCol = document.createElement('div');
  inputCol.className = 'row-input-col';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'row-input';
  input.placeholder = mode === 'en-ko' ? '한국어로 입력...' : 'Type in English...';
  input.autocomplete = 'off';
  input.spellcheck = false;

  const answerHint = document.createElement('span');
  answerHint.className = 'row-answer-hint';

  const tipEl = document.createElement('span');
  tipEl.className = 'row-tip';

  const status = document.createElement('span');
  status.className = 'row-status';

  // 이전에 정답/오답/보기 처리된 항목 복원
  if (prevResult) {
    input.value = correctDisplay;
    input.disabled = true;
    if (prevResult === 'wrong' || prevResult === 'revealed') {
      const hintColor = prevResult === 'wrong' ? 'var(--danger)' : 'var(--warn)';
      answerHint.textContent = `정답: ${correctDisplay}`;
      answerHint.style.color = hintColor;
      attachOverrideBtn(answerHint, row, status, tipEl, word, globalIdx);
    }
    if (getTip(word) && (prevResult === 'correct' || prevResult === 'revealed')) {
      tipEl.textContent = `💡 ${getTip(word)}`;
      tipEl.style.display = 'block';
    }
  }

  const inputWrap = document.createElement('div');
  inputWrap.className = 'row-input-wrap';
  inputWrap.appendChild(input);

  if (hasSpeech && !prevResult) {
    const micBtn = document.createElement('button');
    micBtn.className = 'mic-btn';
    micBtn.textContent = '🎤';
    micBtn.title = '음성 입력';
    micBtn.type = 'button';
    micBtn.addEventListener('click', () => startRecognition(input, micBtn, submit));
    inputWrap.appendChild(micBtn);
  }

  inputCol.appendChild(inputWrap);
  inputCol.appendChild(answerHint);
  inputCol.appendChild(tipEl);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'row-btn-group';

  const btnReveal = document.createElement('button');
  btnReveal.className = 'row-btn btn-reveal';
  btnReveal.textContent = '정답 보기';

  if (prevResult) {
    btnReveal.style.opacity = '0';
    btnReveal.style.pointerEvents = 'none';
  }

  btnGroup.appendChild(btnReveal);

  if (prevResult === 'correct') { status.textContent = '✓'; status.style.color = 'var(--success)'; }
  else if (prevResult === 'wrong') { status.textContent = '✗'; status.style.color = 'var(--danger)'; }
  else if (prevResult === 'revealed') { status.textContent = '👁'; }
  else { status.textContent = '○'; }

  row.appendChild(num);
  row.appendChild(promptEl);
  row.appendChild(inputCol);
  row.appendChild(btnGroup);
  row.appendChild(status);

  /* Events */
  function submit() {
    if (results[globalIdx]) return;
    const val = normalize(input.value);

    if (val === '') {
      // 빈 입력 → 정답 보기
      input.value = correctDisplay;
      answerHint.textContent = `정답: ${correctDisplay}`;
      answerHint.style.color = 'var(--warn)';
      row.classList.add('revealed');
      status.textContent = '👁';
      status.classList.add('pop');
      results[globalIdx] = 'revealed';
      streak = 0;
      updateGameUI();
      attachOverrideBtn(answerHint, row, status, tipEl, word, globalIdx);
    } else if (answers.includes(val)) {
      markCorrect(row, status, answerHint, tipEl, getTip(word), globalIdx);
    } else {
      markWrong(row, status, answerHint, globalIdx, correctDisplay);
      attachOverrideBtn(answerHint, row, status, tipEl, word, globalIdx);
    }

    const tip = getTip(word);
    if (tip) {
      tipEl.textContent = `💡 ${tip}`;
      tipEl.style.display = 'block';
    }

    input.disabled = true;
    btnReveal.style.opacity = '0';
    btnReveal.style.pointerEvents = 'none';
    updateProgress();
    checkPageCompletion();
    checkCompletion();
  }

  btnReveal.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

  return row;
}

function markCorrect(row, status, answerHint, tipEl, tip, idx) {
  row.classList.add('correct', 'flash');
  row.addEventListener('animationend', () => row.classList.remove('flash'), { once: true });
  status.textContent = '✓';
  status.style.color = 'var(--success)';
  status.classList.add('pop');
  answerHint.style.display = 'none';
  results[idx] = 'correct';
  streak++;
  const gain = streak >= 5 ? 20 : streak >= 3 ? 15 : 10;
  addXP(gain, status);
  if (streak === 3 || streak === 5 || streak % 10 === 0) showStreakToast(streak);
  updateGameUI();
}

function markWrong(row, status, answerHint, idx, correctDisplay) {
  row.classList.add('shake');
  row.addEventListener('animationend', () => row.classList.remove('shake'), { once: true });
  row.classList.add('wrong');
  status.textContent = '✗';
  status.style.color = 'var(--danger)';
  status.classList.add('pop');
  answerHint.textContent = `정답: ${correctDisplay}`;
  answerHint.style.color = 'var(--danger)';
  results[idx] = 'wrong';
  streak = 0;
  updateGameUI();
}

function attachOverrideBtn(answerHint, row, status, tipEl, word, idx) {
  answerHint.style.display = 'flex';
  const btn = document.createElement('button');
  btn.className = 'override-btn';
  btn.textContent = '✏️ 정답으로 변경';
  btn.type = 'button';
  btn.addEventListener('click', () => {
    results[idx] = 'correct';
    row.classList.remove('wrong', 'revealed');
    row.classList.add('correct', 'flash');
    row.addEventListener('animationend', () => row.classList.remove('flash'), { once: true });
    answerHint.style.display = 'none';
    status.textContent = '✓';
    status.style.color = 'var(--success)';
    status.classList.add('pop');
    const tip = getTip(word);
    if (tip) { tipEl.textContent = `💡 ${tip}`; tipEl.style.display = 'block'; }
    updateProgress();
    checkCompletion();
  });
  answerHint.appendChild(btn);
}

/* ─── Page completion nudge ─────────────────────────────────────── */
function checkPageCompletion() {
  const offset = pageOffset();
  const pageLen = pageWords().length;
  const pageDone = Array.from({ length: pageLen }, (_, i) => results[offset + i]).every(Boolean);
  const btnNext = document.getElementById('btn-next');
  const btnNextB = document.getElementById('btn-next-b');
  if (pageDone && currentPage < totalPages() - 1) {
    btnNext.classList.add('nudge');
    btnNextB.classList.add('nudge');
  } else {
    btnNext.classList.remove('nudge');
    btnNextB.classList.remove('nudge');
  }
}

/* ─── Progress ──────────────────────────────────────────────────── */
function updateProgress() {
  const total = words.length;
  const correct = Object.values(results).filter(v => v === 'correct').length;
  const done = Object.keys(results).length;
  const pct = total ? (done / total) * 100 : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `${correct} / ${total}`;
  updateWrongBadge();
}

function updateWrongBadge() {
  // 복습 모드에선 저장된 결과 기준, 아니면 현재 결과 기준
  const baseRes = isWrongMode ? savedResults : results;
  const wrongCount = Object.values(baseRes).filter(v => v === 'wrong' || v === 'revealed').length;
  const badge = document.getElementById('wrong-count-badge');
  const btn = document.getElementById('btn-wrong-review');
  badge.textContent = wrongCount;
  btn.disabled = wrongCount === 0 || isWrongMode;
  btn.classList.toggle('has-wrong', wrongCount > 0 && !isWrongMode);
}

/* ─── Pagination UI ─────────────────────────────────────────────── */
function updatePagination() {
  const tp = totalPages();
  const cur = currentPage + 1;
  const start = pageOffset() + 1;
  const end = Math.min(pageOffset() + PAGE_SIZE, words.length);
  const rangeText = `(${start}~${end}번)`;

  ['', '-b'].forEach(sfx => {
    document.getElementById(`page-indicator${sfx}`).textContent = `${cur} / ${tp}`;
    document.getElementById(`page-range${sfx}`).textContent = rangeText;
  });

  const prevDisabled = currentPage === 0;
  const nextDisabled = currentPage >= tp - 1;
  document.getElementById('btn-prev').disabled = prevDisabled;
  document.getElementById('btn-prev-b').disabled = prevDisabled;
  document.getElementById('btn-next').disabled = nextDisabled;
  document.getElementById('btn-next-b').disabled = nextDisabled;

  ['btn-next','btn-next-b'].forEach(id => document.getElementById(id).classList.remove('nudge'));
  checkPageCompletion();
}

function goPage(delta) {
  const next = currentPage + delta;
  if (next < 0 || next >= totalPages()) return;
  currentPage = next;
  render();
}

/* ─── Completion ────────────────────────────────────────────────── */
function checkCompletion() {
  if (Object.keys(results).length < words.length) return;

  const correct = Object.values(results).filter(v => v === 'correct').length;
  const wrong   = Object.values(results).filter(v => v === 'wrong' || v === 'revealed').length;

  const banner = document.getElementById('completion-banner');
  banner.classList.remove('hidden');
  document.getElementById('completion-score').textContent =
    `정답 ${correct}개 / 오답 ${wrong}개 (전체 ${words.length}개)`;

  const btnRetryWrong = document.getElementById('btn-retry-wrong');
  btnRetryWrong.classList.toggle('hidden', wrong === 0);

  banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (correct === words.length) launchConfetti();
}

/* ─── Confetti ──────────────────────────────────────────────────── */
function launchConfetti() {
  const container = document.getElementById('confetti-container');
  const colors = ['#6c63ff','#48b2ff','#22c55e','#f59e0b','#ef4444','#ec4899','#fff'];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.width = (8 + Math.random() * 8) + 'px';
    p.style.height = (8 + Math.random() * 8) + 'px';
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    const dur = 1.5 + Math.random() * 2;
    const del = Math.random() * 1.2;
    p.style.animationDuration = dur + 's';
    p.style.animationDelay = del + 's';
    container.appendChild(p);
    setTimeout(() => p.remove(), (dur + del + 0.2) * 1000);
  }
}

/* ─── Shuffle ───────────────────────────────────────────────────── */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ─── Controls ──────────────────────────────────────────────────── */
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === mode) return;
    mode = btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    words = isRandom ? shuffle(allWords) : [...allWords];
    reset();
  });
});

document.getElementById('btn-random').addEventListener('click', () => {
  isRandom = true;
  words = shuffle(allWords);
  document.getElementById('btn-random').classList.add('active-order');
  document.getElementById('btn-order').classList.remove('active-order');
  reset();
});

document.getElementById('btn-order').addEventListener('click', () => {
  isRandom = false;
  words = [...allWords];
  document.getElementById('btn-order').classList.add('active-order');
  document.getElementById('btn-random').classList.remove('active-order');
  reset();
});

document.getElementById('btn-prev').addEventListener('click', () => goPage(-1));
document.getElementById('btn-next').addEventListener('click', () => goPage(1));

document.getElementById('btn-reveal-all').addEventListener('click', () => {
  const offset = pageOffset();
  pageWords().forEach((word, localIdx) => {
    const globalIdx = offset + localIdx;
    if (results[globalIdx]) return;
    results[globalIdx] = 'revealed';
    streak = 0;
  });
  updateGameUI();
  render();
  checkCompletion();
});
document.getElementById('btn-prev-b').addEventListener('click', () => goPage(-1));
document.getElementById('btn-next-b').addEventListener('click', () => goPage(1));

document.getElementById('btn-retry-all').addEventListener('click', () => {
  words = isRandom ? shuffle(allWords) : [...allWords];
  reset();
});

document.getElementById('btn-retry-wrong').addEventListener('click', enterWrongMode);

/* ─── 오답 복습 모드 ────────────────────────────────────────────── */
function enterWrongMode() {
  const wrongIndices = Object.entries(results)
    .filter(([, v]) => v === 'wrong' || v === 'revealed')
    .map(([k]) => parseInt(k));
  if (wrongIndices.length === 0) return;

  savedWords = words;
  savedResults = { ...results };
  words = wrongIndices.map(i => savedWords[i]);
  results = {};
  isWrongMode = true;
  currentPage = 0;

  document.getElementById('wrong-mode-banner').classList.remove('hidden');
  document.getElementById('completion-banner').classList.add('hidden');
  render();
}

function exitWrongMode() {
  words = savedWords;
  results = savedResults;
  isWrongMode = false;
  currentPage = 0;

  document.getElementById('wrong-mode-banner').classList.add('hidden');
  render();
}

document.getElementById('btn-wrong-review').addEventListener('click', enterWrongMode);
document.getElementById('btn-exit-wrong').addEventListener('click', exitWrongMode);

/* ─── Boot ──────────────────────────────────────────────────────── */
init();
