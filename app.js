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
  imageCache: new Map(),
  hasSearched: false,
};

let tokenizerPromise = null;
let tokenizer = null;

function hasTagUi() {
  return Boolean(tagInputEl && tagSuggestEl && selectedTagsEl);
}

function hasCoreUi() {
  return Boolean(minFreq && maxFreq && searchBtn && statusEl && cardsEl);
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
  const folded = kanaFold(t);
  return {
    label: t,
    reading: '',
    key: t,
    foldedLabel: folded,
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
  const reading = tokens.map((t) => getTokenReading(t) || normalize(t.surface_form || '')).join('');
  return toHiragana(reading);
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

async function enrichTagReadings(rows) {
  const tk = await ensureTokenizer();
  if (!tk) {
    return;
  }
  for (const row of rows) {
    for (const tag of row.tags || []) {
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
      if (row.some((x) => String(x).trim() !== '')) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  if (row.some((x) => String(x).trim() !== '')) {
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
  const srcIdx = headerIndex(headers, ['出典url', '出典', 'source', 'url']);
  const ansIdx = headerIndex(headers, ['答え', 'answer']);
  const freqIdx = headerIndex(headers, ['頻度', 'freq', 'frequency']);
  const tagsIdx = headerIndex(headers, ['タグ', 'tags', 'tag']);
  const imgIdx = headerIndex(headers, ['画像url', '画像', 'image', 'imageurl', 'img']);

  return csvRows.slice(1).map((r) => {
    const sourceUrl = normalize(r[srcIdx] || '');
    const answer = normalize(r[ansIdx] || '');
    const freq = Number(normalize(r[freqIdx] || ''));
    const tagsRaw = normalize(r[tagsIdx] || '');
    const tags = tagsRaw
      .split(/[,\u3001]/)
      .map((x) => parseTagToken(x))
      .filter(Boolean);
    const imageUrl = normalize(r[imgIdx] || '');
    return { sourceUrl, answer, freq, tags, imageUrl };
  }).filter((x) => x.answer);
}

async function fetchImageFromSourceUrl(sourceUrl) {
  if (!sourceUrl) {
    return '';
  }
  if (state.imageCache.has(sourceUrl)) {
    return state.imageCache.get(sourceUrl);
  }

  try {
    const endpoint = `https://noembed.com/embed?url=${encodeURIComponent(sourceUrl)}`;
    const res = await fetch(endpoint);
    if (!res.ok) {
      state.imageCache.set(sourceUrl, '');
      return '';
    }
    const data = await res.json();
    const thumb = normalize(data.thumbnail_url || '');
    state.imageCache.set(sourceUrl, thumb);
    return thumb;
  } catch (_) {
    state.imageCache.set(sourceUrl, '');
    return '';
  }
}

async function enrichImages(rows) {
  const need = rows.filter((r) => !r.imageUrl && r.sourceUrl);
  const concurrency = 4;
  let index = 0;

  async function worker() {
    while (index < need.length) {
      const i = index;
      index += 1;
      const row = need[i];
      const img = await fetchImageFromSourceUrl(row.sourceUrl);
      if (img) {
        row.imageUrl = img;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
}

function buildTagIndex(rows) {
  const map = new Map();
  for (const row of rows) {
    for (const t of row.tags || []) {
      if (!map.has(t.key)) {
        map.set(t.key, t);
      }
    }
  }
  state.allTags = [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}

function renderSelectedTags() {
  if (!hasTagUi()) {
    return;
  }
  selectedTagsEl.innerHTML = '';
  if (state.selectedTags.size === 0) {
    selectedTagsEl.innerHTML = '<span class="tag-chip">未選択</span>';
    return;
  }
  for (const t of [...state.selectedTags].sort((a, b) => a.localeCompare(b, 'ja'))) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-chip active';
    btn.textContent = `${t} ×`;
    btn.addEventListener('click', () => {
      state.selectedTags.delete(t);
      renderSelectedTags();
      renderTagSuggestions();
      render();
    });
    selectedTagsEl.appendChild(btn);
  }
}

function renderTagSuggestions() {
  if (!hasTagUi()) {
    return;
  }
  const qFold = kanaFold(tagInputEl.value);
  const candidates = state.allTags
    .filter((t) => !state.selectedTags.has(t.key))
    .filter((t) => {
      if (!qFold) {
        return true;
      }
      return t.foldedLabel.includes(qFold) || (t.foldedReading && t.foldedReading.includes(qFold));
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
    btn.textContent = t.reading ? `${t.label} (${t.reading})` : t.label;
    btn.addEventListener('click', () => {
      state.selectedTags.add(t.key);
      tagInputEl.value = '';
      renderSelectedTags();
      renderTagSuggestions();
      render();
    });
    tagSuggestEl.appendChild(btn);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function filteredRows() {
  const min = Number(minFreq.value);
  const max = Number(maxFreq.value);
  const selectedTags = [...state.selectedTags];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);

  return state.rows.filter((r) => {
    if (Number.isFinite(r.freq) && (r.freq < lo || r.freq > hi)) {
      return false;
    }
    if (selectedTags.length > 0) {
      const rowTags = new Set((r.tags || []).map((t) => t.key));
      const allMatched = selectedTags.every((t) => rowTags.has(t));
      if (!allMatched) {
        return false;
      }
    }
    return true;
  });
}

function tagsText(tags) {
  if (!tags || tags.length === 0) {
    return '-';
  }
  return tags.map((t) => t.label).join(' / ');
}

function freqStars(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) {
    return '-';
  }
  const c = Math.max(1, Math.min(5, Math.round(v)));
  return '★'.repeat(c);
}

function normalizeImageUrl(rawUrl) {
  const url = normalize(rawUrl);
  if (!url) {
    return '';
  }
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  return url;
}

function twitterAltImageUrl(rawUrl) {
  try {
    const u = new URL(normalizeImageUrl(rawUrl));
    if (u.hostname !== 'pbs.twimg.com') {
      return '';
    }
    if (!u.pathname.startsWith('/media/')) {
      return '';
    }

    // Handle URLs like /media/xxxx?format=png&name=medium
    const last = u.pathname.split('/').pop() || '';
    if (last.includes('.')) {
      return '';
    }
    const format = u.searchParams.get('format');
    if (!format) {
      return '';
    }
    const name = u.searchParams.get('name');
    const alt = `${u.origin}${u.pathname}.${format}${name ? `?name=${encodeURIComponent(name)}` : ''}`;
    return alt;
  } catch (_) {
    return '';
  }
}

function render() {
  if (!hasCoreUi()) {
    return;
  }
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

  cardsEl.innerHTML = rows.map((r) => {
    const imageUrl = normalizeImageUrl(r.imageUrl);
    const altUrl = twitterAltImageUrl(imageUrl);
    const img = imageUrl
      ? `<img class="thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(r.answer)}" loading="lazy" referrerpolicy="no-referrer" data-alt="${escapeHtml(altUrl)}" onerror="if(this.dataset.alt&&this.src!==this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt='';}else{this.style.display='none';}" />`
      : '<div class="thumb"></div>';

    return `
      <article class="card">
        ${img}
        <div class="meta">
          <div class="ans">${escapeHtml(r.answer)}</div>
          <div class="badges">
            <span class="badge">頻度: ${escapeHtml(freqStars(r.freq))}</span>
            <span class="badge">タグ: ${escapeHtml(tagsText(r.tags))}</span>
          </div>
          ${r.sourceUrl ? `<a class="src" href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">出典（X）を見る</a>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

async function loadSheet() {
  if (!hasCoreUi()) {
    return;
  }
  statusEl.textContent = '読み込み中...';
  cardsEl.innerHTML = '';

  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) {
    throw new Error('シートを取得できませんでした。共有設定を確認してください。');
  }
  const text = await res.text();
  const csvRows = parseCsv(text);
  state.rows = toDataRows(csvRows);
  await enrichTagReadings(state.rows);
  buildTagIndex(state.rows);
  renderSelectedTags();
  renderTagSuggestions();
  render();
  statusEl.textContent = '条件を指定して「検索」を押してください。';
  await enrichImages(state.rows);
  if (state.hasSearched) {
    render();
  }
}

function init() {
  if (!hasCoreUi()) {
    console.warn('ZEUS: required DOM elements are missing. Check deployed index.html and app.js pair.');
    return;
  }
  const update = () => {
    if (state.hasSearched) {
      render();
    }
  };
  minFreq.addEventListener('change', update);
  maxFreq.addEventListener('change', update);
  searchBtn.addEventListener('click', () => {
    state.hasSearched = true;
    render();
  });
  if (tagInputEl) {
    tagInputEl.addEventListener('input', () => {
      renderTagSuggestions();
    });
    tagInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        state.hasSearched = true;
        render();
      }
    });
  }

  loadSheet().catch((err) => {
    statusEl.textContent = err.message || String(err);
  });
}

init();
