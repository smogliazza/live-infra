import { providers } from '../../catalog';
import { comparisonAspects } from '../../catalog/comparison';
import type { SimulationEngine } from '../../engine/engine';
import { buildTrace, type Trace } from '../../engine/observability';
import { isError } from '../../engine/request';
import { useEngine, useSim } from '../state/store';
import { FlowCanvas } from './FlowCanvas';
import { STATUS_LABEL, fmtMs } from './status';

function lastCompletedTrace(engine: SimulationEngine): Trace | undefined {
  for (let i = engine.log.length - 1; i >= 0; i--) {
    const ev = engine.log[i]!;
    if (ev.type === 'request.completed' && ev.traceId) return buildTrace(engine.log, ev.traceId);
  }
  return undefined;
}

function providerName(engine: SimulationEngine): string {
  return providers.find((p) => p.id === engine.scenario.providerId)?.shortName ?? engine.scenario.providerId;
}

function statusText(t: Trace | undefined): string {
  if (!t) return '—';
  if (t.httpStatus === 0) return 'sin respuesta HTTP';
  return `HTTP ${t.httpStatus}`;
}

function SideSummary({ engine }: { engine: SimulationEngine }) {
  const t = lastCompletedTrace(engine);
  const err = t?.httpStatus !== undefined && isError(t.httpStatus);
  return (
    <div className="cfl-compare-summary mono small">
      <b>{providerName(engine)}</b> · {engine.scenario.title.split('·')[1]?.trim()} · última request:{' '}
      <span className={err ? 'sev-error' : t ? 'status-text status-success' : ''}>
        {statusText(t)}
        {t?.totalDuration !== undefined ? ` en ${fmtMs(t.totalDuration)} · ${t.spans.length} spans` : ''}
      </span>{' '}
      · release <span className={`status-text status-${engine.delivery.status}`}>{STATUS_LABEL[engine.delivery.status]}</span>
    </div>
  );
}

/** Dos mapas sincronizados (mismo reloj, mismos comandos, mismos fallos). */
export function CompareView() {
  const primary = useEngine();
  const secondary = useSim((s) => s.compareEngine)!;
  return (
    <div className="cfl-compare-view" data-testid="compare-view">
      <section className="cfl-compare-pane">
        <SideSummary engine={primary} />
        <FlowCanvas testId="canvas-primary" compact />
      </section>
      <section className="cfl-compare-pane">
        <SideSummary engine={secondary} />
        <FlowCanvas engine={secondary} secondary compact testId="canvas-secondary" />
      </section>
    </div>
  );
}

/** Clave para alinear saltos entre proveedores: intención (o id del microservicio). */
function hopKey(engine: SimulationEngine, componentId: string): string {
  const n = engine.nodes.get(componentId);
  if (!n) return componentId;
  return n.intent === 'microservice' ? `svc:${n.id}` : n.intent;
}

function hopRows(a: SimulationEngine, b: SimulationEngine) {
  const ta = lastCompletedTrace(a);
  const tb = lastCompletedTrace(b);
  const rows = new Map<string, { label: string; a?: string; b?: string; da?: number; db?: number; sa?: number; sb?: number }>();
  const add = (engine: SimulationEngine, t: Trace | undefined, side: 'a' | 'b') => {
    for (const s of t?.spans ?? []) {
      const key = hopKey(engine, s.componentId);
      const row = rows.get(key) ?? { label: key.startsWith('svc:') ? key.slice(4) : key };
      // Si hay varios spans (reintentos, DB desde dos servicios), se suma la duración.
      if (side === 'a') {
        row.a = engine.nodes.get(s.componentId)?.label;
        row.da = (row.da ?? 0) + (s.duration ?? 0);
        row.sa = s.status;
      } else {
        row.b = engine.nodes.get(s.componentId)?.label;
        row.db = (row.db ?? 0) + (s.duration ?? 0);
        row.sb = s.status;
      }
      rows.set(key, row);
    }
  };
  add(a, ta, 'a');
  add(b, tb, 'b');
  return { ta, tb, rows: [...rows.values()] };
}

export function ComparePanel() {
  const a = useEngine();
  const b = useSim((s) => s.compareEngine)!;
  const pa = a.scenario.providerId;
  const pb = b.scenario.providerId;
  const nameA = providerName(a);
  const nameB = providerName(b);
  const serviceFor = (engine: SimulationEngine, intent?: string) => {
    if (!intent) return undefined;
    const node = engine.scenario.nodes.find((n) => n.intent === intent);
    return node ? engine.catalog.get(node.service)?.name : undefined;
  };
  const { ta, tb, rows } = hopRows(a, b);

  return (
    <aside className="cfl-inspector cfl-compare-panel" aria-label="Comparación" data-testid="compare-panel">
      <div className="cfl-ins-head">
        <div className="cfl-ins-kicker">Modo comparación · mismo escenario, mismos comandos</div>
        <h3>
          {nameA} vs {nameB}
        </h3>
      </div>
      <p className="cfl-muted">
        Se compara la misma intención arquitectónica, no nombres de productos. Las equivalencias son aproximadas y no hay puntuación de "mejor cloud": cada fila describe diferencias y
        trade-offs. Los fallos se inyectan en ambos lados (comparten id).
      </p>

      <section className="cfl-ins-section">
        <h4>Última request, salto a salto</h4>
        {!ta && !tb ? (
          <p className="cfl-muted">Envía una request: se ejecuta a la vez en ambos proveedores.</p>
        ) : (
          <table className="cfl-table small" data-testid="compare-hops">
            <thead>
              <tr>
                <th>Salto</th>
                <th>{nameA}</th>
                <th>{nameB}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <b>total</b>
                </td>
                <td className={ta?.httpStatus !== undefined && isError(ta.httpStatus) ? 'sev-error' : ''}>
                  {statusText(ta)} {ta?.totalDuration !== undefined ? `· ${fmtMs(ta.totalDuration)}` : ''}
                </td>
                <td className={tb?.httpStatus !== undefined && isError(tb.httpStatus) ? 'sev-error' : ''}>
                  {statusText(tb)} {tb?.totalDuration !== undefined ? `· ${fmtMs(tb.totalDuration)}` : ''}
                </td>
              </tr>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="cfl-muted">{r.label}</td>
                  <td className={r.sa !== undefined && isError(r.sa) ? 'sev-error' : ''}>{r.a ? `${r.a} · ${fmtMs(r.da ?? 0)}${r.sa !== undefined ? ` · ${r.sa}` : ''}` : '—'}</td>
                  <td className={r.sb !== undefined && isError(r.sb) ? 'sev-error' : ''}>{r.b ? `${r.b} · ${fmtMs(r.db ?? 0)}${r.sb !== undefined ? ` · ${r.sb}` : ''}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="cfl-muted small">Latencias sintéticas: sirven para comparar el recorrido y el comportamiento ante fallos, no el rendimiento real de cada proveedor.</p>
      </section>

      <section className="cfl-ins-section">
        <h4>Diferencias por aspecto</h4>
        <table className="cfl-table cfl-compare-table" data-testid="compare-table">
          <thead>
            <tr>
              <th>Aspecto</th>
              <th>{nameA}</th>
              <th>{nameB}</th>
            </tr>
          </thead>
          <tbody>
            {comparisonAspects.map((asp) => (
              <tr key={asp.id}>
                <td>
                  <b>{asp.title}</b>
                  <div className="cfl-muted small">{asp.question}</div>
                </td>
                <td>
                  {serviceFor(a, asp.intent) && <div className="cfl-compare-svc">{serviceFor(a, asp.intent)}</div>}
                  <div className="small">{asp.notes[pa] ?? 'Pendiente de documentar.'}</div>
                </td>
                <td>
                  {serviceFor(b, asp.intent) && <div className="cfl-compare-svc">{serviceFor(b, asp.intent)}</div>}
                  <div className="small">{asp.notes[pb] ?? 'Pendiente de documentar.'}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </aside>
  );
}
