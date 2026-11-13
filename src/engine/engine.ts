/**
 * Motor de simulación determinista.
 *
 * - Reloj virtual (ms) independiente del reloj real.
 * - Scheduler con orden total (time, seq).
 * - Comandos registrados => replay exacto, step forward / step back.
 * - Emite SimulationEvent tipados; mantiene un estado derivable para la UI.
 *
 * No depende de React ni del DOM.
 */
import type { CatalogService, EdgeDef, FaultDef, NodeDef, ScenarioDef } from '../model/schemas';
import type { Command, Domain, EventType, RecordedCommand, Severity, SimulationEvent, VisualStatus } from './events';
import { Rng } from './rng';
import { Scheduler } from './scheduler';
import { RequestFlow } from './request';
import { Delivery } from './delivery';

/** Escalas temporales (ver docs/architecture.md). */
export const TIME = {
  /** Dominio request: 1 ms modelado = 1 ms virtual. */
  requestScale: 1,
  /** Dominio delivery: 1 s modelado = 1 ms virtual (compresión x1000). */
  deliveryMsPerModeledSecond: 1,
} as const;

export interface Transfer {
  id: string;
  edgeId: string;
  /** true si el pulso viaja target -> source (respuesta o pull). */
  reverse: boolean;
  start: number;
  end: number;
  kind: 'request' | 'response' | 'delivery';
  ok: boolean;
  traceId?: string;
  label?: string;
}

export interface NodeRuntime {
  active: number;
  status: VisualStatus;
  lastChange: number;
}

export type PodPhase =
  | 'Pending'
  | 'ContainerCreating'
  | 'Running'
  | 'Terminating'
  | 'ErrImagePull'
  | 'ImagePullBackOff'
  | 'CrashLoopBackOff';

export interface PodState {
  name: string;
  version: string;
  phase: PodPhase;
  ready: boolean;
}

export interface WorkloadState {
  nodeId: string;
  deployment: string;
  namespace: string;
  version: string;
  targetVersion?: string;
  replicas: number;
  pods: PodState[];
  status: VisualStatus;
  /** pod-template-hash por versión: un rollback reutiliza el ReplicaSet antiguo. */
  replicaSets: Record<string, string>;
}

export interface StageState {
  key: string;
  stageId: string;
  name: string;
  service?: string;
  componentId: string;
  status: VisualStatus;
  startedAt?: number;
  endedAt?: number;
}

export interface DeliveryState {
  runId?: string;
  status: VisualStatus;
  stages: StageState[];
  argo: { sync: 'Synced' | 'OutOfSync' | 'Unknown'; health: 'Healthy' | 'Progressing' | 'Degraded' | 'Missing' };
  gitopsRevision: string;
}

export interface IacState {
  runId?: string;
  status: VisualStatus;
  steps: StageState[];
  awaitingApproval: boolean;
  locked: boolean;
}

export interface RequestRecord {
  traceId: string;
  origin: string;
  startedAt: number;
  finishedAt?: number;
  status?: number;
  reason?: string;
}

export interface EngineOptions {
  seed?: number;
  /** Límite de seguridad para el tamaño del log (memoria). */
  maxEvents?: number;
}

export interface EmitInput {
  domain: Domain;
  type: EventType;
  severity?: Severity;
  componentId: string;
  edgeId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  message: string;
  payload?: Record<string, unknown>;
  to?: VisualStatus;
}

export class SimulationEngine {
  readonly scenario: ScenarioDef;
  readonly catalog: Map<string, CatalogService>;
  readonly seed: number;

  now = 0;
  jobsProcessed = 0;
  readonly log: SimulationEvent[] = [];
  readonly commands: RecordedCommand[] = [];

  readonly nodes = new Map<string, NodeDef>();
  readonly edgesByPair = new Map<string, EdgeDef>();
  readonly runtime = new Map<string, NodeRuntime>();
  readonly transfers = new Map<string, Transfer>();
  readonly requests = new Map<string, RequestRecord>();
  readonly workloads = new Map<string, WorkloadState>();
  readonly activeFaults = new Set<string>();
  readonly delivery: DeliveryState;
  readonly iac: IacState;

  loadRps = 0;

  readonly rng: Rng;
  private readonly scheduler = new Scheduler();
  private readonly listeners = new Set<(e: SimulationEvent) => void>();
  private counter = 0;
  private loadGeneration = 0;
  private readonly maxEvents: number;

  readonly requestFlow: RequestFlow;
  readonly deliveryFlow: Delivery;

  constructor(scenario: ScenarioDef, catalog: CatalogService[], options: EngineOptions = {}) {
    this.scenario = scenario;
    this.catalog = new Map(catalog.map((c) => [c.id, c]));
    this.seed = options.seed ?? 42;
    this.maxEvents = options.maxEvents ?? 50_000;
    this.rng = new Rng(this.seed);

    for (const n of scenario.nodes) {
      this.nodes.set(n.id, n);
      this.runtime.set(n.id, { active: 0, status: 'idle', lastChange: 0 });
      if (n.workload) {
        const rsHash = this.rng.hex(9);
        this.workloads.set(n.id, {
          nodeId: n.id,
          deployment: n.workload.deployment,
          namespace: n.workload.namespace,
          version: n.workload.version,
          replicas: n.workload.replicas,
          pods: Array.from({ length: n.workload.replicas }, () => ({
            name: `${n.workload!.deployment}-${rsHash}-${this.rng.hex(5)}`,
            version: n.workload!.version,
            phase: 'Running' as const,
            ready: true,
          })),
          status: 'success',
          replicaSets: { [n.workload.version]: rsHash },
        });
      }
    }
    for (const e of scenario.edges) this.edgesByPair.set(`${e.source}->${e.target}`, e);

    this.delivery = {
      status: 'idle',
      stages: [],
      argo: { sync: 'Synced', health: 'Healthy' },
      gitopsRevision: this.rng.hex(7),
    };
    this.iac = { status: 'idle', steps: [], awaitingApproval: false, locked: false };

    this.requestFlow = new RequestFlow(this);
    this.deliveryFlow = new Delivery(this);
  }

  // ---------------------------------------------------------------- events

  subscribe(fn: (e: SimulationEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter.toString(36).padStart(4, '0')}`;
  }

  emit(input: EmitInput): SimulationEvent {
    const node = this.nodes.get(input.componentId);
    const rt = this.runtime.get(input.componentId);
    let stateTransition: SimulationEvent['stateTransition'];
    if (input.to && rt) {
      stateTransition = { componentId: input.componentId, from: rt.status, to: input.to };
      rt.status = input.to;
      rt.lastChange = this.now;
    }
    const seq = this.log.length;
    const event: SimulationEvent = {
      id: `ev-${this.seed.toString(36)}-${seq.toString(36).padStart(5, '0')}`,
      seq,
      virtualTime: this.now,
      scenarioId: this.scenario.id,
      provider: this.scenario.providerId,
      domain: input.domain,
      type: input.type,
      severity: input.severity ?? 'info',
      componentId: input.componentId,
      edgeId: input.edgeId,
      service: node?.workload?.deployment ?? node?.label ?? input.componentId,
      environment: 'sim-prod',
      traceId: input.traceId,
      spanId: input.spanId,
      parentSpanId: input.parentSpanId,
      message: input.message,
      payload: input.payload ?? {},
      stateTransition,
      simulated: true,
    };
    if (this.log.length < this.maxEvents) this.log.push(event);
    for (const l of this.listeners) l(event);
    return event;
  }

  // ------------------------------------------------------------- scheduling

  /** Programa un job `delay` ms virtuales en el futuro. */
  after(delay: number, label: string, run: () => void): void {
    this.scheduler.schedule(this.now + Math.max(0, delay), label, run);
  }

  /** Convierte segundos modelados del dominio delivery a ms virtuales. */
  deliveryDelay(seconds: number): number {
    return seconds * TIME.deliveryMsPerModeledSecond;
  }

  get pendingJobs(): number {
    return this.scheduler.size;
  }

  nextJobTime(): number | undefined {
    return this.scheduler.peek()?.time;
  }

  /** Procesa exactamente un job. Devuelve false si no hay jobs. */
  step(): boolean {
    const job = this.scheduler.pop();
    if (!job) return false;
    this.now = Math.max(this.now, job.time);
    this.jobsProcessed += 1;
    job.run();
    return true;
  }

  /** Procesa todos los jobs con time <= t y deja el reloj en t. */
  advanceTo(t: number): void {
    for (;;) {
      const next = this.scheduler.peek();
      if (!next || next.time > t) break;
      this.step();
    }
    this.now = Math.max(this.now, t);
  }

  /** Avanza hasta que no queden jobs (o hasta el límite). Útil en tests. */
  runUntilIdle(limitMs = 10_000_000): void {
    for (;;) {
      const next = this.scheduler.peek();
      if (!next || next.time > limitMs) break;
      this.step();
    }
  }

  // --------------------------------------------------------------- commands

  dispatch(command: Command): void {
    this.commands.push({ afterJobs: this.jobsProcessed, at: this.now, command });
    this.apply(command);
  }

  private apply(command: Command): void {
    switch (command.type) {
      case 'startRequest':
        this.requestFlow.start(command.origin ?? 'user');
        break;
      case 'setLoad':
        this.setLoad(command.rps);
        break;
      case 'startRelease':
        this.deliveryFlow.startRelease();
        break;
      case 'startInfraChange':
        this.deliveryFlow.startInfraChange();
        break;
      case 'approve':
        this.deliveryFlow.approve();
        break;
      case 'toggleFault':
        this.toggleFault(command.faultId, command.enabled);
        break;
    }
  }

  private toggleFault(faultId: string, enabled: boolean): void {
    const fault = this.scenario.faults.find((f) => f.id === faultId);
    if (!fault) return;
    if (enabled) this.activeFaults.add(faultId);
    else this.activeFaults.delete(faultId);
    this.emit({
      domain: 'system',
      type: 'fault.toggled',
      severity: enabled ? 'warn' : 'info',
      componentId: fault.component,
      message: `${enabled ? 'Fallo inyectado' : 'Fallo retirado'}: ${fault.title}`,
      payload: { faultId, enabled },
    });
  }

  private setLoad(rps: number): void {
    this.loadRps = Math.max(0, rps);
    this.loadGeneration += 1;
    const generation = this.loadGeneration;
    this.emit({
      domain: 'system',
      type: 'load.changed',
      componentId: this.scenario.request.root.component,
      message: rps > 0 ? `Generador de carga: ${rps} RPS (simulado)` : 'Generador de carga detenido',
      payload: { rps },
    });
    if (rps <= 0) return;
    const tick = () => {
      if (generation !== this.loadGeneration) return;
      this.requestFlow.start('load');
      const interval = 1000 / this.loadRps;
      this.after(interval * (0.6 + 0.8 * this.rng.next()), 'load.tick', tick);
    };
    this.after(0, 'load.tick', tick);
  }

  activeFaultsFor(domain: FaultDef['domain']): FaultDef[] {
    return this.scenario.faults.filter((f) => f.domain === domain && this.activeFaults.has(f.id));
  }

  // ---------------------------------------------------------------- helpers

  edgeBetween(source: string, target: string): EdgeDef | undefined {
    return this.edgesByPair.get(`${source}->${target}`);
  }

  addTransfer(t: Omit<Transfer, 'id'>): string {
    const id = this.nextId('tx');
    this.transfers.set(id, { ...t, id });
    return id;
  }

  removeTransfer(id: string): void {
    this.transfers.delete(id);
  }

  setNodeActive(componentId: string, delta: number): void {
    const rt = this.runtime.get(componentId);
    if (rt) rt.active = Math.max(0, rt.active + delta);
  }

  // ----------------------------------------------------------------- replay

  /**
   * Reconstruye un motor idéntico aplicando los mismos comandos en el mismo
   * punto del procesamiento, hasta `untilJobs` jobs procesados (step back /
   * replay). `finalNow` restaura el reloj virtual exacto.
   */
  static replay(
    scenario: ScenarioDef,
    catalog: CatalogService[],
    seed: number,
    commands: RecordedCommand[],
    untilJobs: number,
    finalNow?: number,
  ): SimulationEngine {
    const engine = new SimulationEngine(scenario, catalog, { seed });
    const limit = untilJobs;
    for (const rc of commands) {
      if (rc.afterJobs > limit) break;
      while (engine.jobsProcessed < rc.afterJobs && engine.step()) {
        /* advance */
      }
      engine.now = rc.at;
      engine.dispatch(rc.command);
    }
    while (engine.jobsProcessed < limit && engine.step()) {
      /* advance */
    }
    if (finalNow !== undefined) engine.now = Math.max(engine.now, finalNow);
    return engine;
  }
}
