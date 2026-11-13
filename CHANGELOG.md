# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [Unreleased]

## [0.6.0] - 2026-11-13

### Añadido
- Rediseño "Living Infrastructure" de toda la capa de presentación (ver `docs/redesign/README.md`).
- Temas Dark Graphite y Light Technical con tokens centralizados, contraste AA verificado y preferencia persistente.
- Canvas por capas (Cloud, Networking, Kubernetes, Aplicación, Delivery, Observabilidad), conexiones clasificadas y seleccionables, resaltado de vecinos, leyenda, minimapa bajo demanda y centrado en la selección.
- Reorganización visual de nodos (arrastrar) con restauración; las posiciones son preferencias visuales separadas del escenario.
- Inspector por secciones e inspectores de conexión y de evento (IDs, payload y relación causal).
- Inspector y consola redimensionables y colapsables; atajos `c` (centrar) y `f` (ajustar).
- Dependencia `lucide-react` para la iconografía.

### Cambiado
- Cabecera organizada en Contexto / Simulación / Acciones / Vista; "Detalle avanzado" y "Movimiento reducido" pasan al menú de vista.

### Sin cambios
- Motor, modelo, escenarios y catálogo: sin modificaciones.

## [0.5.0] - 2026-11-13

### Añadido
- Perfil DigitalOcean con Cloudflare como edge externo, Network Load Balancer L4 y Gateway API gestionado (Cilium/Envoy) en DOKS; DOCR, Managed PostgreSQL, Managed Valkey, Managed Kafka, GitHub Actions y Spaces (backend s3).
- Catálogo Cloudflare reutilizable; componente genérico `github-actions`; glosario Gateway API, L4, Consumer lag.
- Intención opcional `ingress-gateway`, aspecto de comparación "Gateway L7 dentro del cluster" y notas DigitalOcean en todos los aspectos.

### Cambiado
- Intent `l7-load-balancer` → `load-balancer`.

## [0.4.0] - 2026-11-13

### Añadido
- Perfil Google Cloud con escenario de referencia (GKE detrás del Application Load Balancer externo global, Cloud Armor, NEGs container-native, Cloud SQL, Memorystore, Pub/Sub, GitHub + Cloud Build, backend gcs).
- Componente genérico `github-repo`; términos de glosario GFE, NEG y VPC-native.
- Notas de comparación para GCP; E2E de GCP.
- `loadBalancerOperation` configurable en la app "shop" compartida.

## [0.3.0] - 2026-11-13

### Añadido
- Modo comparación: segundo motor sincronizado, mapas en paralelo, comparación salto a salto y tabla de diferencias por aspecto.
- `.prettierrc.json` con el estilo del proyecto.

### Corregido
- El minimapa no dibujaba nodos (nodos controlados sin dimensiones iniciales).

## [0.2.0] - 2026-11-13

### Añadido
- Perfil Microsoft Azure con escenario de referencia (Front Door + WAF, Application Gateway + AGIC, AKS, ACR, PostgreSQL Flexible Server, Azure Managed Redis, Service Bus, Azure DevOps, backend azurerm).
- Campo `intent` en los nodos y aplicación "shop" compartida entre proveedores.
- `observabilityNotes`, `clusterNodeNames` y mensajes de Terraform por escenario.
- Tests del motor parametrizados por perfil, test de paridad y E2E de Azure.

### Cambiado
- El fallo `alb-no-healthy-targets` pasa a llamarse `lb-no-healthy-targets` (común a todos los perfiles).
- El contenido genérico del catálogo (CI, Deployment, Terraform, GitOps) ya no menciona servicios de AWS; la config del backend de state vive en el nodo de state de cada proveedor.

### Corregido
- `lb.route` mostraba la regla del edge entrante (la del componente anterior) en lugar de la regla del propio componente.

## [0.1.0] - 2026-11-13

### Añadido
- Vertical slice: motor determinista, perfil AWS (EKS detrás de CloudFront + ALB), flujos de request y delivery, Terraform, 11 fallos, consola correlacionada, trazas, métricas, inspector.
- Tests unitarios del motor y E2E con Playwright; CI; guía de Cloudflare Pages.
