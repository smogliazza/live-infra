/**
 * Catálogo Microsoft Azure. Contenido educativo: nombres, tiers y
 * capacidades a verificar contra la documentación oficial vigente (ver
 * enlaces). Configuraciones ILUSTRATIVAS.
 */
import type { CatalogService } from '../../../model/schemas';
import { svc } from '../../generic';

export const azureServices: CatalogService[] = [
  svc({
    id: 'azure-dns',
    name: 'Azure DNS (zona pública)',
    provider: 'azure',
    category: 'DNS',
    layer: 'dns',
    plane: 'data',
    role: 'DNS autoritativo de la zona example.com',
    inspector: {
      summary: 'Hospeda la zona pública y responde de forma autoritativa. shop.example.com es un CNAME al endpoint de Azure Front Door.',
      advanced:
        'Azure DNS es autoritativo: responde a los resolvers recursivos, no a los navegadores. Para un subdominio se usa un CNAME al hostname del endpoint de Front Door (*.azurefd.net); para el apex se usa un alias record al perfil de Front Door. Azure DNS Private Resolver y las zonas privadas son servicios distintos para resolución dentro de la VNet.',
      receives: ['Queries del resolver recursivo'],
      processes: ['Lookup en la zona', 'Alias records hacia recursos de Azure'],
      emits: ['Respuesta autoritativa con TTL'],
      protocols: ['DNS UDP/TCP'],
      ports: ['53'],
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO
resource "azurerm_dns_cname_record" "shop" {
  name                = "shop"
  zone_name           = azurerm_dns_zone.example.name
  resource_group_name = azurerm_resource_group.dns.name
  ttl                 = 300
  record              = azurerm_cdn_frontdoor_endpoint.shop.host_name
}`,
      },
      typicalMetrics: ['QueryVolume', 'RecordSetCount'],
      failureModes: [
        {
          name: 'Registro eliminado / dominio no validado en Front Door',
          symptoms: 'NXDOMAIN, o Front Door rechaza el host si el dominio personalizado no está validado (TXT _dnsauth).',
          diagnosis: 'dig @ns1-0x.azure-dns.com shop.example.com; revisar el estado de validación del dominio en Front Door.',
          mitigation: 'Restaurar el CNAME; esperar a que expire el TTL negativo en los resolvers.',
        },
      ],
      docs: [{ title: 'Azure DNS overview', url: 'https://learn.microsoft.com/en-us/azure/dns/dns-overview' }],
      glossary: ['TTL', 'Servidor autoritativo', 'Alias record'],
    },
  }),
  svc({
    id: 'azure-front-door',
    name: 'Azure Front Door (Premium)',
    provider: 'azure',
    category: 'CDN / Edge',
    layer: 'edge',
    plane: 'data',
    role: 'Edge global: TLS, cache, WAF y reenvío al origen',
    inspector: {
      summary: 'Punto de entrada global (anycast). Termina TLS cerca del usuario, aplica la política WAF y enruta hacia el origin group (Application Gateway).',
      advanced:
        'Una route asocia dominio + patrón de path con un origin group; el caching se habilita por route. Front Door abre una conexión nueva hacia el origen y añade el header X-Azure-FDID (id del perfil): el origen debe restringir tráfico al service tag AzureFrontDoor.Backend Y validar ese header, porque el service tag por sí solo incluye a otros clientes de Front Door. El tier Premium añade managed rule sets de WAF, bot protection y orígenes por Private Link.',
      receives: ['HTTPS del cliente (HTTP/2; HTTP/3 según configuración)'],
      processes: ['TLS termination (certificado gestionado o propio en Key Vault)', 'Evaluación de la política WAF', 'Route matching', 'Health probes al origin group'],
      emits: ['Request al origen con X-Azure-FDID, X-Forwarded-For', 'Respuesta con X-Azure-Ref'],
      protocols: ['HTTPS', 'HTTP/2', 'TLS 1.2/1.3'],
      ports: ['443'],
      trustBoundary: 'Límite público: Internet → red de Microsoft. Front Door es global, no pertenece a ninguna región ni VNet.',
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO
resource "azurerm_cdn_frontdoor_route" "api" {
  name                          = "api"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.shop.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.appgw.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.appgw.id]
  patterns_to_match             = ["/api/*"]
  supported_protocols           = ["Https"]
  forwarding_protocol           = "HttpsOnly"
  # sin bloque cache: las rutas /api no se cachean
}`,
      },
      typicalLogs: ['FrontDoorAccessLog: httpStatusCode, timeTaken, originName, cacheStatus, trackingReference'],
      typicalMetrics: ['RequestCount', 'OriginHealthPercentage', 'OriginLatency', 'Percentage4XX', 'Percentage5XX'],
      failureModes: [
        {
          name: 'Origen no saludable',
          symptoms: 'Errores 5xx desde Front Door; OriginHealthPercentage cae.',
          diagnosis: 'Revisar health probes del origin group y el acceso al origen (NSG, restricción X-Azure-FDID, certificado/SNI del origen).',
          mitigation: 'Corregir probe path/protocolo; asegurar que el certificado del origen coincide con el origin host header.',
        },
      ],
      docs: [{ title: 'Azure Front Door overview', url: 'https://learn.microsoft.com/en-us/azure/frontdoor/front-door-overview' }],
      glossary: ['PoP', 'Origin', 'Anycast'],
    },
  }),
  svc({
    id: 'azure-waf-frontdoor',
    name: 'Azure WAF (política de Front Door)',
    provider: 'azure',
    category: 'Seguridad',
    layer: 'security',
    plane: 'data',
    role: 'Filtra requests HTTP en el edge de Front Door',
    inspector: {
      summary: 'Política WAF asociada a Front Door: reglas personalizadas (IP, geo, rate limit) y, en el tier Premium, el Default Rule Set gestionado por Microsoft.',
      advanced:
        'Simplificación: la evaluación ocurre dentro de Front Door, no en un salto de red separado. Los managed rule sets (DRS, bot manager) sólo están disponibles en Front Door Premium; Standard admite sólo custom rules. En modo Prevention un bloqueo devuelve 403 "The request is blocked." por defecto (el status y el body son configurables). La request nunca llega a Application Gateway ni a AKS.',
      receives: ['Request HTTP inspeccionada'],
      processes: ['Custom rules por prioridad', 'Managed rules con anomaly scoring (DRS 2.x)'],
      emits: ['Allow / Block / Log / Redirect'],
      protocols: ['HTTP (inspección L7)'],
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO
resource "azurerm_cdn_frontdoor_firewall_policy" "shop" {
  name     = "wafshop"
  sku_name = "Premium_AzureFrontDoor"
  mode     = "Prevention"
  managed_rule {
    type    = "Microsoft_DefaultRuleSet"
    version = "2.1"     # verificar la versión recomendada vigente
    action  = "Block"
  }
}`,
      },
      typicalLogs: ['FrontDoorWebApplicationFirewallLog: action=Block, ruleName, policyMode, trackingReference'],
      typicalMetrics: ['WebApplicationFirewallRequestCount (por acción y regla)'],
      failureModes: [
        {
          name: 'Falso positivo',
          symptoms: '403 "The request is blocked." para usuarios legítimos; nada en los logs de la app.',
          diagnosis: 'Buscar el X-Azure-Ref de la respuesta en FrontDoorWebApplicationFirewallLog para identificar la regla.',
          mitigation: 'Exclusión específica (p.ej. un argumento de query) o cambiar la acción de esa regla; no pasar toda la política a Detection.',
        },
      ],
      docs: [
        { title: 'WAF on Azure Front Door', url: 'https://learn.microsoft.com/en-us/azure/web-application-firewall/afds/afds-overview' },
        { title: 'WAF policy settings (Front Door)', url: 'https://learn.microsoft.com/en-us/azure/web-application-firewall/afds/waf-front-door-policy-settings' },
      ],
      glossary: ['Web ACL', 'Managed rule group', 'Anomaly scoring'],
    },
  }),
  svc({
    id: 'azure-app-gateway',
    name: 'Azure Application Gateway v2 (+ AGIC)',
    provider: 'azure',
    category: 'Load balancing (L7)',
    layer: 'load-balancing',
    plane: 'data',
    role: 'Balanceador regional L7 que enruta a los Pods de AKS',
    inspector: {
      summary: 'Balanceador HTTP regional en un subnet dedicado de la VNet. El Application Gateway Ingress Controller (AGIC) lo configura a partir de los Ingress de Kubernetes.',
      advanced:
        'AGIC traduce Ingress → listeners, reglas y backend pools con las IPs de los Pods (con Azure CNI las IPs de Pod son direccionables en la VNet). Diferencia importante frente a otros balanceadores: cuando ningún miembro del backend pool está sano (o el pool está vacío), Application Gateway devuelve 502 Bad Gateway, no 503. También devuelve 502 si el backend no responde dentro del request timeout del backend setting. Application Gateway for Containers es la alternativa más reciente para AKS. Puede llevar su propio WAF regional; aquí el WAF está en Front Door.',
      receives: ['HTTPS desde Front Door (service tag AzureFrontDoor.Backend + header X-Azure-FDID)'],
      processes: ['TLS termination / re-encryption', 'Listener + regla de enrutado por host/path', 'Health probes', 'Selección de miembro del backend pool'],
      emits: ['HTTP hacia la IP del Pod'],
      protocols: ['HTTPS', 'HTTP/1.1', 'HTTP/2 (frontend)'],
      ports: ['443 (listener)', '8080 (backends)'],
      identity: ['AGIC usa una managed identity con permisos sobre el Application Gateway'],
      trustBoundary: 'Subnet dedicado snet-appgw; su NSG debe permitir el tráfico de infraestructura (GatewayManager) además de AzureFrontDoor.Backend.',
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO — Ingress gestionado por AGIC
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
  annotations:
    appgw.ingress.kubernetes.io/health-probe-path: /readyz
    appgw.ingress.kubernetes.io/request-timeout: "30"
spec:
  ingressClassName: azure-application-gateway
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend: { service: { name: api, port: { number: 80 } } }`,
      },
      typicalLogs: ['ApplicationGatewayAccessLog: httpStatus, serverStatus, serverRouted, timeTaken, serverResponseLatency'],
      typicalMetrics: ['UnhealthyHostCount', 'HealthyHostCount', 'BackendResponseStatus', 'ApplicationGatewayTotalTime', 'FailedRequests'],
      failureModes: [
        {
          name: '502 — backend pool sin miembros sanos',
          symptoms: 'Todas las requests devuelven 502; UnhealthyHostCount = tamaño del pool; serverStatus vacío en el access log.',
          diagnosis: 'Backend health en el portal / ApplicationGatewayBackendHealth; revisar probe path, NSG/UDR y readiness de los Pods.',
          mitigation: 'Alinear el probe con /readyz; asegurar réplicas suficientes y PodDisruptionBudget.',
        },
        {
          name: '502 por timeout del backend',
          symptoms: 'Requests lentas terminan en 502 al alcanzar el request timeout.',
          diagnosis: 'serverResponseLatency ≈ timeout configurado; investigar dependencias del servicio.',
          mitigation: 'Timeouts coherentes en toda la cadena; no sólo subir el timeout.',
        },
      ],
      docs: [
        { title: 'What is Application Gateway Ingress Controller?', url: 'https://learn.microsoft.com/en-us/azure/application-gateway/ingress-controller-overview' },
        { title: 'Troubleshoot 502 errors in Application Gateway', url: 'https://learn.microsoft.com/en-us/troubleshoot/azure/application-gateway/application-gateway-troubleshooting-502' },
      ],
      glossary: ['Listener', 'Backend pool', 'L7', 'Health check'],
    },
  }),
  svc({
    id: 'azure-aks-control-plane',
    name: 'Azure Kubernetes Service — control plane',
    provider: 'azure',
    category: 'Kubernetes administrado',
    layer: 'kubernetes',
    plane: 'control',
    role: 'API server, etcd, scheduler y controllers gestionados por Azure',
    inspector: {
      summary: 'Azure opera el control plane; los nodos (VM Scale Sets) viven en tu VNet. Los node pools de sistema y de usuario separan componentes del cluster y aplicaciones.',
      advanced:
        'Control plane ≠ data plane: si el API server no responde, los Pods existentes siguen sirviendo tráfico. El tier Standard añade SLA financiado del API server; el tier Free no. Con Microsoft Entra ID + Kubernetes RBAC (o Azure RBAC para Kubernetes) se controla el acceso. El kubelet de cada nodo usa la kubelet identity (managed identity) para hacer pull de ACR si tiene el rol AcrPull.',
      receives: ['Applies de Argo CD', 'Watches de kubelets y controllers'],
      processes: ['Admisión/validación', 'Persistencia en etcd', 'Scheduling', 'Controllers'],
      emits: ['Eventos de Kubernetes'],
      protocols: ['HTTPS (Kubernetes API)'],
      ports: ['443'],
      identity: ['Microsoft Entra ID para usuarios', 'Kubelet identity con AcrPull', 'Workload ID para Pods'],
      typicalLogs: ['Diagnostic settings: kube-apiserver, kube-audit, kube-controller-manager, kube-scheduler → Log Analytics'],
      typicalMetrics: ['apiserver_current_inflight_requests', 'kube_pod_status_phase', 'node_cpu_usage_percentage'],
      failureModes: [
        {
          name: 'Pod Pending',
          symptoms: 'FailedScheduling: Insufficient cpu / node(s) had untolerated taint.',
          diagnosis: 'kubectl describe pod; revisar node pools, taints (CriticalAddonsOnly en el pool de sistema) y cluster autoscaler.',
          mitigation: 'Escalar el node pool de usuario o ajustar requests/tolerations.',
        },
      ],
      docs: [{ title: 'What is AKS?', url: 'https://learn.microsoft.com/en-us/azure/aks/what-is-aks' }],
      glossary: ['Control plane', 'kubelet', 'Node pool', 'Scheduler'],
    },
  }),
  svc({
    id: 'azure-acr',
    name: 'Azure Container Registry',
    provider: 'azure',
    category: 'Registry',
    layer: 'registry',
    plane: 'delivery',
    role: 'Registry privado de imágenes OCI',
    inspector: {
      summary: 'Almacena las imágenes. Azure Pipelines hace push; los nodos de AKS hacen pull con la kubelet identity.',
      advanced:
        'La autorización es por Azure RBAC: el pipeline necesita AcrPush (vía service connection con workload identity federation) y la kubelet identity de AKS necesita AcrPull (`az aks update --attach-acr`). Con SKU Premium se puede desactivar el acceso público y usar private endpoint, geo-replicación y content trust. Desplegar por digest evita sorpresas con tags mutables.',
      receives: ['docker push desde Azure Pipelines', 'pull desde kubelet'],
      processes: ['Almacenar manifiestos y capas', 'Tasks / scanning con Defender for Containers (opcional)'],
      emits: ['Manifiestos y capas'],
      protocols: ['HTTPS (OCI Distribution API)'],
      ports: ['443'],
      identity: ['AcrPush para CI', 'AcrPull para la kubelet identity'],
      typicalLogs: ['ContainerRegistryRepositoryEvents: Push, Pull, Delete'],
      failureModes: [
        {
          name: 'manifest unknown / unauthorized',
          symptoms: 'ErrImagePull → ImagePullBackOff.',
          diagnosis: '"manifest unknown": el tag no existe. "401 unauthorized": falta AcrPull a la kubelet identity (az aks check-acr).',
          mitigation: 'Publicar antes de actualizar GitOps; asignar AcrPull.',
        },
      ],
      docs: [{ title: 'Azure Container Registry', url: 'https://learn.microsoft.com/en-us/azure/container-registry/container-registry-intro' }],
      glossary: ['OCI', 'Digest', 'Private endpoint'],
    },
  }),
  svc({
    id: 'azure-postgres-flexible',
    name: 'Azure Database for PostgreSQL — Flexible Server',
    provider: 'azure',
    category: 'Base de datos',
    layer: 'data',
    plane: 'data',
    role: 'PostgreSQL gestionado con acceso privado',
    inspector: {
      summary: 'PostgreSQL gestionado inyectado en un subnet delegado de la VNet (acceso privado), con alta disponibilidad zone-redundant.',
      advanced:
        'Con VNet integration el servidor vive en un subnet delegado y se resuelve por una zona DNS privada. Alta disponibilidad: standby síncrono en otra zona; en un failover el nombre DNS apunta a la nueva primaria y los clientes deben reconectar. Incluye PgBouncer integrado opcional para pooling. El límite de conexiones depende del tamaño de cómputo.',
      receives: ['Conexiones PostgreSQL desde los Pods'],
      processes: ['Queries', 'Replicación síncrona al standby (HA)'],
      emits: ['Result sets'],
      protocols: ['PostgreSQL wire protocol (TLS)'],
      ports: ['5432', '6432 (PgBouncer integrado)'],
      identity: ['Autenticación Microsoft Entra ID o usuario/contraseña en Key Vault'],
      trustBoundary: 'Subnet delegado privado; NSG del subnet de nodos/pods como origen permitido.',
      typicalLogs: ['PostgreSQLLogs: duration, slow query, connection authorized'],
      typicalMetrics: ['active_connections', 'cpu_percent', 'connections_failed', 'disk_iops_consumed_percentage'],
      failureModes: [
        {
          name: 'Pool agotado / query lenta',
          symptoms: 'Timeouts en orders (503); active_connections al límite.',
          diagnosis: 'Query Store / Query Performance Insight; trazas con el span db.query dominando.',
          mitigation: 'Índices, PgBouncer, límites de pool coherentes con max_connections, statement_timeout.',
        },
      ],
      docs: [{ title: 'Azure Database for PostgreSQL flexible server', url: 'https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/overview' }],
      glossary: ['Connection pool', 'Zone-redundant HA', 'Failover'],
    },
  }),
  svc({
    id: 'azure-managed-redis',
    name: 'Azure Managed Redis',
    provider: 'azure',
    category: 'Cache',
    layer: 'data',
    plane: 'data',
    role: 'Cache en memoria (cache-aside) vía private endpoint',
    inspector: {
      summary: 'Cache en memoria compatible con Redis, accesible por private endpoint. El servicio catalog la usa como cache-aside delante de PostgreSQL.',
      advanced:
        'Azure Managed Redis es el sucesor de Azure Cache for Redis, cuyos tiers se retiran (Enterprise en 2027; Basic/Standard/Premium el 30-sep-2028, según la FAQ oficial: verifica las fechas vigentes). Diferencias a tener en cuenta al migrar: es clustered por defecto (cambia el modo de conexión del cliente) y no admite VNet injection, por eso se accede con private endpoint.',
      receives: ['Comandos GET/SET'],
      processes: ['Lookup en memoria'],
      emits: ['Valor o nil (miss)'],
      protocols: ['RESP sobre TLS'],
      ports: ['10000 (TLS, por defecto)'],
      identity: ['Autenticación Microsoft Entra ID o access keys'],
      typicalMetrics: ['Cache Hits', 'Cache Misses', 'Connected Clients', 'Server Load'],
      failureModes: [
        {
          name: 'Cliente no preparado para modo cluster',
          symptoms: 'Errores MOVED/CROSSSLOT tras migrar desde Azure Cache for Redis.',
          diagnosis: 'Revisar la política de clustering y la configuración del cliente.',
          mitigation: 'Usar un cliente cluster-aware o la política de clustering adecuada.',
        },
      ],
      docs: [
        { title: 'Azure Managed Redis overview', url: 'https://learn.microsoft.com/en-us/azure/redis/overview' },
        { title: 'Azure Cache for Redis retirement FAQ', url: 'https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq' },
      ],
      glossary: ['Cache-aside', 'Hit ratio', 'Private endpoint'],
    },
  }),
  svc({
    id: 'azure-service-bus',
    name: 'Azure Service Bus (cola)',
    provider: 'azure',
    category: 'Mensajería',
    layer: 'messaging',
    plane: 'data',
    role: 'Broker de mensajes para trabajo asíncrono',
    inspector: {
      summary: 'orders publica un evento en una cola de Service Bus sin esperar a su procesamiento.',
      advanced:
        'Broker con colas y topics/subscriptions, dead-letter queue integrada, sesiones (orden FIFO por clave) y transacciones. El contexto de traza viaja en las application properties (Diagnostic-Id / traceparent). Private endpoint requiere el tier Premium.',
      receives: ['Send (AMQP 1.0)'],
      processes: ['Persistir el mensaje'],
      emits: ['Mensajes a consumidores (no modelados en el MVP)'],
      protocols: ['AMQP 1.0 sobre TLS', 'HTTPS'],
      ports: ['5671', '443 (AMQP sobre WebSockets)'],
      identity: ['Workload ID con rol Azure Service Bus Data Sender'],
      typicalMetrics: ['IncomingMessages', 'ActiveMessages', 'DeadletteredMessages', 'ThrottledRequests'],
      docs: [{ title: 'Azure Service Bus overview', url: 'https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-messaging-overview' }],
      glossary: ['Asíncrono', 'At-least-once', 'DLQ'],
    },
  }),
  svc({
    id: 'azure-repos',
    name: 'Azure Repos (repositorio de aplicación)',
    provider: 'azure',
    category: 'Control de versiones',
    layer: 'delivery',
    plane: 'delivery',
    role: 'Fuente del código; dispara pipelines',
    inspector: {
      summary: 'Repositorio Git de Azure DevOps con el código de los microservicios. Un push a main dispara el pipeline YAML.',
      advanced: 'Las branch policies de main exigen PR, revisores y build de validación. El trigger del pipeline puede filtrarse por paths para construir sólo los servicios modificados.',
      receives: ['git push'],
      processes: ['Almacenar commits', 'Branch policies', 'Triggers de pipeline'],
      emits: ['CI trigger'],
      protocols: ['HTTPS', 'SSH'],
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO — azure-pipelines.yml
trigger:
  branches: { include: [main] }
  paths: { include: [services/*] }`,
      },
      docs: [{ title: 'Azure Repos', url: 'https://learn.microsoft.com/en-us/azure/devops/repos/get-started/what-is-repos' }],
    },
  }),
  svc({
    id: 'azure-pipelines',
    name: 'Azure Pipelines (agente)',
    provider: 'azure',
    category: 'CI',
    layer: 'delivery',
    plane: 'delivery',
    role: 'Integración continua: test, scan, build, publish',
    inspector: {
      summary: 'Ejecuta el pipeline YAML en un agente (Microsoft-hosted o self-hosted): tests, scans, build y push de imágenes a ACR, y actualización del repo GitOps.',
      advanced:
        'CI ≠ CD: el pipeline no aplica nada al cluster; publica artefactos y cambia la referencia en Git. Se autentica en Azure con una service connection basada en workload identity federation (OIDC, sin secretos). Stages → jobs → steps; una estrategia matrix paraleliza el build por servicio. Los environments con approvals se usarían para gates manuales.',
      receives: ['CI trigger'],
      processes: ['checkout', 'lint', 'unit tests', 'SAST/SCA', 'docker build', 'image scan', 'push a ACR', 'commit GitOps'],
      emits: ['Imagen OCI a ACR', 'Commit al repo GitOps', 'Estado del run'],
      protocols: ['HTTPS'],
      identity: ['Service connection (workload identity federation) con rol AcrPush'],
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO
stages:
  - stage: test
    jobs:
      - job: unit
        steps: [{ script: make test }]
  - stage: build
    jobs:
      - job: image
        strategy:
          matrix: { api: { SERVICE: api }, catalog: { SERVICE: catalog }, orders: { SERVICE: orders } }
        steps:
          - task: Docker@2
            inputs:
              containerRegistry: acr-shop      # service connection
              repository: shop/$(SERVICE)
              command: buildAndPush
              tags: $(VERSION)`,
      },
      typicalLogs: ['Logs por step; resultados de tests publicados (PublishTestResults)'],
      typicalMetrics: ['duración del run', 'tasa de fallo por stage', 'lead time for changes'],
      failureModes: [
        {
          name: 'Tests fallidos',
          symptoms: 'Stage test en rojo; build y push no se ejecutan.',
          diagnosis: 'Pestaña Tests del run; reproducir localmente.',
          mitigation: 'Corregir el código; producción no cambia.',
        },
        {
          name: 'Push denegado',
          symptoms: 'unauthorized: authentication required al hacer push a ACR.',
          diagnosis: 'Revisar la service connection y la asignación AcrPush sobre el registry.',
          mitigation: 'Asignar el rol mínimo sobre ese registry.',
        },
      ],
      docs: [{ title: 'Azure Pipelines', url: 'https://learn.microsoft.com/en-us/azure/devops/pipelines/get-started/what-is-azure-pipelines' }],
      glossary: ['CI', 'Artefacto inmutable', 'OIDC'],
    },
  }),
  svc({
    id: 'azure-storage-tfstate',
    name: 'Azure Storage (Terraform state)',
    provider: 'azure',
    category: 'Almacenamiento',
    layer: 'iac',
    plane: 'control',
    role: 'Backend azurerm del state con locking nativo',
    inspector: {
      summary: 'Contenedor de Blob Storage donde Terraform guarda el state. El backend azurerm bloquea el state con un lease sobre el blob.',
      advanced:
        'A diferencia del backend S3 (lock file o, antes, DynamoDB), el backend azurerm usa las capacidades nativas de Blob Storage para locking y consistencia: no hay recurso extra de lock. Recomendado: autenticación con Entra ID (use_azuread_auth), versionado/soft delete del contenedor y acceso de red restringido. El state contiene datos sensibles.',
      receives: ['Lecturas/escrituras del state', 'Adquisición/liberación del lease'],
      processes: ['Almacenamiento del blob de state'],
      emits: ['State'],
      protocols: ['HTTPS (Blob API)'],
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO
terraform {
  backend "azurerm" {
    resource_group_name  = "rg-tfstate"
    storage_account_name = "sttfstateexample"
    container_name       = "tfstate"
    key                  = "shop/prod.tfstate"
    use_azuread_auth     = true
  }
}`,
      },
      docs: [{ title: 'Terraform azurerm backend', url: 'https://developer.hashicorp.com/terraform/language/backend/azurerm' }],
      glossary: ['State', 'Lock'],
    },
  }),
];
