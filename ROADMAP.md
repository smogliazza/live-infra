# Roadmap

Separación explícita entre lo **implementado** y lo **pendiente**. Basado en el plan por fases de la especificación.

## ✅ Implementado

**v0.5 — Perfil DigitalOcean (+ Cloudflare)**
- Perfil **DigitalOcean**: Cloudflare como edge externo (DNS proxied, proxy, WAF), Network Load Balancer L4, Gateway API gestionado de DOKS (Cilium/Envoy), DOKS, DOCR, Managed PostgreSQL, Managed Valkey, Managed Kafka, GitHub Actions, Spaces con backend s3.
- Catálogo Cloudflare reutilizable (`src/catalog/providers/cloudflare`) para futuras variantes Cloudflare de otros perfiles.
- Intención opcional `ingress-gateway` y salto de gateway opcional en la app compartida; intent `l7-load-balancer` renombrado a `load-balancer` (no siempre es L7).

**v0.4 — Perfil Google Cloud**
- Perfil **Google Cloud**: Cloud DNS, Application Load Balancer externo global (GFE + Cloud CDN), Cloud Armor, backend service con NEGs (container-native) vía Gateway API, GKE VPC-native, Artifact Registry, Cloud SQL, Memorystore, Pub/Sub, GitHub + Cloud Build, backend gcs.
- Notas de comparación GCP en todos los aspectos; suite del motor y E2E para GCP.

**v0.3 — Modo comparación**
- Segundo motor sincronizado: mismo reloj, mismos comandos en el mismo instante, fallos aplicados en ambos (ids comunes).
- Vista paralela de mapas, comparación salto a salto de la última request (alineada por `intent`) y tabla de diferencias por aspecto (`src/catalog/comparison.ts`).
- Tests de sincronización vía store y E2E (503 en AWS vs 502 en Azure).

**v0.2 — Perfil Azure**
- Perfil **Microsoft Azure**: Azure DNS, Front Door Premium + WAF, Application Gateway v2 + AGIC, AKS, ACR, PostgreSQL Flexible Server, Azure Managed Redis, Service Bus, Azure Repos + Azure Pipelines, backend azurerm.
- Aplicación "shop" compartida entre proveedores (`src/scenarios/shop-app.ts`) e `intent` por nodo para comparar funciones.
- Los 11 fallos existen con el mismo id en todos los perfiles; diferencias reales documentadas (502 vs 503, lease vs lock file…).
- Todo el suite del motor se ejecuta por perfil + test de paridad entre perfiles; E2E de Azure.

**v0.1 — vertical slice**

**Fase 0 — Diseño y base**
- Modelo de dominio tipado y validado con Zod + validación de referencias cruzadas.
- Contrato de eventos, comandos y estados visuales.
- Estructura modular: `model` / `engine` / `catalog` / `scenarios` / `ui`.
- Documentación de arquitectura, escalas temporales y riesgos.

**Fase 1 — Motor y UX**
- Motor determinista: reloj virtual, scheduler `(time, seq)`, PRNG con semilla, replay exacto, step forward / step back.
- Flujo de request: DNS (resolver + autoritativo con cache TTL), edge, WAF, ALB, fan-out a microservicios, cache-aside, DB, cola asíncrona, deadlines, reintentos, respuestas tardías.
- Flujo de delivery: push → webhook → CI (tests, scans, build/scan/push por servicio en paralelo) → GitOps → Argo CD (diff/sync/health) → rolling update con probes y EndpointSlices → smoke test real → rollback GitOps.
- Terraform independiente: init → lock → plan → aprobación manual → apply → unlock.
- 11 fallos inyectables (6 de data plane, 5 de delivery/IaC).
- Canvas 2D (XYFlow) con regiones/VPC/subnets/cluster/namespaces, pulsos de request/respuesta/delivery, zoom, pan, minimapa, fit-to-view, modo simplificado/avanzado.
- Consola correlacionada (filtros por nodo, traza, dominio, texto), trazas con waterfall, métricas derivadas, vista de pipeline/K8s/IaC, panel de fallos.
- Inspector con explicación, descripción avanzada, config ilustrativa, conexiones, pods, eventos recientes, fallos típicos, docs oficiales y glosario.
- Accesibilidad básica: teclado, atajos, reduced motion, responsive.
- Perfil **AWS** con arquitectura de referencia.
- Tests: 27 unitarios del motor (orden causal, branching, concurrencia, replay, sincronización del event bus, fallos, delivery, IaC, métricas) y 5 E2E con Playwright.
- CI (GitHub Actions) y guía de Cloudflare Pages.

## 🔜 Pendiente

**Fase 2 — Cinco perfiles**
- [x] Perfil Azure.
- [x] Perfil Google Cloud.
- [x] Perfil DigitalOcean (con Cloudflare como edge).
- [ ] Perfil OCI (catálogo + escenario de referencia), validado contra documentación oficial.
- [x] Cloudflare como edge en DigitalOcean.
- [ ] Variante Cloudflare opcional para AWS, Azure, GCP y OCI (el catálogo ya es reutilizable).
- [ ] Cloud Run como arquitectura alternativa serverless en GCP.
- [ ] Arquitectura mínima + avanzada expandible por perfil (expand/collapse por grupo).

**Fase 3 — Flujos y observabilidad**
- [ ] Estrategias canary y blue/green (Argo Rollouts) además de rolling.
- [x] Azure DevOps Pipelines como motor de CI (perfil Azure).
- [ ] Handshakes TCP/TLS y HTTP/3/QUIC como pasos visibles (modo protocolo).
- [ ] Networking K8s detallado: Pod IP, CNI, kube-proxy/eBPF, CoreDNS, NetworkPolicy como objetos inspeccionables.
- [ ] Service mesh (mTLS, retries, circuit breaker, rate limiting).
- [ ] Autoscaling (HPA / nodos), picos de carga, retries en cascada, circuit breaker.
- [ ] Vista Prometheus/Grafana vs CloudWatch/Azure Monitor/Cloud Observability/OCI Monitoring.

**Fase 4 — Comparación y fallos**
- [x] Modo comparación sincronizado de 2 proveedores (misma intención, vista paralela, tabla de diferencias sin "mejor cloud").
- [ ] Comparación de 3+ proveedores y step-back en modo comparación.
- [ ] Más escenarios: TLS inválido, DB failover, Argo CD OutOfSync recurrente, permisos de publicación en registry, cambio destructivo en Terraform.
- [ ] Modos guiado y troubleshooting con objetivos y pistas.
- [ ] Post-mortem con línea temporal exportable.

**Fase 5 — Publicación**
- [ ] Snapshots del motor para step-back barato en sesiones largas.
- [ ] Auditoría de accesibilidad (axe) y rendimiento con cientos de pulsos.
- [ ] Persistencia local de preferencias y escenarios (localStorage/IndexedDB, sin credenciales).
- [ ] Capturas/GIFs, dominio público, publicación del esquema de escenarios para contribuciones.
