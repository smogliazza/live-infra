import { providers } from '../../catalog';
import { SPEEDS, useEngine, useSim } from '../state/store';

const LOADS = [0, 5, 20, 50, 100];

export function Header() {
  const engine = useEngine();
  const s = useSim();
  const profile = providers.find((p) => p.id === s.providerId)!;
  const running = engine.delivery.status === 'running' || engine.delivery.status === 'rolling-back';
  const activeFaults = engine.activeFaults.size;

  return (
    <header className="cfl-header">
      <div className="cfl-brand">
        <span className="cfl-logo" aria-hidden>
          ◇
        </span>
        <span>Cloud Flow Lab</span>
        <span className="cfl-sim-badge" title="Todos los datos, tiempos, logs y configuraciones son sintéticos">
          SIMULADO
        </span>
      </div>

      <div className="cfl-group" role="group" aria-label="Proveedor y escenario">
        <label className="cfl-field">
          <span>Proveedor</span>
          <select
            aria-label="Proveedor"
            value={s.providerId}
            onChange={(ev) => {
              const p = providers.find((x) => x.id === ev.target.value)!;
              s.setScenario(p.id, p.scenarios[0]!.id);
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.shortName}
              </option>
            ))}
          </select>
        </label>
        <label className="cfl-field">
          <span>Escenario</span>
          <select value={s.scenarioId} onChange={(ev) => s.setScenario(s.providerId, ev.target.value)}>
            {profile.scenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.title}
              </option>
            ))}
          </select>
        </label>
        <label className="cfl-field" title="Ejecuta el mismo escenario, con los mismos comandos y fallos, en un segundo proveedor">
          <span>Comparar con</span>
          <select aria-label="Comparar con" value={s.compareProviderId ?? ''} onChange={(ev) => s.setCompare(ev.target.value || undefined)} data-testid="compare-select">
            <option value="">—</option>
            {providers
              .filter((p) => p.id !== s.providerId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.shortName}
                </option>
              ))}
          </select>
        </label>
        <label className="cfl-toggle" title="Modo avanzado: muestra resolver DNS, SQS, watches del kubelet, image pulls y APIs de Terraform">
          <input type="checkbox" checked={s.advancedView} onChange={(ev) => s.setAdvancedView(ev.target.checked)} />
          <span>Avanzado</span>
        </label>
        <label className="cfl-toggle" title="Sustituye el movimiento de los pulsos por marcadores estáticos">
          <input type="checkbox" checked={s.reducedMotion} onChange={(ev) => s.setReducedMotion(ev.target.checked)} />
          <span>Movimiento reducido</span>
        </label>
      </div>

      <div className="cfl-group" role="group" aria-label="Controles de simulación">
        <button
          className="cfl-btn"
          onClick={s.stepBack}
          disabled={engine.jobsProcessed === 0 || Boolean(s.compareEngine)}
          title={s.compareEngine ? 'Paso atrás no disponible en modo comparación' : 'Retroceder un paso (replay determinista)'}
          aria-label="Paso atrás"
        >
          ⏮
        </button>
        <button className="cfl-btn primary" onClick={s.togglePlay} aria-label={s.playing ? 'Pausar' : 'Reanudar'} data-testid="play-toggle">
          {s.playing ? '⏸ Pausa' : '▶ Play'}
        </button>
        <button className="cfl-btn" onClick={s.stepForward} disabled={engine.pendingJobs === 0} title="Avanzar un paso" aria-label="Paso adelante" data-testid="step-forward">
          ⏭
        </button>
        <button className="cfl-btn" onClick={s.reset} title="Reiniciar simulación (limpia fallos y eventos)" aria-label="Reiniciar">
          ↺
        </button>
        <label className="cfl-field">
          <span>Velocidad</span>
          <select value={s.speed} onChange={(ev) => s.setSpeed(Number(ev.target.value))} aria-label="Velocidad">
            {SPEEDS.map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </label>
        <span className="cfl-clock" title="Tiempo virtual. Request: 1 ms virtual = 1 ms modelado. Delivery: 1 ms virtual = 1 s modelado." data-testid="clock">
          t={engine.now.toFixed(1)} ms
        </span>
      </div>

      <div className="cfl-group" role="group" aria-label="Acciones">
        <button className="cfl-btn accent" onClick={() => s.dispatch({ type: 'startRequest' })} data-testid="send-request">
          ● Enviar request
        </button>
        <label className="cfl-field">
          <span>Carga</span>
          <select value={engine.loadRps} onChange={(ev) => s.dispatch({ type: 'setLoad', rps: Number(ev.target.value) })} aria-label="Carga en RPS">
            {LOADS.map((v) => (
              <option key={v} value={v}>
                {v === 0 ? 'off' : `${v} RPS`}
              </option>
            ))}
          </select>
        </label>
        <button className="cfl-btn delivery" onClick={() => s.dispatch({ type: 'startRelease' })} disabled={running} data-testid="start-release">
          ◆ Release
        </button>
        <button
          className="cfl-btn delivery"
          onClick={() => s.dispatch({ type: 'startInfraChange' })}
          disabled={engine.iac.status === 'running' || engine.iac.status === 'blocked'}
          data-testid="start-terraform"
        >
          ◆ Terraform
        </button>
        {engine.iac.awaitingApproval && (
          <button className="cfl-btn warn" onClick={() => s.dispatch({ type: 'approve' })} data-testid="approve-plan">
            ✔ Aprobar plan
          </button>
        )}
        <button className={`cfl-btn ${activeFaults ? 'danger' : ''}`} onClick={() => s.setConsoleTab('faults')} data-testid="open-faults">
          ⚠ Fallos{activeFaults ? ` (${activeFaults})` : ''}
        </button>
      </div>
    </header>
  );
}
