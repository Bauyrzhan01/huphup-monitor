import './style.css';
import {
  avg,
  drawBarChart,
  drawDonut,
  drawLineChart,
  drawStatusTimeline,
  minMax,
} from './charts';

type HealthPayload = {
  status?: string;
  service?: string;
  database?: 'up' | 'down';
  dbLatencyMs?: number | null;
  time?: string;
  uptimeSec?: number;
  memoryMb?: number;
  nodeVersion?: string;
};

type CheckRow = {
  at: string;
  apiOk: boolean;
  dbOk: boolean;
  frontendOk: boolean | null;
  http: number;
  latencyMs: number | null;
  dbLatencyMs: number | null;
  health?: HealthPayload;
  error?: string;
};

const API_URL =
  import.meta.env.VITE_API_HEALTH_URL ??
  'https://api-production-8ac1f.up.railway.app/api/v1/health';
const FRONTEND_URL =
  import.meta.env.VITE_FRONTEND_URL ?? 'https://huphup-frontend.vercel.app';
const POLL_SECONDS = Number(import.meta.env.VITE_POLL_SECONDS ?? 30);
const MAX_HISTORY = 120;

const history: CheckRow[] = [];
let timer: number | undefined;
let lastHealth: HealthPayload | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  pollLabel: $('poll-label'),
  refreshBtn: $('refresh-btn') as HTMLButtonElement,
  overallBadge: $('overall-badge'),
  lastCheck: $('last-check'),
  sideStatus: $('side-status'),
  apiStatus: $('api-status'),
  apiDetail: $('api-detail'),
  dbStatus: $('db-status'),
  dbDetail: $('db-detail'),
  frontendStatus: $('frontend-status'),
  frontendDetail: $('frontend-detail'),
  uptimeStatus: $('uptime-status'),
  uptimeDetail: $('uptime-detail'),
  statApi: $('stat-api'),
  statDb: $('stat-db'),
  statFrontend: $('stat-frontend'),
  statUptime: $('stat-uptime'),
  historyBody: $('history-body'),
  historyCount: $('history-count'),
  lastError: $('last-error'),
  infoService: $('info-service'),
  infoTime: $('info-time'),
  infoUptime: $('info-uptime'),
  infoMemory: $('info-memory'),
  infoNode: $('info-node'),
  infoOverall: $('info-overall'),
  statApiAvg: $('stat-api-avg'),
  statApiRange: $('stat-api-range'),
  statDbAvg: $('stat-db-avg'),
  statDbRange: $('stat-db-range'),
  donutPct: $('donut-pct'),
  legOk: $('leg-ok'),
  legFail: $('leg-fail'),
  epApi: $('ep-api'),
  epFrontend: $('ep-frontend'),
  epPoll: $('ep-poll'),
  epHistory: $('ep-history'),
  epSwagger: $('ep-swagger'),
  chartLatency: $('chart-latency') as HTMLCanvasElement,
  chartStatus: $('chart-status') as HTMLCanvasElement,
  chartDonut: $('chart-donut') as HTMLCanvasElement,
  chartHistoryBar: $('chart-history-bar') as HTMLCanvasElement,
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function fmtShort(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtUptime(sec?: number) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}ч ${m}м` : `${m}м ${sec % 60}с`;
}

function setStat(el: HTMLElement, state: 'ok' | 'warn' | 'down') {
  el.dataset.state = state;
}

function uptimePct() {
  if (!history.length) return null;
  const ok = history.filter((h) => h.apiOk && h.dbOk).length;
  return Math.round((ok / history.length) * 100);
}

function overallOk(row: CheckRow) {
  return row.apiOk && row.dbOk && row.frontendOk !== false;
}

function renderCharts() {
  const chronological = [...history].reverse();
  const labels = chronological.map((r) => fmtShort(r.at));

  drawLineChart(
    els.chartLatency,
    [
      {
        label: 'API',
        color: '#2563eb',
        values: chronological.map((r) => r.latencyMs),
      },
      {
        label: 'DB',
        color: '#10a37f',
        values: chronological.map((r) => r.dbLatencyMs),
      },
    ],
    labels,
  );

  drawStatusTimeline(
    els.chartStatus,
    history.map((r) => overallOk(r)),
  );

  const okCount = history.filter((h) => overallOk(h)).length;
  const failCount = history.length - okCount;
  drawDonut(els.chartDonut, okCount, failCount);

  const pct = uptimePct();
  els.donutPct.textContent = pct != null ? `${pct}%` : '—';
  els.legOk.textContent = String(okCount);
  els.legFail.textContent = String(failCount);

  drawBarChart(
    els.chartHistoryBar,
    history.slice(0, 40).map((r) => r.latencyMs ?? 0),
    history.slice(0, 40).map((r) => (overallOk(r) ? '#10a37f' : '#ef4444')),
  );

  const apiLat = history.map((h) => h.latencyMs);
  const dbLat = history.map((h) => h.dbLatencyMs);
  els.statApiAvg.textContent = avg(apiLat) != null ? `${avg(apiLat)} ms` : '—';
  els.statDbAvg.textContent = avg(dbLat) != null ? `${avg(dbLat)} ms` : '—';
  const apiR = minMax(apiLat);
  const dbR = minMax(dbLat);
  els.statApiRange.textContent = apiR ? `${apiR.min} / ${apiR.max} ms` : '—';
  els.statDbRange.textContent = dbR ? `${dbR.min} / ${dbR.max} ms` : '—';
}

function renderHistory() {
  els.historyBody.innerHTML = history
    .map((row) => {
      const allOk = overallOk(row);
      return `<tr class="${allOk ? 'ok' : 'bad'}">
      <td>${fmtTime(row.at)}</td>
      <td>${allOk ? 'OK' : 'FAIL'}</td>
      <td>${row.apiOk ? 'OK' : 'DOWN'}</td>
      <td>${row.dbOk ? 'UP' : 'DOWN'}</td>
      <td>${row.frontendOk == null ? '—' : row.frontendOk ? 'OK' : 'DOWN'}</td>
      <td>${row.latencyMs ?? '—'}</td>
      <td>${row.dbLatencyMs ?? '—'}</td>
      <td>${row.http || '—'}</td>
      <td>${row.error ?? ''}</td>
    </tr>`;
    })
    .join('');
  els.historyCount.textContent = `${history.length} checks`;
}

function renderSummary(row: CheckRow) {
  const allOk = overallOk(row);
  const health = row.health ?? lastHealth;

  els.apiStatus.textContent = row.apiOk ? 'OK' : 'DOWN';
  els.apiDetail.textContent = row.apiOk
    ? `HTTP ${row.http} · ${row.latencyMs ?? '—'} ms`
    : row.error ?? 'No response';

  els.dbStatus.textContent = row.dbOk ? 'UP' : 'DOWN';
  els.dbDetail.textContent = row.dbOk
    ? `SELECT 1 · ${row.dbLatencyMs ?? '—'} ms`
    : 'Connection failed';

  if (row.frontendOk == null) {
    els.frontendStatus.textContent = '—';
    els.frontendDetail.textContent = 'Not configured';
  } else {
    els.frontendStatus.textContent = row.frontendOk ? 'OK' : 'DOWN';
    els.frontendDetail.textContent = FRONTEND_URL.replace(/^https?:\/\//, '');
  }

  const up = uptimePct();
  els.uptimeStatus.textContent = up != null ? `${up}%` : '—';
  els.uptimeDetail.textContent = history.length
    ? `${history.filter((h) => overallOk(h)).length}/${history.length} OK`
    : '—';

  setStat(els.statApi, row.apiOk ? 'ok' : 'down');
  setStat(els.statDb, row.dbOk ? 'ok' : row.apiOk ? 'warn' : 'down');
  setStat(
    els.statFrontend,
    row.frontendOk == null ? 'ok' : row.frontendOk ? 'ok' : 'down',
  );
  setStat(els.statUptime, up != null && up >= 95 ? 'ok' : up != null && up >= 80 ? 'warn' : 'down');

  els.overallBadge.textContent = allOk ? 'All systems OK' : 'Issues detected';
  els.overallBadge.className = allOk ? 'badge green' : 'badge amber';
  els.lastCheck.textContent = fmtTime(row.at);
  els.sideStatus.textContent = allOk ? 'Барлығы OK' : 'Мәселе бар';

  els.infoService.textContent = health?.service ?? 'huphup-backend';
  els.infoTime.textContent = health?.time ? fmtTime(health.time) : '—';
  els.infoUptime.textContent = fmtUptime(health?.uptimeSec);
  els.infoMemory.textContent =
    health?.memoryMb != null ? `${health.memoryMb} MB` : '—';
  els.infoNode.textContent = health?.nodeVersion ?? '—';
  els.infoOverall.textContent = health?.status ?? (allOk ? 'ok' : 'degraded');

  if (row.error) {
    els.lastError.style.display = 'block';
    els.lastError.textContent = row.error;
  } else {
    els.lastError.style.display = 'none';
  }

  renderCharts();
  renderHistory();
}

async function checkFrontend(): Promise<boolean | null> {
  if (!FRONTEND_URL) return null;
  try {
    const res = await fetch(FRONTEND_URL, {
      method: 'HEAD',
      mode: 'cors',
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    try {
      const res = await fetch(FRONTEND_URL, { method: 'GET', cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    }
  }
}

async function runCheck() {
  els.refreshBtn.disabled = true;
  const started = performance.now();
  const row: CheckRow = {
    at: new Date().toISOString(),
    apiOk: false,
    dbOk: false,
    frontendOk: null,
    http: 0,
    latencyMs: null,
    dbLatencyMs: null,
  };

  const [frontendOk] = await Promise.all([
    checkFrontend(),
    (async () => {
      try {
        const res = await fetch(API_URL, { cache: 'no-store' });
        row.http = res.status;
        row.latencyMs = Math.round(performance.now() - started);
        row.apiOk = res.ok;
        if (res.ok) {
          const data = (await res.json()) as HealthPayload;
          row.health = data;
          lastHealth = data;
          row.dbOk = data.database === 'up';
          row.dbLatencyMs =
            typeof data.dbLatencyMs === 'number' ? data.dbLatencyMs : null;
        } else {
          row.error = `API HTTP ${res.status}`;
        }
      } catch (err) {
        row.error = err instanceof Error ? err.message : 'Network error';
      }
    })(),
  ]);

  row.frontendOk = frontendOk;
  if (!row.error && frontendOk === false) {
    row.error = 'Frontend unreachable';
  }

  history.unshift(row);
  if (history.length > MAX_HISTORY) history.pop();

  renderSummary(row);
  els.refreshBtn.disabled = false;
}

function setupTabs() {
  const links = document.querySelectorAll('.nav a[data-tab]');
  const panels = document.querySelectorAll('.tab-panel');
  const crumb = $('crumb-tab');

  links.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = (link as HTMLElement).dataset.tab!;
      links.forEach((l) => l.classList.remove('active'));
      link.classList.add('active');
      panels.forEach((p) => p.classList.remove('is-on'));
      document.getElementById(`tab-${tab}`)?.classList.add('is-on');
      const titles: Record<string, string> = {
        dashboard: 'Dashboard',
        history: 'Тарих',
        endpoints: 'Endpoints',
      };
      crumb.textContent = titles[tab] ?? tab;
      if (tab === 'dashboard' || tab === 'history') {
        window.requestAnimationFrame(() => renderCharts());
      }
    });
  });
}

function setupEndpoints() {
  els.epApi.textContent = API_URL;
  els.epFrontend.textContent = FRONTEND_URL || '—';
  els.epPoll.textContent = `${POLL_SECONDS} сек`;
  els.epHistory.textContent = String(MAX_HISTORY);
  const swagger = API_URL.replace(/\/api\/v1\/health\/?$/, '/docs');
  els.epSwagger.textContent = swagger;
}

function boot() {
  els.pollLabel.textContent = `Әр ${POLL_SECONDS} сек`;
  setupTabs();
  setupEndpoints();

  void runCheck();
  timer = window.setInterval(() => void runCheck(), POLL_SECONDS * 1000);
  els.refreshBtn.addEventListener('click', () => void runCheck());
  window.addEventListener('resize', () => renderCharts());
}

boot();

window.addEventListener('beforeunload', () => {
  if (timer) window.clearInterval(timer);
});
