/**
 * Contrato de eventos del simulador.
 *
 * El event stream es la ÚNICA fuente de verdad: la animación, la consola,
 * las métricas y las trazas se derivan de estos eventos. Todos los datos son
 * sintéticos y están marcados como simulados (`simulated: true`).
 */

export type Severity = 'debug' | 'info' | 'warn' | 'error';

export type Domain = 'request' | 'delivery' | 'iac' | 'system';

/** Estados visuales comunes a nodos, etapas y servicios. */
export type VisualStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'success'
  | 'warning'
  | 'failed'
  | 'blocked'
  | 'retrying'
  | 'rolling-back';

export type EventType =
  // system
  | 'sim.command'
  | 'fault.toggled'
  | 'load.changed'
  // request / data plane
  | 'request.started'
  | 'request.completed'
  | 'net.send'
  | 'net.arrive'
  | 'span.start'
  | 'span.end'
  | 'component.process'
  | 'dns.query'
  | 'dns.answer'
  | 'tls.handshake'
  | 'lb.route'
  | 'cache.hit'
  | 'cache.miss'
  | 'db.query'
  | 'queue.publish'
  | 'call.timeout'
  | 'call.retry'
  | 'call.late-response'
  | 'fault.applied'
  // delivery (CI / registry / GitOps / Kubernetes)
  | 'git.push'
  | 'webhook.delivered'
  | 'pipeline.started'
  | 'pipeline.completed'
  | 'stage.started'
  | 'stage.succeeded'
  | 'stage.failed'
  | 'image.pushed'
  | 'gitops.commit'
  | 'argocd.diff'
  | 'argocd.sync'
  | 'argocd.health'
  | 'k8s.event'
  | 'endpoints.updated'
  | 'rollout.progress'
  | 'rollout.completed'
  | 'rollout.stalled'
  | 'release.completed'
  | 'release.failed'
  | 'rollback.started'
  // IaC
  | 'terraform.step'
  | 'terraform.lock'
  | 'terraform.plan'
  | 'terraform.approval'
  | 'terraform.apply'
  | 'terraform.completed'
  | 'terraform.failed';

export interface StateTransition {
  componentId: string;
  from?: VisualStatus;
  to: VisualStatus;
}

export interface SimulationEvent {
  /** event_id determinista (no depende de Date.now ni de Math.random). */
  id: string;
  seq: number;
  /** Tiempo virtual en ms. */
  virtualTime: number;
  scenarioId: string;
  provider: string;
  domain: Domain;
  type: EventType;
  severity: Severity;
  componentId: string;
  edgeId?: string;
  service: string;
  environment: 'sim-prod';
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  message: string;
  payload: Record<string, unknown>;
  stateTransition?: StateTransition;
  simulated: true;
}

/** Comandos del usuario. Se registran con su instante para permitir replay exacto. */
export type Command =
  | { type: 'startRequest'; origin?: 'user' | 'load' | 'smoke-test' }
  | { type: 'setLoad'; rps: number }
  | { type: 'startRelease' }
  | { type: 'startInfraChange' }
  | { type: 'approve' }
  | { type: 'toggleFault'; faultId: string; enabled: boolean };

export interface RecordedCommand {
  /** Número de jobs procesados cuando se aplicó el comando. */
  afterJobs: number;
  at: number;
  command: Command;
}
