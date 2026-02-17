const SHEET_ID = '1NU7bDfFbkyvyq8qEMARUixSO2jJOhGvljidnwo5Gq2c';
const GID = '0';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
const PASSWORD_HASH_HEX = 'c8ccaa4383657cd5e791388d7e5bdac754d834bd2509a22017e0419fb1f2344e';
const AUTH_KEY = 'zeus_auth_ok_v1';

const freqValueEl = document.getElementById('freqValue');
const freqChipsEl = document.getElementById('freqChips');
const searchBtn = document.getElementById('searchBtn');
const tagInputEl = document.getElementById('tagInput');
const tagSuggestEl = document.getElementById('tagSuggest');
const statusEl = document.getElementById('status');
const cardsEl = document.getElementById('cards');
const authGateEl = document.getElementById('authGate');
const authPasswordEl = document.getElementById('authPassword');
const authSubmitEl = document.getElementById('authSubmit');
const authErrorEl = document.getElementById('authError');

const state = {
  rows: [],
  allTags: [],
  selectedTagKey: '',
  hasSearched: false,
};

const FREQ_CHOICES = [
  { value: '', label: 'ALL' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
];

const FALLBACK_TAG_READINGS = {
  動物: 'どうぶつ',
  曜日: 'ようび',
  月曜日: 'げつようび',
  火曜日: 'かようび',
  水曜日: 'すいようび',
  木曜日: 'もくようび',
  金曜日: 'きんようび',
  土曜日: 'どようび',
  日曜日: 'にちようび',
  植物: 'しょくぶつ',
  食べ物: 'たべもの',
  食物: 'しょくもつ',
  国語: 'こくご',
  算数: 'さんすう',
  数学: 'すうがく',
  理科: 'りか',
  社会: 'しゃかい',
  英語: 'えいご',
};

const COMMON_READING_PARTS = {
  曜日: 'ようび',
  月曜: 'げつよう',
  火曜: 'かよう',
  水曜: 'すいよう',
  木曜: 'もくよう',
  金曜: 'きんよう',
  土曜: 'どよう',
  日曜: 'にちよう',
  動物: 'どうぶつ',
  植物: 'しょくぶつ',
  食べ物: 'たべもの',
  国語: 'こくご',
  算数: 'さんすう',
  数学: 'すうがく',
  理科: 'りか',
  社会: 'しゃかい',
  英語: 'えいご',
};

let tokenizer = null;
let tokenizerPromise = null;

function hasCoreUi() {
  return Boolean(freqValueEl && freqChipsEl && searchBtn && tagInputEl && tagSuggestEl && statusEl && cardsEl);
}

async function sha256Hex(text) {
  if (!window.crypto || !window.crypto.subtle) {
    return '';
  }
  const data = new TextEncoder().encode(text);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function setupSimpleAuth(onSuccess) {
  if (!authGateEl || !authPasswordEl || !authSubmitEl || !authErrorEl) {
    onSuccess();
    return;
  }
  if (sessionStorage.getItem(AUTH_KEY) === '1') {
    authGateEl.classList.add('hidden');
    onSuccess();
    return;
  }

  const verify = async () => {
    const input = authPasswordEl.value;
    const hashed = await sha256Hex(input);
    if (hashed && hashed === PASSWORD_HASH_HEX) {
      sessionStorage.setItem(AUTH_KEY, '1');
      authErrorEl.textContent = '';
      authGateEl.classList.add('hidden');
      onSuccess();
      return;
    }
    authErrorEl.textContent = 'パスワードが違います';
  };

  authSubmitEl.addEventListener('click', () => {
    verify();
  });
  authPasswordEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      verify();
    }
  });
}

function normalize(s) {
  return String(s || '').normalize('NFKC').trim();
}

function normalizeHeader(s) {
  return normalize(s).toLowerCase();
}

function toHiragana(s) {
  return Array.from(normalize(s))
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 0x30a1 && code <= 0x30f6) {
        return String.fromCharCode(code - 0x60);
      }
      return ch;
    })
    .join('');
}

function kanaFold(s) {
  return toHiragana(normalize(s)).toLowerCase();
}

function containsKanji(s) {
  return /[\u4e00-\u9faf]/.test(String(s || ''));
}

function parseTagToken(token) {
  const t = normalize(token);
  if (!t) {
    return null;
  }
  const m = t.match(/^(.+?)[(（]([^)）]+)[)）]$/);
  if (m) {
    const label = normalize(m[1]);
    const reading = normalize(m[2]);
    return {
      key: label,
      label,
      reading,
      foldedLabel: kanaFold(label),
      foldedReading: kanaFold(reading),
    };
  }
  return {
    key: t,
    label: t,
    reading: '',
    foldedLabel: kanaFold(t),
    foldedReading: '',
  };
}

function estimateReadingByParts(label) {
  const s = normalize(label);
  if (!s) {
    return '';
  }
  if (FALLBACK_TAG_READINGS[s]) {
    return FALLBACK_TAG_READINGS[s];
  }

  const keys = Object.keys(COMMON_READING_PARTS).sort((a, b) => b.length - a.length);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const code = ch.charCodeAt(0);
    // keep kana/latin/numbers as-is
    if ((code >= 0x3040 && code <= 0x30ff) || /[a-z0-9]/i.test(ch)) {
      out += toHiragana(ch);
      i += 1;
      continue;
    }
    let matched = false;
    for (const k of keys) {
      if (s.startsWith(k, i)) {
        out += COMMON_READING_PARTS[k];
        i += k.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // unknown kanji block: give up so wrong reading is not added
      return '';
    }
  }
  return out;
}

function getTokenReading(token) {
  if (!token) {
    return '';
  }
  const yomi = normalize(token.reading || token.pronunciation || '');
  if (!yomi || yomi === '*') {
    return '';
  }
  return toHiragana(yomi);
}

function buildReadingWithTokenizer(text) {
  if (!tokenizer || !text) {
    return '';
  }
  const tokens = tokenizer.tokenize(text);
  if (!tokens || tokens.length === 0) {
    return '';
  }
  return toHiragana(tokens.map((t) => getTokenReading(t) || normalize(t.surface_form || '')).join(''));
}

async function ensureTokenizer() {
  if (tokenizer) {
    return tokenizer;
  }
  if (tokenizerPromise) {
    return tokenizerPromise;
  }
  if (!window.kuromoji || !window.kuromoji.builder) {
    return null;
  }
  tokenizerPromise = new Promise((resolve) => {
    window.kuromoji.builder({ dictPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/' }).build((err, built) => {
      if (err || !built) {
        resolve(null);
        return;
      }
      tokenizer = built;
      resolve(tokenizer);
    });
  });
  return tokenizerPromise;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') {
        i += 1;
      }
      row.push(cell);
      if (row.some((x) => normalize(x) !== '')) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((x) => normalize(x) !== '')) {
    rows.push(row);
  }
  return rows;
}

function headerIndex(headers, candidates) {
  const map = new Map(headers.map((h, i) => [normalizeHeader(h), i]));
  for (const c of candidates) {
    const idx = map.get(normalizeHeader(c));
    if (idx !== undefined) {
      return idx;
    }
  }
  return -1;
}

function toDataRows(csvRows) {
  if (csvRows.length === 0) {
    return [];
  }
  const headers = csvRows[0].map((x) => normalizeHeader(x));
  const memoIdx = headerIndex(headers, ['メモ', 'memo']);
  const subMemoIdx = headerIndex(headers, ['サブメモ', 'submemo']);
  const freqIdx = headerIndex(headers, ['頻度', 'freq', 'frequency']);
  const tagsIdx = headerIndex(headers, ['タグ', 'tag', 'tags']);
  const iMemo = memoIdx >= 0 ? memoIdx : 0;
  const iSubMemo = subMemoIdx >= 0 ? subMemoIdx : 1;
  const iFreq = freqIdx >= 0 ? freqIdx : 2;
  const iTags = tagsIdx >= 0 ? tagsIdx : 3;

  return csvRows
    .slice(1)
    .map((r) => {
      const memo = normalize(r[iMemo] || '');
      const subMemo = normalize(r[iSubMemo] || '');
      const freqRaw = normalize(r[iFreq] || '');
      const freq = /^[1-5]$/.test(freqRaw) ? Number(freqRaw) : null;
      const tags = normalize(r[iTags] || '')
        .split(/[,\u3001]/)
        .map((x) => parseTagToken(x))
        .filter(Boolean);
      return { memo, subMemo, freq, tags };
    })
    .filter((r) => r.memo);
}

async function enrichTagReadings(rows) {
  // 先に既知タグは即時フォールバックを入れる。
  for (const row of rows) {
    for (const tag of row.tags) {
      if (tag.reading) {
        continue;
      }
      const fallback = estimateReadingByParts(tag.label);
      if (fallback) {
        tag.reading = fallback;
        tag.foldedReading = kanaFold(fallback);
      }
    }
  }

  const tk = await ensureTokenizer();
  if (!tk) {
    return;
  }
  for (const row of rows) {
    for (const tag of row.tags) {
      if (tag.reading || !containsKanji(tag.label)) {
        continue;
      }
      const reading = buildReadingWithTokenizer(tag.label);
      if (!reading) {
        continue;
      }
      tag.reading = reading;
      tag.foldedReading = kanaFold(reading);
    }
  }
}

function buildTagIndex(rows) {
  const map = new Map();
  for (const row of rows) {
    for (const tag of row.tags) {
      if (!map.has(tag.key)) {
        map.set(tag.key, tag);
      }
    }
  }
  state.allTags = [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}

function splitSubMemoLines(text) {
  const raw = normalize(text);
  if (!raw) {
    return [];
  }
  return raw.split(/(?:\\\\|¥¥|￥￥)/).map((x) => normalize(x)).filter(Boolean);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function freqStars(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) {
    return '-';
  }
  return '★'.repeat(Math.max(1, Math.min(5, Math.round(v))));
}

function renderFreqChips() {
  const selected = normalize(freqValueEl.value);
  freqChipsEl.innerHTML = '';
  for (const c of FREQ_CHOICES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `freq-chip ${selected === c.value ? 'active' : ''}`;
    btn.dataset.value = c.value;
    btn.textContent = c.label;
    btn.addEventListener('click', () => {
      freqValueEl.value = c.value;
      renderFreqChips();
      if (state.hasSearched) {
        render();
      }
    });
    freqChipsEl.appendChild(btn);
  }
}

function findExactTagFromInput() {
  const qFold = kanaFold(tagInputEl.value);
  if (!qFold) {
    return '';
  }
  const exact = state.allTags.find((t) => t.foldedLabel === qFold || t.foldedReading === qFold);
  return exact ? exact.key : '';
}

function filteredRows() {
  const selectedFreq = normalize(freqValueEl.value);
  const selectedTag = normalize(state.selectedTagKey);
  const queryFold = kanaFold(tagInputEl.value);

  return state.rows.filter((r) => {
    if (selectedFreq && r.freq !== Number(selectedFreq)) {
      return false;
    }
    if (selectedTag) {
      const rowTags = new Set(r.tags.map((t) => t.key));
      return rowTags.has(selectedTag);
    }
    if (queryFold) {
      return r.tags.some((t) => t.foldedLabel.startsWith(queryFold)
        || t.foldedReading.startsWith(queryFold)
        || t.foldedLabel.includes(queryFold)
        || t.foldedReading.includes(queryFold));
    }
    return true;
  });
}

function renderTagSuggestions() {
  const qFold = kanaFold(tagInputEl.value);
  if (!qFold) {
    tagSuggestEl.innerHTML = '';
    tagSuggestEl.classList.remove('open');
    return;
  }

  const candidates = state.allTags
    .filter((t) => t.foldedLabel.startsWith(qFold)
      || t.foldedReading.startsWith(qFold)
      || t.foldedLabel.includes(qFold)
      || t.foldedReading.includes(qFold))
    .slice(0, 12);

  if (candidates.length === 0) {
    tagSuggestEl.innerHTML = '';
    tagSuggestEl.classList.remove('open');
    return;
  }

  tagSuggestEl.innerHTML = candidates
    .map((t) => `<button type="button" class="tag-option" data-tag="${escapeHtml(t.key)}">${escapeHtml(t.label)}</button>`)
    .join('');
  tagSuggestEl.classList.add('open');

  tagSuggestEl.querySelectorAll('.tag-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = normalize(btn.getAttribute('data-tag'));
      const tag = state.allTags.find((t) => t.key === key);
      state.selectedTagKey = key;
      tagInputEl.value = tag ? tag.label : key;
      tagSuggestEl.innerHTML = '';
      tagSuggestEl.classList.remove('open');
      if (state.hasSearched) {
        render();
      }
    });
  });
}

function render() {
  if (!state.hasSearched) {
    statusEl.textContent = '条件を指定して検索してください。';
    cardsEl.innerHTML = '';
    return;
  }

  const rows = filteredRows();
  statusEl.textContent = `${rows.length}件ヒット`;
  if (rows.length === 0) {
    cardsEl.innerHTML = '<div>ヒットなし</div>';
    return;
  }

  cardsEl.innerHTML = rows.map((r) => {
    const subLines = splitSubMemoLines(r.subMemo);
    const subMemoHtml = subLines.length <= 1
      ? (subLines[0] ? `<div class="submemo">${escapeHtml(subLines[0])}</div>` : '')
      : `<ul class="submemo-list">${subLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
    const tagsHtml = r.tags.length === 0
      ? '<span class="tag-btn empty">タグなし</span>'
      : r.tags.map((t) => `<button type="button" class="tag-btn" data-tag="${escapeHtml(t.key)}">${escapeHtml(t.label)}</button>`).join('');
    return `
      <article class="card">
        <span class="badge freq-corner">${escapeHtml(freqStars(r.freq))}</span>
        <div class="memo">${escapeHtml(r.memo)}</div>
        ${subMemoHtml}
        <div class="badges"><div class="tag-list">${tagsHtml}</div></div>
      </article>
    `;
  }).join('');

  cardsEl.querySelectorAll('.tag-btn[data-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = normalize(btn.getAttribute('data-tag'));
      if (!key) {
        return;
      }
      const tag = state.allTags.find((t) => t.key === key);
      state.selectedTagKey = key;
      tagInputEl.value = tag ? tag.label : key;
      state.hasSearched = true;
      render();
    });
  });
}

async function loadSheet() {
  statusEl.textContent = '読み込み中...';
  cardsEl.innerHTML = '';
  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) {
    throw new Error('シートを取得できませんでした。共有設定を確認してください。');
  }
  const csvText = await res.text();
  state.rows = toDataRows(parseCsv(csvText));
  await enrichTagReadings(state.rows);
  buildTagIndex(state.rows);
  statusEl.textContent = '条件を指定して検索してください。';
}

function init() {
  if (!hasCoreUi()) {
    console.warn('ZEUS: required DOM elements are missing.');
    return;
  }

  renderFreqChips();

  tagInputEl.addEventListener('input', () => {
    state.selectedTagKey = '';
    renderTagSuggestions();
  });
  tagInputEl.addEventListener('focus', () => {
    renderTagSuggestions();
  });
  tagInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      state.selectedTagKey = findExactTagFromInput();
      tagSuggestEl.innerHTML = '';
      tagSuggestEl.classList.remove('open');
      state.hasSearched = true;
      render();
    }
  });

  searchBtn.addEventListener('click', () => {
    state.selectedTagKey = findExactTagFromInput();
    tagSuggestEl.innerHTML = '';
    tagSuggestEl.classList.remove('open');
    state.hasSearched = true;
    render();
  });

  document.addEventListener('click', (e) => {
    if (e.target === tagInputEl || tagSuggestEl.contains(e.target)) {
      return;
    }
    tagSuggestEl.classList.remove('open');
  });

  loadSheet().catch((err) => {
    statusEl.textContent = err.message || String(err);
  });
}

setupSimpleAuth(init);
