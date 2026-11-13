/**
 * Flujo B — Request / data plane.
 *
 * Recorre el árbol declarativo `scenario.request.root`. Cada paso es una
 * llamada padre -> hijo sobre un edge real del escenario. Los hijos pueden
 * ejecutarse en paralelo (fan-out) o en secuencia, y sus respuestas
 * convergen en el padre. Soporta deadlines, reintentos, cache hit/miss,
 * llamadas asíncronas y fallos inyectados.
 */
import type { EdgeDef, FlowStep } from '../model/schemas';
import type { SimulationEngine } from './engine';

interface ChildResult {
  stepId: string;
  status: number;
  kind: 'response' | 'timeout';
  cacheHit?: boolean;
  reason?: string;
  bytes: number;
}

interface Call {
  id: string;
  traceId: string;
  step: FlowStep;
  parent?: Call;
  edge?: EdgeDef;
  spanId: string;
  attempt: number;
  startedAt: number;
  settled: boolean;
  timedOut: boolean;
  pendingSync: number;
  results: ChildResult[];
  cacheHit?: boolean;
  origin: string;
  /** La respuesta ya llegó al llamador. */
  returned: boolean;
  /** Índice del hijo en curso (ejecución secuencial). */
  seqIndex: number;
}

const HTTP_REASON: Record<number, string> = {
  200: 'OK',
  403: 'Forbidden',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export class RequestFlow {
  private seqByTrace = new Map<string, number>();

  constructor(private readonly e: SimulationEngine) {}

  start(origin: string): string {
    const e = this.e;
    const root = e.scenario.request.root;
    const traceId = e.rng.hex(32);
    const call: Call = this.newCall(traceId, root, undefined, undefined, 1, origin);
    e.requests.set(traceId, { traceId, origin, startedAt: e.now });
    e.emit({
      domain: 'request',
      type: 'request.started',
      componentId: root.component,
      traceId,
      spanId: call.spanId,
      message: `${e.scenario.request.method} https://${e.scenario.request.host}${e.scenario.request.path} (origen: ${origin})`,
      payload: { method: e.scenario.request.method, host: e.scenario.request.host, path: e.scenario.request.path, origin },
      to: 'running',
    });
    this.beginWork(call);
    return traceId;
  }

  private newCall(
    traceId: string,
    step: FlowStep,
    parent: Call | undefined,
    edge: EdgeDef | undefined,
    attempt: number,
    origin: string,
  ): Call {
    const n = (this.seqByTrace.get(traceId) ?? 0) + 1;
    this.seqByTrace.set(traceId, n);
    return {
      id: this.e.nextId('call'),
      traceId,
      step,
      parent,
      edge,
      spanId: this.e.rng.hex(16),
      attempt,
      startedAt: this.e.now,
      settled: false,
      timedOut: false,
      pendingSync: 0,
      results: [],
      origin,
      returned: false,
      seqIndex: 0,
    };
  }

  /** El padre invoca al hijo: el pulso viaja por el edge. */
  private invoke(parent: Call, step: FlowStep, attempt = 1): void {
    const e = this.e;
    const edge = e.edgeBetween(parent.step.component, step.component);
    if (!edge) throw new Error(`No edge ${parent.step.component}->${step.component}`);
    const call = this.newCall(parent.traceId, step, parent, edge, attempt, parent.origin);
    const latency = e.rng.range(edge.latencyMs);
    const tx = e.addTransfer({
      edgeId: edge.id,
      reverse: false,
      start: e.now,
      end: e.now + latency,
      kind: 'request',
      ok: true,
      traceId: call.traceId,
      label: step.operation,
    });
    e.emit({
      domain: 'request',
      type: 'net.send',
      severity: 'debug',
      componentId: parent.step.component,
      edgeId: edge.id,
      traceId: call.traceId,
      spanId: call.spanId,
      parentSpanId: parent.spanId,
      message: `→ ${step.component} ${step.operation} via ${edge.protocol}${edge.port ? ':' + edge.port : ''}${attempt > 1 ? ` (intento ${attempt})` : ''}`,
      payload: {
        protocol: edge.protocol,
        port: edge.port,
        traffic: edge.traffic,
        routingRule: edge.routingRule,
        latencyMs: round(latency),
        attempt,
        async: Boolean(step.async),
      },
    });

    if (step.timeoutMs && !step.async) {
      e.after(step.timeoutMs, 'call.deadline', () => this.onDeadline(call));
    }
    e.after(latency, 'net.arrive', () => {
      e.removeTransfer(tx);
      this.onArrive(call);
    });
  }

  private onArrive(call: Call): void {
    const e = this.e;
    const { step } = call;
    e.setNodeActive(step.component, +1);
    e.emit({
      domain: 'request',
      type: 'span.start',
      componentId: step.component,
      edgeId: call.edge?.id,
      traceId: call.traceId,
      spanId: call.spanId,
      parentSpanId: call.parent?.spanId,
      message: `${step.operation}`,
      payload: { operation: step.operation, attempt: call.attempt },
      to: 'running',
    });
    this.describeArrival(call);
    this.beginWork(call);
  }

  /** Eventos didácticos específicos de protocolo al llegar a ciertos componentes. */
  private describeArrival(call: Call): void {
    const e = this.e;
    const svc = e.catalog.get(e.nodes.get(call.step.component)?.service ?? '');
    if (!svc) return;
    if (svc.layer === 'dns' && call.step.operation.startsWith('DNS')) {
      e.emit({
        domain: 'request',
        type: 'dns.query',
        componentId: call.step.component,
        traceId: call.traceId,
        spanId: call.spanId,
        message: `Query A/AAAA ${e.scenario.request.host}`,
        payload: { qname: e.scenario.request.host, qtype: 'A/AAAA' },
      });
    }
    if (call.edge?.protocol.includes('TLS')) {
      e.emit({
        domain: 'request',
        type: 'tls.handshake',
        severity: 'debug',
        componentId: call.step.component,
        edgeId: call.edge.id,
        traceId: call.traceId,
        spanId: call.spanId,
        message: `TLS 1.3 handshake (SNI=${e.scenario.request.host}) — modelado dentro de la latencia del salto`,
        payload: { sni: e.scenario.request.host, version: 'TLSv1.3', alpn: call.edge.protocol.includes('HTTP/2') ? 'h2' : 'http/1.1' },
      });
    }
    // La regla de enrutado pertenece al componente que decide: está en sus
    // edges SALIENTES (p.ej. listener del LB → backend), no en el entrante.
    for (const child of call.step.children ?? []) {
      const out = e.edgeBetween(call.step.component, child.component);
      if (!out?.routingRule) continue;
      e.emit({
        domain: 'request',
        type: 'lb.route',
        componentId: call.step.component,
        edgeId: out.id,
        traceId: call.traceId,
        spanId: call.spanId,
        message: `Regla de enrutado: ${out.routingRule}`,
        payload: { rule: out.routingRule, target: child.component },
      });
    }
  }

  private beginWork(call: Call): void {
    const e = this.e;
    const { step } = call;
    let processMs = e.rng.range(step.processMs);

    for (const fault of e.activeFaultsFor('request')) {
      if (fault.component !== step.component || !fault.effect) continue;
      if (fault.operation && fault.operation !== step.operation) continue;
      const effect = fault.effect;
      e.emit({
        domain: 'request',
        type: 'fault.applied',
        severity: 'warn',
        componentId: step.component,
        traceId: call.traceId,
        spanId: call.spanId,
        message: `[fallo inyectado] ${fault.title}`,
        payload: { faultId: fault.id, effect },
      });
      if (effect.type === 'reject') {
        e.after(processMs, 'process.reject', () => this.respond(call, effect.status, effect.reason, 0));
        return;
      }
      if (effect.type === 'blackhole') {
        // Nunca responde: el deadline del llamador decide.
        return;
      }
      processMs += effect.addMs;
    }

    e.after(processMs, 'process.done', () => {
      e.emit({
        domain: 'request',
        type: 'component.process',
        severity: 'debug',
        componentId: step.component,
        traceId: call.traceId,
        spanId: call.spanId,
        message: `${step.operation} procesado en ${round(processMs)} ms`,
        payload: { processMs: round(processMs) },
      });

      if (step.cacheHitRatio !== undefined) {
        const hit = e.rng.next() < step.cacheHitRatio;
        call.cacheHit = hit;
        e.emit({
          domain: 'request',
          type: hit ? 'cache.hit' : 'cache.miss',
          componentId: step.component,
          traceId: call.traceId,
          spanId: call.spanId,
          message: hit ? `Cache HIT ${step.operation}` : `Cache MISS ${step.operation}`,
          payload: { hit },
        });
      }
      const svc = e.catalog.get(e.nodes.get(step.component)?.service ?? '');
      if (svc?.layer === 'data' && step.cacheHitRatio === undefined) {
        e.emit({
          domain: 'request',
          type: 'db.query',
          componentId: step.component,
          traceId: call.traceId,
          spanId: call.spanId,
          message: `${step.operation} (pool: conexión reutilizada)`,
          payload: { statement: step.operation, durationMs: round(processMs) },
        });
      }
      if (svc?.layer === 'messaging') {
        e.emit({
          domain: 'request',
          type: 'queue.publish',
          componentId: step.component,
          traceId: call.traceId,
          spanId: call.spanId,
          message: `${step.operation} (traceparent propagado en atributos del mensaje)`,
          payload: { operation: step.operation },
        });
      }
      this.runChildren(call);
    });
  }

  private runChildren(call: Call): void {
    const children = call.step.children ?? [];
    if (children.length === 0) {
      this.respond(call, 200, undefined, call.step.responseBytes ?? 512);
      return;
    }
    if (call.step.sequential) {
      this.runSequential(call, 0);
      return;
    }
    for (const child of children) {
      if (child.async) {
        this.invoke(call, child);
      } else {
        call.pendingSync += 1;
      }
    }
    for (const child of children) if (!child.async) this.invoke(call, child);
    if (call.pendingSync === 0) this.finish(call);
  }

  private runSequential(call: Call, index: number): void {
    const children = call.step.children ?? [];
    let i = index;
    while (i < children.length) {
      const child = children[i]!;
      // Sin hermano previo, la condición se evalúa sobre la cache del propio
      // componente (p.ej. resolver DNS con el registro aún dentro del TTL).
      const prevHit = call.results.length ? call.results[call.results.length - 1]!.cacheHit : call.cacheHit;
      if (child.when === 'previous-cache-miss' && prevHit) {
        this.e.emit({
          domain: 'request',
          type: 'component.process',
          severity: 'debug',
          componentId: call.step.component,
          traceId: call.traceId,
          spanId: call.spanId,
          message: `Se omite ${child.operation}: dato servido desde cache`,
          payload: { skipped: child.id },
        });
        i += 1;
        continue;
      }
      if (child.async) {
        this.invoke(call, child);
        i += 1;
        continue;
      }
      call.pendingSync = 1;
      call.seqIndex = i;
      this.invoke(call, child);
      return;
    }
    this.finish(call);
  }

  /** Un hijo síncrono devolvió respuesta (o agotó su deadline). */
  private onChildResult(parent: Call, result: ChildResult): void {
    if (parent.settled) return;
    parent.results.push(result);
    parent.pendingSync -= 1;
    const failed = isError(result.status);
    if (parent.step.sequential) {
      if (failed) {
        this.finish(parent);
        return;
      }
      this.runSequential(parent, parent.seqIndex + 1);
      return;
    }
    if (failed) {
      // fail-fast: el primer error síncrono determina la respuesta.
      this.finish(parent);
      return;
    }
    if (parent.pendingSync === 0) this.finish(parent);
  }

  private finish(call: Call): void {
    const failure = call.results.find((r) => isError(r.status));
    const bytes = call.step.responseBytes ?? call.results.reduce((a, r) => a + r.bytes, 0) + 256;
    if (!failure) {
      this.respond(call, 200, undefined, bytes);
      return;
    }
    const isRoot = !call.parent;
    let status: number;
    let reason: string;
    if (isRoot) {
      status = failure.status;
      reason = failure.reason ?? HTTP_REASON[failure.status] ?? 'error';
    } else if (call.step.onChildError !== undefined) {
      status = call.step.onChildError;
      reason = `${failure.kind === 'timeout' ? 'upstream deadline exceeded' : `upstream ${failure.status}`} (${failure.stepId})`;
    } else if (failure.kind === 'timeout') {
      status = 504;
      reason = `upstream timeout (${failure.stepId})`;
    } else {
      // Un proxy reenvía el status del upstream tal cual.
      status = failure.status;
      reason = failure.reason ?? `upstream ${failure.status}`;
    }
    this.respond(call, status, reason, 128);
  }

  private respond(call: Call, status: number, reason: string | undefined, bytes: number): void {
    const e = this.e;
    if (call.settled) return;
    call.settled = true;
    const ok = !isError(status);
    const duration = e.now - call.startedAt;

    if (!call.parent) {
      // Fin de la request en el cliente.
      const rec = e.requests.get(call.traceId);
      if (rec) {
        rec.finishedAt = e.now;
        rec.status = status;
        rec.reason = reason;
      }
      e.emit({
        domain: 'request',
        type: 'request.completed',
        severity: ok ? 'info' : 'error',
        componentId: call.step.component,
        traceId: call.traceId,
        spanId: call.spanId,
        message:
          status === 0
            ? `Sin respuesta HTTP en ${round(duration)} ms — ${reason ?? 'error de red'}`
            : `HTTP ${status} ${HTTP_REASON[status] ?? ''} en ${round(duration)} ms${reason ? ` — ${reason}` : ''}`,
        payload: { status, durationMs: round(duration), bytes, reason, origin: call.origin },
        to: ok ? 'success' : 'failed',
      });
      return;
    }

    e.setNodeActive(call.step.component, -1);
    e.emit({
      domain: 'request',
      type: 'span.end',
      severity: ok ? 'info' : 'error',
      componentId: call.step.component,
      edgeId: call.edge?.id,
      traceId: call.traceId,
      spanId: call.spanId,
      parentSpanId: call.parent.spanId,
      message: `${call.step.operation} → ${status}${reason ? ` (${reason})` : ''}`,
      payload: { status, durationMs: round(duration), bytes, operation: call.step.operation, reason },
      to: ok ? 'success' : 'failed',
    });

    if (call.step.async) return;
    if (call.timedOut) {
      e.emit({
        domain: 'request',
        type: 'call.late-response',
        severity: 'warn',
        componentId: call.step.component,
        traceId: call.traceId,
        spanId: call.spanId,
        message: `Respuesta tardía descartada: el llamador ya superó su deadline`,
        payload: { status },
      });
      return;
    }
    const edge = call.edge!;
    const latency = e.rng.range(edge.latencyMs);
    const tx = e.addTransfer({
      edgeId: edge.id,
      reverse: true,
      start: e.now,
      end: e.now + latency,
      kind: 'response',
      ok,
      traceId: call.traceId,
      label: String(status),
    });
    e.emit({
      domain: 'request',
      type: 'net.send',
      severity: 'debug',
      componentId: call.step.component,
      edgeId: edge.id,
      traceId: call.traceId,
      spanId: call.spanId,
      parentSpanId: call.parent.spanId,
      message: `← ${status} a ${call.parent.step.component} (${bytes} B)`,
      payload: { direction: 'response', status, bytes, latencyMs: round(latency) },
    });
    const parent = call.parent;
    e.after(latency, 'net.arrive', () => {
      e.removeTransfer(tx);
      if (call.timedOut) return;
      call.returned = true;
      this.onChildResult(parent, {
        stepId: call.step.id,
        status,
        kind: 'response',
        cacheHit: call.cacheHit,
        reason,
        bytes,
      });
    });
  }

  private onDeadline(call: Call): void {
    const e = this.e;
    if (call.returned) return;
    const parent = call.parent;
    if (!parent || parent.settled) return;
    call.timedOut = true;
    const retries = call.step.retries ?? 0;
    e.emit({
      domain: 'request',
      type: 'call.timeout',
      severity: 'warn',
      componentId: parent.step.component,
      edgeId: call.edge?.id,
      traceId: call.traceId,
      spanId: parent.spanId,
      message: `Deadline de ${call.step.timeoutMs} ms superado esperando a ${call.step.component} (intento ${call.attempt})`,
      payload: { timeoutMs: call.step.timeoutMs, attempt: call.attempt, target: call.step.component },
      to: call.attempt <= retries ? 'retrying' : 'warning',
    });
    if (call.attempt <= retries) {
      e.emit({
        domain: 'request',
        type: 'call.retry',
        severity: 'warn',
        componentId: parent.step.component,
        edgeId: call.edge?.id,
        traceId: call.traceId,
        spanId: parent.spanId,
        message: `Reintento ${call.attempt}/${retries} hacia ${call.step.component}`,
        payload: { attempt: call.attempt + 1, retries },
      });
      this.invoke(parent, call.step, call.attempt + 1);
      return;
    }
    this.onChildResult(parent, {
      stepId: call.step.id,
      status: 504,
      kind: 'timeout',
      reason: `deadline exceeded (${call.step.component})`,
      bytes: 0,
    });
  }
}

/** status 0 = no hubo respuesta HTTP (DNS, conexión rechazada…). */
export function isError(status: number): boolean {
  return status === 0 || status >= 400;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
