# Arquitectura interna

> Estado: **v0.3** — motor, perfiles AWS y Azure, modo comparación. Este documento describe lo que ya existe en el código; lo pendiente está en [ROADMAP.md](../ROADMAP.md).

## 1. Principios

1. **El motor es la única fuente de verdad.** Animación, consola, métricas, trazas e inspector en vivo se derivan del mismo event stream. La UI no inventa comportamiento.
2. **Determinismo.** Misma semilla + mismos comandos ⇒ mismo log, byte a byte. Eso habilita replay, step-back y tests reproducibles.
3. **Declarativo.** Proveedores, servicios, topologías, flujos y fallos son datos tipados (Zod). Añadir un proveedor no requiere tocar el motor.
4. **Rigor.** CI ≠ CD ≠ IaC ≠ GitOps; control plane ≠ data plane. Cada escenario enumera sus simplificaciones.
5. **Todo es sintético** y se etiqueta como tal (`simulated: true`, badge SIMULADO, configs "ILUSTRATIVAS").

## 2. Módulos

```
src/
├── model/            Modelo de dominio + esquemas Zod + validación de referencias cruzadas
│   └── schemas.ts
├── engine/           Motor determinista (sin React, sin DOM)
│   ├── events.ts       Contrato de eventos y comandos
│   ├── scheduler.ts    Min-heap ordenado por (time, seq)
│   ├── rng.ts          PRNG mulberry32
│   ├── engine.ts       Reloj virtual, dispatch de comandos, emit, replay
│   ├── request.ts      Flujo B: data plane (árbol de llamadas)
│   ├── delivery.ts     Flujo A: CI → registry → GitOps → Argo CD → K8s; Terraform
│   └── observability.ts Métricas, trazas y estado visual derivados del log
├── catalog/          Catálogos de servicios (contenido del inspector)
│   ├── generic.ts      Componentes agnósticos (cliente, DNS, CI, Argo CD, Deployment, Terraform)
│   ├── glossary.ts
│   ├── providers/aws/services.ts
│   └── index.ts        Registro de perfiles + validación al cargar
├── scenarios/        Escenarios declarativos (topología + flujos + fallos)
│   └── aws-reference.ts
└── ui/               React: sólo renderiza estado del motor
    ├── state/store.ts  Zustand: referencia al motor + estado de UI
    └── components/     Header, FlowCanvas (XYFlow), Inspector, Console, Sparkline
```

Dependencias permitidas: `ui → engine → model`, `catalog/scenarios → model`. El motor nunca importa de `ui` ni de `catalog`.

## 3. Modelo de dominio

| Entidad | Campos clave | Dónde |
|---|---|---|
| `ProviderProfile` | id, name, services[], scenarios[] | `model/schemas.ts` |
| `CatalogService` | id, provider, category, layer, plane, role, inspector | idem |
| `ScenarioDef` | id, providerId, boundaries[], nodes[], edges[], request.root, delivery, faults[], simplifications[] | idem |
| `NodeDef` | id, service, boundary, x/y, advanced, workload? | idem |
| `EdgeDef` | id, source, target, protocol, port, routingRule, traffic, latencyMs | idem |
| `FlowStep` | component, operation, processMs, children[], sequential, async, cacheHitRatio, when, timeoutMs, retries, onChildError | idem |
| `FaultDef` | id, domain, component, effect (reject/latency/blackhole) o deliveryEffect | idem |
| `SimulationEvent` | id, seq, virtualTime, scenarioId, provider, domain, type, severity, componentId, edgeId, traceId, spanId, parentSpanId, payload, stateTransition | `engine/events.ts` |
| `Trace` / `Span` | traceId, spans[], status, totalDuration / spanId, parentSpanId, componentId, start, duration, status | `engine/observability.ts` |

`validateScenarioReferences` comprueba lo que Zod no puede: que cada nodo referencia un servicio del catálogo, que cada paso del flujo tiene un edge real padre→hijo, que los fallos apuntan a nodos existentes, etc. Se ejecuta al cargar el catálogo (falla pronto) y en los tests.

## 4. Contrato de eventos

Cada evento lleva (ver `engine/events.ts`):

- `id` determinista (`ev-<seed>-<seq>`), `seq` (posición en el log), `virtualTime` (ms virtuales).
- `scenarioId`, `provider`, `domain` (`request` | `delivery` | `iac` | `system`), `type`, `severity`.
- `componentId` y, si el evento ocurre sobre una conexión, `edgeId`.
- `traceId`, `spanId`, `parentSpanId` en el dominio request (formato W3C: 32 y 16 hex).
- `stateTransition { componentId, from, to }` cuando cambia el estado visual de un componente.
- `payload` didáctico (protocolo, puerto, status, latencia, regla de enrutado…), `simulated: true`.

Tipos principales: `request.started/completed`, `net.send/arrive`, `span.start/end`, `dns.query`, `tls.handshake`, `lb.route`, `cache.hit/miss`, `db.query`, `queue.publish`, `call.timeout/retry/late-response`, `fault.applied`; `git.push`, `webhook.delivered`, `pipeline.*`, `stage.*`, `image.pushed`, `gitops.commit`, `argocd.diff/sync/health`, `k8s.event`, `endpoints.updated`, `rollout.*`, `rollback.started`, `release.*`; `terraform.*`.

**Comandos** (`Command`): `startRequest`, `setLoad`, `startRelease`, `startInfraChange`, `approve`, `toggleFault`. Se registran como `{ afterJobs, at, command }`.

## 5. Motor y máquina de estados

### Reloj y scheduler

- El motor mantiene `now` (ms virtuales) y una cola de jobs `(time, seq)`. `step()` procesa exactamente un job; `advanceTo(t)` procesa todos los jobs `≤ t`.
- La UI convierte tiempo real en virtual: `Δvirtual = Δreal × 0.01 × velocidad` (a 1× avanzan 10 ms virtuales por segundo real).

### Dos escalas temporales

| Dominio | Equivalencia | Ejemplo |
|---|---|---|
| Request | 1 ms virtual = 1 ms modelado | una request de ~60 ms tarda ~6 s reales a 1× |
| Delivery / IaC | 1 ms virtual = 1 s modelado (×1000) | una release de ~6 min tarda ~36 s reales a 1× |

Así las requests se ven rápidas y ligeras y los despliegues lentos y deliberados, en un único reloj y sin esperar tiempos reales.

### Replay y step-back

`SimulationEngine.replay(scenario, catalog, seed, commands, untilJobs, finalNow?)` crea un motor nuevo y reaplica cada comando exactamente después del mismo número de jobs procesados. Step-back = replay hasta `jobsProcessed - 1`. Los tests verifican que el log reconstruido es idéntico.

### Flujo de request (árbol de llamadas)

Para cada `FlowStep`: `net.send` (pulso por el edge) → `span.start` al llegar → aplicar fallos → `component.process` → hijos (paralelo = fan-out, secuencial, asíncrono) → convergencia → `span.end` → pulso de respuesta → resultado al padre. Deadlines (`timeoutMs`) generan `call.timeout`; con `retries` se reintenta; la respuesta tardía se descarta (`call.late-response`). Un proxy propaga el status del upstream; un servicio con `onChildError` lo traduce.

### Estados visuales

`idle → running → success | failed | warning | retrying | blocked | rolling-back`. Los estados terminales se desvanecen a `idle` tras un tiempo virtual. Un Deployment en rollout muestra `running`/`rolling-back` mientras dure.

### Release (Flujo A)

```
git.push → webhook → pipeline.started
  → checkout → lint → unit tests → SAST
  → [build → image scan → push] × servicio (fan-out en paralelo)
  → actualizar GitOps → pipeline.completed            (CI termina aquí)
  → Argo CD: fetch → diff (OutOfSync) → sync (apply)  (CD/GitOps)
  → rollout × servicio (maxSurge/maxUnavailable, probes, EndpointSlice)
  → smoke test = request real por el data plane
  → release.completed
fallos → ProgressDeadlineExceeded → Argo Degraded → git revert → sync → rollout a la versión anterior → release.failed
```

### Terraform (independiente de la release)

`init → lock → refresh/plan → aprobación (bloquea hasta el comando approve) → apply → escribir state + unlock`.

## 6. UI

- **Canvas** (XYFlow): boundaries como nodos de fondo; nodos de componente; edges "flotantes" propios que dibujan los pulsos activos (`engine.transfers`) interpolando `(now - start) / (end - start)`. Carriles separados para ida, vuelta y delivery; pequeño offset por trace para evitar solapes.
- **Correlación**: seleccionar un log resalta su nodo/edge; seleccionar un nodo filtra la consola; seleccionar una traza (o un pulso) resalta todo su recorrido.
- **Inspector**: contenido del catálogo + estado en vivo (pods, conexiones, eventos recientes).
- **Accesibilidad**: navegación por teclado, atajos, `prefers-reduced-motion` (pulsos estáticos), contraste AA en textos principales, layout responsive.

## 7. Modo comparación

- El store mantiene un segundo `SimulationEngine` (`compareEngine`) creado con la misma semilla. `tick` avanza ambos al mismo instante y `dispatch` aplica cada comando a los dos en el mismo `now`.
- Los fallos tienen el **mismo id** en todos los perfiles (`lb-no-healthy-targets`, `waf-false-positive`…), así que un mismo comando inyecta la avería equivalente en ambos lados. Un test de paridad lo garantiza.
- La comparación salto a salto alinea spans por `intent` del nodo (o por id del microservicio, que es común: la app "shop" se define una sola vez en `src/scenarios/shop-app.ts`).
- La tabla de diferencias (`src/catalog/comparison.ts`) tiene notas por proveedor y aspecto; un test exige que cada perfil registrado tenga nota en cada aspecto.
- Step-back no está disponible en comparación (los dos motores tienen números de jobs distintos); step-forward avanza ambos al siguiente instante con trabajo.

## 8. Riesgos técnicos

| Riesgo | Mitigación actual / prevista |
|---|---|
| Rendimiento con cientos de pulsos simultáneos | Re-render por frame vía contexto; medir y, si hace falta, dibujar pulsos en un único `<canvas>` overlay. |
| Crecimiento del log en sesiones largas | Límite `maxEvents` (50k); ventana de métricas por búsqueda binaria. Pendiente: compactación/“snapshots” para step-back barato. |
| Step-back costoso (replay desde 0) | Aceptable para el MVP; pendiente: snapshots periódicos. |
| Exactitud de la información de proveedores | Enlaces a docs oficiales; lista de simplificaciones; revisión por proveedor antes de publicar (Fase 2). |
| Cinco diagramas inmanejables | Modo simplificado/avanzado por nodo/edge; arquitectura mínima + expandible por perfil. |
| Equivalencias falsas entre clouds | El modo comparación compara *intención* (capas) y documenta diferencias explícitas (Fase 4). |
