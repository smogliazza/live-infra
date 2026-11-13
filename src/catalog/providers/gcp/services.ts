/**
 * Catálogo Google Cloud. Contenido educativo: nombres y capacidades a
 * verificar contra la documentación oficial vigente (ver enlaces).
 * Configuraciones ILUSTRATIVAS.
 */
import type { CatalogService } from '../../../model/schemas';
import { svc } from '../../generic';

export const gcpServices: CatalogService[] = [
  svc({
    id: 'gcp-cloud-dns',
    name: 'Cloud DNS (zona pública)',
    provider: 'gcp',
    category: 'DNS',
    layer: 'dns',
    plane: 'data',
    role: 'DNS autoritativo de la zona example.com',
    inspector: {
      summary: 'Zona pública gestionada. shop.example.com es un registro A hacia la IP anycast global del Application Load Balancer.',
      advanced:
        'A diferencia de AWS o Azure, no hace falta CNAME ni alias hacia un hostname del edge: el load balancer externo global tiene una IP estática anycast propia, anunciada desde todos los puntos de presencia de Google. Cloud DNS también ofrece zonas privadas y DNS peering para la VPC (servicios distintos).',
      receives: ['Queries del resolver recursivo'],
      processes: ['Lookup en la managed zone', 'Routing policies (WRR, geolocation, failover)'],
      emits: ['Respuesta autoritativa con TTL'],
      protocols: ['DNS UDP/TCP'],
      ports: ['53'],
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO
resource "google_dns_record_set" "shop" {
  managed_zone = google_dns_managed_zone.example.name
  name         = "shop.example.com."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.shop.address]
}`,
      },
      typicalLogs: ['Cloud DNS query logging (zonas privadas/servidores de políticas)'],
      failureModes: [
        {
          name: 'Registro eliminado',
          symptoms: 'NXDOMAIN; ninguna request llega al load balancer.',
          diagnosis: 'dig @ns-cloud-x1.googledomains.com shop.example.com; revisar la delegación NS en el registrador.',
          mitigation: 'Restaurar el registro A; esperar a que expire el TTL negativo.',
        },
      ],
      docs: [{ title: 'Cloud DNS overview', url: 'https://cloud.google.com/dns/docs/overview' }],
      glossary: ['TTL', 'Servidor autoritativo', 'Anycast'],
    },
  }),
  svc({
    id: 'gcp-ext-alb-frontend',
    name: 'External Application Load Balancer (global) — GFE + Cloud CDN',
    provider: 'gcp',
    category: 'Edge / Load balancing',
    layer: 'edge',
    plane: 'data',
    role: 'Frontend global: IP anycast, TLS en los Google Front Ends, Cloud CDN y Cloud Armor',
    inspector: {
      summary:
        'En Google Cloud el edge y el load balancer L7 son el MISMO producto: el Application Load Balancer externo global termina TLS en los Google Front Ends (GFE) más cercanos al usuario. Cloud CDN y Cloud Armor se habilitan sobre su backend service.',
      advanced:
        'Componentes: forwarding rule (IP anycast + puerto) → target HTTPS proxy (certificados, Certificate Manager) → URL map → backend service. El tráfico viaja desde el GFE por la red troncal de Google hasta la región del backend. No hay un CDN separado delante del load balancer como CloudFront→ALB o Front Door→Application Gateway. En el mapa se dibujan dos nodos (frontend en el edge y backend service) para ver la separación lógica, pero es un único producto.',
      receives: ['HTTPS del cliente (HTTP/2, HTTP/3 opcional)'],
      processes: ['TLS termination en el GFE', 'Evaluación de Cloud Armor', 'Cache de Cloud CDN (si está habilitado)', 'URL map: host/path → backend service'],
      emits: ['Request al backend service por la red de Google'],
      protocols: ['HTTPS', 'HTTP/2', 'HTTP/3 (QUIC) opcional'],
      ports: ['443'],
      trustBoundary: 'Límite público: Internet → red de Google. Los backends sólo deben aceptar tráfico de los rangos del GFE / health checks (130.211.0.0/22 y 35.191.0.0/16).',
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO — GKE Gateway API
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: { name: shop, namespace: shop }
spec:
  gatewayClassName: gke-l7-global-external-managed
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      tls: { mode: Terminate, certificateRefs: [{ name: shop-cert }] }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: api, namespace: shop }
spec:
  parentRefs: [{ name: shop }]
  hostnames: [shop.example.com]
  rules:
    - matches: [{ path: { type: PathPrefix, value: /api } }]
      backendRefs: [{ name: api, port: 80 }]`,
      },
      typicalLogs: ['Logs del load balancer: httpRequest.status, statusDetails (response_sent_by_backend, failed_to_pick_backend, backend_timeout…), cacheHit'],
      typicalMetrics: ['loadbalancing.googleapis.com/https/request_count', 'https/total_latencies', 'https/backend_latencies'],
      failureModes: [
        {
          name: 'Certificado gestionado en PROVISIONING',
          symptoms: 'Errores TLS tras crear el load balancer o cambiar DNS.',
          diagnosis: 'El certificado gestionado necesita que el DNS ya apunte a la IP del load balancer para validarse.',
          mitigation: 'Apuntar DNS primero, o usar autorización DNS de Certificate Manager.',
        },
      ],
      docs: [
        { title: 'External Application Load Balancer overview', url: 'https://cloud.google.com/load-balancing/docs/https' },
        { title: 'GKE Gateway API', url: 'https://cloud.google.com/kubernetes-engine/docs/concepts/gateway-api' },
      ],
      glossary: ['Anycast', 'GFE', 'PoP', 'L7'],
    },
  }),
  svc({
    id: 'gcp-cloud-armor',
    name: 'Google Cloud Armor (security policy)',
    provider: 'gcp',
    category: 'Seguridad',
    layer: 'security',
    plane: 'data',
    role: 'WAF y protección DDoS en el edge de Google',
    inspector: {
      summary: 'Security policy asociada al backend service (vía GCPBackendPolicy en GKE). Se evalúa en el edge, antes de que la request llegue a la región.',
      advanced:
        'Simplificación: la evaluación ocurre en el GFE, no en un salto separado. Las reglas preconfiguradas de WAF (basadas en OWASP CRS) se escriben en CEL, p.ej. evaluatePreconfiguredWaf(...). La acción deny admite 403, 404 o 502; la documentación recomienda 403 en la mayoría de los casos. Modo preview para evaluar reglas sin bloquear.',
      receives: ['Request HTTP inspeccionada en el edge'],
      processes: ['Reglas por prioridad (IP, geo, CEL, WAF preconfigurado, rate limiting)'],
      emits: ['allow / deny(403|404|502) / throttle / redirect'],
      protocols: ['HTTP (inspección L7)'],
      exampleConfig: {
        language: 'bash',
        code: `# ILUSTRATIVO
gcloud compute security-policies rules create 1000 \\
  --security-policy=shop-armor \\
  --expression="evaluatePreconfiguredWaf('xss-v422-stable')" \\
  --action=deny-403`,
      },
      typicalLogs: ['Logs del LB: jsonPayload.enforcedSecurityPolicy {name, outcome: DENY, matchedFieldValue, preconfiguredExprIds}'],
      typicalMetrics: ['networksecurity.googleapis.com/https/request_count (por outcome)'],
      failureModes: [
        {
          name: 'Falso positivo',
          symptoms: '403 en el edge; el backend no recibe nada.',
          diagnosis: 'En los logs del load balancer, enforcedSecurityPolicy muestra la regla y el preconfiguredExprId que coincidió.',
          mitigation: 'Excluir ese id de firma en la expresión o afinar la sensibilidad; probar en preview.',
        },
      ],
      docs: [
        { title: 'Cloud Armor security policy overview', url: 'https://cloud.google.com/armor/docs/security-policy-overview' },
        { title: 'Troubleshoot Cloud Armor', url: 'https://cloud.google.com/armor/docs/troubleshooting' },
      ],
      glossary: ['Web ACL', 'Managed rule group', 'Rate-based rule'],
    },
  }),
  svc({
    id: 'gcp-backend-service-neg',
    name: 'Backend service + NEG zonal (container-native LB)',
    provider: 'gcp',
    category: 'Load balancing (L7)',
    layer: 'load-balancing',
    plane: 'data',
    role: 'Selecciona un Pod sano y le envía la request',
    inspector: {
      summary: 'Parte "backend" del Application Load Balancer: un backend service con network endpoint groups (NEG) zonales que contienen directamente las IPs de los Pods de GKE.',
      advanced:
        'Container-native load balancing: con clusters VPC-native, el controlador de GKE (Gateway/Ingress) mantiene los NEGs con IP:puerto de cada Pod listo, sin pasar por NodePort ni kube-proxy. Los health checks salen de 130.211.0.0/22 y 35.191.0.0/16: si falta la regla de firewall, todos los endpoints quedan unhealthy y el load balancer responde 502 con statusDetails=failed_to_pick_backend. Si el backend no responde dentro del timeout del backend service (30 s por defecto) responde 502 backend_timeout.',
      receives: ['Requests del URL map'],
      processes: ['Balanceo entre endpoints del NEG', 'Health checks', 'Session affinity / timeouts del backend service'],
      emits: ['HTTP hacia la IP del Pod'],
      protocols: ['HTTP/1.1', 'HTTP/2', 'gRPC'],
      ports: ['8080 (endpoints del NEG)'],
      trustBoundary: 'Firewall de la VPC: permitir rangos del GFE y de health checks hacia los Pods.',
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO — health check y Cloud Armor del backend
apiVersion: networking.gke.io/v1
kind: HealthCheckPolicy
metadata: { name: api, namespace: shop }
spec:
  default:
    config:
      type: HTTP
      httpHealthCheck: { port: 8080, requestPath: /readyz }
  targetRef: { group: "", kind: Service, name: api }
---
apiVersion: networking.gke.io/v1
kind: GCPBackendPolicy
metadata: { name: api, namespace: shop }
spec:
  default:
    securityPolicy: shop-armor
    timeoutSec: 30
  targetRef: { group: "", kind: Service, name: api }`,
      },
      typicalLogs: ['statusDetails: response_sent_by_backend | failed_to_pick_backend | backend_timeout | backend_connection_closed_before_data_sent_to_client'],
      typicalMetrics: ['https/backend_request_count', 'https/backend_latencies', 'health check state por endpoint'],
      failureModes: [
        {
          name: '502 failed_to_pick_backend',
          symptoms: 'Todas las requests 502; el NEG no tiene endpoints sanos.',
          diagnosis: 'gcloud compute backend-services get-health; revisar la regla de firewall de health checks y el path del probe.',
          mitigation: 'Permitir 130.211.0.0/22 y 35.191.0.0/16; alinear el health check con /readyz.',
        },
        {
          name: '502 backend_timeout',
          symptoms: 'Requests lentas terminan en 502 al alcanzar el timeout del backend service.',
          diagnosis: 'backend_latencies ≈ timeout; investigar dependencias.',
          mitigation: 'Timeouts coherentes en la cadena; no sólo subir el timeout.',
        },
      ],
      docs: [
        { title: 'Container-native load balancing', url: 'https://cloud.google.com/kubernetes-engine/docs/concepts/container-native-load-balancing' },
        { title: 'Troubleshoot external Application Load Balancers', url: 'https://cloud.google.com/load-balancing/docs/https/troubleshooting-ext-https-lbs' },
      ],
      glossary: ['NEG', 'Health check', 'L7'],
    },
  }),
  svc({
    id: 'gcp-gke-control-plane',
    name: 'Google Kubernetes Engine — control plane',
    provider: 'gcp',
    category: 'Kubernetes administrado',
    layer: 'kubernetes',
    plane: 'control',
    role: 'API server, etcd, scheduler y controllers gestionados por Google',
    inspector: {
      summary: 'Google opera el control plane. El cluster es VPC-native: los Pods reciben IPs de un rango secundario (alias IP) de la subnet, enrutables en la VPC.',
      advanced:
        'Control plane ≠ data plane. GKE ofrece modo Standard (gestionas node pools) y Autopilot (Google gestiona los nodos y cobra por recursos de Pod). Un cluster regional replica el control plane en varias zonas. Workload Identity Federation for GKE permite a los ServiceAccounts de Kubernetes actuar como identidades IAM sin claves.',
      receives: ['Applies de Argo CD', 'Watches de kubelets y controllers'],
      processes: ['Admisión', 'etcd', 'Scheduling', 'Controllers (incluido el de NEGs)'],
      emits: ['Eventos de Kubernetes'],
      protocols: ['HTTPS (Kubernetes API)'],
      ports: ['443'],
      identity: ['IAM + RBAC de Kubernetes', 'Workload Identity Federation for GKE', 'Service account del nodo con roles/artifactregistry.reader'],
      typicalLogs: ['Cloud Logging: k8s_cluster (audit, control plane), k8s_container'],
      typicalMetrics: ['kubernetes.io/container/cpu/core_usage_time', 'kube_deployment_status_replicas_available (Managed Prometheus)'],
      failureModes: [
        {
          name: 'Pod Pending',
          symptoms: 'FailedScheduling: Insufficient cpu.',
          diagnosis: 'kubectl describe pod; revisar node pools y cluster autoscaler (en Autopilot, el aprovisionamiento de nodos puede tardar).',
          mitigation: 'Ajustar requests o permitir escalado de nodos.',
        },
      ],
      docs: [{ title: 'GKE overview', url: 'https://cloud.google.com/kubernetes-engine/docs/concepts/kubernetes-engine-overview' }],
      glossary: ['Control plane', 'kubelet', 'Node pool', 'VPC-native'],
    },
  }),
  svc({
    id: 'gcp-artifact-registry',
    name: 'Artifact Registry (repositorio Docker)',
    provider: 'gcp',
    category: 'Registry',
    layer: 'registry',
    plane: 'delivery',
    role: 'Registry regional de imágenes OCI',
    inspector: {
      summary: 'Repositorio Docker regional (p.ej. europe-west1-docker.pkg.dev/<proyecto>/shop). Cloud Build hace push; los nodos de GKE hacen pull.',
      advanced:
        'Container Registry (gcr.io) se apagó en 2025; Artifact Registry es su sustituto (los dominios gcr.io pueden servirse desde Artifact Registry). Permisos IAM: roles/artifactregistry.writer para el service account de Cloud Build y roles/artifactregistry.reader para el service account de los nodos. Puede escanear vulnerabilidades (Artifact Analysis). Los nodos privados llegan a la API con Private Google Access.',
      receives: ['docker push desde Cloud Build', 'pull desde kubelet'],
      processes: ['Almacenar manifiestos y capas', 'Escaneo de vulnerabilidades (opcional)'],
      emits: ['Manifiestos y capas'],
      protocols: ['HTTPS (OCI Distribution API)'],
      ports: ['443'],
      identity: ['roles/artifactregistry.writer (CI)', 'roles/artifactregistry.reader (nodos)'],
      typicalLogs: ['Cloud Audit Logs: docker push / pull'],
      failureModes: [
        {
          name: 'manifest unknown / 403',
          symptoms: 'ErrImagePull → ImagePullBackOff.',
          diagnosis: '"manifest unknown": el tag no existe. 403: el service account del nodo no tiene artifactregistry.reader.',
          mitigation: 'Publicar antes de actualizar GitOps; asignar el rol al service account del nodo.',
        },
      ],
      docs: [
        { title: 'Artifact Registry overview', url: 'https://cloud.google.com/artifact-registry/docs/overview' },
        { title: 'Transition from Container Registry', url: 'https://cloud.google.com/artifact-registry/docs/transition/transition-from-gcr' },
      ],
      glossary: ['OCI', 'Digest'],
    },
  }),
  svc({
    id: 'gcp-cloud-sql-postgres',
    name: 'Cloud SQL for PostgreSQL (HA regional, IP privada)',
    provider: 'gcp',
    category: 'Base de datos',
    layer: 'data',
    plane: 'data',
    role: 'PostgreSQL gestionado con IP privada',
    inspector: {
      summary: 'PostgreSQL gestionado con IP privada (Private Service Access o Private Service Connect) y alta disponibilidad regional: primaria y standby en zonas distintas.',
      advanced:
        'La instancia vive en una VPC del productor (Google) conectada a tu VPC; con Private Service Access es un peering. En failover HA la IP de la instancia se mantiene y pasa a la standby. Los Cloud SQL Auth Proxy / connectors aportan autenticación IAM y TLS sin gestionar certificados. Managed Connection Pooling está disponible en ediciones recientes; verifica disponibilidad.',
      receives: ['Conexiones PostgreSQL desde los Pods'],
      processes: ['Queries', 'Replicación síncrona a la standby (HA)'],
      emits: ['Result sets'],
      protocols: ['PostgreSQL wire protocol (TLS)'],
      ports: ['5432'],
      identity: ['IAM database authentication vía Auth Proxy, o usuario/contraseña en Secret Manager'],
      trustBoundary: 'VPC del productor accesible sólo por IP privada.',
      typicalLogs: ['cloudsql.googleapis.com/postgres.log: duration, slow queries'],
      typicalMetrics: ['cloudsql.googleapis.com/database/postgresql/num_backends', 'database/cpu/utilization'],
      failureModes: [
        {
          name: 'Pool agotado / query lenta',
          symptoms: 'Timeouts en orders (503); num_backends al máximo.',
          diagnosis: 'Query Insights; trazas con el span db.query dominando.',
          mitigation: 'Índices, pooling, límites coherentes con max_connections, statement_timeout.',
        },
      ],
      docs: [{ title: 'Cloud SQL for PostgreSQL', url: 'https://cloud.google.com/sql/docs/postgres' }],
      glossary: ['Connection pool', 'Zone-redundant HA', 'Failover'],
    },
  }),
  svc({
    id: 'gcp-memorystore',
    name: 'Memorystore (Redis / Valkey)',
    provider: 'gcp',
    category: 'Cache',
    layer: 'data',
    plane: 'data',
    role: 'Cache en memoria (cache-aside)',
    inspector: {
      summary: 'Cache en memoria gestionada accesible por IP privada; catalog la usa como cache-aside delante de Cloud SQL.',
      advanced: 'Memorystore ofrece Redis y Valkey (y modo cluster). Se conecta por Private Service Access o Private Service Connect según el producto. No es accesible desde Internet.',
      receives: ['Comandos GET/SET'],
      processes: ['Lookup en memoria'],
      emits: ['Valor o nil (miss)'],
      protocols: ['RESP (TLS opcional)'],
      ports: ['6379'],
      typicalMetrics: ['redis.googleapis.com/stats/cache_hit_ratio', 'stats/memory/usage_ratio'],
      docs: [{ title: 'Memorystore documentation', url: 'https://cloud.google.com/memorystore/docs' }],
      glossary: ['Cache-aside', 'Hit ratio'],
    },
  }),
  svc({
    id: 'gcp-pubsub',
    name: 'Pub/Sub',
    provider: 'gcp',
    category: 'Mensajería',
    layer: 'messaging',
    plane: 'data',
    role: 'Mensajería asíncrona global (topics y subscriptions)',
    inspector: {
      summary: 'orders publica un evento en un topic sin esperar a su procesamiento.',
      advanced:
        'Servicio global: no vive en tu VPC; los nodos privados lo alcanzan con Private Google Access. Entrega at-least-once (exactly-once opcional en pull subscriptions), dead-letter topics y ordering keys. El contexto de traza viaja en los atributos del mensaje.',
      receives: ['Publish (gRPC/HTTPS)'],
      processes: ['Persistir el mensaje en el topic'],
      emits: ['Mensajes a subscriptions (no modeladas en el MVP)'],
      protocols: ['gRPC', 'HTTPS'],
      ports: ['443'],
      identity: ['Workload Identity con roles/pubsub.publisher'],
      typicalMetrics: ['pubsub.googleapis.com/topic/send_request_count', 'subscription/oldest_unacked_message_age'],
      docs: [{ title: 'Pub/Sub overview', url: 'https://cloud.google.com/pubsub/docs/overview' }],
      glossary: ['Asíncrono', 'At-least-once', 'DLQ'],
    },
  }),
  svc({
    id: 'gcp-cloud-build',
    name: 'Cloud Build (trigger + build)',
    provider: 'gcp',
    category: 'CI',
    layer: 'delivery',
    plane: 'delivery',
    role: 'Integración continua: test, scan, build, publish',
    inspector: {
      summary: 'Un trigger de Cloud Build conectado al repositorio de GitHub ejecuta cloudbuild.yaml: tests, scans, build y push a Artifact Registry, y actualización del repo GitOps.',
      advanced:
        'CI ≠ CD: Cloud Build no despliega en el cluster en este diseño; publica y actualiza Git. Cada step es un contenedor; los steps pueden ir en paralelo con waitFor. Se autentica con un service account (sin claves exportadas). Cloud Deploy sería la alternativa nativa de CD, no usada aquí para mantener Argo CD como en los otros perfiles.',
      receives: ['Evento de push vía la conexión con GitHub'],
      processes: ['tests', 'SAST/SCA', 'docker build', 'image scan', 'push a Artifact Registry', 'commit GitOps'],
      emits: ['Imagen OCI', 'Commit al repo GitOps'],
      protocols: ['HTTPS'],
      identity: ['Service account de Cloud Build con roles/artifactregistry.writer'],
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO — cloudbuild.yaml
steps:
  - id: test
    name: golang:1.23
    script: make test
  - id: build-catalog
    name: gcr.io/cloud-builders/docker
    args: [build, -t, '\${_REGION}-docker.pkg.dev/$PROJECT_ID/shop/catalog:\${_VERSION}', services/catalog]
    waitFor: [test]
images:
  - '\${_REGION}-docker.pkg.dev/$PROJECT_ID/shop/catalog:\${_VERSION}'`,
      },
      typicalLogs: ['Build logs por step en Cloud Logging'],
      typicalMetrics: ['duración del build', 'tasa de fallo por step'],
      failureModes: [
        {
          name: 'Tests fallidos',
          symptoms: 'El step de tests falla; no se publican imágenes.',
          diagnosis: 'Logs del build; reproducir localmente.',
          mitigation: 'Corregir el código; producción no cambia.',
        },
        {
          name: 'Permiso denegado al publicar',
          symptoms: 'denied: Permission "artifactregistry.repositories.uploadArtifacts" denied.',
          diagnosis: 'Revisar los roles del service account de Cloud Build sobre el repositorio.',
          mitigation: 'Asignar roles/artifactregistry.writer en ese repositorio.',
        },
      ],
      docs: [{ title: 'Cloud Build overview', url: 'https://cloud.google.com/build/docs/overview' }],
      glossary: ['CI', 'Artefacto inmutable'],
    },
  }),
  svc({
    id: 'gcp-gcs-tfstate',
    name: 'Cloud Storage (Terraform state)',
    provider: 'gcp',
    category: 'Almacenamiento',
    layer: 'iac',
    plane: 'control',
    role: 'Backend gcs del state con locking',
    inspector: {
      summary: 'Bucket con versionado donde Terraform guarda el state. El backend gcs soporta locking sin recursos adicionales.',
      advanced:
        'El lock se implementa como un objeto .tflock junto al state, creado de forma condicional: si ya existe, otro proceso tiene el lock. HashiCorp recomienda habilitar Object Versioning en el bucket. Igual que en S3 y Blob Storage, el state contiene datos sensibles.',
      receives: ['Lecturas/escrituras del state y del lock'],
      processes: ['Almacenamiento de objetos versionado'],
      emits: ['State'],
      protocols: ['HTTPS (JSON API)'],
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO
terraform {
  backend "gcs" {
    bucket = "example-tfstate"
    prefix = "shop/prod"
  }
}`,
      },
      docs: [{ title: 'Terraform gcs backend', url: 'https://developer.hashicorp.com/terraform/language/backend/gcs' }],
      glossary: ['State', 'Lock'],
    },
  }),
];
