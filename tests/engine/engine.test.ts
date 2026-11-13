import { describe, expect, it } from 'vitest';
import { providers } from '../../src/catalog';
import { SimulationEngine } from '../../src/engine/engine';
import type { SimulationEvent } from '../../src/engine/events';
import { buildTrace, computeMetrics } from '../../src/engine/observability';

/** Status que genera el propio load balancer cuando no hay destinos sanos. */
const LB_NO_TARGETS_STATUS: Record<string, number> = { aws: 503, azure: 502, gcp: 502 };

describe.each(providers.map((p) => [p.id, p] as const))('perfil %s', (_id, profile) => {
  const scenario = profile.scenarios[0]!;
  const catalog = profile.services;
  /** Componente por intención arquitectónica (los ids difieren por proveedor). */
  const byIntent = (intent: string) => scenario.nodes.find((n) => n.intent === intent)!.id;
  const LB = byIntent('l7-load-balancer');
  const DB = byIntent('database');
  const CACHE = byIntent('cache');

  const make = (seed = 7) => new SimulationEngine(scenario, catalog, { seed });

  function completed(e: SimulationEngine, traceId?: string): SimulationEvent[] {
    return e.log.filter((ev) => ev.type === 'request.completed' && (!traceId || ev.traceId === traceId));
  }

  function singleRequest(seed = 7, faults: string[] = []) {
    const e = make(seed);
    for (const f of faults) e.dispatch({ type: 'toggleFault', faultId: f, enabled: true });
    e.dispatch({ type: 'startRequest' });
    e.runUntilIdle();
    const done = completed(e);
    expect(done).toHaveLength(1);
    return { e, done: done[0]! };
  }

  describe('catálogo', () => {
    it('los perfiles y escenarios pasan la validación de esquema y referencias', () => {
      expect(profile.scenarios.length).toBeGreaterThan(0);
      expect(scenario.faults.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('flujo de request', () => {
    it('happy path devuelve 200 y pasa por el edge, el load balancer y los servicios', () => {
      const { e, done } = singleRequest();
      expect(done.payload.status).toBe(200);
      const visited = new Set(e.log.filter((ev) => ev.type === 'span.start').map((ev) => ev.componentId));
      for (const c of ['dns-resolver', 'edge-cdn', 'waf', 'l7-load-balancer', 'cache', 'database'].map(byIntent).concat(['api', 'catalog', 'orders'])) {
        expect(visited.has(c), c).toBe(true);
      }
    });

    it('respeta el orden causal: tiempo monótono, send antes de arrive, padre antes que hijo', () => {
      const { e } = singleRequest(11);
      for (let i = 1; i < e.log.length; i++) {
        expect(e.log[i]!.virtualTime).toBeGreaterThanOrEqual(e.log[i - 1]!.virtualTime);
        expect(e.log[i]!.seq).toBe(i);
      }
      const starts = new Map<string, number>();
      const ends = new Map<string, number>();
      for (const ev of e.log) {
        if (ev.type === 'span.start') starts.set(ev.spanId!, ev.seq);
        if (ev.type === 'span.end') ends.set(ev.spanId!, ev.seq);
      }
      for (const ev of e.log.filter((x) => x.type === 'span.start')) {
        expect(ends.get(ev.spanId!)!).toBeGreaterThan(starts.get(ev.spanId!)!);
        if (ev.parentSpanId && starts.has(ev.parentSpanId)) {
          expect(starts.get(ev.parentSpanId)!).toBeLessThan(ev.seq);
        }
        // Cada span.start fue precedido por un net.send con el mismo spanId.
        const send = e.log.find((x) => x.type === 'net.send' && x.spanId === ev.spanId);
        expect(send && send.seq < ev.seq).toBe(true);
      }
    });

    it('bifurca (fan-out) en api y converge antes de responder', () => {
      const { e } = singleRequest(3);
      const apiStart = e.log.find((ev) => ev.type === 'span.start' && ev.componentId === 'api')!;
      const children = e.log.filter((ev) => ev.type === 'span.start' && ev.parentSpanId === apiStart.spanId);
      expect(children.map((c) => c.componentId).sort()).toEqual(['catalog', 'orders']);
      const apiEnd = e.log.find((ev) => ev.type === 'span.end' && ev.spanId === apiStart.spanId)!;
      for (const c of children) {
        const end = e.log.find((ev) => ev.type === 'span.end' && ev.spanId === c.spanId)!;
        expect(end.seq).toBeLessThan(apiEnd.seq);
      }
      const trace = buildTrace(e.log, apiStart.traceId!)!;
      expect(trace.status).toBe('ok');
      expect(trace.spans.length).toBeGreaterThan(8);
    });

    it('soporta requests concurrentes con trazas independientes', () => {
      const e = make(5);
      e.dispatch({ type: 'setLoad', rps: 200 });
      e.advanceTo(500);
      e.dispatch({ type: 'setLoad', rps: 0 });
      e.runUntilIdle();
      const started = e.log.filter((ev) => ev.type === 'request.started');
      const done = completed(e);
      expect(started.length).toBeGreaterThan(50);
      expect(done).toHaveLength(started.length);
      expect(new Set(done.map((d) => d.traceId)).size).toBe(done.length);
      // Hubo solapamiento real: alguna request empezó antes de que terminara otra.
      const overlaps = started.some((s, i) => i > 0 && s.virtualTime < (done.find((d) => d.traceId === started[i - 1]!.traceId)?.virtualTime ?? 0));
      expect(overlaps).toBe(true);
    });

    it('el cache miss provoca consulta a RDS y el hit la evita', () => {
      const e = make(9);
      e.dispatch({ type: 'setLoad', rps: 100 });
      e.advanceTo(400);
      e.dispatch({ type: 'setLoad', rps: 0 });
      e.runUntilIdle();
      const catalogDbSpans = e.log.filter((ev) => ev.type === 'span.start' && ev.componentId === DB && String(ev.payload.operation).includes('products'));
      const misses = e.log.filter((ev) => ev.type === 'cache.miss' && ev.componentId === CACHE);
      expect(misses.length).toBeGreaterThan(0);
      expect(catalogDbSpans.length).toBe(misses.length);
    });
  });

  describe('fallos de request', () => {
    it('WAF devuelve 403 desde el edge y la request nunca llega al load balancer', () => {
      const { e, done } = singleRequest(1, ['waf-false-positive']);
      expect(done.payload.status).toBe(403);
      expect(e.log.some((ev) => ev.type === 'span.start' && ev.componentId === LB)).toBe(false);
    });

    it('load balancer sin destinos sanos genera su propio 5xx sin tocar los Pods', () => {
      const { e, done } = singleRequest(1, ['lb-no-healthy-targets']);
      expect(done.payload.status).toBe(LB_NO_TARGETS_STATUS[profile.id]);
      expect(e.log.some((ev) => ev.type === 'span.start' && ev.componentId === 'api')).toBe(false);
    });

    it('catalog lento: deadline, reintento y 504', () => {
      const { e, done } = singleRequest(1, ['catalog-slow']);
      expect(done.payload.status).toBe(504);
      expect(e.log.filter((ev) => ev.type === 'call.timeout')).toHaveLength(2);
      expect(e.log.filter((ev) => ev.type === 'call.retry')).toHaveLength(1);
      expect(e.log.some((ev) => ev.type === 'call.late-response')).toBe(true);
    });

    it('NetworkPolicy: el DROP se manifiesta como timeout (504)', () => {
      const { done } = singleRequest(1, ['networkpolicy-orders']);
      expect(done.payload.status).toBe(504);
    });

    it('DB saturada: orders traduce el timeout a 503', () => {
      const { done } = singleRequest(1, ['db-saturated']);
      expect(done.payload.status).toBe(503);
    });

    it('NXDOMAIN: sin respuesta HTTP salvo cache del resolver (TTL)', () => {
      const e = make(2);
      e.dispatch({ type: 'toggleFault', faultId: 'dns-nxdomain', enabled: true });
      e.dispatch({ type: 'setLoad', rps: 100 });
      e.advanceTo(400);
      e.dispatch({ type: 'setLoad', rps: 0 });
      e.runUntilIdle();
      const statuses = completed(e).map((d) => d.payload.status);
      expect(statuses).toContain(0);
      expect(statuses).toContain(200); // respuestas aún en cache del resolver
    });
  });

  describe('determinismo y replay', () => {
    const script = (e: SimulationEngine) => {
      e.dispatch({ type: 'startRequest' });
      e.advanceTo(20);
      e.dispatch({ type: 'setLoad', rps: 50 });
      e.advanceTo(150);
      e.dispatch({ type: 'toggleFault', faultId: 'catalog-slow', enabled: true });
      e.dispatch({ type: 'startRelease' });
      e.advanceTo(300);
      e.dispatch({ type: 'setLoad', rps: 0 });
      e.advanceTo(900);
    };

    it('misma semilla y mismos comandos => mismo event stream', () => {
      const a = make(99);
      const b = make(99);
      script(a);
      script(b);
      expect(a.log).toEqual(b.log);
    });

    it('replay reconstruye exactamente el log', () => {
      const a = make(99);
      script(a);
      const r = SimulationEngine.replay(scenario, catalog, 99, a.commands, a.jobsProcessed, a.now);
      expect(r.log).toEqual(a.log);
      expect(r.now).toBe(a.now);
    });

    it('step back = replay hasta N-1 jobs produce un prefijo del log', () => {
      const a = make(4);
      script(a);
      const back = SimulationEngine.replay(scenario, catalog, 4, a.commands, a.jobsProcessed - 1);
      expect(back.jobsProcessed).toBe(a.jobsProcessed - 1);
      expect(a.log.slice(0, back.log.length)).toEqual(back.log);
      back.step();
      expect(back.log).toEqual(a.log.slice(0, back.log.length));
    });

    it('los suscriptores del event bus reciben exactamente el log', () => {
      const e = make(8);
      const seen: SimulationEvent[] = [];
      e.subscribe((ev) => seen.push(ev));
      script(e);
      expect(seen).toEqual(e.log);
    });
  });

  describe('delivery', () => {
    const index = (e: SimulationEngine, type: string, pred: (ev: SimulationEvent) => boolean = () => true) =>
      e.log.findIndex((ev) => ev.type === type && pred(ev));

    it('release feliz: CI → registry → GitOps → Argo CD → rollout → smoke test', () => {
      const e = make(12);
      e.dispatch({ type: 'startRelease' });
      e.runUntilIdle();
      expect(e.log.some((ev) => ev.type === 'release.completed')).toBe(true);
      const order = ['git.push', 'pipeline.started', 'image.pushed', 'gitops.commit', 'pipeline.completed', 'argocd.diff', 'argocd.sync', 'rollout.completed', 'release.completed'];
      const idx = order.map((t) => index(e, t));
      expect(idx.every((i) => i >= 0)).toBe(true);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      expect(e.workloads.get('catalog')!.version).toBe('1.8.4');
      expect(e.workloads.get('catalog')!.pods.every((p) => p.version === '1.8.4' && p.ready)).toBe(true);
      // CI no despliega y Terraform no participa en una release de aplicación.
      expect(e.log.some((ev) => ev.domain === 'iac')).toBe(false);
      // El smoke test es una request real por el data plane.
      const smoke = e.log.find((ev) => ev.type === 'request.started' && ev.payload.origin === 'smoke-test');
      expect(smoke).toBeDefined();
    });

    it('nunca baja de las réplicas deseadas durante el rollout (maxUnavailable=0)', () => {
      const e = make(13);
      e.dispatch({ type: 'startRelease' });
      while (e.step()) {
        for (const w of e.workloads.values()) {
          expect(w.pods.filter((p) => p.ready).length).toBeGreaterThanOrEqual(w.replicas);
        }
      }
    });

    it('tests fallidos: no se publica nada y producción no cambia', () => {
      const e = make(12);
      e.dispatch({ type: 'toggleFault', faultId: 'tests-fail', enabled: true });
      e.dispatch({ type: 'startRelease' });
      e.runUntilIdle();
      expect(e.log.some((ev) => ev.type === 'release.failed')).toBe(true);
      expect(e.log.some((ev) => ev.type === 'image.pushed')).toBe(false);
      expect(e.workloads.get('api')!.version).toBe('2.3.0');
    });

    it('ImagePullBackOff: deadline, Degraded, rollback GitOps y versiones previas', () => {
      const e = make(12);
      e.dispatch({ type: 'toggleFault', faultId: 'catalog-image-pull', enabled: true });
      e.dispatch({ type: 'startRelease' });
      e.runUntilIdle();
      const order = ['rollout.stalled', 'argocd.health', 'rollback.started', 'release.failed'].map((t) => index(e, t, (ev) => t !== 'argocd.health' || ev.payload.health === 'Degraded'));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      for (const [id, version] of [['api', '2.3.0'], ['catalog', '1.8.3'], ['orders', '4.1.7']] as const) {
        const w = e.workloads.get(id)!;
        expect(w.version).toBe(version);
        expect(w.pods.filter((p) => p.ready && p.version === version)).toHaveLength(w.replicas);
      }
    });

    it('readiness fallida no recibe tráfico y termina en rollback', () => {
      const e = make(21);
      e.dispatch({ type: 'toggleFault', faultId: 'orders-readiness', enabled: true });
      e.dispatch({ type: 'startRelease' });
      e.runUntilIdle();
      expect(e.log.some((ev) => ev.type === 'k8s.event' && String(ev.message).includes('Readiness probe failed'))).toBe(true);
      expect(e.log.some((ev) => ev.type === 'release.failed')).toBe(true);
      expect(e.workloads.get('orders')!.version).toBe('4.1.7');
    });

    it('un fallo de data plane hace fallar el smoke test y provoca rollback', () => {
      const e = make(12);
      e.dispatch({ type: 'toggleFault', faultId: 'lb-no-healthy-targets', enabled: true });
      e.dispatch({ type: 'startRelease' });
      e.runUntilIdle();
      expect(e.log.some((ev) => ev.type === 'stage.failed' && ev.payload.stage === 'smoke')).toBe(true);
      expect(e.log.some((ev) => ev.type === 'rollback.started')).toBe(true);
      expect(e.workloads.get('api')!.version).toBe('2.3.0');
    });
  });

  describe('terraform', () => {
    it('se bloquea en la aprobación hasta que el usuario aprueba', () => {
      const e = make(3);
      e.dispatch({ type: 'startInfraChange' });
      e.runUntilIdle();
      expect(e.iac.status).toBe('blocked');
      expect(e.iac.awaitingApproval).toBe(true);
      expect(e.log.some((ev) => ev.type === 'terraform.completed')).toBe(false);
      e.dispatch({ type: 'approve' });
      e.runUntilIdle();
      expect(e.iac.status).toBe('success');
      expect(e.iac.locked).toBe(false);
    });

    it('state lock ocupado aborta antes del plan', () => {
      const e = make(3);
      e.dispatch({ type: 'toggleFault', faultId: 'tf-state-lock', enabled: true });
      e.dispatch({ type: 'startInfraChange' });
      e.runUntilIdle();
      expect(e.iac.status).toBe('failed');
      expect(e.log.some((ev) => ev.type === 'terraform.plan')).toBe(false);
    });

    it('drift aparece en el plan', () => {
      const e = make(3);
      e.dispatch({ type: 'toggleFault', faultId: 'tf-drift', enabled: true });
      e.dispatch({ type: 'startInfraChange' });
      e.runUntilIdle();
      expect(e.log.some((ev) => ev.type === 'terraform.plan' && ev.payload.drift === true)).toBe(true);
    });
  });

  describe('métricas', () => {
    it('se derivan del event stream', () => {
      const e = make(6);
      e.dispatch({ type: 'setLoad', rps: 100 });
      e.advanceTo(1000);
      const m = computeMetrics(e, 1000);
      const doneInWindow = completed(e).filter((d) => d.virtualTime >= 0).length;
      expect(m.completed).toBe(doneInWindow);
      expect(m.rps).toBeCloseTo(doneInWindow, 5);
      expect(m.p50).toBeGreaterThan(0);
      expect(m.p99).toBeGreaterThanOrEqual(m.p95);
      expect(m.cacheHitRatio).not.toBeNull();
      expect(m.replicas.api).toEqual({ ready: 3, desired: 3, version: '2.3.0' });
    });
  });
});

describe('comparabilidad entre perfiles', () => {
  it('todos los perfiles exponen las mismas intenciones, workloads y fallos', () => {
    const shape = (p: (typeof providers)[number]) => {
      const sc = p.scenarios[0]!;
      return {
        intents: [...new Set(sc.nodes.map((n) => n.intent))].sort(),
        workloads: sc.nodes.filter((n) => n.workload).map((n) => n.id).sort(),
        faults: sc.faults.map((f) => f.id).sort(),
      };
    };
    const [first, ...rest] = providers.map(shape);
    for (const r of rest) expect(r).toEqual(first);
  });
});

describe('glosario', () => {
  it('todos los términos del catálogo tienen definición', async () => {
    const { glossary } = await import('../../src/catalog/glossary');
    const missing = providers.flatMap((p) => p.services).flatMap((s) => s.inspector.glossary).filter((g) => !glossary[g]);
    expect(missing).toEqual([]);
  });
});

describe('reglas de enrutado', () => {
  it.each(providers.map((p) => [p.id, p] as const))('%s: cada lb.route describe un edge saliente del componente', (_id, p) => {
    const e = new SimulationEngine(p.scenarios[0]!, p.services, { seed: 3 });
    e.dispatch({ type: 'startRequest' });
    e.runUntilIdle();
    const routes = e.log.filter((ev) => ev.type === 'lb.route');
    expect(routes.length).toBeGreaterThanOrEqual(2); // edge → LB y LB → api
    for (const ev of routes) {
      const edge = p.scenarios[0]!.edges.find((x) => x.id === ev.edgeId)!;
      expect(edge.source).toBe(ev.componentId);
    }
  });
});
