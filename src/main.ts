import './style.css';

type HealthPayload = {
  status?: string;
  service?: string;
  database?: 'up' | 'down';
  dbLatencyMs?: number | null;
  time?: string;
};

type CheckRow = {
  at: string;
  apiOk: boolean;
  dbOk: boolean;
  http: number;
  latencyMs: number | null;
  dbLatencyMs: number | null;
  error?: string;
};

const API_URL =
  import.meta.env.VITE_API_HEALTH_URL ??
  'https://api-production-8ac1f.up.railway.app/api/v1/health';
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL ?? '';
const POLL_SECONDS = Number(import.meta.env.VITE_POLL_SECONDS ?? 30);
const MAX_HISTORY = 60;

const history: CheckRow[] = [];
let timer: number | undefined;

const els = {
  pollLabel: document.getElementById('poll-label')!,
  refreshBtn: document.getElementById('refresh-btn') as HTMLButtonElement,
  apiStatus: document.getElementById('api-status')!,
  apiDetail: document.getElementById('api-detail')!,
  dbStatus: document.getElementById('db-status')!,
  dbDetail: document.getElementById('db-detail')!,
  latencyStatus: document.getElementById('latency-status')!,
  latencyDetail: document.getElementById('latency-detail')!,
  uptimeStatus: document.getElementById('uptime-status')!,
  uptimeDetail: document.getElementById('uptime-detail')!,
  cardApi: document.getElementById('card-api')!,
  cardDb: document.getElementById('card-db')!,
  historyBody: document.getElementById('history-body')!,
  historyCount: document.getElementById('history-count')!,
  spark: document.getElementById('spark')!,
  targets: document.getElementById('targets')!,
  lastError: document.getElementById('last-error')!,
};

function setCard(card: HTMLElement, state: 'ok' | 'warn' | 'down' | 'idle') {
  card.dataset.state = state;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function uptimePct() {
  if (!history.length) return null;
  const ok = history.filter((h) => h.apiOk && h.dbOk).length;
  return Math.round((ok / history.length) * 100);
}

function renderSpark() {
  els.spark.innerHTML = '';
  const slice = history.slice(0, 24).reverse();
  for (const row of slice) {
    const bar = document.createElement('span');
    bar.className = 'spark-bar';
    bar.dataset.ok = row.apiOk && row.dbOk ? '1' : '0';
    bar.style.height = `${Math.min(100, Math.max(8, (row.latencyMs ?? row.dbLatencyMs ?? 50) / 3))}%`;
    bar.title = `${fmtTime(row.at)} · ${row.latencyMs ?? '—'} ms`;
    els.spark.appendChild(bar);
  }
}

function renderHistory() {
  els.historyBody.innerHTML = history
    .map(
      (row) => `
    <tr class="${row.apiOk && row.dbOk ? 'ok' : 'bad'}">
      <td>${fmtTime(row.at)}</td>
      <td>${row.apiOk ? 'OK' : 'DOWN'}</td>
      <td>${row.dbOk ? 'UP' : 'DOWN'}</td>
      <td>${row.dbLatencyMs ?? row.latencyMs ?? '—'} ms</td>
      <td>${row.http || '—'}</td>
    </tr>`,
    )
    .join('');
  els.historyCount.textContent = `${history.length} checks`;
  renderSpark();
}

function renderSummary(row: CheckRow) {
  const apiOk = row.apiOk;
  const dbOk = row.dbOk;

  els.apiStatus.textContent = apiOk ? 'OK' : 'DOWN';
  els.apiDetail.textContent = apiOk
    ? `HTTP ${row.http} · ${row.latencyMs ?? '—'} ms`
    : row.error ?? 'No response';

  els.dbStatus.textContent = dbOk ? 'UP' : 'DOWN';
  els.dbDetail.textContent = dbOk
    ? `Query ${row.dbLatencyMs ?? '—'} ms`
    : 'Connection failed';

  const lat = row.dbLatencyMs ?? row.latencyMs;
  els.latencyStatus.textContent = lat != null ? `${lat} ms` : '—';
  els.latencyDetail.textContent =
    lat != null && lat < 300
      ? 'Жақсы / Good'
      : lat != null && lat < 800
        ? 'Орташа / Medium'
        : 'Баяу / Slow';

  const up = uptimePct();
  els.uptimeStatus.textContent = up != null ? `${up}%` : '—';
  els.uptimeDetail.textContent =
    history.length > 0
      ? `${history.filter((h) => h.apiOk && h.dbOk).length}/${history.length} OK`
      : '—';

  setCard(els.cardApi, apiOk ? 'ok' : 'down');
  setCard(els.cardDb, dbOk ? 'ok' : dbOk === false && apiOk ? 'warn' : 'down');

  els.lastError.textContent = row.error ?? '';
}

async function runCheck() {
  els.refreshBtn.disabled = true;
  const started = performance.now();
  let row: CheckRow = {
    at: new Date().toISOString(),
    apiOk: false,
    dbOk: false,
    http: 0,
    latencyMs: null,
    dbLatencyMs: null,
  };

  try {
    const res = await fetch(API_URL, { cache: 'no-store' });
    row.http = res.status;
    row.latencyMs = Math.round(performance.now() - started);
    row.apiOk = res.ok;

    if (res.ok) {
      const data = (await res.json()) as HealthPayload;
      row.dbOk = data.database === 'up';
      row.dbLatencyMs =
        typeof data.dbLatencyMs === 'number' ? data.dbLatencyMs : null;
    } else {
      row.error = `HTTP ${res.status}`;
    }
  } catch (err) {
    row.error = err instanceof Error ? err.message : 'Network error';
  }

  history.unshift(row);
  if (history.length > MAX_HISTORY) history.pop();

  renderSummary(row);
  renderHistory();
  els.refreshBtn.disabled = false;
}

function boot() {
  els.targets.textContent = [
    `API: ${API_URL}`,
    FRONTEND_URL ? `App: ${FRONTEND_URL}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  els.pollLabel.textContent = `Әр ${POLL_SECONDS} сек / every ${POLL_SECONDS}s`;

  void runCheck();
  timer = window.setInterval(() => void runCheck(), POLL_SECONDS * 1000);
  els.refreshBtn.addEventListener('click', () => void runCheck());
}

boot();

window.addEventListener('beforeunload', () => {
  if (timer) window.clearInterval(timer);
});
