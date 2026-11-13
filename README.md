# Cloud Flow Lab

**Laboratorio visual e interactivo para comprender arquitecturas Cloud, DevOps, Kubernetes, networking y observabilidad.**
Simulación 100% educativa y determinista: no se conecta a cuentas cloud, no pide credenciales y no ejecuta operaciones reales.

> **Estado: v0.5.** Motor completo + perfiles **AWS**, **Microsoft Azure**, **Google Cloud** y **DigitalOcean** (con Cloudflare como edge) + **modo comparación**. OCI está planificado (ver [ROADMAP.md](ROADMAP.md)).

## Proveedores

La aplicación de ejemplo ("shop": `api`, `catalog`, `orders`) es la **misma** en todos los perfiles; cambia la infraestructura que la soporta. Cada nodo declara su *intención arquitectónica* (edge, WAF, LB L7, base de datos…) para comparar funciones y no nombres comerciales.

| Intención | AWS | Azure | Google Cloud | DigitalOcean |
|---|---|---|---|---|
| DNS autoritativo | Route 53 | Azure DNS | Cloud DNS | Cloudflare DNS (proxied) |
| Edge / CDN | CloudFront | Front Door Premium | External Application LB global (GFE) + Cloud CDN | Cloudflare (externo) |
| WAF | AWS WAF (web ACL) | Azure WAF (política de Front Door) | Cloud Armor | Cloudflare WAF |
| Load balancer → Pods | ALB (L7) + AWS Load Balancer Controller (`target-type: ip`) | Application Gateway v2 (L7) + AGIC | Backend service + NEG zonal (L7, Gateway API) | Network Load Balancer (L4) |
| Gateway L7 en el cluster | — | — | — | Gateway API gestionado (Cilium / Envoy) |
| Kubernetes | EKS | AKS | GKE (VPC-native) | DOKS |
| Registry | ECR | ACR | Artifact Registry | DOCR |
| Base de datos | RDS for PostgreSQL | PostgreSQL Flexible Server | Cloud SQL for PostgreSQL | Managed PostgreSQL |
| Cache | ElastiCache | Azure Managed Redis | Memorystore | Managed Valkey |
| Cola | SQS | Service Bus | Pub/Sub | Managed Kafka |
| CI | GitLab CI/CD | Azure DevOps Pipelines | GitHub + Cloud Build | GitHub Actions |
| State de Terraform | S3 (`use_lockfile`) | Blob Storage (lease nativo) | GCS (objeto `.tflock`) | Spaces vía backend s3 (locking a verificar) |

Las equivalencias son **aproximadas**: el inspector y los escenarios de fallo documentan las diferencias. Por ejemplo, sin destinos sanos el ALB devuelve **503**, Application Gateway **502**, el load balancer de Google **502 `failed_to_pick_backend`** y en DigitalOcean el 503 lo genera Envoy dentro del cluster (el NLB es L4 y no habla HTTP); en Google Cloud el edge y el load balancer L7 son el mismo producto.

## Qué puedes hacer

- **Enviar una request** y seguirla salto a salto: resolver DNS → DNS autoritativo → edge → WAF → load balancer L7 → `api` → fan-out a `catalog` (cache / base de datos) y `orders` (base de datos + cola asíncrona) → respuesta de vuelta.
- **Lanzar una release** multi-servicio: push → CI (tests, scans, build/scan/push por servicio en paralelo) → registry → repo GitOps → Argo CD → rolling update en Kubernetes (probes, EndpointSlices) → smoke test → rollback GitOps si algo falla.
- **Ejecutar un cambio de infraestructura** con Terraform (plan, aprobación manual, apply, state lock), separado de las releases.
- **Inyectar fallos** (403 WAF, LB sin destinos sanos, deadline/reintento 504, NetworkPolicy, DB saturada, NXDOMAIN con TTL, tests rotos, ImagePullBackOff, readiness fallida, state lock, drift) y diagnosticarlos.
- **Correlacionar**: cada pulso del mapa, línea de la consola, span de la traza y métrica sale del mismo event stream. Clic en un log → resalta nodo/edge; clic en un nodo → filtra la consola; clic en un pulso o traza → resalta el recorrido completo.
- **Inspeccionar** cualquier componente: explicación, detalle avanzado, configuración ilustrativa, protocolos/puertos, identidad, límites de confianza, pods en vivo, fallos típicos, documentación oficial y glosario.
- **Comparar proveedores** ("Comparar con" en la cabecera): el mismo escenario corre en dos proveedores con el mismo reloj, los mismos comandos y los mismos fallos. Verás los dos mapas en paralelo, la última request salto a salto en cada lado y una tabla de diferencias por aspecto (DNS, edge, WAF, LB, red, identidad, Kubernetes, registry, datos, CI, state de Terraform, observabilidad), sin puntuación de "mejor cloud".
- **Controlar el tiempo**: play/pausa, paso adelante, **paso atrás** (replay determinista), reinicio y velocidad 0.25×–25×.

## Inicio rápido

Requisitos: Node.js 20+.

```bash
npm ci
npm run dev
```

Abre http://localhost:5173.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (Vite) |
| `npm test` | Tests del motor (Vitest) |
| `npm run test:e2e` | Tests E2E (Playwright; construye y sirve la app) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run build` | Build estático en `dist/` |
| `npm run preview` | Sirve `dist/` localmente |

Atajos: `espacio` play/pausa · `shift+→` / `shift+←` paso adelante/atrás · `r` enviar request · `esc` cerrar inspector.

## Escalas temporales

Un único reloj virtual con dos escalas para que las requests se sientan rápidas y los despliegues deliberados:

- **Request:** 1 ms virtual = 1 ms modelado.
- **Delivery / IaC:** 1 ms virtual = 1 s modelado.
- A velocidad 1× avanzan 10 ms virtuales por segundo real.

Todos los tiempos, logs, métricas y configuraciones son **sintéticos** y están marcados como simulados.

## Arquitectura

React + TypeScript + Vite · XYFlow (React Flow) para el mapa · Zustand para el estado de UI · Zod para validar catálogos y escenarios · Vitest + Playwright.

```
src/model      modelo de dominio y esquemas
src/engine     motor determinista (sin React): reloj, scheduler, flujos, observabilidad
src/catalog    catálogos de servicios por proveedor (contenido del inspector)
src/scenarios  escenarios declarativos (topología, flujos, fallos)
src/ui         componentes React que sólo renderizan el estado del motor
```

Más detalle en [docs/architecture.md](docs/architecture.md) (modelo de dominio, contrato de eventos, máquina de estados, riesgos).

## Documentación

- [Arquitectura interna](docs/architecture.md)
- [Cómo añadir proveedores, servicios y escenarios](docs/adding-providers-and-scenarios.md)
- [Publicación en Cloudflare Pages y DNS](docs/deploy-cloudflare-pages.md)
- [Roadmap (implementado vs pendiente)](ROADMAP.md)
- [Guía de contribución](CONTRIBUTING.md) · [Código de conducta](CODE_OF_CONDUCT.md) · [Changelog](CHANGELOG.md)

## Rigor y límites

- CI ≠ CD ≠ IaC ≠ GitOps: el pipeline publica artefactos y actualiza Git; Argo CD reconcilia; Terraform gestiona infraestructura y no corre en cada release.
- Control plane ≠ data plane; L4 ≠ L7; norte-sur ≠ este-oeste.
- Cada escenario lista sus simplificaciones. Nombres y capacidades de servicios deben verificarse contra la documentación oficial vigente (enlazada en el inspector).

## Licencia

[MIT](LICENSE).
