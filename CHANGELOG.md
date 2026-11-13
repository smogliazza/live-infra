# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [Unreleased]

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
