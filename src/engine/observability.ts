/**
 * Vistas de observabilidad derivadas EXCLUSIVAMENTE del event stream.
 * Métricas, trazas y estados se calculan a partir de los mismos eventos
 * que alimentan la animación y la consola.
 */
import type { SimulationEngine } from './engine';
import type { SimulationEvent, VisualStatus } from './events';
import { isError } from './request';

export interface Span {
  spanId: string;
  parentSpanId?: string;
  componentId: string;
  operation: string;
  start: number;
  duration?: number;
  status?: number;
}

export interface Trace {
  traceId: string;
  spans: Span[];
  status: 'running' | 'ok' | 'error';
  httpStatus?: number;
  start: number;
  totalDuration?: number;
  origin?: string;
}

/** Busca índice del primer evento con virtualTime >= t (log ordenado). */
function lowerBound(log: SimulationEvent[], t: number): number {
  let lo = 0;
  let hi = log.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (log[mid]!.virtualTime < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function buildTrace(log: SimulationEvent[], traceId: string): Trace | undefined {
  const spans = new Map<string, Span>();
  let trace: Trace | undefined;
  for (const ev of log) {
    if (ev.traceId !== traceId) continue;
    if (ev.type === 'request.started') {
      trace = { traceId, spans: [], status: 'running', start: ev.virtualTime, origin: ev.payload.origin as string };
      spans.set(ev.spanId!, { spanId: ev.spanId!, componentId: ev.componentId, operation: 'client request', start: ev.virtualTime });
    } else if (ev.type === 'span.start' && ev.spanId) {
      spans.set(ev.spanId, {
        spanId: ev.spanId,
        parentSpanId: ev.parentSpanId,
        componentId: ev.componentId,
        operation: String(ev.payload.operation ?? ev.message),
        start: ev.virtualTime,
      });
    } else if (ev.type === 'span.end' && ev.spanId) {
      const s = spans.get(ev.spanId);
      if (s) {
        s.duration = ev.virtualTime - s.start;
        s.status = ev.payload.status as number;
      }
    } else if (ev.type === 'request.completed' && trace) {
      const status = ev.payload.status as number;
      trace.status = isError(status) ? 'error' : 'ok';
      trace.httpStatus = status;
      trace.totalDuration = ev.virtualTime - trace.start;
      const root = spans.get(ev.spanId!);
      if (root) {
        root.duration = trace.totalDuration;
        root.status = status;
      }
    }
  }
  if (!trace) return undefined;
  trace.spans = [...spans.values()].sort((a, b) => a.start - b.start);
  return trace;
}

export function listTraces(log: SimulationEvent[], limit = 50): Trace[] {
  const ids: string[] = [];
  for (let i = log.length - 1; i >= 0 && ids.length < limit; i--) {
    const ev = log[i]!;
    if (ev.type === 'request.started' && ev.traceId) ids.push(ev.traceId);
  }
  return ids.map((id) => buildTrace(log, id)).filter((t): t is Trace => Boolean(t));
}

export interface MetricsSnapshot {
  windowMs: number;
  rps: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  cacheHitRatio: number | null;
  dbQueriesPerSec: number;
  inFlight: number;
  replicas: Record<string, { ready: number; desired: number; version: string }>;
  cpu: Record<string, number>;
  memoryMiB: Record<string, number>;
  /** Conexiones del pool en uso ahora mismo (consultas activas). */
  dbConnectionsInUse: number;
  queuePublishedPerSec: number;
  completed: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

/**
 * Métricas en una ventana deslizante de tiempo virtual.
 * RPS se expresa en "requests por segundo modelado" del dominio request.
 */
export function computeMetrics(engine: SimulationEngine, windowMs = 1000): MetricsSnapshot {
  const log = engine.log;
  const now = engine.now;
  const from = lowerBound(log, now - windowMs);
  const durations: number[] = [];
  let errors = 0;
  let hits = 0;
  let misses = 0;
  let dbQueries = 0;
  let published = 0;
  for (let i = from; i < log.length; i++) {
    const ev = log[i]!;
    switch (ev.type) {
      case 'request.completed':
        durations.push(ev.payload.durationMs as number);
        if (isError(ev.payload.status as number)) errors += 1;
        break;
      case 'cache.hit':
      case 'cache.miss': {
        // Sólo caches de datos (ElastiCache…), no la cache del resolver DNS.
        const layer = engine.catalog.get(engine.nodes.get(ev.componentId)?.service ?? '')?.layer;
        if (layer !== 'data') break;
        if (ev.type === 'cache.hit') hits += 1;
        else misses += 1;
        break;
      }
      case 'db.query':
        dbQueries += 1;
        break;
      case 'queue.publish':
        published += 1;
        break;
    }
  }
  durations.sort((a, b) => a - b);
  const seconds = windowMs / 1000;

  const replicas: MetricsSnapshot['replicas'] = {};
  const cpu: Record<string, number> = {};
  const memoryMiB: Record<string, number> = {};
  for (const [id, w] of engine.workloads) {
    const ready = w.pods.filter((p) => p.ready).length;
    replicas[id] = { ready, desired: w.replicas, version: w.version };
    const active = engine.runtime.get(id)?.active ?? 0;
    // Modelo sintético: base + carga activa repartida entre pods Ready.
    cpu[id] = Math.min(98, Math.round(6 + (active * 22) / Math.max(1, ready) + durations.length * 0.8));
    memoryMiB[id] = Math.round(180 + active * 12 + w.pods.length * 4);
  }

  let dbConnections = 0;
  for (const [id, node] of engine.nodes) {
    const svc = engine.catalog.get(node.service);
    if (svc?.layer === 'data' && !svc.id.includes('cache')) dbConnections += engine.runtime.get(id)?.active ?? 0;
  }

  let inFlight = 0;
  for (const r of engine.requests.values()) if (r.finishedAt === undefined) inFlight += 1;

  return {
    windowMs,
    rps: durations.length / seconds,
    errorRate: durations.length ? errors / durations.length : 0,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    cacheHitRatio: hits + misses ? hits / (hits + misses) : null,
    dbQueriesPerSec: dbQueries / seconds,
    inFlight,
    replicas,
    cpu,
    memoryMiB,
    dbConnectionsInUse: dbConnections,
    queuePublishedPerSec: published / seconds,
    completed: durations.length,
  };
}

/** Estado visual de un nodo en el instante actual. */
export function nodeVisualStatus(engine: SimulationEngine, nodeId: string): VisualStatus {
  const rt = engine.runtime.get(nodeId);
  if (!rt) return 'idle';
  const w = engine.workloads.get(nodeId);
  if (w && w.status !== 'success') {
    if (w.status === 'running' || w.status === 'rolling-back' || w.status === 'failed') return w.status;
  }
  if (rt.active > 0 && (rt.status === 'success' || rt.status === 'idle')) return 'running';
  if (rt.active > 0) return rt.status;
  // Los estados terminales se desvanecen a idle tras un tiempo virtual.
  const fade = engine.delivery.status === 'running' || engine.iac.status === 'running' ? 60 : 30;
  if ((rt.status === 'success' || rt.status === 'running') && engine.now - rt.lastChange > fade) return 'idle';
  if ((rt.status === 'failed' || rt.status === 'warning' || rt.status === 'retrying') && engine.now - rt.lastChange > 400) return 'idle';
  return rt.status;
}
