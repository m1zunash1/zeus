const SHEET_ID = '1NU7bDfFbkyvyq8qEMARUixSO2jJOhGvljidnwo5Gq2c';
const GID = '0';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;

const minFreq = document.getElementById('minFreq');
const maxFreq = document.getElementById('maxFreq');
const searchBtn = document.getElementById('searchBtn');
const tagInputEl = document.getElementById('tagInput');
const tagSuggestEl = document.getElementById('tagSuggest');
const selectedTagsEl = document.getElementById('selectedTags');
const statusEl = document.getElementById('status');
const cardsEl = document.getElementById('cards');

const state = {
  rows: [],
  allTags: [],
  selectedTags: new Set(),
  hasSearched: false,
};

let tokenizerPromise = null;
let tokenizer = null;

function hasCoreUi() {
  return Boolean(minFreq && maxFreq && searchBtn && statusEl && cardsEl && tagInputEl && tagSuggestEl && selectedTagsEl);
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
      label,
      reading,
      key: label,
      foldedLabel: kanaFold(label),
      foldedReading: kanaFold(reading),
    };
  }
  return {
    label: t,
    reading: '',
    key: t,
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
  const subMemoIdx = headerIndex(headers, ['サブメモ', 'submemo', 'sub memo']);
  const freqIdx = headerIndex(headers, ['頻度', 'freq', 'frequency']);
  const tagsIdx = headerIndex(headers, ['タグ', 'tag', 'tags']);

  // ヘッダー名が想定と少し違っても、先頭4列をフォールバックとして使う。
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
      const tagsRaw = normalize(r[iTags] || '');
      const tags = tagsRaw
        .split(/[,\u3001]/)
        .map((x) => parseTagToken(x))
        .filter(Boolean);
      return { memo, subMemo, freq, tags };
    })
    .filter((x) => x.memo);
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

function tagsText(tags) {
  if (!tags || tags.length === 0) {
    return '-';
  }
  return tags.map((x) => x.label).join(' / ');
}

function filteredRows() {
  const min = Number(minFreq.value);
  const max = Number(maxFreq.value);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const selected = [...state.selectedTags];

  return state.rows.filter((r) => {
    if (r.freq !== null && Number.isFinite(r.freq) && (r.freq < lo || r.freq > hi)) {
      return false;
    }
    if (selected.length > 0) {
      const rowTags = new Set(r.tags.map((x) => x.key));
      if (!selected.every((t) => rowTags.has(t))) {
        return false;
      }
    }
    return true;
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderSelectedTags() {
  selectedTagsEl.innerHTML = '';
  if (state.selectedTags.size === 0) {
    selectedTagsEl.innerHTML = '<span class="tag-chip">未選択</span>';
    return;
  }
  for (const key of [...state.selectedTags].sort((a, b) => a.localeCompare(b, 'ja'))) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-chip active';
    btn.textContent = `${key} ×`;
    btn.addEventListener('click', () => {
      state.selectedTags.delete(key);
      renderSelectedTags();
      renderTagSuggestions();
      if (state.hasSearched) {
        render();
      }
    });
    selectedTagsEl.appendChild(btn);
  }
}

function renderTagSuggestions() {
  const qFold = kanaFold(tagInputEl.value);
  const candidates = state.allTags
    .filter((t) => !state.selectedTags.has(t.key))
    .filter((t) => {
      if (!qFold) {
        return true;
      }
      return t.foldedLabel.includes(qFold) || t.foldedReading.includes(qFold);
    })
    .slice(0, 30);

  tagSuggestEl.innerHTML = '';
  if (candidates.length === 0) {
    tagSuggestEl.innerHTML = '<span class="tag-chip">候補なし</span>';
    return;
  }

  for (const t of candidates) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-chip';
    btn.textContent = t.label;
    btn.addEventListener('click', () => {
      state.selectedTags.add(t.key);
      tagInputEl.value = '';
      renderSelectedTags();
      renderTagSuggestions();
      if (state.hasSearched) {
        render();
      }
    });
    tagSuggestEl.appendChild(btn);
  }
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
    .map(
      (r) => `
      <article class="card">
        <div class="memo">${escapeHtml(r.memo)}</div>
        ${r.subMemo ? `<div class="submemo">${escapeHtml(r.subMemo)}</div>` : ''}
        <div class="badges">
          <span class="badge">頻度: ${escapeHtml(freqStars(r.freq))}</span>
          <span class="badge">タグ: ${escapeHtml(tagsText(r.tags))}</span>
        </div>
      </article>
    `
    )
    .join('');
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
  renderSelectedTags();
  renderTagSuggestions();
  statusEl.textContent = '条件を指定して「検索」を押してください。';
}

function init() {
  if (!hasCoreUi()) {
    console.warn('ZEUS: required DOM elements are missing.');
    return;
  }

  const onFilterChange = () => {
    if (state.hasSearched) {
      render();
    }
  };

  minFreq.addEventListener('change', onFilterChange);
  maxFreq.addEventListener('change', onFilterChange);
  tagInputEl.addEventListener('input', renderTagSuggestions);
  tagInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      state.hasSearched = true;
      render();
    }
  });
  searchBtn.addEventListener('click', () => {
    state.hasSearched = true;
    render();
  });

  loadSheet().catch((err) => {
    statusEl.textContent = err.message || String(err);
  });
}

init();
