import { useEffect, useMemo, useRef, useState } from 'react';
import type { Domain, Severity, SimulationEvent } from '../../engine/events';
import { buildTrace, computeMetrics, listTraces } from '../../engine/observability';
import { useEngine, useSim, type ConsoleTab } from '../state/store';
import { STATUS_LABEL, fmtMs } from './status';
import { Sparkline } from './Sparkline';

const TABS: { id: ConsoleTab; label: string }[] = [
  { id: 'events', label: 'Eventos / logs' },
  { id: 'traces', label: 'Trazas' },
  { id: 'metrics', label: 'Métricas' },
  { id: 'delivery', label: 'Pipeline · K8s · IaC' },
  { id: 'faults', label: 'Fallos' },
];

export function Console() {
  const tab = useSim((s) => s.consoleTab);
  const setTab = useSim((s) => s.setConsoleTab);
  const open = useSim((s) => s.consoleOpen);
  const setOpen = useSim((s) => s.setConsoleOpen);
  const height = useSim((s) => s.consoleHeight);
  const setHeight = useSim((s) => s.setConsoleHeight);

  const onDrag = (ev: React.PointerEvent) => {
    const startY = ev.clientY;
    const startH = height;
    const move = (e: PointerEvent) => setHeight(startH + (startY - e.clientY));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className="cfl-console" style={{ height: open ? height : 36 }} aria-label="Consola">
      {open && (
        <div
          className="cfl-resize"
          onPointerDown={onDrag}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Redimensionar consola"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') setHeight(height + 20);
            if (e.key === 'ArrowDown') setHeight(height - 20);
          }}
        />
      )}
      <div className="cfl-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`cfl-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
            {t.label}
          </button>
        ))}
        <span className="cfl-spacer" />
        <button className="cfl-btn small" onClick={() => setOpen(!open)} aria-label={open ? 'Colapsar consola' : 'Expandir consola'}>
          {open ? '▾' : '▴'}
        </button>
      </div>
      {open && (
        <div className="cfl-console-body" role="tabpanel">
          {tab === 'events' && <EventsView />}
          {tab === 'traces' && <TracesView />}
          {tab === 'metrics' && <MetricsView />}
          {tab === 'delivery' && <DeliveryView />}
          {tab === 'faults' && <FaultsView />}
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------- eventos

const DOMAINS: (Domain | 'all')[] = ['all', 'request', 'delivery', 'iac', 'system'];

function EventsView() {
  const engine = useEngine();
  const selectedNodeId = useSim((s) => s.selectedNodeId);
  const selectedEventSeq = useSim((s) => s.selectedEventSeq);
  const selectedTraceId = useSim((s) => s.selectedTraceId);
  const filterByNode = useSim((s) => s.filterBySelectedNode);
  const setFilterByNode = useSim((s) => s.setFilterBySelectedNode);
  const selectEvent = useSim((s) => s.selectEvent);
  const selectTrace = useSim((s) => s.selectTrace);
  const selectNode = useSim((s) => s.selectNode);
  const [domain, setDomain] = useState<Domain | 'all'>('all');
  const [showDebug, setShowDebug] = useState(false);
  const [onlyTrace, setOnlyTrace] = useState(false);
  const [text, setText] = useState('');
  const [follow, setFollow] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const rows: SimulationEvent[] = [];
  const needle = text.trim().toLowerCase();
  for (let i = engine.log.length - 1; i >= 0 && rows.length < 400; i--) {
    const ev = engine.log[i]!;
    if (!showDebug && ev.severity === 'debug') continue;
    if (domain !== 'all' && ev.domain !== domain) continue;
    if (filterByNode && selectedNodeId && ev.componentId !== selectedNodeId) continue;
    if (onlyTrace && selectedTraceId && ev.traceId !== selectedTraceId) continue;
    if (needle && !`${ev.message} ${ev.componentId} ${ev.type} ${ev.traceId ?? ''}`.toLowerCase().includes(needle)) continue;
    rows.push(ev);
  }
  rows.reverse();

  useEffect(() => {
    if (follow && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  });

  return (
    <div className="cfl-events">
      <div className="cfl-toolbar">
        <select value={domain} onChange={(e) => setDomain(e.target.value as Domain | 'all')} aria-label="Filtrar por dominio">
          {DOMAINS.map((d) => (
            <option key={d} value={d}>
              {d === 'all' ? 'todos los dominios' : d}
            </option>
          ))}
        </select>
        <input type="search" placeholder="buscar (mensaje, componente, trace_id)…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Buscar en eventos" />
        <label className="cfl-toggle">
          <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} /> debug (red)
        </label>
        <label className="cfl-toggle" title="Al seleccionar un nodo, la consola sólo muestra sus eventos">
          <input type="checkbox" checked={filterByNode} onChange={(e) => setFilterByNode(e.target.checked)} /> filtrar por nodo
          {selectedNodeId && filterByNode ? <b>: {selectedNodeId}</b> : null}
        </label>
        <label className="cfl-toggle">
          <input type="checkbox" checked={onlyTrace} disabled={!selectedTraceId} onChange={(e) => setOnlyTrace(e.target.checked)} /> sólo traza
          {selectedTraceId ? <b className="mono"> {selectedTraceId.slice(0, 8)}</b> : null}
        </label>
        <label className="cfl-toggle">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> seguir
        </label>
        <span className="cfl-muted">{engine.log.length} eventos · todos simulados</span>
      </div>
      <div className="cfl-log mono" ref={bodyRef} data-testid="event-log">
        {rows.map((ev) => (
          <div
            key={ev.id}
            className={`cfl-log-row sev-${ev.severity} ${ev.seq === selectedEventSeq ? 'selected' : ''}`}
            onClick={() => {
              selectEvent(ev.seq);
              if (ev.traceId) selectTrace(ev.traceId);
            }}
            onDoubleClick={() => selectNode(ev.componentId)}
            role="button"
            tabIndex={0}
            onKeyDown={(k) => k.key === 'Enter' && selectEvent(ev.seq)}
            title={`event_id=${ev.id} scenario=${ev.scenarioId} provider=${ev.provider}${ev.spanId ? ` span_id=${ev.spanId}` : ''}${ev.parentSpanId ? ` parent=${ev.parentSpanId}` : ''}\n${JSON.stringify(ev.payload)}`}
          >
            <span className="c-time">{ev.virtualTime.toFixed(2).padStart(9)}</span>
            <span className={`c-level sev-${ev.severity}`}>{ev.severity.toUpperCase().padEnd(5)}</span>
            <span className="c-domain">{ev.domain}</span>
            <span className="c-service">{ev.service}</span>
            <span className="c-trace">{ev.traceId ? ev.traceId.slice(0, 8) : '—'}</span>
            <span className="c-type">{ev.type}</span>
            <span className="c-msg">{ev.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- trazas

function TracesView() {
  const engine = useEngine();
  const selectedTraceId = useSim((s) => s.selectedTraceId);
  const selectTrace = useSim((s) => s.selectTrace);
  const selectNode = useSim((s) => s.selectNode);
  const logLength = engine.log.length;
  const traces = useMemo(() => listTraces(engine.log, 40), [engine, logLength]); // eslint-disable-line react-hooks/exhaustive-deps
  const trace = selectedTraceId ? buildTrace(engine.log, selectedTraceId) : undefined;

  return (
    <div className="cfl-traces">
      <div className="cfl-trace-list" aria-label="Trazas recientes">
        {traces.length === 0 && <p className="cfl-muted">Envía una request para generar trazas.</p>}
        {traces.map((t) => (
          <button key={t.traceId} className={`cfl-trace-item ${t.traceId === selectedTraceId ? 'selected' : ''} st-${t.status}`} onClick={() => selectTrace(t.traceId)}>
            <span className="mono">{t.traceId.slice(0, 8)}</span>
            <span>{t.status === 'running' ? '…' : t.httpStatus === 0 ? 'sin HTTP' : t.httpStatus}</span>
            <span>{t.totalDuration !== undefined ? fmtMs(t.totalDuration) : 'en curso'}</span>
            <span className="cfl-muted">{t.origin}</span>
          </button>
        ))}
      </div>
      <div className="cfl-waterfall" data-testid="waterfall">
        {!trace ? (
          <p className="cfl-muted">Selecciona una traza (o haz clic en un pulso del mapa) para ver su waterfall. Las barras son spans; la sangría indica la relación padre/hijo propagada con traceparent.</p>
        ) : (
          <Waterfall trace={trace} onSpan={selectNode} />
        )}
      </div>
    </div>
  );
}

function Waterfall({ trace, onSpan }: { trace: NonNullable<ReturnType<typeof buildTrace>>; onSpan: (id: string) => void }) {
  const engine = useEngine();
  const end = trace.totalDuration !== undefined ? trace.start + trace.totalDuration : engine.now;
  const total = Math.max(end - trace.start, 0.001);
  const depth = new Map<string, number>();
  for (const s of trace.spans) depth.set(s.spanId, s.parentSpanId ? (depth.get(s.parentSpanId) ?? 0) + 1 : 0);
  return (
    <div>
      <div className="cfl-wf-head mono small">
        trace_id={trace.traceId} · {trace.spans.length} spans · {trace.totalDuration !== undefined ? fmtMs(trace.totalDuration) : 'en curso'} ·{' '}
        {trace.status === 'running' ? 'en curso' : trace.status === 'ok' ? `HTTP ${trace.httpStatus}` : trace.httpStatus === 0 ? 'error (sin respuesta HTTP)' : `error HTTP ${trace.httpStatus}`}
      </div>
      {trace.spans.map((s) => {
        const left = ((s.start - trace.start) / total) * 100;
        const width = (((s.duration ?? engine.now - s.start) as number) / total) * 100;
        const err = s.status !== undefined && (s.status === 0 || s.status >= 400);
        return (
          <button key={s.spanId} className="cfl-wf-row" onClick={() => onSpan(s.componentId)} title={`span_id=${s.spanId} parent=${s.parentSpanId ?? '—'}`}>
            <span className="cfl-wf-label mono small" style={{ paddingLeft: (depth.get(s.spanId) ?? 0) * 10 }}>
              {s.componentId} · {s.operation}
            </span>
            <span className="cfl-wf-track">
              <span className={`cfl-wf-bar ${err ? 'error' : s.duration === undefined ? 'running' : 'ok'}`} style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%` }} />
            </span>
            <span className="cfl-wf-dur mono small">
              {s.duration !== undefined ? fmtMs(s.duration) : '…'} {s.status !== undefined ? `· ${s.status}` : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------- métricas

function Stat({ label, value, hint, series }: { label: string; value: string; hint?: string; series?: number[] }) {
  return (
    <div className="cfl-stat" title={hint}>
      <div className="cfl-stat-label">{label}</div>
      <div className="cfl-stat-value">{value}</div>
      {series && <Sparkline values={series} />}
    </div>
  );
}

function MetricsView() {
  const engine = useEngine();
  const history = useSim((s) => s.metricsHistory);
  const m = computeMetrics(engine, 200);
  return (
    <div className="cfl-metrics">
      <div className="cfl-stats">
        <Stat label="RPS (ventana 200 ms)" value={m.rps.toFixed(0)} series={history.map((h) => h.rps)} hint="Requests completadas por segundo modelado" />
        <Stat label="Error rate" value={`${(m.errorRate * 100).toFixed(1)} %`} series={history.map((h) => h.errorRate)} />
        <Stat label="p50" value={fmtMs(m.p50)} />
        <Stat label="p95" value={fmtMs(m.p95)} series={history.map((h) => h.p95)} />
        <Stat label="p99" value={fmtMs(m.p99)} />
        <Stat label="En vuelo" value={String(m.inFlight)} />
        <Stat label="Cache hit ratio" value={m.cacheHitRatio === null ? '—' : `${(m.cacheHitRatio * 100).toFixed(0)} %`} hint="Sólo ElastiCache" />
        <Stat label="DB queries/s" value={m.dbQueriesPerSec.toFixed(0)} />
        <Stat label="Conexiones DB en uso" value={String(m.dbConnectionsInUse)} />
        <Stat label="SQS publish/s" value={m.queuePublishedPerSec.toFixed(0)} />
      </div>
      <table className="cfl-table">
        <thead>
          <tr>
            <th>Deployment</th>
            <th>Réplicas ready/deseadas</th>
            <th>Versión</th>
            <th>CPU (sintética)</th>
            <th>Memoria (sintética)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(m.replicas).map(([id, r]) => (
            <tr key={id}>
              <td>{id}</td>
              <td className={r.ready < r.desired ? 'warn' : ''}>
                {r.ready}/{r.desired}
              </td>
              <td>{r.version}</td>
              <td>{m.cpu[id]} %</td>
              <td>{m.memoryMiB[id]} MiB</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="cfl-explain">
        <summary>¿Cómo se recogerían estas métricas en la realidad?</summary>
        <ul>
          <li>
            <b>Prometheus</b> hace <i>scrape</i> (pull) del endpoint <code>/metrics</code> de cada Pod descubierto vía la API de Kubernetes; <b>Grafana</b> consulta Prometheus con PromQL, p.ej.{' '}
            <code>histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket[5m])))</code>.
          </li>
          {engine.scenario.observabilityNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            Las <b>trazas</b> se generan con OpenTelemetry (contexto W3C <code>traceparent</code>) y se exportan a un backend (X-Ray, Tempo, Jaeger…). Logs, métricas y trazas se correlacionan por
            trace_id.
          </li>
          <li>Aquí todo se deriva del event stream del simulador: CPU y memoria son un modelo sintético en función de la carga activa.</li>
        </ul>
      </details>
    </div>
  );
}

// -------------------------------------------------------------- delivery

function DeliveryView() {
  const engine = useEngine();
  const selectNode = useSim((s) => s.selectNode);
  const d = engine.delivery;
  const k8s: SimulationEvent[] = [];
  for (let i = engine.log.length - 1; i >= 0 && k8s.length < 14; i--) {
    const ev = engine.log[i]!;
    if (ev.type === 'k8s.event' || ev.type === 'endpoints.updated' || ev.type.startsWith('argocd') || ev.type.startsWith('rollout')) k8s.push(ev);
  }
  return (
    <div className="cfl-delivery">
      <div>
        <h4>
          Pipeline {d.runId ?? '—'} · <span className={`status-text status-${d.status}`}>{STATUS_LABEL[d.status]}</span>
        </h4>
        {d.stages.length === 0 ? (
          <p className="cfl-muted">Pulsa ◆ Release para lanzar push → CI → registry → GitOps → Argo CD → rollout → smoke test.</p>
        ) : (
          <div className="cfl-stages" data-testid="pipeline-stages">
            {d.stages.map((st) => (
              <button key={st.key} className={`cfl-stage status-${st.status}`} onClick={() => selectNode(st.service ?? st.componentId)} title={STATUS_LABEL[st.status]}>
                <span className="cfl-stage-name">{st.name}</span>
                {st.service && <span className="cfl-stage-svc">{st.service}</span>}
                <span className="cfl-stage-dur">
                  {st.startedAt !== undefined ? `${Math.round((st.endedAt ?? engine.now) - st.startedAt)} s` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="cfl-argo mono small">
          Argo CD · sync=<b>{d.argo.sync}</b> · health=<b>{d.argo.health}</b> · revision GitOps {d.gitopsRevision}
        </div>
        <h4>
          Terraform {engine.iac.runId ?? '—'} · <span className={`status-text status-${engine.iac.status}`}>{STATUS_LABEL[engine.iac.status]}</span>
          {engine.iac.locked ? ' · 🔒 state lock' : ''}
        </h4>
        {engine.iac.steps.length === 0 ? (
          <p className="cfl-muted">Flujo independiente de la release: init → lock → plan → aprobación → apply → unlock.</p>
        ) : (
          <div className="cfl-stages">
            {engine.iac.steps.map((st) => (
              <span key={st.key} className={`cfl-stage status-${st.status}`}>
                <span className="cfl-stage-name">{st.name}</span>
              </span>
            ))}
          </div>
        )}
        <p className="cfl-muted small">Duraciones en segundos modelados (1 ms virtual = 1 s modelado).</p>
      </div>
      <div>
        <h4>Eventos Kubernetes / Argo CD</h4>
        <div className="cfl-log mono small">
          {k8s.reverse().map((ev) => (
            <div key={ev.id} className={`cfl-log-row sev-${ev.severity}`}>
              <span className="c-time">{ev.virtualTime.toFixed(1).padStart(7)}</span>
              <span className="c-msg">{ev.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- fallos

function FaultsView() {
  const engine = useEngine();
  const dispatch = useSim((s) => s.dispatch);
  const selectNode = useSim((s) => s.selectNode);
  const compareEngine = useSim((s) => s.compareEngine);
  const groups: Record<string, typeof engine.scenario.faults> = { request: [], delivery: [] };
  for (const f of engine.scenario.faults) groups[f.domain]!.push(f);
  return (
    <div className="cfl-faults">
      {compareEngine && (
        <p className="cfl-compare-note">
          Modo comparación: cada fallo se inyecta también en {compareEngine.scenario.title} (mismo id, componente equivalente). Los textos describen el proveedor principal; la tabla de
          comparación muestra la diferencia de comportamiento.
        </p>
      )}
      {(['request', 'delivery'] as const).map((domain) => (
        <div key={domain}>
          <h4>{domain === 'request' ? 'Data plane (requests)' : 'Delivery e infraestructura'}</h4>
          {groups[domain]!.map((f) => {
            const on = engine.activeFaults.has(f.id);
            return (
              <div key={f.id} className={`cfl-fault ${on ? 'on' : ''}`}>
                <label className="cfl-toggle">
                  <input type="checkbox" checked={on} onChange={(e) => dispatch({ type: 'toggleFault', faultId: f.id, enabled: e.target.checked })} data-testid={`fault-${f.id}`} />
                  <b>{f.title}</b>
                </label>
                <button className="cfl-linklike small" onClick={() => selectNode(f.component)}>
                  → {f.component}
                </button>
                <p>{f.description}</p>
                <details>
                  <summary>Cómo diagnosticarlo</summary>
                  <p>{f.diagnosis}</p>
                </details>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export type { Severity };
