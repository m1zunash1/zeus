const SHEET_ID = '1NU7bDfFbkyvyq8qEMARUixSO2jJOhGvljidnwo5Gq2c';
const GID = '0';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;

const minFreq = document.getElementById('minFreq');
const freqView = document.getElementById('freqView');
const searchBtn = document.getElementById('searchBtn');
const tagInputEl = document.getElementById('tagInput');
const tagSuggestEl = document.getElementById('tagSuggest');
const statusEl = document.getElementById('status');
const cardsEl = document.getElementById('cards');

const state = {
  rows: [],
  allTags: [],
  selectedTagKey: '',
  hasSearched: false,
};

let tokenizer = null;
let tokenizerPromise = null;

function hasCoreUi() {
  return Boolean(minFreq && freqView && searchBtn && tagInputEl && tagSuggestEl && statusEl && cardsEl);
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
    window.kuromoji.builder({ dictPath: 'https://unpkg.com/kuromoji@0.1.2/dict/' }).build((err, built) => {
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

function freqStars(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) {
    return '-';
  }
  return '★'.repeat(Math.max(1, Math.min(5, Math.round(v))));
}

function splitSubMemoLines(text) {
  const raw = normalize(text);
  if (!raw) {
    return [];
  }
  return raw
    .split(/(?:\\\\|¥¥|￥￥)/)
    .map((x) => normalize(x))
    .filter(Boolean);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
  const min = Number(minFreq.value);
  const selectedTag = normalize(state.selectedTagKey);
  const queryFold = kanaFold(tagInputEl.value);

  return state.rows.filter((r) => {
    if (r.freq !== null && Number.isFinite(r.freq) && r.freq < min) {
      return false;
    }
    if (selectedTag) {
      const rowTags = new Set(r.tags.map((t) => t.key));
      return rowTags.has(selectedTag);
    }
    if (queryFold) {
      return r.tags.some((t) => t.foldedLabel.startsWith(queryFold) || t.foldedReading.startsWith(queryFold));
    }
    return true;
  });
}

function refreshFreqView() {
  freqView.textContent = freqStars(Number(minFreq.value));
}

function renderTagSuggestions() {
  const qFold = kanaFold(tagInputEl.value);
  if (!qFold) {
    tagSuggestEl.innerHTML = '';
    tagSuggestEl.classList.remove('open');
    return;
  }

  const candidates = state.allTags
    .filter((t) => t.foldedLabel.startsWith(qFold) || t.foldedReading.startsWith(qFold))
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
    statusEl.textContent = '条件を指定して「検索」を押してください。';
    cardsEl.innerHTML = '';
    return;
  }

  const rows = filteredRows();
  statusEl.textContent = `${rows.length}件ヒット`;
  if (rows.length === 0) {
    cardsEl.innerHTML = '<div>ヒットなし</div>';
    return;
  }

  cardsEl.innerHTML = rows
    .map((r) => {
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
        <div class="badges">
          <div class="tag-list">${tagsHtml}</div>
        </div>
      </article>
    `;
    })
    .join('');

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
  statusEl.textContent = '条件を指定して「検索」を押してください。';
}

function init() {
  if (!hasCoreUi()) {
    console.warn('ZEUS: required DOM elements are missing.');
    return;
  }

  const onFilterChange = () => {
    refreshFreqView();
    if (state.hasSearched) {
      render();
    }
  };

  minFreq.addEventListener('change', onFilterChange);
  minFreq.addEventListener('input', onFilterChange);
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

  refreshFreqView();
}

init();
