import { useEffect } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { Header } from './components/Header';
import { FlowCanvas } from './components/FlowCanvas';
import { Inspector } from './components/Inspector';
import { Console } from './components/Console';
import { ComparePanel, CompareView } from './components/Compare';
import { useSim } from './state/store';

/** Bucle de reloj: convierte tiempo real en tiempo virtual según la velocidad. */
function useClock() {
  const tick = useSim((s) => s.tick);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      tick(t - last);
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tick]);
}

/** Atajos: espacio play/pausa · shift+→/← paso · r request · c centrar · f ajustar · esc limpiar selección. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useSim.getState();
      if (e.key === ' ' && el.tagName !== 'BUTTON' && el.tagName !== 'SUMMARY') {
        e.preventDefault();
        s.togglePlay();
      } else if (e.key === 'ArrowRight' && e.shiftKey) s.stepForward();
      else if (e.key === 'ArrowLeft' && e.shiftKey) s.stepBack();
      else if (e.key === 'r') s.dispatch({ type: 'startRequest' });
      else if (e.key === 'c') s.requestCenter();
      else if (e.key === 'f') s.requestFit();
      else if (e.key === 'Escape') {
        s.selectNode(undefined);
        s.selectEdge(undefined);
        s.selectEvent(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function InspectorSplitter() {
  const width = useSim((s) => s.inspectorWidth);
  const setWidth = useSim((s) => s.setInspectorWidth);
  const onDrag = (ev: React.PointerEvent) => {
    const startX = ev.clientX;
    const startW = width;
    const move = (e: PointerEvent) => setWidth(startW + (startX - e.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing');
    };
    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className="cfl-vsplit"
      onPointerDown={onDrag}
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar inspector"
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setWidth(width + 24);
        if (e.key === 'ArrowRight') setWidth(width - 24);
      }}
    />
  );
}

export function App() {
  const compare = useSim((s) => Boolean(s.compareEngine));
  const playing = useSim((s) => s.playing);
  const reducedMotion = useSim((s) => s.reducedMotion);
  const inspectorOpen = useSim((s) => s.inspectorOpen);
  const inspectorWidth = useSim((s) => s.inspectorWidth);
  const setInspectorOpen = useSim((s) => s.setInspectorOpen);
  useClock();
  useShortcuts();
  const columns = inspectorOpen ? `minmax(0, 1fr) 6px ${compare ? Math.max(inspectorWidth, 520) : inspectorWidth}px` : 'minmax(0, 1fr) 36px';
  return (
    <div className={`cfl-app ${playing ? 'is-playing' : 'is-paused'} ${reducedMotion ? 'reduced-motion' : ''}`}>
      <Header />
      <main className="cfl-main" style={{ gridTemplateColumns: columns }}>
        {compare ? <CompareView /> : <FlowCanvas />}
        {inspectorOpen ? (
          <>
            <InspectorSplitter />
            {compare ? <ComparePanel /> : <Inspector />}
          </>
        ) : (
          <button className="cfl-rail" onClick={() => setInspectorOpen(true)} aria-label="Mostrar inspector" title="Mostrar inspector" data-testid="inspector-open">
            <PanelRightOpen size={16} />
            <span>Inspector</span>
          </button>
        )}
      </main>
      <Console />
      <footer className="cfl-footer">
        Simulación educativa 100% sintética · no conecta con cuentas cloud · atajos: espacio play/pausa · shift+→/← paso · r request · c centrar · f ajustar · esc limpiar selección
      </footer>
    </div>
  );
}
