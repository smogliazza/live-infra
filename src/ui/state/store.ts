/**
 * Estado de UI. El motor vive fuera de React; el store guarda una referencia
 * y un contador `frame` que fuerza el re-render cuando el motor avanza.
 * Separación: estado del motor (engine) vs. estado de UI (selección, vista).
 */
import { create } from 'zustand';
import { providers } from '../../catalog';
import { SimulationEngine } from '../../engine/engine';
import type { Command } from '../../engine/events';
import { computeMetrics, type MetricsSnapshot } from '../../engine/observability';

/** ms virtuales que avanzan por cada ms real a velocidad 1x (10 ms virtuales/s). */
export const VIRTUAL_PER_REAL_MS = 0.01;
export const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 25] as const;

export type ConsoleTab = 'events' | 'traces' | 'metrics' | 'delivery' | 'faults';

interface MetricsSample {
  t: number;
  rps: number;
  p95: number;
  errorRate: number;
}

export interface SimStore {
  providerId: string;
  scenarioId: string;
  seed: number;
  engine: SimulationEngine;
  frame: number;
  playing: boolean;
  speed: number;
  advancedView: boolean;
  reducedMotion: boolean;
  selectedNodeId?: string;
  selectedEventSeq?: number;
  selectedTraceId?: string;
  filterBySelectedNode: boolean;
  consoleTab: ConsoleTab;
  consoleOpen: boolean;
  consoleHeight: number;
  metricsHistory: MetricsSample[];
  /** Modo comparación: un segundo motor recibe los mismos comandos. */
  compareProviderId?: string;
  compareEngine?: SimulationEngine;

  tick(realDeltaMs: number): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  stepForward(): void;
  stepBack(): void;
  reset(): void;
  setSpeed(speed: number): void;
  dispatch(command: Command): void;
  selectNode(id?: string): void;
  selectEvent(seq?: number): void;
  selectTrace(traceId?: string): void;
  setFilterBySelectedNode(v: boolean): void;
  setConsoleTab(tab: ConsoleTab): void;
  setConsoleOpen(open: boolean): void;
  setConsoleHeight(h: number): void;
  setAdvancedView(v: boolean): void;
  setReducedMotion(v: boolean): void;
  setScenario(providerId: string, scenarioId: string): void;
  setCompare(providerId?: string): void;
}

function createEngine(providerId: string, scenarioId: string, seed: number): SimulationEngine {
  const profile = providers.find((p) => p.id === providerId) ?? providers[0]!;
  const scenario = profile.scenarios.find((s) => s.id === scenarioId) ?? profile.scenarios[0]!;
  return new SimulationEngine(scenario, profile.services, { seed });
}

const prefersReducedMotion =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

const SAMPLE_EVERY_VMS = 10;
const MAX_SAMPLES = 120;

export const useSim = create<SimStore>((set, get) => {
  const initialProvider = providers[0]!;
  const initialScenario = initialProvider.scenarios[0]!;
  let lastSampleAt = -Infinity;

  const sample = (engine: SimulationEngine, history: MetricsSample[]): MetricsSample[] => {
    if (engine.now - lastSampleAt < SAMPLE_EVERY_VMS) return history;
    lastSampleAt = engine.now;
    const m: MetricsSnapshot = computeMetrics(engine, 200);
    const next = [...history, { t: engine.now, rps: m.rps, p95: m.p95, errorRate: m.errorRate }];
    return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
  };

  const bump = (extra: Partial<SimStore> = {}) =>
    set((s) => ({ frame: s.frame + 1, metricsHistory: sample(s.engine, s.metricsHistory), ...extra }));

  return {
    providerId: initialProvider.id,
    scenarioId: initialScenario.id,
    seed: 20261113,
    engine: createEngine(initialProvider.id, initialScenario.id, 20261113),
    frame: 0,
    playing: true,
    speed: 1,
    advancedView: true,
    reducedMotion: prefersReducedMotion,
    filterBySelectedNode: true,
    consoleTab: 'events',
    consoleOpen: true,
    consoleHeight: 260,
    metricsHistory: [],

    tick(realDeltaMs) {
      const s = get();
      if (!s.playing) return;
      const dv = Math.min(realDeltaMs, 100) * VIRTUAL_PER_REAL_MS * s.speed;
      const target = s.engine.now + dv;
      s.engine.advanceTo(target);
      s.compareEngine?.advanceTo(target);
      bump();
    },
    play: () => set({ playing: true }),
    pause: () => set({ playing: false }),
    togglePlay: () => set((s) => ({ playing: !s.playing })),
    stepForward() {
      const s = get();
      if (s.compareEngine) {
        // Dos motores: avanzar ambos hasta el siguiente instante con trabajo.
        const next = Math.min(s.engine.nextJobTime() ?? Infinity, s.compareEngine.nextJobTime() ?? Infinity);
        if (Number.isFinite(next)) {
          s.engine.advanceTo(next);
          s.compareEngine.advanceTo(next);
        }
      } else {
        s.engine.step();
      }
      bump({ playing: false });
    },
    stepBack() {
      const s = get();
      if (s.engine.jobsProcessed === 0 || s.compareEngine) return;
      const e = s.engine;
      const rebuilt = SimulationEngine.replay(e.scenario, [...e.catalog.values()], e.seed, e.commands, e.jobsProcessed - 1);
      lastSampleAt = -Infinity;
      set((st) => ({ engine: rebuilt, playing: false, frame: st.frame + 1, metricsHistory: st.metricsHistory.filter((m) => m.t <= rebuilt.now) }));
    },
    reset() {
      const s = get();
      lastSampleAt = -Infinity;
      set({
        engine: createEngine(s.providerId, s.scenarioId, s.seed),
        compareEngine: s.compareProviderId ? createEngine(s.compareProviderId, '', s.seed) : undefined,
        frame: s.frame + 1,
        metricsHistory: [],
        selectedEventSeq: undefined,
        selectedTraceId: undefined,
      });
    },
    setSpeed: (speed) => set({ speed }),
    dispatch(command) {
      const s = get();
      s.engine.dispatch(command);
      // Mismo comando, mismo instante: escenario sincronizado. Los fallos
      // comparten id entre perfiles, así que se aplican en ambos.
      if (s.compareEngine) {
        s.compareEngine.advanceTo(s.engine.now);
        s.compareEngine.dispatch(command);
      }
      bump();
    },
    selectNode: (id) => set({ selectedNodeId: id }),
    selectEvent(seq) {
      const ev = seq === undefined ? undefined : get().engine.log[seq];
      set({ selectedEventSeq: seq, selectedTraceId: ev?.traceId ?? get().selectedTraceId });
    },
    selectTrace: (traceId) => set({ selectedTraceId: traceId }),
    setFilterBySelectedNode: (v) => set({ filterBySelectedNode: v }),
    setConsoleTab: (tab) => set({ consoleTab: tab, consoleOpen: true }),
    setConsoleOpen: (open) => set({ consoleOpen: open }),
    setConsoleHeight: (h) => set({ consoleHeight: Math.max(140, Math.min(h, 700)) }),
    setAdvancedView: (v) => set({ advancedView: v }),
    setReducedMotion: (v) => set({ reducedMotion: v }),
    setCompare(compareProviderId) {
      const s = get();
      lastSampleAt = -Infinity;
      if (!compareProviderId || compareProviderId === s.providerId) {
        set({ compareProviderId: undefined, compareEngine: undefined, frame: s.frame + 1 });
        return;
      }
      // Reiniciar ambos para que empiecen sincronizados en t=0.
      set({
        compareProviderId,
        engine: createEngine(s.providerId, s.scenarioId, s.seed),
        compareEngine: createEngine(compareProviderId, '', s.seed),
        frame: s.frame + 1,
        metricsHistory: [],
        selectedEventSeq: undefined,
        selectedTraceId: undefined,
      });
    },
    setScenario(providerId, scenarioId) {
      lastSampleAt = -Infinity;
      set((s) => ({
        providerId,
        scenarioId,
        engine: createEngine(providerId, scenarioId, s.seed),
        ...(s.compareProviderId === providerId ? { compareProviderId: undefined, compareEngine: undefined } : {}),
        ...(s.compareProviderId && s.compareProviderId !== providerId ? { compareEngine: createEngine(s.compareProviderId, '', s.seed) } : {}),
        frame: s.frame + 1,
        metricsHistory: [],
        selectedNodeId: undefined,
        selectedEventSeq: undefined,
        selectedTraceId: undefined,
      }));
    },
  };
});

/** Re-render en cada frame del motor y devuelve el motor actual. */
export function useEngine(): SimulationEngine {
  useSim((s) => s.frame);
  return useSim((s) => s.engine);
}
