/**
 * Flujo A — Software delivery e infraestructura.
 *
 * Separación deliberada (rigor técnico):
 *  - CI (pipeline) construye, prueba, escanea y PUBLICA imágenes; luego
 *    actualiza la referencia declarativa en el repositorio GitOps.
 *  - CD/GitOps: Argo CD detecta el cambio en Git y reconcilia desired state
 *    con live state aplicando manifiestos al API server. No construye nada.
 *  - Kubernetes ejecuta el rolling update (Deployment -> ReplicaSet -> Pods).
 *  - IaC (Terraform) es un flujo independiente: no se ejecuta en cada release
 *    de aplicación.
 *
 * Duraciones en segundos MODELADOS, comprimidas con `deliveryDelay`.
 */
import type { PodState, SimulationEngine, StageState, WorkloadState } from './engine';
import type { SimulationEvent, VisualStatus } from './events';
import { isError } from './request';

interface Release {
  runId: string;
  generation: number;
  services: string[];
  from: Record<string, string>;
  to: Record<string, string>;
  rollingBack: boolean;
  finished: boolean;
  commit: string;
}

export class Delivery {
  private release?: Release;
  private generation = 0;
  private iacGeneration = 0;

  constructor(private readonly e: SimulationEngine) {}

  private get def() {
    return this.e.scenario.delivery;
  }

  // ---------------------------------------------------------------- helpers

  private stage(key: string, name: string, componentId: string, stageId: string, service?: string): StageState {
    const st: StageState = { key, stageId, name, componentId, service, status: 'queued' };
    this.e.delivery.stages.push(st);
    return st;
  }

  private setStage(st: StageState, status: VisualStatus): void {
    st.status = status;
    if (status === 'running') st.startedAt = this.e.now;
    if (status === 'success' || status === 'failed') st.endedAt = this.e.now;
  }

  /** Pulso de delivery sobre el edge source->target (o target->source si reverse). */
  private pulse(source: string, target: string, seconds: number, label: string, reverse = false): number {
    const e = this.e;
    const edge = e.edgeBetween(source, target);
    if (!edge) throw new Error(`No edge ${source}->${target}`);
    const d = e.deliveryDelay(seconds);
    const tx = e.addTransfer({ edgeId: edge.id, reverse, start: e.now, end: e.now + d, kind: 'delivery', ok: true, label });
    e.after(d, 'delivery.pulse.end', () => e.removeTransfer(tx));
    return d;
  }

  private alive(r: Release, generation = r.generation): boolean {
    return this.release === r && r.generation === generation && !r.finished;
  }

  private dur(range: readonly [number, number]): number {
    return this.e.rng.range(range);
  }

  private hasFault(effect: string, component?: string): boolean {
    return this.e
      .activeFaultsFor('delivery')
      .some((f) => f.deliveryEffect === effect && (component === undefined || f.component === component));
  }

  // ---------------------------------------------------------------- release

  startRelease(): void {
    const e = this.e;
    const def = this.def;
    if (this.release && !this.release.finished) {
      e.emit({
        domain: 'delivery',
        type: 'sim.command',
        severity: 'warn',
        componentId: def.ciComponent,
        message: 'Ya hay una release en curso; espera a que termine (simulación serializa releases).',
      });
      return;
    }
    this.generation += 1;
    const from: Record<string, string> = {};
    const to: Record<string, string> = {};
    for (const s of def.services) {
      const w = e.workloads.get(s)!;
      from[s] = w.version;
      to[s] = bumpPatch(w.version);
    }
    const r: Release = {
      runId: `run-${1000 + this.generation}`,
      generation: this.generation,
      services: [...def.services],
      from,
      to,
      rollingBack: false,
      finished: false,
      commit: e.rng.hex(7),
    };
    this.release = r;
    e.delivery.runId = r.runId;
    e.delivery.status = 'running';
    e.delivery.stages = [];

    e.emit({
      domain: 'delivery',
      type: 'git.push',
      componentId: def.developerComponent,
      message: `git push origin main — commit ${r.commit} "feat: release ${def.services.map((s) => `${s}@${to[s]}`).join(', ')}"`,
      payload: { commit: r.commit, branch: 'main', services: r.services },
      to: 'success',
    });
    const d = this.pulse(def.developerComponent, def.sourceRepoComponent, 2, 'git push');
    e.after(d, 'git.received', () => {
      if (!this.alive(r)) return;
      e.emit({
        domain: 'delivery',
        type: 'webhook.delivered',
        componentId: def.sourceRepoComponent,
        message: `Push event → pipeline trigger (${def.pipelineEngine})`,
        payload: { event: 'push', ref: 'refs/heads/main', commit: r.commit },
        to: 'success',
      });
      const d2 = this.pulse(def.sourceRepoComponent, def.ciComponent, 1, 'webhook');
      e.after(d2, 'pipeline.start', () => {
        if (!this.alive(r)) return;
        e.emit({
          domain: 'delivery',
          type: 'pipeline.started',
          componentId: def.ciComponent,
          message: `Pipeline ${r.runId} iniciado (${def.pipelineEngine})`,
          payload: { runId: r.runId, engine: def.pipelineEngine },
          to: 'running',
        });
        // Crear todas las etapas en estado queued para visualizarlas.
        const plan: StageState[][] = def.stages.map((st) =>
          st.perService
            ? r.services.map((svc) => this.stage(`${st.id}:${svc}`, st.name, st.component, st.id, svc))
            : [this.stage(st.id, st.name, st.component, st.id)],
        );
        this.runStage(r, plan, 0);
      });
    });
  }

  private runStage(r: Release, plan: StageState[][], index: number): void {
    const e = this.e;
    if (!this.alive(r)) return;
    const group = plan[index];
    const stageDef = this.def.stages[index];
    if (!group || !stageDef) {
      this.onPipelineDone(r);
      return;
    }
    let pending = group.length;
    let failed = false;
    for (const st of group) {
      this.setStage(st, 'running');
      e.emit({
        domain: 'delivery',
        type: 'stage.started',
        componentId: st.componentId,
        message: `[${r.runId}] ${st.name}${st.service ? ` (${st.service})` : ''} iniciado`,
        payload: { stage: st.stageId, service: st.service, runId: r.runId },
        to: 'running',
      });
      const seconds = this.dur(stageDef.durationS);
      let d = this.e.deliveryDelay(seconds);
      if (stageDef.kind === 'publish') d = this.pulse(this.def.ciComponent, this.def.registryComponent, seconds, 'docker push');
      if (stageDef.kind === 'gitops') d = this.pulse(this.def.ciComponent, this.def.gitopsRepoComponent, seconds, 'git commit');

      e.after(d, 'stage.done', () => {
        if (!this.alive(r)) return;
        const fails = stageDef.id.includes('test') && this.hasFault('tests-fail');
        if (fails) {
          failed = true;
          this.setStage(st, 'failed');
          e.emit({
            domain: 'delivery',
            type: 'stage.failed',
            severity: 'error',
            componentId: st.componentId,
            message: `[${r.runId}] ${st.name} FAILED: 2 tests fallidos (OrderTotalTest.applies_discount, CatalogPagingTest.cursor_roundtrip)`,
            payload: { stage: st.stageId, failures: 2, exitCode: 1 },
            to: 'failed',
          });
        } else {
          this.setStage(st, 'success');
          e.emit({
            domain: 'delivery',
            type: 'stage.succeeded',
            componentId: st.componentId,
            message: `[${r.runId}] ${st.name}${st.service ? ` (${st.service})` : ''} OK en ${Math.round(seconds)}s (modelado)`,
            payload: { stage: st.stageId, service: st.service, modeledSeconds: Math.round(seconds) },
            to: 'success',
          });
          this.stageSideEffects(r, stageDef.kind, st);
        }
        pending -= 1;
        if (pending > 0) return;
        if (failed) {
          for (const g of plan.slice(index + 1)) for (const s of g) s.status = 'idle';
          this.finishRelease(r, false, 'pipeline fallido: tests; no se publicó ninguna imagen nueva ni se tocó el cluster');
          return;
        }
        this.runStage(r, plan, index + 1);
      });
    }
  }

  private stageSideEffects(r: Release, kind: string, st: StageState): void {
    const e = this.e;
    if (kind === 'publish' && st.service) {
      const w = e.workloads.get(st.service)!;
      const node = e.nodes.get(st.service)!;
      e.emit({
        domain: 'delivery',
        type: 'image.pushed',
        componentId: this.def.registryComponent,
        message: `Imagen publicada ${node.workload!.image}:${r.to[st.service]} digest sha256:${e.rng.hex(12)}…`,
        payload: { image: node.workload!.image, tag: r.to[st.service], deployment: w.deployment },
        to: 'success',
      });
    }
    if (kind === 'gitops') {
      e.delivery.gitopsRevision = e.rng.hex(7);
      e.emit({
        domain: 'delivery',
        type: 'gitops.commit',
        componentId: this.def.gitopsRepoComponent,
        message: `GitOps commit ${e.delivery.gitopsRevision}: ${r.services.map((s) => `${s} ${r.from[s]}→${r.to[s]}`).join(', ')} (kustomize images)`,
        payload: { revision: e.delivery.gitopsRevision, changes: r.services.map((s) => ({ service: s, from: r.from[s], to: r.to[s] })) },
        to: 'success',
      });
    }
  }

  private onPipelineDone(r: Release): void {
    const e = this.e;
    e.emit({
      domain: 'delivery',
      type: 'pipeline.completed',
      componentId: this.def.ciComponent,
      message: `Pipeline ${r.runId} completado: imágenes publicadas y referencia GitOps actualizada. CI termina aquí; el despliegue lo hace Argo CD.`,
      payload: { runId: r.runId },
      to: 'success',
    });
    this.argoReconcile(r, r.to, () => this.rolloutAll(r, r.to));
  }

  /** Argo CD: detectar diff en Git -> OutOfSync -> sync (apply) al API server. */
  private argoReconcile(r: Release, target: Record<string, string>, then: () => void): void {
    const e = this.e;
    const def = this.def;
    const gen = r.generation;
    const syncStage = this.stage(`argocd-sync:${r.rollingBack ? 'rollback' : 'release'}`, r.rollingBack ? 'Argo CD sync (rollback)' : 'Argo CD sync', def.argoComponent, 'argocd-sync');
    const detect = this.e.deliveryDelay(this.dur(def.argoDetectS));
    this.setStage(syncStage, 'running');
    e.after(detect, 'argocd.detect', () => {
      if (!this.alive(r, gen)) return;
      const d = this.pulse(def.argoComponent, def.gitopsRepoComponent, 2, 'git fetch');
      e.after(d, 'argocd.diff', () => {
        if (!this.alive(r, gen)) return;
        e.delivery.argo.sync = 'OutOfSync';
        e.emit({
          domain: 'delivery',
          type: 'argocd.diff',
          severity: 'warn',
          componentId: def.argoComponent,
          message: `Application shop: OutOfSync — ${Object.keys(target).length} Deployments difieren (desired ${e.delivery.gitopsRevision} ≠ live)`,
          payload: { sync: 'OutOfSync', revision: e.delivery.gitopsRevision, diff: Object.entries(target).map(([s, v]) => `${s}: image tag → ${v}`) },
          to: 'warning',
        });
        const d2 = this.pulse(def.argoComponent, def.kubeApiComponent, 3, 'apply');
        e.after(d2, 'argocd.synced', () => {
          if (!this.alive(r, gen)) return;
          e.delivery.argo = { sync: 'Synced', health: 'Progressing' };
          this.setStage(syncStage, 'success');
          e.emit({
            domain: 'delivery',
            type: 'argocd.sync',
            componentId: def.argoComponent,
            message: `Sync OK (server-side apply). Sync=Synced, Health=Progressing: los Deployments aún no completaron su rollout`,
            payload: { sync: 'Synced', health: 'Progressing' },
            to: 'running',
          });
          then();
        });
      });
    });
  }

  private rolloutAll(r: Release, target: Record<string, string>): void {
    const e = this.e;
    const services = Object.keys(target);
    let pending = services.length;
    let anyFailed = false;
    const gen = r.generation;
    const complete = () => {
        if (r.rollingBack) {
          e.delivery.argo.health = 'Healthy';
          this.finishRelease(r, false, 'release revertida: el cluster vuelve a la versión anterior');
          return;
        }
        if (anyFailed) {
          e.delivery.argo.health = 'Degraded';
          e.emit({
            domain: 'delivery',
            type: 'argocd.health',
            severity: 'error',
            componentId: this.def.argoComponent,
            message: 'Application shop: Health=Degraded (ProgressDeadlineExceeded). Argo CD NO hace rollback automático por sí mismo.',
            payload: { health: 'Degraded' },
            to: 'failed',
          });
          this.rollback(r, 'rollout no completó dentro de progressDeadlineSeconds');
          return;
        }
        e.delivery.argo.health = 'Healthy';
        e.emit({
          domain: 'delivery',
          type: 'argocd.health',
          componentId: this.def.argoComponent,
          message: 'Application shop: Synced / Healthy',
          payload: { health: 'Healthy' },
          to: 'success',
        });
        this.smokeTest(r);
    };
    if (services.length === 0) {
      complete();
      return;
    }
    for (const svc of services) {
      const st = this.stage(`rollout:${svc}:${r.rollingBack ? 'rb' : 'fw'}`, r.rollingBack ? 'Rollback rollout' : 'K8s rollout', svc, 'rollout', svc);
      this.setStage(st, r.rollingBack ? 'rolling-back' : 'running');
      this.rollout(r, svc, target[svc]!, (ok) => {
        if (!this.alive(r, gen)) return;
        this.setStage(st, ok ? 'success' : 'failed');
        if (!ok) anyFailed = true;
        pending -= 1;
        if (pending === 0) complete();
      });
    }
  }

  /**
   * Rolling update con maxSurge/maxUnavailable. Con maxUnavailable=0 los pods
   * antiguos siguen sirviendo tráfico hasta que el nuevo esté Ready.
   */
  private rollout(r: Release, svc: string, version: string, done: (ok: boolean) => void): void {
    const e = this.e;
    const def = this.def;
    const w = e.workloads.get(svc)!;
    const node = e.nodes.get(svc)!;
    const gen = r.generation;
    const reused = w.replicaSets[version] !== undefined;
    const rsHash = (w.replicaSets[version] ??= e.rng.hex(9));
    w.targetVersion = version;
    w.status = r.rollingBack ? 'rolling-back' : 'running';
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      w.status = ok ? 'success' : 'failed';
      if (ok) {
        w.version = version;
        w.targetVersion = undefined;
      }
      done(ok);
    };
    const live = () => this.alive(r, gen) && !finished;

    e.emit({
      domain: 'delivery',
      type: 'k8s.event',
      componentId: def.kubeApiComponent,
      message: `deployment/${w.deployment}: ScalingReplicaSet — Scaled up ${reused ? 'previous ' : ''}replica set ${w.deployment}-${rsHash} (${node.workload!.image}:${version})`,
      payload: { reason: 'ScalingReplicaSet', kind: 'Deployment', name: w.deployment, namespace: w.namespace, version, reusedReplicaSet: reused },
    });

    e.after(e.deliveryDelay(def.rollout.progressDeadlineS), 'rollout.deadline', () => {
      if (!live()) return;
      e.emit({
        domain: 'delivery',
        type: 'rollout.stalled',
        severity: 'error',
        componentId: svc,
        message: `deployment/${w.deployment}: Progressing=False reason=ProgressDeadlineExceeded (${def.rollout.progressDeadlineS}s). Pods antiguos siguen sirviendo (maxUnavailable=${def.rollout.maxUnavailable}).`,
        payload: { reason: 'ProgressDeadlineExceeded', progressDeadlineSeconds: def.rollout.progressDeadlineS },
        to: 'failed',
      });
      finish(false);
    });

    const newPod = () => {
      if (!live()) return;
      const remainingOld = w.pods.filter((p) => p.version !== version && p.phase !== 'Terminating');
      if (remainingOld.length === 0 && w.pods.filter((p) => p.version === version && p.ready).length >= w.replicas) {
        e.emit({
          domain: 'delivery',
          type: 'rollout.completed',
          componentId: svc,
          message: `deployment "${w.deployment}" successfully rolled out (${version})`,
          payload: { version, replicas: w.replicas },
          to: 'success',
        });
        finish(true);
        return;
      }
      const pod: PodState = { name: `${w.deployment}-${rsHash}-${e.rng.hex(5)}`, version, phase: 'Pending', ready: false };
      w.pods.push(pod);
      const k8s = (reason: string, message: string, severity: SimulationEvent['severity'] = 'info') =>
        e.emit({
          domain: 'delivery',
          type: 'k8s.event',
          severity,
          componentId: svc,
          message: `pod/${pod.name}: ${reason} — ${message}`,
          payload: { reason, kind: 'Pod', name: pod.name, namespace: w.namespace },
        });

      k8s('SuccessfulCreate', `ReplicaSet creó el pod (surge ${def.rollout.maxSurge})`);
      const d0 = this.pulse(def.kubeApiComponent, svc, this.dur([1, 2]), 'schedule');
      e.after(d0, 'pod.scheduled', () => {
        if (!live()) return;
        const nodes = def.clusterNodeNames;
        k8s('Scheduled', `default-scheduler asignó el pod a ${nodes[e.rng.int(0, nodes.length - 1)]}`);
        pod.phase = 'ContainerCreating';
        const pullImage = (attempt: number) => {
          if (!live()) return;
          k8s('Pulling', `Pulling image "${node.workload!.image}:${version}"`);
          const d1 = this.pulse(svc, def.registryComponent, this.dur([3, 7]), 'image pull');
          e.after(d1, 'pod.pulled', () => {
            if (!live()) return;
            const badImage = !r.rollingBack && this.hasFault('image-pull-backoff', svc);
            if (badImage) {
              pod.phase = (attempt === 1 ? 'ErrImagePull' : 'ImagePullBackOff');
              k8s('Failed', `Failed to pull image "${node.workload!.image}:${version}": not found (manifest unknown)`, 'error');
              const backoff = Math.min(10 * 2 ** (attempt - 1), 300);
              k8s('BackOff', `Back-off pulling image (reintento en ${backoff}s)`, 'warn');
              pod.phase = 'ImagePullBackOff';
              e.after(e.deliveryDelay(backoff), 'pod.pull.retry', () => pullImage(attempt + 1));
              return;
            }
            k8s('Pulled', `Successfully pulled image en ${Math.round(this.dur([2, 6]) * 10) / 10}s`);
            k8s('Created', 'Created container app');
            k8s('Started', 'Started container app');
            pod.phase = 'Running';
            const probe = (attempt: number) => {
              if (!live()) return;
              e.after(e.deliveryDelay(this.dur([4, 8])), 'pod.readiness', () => {
                if (!live()) return;
                const failsReadiness = !r.rollingBack && this.hasFault('readiness-fail', svc);
                if (failsReadiness) {
                  k8s('Unhealthy', 'Readiness probe failed: HTTP probe failed with statuscode: 503 (GET /readyz)', 'warn');
                  if (attempt >= 3) {
                    pod.phase = 'CrashLoopBackOff';
                    k8s('BackOff', 'Liveness probe failed 3 veces → kubelet reinicia el contenedor (CrashLoopBackOff)', 'error');
                  }
                  probe(attempt + 1);
                  return;
                }
                pod.ready = true;
                e.emit({
                  domain: 'delivery',
                  type: 'endpoints.updated',
                  componentId: svc,
                  message: `EndpointSlice ${w.deployment}: +1 endpoint Ready (${pod.name}). Ya recibe tráfico.`,
                  payload: { added: pod.name, ready: w.pods.filter((p) => p.ready).length },
                });
                // Escalar hacia abajo el ReplicaSet antiguo.
                const old = w.pods.find((p) => p.version !== version && p.phase !== 'Terminating');
                if (old) {
                  old.ready = false;
                  old.phase = 'Terminating';
                  e.emit({
                    domain: 'delivery',
                    type: 'endpoints.updated',
                    componentId: svc,
                    message: `EndpointSlice ${w.deployment}: endpoint ${old.name} retirado antes de terminar (graceful shutdown)`,
                    payload: { removed: old.name },
                  });
                  e.emit({
                    domain: 'delivery',
                    type: 'k8s.event',
                    componentId: svc,
                    message: `pod/${old.name}: Killing — Stopping container app (terminationGracePeriodSeconds)`,
                    payload: { reason: 'Killing', name: old.name },
                  });
                  e.after(e.deliveryDelay(3), 'pod.terminated', () => {
                    w.pods = w.pods.filter((p) => p !== old);
                  });
                }
                e.emit({
                  domain: 'delivery',
                  type: 'rollout.progress',
                  componentId: svc,
                  message: `deployment/${w.deployment}: ${w.pods.filter((p) => p.version === version && p.ready).length}/${w.replicas} réplicas actualizadas`,
                  payload: { updated: w.pods.filter((p) => p.version === version && p.ready).length, replicas: w.replicas },
                  to: r.rollingBack ? 'rolling-back' : 'running',
                });
                e.after(e.deliveryDelay(1), 'rollout.next', newPod);
              });
            };
            probe(1);
          });
        };
        pullImage(1);
      });
    };
    newPod();
  }

  private smokeTest(r: Release): void {
    const e = this.e;
    const st = this.stage('smoke', 'Smoke tests', this.def.smokeTestComponent, 'smoke');
    this.setStage(st, 'running');
    e.emit({
      domain: 'delivery',
      type: 'stage.started',
      componentId: this.def.smokeTestComponent,
      message: `[${r.runId}] Smoke test post-deploy: request sintética real por el data plane`,
      payload: { stage: 'smoke' },
      to: 'running',
    });
    const traceId = e.requestFlow.start('smoke-test');
    const gen = r.generation;
    const unsubscribe = e.subscribe((ev) => {
      if (ev.type !== 'request.completed' || ev.traceId !== traceId) return;
      unsubscribe();
      if (!this.alive(r, gen)) return;
      const status = ev.payload.status as number;
      if (!isError(status)) {
        this.setStage(st, 'success');
        e.emit({
          domain: 'delivery',
          type: 'stage.succeeded',
          componentId: this.def.smokeTestComponent,
          traceId,
          message: `[${r.runId}] Smoke test OK (HTTP ${status}, trace ${traceId.slice(0, 8)}…)`,
          payload: { stage: 'smoke', status },
          to: 'success',
        });
        this.finishRelease(r, true, 'release desplegada y verificada');
      } else {
        this.setStage(st, 'failed');
        e.emit({
          domain: 'delivery',
          type: 'stage.failed',
          severity: 'error',
          componentId: this.def.smokeTestComponent,
          traceId,
          message: `[${r.runId}] Smoke test FALLÓ (HTTP ${status}). Ver la traza ${traceId.slice(0, 8)}… para diagnosticar.`,
          payload: { stage: 'smoke', status },
          to: 'failed',
        });
        this.rollback(r, `smoke test devolvió HTTP ${status}`);
      }
    });
  }

  /** Rollback GitOps: git revert del commit de la release y nuevo sync. */
  private rollback(r: Release, reason: string): void {
    const e = this.e;
    this.generation += 1;
    r.generation = this.generation;
    r.rollingBack = true;
    e.delivery.status = 'rolling-back';
    e.emit({
      domain: 'delivery',
      type: 'rollback.started',
      severity: 'warn',
      componentId: this.def.ciComponent,
      message: `Rollback: ${reason}. Se hace git revert en el repo GitOps (Git sigue siendo la fuente de verdad).`,
      payload: { reason },
      to: 'rolling-back',
    });
    const st = this.stage('gitops-revert', 'git revert (GitOps)', this.def.gitopsRepoComponent, 'gitops-revert');
    this.setStage(st, 'rolling-back');
    const gen = r.generation;
    const d = this.pulse(this.def.ciComponent, this.def.gitopsRepoComponent, 3, 'git revert');
    e.after(d, 'gitops.revert', () => {
      if (!this.alive(r, gen)) return;
      this.setStage(st, 'success');
      e.delivery.gitopsRevision = e.rng.hex(7);
      e.emit({
        domain: 'delivery',
        type: 'gitops.commit',
        componentId: this.def.gitopsRepoComponent,
        message: `GitOps commit ${e.delivery.gitopsRevision}: Revert "${r.services.map((s) => `${s} → ${r.to[s]}`).join(', ')}"`,
        payload: { revision: e.delivery.gitopsRevision, revert: true },
        to: 'success',
      });
      // Servicios que necesitan volver: los que tienen pods de la versión nueva.
      const target: Record<string, string> = {};
      for (const s of r.services) {
        const w = e.workloads.get(s)!;
        // Pods nuevos que nunca llegaron a Ready se eliminan directamente.
        w.pods = w.pods.filter((p) => !(p.version === r.to[s] && !p.ready));
        if (w.pods.some((p) => p.version === r.to[s]) || w.pods.length < w.replicas) target[s] = r.from[s]!;
        else {
          w.status = 'success';
          w.targetVersion = undefined;
        }
      }
      // Argo CD sincroniza los manifiestos revertidos; sólo los Deployments
      // que llegaron a cambiar necesitan un nuevo rollout.
      this.argoReconcile(r, r.from, () => this.rolloutAll(r, target));
    });
  }

  private finishRelease(r: Release, ok: boolean, summary: string): void {
    const e = this.e;
    if (r.finished) return;
    r.finished = true;
    e.delivery.status = ok ? 'success' : 'failed';
    e.emit({
      domain: 'delivery',
      type: ok ? 'release.completed' : 'release.failed',
      severity: ok ? 'info' : 'error',
      componentId: this.def.ciComponent,
      message: `${r.runId}: ${ok ? 'ÉXITO' : 'FALLÓ'} — ${summary}`,
      payload: { runId: r.runId, ok, versions: ok ? r.to : r.from },
      to: ok ? 'success' : 'failed',
    });
  }

  // -------------------------------------------------------------- terraform

  startInfraChange(): void {
    const e = this.e;
    const tf = this.def.terraform;
    if (e.iac.status === 'running' || e.iac.status === 'blocked') {
      e.emit({ domain: 'iac', type: 'sim.command', severity: 'warn', componentId: tf.component, message: 'Ya hay un cambio de infraestructura en curso.' });
      return;
    }
    this.iacGeneration += 1;
    const gen = this.iacGeneration;
    const runId = `tf-${100 + gen}`;
    e.iac.runId = runId;
    e.iac.status = 'running';
    e.iac.steps = [];
    e.iac.awaitingApproval = false;
    const alive = () => this.iacGeneration === gen;
    const step = (key: string, name: string): StageState => {
      const st: StageState = { key, stageId: key, name, componentId: tf.component, status: 'queued' };
      e.iac.steps.push(st);
      return st;
    };
    const steps = {
      init: step('init', 'terraform init'),
      lock: step('lock', 'state lock'),
      plan: step('plan', 'terraform plan'),
      approval: step('approval', 'aprobación manual'),
      apply: step('apply', 'terraform apply'),
      unlock: step('unlock', 'liberar lock'),
    };
    const tfEvent = (type: SimulationEvent['type'], message: string, payload: Record<string, unknown> = {}, severity: SimulationEvent['severity'] = 'info', to?: VisualStatus) =>
      e.emit({ domain: 'iac', type, severity, componentId: tf.component, message, payload, to });

    const fail = (st: StageState, message: string) => {
      this.setStage(st, 'failed');
      e.iac.status = 'failed';
      tfEvent('terraform.failed', message, {}, 'error', 'failed');
    };

    this.setStage(steps.init, 'running');
    tfEvent('terraform.step', `[${runId}] terraform init — backend "${tf.stateBackend}", providers según .terraform.lock.hcl`, { step: 'init' }, 'info', 'running');
    e.after(e.deliveryDelay(this.dur([6, 10])), 'tf.init', () => {
      if (!alive()) return;
      this.setStage(steps.init, 'success');
      this.setStage(steps.lock, 'running');
      const d = this.pulse(tf.component, tf.stateComponent, 2, 'lock');
      e.after(d, 'tf.lock', () => {
        if (!alive()) return;
        if (this.hasFault('terraform-state-lock')) {
          tfEvent('terraform.lock', `Error acquiring the state lock: ${tf.lockErrorMessage}. No forzar force-unlock sin verificar.`, { held: true }, 'error');
          fail(steps.lock, `[${runId}] abortado: state lock ocupado. Nada se modificó.`);
          for (const s of [steps.plan, steps.approval, steps.apply, steps.unlock]) s.status = 'idle';
          return;
        }
        e.iac.locked = true;
        this.setStage(steps.lock, 'success');
        tfEvent('terraform.lock', 'Acquiring state lock. This may take a few moments... OK', { held: false });
        this.setStage(steps.plan, 'running');
        // refresh: lecturas de los recursos reales vía API del proveedor
        let pending = tf.resources.length;
        for (const res of tf.resources) {
          const dd = this.pulse(tf.component, res, this.dur([2, 4]), 'refresh');
          e.after(dd, 'tf.refresh', () => {
            if (!alive()) return;
            pending -= 1;
            if (pending > 0) return;
            const drift = this.hasFault('terraform-drift');
            if (drift) {
              tfEvent('terraform.plan', `Note: Objects have changed outside of Terraform — ${tf.driftMessage}`, { drift: true }, 'warn', 'warning');
            }
            this.setStage(steps.plan, 'success');
            tfEvent(
              'terraform.plan',
              `Plan: 1 to add, ${drift ? 2 : 1} to change, 0 to destroy. ${drift ? '(incluye revertir el drift)' : ''}`.trim(),
              { add: 1, change: drift ? 2 : 1, destroy: 0, drift },
            );
            this.setStage(steps.approval, 'blocked');
            e.iac.status = 'blocked';
            e.iac.awaitingApproval = true;
            tfEvent('terraform.approval', `[${runId}] Esperando aprobación manual del plan (gate). Pulsa "Aprobar plan".`, {}, 'warn', 'blocked');
          });
        }
      });
    });
    this.pendingApply = () => {
      if (!alive()) return;
      e.iac.awaitingApproval = false;
      e.iac.status = 'running';
      this.setStage(steps.approval, 'success');
      this.setStage(steps.apply, 'running');
      tfEvent('terraform.apply', `[${runId}] terraform apply (plan guardado, sin re-plan)`, {}, 'info', 'running');
      const applyNext = (i: number) => {
        if (!alive()) return;
        const res = tf.resources[i];
        if (!res) {
          this.setStage(steps.apply, 'success');
          this.setStage(steps.unlock, 'running');
          const d = this.pulse(tf.component, tf.stateComponent, 2, 'state write + unlock');
          e.after(d, 'tf.unlock', () => {
            if (!alive()) return;
            e.iac.locked = false;
            this.setStage(steps.unlock, 'success');
            e.iac.status = 'success';
            tfEvent('terraform.completed', `[${runId}] Apply complete! Resources: 1 added, 1 changed, 0 destroyed. State guardado y lock liberado.`, {}, 'info', 'success');
          });
          return;
        }
        const node = e.nodes.get(res);
        const dd = this.pulse(tf.component, res, this.dur([5, 12]), 'apply');
        e.after(dd, 'tf.apply.res', () => {
          if (!alive()) return;
          tfEvent('terraform.apply', `${node?.label ?? res}: Modifications complete`, { resource: res });
          applyNext(i + 1);
        });
      };
      applyNext(0);
    };
  }

  private pendingApply?: () => void;

  approve(): void {
    const e = this.e;
    if (!e.iac.awaitingApproval || !this.pendingApply) {
      e.emit({ domain: 'iac', type: 'sim.command', severity: 'warn', componentId: this.def.terraform.component, message: 'No hay ningún plan esperando aprobación.' });
      return;
    }
    const fn = this.pendingApply;
    this.pendingApply = undefined;
    e.emit({ domain: 'iac', type: 'terraform.approval', componentId: this.def.terraform.component, message: 'Plan aprobado por el usuario (simulado).', payload: { approved: true } });
    fn();
  }
}

export function bumpPatch(v: string): string {
  const [maj = '0', min = '0', patch = '0'] = v.split('.');
  return `${maj}.${min}.${Number(patch) + 1}`;
}

export type { WorkloadState };
