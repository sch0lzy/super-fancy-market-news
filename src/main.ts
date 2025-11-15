// Entry point for Super Fancy Market News (Vite + TypeScript)
// Full app behavior from the original HTML file will be migrated here in the next step.

console.log('Super Fancy Market News (Vite + TS) loaded');

// Summarizer Worker endpoint (same as original HTML app)
const SUMMARIZER_URL = 'https://summarizev3.451jscholz.workers.dev/summarize';
const TRENDING_URL = 'https://summarizev3.451jscholz.workers.dev/reddit-trending';

// Basic security guard: redirect to HTTPS in production and try to avoid hostile iframes
if (typeof window !== 'undefined') {
  const { protocol, hostname } = window.location;
  if (
    protocol === 'http:' &&
    hostname !== 'localhost' &&
    !hostname.startsWith('127.')
  ) {
    const { host, pathname, search, hash } = window.location;
    window.location.replace(`https://${host}${pathname}${search}${hash}`);
  }

  if (window.top && window.top !== window.self) {
    try {
      window.top.location.href = window.location.href;
    } catch {
      // Ignore if we can't break out
    }
  }
}

// Simple banner behavior when opened from file:// (mirrors original app)
if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
  const banner = document.getElementById('banner');
  if (banner) {
    banner.style.display = 'block';
    banner.textContent = 'Opened locally (for best experience, run via Vite dev server over http://localhost)';
  }
}

// Minimal Finnhub key storage wiring (step 1)
const keyInput = document.getElementById('keyFinnhub') as HTMLInputElement | null;
const saveButton = document.getElementById('btnSave') as HTMLButtonElement | null;
const pillKey = document.getElementById('pillKey') as HTMLSpanElement | null;

function setKeyPill(text: string, ok: boolean) {
  if (!pillKey) return;
  pillKey.textContent = text;
  pillKey.classList.remove('ok', 'err');
  pillKey.classList.add(ok ? 'ok' : 'err');
}

if (keyInput) {
  const stored = localStorage.getItem('sns_finnhub_key') || '';
  keyInput.value = stored;
  setKeyPill(stored ? 'Saved' : 'Not saved', !!stored);
}

if (saveButton && keyInput) {
  saveButton.addEventListener('click', () => {
    const v = keyInput.value.trim();
    localStorage.setItem('sns_finnhub_key', v);
    setKeyPill(v ? 'Saved' : 'Not saved', !!v);
  });
}

// ================== Helpers for search / UI ==================
function setStatus(message: string) {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = message;
}

function setCount(n: number) {
  const countEl = document.getElementById('count');
  if (countEl) countEl.textContent = n ? `${n} article${n === 1 ? '' : 's'}` : '';
}

function isTicker(q: string): boolean {
  return /^[A-Z.\-]{1,7}$/.test(String(q || '').trim());
}

function niceTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function appendLog(msg: string, cls = '') {
  const logEl = document.getElementById('log');
  if (!logEl) return;
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = msg;
  logEl.appendChild(div);
}

function clearLog() {
  const logEl = document.getElementById('log');
  if (logEl) logEl.innerHTML = '';
}

// ================== Summary text helpers ==================
function decodeEntities(str: unknown): string {
  const txt = document.createElement('textarea');
  txt.innerHTML = (str ?? '').toString();
  return txt.value;
}

function cleanText(raw: unknown): string {
  if (!raw) return '';
  let s = String(raw).trim();
  // Strip ```json fences if present
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  // Try to pull .summary from JSON if the worker wrapped it
  try {
    const maybe = JSON.parse(s) as any;
    if (maybe && typeof maybe === 'object' && (maybe.summary || maybe.Summary)) {
      s = String(maybe.summary || maybe.Summary || '');
    }
  } catch {
    // ignore JSON parse errors
  }
  // Strip leading/trailing quotes
  s = s.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
  return decodeEntities(s);
}

function cleanBullet(b: unknown): string {
  let s = cleanText(b);
  s = s.replace(/^\s*[-•]\s*/, '').trim();
  return s;
}

function coerceBullets(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(cleanBullet).filter(Boolean);
  if (typeof raw === 'string') {
    return cleanText(raw)
      .split(/\r?\n+/)
      .map((x) => x.replace(/^\s*[-•]\s*/, '').trim())
      .filter(Boolean);
  }
  if (typeof raw === 'object') {
    const anyRaw = raw as any;
    if (Array.isArray(anyRaw.bullets)) return anyRaw.bullets.map(cleanBullet).filter(Boolean);
    const vals = Object.values(anyRaw).filter((v) => typeof v === 'string');
    if (vals.length) return vals.map(cleanBullet).filter(Boolean);
  }
  return [];
}

// ================== Types & rendering for news ==================
interface NewsItem {
  title: string;
  url: string;
  source: string;
  description: string;
  publishedAt: string;
}

function dedupeNews(items: NewsItem[], mode: 'url' | 'title' | 'off'): NewsItem[] {
  if (mode === 'off') return items;
  const out: NewsItem[] = [];
  const seen = new Set<string>();

  for (const it of items) {
    let key: string;
    if (mode === 'url' && it.url) {
      try {
        const u = new URL(it.url);
        key = `${u.origin}${u.pathname}`;
      } catch {
        key = it.url;
      }
    } else {
      key = `${it.title}|${it.source}`;
    }
    if (!seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

function renderNews(items: NewsItem[]) {
  const results = document.getElementById('results');
  if (!results) return;

  results.innerHTML = '';
  if (!items.length) {
    const div = document.createElement('div');
    div.className = 'item';
    div.textContent = 'No articles found.';
    results.appendChild(div);
    setCount(0);
    return;
  }

  const sortSelect = document.getElementById('sort') as HTMLSelectElement | null;
  const sorted = [...items];
  const sortMode = sortSelect?.value || 'relevance';

  if (sortMode === 'time') {
    sorted.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }

  for (const it of sorted) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'item';

    const meta = document.createElement('div');
    const datePill = document.createElement('span');
    datePill.className = 'pill';
    datePill.textContent = niceTime(it.publishedAt);
    const sourcePill = document.createElement('span');
    sourcePill.className = 'pill';
    sourcePill.textContent = it.source || 'News';

    meta.appendChild(datePill);
    meta.appendChild(sourcePill);

    const titleDiv = document.createElement('div');
    const link = document.createElement('a');
    link.href = it.url || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = it.title || '(no title)';
    titleDiv.appendChild(link);

    itemDiv.appendChild(meta);
    itemDiv.appendChild(titleDiv);

    if (it.description) {
      const desc = document.createElement('div');
      desc.style.color = '#94a3b8';
      desc.style.marginTop = '6px';
      desc.textContent = it.description;
      itemDiv.appendChild(desc);
    }

    // Summary container + button
    const summaryBox = document.createElement('div');
    summaryBox.className = 'summary-box';
    const summaryButton = document.createElement('button');
    summaryButton.className = 'ghost';
    summaryButton.style.marginTop = '8px';
    summaryButton.textContent = 'Summarize';
    summaryButton.addEventListener('click', () => {
      void summarizeItem(it, summaryBox, summaryButton);
    });

    const summaryRow = document.createElement('div');
    summaryRow.appendChild(summaryButton);
    itemDiv.appendChild(summaryRow);
    itemDiv.appendChild(summaryBox);

    results.appendChild(itemDiv);
  }

  setCount(items.length);
}

// ================== Summarizer Worker integration ==================
async function summarizeItem(item: NewsItem, box: HTMLDivElement, btn: HTMLButtonElement): Promise<void> {
  try {
    btn.disabled = true;
    btn.textContent = 'Summarizing…';
    box.innerHTML = '';

    const payload = {
      url: item.url,
      title: item.title,
      source: item.source || 'News',
      publishedAt: item.publishedAt || '',
      max_words: 120,
      mode: 'auto',
    };

    const resp = await fetch(SUMMARIZER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'cors',
    });

    if (!resp.ok) throw new Error(`Summarizer HTTP ${resp.status}`);
    const json = (await resp.json()) as any;
    if (json.error) throw new Error(json.error);

    const summaryText = cleanText(json.summary ?? json.Summary ?? '');
    const bullets = coerceBullets(json.bullets ?? json.Bullets);

    box.className = 'summary-box';
    const badge = document.createElement('span');
    badge.className = 'pill';
    badge.textContent = json.from === 'full' ? 'From article' : 'From headline';

    const titleEl = document.createElement('div');
    titleEl.className = 'summary-title';
    titleEl.textContent = 'Summary';

    const textEl = document.createElement('div');
    textEl.className = 'summary-text';
    textEl.textContent = summaryText || '(no summary)';

    box.appendChild(badge);
    box.appendChild(titleEl);
    box.appendChild(textEl);

    if (bullets.length) {
      const bulletsTitle = document.createElement('div');
      bulletsTitle.className = 'summary-title';
      bulletsTitle.textContent = 'Key Points';
      const list = document.createElement('ul');
      list.className = 'summary-list';
      bullets.forEach((b) => {
        const li = document.createElement('li');
        li.textContent = b;
        list.appendChild(li);
      });
      box.appendChild(bulletsTitle);
      box.appendChild(list);
    }
  } catch (e: any) {
    box.className = 'summary-box';
    box.textContent = `Summary failed: ${e?.message || String(e)}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Summarize';
  }
}

// ================== Finnhub fetch ==================
function isoRangeFromDaysBack(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

async function fetchFinnhub(symbol: string, key: string, daysBack: number, max: number): Promise<NewsItem[]> {
  if (!isTicker(symbol)) throw new Error('Ticker required, e.g., NVDA');

  const { from, to } = isoRangeFromDaysBack(daysBack);
  const url = new URL('https://finnhub.io/api/v1/company-news');
  url.searchParams.set('symbol', symbol.trim().toUpperCase());
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('token', key);

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Finnhub HTTP ${resp.status}`);

  const json = (await resp.json()) as any[];
  const items: NewsItem[] = (Array.isArray(json) ? json : []).map((a) => ({
    title: a.headline || '(no title)',
    url: a.url || '#',
    source: a.source || 'News',
    description: a.summary || '',
    publishedAt: a.datetime ? new Date(a.datetime * 1000).toISOString() : new Date().toISOString(),
  }));

  return items.slice(0, max);
}

// ================== Search wiring ==================
const searchButton = document.getElementById('btnStart') as HTMLButtonElement | null;
const cancelButton = document.getElementById('btnCancel') as HTMLButtonElement | null;
const tickerInput = document.getElementById('ticker') as HTMLInputElement | null;

async function startSearch() {
  clearLog();

  const key = (keyInput?.value || '').trim();
  const symbol = (tickerInput?.value || '').trim();
  const daysBackSelect = document.getElementById('daysBack') as HTMLSelectElement | null;
  const maxResultsSelect = document.getElementById('maxResults') as HTMLSelectElement | null;
  const dedupeSelect = document.getElementById('dedupe') as HTMLSelectElement | null;

  const daysBack = parseInt(daysBackSelect?.value || '7', 10);
  const maxResults = parseInt(maxResultsSelect?.value || '100', 10);
  const dedupeMode = (dedupeSelect?.value || 'url') as 'url' | 'title' | 'off';

  if (!key) {
    setStatus('Paste your Finnhub key and click Save.');
    return;
  }
  if (!symbol) {
    setStatus('Type a ticker, e.g., NVDA.');
    return;
  }

  setStatus('Fetching company news…');
  if (searchButton) searchButton.disabled = true;
  if (cancelButton) cancelButton.disabled = true;

  try {
    const items = await fetchFinnhub(symbol, key, daysBack, maxResults);
    const deduped = dedupeNews(items, dedupeMode);
    renderNews(deduped);
    setStatus(deduped.length ? '' : 'No results.');
  } catch (e: any) {
    const message = e?.message || String(e);
    setStatus(message);
    appendLog(`Finnhub: ${message}`, 'errtxt');
  } finally {
    if (searchButton) searchButton.disabled = false;
    if (cancelButton) cancelButton.disabled = true;
  }
}

if (searchButton) {
  searchButton.addEventListener('click', () => {
    void startSearch();
  });
}

if (tickerInput) {
  tickerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      void startSearch();
    }
  });
}

// ================== Reddit Trending ==================
interface TrendingRow {
  rank: number;
  ticker: string;
  name: string;
  mentions: number;
  upvotes: number;
}

function renderTrending(rows: TrendingRow[]): void {
  const host = document.getElementById('trendList');
  if (!host) return;

  host.innerHTML = '';
  if (!rows.length) {
    host.textContent = 'No trending tickers found.';
    return;
  }

  const header = document.createElement('div');
  header.className = 'trend-grid trend-header';
  const hRank = document.createElement('div');
  hRank.textContent = '#';
  const hTicker = document.createElement('div');
  hTicker.textContent = 'Ticker';
  const hName = document.createElement('div');
  hName.textContent = 'Name';
  const hMentions = document.createElement('div');
  hMentions.textContent = 'Mentions';
  const hUpvotes = document.createElement('div');
  hUpvotes.textContent = 'Upvotes';
  const hAction = document.createElement('div');
  hAction.textContent = 'Action';

  header.append(hRank, hTicker, hName, hMentions, hUpvotes, hAction);
  host.appendChild(header);

  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'trend-row';

    const cRank = document.createElement('div');
    cRank.textContent = String(r.rank ?? '');
    const cTicker = document.createElement('div');
    cTicker.textContent = r.ticker ?? '';
    const cName = document.createElement('div');
    cName.textContent = r.name ?? '';
    const cMentions = document.createElement('div');
    cMentions.textContent = String(r.mentions ?? '');
    const cUpvotes = document.createElement('div');
    cUpvotes.textContent = String(r.upvotes ?? '');

    const cAction = document.createElement('div');
    cAction.className = 'trend-actions';
    const btn = document.createElement('button');
    btn.className = 'ghost';
    btn.textContent = 'Open News';
    btn.addEventListener('click', () => {
      if (tickerInput) {
        tickerInput.value = (r.ticker || '').toUpperCase();
        void startSearch();
      }
    });
    cAction.appendChild(btn);

    row.append(cRank, cTicker, cName, cMentions, cUpvotes, cAction);
    host.appendChild(row);
  });
}

async function loadTrending(): Promise<void> {
  const filterSelect = document.getElementById('trendFilter') as HTMLSelectElement | null;
  const limitSelect = document.getElementById('trendLimit') as HTMLSelectElement | null;
  const statusEl = document.getElementById('trendStatus');
  const sourceLabel = document.getElementById('trendSourceLabel');
  const spin = document.getElementById('spinTrend');
  const host = document.getElementById('trendList');

  const filter = filterSelect?.value || 'all-stocks';
  const limit = parseInt(limitSelect?.value || '25', 10) || 25;

  if (spin) spin.style.display = 'inline-block';
  if (statusEl) statusEl.textContent = 'Loading Reddit trending…';
  if (host) host.innerHTML = '';

  let source = 'Unknown';

  try {
    // Try Worker first
    try {
      const qs = new URLSearchParams({ filter, limit: String(limit) });
      const url = `${TRENDING_URL}?${qs.toString()}`;
      const r = await fetch(url, { method: 'GET', mode: 'cors' });
      if (r.ok) {
        const data = (await r.json()) as any;
        source = data.note ? '📊 Demo Data (Worker API failed)' : '✅ Reddit';
        if (statusEl) {
          statusEl.textContent = `${data.count} trending tickers • ${new Date(data.asOf).toLocaleString()}`;
        }
        if (sourceLabel) sourceLabel.textContent = source;
        renderTrending((data.results || []) as TrendingRow[]);
        return;
      }
    } catch (workerError: any) {
      console.log('Worker failed:', workerError?.message || workerError);
    }

    // Finnhub fallback
    const key = (keyInput?.value || '').trim();
    if (key) {
      try {
        const r = await fetch(`https://finnhub.io/api/v1/news?category=general&limit=${limit}&token=${key}`);
        if (r.ok) {
          const data = (await r.json()) as any[];
          const tickers: Record<string, TrendingRow> = {};
          (data || []).forEach((article) => {
            const headline = String(article.headline || '');
            const matches = headline.match(/\b[A-Z]{1,5}\b/g) || [];
            matches.forEach((ticker) => {
              if (!tickers[ticker]) {
                tickers[ticker] = {
                  rank: 0,
                  ticker,
                  name: ticker,
                  mentions: 0,
                  upvotes: 0,
                };
              }
              tickers[ticker].mentions += 1;
            });
          });

          const results = Object.values(tickers)
            .sort((a, b) => b.mentions - a.mentions)
            .slice(0, limit)
            .map((item, idx) => ({ ...item, rank: idx + 1 }));

          if (results.length) {
            source = '✅ Real Data (Finnhub API)';
            if (statusEl) {
              statusEl.textContent = `${results.length} trending tickers • ${new Date().toLocaleString()}`;
            }
            if (sourceLabel) sourceLabel.textContent = source;
            renderTrending(results);
            return;
          }
        }
      } catch (e: any) {
        console.log('Finnhub trending failed:', e?.message || e);
      }
    }

    // Demo fallback
    const mockTrending: TrendingRow[] = [
      { rank: 1, ticker: 'NVDA', name: 'NVIDIA Corp', mentions: 1247, upvotes: 3421 },
      { rank: 2, ticker: 'TSLA', name: 'Tesla Inc', mentions: 1089, upvotes: 2983 },
      { rank: 3, ticker: 'MSFT', name: 'Microsoft Corp', mentions: 956, upvotes: 2654 },
      { rank: 4, ticker: 'AAPL', name: 'Apple Inc', mentions: 847, upvotes: 2341 },
      { rank: 5, ticker: 'AMZN', name: 'Amazon.com Inc', mentions: 743, upvotes: 2015 },
    ].slice(0, limit);

    source = '📊 Demo Data (No API available)';
    if (statusEl) {
      statusEl.textContent = `${mockTrending.length} trending tickers • ${new Date().toLocaleString()}`;
    }
    if (sourceLabel) sourceLabel.textContent = source;
    renderTrending(mockTrending);
  } catch (e: any) {
    source = '📊 Demo Data (Error occurred)';
    if (statusEl) {
      statusEl.textContent = `Trending failed: ${e?.message || String(e)}`;
    }
    if (sourceLabel) sourceLabel.textContent = source;
  } finally {
    if (spin) spin.style.display = 'none';
  }
}

const trendingButton = document.getElementById('btnTrending') as HTMLButtonElement | null;
if (trendingButton) {
  trendingButton.addEventListener('click', () => {
    void loadTrending();
  });
}
