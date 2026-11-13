import { glossary } from '../../catalog/glossary';
import { nodeVisualStatus } from '../../engine/observability';
import { useEngine, useSim } from '../state/store';
import { STATUS_LABEL } from './status';

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="cfl-ins-section">
      <h4>{title}</h4>
      <ul>
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </section>
  );
}

export function Inspector() {
  const engine = useEngine();
  const selectedNodeId = useSim((s) => s.selectedNodeId);
  const selectNode = useSim((s) => s.selectNode);
  const selectEvent = useSim((s) => s.selectEvent);
  const scenario = engine.scenario;
  const node = selectedNodeId ? engine.nodes.get(selectedNodeId) : undefined;

  if (!node) {
    return (
      <aside className="cfl-inspector" aria-label="Inspector">
        <div className="cfl-ins-head">
          <div className="cfl-ins-kicker">Escenario · {scenario.providerId.toUpperCase()}</div>
          <h3>{scenario.title}</h3>
        </div>
        <p>{scenario.description}</p>
        <section className="cfl-ins-section">
          <h4>Cómo usarlo</h4>
          <ol>
            <li>
              Pulsa <b>Enviar request</b> y sigue los pulsos: ● ida, ● más pequeño vuelta. Haz clic en un pulso para seleccionar su traza.
            </li>
            <li>
              Pulsa <b>Release</b>: los rombos ◆ son el flujo de delivery (más lento, otra escala temporal).
            </li>
            <li>Selecciona cualquier componente para ver qué hace, su configuración ilustrativa y sus fallos típicos.</li>
            <li>
              Abre <b>Fallos</b>, inyecta uno y diagnostícalo con la consola, las trazas y las métricas.
            </li>
          </ol>
        </section>
        <List title="Simplificaciones de esta simulación" items={scenario.simplifications} />
      </aside>
    );
  }

  const svc = engine.catalog.get(node.service)!;
  const ins = svc.inspector;
  const status = nodeVisualStatus(engine, node.id);
  const workload = engine.workloads.get(node.id);
  const incoming = scenario.edges.filter((e) => e.target === node.id);
  const outgoing = scenario.edges.filter((e) => e.source === node.id);
  const recent = [];
  for (let i = engine.log.length - 1; i >= 0 && recent.length < 8; i--) {
    const ev = engine.log[i]!;
    if (ev.componentId === node.id && ev.severity !== 'debug') recent.push(ev);
  }

  return (
    <aside className="cfl-inspector" aria-label={`Inspector de ${node.label}`} data-testid="inspector">
      <div className="cfl-ins-head">
        <div className="cfl-ins-kicker">
          {svc.provider === 'generic' ? 'Agnóstico' : svc.provider.toUpperCase()} · {svc.category} · capa {svc.layer} · {svc.plane} plane
        </div>
        <h3>{svc.name}</h3>
        <div className="cfl-ins-role">{svc.role}</div>
        <div className={`cfl-chip status-${status}`}>{STATUS_LABEL[status]}</div>
        <button className="cfl-btn small" onClick={() => selectNode(undefined)} aria-label="Cerrar inspector">
          ✕
        </button>
      </div>

      <p>{ins.summary}</p>
      <details open>
        <summary>Descripción técnica avanzada</summary>
        <p>{ins.advanced}</p>
      </details>

      {workload && (
        <section className="cfl-ins-section">
          <h4>
            Deployment {workload.namespace}/{workload.deployment} · v{workload.version}
            {workload.targetVersion ? ` → ${workload.targetVersion}` : ''}
          </h4>
          <table className="cfl-table">
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
                  <td>{p.version}</td>
                  <td className={`phase-${p.phase}`}>{p.phase}</td>
                  <td>{p.ready ? 'sí' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <List title="Recibe" items={ins.receives} />
      <List title="Procesa" items={ins.processes} />
      <List title="Emite" items={ins.emits} />

      <section className="cfl-ins-section">
        <h4>Conexiones</h4>
        <ul className="mono small">
          {incoming.map((e) => (
            <li key={e.id}>
              ← {e.source} · {e.protocol}
              {e.port ? ` :${e.port}` : ''} · {e.traffic}
            </li>
          ))}
          {outgoing.map((e) => (
            <li key={e.id}>
              → {e.target} · {e.protocol}
              {e.port ? ` :${e.port}` : ''} · {e.traffic}
              {e.routingRule ? <div className="cfl-muted">regla: {e.routingRule}</div> : null}
            </li>
          ))}
        </ul>
      </section>

      <List title="Protocolos" items={ins.protocols} />
      <List title="Puertos" items={ins.ports} />
      <List title="Identidad y permisos" items={ins.identity} />
      {ins.trustBoundary && (
        <section className="cfl-ins-section">
          <h4>Límite de confianza</h4>
          <p>{ins.trustBoundary}</p>
        </section>
      )}

      {ins.exampleConfig && (
        <section className="cfl-ins-section">
          <h4>
            Configuración de ejemplo <span className="cfl-tag">ILUSTRATIVA · no productiva</span>
          </h4>
          <pre className="cfl-code" aria-label={`Configuración ${ins.exampleConfig.language}`}>
            {ins.exampleConfig.code}
          </pre>
        </section>
      )}

      <section className="cfl-ins-section">
        <h4>Eventos recientes (simulados)</h4>
        {recent.length === 0 ? (
          <p className="cfl-muted">Sin eventos todavía.</p>
        ) : (
          <ul className="cfl-ins-events mono small">
            {recent.map((ev) => (
              <li key={ev.id}>
                <button className={`cfl-linklike sev-${ev.severity}`} onClick={() => selectEvent(ev.seq)}>
                  t={ev.virtualTime.toFixed(1)} {ev.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <List title="Logs típicos" items={ins.typicalLogs} />
      <List title="Métricas típicas" items={ins.typicalMetrics} />

      {ins.failureModes.length > 0 && (
        <section className="cfl-ins-section">
          <h4>Fallos comunes</h4>
          {ins.failureModes.map((f) => (
            <details key={f.name}>
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
        </section>
      )}

      {ins.docs.length > 0 && (
        <section className="cfl-ins-section">
          <h4>Documentación oficial</h4>
          <ul>
            {ins.docs.map((d) => (
              <li key={d.url}>
                <a href={d.url} target="_blank" rel="noreferrer noopener">
                  {d.title} ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {ins.glossary.length > 0 && (
        <section className="cfl-ins-section">
          <h4>Glosario</h4>
          <dl className="cfl-dl">
            {ins.glossary.map((g) => (
              <div key={g}>
                <dt>{g}</dt>
                <dd>{glossary[g] ?? 'Definición pendiente.'}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </aside>
  );
}
