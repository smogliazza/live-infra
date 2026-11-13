# Cómo añadir proveedores, servicios y escenarios

El motor es común; cada proveedor aporta **datos**: un catálogo de servicios y uno o más escenarios. No hace falta tocar `src/engine/`.

## 1. Añadir servicios a un catálogo

Crea `src/catalog/providers/<proveedor>/services.ts` y usa el helper `svc()`:

```ts
import { svc } from '../../generic';

export const gcpServices = [
  svc({
    id: 'gcp-cloud-armor',
    name: 'Google Cloud Armor',
    provider: 'gcp',
    category: 'Seguridad',
    layer: 'security',      // capa común: permite comparar entre proveedores
    plane: 'data',
    role: 'WAF y protección DDoS asociada al load balancer externo',
    inspector: {
      summary: '…',
      advanced: '…',
      receives: ['…'], processes: ['…'], emits: ['…'],
      exampleConfig: { language: 'hcl', code: '# ILUSTRATIVO\n…' },
      failureModes: [{ name: '…', symptoms: '…', diagnosis: '…', mitigation: '…' }],
      docs: [{ title: 'Cloud Armor docs', url: 'https://cloud.google.com/armor/docs' }],
      glossary: ['Security policy'],
    },
  }),
];
```

Reglas:

- **Verifica nombres, disponibilidad y capacidades contra la documentación oficial vigente** y enlázala en `docs`.
- Marca toda configuración como ilustrativa. No afirmes disponibilidad en todas las regiones/planes.
- Cada término de `glossary` debe existir en `src/catalog/glossary.ts` (lo comprueba un test).
- Reutiliza los componentes agnósticos de `generic.ts` (cliente, resolver, CI, Argo CD, Deployment, Terraform).

## 2. Crear un escenario

Un escenario (`src/scenarios/<id>.ts`) es un `ScenarioDef`:

- `boundaries`: rectángulos para Internet, edge, región, VPC/VNet/VCN, subnets, cluster, namespaces, delivery.
- `nodes`: cada uno referencia un `service` del catálogo; los workloads Kubernetes llevan `workload` (deployment, namespace, réplicas, imagen, versión). `advanced: true` oculta el nodo en modo simplificado.
- `edges`: conexión real con `protocol`, `port`, `routingRule`, `traffic` (`north-south`, `east-west`, `control`, `delivery`) y `latencyMs` modelada.
- `request.root`: árbol de `FlowStep`. Cada hijo necesita un edge `padre → hijo`.
  - `sequential: true` ejecuta hijos en orden; por defecto van en paralelo (fan-out).
  - `async: true`: el padre no espera (colas, eventos).
  - `cacheHitRatio` + `when: 'previous-cache-miss'` modelan cache-aside (o la cache TTL de un resolver).
  - `timeoutMs`, `retries`, `onChildError` modelan deadlines, reintentos y traducción de errores.
- `delivery`: etapas del pipeline (con `perService` para fan-out), componentes de repo/CI/registry/GitOps/Argo CD/API server, parámetros del rollout y del job de Terraform.
- `faults`: al menos los seis tipos del MVP. Request: `reject` (status + reason; `0` = sin respuesta HTTP), `latency`, `blackhole`. Delivery: `tests-fail`, `image-pull-backoff`, `readiness-fail`, `terraform-state-lock`, `terraform-drift`. Incluye siempre `diagnosis`: qué debería observar el usuario.
- `simplifications`: lista honesta de lo que la simulación no modela.

## 3. Registrar el perfil

En `src/catalog/index.ts`:

```ts
buildProfile({
  id: 'gcp',
  name: 'Google Cloud',
  shortName: 'GCP',
  services: [...genericServices, ...gcpServices],
  scenarios: [gcpReferenceScenario],
}),
```

`buildProfile` valida con Zod y con `validateScenarioReferences`; un error de referencias rompe el arranque y los tests, no la simulación.

## 4. Probarlo

```bash
npm test        # valida esquemas y ejecuta los tests del motor
npm run dev     # selecciona el proveedor en la cabecera
```

Añade tests en `tests/engine/` para los fallos nuevos (status esperado, componentes que deben/no deben recibir tráfico).
