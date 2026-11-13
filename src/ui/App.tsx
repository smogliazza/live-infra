import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Header } from './components/Header';
import { FlowCanvas } from './components/FlowCanvas';
import { Inspector } from './components/Inspector';
import { Console } from './components/Console';
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

/** Atajos: espacio = play/pausa, → paso, ← paso atrás, r = request. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const s = useSim.getState();
      if (e.key === ' ' && el.tagName !== 'BUTTON') {
        e.preventDefault();
        s.togglePlay();
      } else if (e.key === 'ArrowRight' && e.shiftKey) s.stepForward();
      else if (e.key === 'ArrowLeft' && e.shiftKey) s.stepBack();
      else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) s.dispatch({ type: 'startRequest' });
      else if (e.key === 'Escape') s.selectNode(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useClock();
  useShortcuts();
  return (
    <ReactFlowProvider>
      <div className="cfl-app">
        <Header />
        <main className="cfl-main">
          <FlowCanvas />
          <Inspector />
        </main>
        <Console />
        <footer className="cfl-footer">
          Simulación educativa 100% sintética · no conecta con cuentas cloud · atajos: espacio play/pausa · shift+→/← paso · r request · esc cerrar inspector
        </footer>
      </div>
    </ReactFlowProvider>
  );
}
