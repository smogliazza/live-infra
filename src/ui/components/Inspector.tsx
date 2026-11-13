/**
 * Inspector técnico contextual. Muestra el último elemento seleccionado:
 * componente, conexión o evento. Todo el contenido proviene del catálogo,
 * del escenario o del event stream; las secciones vacías no se muestran.
 */
import { useState, type ReactNode } from 'react';
import { ArrowRightLeft, ExternalLink, LocateFixed, ScrollText, X } from 'lucide-react';
import { glossary } from '../../catalog/glossary';
import { providers } from '../../catalog';
import { computeMetrics, nodeVisualStatus } from '../../engine/observability';
import type { SimulationEngine } from '../../engine/engine';
import type { SimulationEvent } from '../../engine/events';
import { useEngine, useSim } from '../state/store';
import { STATUS_LABEL } from './status';
import { INTENT_ICON, STATUS_ICON } from './icons';
import { LAYERS, nodeLayers } from '../layers';
import { EDGE_CLASS_LABEL, edgeClass } from '../edgeClass';

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="cfl-ins-section">
      <h4>
        <span>{title}</span>
        {aside}
      </h4>
      {children}
    </section>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <Section title={title}>
      <ul className="cfl-ins-list">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </Section>
  );
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="cfl-kv">
      {rows
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => (
          <div key={k} className="cfl-kv-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function Chips({ items, mono = false }: { items: string[]; mono?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="cfl-chips">
      {items.map((i) => (
        <span key={i} className={`cfl-chip ${mono ? 'mono' : ''}`}>
          {i}
        </span>
      ))}
    </div>
  );
}

function StatusChip({ status }: { status: keyof typeof STATUS_LABEL }) {
  const I = STATUS_ICON[status];
  return (
    <span className={`cfl-status status-${status}`}>
      <I size={12} aria-hidden /> {STATUS_LABEL[status]}
    </span>
  );
}

const providerName = (id: string) => (id === 'generic' ? 'Agnóstico de proveedor' : id === 'cloudflare' ? 'CLOUDFLARE' : (providers.find((p) => p.id === id)?.shortName ?? id).toUpperCase());

function EventList({ engine, events }: { engine: SimulationEngine; events: SimulationEvent[] }) {
  const selectEvent = useSim((s) => s.selectEvent);
  if (!events.length) return <p className="cfl-muted">Sin eventos todavía.</p>;
  return (
    <ul className="cfl-ins-events mono">
      {events.map((ev) => (
        <li key={ev.id}>
          <button className={`cfl-event-link sev-${ev.severity}`} onClick={() => selectEvent(ev.seq)} title={`${ev.type} · ${engine.scenario.id}`}>
            <span className="c-time">{ev.virtualTime.toFixed(1)}</span>
            <span className={`c-level sev-${ev.severity}`}>{ev.severity.toUpperCase()}</span>
            <span className="c-msg">{ev.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function recentEvents(engine: SimulationEngine, pred: (ev: SimulationEvent) => boolean, n = 10): SimulationEvent[] {
  const out: SimulationEvent[] = [];
  for (let i = engine.log.length - 1; i >= 0 && out.length < n; i--) {
    const ev = engine.log[i]!;
    if (ev.severity !== 'debug' && pred(ev)) out.push(ev);
  }
  return out;
}

// -------------------------------------------------------------- inspector

export function Inspector() {
  const engine = useEngine();
  const focus = useSim((s) => s.inspectorFocus);
  const selectedNodeId = useSim((s) => s.selectedNodeId);
  const selectedEdgeId = useSim((s) => s.selectedEdgeId);
  const selectedEventSeq = useSim((s) => s.selectedEventSeq);
  const setOpen = useSim((s) => s.setInspectorOpen);

  let body: ReactNode;
  let view = 'scenario';
  if (focus === 'event' && selectedEventSeq !== undefined && engine.log[selectedEventSeq]) {
    view = 'event';
    body = <EventInspector engine={engine} ev={engine.log[selectedEventSeq]!} />;
  } else if (focus === 'edge' && selectedEdgeId && engine.scenario.edges.some((e) => e.id === selectedEdgeId)) {
    view = 'edge';
    body = <EdgeInspector engine={engine} edgeId={selectedEdgeId} />;
  } else if (selectedNodeId && engine.nodes.has(selectedNodeId)) {
    view = 'node';
    body = <NodeInspector key={selectedNodeId} engine={engine} nodeId={selectedNodeId} />;
  } else {
    body = <ScenarioOverview engine={engine} />;
  }
  return (
    <aside className="cfl-inspector" aria-label="Inspector" data-testid="inspector" data-view={view}>
      <button className="cfl-icon-btn cfl-ins-collapse" onClick={() => setOpen(false)} aria-label="Ocultar inspector" title="Ocultar inspector">
        <X size={15} />
      </button>
      {body}
    </aside>
  );
}

// ---------------------------------------------------------------- scenario

function ScenarioOverview({ engine }: { engine: SimulationEngine }) {
  const scenario = engine.scenario;
  return (
    <div className="cfl-ins-body">
      <header className="cfl-ins-head">
        <div className="cfl-ins-kicker">Escenario · {providerName(scenario.providerId)}</div>
        <h3>{scenario.title}</h3>
      </header>
      <p className="cfl-ins-lead">{scenario.description}</p>
      <Section title="Cómo explorarlo">
        <ol className="cfl-ins-list">
          <li>
            <b>Request</b> envía una petición: los pulsos cian son la ida, los verdes la respuesta (rojos si hay error). Haz clic en un pulso para seguir su traza.
          </li>
          <li>
            <b>Release</b> lanza el flujo de delivery: los rombos recorren CI, registry, GitOps y Kubernetes en otra escala temporal.
          </li>
          <li>
            <b>Terraform</b> ejecuta un cambio de infraestructura independiente con aprobación manual.
          </li>
          <li>Selecciona componentes, conexiones o eventos para ver su detalle técnico. Puedes arrastrar nodos: sólo cambia la vista, nunca la topología.</li>
          <li>
            Abre <b>Fallos</b>, inyecta uno y diagnostícalo con consola, trazas y métricas.
          </li>
        </ol>
      </Section>
      <List title="Simplificaciones de esta simulación" items={scenario.simplifications} />
    </div>
  );
}

// -------------------------------------------------------------------- node

type NodeTab = 'overview' | 'architecture' | 'config' | 'observability' | 'troubleshooting';

function NodeInspector({ engine, nodeId }: { engine: SimulationEngine; nodeId: string }) {
  const [tab, setTab] = useState<NodeTab>('overview');
  const selectNode = useSim((s) => s.selectNode);
  const selectEdge = useSim((s) => s.selectEdge);
  const requestCenter = useSim((s) => s.requestCenter);
  const dispatch = useSim((s) => s.dispatch);
  const scenario = engine.scenario;
  const node = engine.nodes.get(nodeId)!;
  const svc = engine.catalog.get(node.service)!;
  const ins = svc.inspector;
  const status = nodeVisualStatus(engine, node.id);
  const workload = engine.workloads.get(node.id);
  const rt = engine.runtime.get(node.id);
  const nodeById = new Map(scenario.nodes.map((n) => [n.id, n]));
  const incoming = scenario.edges.filter((e) => e.target === node.id);
  const outgoing = scenario.edges.filter((e) => e.source === node.id);
  const boundary = scenario.boundaries.find((b) => b.id === node.boundary);
  const layers = nodeLayers(node, svc);
  const faults = scenario.faults.filter((f) => f.component === node.id);
  const routing = outgoing.filter((e) => e.routingRule);
  const Icon = INTENT_ICON[node.intent];
  const metrics = workload ? computeMetrics(engine, 200) : undefined;

  const tabs: { id: NodeTab; label: string; show: boolean }[] = [
    { id: 'overview', label: 'Overview', show: true },
    { id: 'architecture', label: 'Arquitectura', show: true },
    { id: 'config', label: 'Configuración', show: Boolean(ins.exampleConfig || routing.length) },
    { id: 'observability', label: 'Observabilidad', show: true },
    { id: 'troubleshooting', label: 'Troubleshooting', show: Boolean(ins.failureModes.length || faults.length) },
  ];

  const EdgeRow = ({ e, dir }: { e: (typeof incoming)[number]; dir: 'in' | 'out' }) => {
    const other = dir === 'in' ? e.source : e.target;
    return (
      <tr>
        <td>
          <button className="cfl-linklike" onClick={() => selectEdge(e.id)} title="Ver la conexión">
            {dir === 'in' ? '←' : '→'} {nodeById.get(other)?.label ?? other}
          </button>
        </td>
        <td className="mono">
          {e.protocol}
          {e.port ? ` :${e.port}` : ''}
        </td>
        <td>
          <span className={`cfl-edge-tag cls-${edgeClass(e, nodeById)}`}>{e.traffic}</span>
        </td>
      </tr>
    );
  };

  return (
    <div className="cfl-ins-body">
      <header className="cfl-ins-head">
        <div className="cfl-ins-kicker">
          {providerName(svc.provider)} · {svc.category}
        </div>
        <div className="cfl-ins-title">
          <span className="cfl-ins-icon" aria-hidden>
            <Icon size={18} />
          </span>
          <h3>{svc.name}</h3>
        </div>
        <div className="cfl-ins-role">{svc.role}</div>
        <div className="cfl-ins-meta">
          <StatusChip status={status} />
          {rt && rt.active > 0 && <span className="cfl-chip">{rt.active} en curso</span>}
          <button className="cfl-btn small ghost" onClick={() => requestCenter()} title="Centrar en el mapa">
            <LocateFixed size={13} /> Centrar
          </button>
        </div>
      </header>

      <div className="cfl-ins-tabs" role="tablist" aria-label="Secciones del componente">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`cfl-ins-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} data-testid={`inspector-tab-${t.id}`}>
              {t.label}
            </button>
          ))}
      </div>

      {tab === 'overview' && (
        <div role="tabpanel">
          <p className="cfl-ins-lead">{ins.summary}</p>
          <KV
            rows={[
              ['Nodo', <span className="mono">{node.id}</span>],
              ['Proveedor', providerName(svc.provider)],
              ['Capa', `${svc.layer} · ${svc.plane} plane`],
              ['Boundary', boundary?.label],
              [
                'Capas de lectura',
                <span className="cfl-layer-list">
                  {layers.map((l) => (
                    <span key={l} className="cfl-layer-tag">
                      <span className={`cfl-layer-dot layer-${l}`} /> {LAYERS.find((x) => x.id === l)?.label}
                    </span>
                  ))}
                </span>,
              ],
              ['Workload', workload ? `${workload.namespace}/${workload.deployment} · v${workload.version}${workload.targetVersion ? ` → ${workload.targetVersion}` : ''}` : undefined],
            ]}
          />
          <details className="cfl-details" open>
            <summary>Descripción técnica avanzada</summary>
            <p>{ins.advanced}</p>
          </details>
          {ins.docs.length > 0 && (
            <Section title="Documentación oficial">
              <ul className="cfl-ins-list">
                {ins.docs.map((d) => (
                  <li key={d.url}>
                    <a href={d.url} target="_blank" rel="noreferrer noopener">
                      {d.title} <ExternalLink size={11} aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {ins.glossary.length > 0 && (
            <Section title="Glosario">
              <dl className="cfl-dl">
                {ins.glossary.map((g) => (
                  <div key={g}>
                    <dt>{g}</dt>
                    <dd>{glossary[g] ?? 'Definición pendiente.'}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
        </div>
      )}

      {tab === 'architecture' && (
        <div role="tabpanel">
          <div className="cfl-ins-grid3">
            <List title="Recibe" items={ins.receives} />
            <List title="Procesa" items={ins.processes} />
            <List title="Emite" items={ins.emits} />
          </div>
          <Section title={`Conexiones (${incoming.length + outgoing.length})`}>
            <table className="cfl-table compact">
              <thead>
                <tr>
                  <th>Con</th>
                  <th>Protocolo / puerto</th>
                  <th>Tráfico</th>
                </tr>
              </thead>
              <tbody>
                {incoming.map((e) => (
                  <EdgeRow key={e.id} e={e} dir="in" />
                ))}
                {outgoing.map((e) => (
                  <EdgeRow key={e.id} e={e} dir="out" />
                ))}
              </tbody>
            </table>
          </Section>
          {ins.protocols.length > 0 && (
            <Section title="Protocolos">
              <Chips items={ins.protocols} mono />
            </Section>
          )}
          {ins.ports.length > 0 && (
            <Section title="Puertos">
              <Chips items={ins.ports} mono />
            </Section>
          )}
          <List title="Identidad y permisos" items={ins.identity} />
          {ins.trustBoundary && (
            <Section title="Límite de confianza">
              <p>{ins.trustBoundary}</p>
            </Section>
          )}
          {workload && (
            <Section title={`Pods · ${workload.pods.filter((p) => p.ready).length}/${workload.replicas} Ready`}>
              <table className="cfl-table compact">
                <thead>
                  <tr>
                    <th>Pod</th>
                    <th>Versión</th>
                    <th>Fase</th>
                    <th>Ready</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.pods.map((p) => (
                    <tr key={p.name}>
                      <td className="mono">{p.name}</td>
                      <td className="mono">{p.version}</td>
                      <td className={`phase-${p.phase}`}>{p.phase}</td>
                      <td>{p.ready ? 'sí' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </div>
      )}

      {tab === 'config' && (
        <div role="tabpanel">
          {routing.length > 0 && (
            <Section title="Reglas de enrutado (del escenario)">
              <ul className="cfl-ins-list mono small">
                {routing.map((e) => (
                  <li key={e.id}>
                    → {nodeById.get(e.target)?.label ?? e.target}: {e.routingRule}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {ins.exampleConfig && (
            <Section title="Configuración de ejemplo" aside={<span className="cfl-tag">ILUSTRATIVA · no productiva</span>}>
              <pre className="cfl-code" aria-label={`Configuración ${ins.exampleConfig.language}`}>
                <span className="cfl-code-lang">{ins.exampleConfig.language}</span>
                {ins.exampleConfig.code}
              </pre>
            </Section>
          )}
        </div>
      )}

      {tab === 'observability' && (
        <div role="tabpanel">
          {workload && metrics && metrics.replicas[node.id] && (
            <Section title="Señales actuales (derivadas del event stream)">
              <KV
                rows={[
                  ['Réplicas Ready', `${metrics.replicas[node.id]!.ready}/${metrics.replicas[node.id]!.desired}`],
                  ['Versión', metrics.replicas[node.id]!.version],
                  ['CPU (modelo sintético)', `${metrics.cpu[node.id]} %`],
                  ['Memoria (modelo sintético)', `${metrics.memoryMiB[node.id]} MiB`],
                ]}
              />
            </Section>
          )}
          <Section title="Eventos recientes (simulados)" aside={<ScrollText size={13} aria-hidden />}>
            <EventList engine={engine} events={recentEvents(engine, (ev) => ev.componentId === node.id)} />
          </Section>
          <List title="Logs típicos" items={ins.typicalLogs} />
          <List title="Métricas típicas" items={ins.typicalMetrics} />
        </div>
      )}

      {tab === 'troubleshooting' && (
        <div role="tabpanel">
          {faults.length > 0 && (
            <Section title="Fallos inyectables en este componente">
              {faults.map((f) => {
                const on = engine.activeFaults.has(f.id);
                return (
                  <div key={f.id} className={`cfl-fault-card ${on ? 'on' : ''}`}>
                    <label className="cfl-toggle">
                      <input type="checkbox" checked={on} onChange={(e) => dispatch({ type: 'toggleFault', faultId: f.id, enabled: e.target.checked })} />
                      <b>{f.title}</b>
                    </label>
                    <p className="cfl-muted">{f.description}</p>
                    <p>
                      <b>Diagnóstico:</b> {f.diagnosis}
                    </p>
                  </div>
                );
              })}
            </Section>
          )}
          {ins.failureModes.length > 0 && (
            <Section title="Fallos comunes">
              {ins.failureModes.map((f) => (
                <details key={f.name} className="cfl-details" open>
                  <summary>{f.name}</summary>
                  <dl className="cfl-dl">
                    <dt>Síntomas</dt>
                    <dd>{f.symptoms}</dd>
                    <dt>Diagnóstico</dt>
                    <dd>{f.diagnosis}</dd>
                    <dt>Mitigación</dt>
                    <dd>{f.mitigation}</dd>
                  </dl>
                </details>
              ))}
            </Section>
          )}
        </div>
      )}
      <footer className="cfl-ins-foot">
        <button className="cfl-linklike small" onClick={() => selectNode(undefined)}>
          Cerrar selección
        </button>
      </footer>
    </div>
  );
}

// -------------------------------------------------------------------- edge

function EdgeInspector({ engine, edgeId }: { engine: SimulationEngine; edgeId: string }) {
  const selectNode = useSim((s) => s.selectNode);
  const selectEdge = useSim((s) => s.selectEdge);
  const scenario = engine.scenario;
  const e = scenario.edges.find((x) => x.id === edgeId)!;
  const nodeById = new Map(scenario.nodes.map((n) => [n.id, n]));
  const cls = edgeClass(e, nodeById);
  const src = nodeById.get(e.source);
  const tgt = nodeById.get(e.target);
  const active = [...engine.transfers.values()].filter((t) => t.edgeId === e.id);
  const faults = scenario.faults.filter((f) => f.component === e.target || f.component === e.source);
  const isDataPlane = e.traffic === 'north-south' || e.traffic === 'east-west';
  const flowStep = (function find(st: typeof scenario.request.root, parent?: string): typeof scenario.request.root | undefined {
    if (parent === e.source && st.component === e.target) return st;
    for (const c of st.children ?? []) {
      const r = find(c, st.component);
      if (r) return r;
    }
    return undefined;
  })(scenario.request.root);

  return (
    <div className="cfl-ins-body">
      <header className="cfl-ins-head">
        <div className="cfl-ins-kicker">Conexión · {e.id}</div>
        <div className="cfl-ins-title">
          <span className={`cfl-ins-icon cls-${cls}`} aria-hidden>
            <ArrowRightLeft size={18} />
          </span>
          <h3>
            {src?.label ?? e.source} → {tgt?.label ?? e.target}
          </h3>
        </div>
        <div className="cfl-ins-role">{EDGE_CLASS_LABEL[cls]}</div>
        <div className="cfl-ins-meta">
          <span className={`cfl-edge-tag cls-${cls}`}>{e.traffic}</span>
          {active.length > 0 && <span className="cfl-chip">{active.length} transferencias activas</span>}
        </div>
      </header>
      <KV
        rows={[
          [
            'Origen',
            <button className="cfl-linklike" onClick={() => selectNode(e.source)}>
              {src?.label} <span className="mono muted">({e.source})</span>
            </button>,
          ],
          [
            'Destino',
            <button className="cfl-linklike" onClick={() => selectNode(e.target)}>
              {tgt?.label} <span className="mono muted">({e.target})</span>
            </button>,
          ],
          ['Protocolo', <span className="mono">{e.protocol}</span>],
          ['Puerto', e.port ? <span className="mono">{e.port}</span> : undefined],
          ['Dirección', 'El origen inicia; las respuestas (o el pull) viajan en sentido inverso por el mismo edge.'],
          ['Regla de enrutado', e.routingRule ? <span className="mono">{e.routingRule}</span> : undefined],
          ['Latencia de red modelada', isDataPlane ? <span className="mono">{`${e.latencyMs[0]}–${e.latencyMs[1]} ms (sintética)`}</span> : undefined],
          ['Paso del flujo de request', flowStep ? <span className="mono">{`${flowStep.operation}${flowStep.timeoutMs ? ` · deadline ${flowStep.timeoutMs} ms` : ''}${flowStep.retries ? ` · ${flowStep.retries} reintento(s)` : ''}${flowStep.async ? ' · asíncrono' : ''}`}</span> : undefined],
          ['Visible en', e.advanced ? 'modo avanzado' : 'todas las vistas'],
        ]}
      />
      {faults.length > 0 && (
        <Section title="Fallos pertinentes (en sus extremos)">
          <ul className="cfl-ins-list">
            {faults.map((f) => (
              <li key={f.id}>
                {f.title} {engine.activeFaults.has(f.id) ? <b className="status-text status-failed">· inyectado</b> : null}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Eventos recientes en esta conexión">
        <EventList engine={engine} events={recentEvents(engine, (ev) => ev.edgeId === e.id)} />
      </Section>
      <footer className="cfl-ins-foot">
        <button className="cfl-linklike small" onClick={() => selectEdge(undefined)}>
          Cerrar selección
        </button>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------- event

function EventInspector({ engine, ev }: { engine: SimulationEngine; ev: SimulationEvent }) {
  const selectNode = useSim((s) => s.selectNode);
  const selectEdge = useSim((s) => s.selectEdge);
  const selectEvent = useSim((s) => s.selectEvent);
  const selectTrace = useSim((s) => s.selectTrace);
  const setConsoleTab = useSim((s) => s.setConsoleTab);
  const node = engine.nodes.get(ev.componentId);
  const parentStart = ev.parentSpanId ? engine.log.find((x) => x.type === 'span.start' && x.spanId === ev.parentSpanId) : undefined;
  const spanStart = ev.spanId && ev.type !== 'span.start' ? engine.log.find((x) => x.type === 'span.start' && x.spanId === ev.spanId) : undefined;
  return (
    <div className="cfl-ins-body">
      <header className="cfl-ins-head">
        <div className="cfl-ins-kicker">
          Evento · {ev.domain} · seq {ev.seq}
        </div>
        <div className="cfl-ins-title">
          <span className={`cfl-ins-icon sev-${ev.severity}`} aria-hidden>
            <ScrollText size={18} />
          </span>
          <h3 className="mono">{ev.type}</h3>
        </div>
        <p className={`cfl-ins-lead sev-${ev.severity}`}>{ev.message}</p>
      </header>
      <KV
        rows={[
          ['Timestamp virtual', <span className="mono">{ev.virtualTime.toFixed(3)} ms</span>],
          ['Nivel', <span className={`mono sev-${ev.severity}`}>{ev.severity.toUpperCase()}</span>],
          [
            'Componente',
            <button className="cfl-linklike" onClick={() => selectNode(ev.componentId)}>
              {node?.label ?? ev.componentId} <span className="mono muted">({ev.componentId})</span>
            </button>,
          ],
          [
            'Conexión',
            ev.edgeId ? (
              <button className="cfl-linklike mono" onClick={() => selectEdge(ev.edgeId)}>
                {ev.edgeId}
              </button>
            ) : undefined,
          ],
          ['Servicio', ev.service],
          ['Escenario', <span className="mono">{ev.scenarioId}</span>],
          ['Proveedor', ev.provider],
          ['event_id', <span className="mono">{ev.id}</span>],
          ['trace_id', ev.traceId ? <span className="mono">{ev.traceId}</span> : undefined],
          ['span_id', ev.spanId ? <span className="mono">{ev.spanId}</span> : undefined],
          ['parent_span_id', ev.parentSpanId ? <span className="mono">{ev.parentSpanId}</span> : undefined],
          ['Transición', ev.stateTransition ? <span className="mono">{`${ev.stateTransition.from ?? '—'} → ${ev.stateTransition.to}`}</span> : undefined],
        ]}
      />
      {(parentStart || spanStart || ev.traceId) && (
        <Section title="Relación causal">
          <div className="cfl-ins-actions">
            {spanStart && (
              <button className="cfl-btn small" onClick={() => selectEvent(spanStart.seq)}>
                Inicio de este span
              </button>
            )}
            {parentStart && (
              <button className="cfl-btn small" onClick={() => selectEvent(parentStart.seq)}>
                Span padre ({engine.nodes.get(parentStart.componentId)?.label ?? parentStart.componentId})
              </button>
            )}
            {ev.traceId && (
              <button
                className="cfl-btn small"
                onClick={() => {
                  selectTrace(ev.traceId);
                  setConsoleTab('traces');
                }}
              >
                Ver traza completa
              </button>
            )}
          </div>
        </Section>
      )}
      <Section title="Payload">
        <pre className="cfl-code">{JSON.stringify(ev.payload, null, 2)}</pre>
      </Section>
      <footer className="cfl-ins-foot">
        <button className="cfl-linklike small" onClick={() => selectEvent(undefined)}>
          Cerrar evento
        </button>
      </footer>
    </div>
  );
}
