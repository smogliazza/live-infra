import { Blocks, CircleCheck, GitCompare, Layers, Moon, Pause, Play, RotateCcw, Rocket, Send, SkipBack, SkipForward, Sun, TriangleAlert } from 'lucide-react';
import { providers } from '../../catalog';
import { SPEEDS, useEngine, useSim } from '../state/store';
import { LAYERS, nodeLayers } from '../layers';

const LOADS = [0, 5, 20, 50, 100];

function Group({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`cfl-hgroup ${className}`} role="group" aria-label={label}>
      <span className="cfl-hgroup-label" aria-hidden>
        {label}
      </span>
      <div className="cfl-hgroup-body">{children}</div>
    </div>
  );
}

export function Header() {
  const engine = useEngine();
  const s = useSim();
  const profile = providers.find((p) => p.id === s.providerId)!;
  const releaseRunning = engine.delivery.status === 'running' || engine.delivery.status === 'rolling-back';
  const iacBusy = engine.iac.status === 'running' || engine.iac.status === 'blocked';
  const activeFaults = engine.activeFaults.size;
  const layersPresent = new Set(engine.scenario.nodes.flatMap((n) => nodeLayers(n, engine.catalog.get(n.service))));
  layersPresent.add('cloud');

  return (
    <header className={`cfl-header ${s.playing ? 'is-playing' : 'is-paused'}`}>
      <div className="cfl-hrow">
        <div className="cfl-brand">
          <svg className="cfl-logo" width="20" height="20" viewBox="0 0 20 20" aria-hidden>
            <path d="M10 1.5 18.5 10 10 18.5 1.5 10z" className="cfl-logo-outer" />
            <circle cx="10" cy="10" r="2.6" className="cfl-logo-core" />
          </svg>
          <span className="cfl-brand-name">Cloud Flow Lab</span>
          <span className="cfl-sim-badge" title="Todos los datos, tiempos, logs y configuraciones son sintéticos">
            SIMULADO
          </span>
        </div>

        <Group label="Contexto">
          <label className="cfl-field">
            <span className="sr-only">Proveedor</span>
            <select
              aria-label="Proveedor"
              value={s.providerId}
              onChange={(ev) => {
                const p = providers.find((x) => x.id === ev.target.value)!;
                s.setScenario(p.id, p.scenarios[0]!.id);
              }}
              title="Proveedor cloud"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.shortName}
                </option>
              ))}
            </select>
          </label>
          <label className="cfl-field">
            <span className="sr-only">Escenario</span>
            <select aria-label="Escenario" value={s.scenarioId} onChange={(ev) => s.setScenario(s.providerId, ev.target.value)} title="Escenario">
              {profile.scenarios.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.title}
                </option>
              ))}
            </select>
          </label>
          <label className="cfl-field with-icon" title="Ejecuta el mismo escenario, con los mismos comandos y fallos, en un segundo proveedor">
            <GitCompare size={14} aria-hidden />
            <select aria-label="Comparar con" value={s.compareProviderId ?? ''} onChange={(ev) => s.setCompare(ev.target.value || undefined)} data-testid="compare-select">
              <option value="">Sin comparar</option>
              {providers
                .filter((p) => p.id !== s.providerId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    vs {p.shortName}
                  </option>
                ))}
            </select>
          </label>
        </Group>
        <span className="cfl-spacer" />
        <Group label="Vista">
          <details className="cfl-popover">
            <summary className="cfl-btn subtle" title="Capas de lectura del canvas" data-testid="layers-menu">
              <Layers size={14} /> Capas{s.hiddenLayers.length ? ` (${LAYERS.length - s.hiddenLayers.length}/${LAYERS.length})` : ''}
            </summary>
            <div className="cfl-popover-body" role="menu">
              <p className="cfl-muted small">Atenúa elementos sin cambiar la simulación ni sus relaciones.</p>
              {LAYERS.map((l) => {
                const present = layersPresent.has(l.id);
                return (
                  <label
                    key={l.id}
                    className={`cfl-toggle cfl-layer-toggle ${present ? '' : 'is-disabled'}`}
                    title={present ? l.description : 'Este escenario no tiene componentes de esta capa'}
                  >
                    <input
                      type="checkbox"
                      checked={present && !s.hiddenLayers.includes(l.id)}
                      disabled={!present}
                      onChange={() => s.toggleLayer(l.id)}
                      data-testid={`layer-${l.id}`}
                    />
                    <span className={`cfl-layer-dot layer-${l.id}`} />
                    <span>
                      {l.label}
                      <span className="cfl-muted small"> — {present ? l.description : 'sin componentes en este escenario'}</span>
                    </span>
                  </label>
                );
              })}
              <hr />
              <label className="cfl-toggle" title="Muestra resolver DNS, colas, watches del kubelet, image pulls y APIs de Terraform">
                <input type="checkbox" checked={s.advancedView} onChange={(ev) => s.setAdvancedView(ev.target.checked)} /> Detalle avanzado
              </label>
              <label className="cfl-toggle" title="Sustituye el movimiento de los pulsos por marcadores estáticos">
                <input type="checkbox" checked={s.reducedMotion} onChange={(ev) => s.setReducedMotion(ev.target.checked)} /> Movimiento reducido
              </label>
            </div>
          </details>
          <button
            className="cfl-icon-btn"
            onClick={() => s.setTheme(s.theme === 'dark' ? 'light' : 'dark')}
            aria-label={s.theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            title={s.theme === 'dark' ? 'Tema: Dark Graphite (cambiar a Light Technical)' : 'Tema: Light Technical (cambiar a Dark Graphite)'}
            data-testid="theme-toggle"
          >
            {s.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </Group>
      </div>

      <div className="cfl-hrow">
        <Group label="Simulación">
          <button
            className="cfl-icon-btn"
            onClick={s.stepBack}
            disabled={engine.jobsProcessed === 0 || Boolean(s.compareEngine)}
            title={s.compareEngine ? 'Paso atrás no disponible en modo comparación' : 'Paso atrás — replay determinista (shift+←)'}
            aria-label="Paso atrás"
          >
            <SkipBack size={15} />
          </button>
          <button className="cfl-btn primary" onClick={s.togglePlay} aria-label={s.playing ? 'Pausar' : 'Reanudar'} data-testid="play-toggle" title="Play / pausa (espacio)">
            {s.playing ? <Pause size={15} /> : <Play size={15} />}
            {s.playing ? 'Pausa' : 'Play'}
          </button>
          <button
            className="cfl-icon-btn"
            onClick={s.stepForward}
            disabled={engine.pendingJobs === 0}
            title="Paso adelante (shift+→)"
            aria-label="Paso adelante"
            data-testid="step-forward"
          >
            <SkipForward size={15} />
          </button>
          <button className="cfl-icon-btn" onClick={s.reset} title="Reiniciar simulación (limpia eventos y fallos)" aria-label="Reiniciar">
            <RotateCcw size={15} />
          </button>
          <label className="cfl-field">
            <span className="sr-only">Velocidad</span>
            <select value={s.speed} onChange={(ev) => s.setSpeed(Number(ev.target.value))} aria-label="Velocidad" title="Velocidad de reproducción">
              {SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
          <span className="cfl-clock" title="Tiempo virtual. Request: 1 ms virtual = 1 ms modelado. Delivery: 1 ms virtual = 1 s modelado." data-testid="clock">
            <span className={`cfl-clock-dot ${s.playing ? 'on' : ''}`} aria-hidden />
            t={engine.now.toFixed(1)} ms
            <span className="sr-only">{s.playing ? 'en reproducción' : 'en pausa'}</span>
          </span>
        </Group>

        <Group label="Acciones">
          <button
            className="cfl-btn accent-traffic"
            onClick={() => s.dispatch({ type: 'startRequest' })}
            data-testid="send-request"
            title="Envía una request por el data plane (r)"
          >
            <Send size={14} /> Request
          </button>
          <label className="cfl-field" title="Generador de carga (requests concurrentes)">
            <span className="sr-only">Carga</span>
            <select value={engine.loadRps} onChange={(ev) => s.dispatch({ type: 'setLoad', rps: Number(ev.target.value) })} aria-label="Carga en RPS">
              {LOADS.map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? 'Carga: off' : `Carga: ${v} RPS`}
                </option>
              ))}
            </select>
          </label>
          <button
            className="cfl-btn accent-build"
            onClick={() => s.dispatch({ type: 'startRelease' })}
            disabled={releaseRunning}
            data-testid="start-release"
            title="Push → CI → registry → GitOps → Argo CD → rollout"
          >
            <Rocket size={14} /> Release
          </button>
          <button
            className="cfl-btn accent-build"
            onClick={() => s.dispatch({ type: 'startInfraChange' })}
            disabled={iacBusy}
            data-testid="start-terraform"
            title="init → lock → plan → aprobación → apply"
          >
            <Blocks size={14} /> Terraform
          </button>
          {engine.iac.awaitingApproval && (
            <button className="cfl-btn warn" onClick={() => s.dispatch({ type: 'approve' })} data-testid="approve-plan" title="Aprobar el plan de Terraform pendiente">
              <CircleCheck size={14} /> Aprobar plan
            </button>
          )}
          <button
            className={`cfl-btn ${activeFaults ? 'danger' : 'subtle'}`}
            onClick={() => s.setConsoleTab('faults')}
            data-testid="open-faults"
            title="Inyectar fallos (acción disruptiva)"
          >
            <TriangleAlert size={14} /> Fallos{activeFaults ? ` (${activeFaults})` : ''}
          </button>
        </Group>
      </div>
    </header>
  );
}
