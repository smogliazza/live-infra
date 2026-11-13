/**
 * Modelo de dominio de Cloud Flow Lab.
 *
 * Todo lo que describe una arquitectura (proveedor, nodos, edges, flujos,
 * fallos) es DECLARATIVO y se valida con Zod. El motor de simulación consume
 * estas definiciones; la UI nunca inventa comportamiento.
 */
import { z } from 'zod';

export const ProviderId = z.enum(['aws', 'azure', 'gcp', 'digitalocean', 'oci']);
export type ProviderId = z.infer<typeof ProviderId>;

/** Capa arquitectónica: sirve para agrupar, colorear y comparar entre proveedores. */
export const Layer = z.enum([
  'client',
  'dns',
  'edge',
  'security',
  'load-balancing',
  'network',
  'kubernetes',
  'compute',
  'data',
  'messaging',
  'delivery',
  'registry',
  'iac',
  'gitops',
  'observability',
  'identity',
]);
export type Layer = z.infer<typeof Layer>;

/** Plano al que pertenece un componente. No confundir control plane con data plane. */
export const Plane = z.enum(['data', 'control', 'delivery', 'observability']);
export type Plane = z.infer<typeof Plane>;

export const DocLink = z.object({ title: z.string(), url: z.url() });

export const FailureMode = z.object({
  name: z.string(),
  symptoms: z.string(),
  diagnosis: z.string(),
  mitigation: z.string(),
});

/** Contenido del inspector: proviene SIEMPRE del catálogo, nunca de la UI. */
export const InspectorContent = z.object({
  summary: z.string(),
  advanced: z.string(),
  receives: z.array(z.string()),
  processes: z.array(z.string()),
  emits: z.array(z.string()),
  protocols: z.array(z.string()).default([]),
  ports: z.array(z.string()).default([]),
  identity: z.array(z.string()).default([]),
  trustBoundary: z.string().optional(),
  /** Configuración ILUSTRATIVA, no productiva. */
  exampleConfig: z.object({ language: z.string(), code: z.string() }).optional(),
  typicalLogs: z.array(z.string()).default([]),
  typicalMetrics: z.array(z.string()).default([]),
  failureModes: z.array(FailureMode).default([]),
  docs: z.array(DocLink).default([]),
  glossary: z.array(z.string()).default([]),
});
export type InspectorContent = z.infer<typeof InspectorContent>;

/** Entrada del catálogo de un proveedor: describe un servicio real. */
export const CatalogService = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.union([ProviderId, z.literal('generic')]),
  category: z.string(),
  layer: Layer,
  plane: Plane,
  role: z.string(),
  inspector: InspectorContent,
});
export type CatalogService = z.infer<typeof CatalogService>;

export const Boundary = z.object({
  id: z.string(),
  kind: z.enum(['internet', 'edge', 'region', 'az', 'vpc', 'subnet', 'cluster', 'namespace', 'delivery', 'saas']),
  label: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Boundary = z.infer<typeof Boundary>;

export const NodeDef = z.object({
  id: z.string(),
  label: z.string(),
  /** Referencia a CatalogService.id */
  service: z.string(),
  boundary: z.string().optional(),
  x: z.number(),
  y: z.number(),
  /** Visible solo en modo avanzado. */
  advanced: z.boolean().default(false),
  /** Si es un workload de Kubernetes con réplicas. */
  workload: z
    .object({
      deployment: z.string(),
      namespace: z.string(),
      replicas: z.number().int().positive(),
      image: z.string(),
      version: z.string(),
    })
    .optional(),
});
export type NodeDef = z.infer<typeof NodeDef>;

export const EdgeDef = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  protocol: z.string(),
  port: z.string().optional(),
  routingRule: z.string().optional(),
  traffic: z.enum(['north-south', 'east-west', 'control', 'delivery']),
  /** Latencia de red modelada (ms virtuales) [min, max]. */
  latencyMs: z.tuple([z.number(), z.number()]),
  advanced: z.boolean().default(false),
});
export type EdgeDef = z.infer<typeof EdgeDef>;

/**
 * Paso de un flujo de request. Árbol: cada paso es una llamada desde el paso
 * padre hacia `component`. Los hijos se ejecutan en paralelo (fan-out) o en
 * secuencia y sus respuestas convergen en el padre.
 */
export interface FlowStep {
  id: string;
  component: string;
  operation: string;
  processMs: [number, number];
  children?: FlowStep[];
  sequential?: boolean;
  /** Llamada asíncrona: el padre no espera la respuesta (p.ej. publicar en una cola). */
  async?: boolean;
  /** Solo se ejecuta si el hermano anterior fue un cache miss. */
  when?: 'previous-cache-miss';
  /** Este paso es una consulta de cache con el hit ratio dado. */
  cacheHitRatio?: number;
  /** Deadline del padre hacia este paso. */
  timeoutMs?: number;
  retries?: number;
  /** Status que devuelve este componente cuando un hijo síncrono falla. */
  onChildError?: number;
  responseBytes?: number;
}

export const FlowStepSchema: z.ZodType<FlowStep> = z.lazy(() =>
  z.object({
    id: z.string(),
    component: z.string(),
    operation: z.string(),
    processMs: z.tuple([z.number(), z.number()]),
    children: z.array(FlowStepSchema).optional(),
    sequential: z.boolean().optional(),
    async: z.boolean().optional(),
    when: z.literal('previous-cache-miss').optional(),
    cacheHitRatio: z.number().min(0).max(1).optional(),
    timeoutMs: z.number().positive().optional(),
    retries: z.number().int().min(0).optional(),
    onChildError: z.number().int().optional(),
    responseBytes: z.number().int().optional(),
  }),
);

/** Efecto de un fallo inyectable sobre el data plane. */
export const RequestFaultEffect = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reject'), status: z.number().int(), reason: z.string() }),
  z.object({ type: z.literal('latency'), addMs: z.number() }),
  z.object({ type: z.literal('blackhole') }),
]);
export type RequestFaultEffect = z.infer<typeof RequestFaultEffect>;

export const FaultDef = z.object({
  id: z.string(),
  title: z.string(),
  domain: z.enum(['request', 'delivery']),
  description: z.string(),
  /** Qué debería observar el usuario y cómo diagnosticarlo. */
  diagnosis: z.string(),
  component: z.string(),
  /** Para fallos de request. */
  effect: RequestFaultEffect.optional(),
  /** Solo afecta a la operación indicada (p.ej. sólo a la consulta DNS). */
  operation: z.string().optional(),
  /** Para fallos de delivery. */
  deliveryEffect: z
    .enum(['tests-fail', 'image-pull-backoff', 'readiness-fail', 'terraform-state-lock', 'terraform-drift'])
    .optional(),
});
export type FaultDef = z.infer<typeof FaultDef>;

export const PipelineStage = z.object({
  id: z.string(),
  name: z.string(),
  component: z.string(),
  /** Duración modelada en segundos reales [min, max]. */
  durationS: z.tuple([z.number(), z.number()]),
  /** Se ejecuta una vez por servicio modificado (fan-out). */
  perService: z.boolean().default(false),
  kind: z.enum(['ci', 'scan', 'build', 'publish', 'gitops']),
});

export const DeliveryDef = z.object({
  pipelineEngine: z.string(),
  /** Servicios incluidos en la release (ids de nodos con workload). */
  services: z.array(z.string()),
  stages: z.array(PipelineStage),
  sourceRepoComponent: z.string(),
  gitopsRepoComponent: z.string(),
  argoComponent: z.string(),
  kubeApiComponent: z.string(),
  registryComponent: z.string(),
  ciComponent: z.string(),
  developerComponent: z.string(),
  /** Detección de cambios de Argo CD: webhook (rápido) o polling. */
  argoDetectS: z.tuple([z.number(), z.number()]),
  rollout: z.object({
    maxSurge: z.number().int().min(1),
    maxUnavailable: z.number().int().min(0),
    progressDeadlineS: z.number(),
  }),
  smokeTestComponent: z.string(),
  terraform: z.object({
    component: z.string(),
    stateBackend: z.string(),
    stateComponent: z.string(),
    resources: z.array(z.string()),
  }),
});
export type DeliveryDef = z.infer<typeof DeliveryDef>;

export const ScenarioDef = z.object({
  id: z.string(),
  title: z.string(),
  providerId: ProviderId,
  difficulty: z.enum(['intro', 'intermediate', 'advanced']),
  description: z.string(),
  /** Simplificaciones conscientes de la simulación (rigor). */
  simplifications: z.array(z.string()),
  boundaries: z.array(Boundary),
  nodes: z.array(NodeDef),
  edges: z.array(EdgeDef),
  request: z.object({
    host: z.string(),
    path: z.string(),
    method: z.string(),
    root: FlowStepSchema,
  }),
  delivery: DeliveryDef,
  faults: z.array(FaultDef),
});
export type ScenarioDef = z.infer<typeof ScenarioDef>;

export const ProviderProfile = z.object({
  id: ProviderId,
  name: z.string(),
  shortName: z.string(),
  services: z.array(CatalogService),
  scenarios: z.array(ScenarioDef),
});
export type ProviderProfile = z.infer<typeof ProviderProfile>;

/**
 * Validación semántica adicional (lo que Zod no puede expresar solo):
 * referencias cruzadas entre nodos, edges, flujos, servicios y fallos.
 */
export function validateScenarioReferences(s: ScenarioDef, catalog: CatalogService[]): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(s.nodes.map((n) => n.id));
  const serviceIds = new Set(catalog.map((c) => c.id));
  const boundaryIds = new Set(s.boundaries.map((b) => b.id));
  const edgeKey = new Set(s.edges.map((e) => `${e.source}->${e.target}`));

  for (const n of s.nodes) {
    if (!serviceIds.has(n.service)) errors.push(`node ${n.id}: unknown service ${n.service}`);
    if (n.boundary && !boundaryIds.has(n.boundary)) errors.push(`node ${n.id}: unknown boundary ${n.boundary}`);
  }
  for (const e of s.edges) {
    if (!nodeIds.has(e.source)) errors.push(`edge ${e.id}: unknown source ${e.source}`);
    if (!nodeIds.has(e.target)) errors.push(`edge ${e.id}: unknown target ${e.target}`);
  }
  const walk = (step: FlowStep, parent?: FlowStep) => {
    if (!nodeIds.has(step.component)) errors.push(`flow ${step.id}: unknown component ${step.component}`);
    if (parent && !edgeKey.has(`${parent.component}->${step.component}`)) {
      errors.push(`flow ${step.id}: no edge ${parent.component}->${step.component}`);
    }
    step.children?.forEach((c) => walk(c, step));
  };
  walk(s.request.root);
  for (const f of s.faults) {
    if (!nodeIds.has(f.component)) errors.push(`fault ${f.id}: unknown component ${f.component}`);
  }
  const d = s.delivery;
  for (const id of [
    ...d.services,
    d.sourceRepoComponent,
    d.gitopsRepoComponent,
    d.argoComponent,
    d.kubeApiComponent,
    d.registryComponent,
    d.ciComponent,
    d.developerComponent,
    d.smokeTestComponent,
    d.terraform.component,
    d.terraform.stateComponent,
    ...d.stages.map((st) => st.component),
  ]) {
    if (!nodeIds.has(id)) errors.push(`delivery: unknown component ${id}`);
  }
  for (const id of d.services) {
    if (!s.nodes.find((n) => n.id === id)?.workload) errors.push(`delivery: ${id} is not a workload`);
  }
  return errors;
}
