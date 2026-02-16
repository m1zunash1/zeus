const SHEET_ID = '1NU7bDfFbkyvyq8qEMARUixSO2jJOhGvljidnwo5Gq2c';
const GID = '0';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;

const qInput = document.getElementById('qInput');
const minFreq = document.getElementById('minFreq');
const maxFreq = document.getElementById('maxFreq');
const tagFiltersEl = document.getElementById('tagFilters');
const statusEl = document.getElementById('status');
const cardsEl = document.getElementById('cards');

const state = {
  rows: [],
  allTags: [],
  selectedTags: new Set(),
  imageCache: new Map(),
};

function normalize(s) {
  return String(s || '').normalize('NFKC').trim();
}

function normalizeHeader(s) {
  return normalize(s).toLowerCase();
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
      .map((x) => normalize(x))
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

function buildTagFilters(rows) {
  state.allTags = [...new Set(rows.flatMap((x) => x.tags || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
  tagFiltersEl.innerHTML = '';
  for (const t of state.allTags) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-chip';
    btn.dataset.tag = t;
    btn.textContent = t;
    btn.addEventListener('click', () => {
      if (state.selectedTags.has(t)) {
        state.selectedTags.delete(t);
      } else {
        state.selectedTags.add(t);
      }
      btn.classList.toggle('active', state.selectedTags.has(t));
      render();
    });
    tagFiltersEl.appendChild(btn);
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
  const q = normalize(qInput.value).toLowerCase();
  const min = Number(minFreq.value);
  const max = Number(maxFreq.value);
  const selectedTags = [...state.selectedTags];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);

  return state.rows.filter((r) => {
    if (q && !r.answer.toLowerCase().includes(q)) {
      return false;
    }
    if (Number.isFinite(r.freq) && (r.freq < lo || r.freq > hi)) {
      return false;
    }
    if (selectedTags.length > 0) {
      const rowTags = new Set(r.tags || []);
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
  return tags.join(' / ');
}

function render() {
  const rows = filteredRows();
  statusEl.textContent = `${rows.length}件`;
  if (rows.length === 0) {
    cardsEl.innerHTML = '<div>ヒットなし</div>';
    return;
  }

  cardsEl.innerHTML = rows.map((r) => {
    const img = r.imageUrl
      ? `<img class="thumb" src="${escapeHtml(r.imageUrl)}" alt="${escapeHtml(r.answer)}" loading="lazy" />`
      : '<div class="thumb"></div>';

    return `
      <article class="card">
        ${img}
        <div class="meta">
          <div class="ans">${escapeHtml(r.answer)}</div>
          <div class="badges">
            <span class="badge">頻度: ${Number.isFinite(r.freq) ? r.freq : '-'}</span>
            <span class="badge">タグ: ${escapeHtml(tagsText(r.tags))}</span>
          </div>
          ${r.sourceUrl ? `<a class="src" href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">出典（X）を見る</a>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

async function loadSheet() {
  statusEl.textContent = '読み込み中...';
  cardsEl.innerHTML = '';

  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) {
    throw new Error('シートを取得できませんでした。共有設定を確認してください。');
  }
  const text = await res.text();
  const csvRows = parseCsv(text);
  state.rows = toDataRows(csvRows);
  buildTagFilters(state.rows);
  render();
  statusEl.textContent = `${state.rows.length}件（画像取得中...）`;
  await enrichImages(state.rows);
  render();
}

function init() {
  const update = () => render();
  qInput.addEventListener('input', update);
  minFreq.addEventListener('change', update);
  maxFreq.addEventListener('change', update);

  loadSheet().catch((err) => {
    statusEl.textContent = err.message || String(err);
  });
}

init();
