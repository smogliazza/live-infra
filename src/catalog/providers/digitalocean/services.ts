/**
 * Catálogo DigitalOcean. Contenido educativo: nombres y capacidades a
 * verificar contra la documentación oficial vigente (ver enlaces).
 * Configuraciones ILUSTRATIVAS.
 */
import type { CatalogService } from '../../../model/schemas';
import { svc } from '../../generic';

export const digitaloceanServices: CatalogService[] = [
  svc({
    id: 'do-network-lb',
    name: 'DigitalOcean Network Load Balancer (L4)',
    provider: 'digitalocean',
    category: 'Load balancing (L4)',
    layer: 'load-balancing',
    plane: 'data',
    role: 'Reparte conexiones TCP entre los nodos del cluster',
    inspector: {
      summary: 'Load balancer de capa 4 aprovisionado automáticamente por DOKS al crear un Gateway. No ve HTTP: reenvía conexiones TCP a los nodos, y el enrutado HTTP lo hace el Gateway dentro del cluster.',
      advanced:
        'L4 vs L7: este load balancer no puede enrutar por host/path, ni terminar TLS, ni generar un 503 HTTP: si no hay destinos, la conexión falla y el edge (Cloudflare) devuelve su propio error 52x. El TLS de Cloudflare atraviesa el NLB y lo termina el Gateway. DigitalOcean también ofrece un load balancer regional HTTP (L7); con él, si todos los destinos están unhealthy devuelve 503. Se personaliza con anotaciones service.beta.kubernetes.io/do-loadbalancer-*.',
      receives: ['Conexiones TCP desde Cloudflare'],
      processes: ['Selección de nodo', 'Health checks TCP/HTTP'],
      emits: ['Conexión TCP al nodo (Envoy de Cilium)'],
      protocols: ['TCP (L4)'],
      ports: ['443'],
      trustBoundary: 'Tiene IP pública: limitar el origen a los rangos IP de Cloudflare (firewall) o usar Cloudflare Tunnel.',
      typicalMetrics: ['conexiones activas', 'estado de health check por nodo', 'tráfico de red'],
      failureModes: [
        {
          name: 'Firewall bloquea a Cloudflare',
          symptoms: 'Cloudflare devuelve 522 (timeout de conexión).',
          diagnosis: 'Revisar reglas de firewall del load balancer / Cloud Firewall frente a los rangos publicados por Cloudflare.',
          mitigation: 'Permitir los rangos de Cloudflare y mantenerlos actualizados.',
        },
      ],
      docs: [
        { title: 'DigitalOcean Load Balancers', url: 'https://docs.digitalocean.com/products/networking/load-balancers/' },
        { title: 'Why does my load balancer respond with an HTTP 503?', url: 'https://docs.digitalocean.com/support/why-does-my-load-balancer-respond-with-an-http-503-error/' },
      ],
      glossary: ['L4', 'Health check'],
    },
  }),
  svc({
    id: 'do-doks-gateway',
    name: 'DOKS Gateway API (Cilium / Envoy)',
    provider: 'digitalocean',
    category: 'Gateway L7 (en el cluster)',
    layer: 'kubernetes',
    plane: 'data',
    role: 'Termina TLS y enruta HTTP por host/path hacia los Services',
    inspector: {
      summary: 'Implementación gestionada de Gateway API basada en Cilium, habilitada por defecto en clusters DOKS VPC-native recientes. Envoy dentro del cluster aplica los HTTPRoute.',
      advanced:
        'Sustituye al patrón clásico "Ingress + ingress-nginx": el proyecto ingress-nginx se retiró en marzo de 2026 y Kubernetes recomienda migrar a Gateway API (herramienta ingress2gateway). DOKS gestiona los CRDs de Gateway API: no instales otra versión, puede romper el operador de Cilium. Si un HTTPRoute apunta a un Service sin endpoints listos, Envoy responde 503 "no healthy upstream".',
      receives: ['TLS desde el NLB (originado en Cloudflare)'],
      processes: ['TLS termination (certificado Cloudflare Origin CA)', 'HTTPRoute: host/path → Service', 'Balanceo entre endpoints listos'],
      emits: ['HTTP al Pod'],
      protocols: ['HTTPS', 'HTTP/1.1', 'HTTP/2'],
      ports: ['443'],
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: { name: shop, namespace: shop }
spec:
  gatewayClassName: cilium
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: shop.example.com
      tls: { mode: Terminate, certificateRefs: [{ name: cloudflare-origin-cert }] }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: api, namespace: shop }
spec:
  parentRefs: [{ name: shop }]
  rules:
    - matches: [{ path: { type: PathPrefix, value: /api } }]
      backendRefs: [{ name: api, port: 80 }]`,
      },
      typicalLogs: ['Logs de acceso de Envoy (vía Hubble/Cilium): response_code, response_flags (UH = no healthy upstream)'],
      typicalMetrics: ['envoy_cluster_upstream_rq{response_code_class}', 'hubble_http_requests_total'],
      failureModes: [
        {
          name: '503 no healthy upstream',
          symptoms: 'Todas las requests 503; el Service no tiene endpoints listos.',
          diagnosis: 'kubectl get endpointslices -l kubernetes.io/service-name=api; revisar readiness y el selector.',
          mitigation: 'Corregir readiness/selector; PodDisruptionBudget y réplicas suficientes.',
        },
      ],
      docs: [
        { title: 'DOKS — Use Gateway API', url: 'https://docs.digitalocean.com/products/kubernetes/how-to/use-gateway-api/' },
        { title: 'Ingress NGINX retirement', url: 'https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/' },
      ],
      glossary: ['L7', 'Gateway API', 'EndpointSlice'],
    },
  }),
  svc({
    id: 'do-doks-control-plane',
    name: 'DigitalOcean Kubernetes (DOKS) — control plane',
    provider: 'digitalocean',
    category: 'Kubernetes administrado',
    layer: 'kubernetes',
    plane: 'control',
    role: 'Control plane gestionado por DigitalOcean',
    inspector: {
      summary: 'DigitalOcean opera el control plane; los nodos son Droplets en node pools dentro de la VPC. Cilium es el CNI.',
      advanced:
        'Control plane ≠ data plane. Existe una opción de control plane de alta disponibilidad. El acceso al cluster se hace con kubeconfig generado por doctl y tokens de API de DigitalOcean. La integración con DOCR añade automáticamente los imagePullSecrets para hacer pull del registry.',
      receives: ['Applies de Argo CD', 'Watches de kubelets y controllers'],
      processes: ['Admisión', 'etcd', 'Scheduling', 'Controllers (incluido el cloud controller manager que crea load balancers)'],
      emits: ['Eventos de Kubernetes'],
      protocols: ['HTTPS (Kubernetes API)'],
      ports: ['443'],
      identity: ['Tokens de API de DigitalOcean (con scopes) + RBAC de Kubernetes'],
      typicalMetrics: ['métricas de nodos en DigitalOcean Monitoring', 'kube-state-metrics (Prometheus)'],
      failureModes: [
        {
          name: 'Pod Pending',
          symptoms: 'FailedScheduling: Insufficient cpu.',
          diagnosis: 'kubectl describe pod; revisar tamaño del node pool y el autoscaler del pool.',
          mitigation: 'Habilitar autoscaling del node pool o ajustar requests.',
        },
      ],
      docs: [{ title: 'DigitalOcean Kubernetes', url: 'https://docs.digitalocean.com/products/kubernetes/' }],
      glossary: ['Control plane', 'kubelet', 'Node pool'],
    },
  }),
  svc({
    id: 'do-container-registry',
    name: 'DigitalOcean Container Registry (DOCR)',
    provider: 'digitalocean',
    category: 'Registry',
    layer: 'registry',
    plane: 'delivery',
    role: 'Registry privado de imágenes OCI',
    inspector: {
      summary: 'Registry privado (registry.digitalocean.com/<registry>). GitHub Actions hace push; DOKS hace pull con el secreto que añade la integración del registry.',
      advanced:
        'La autorización se basa en tokens de API de DigitalOcean (doctl registry login) y en credenciales Docker que DOKS inyecta como imagePullSecret, no en roles de identidad federada como en AWS/Azure/GCP. Rota los tokens y usa los scopes mínimos. Hay garbage collection para liberar espacio de capas sin referenciar.',
      receives: ['docker push desde CI', 'pull desde kubelet'],
      processes: ['Almacenar manifiestos y capas', 'Garbage collection'],
      emits: ['Manifiestos y capas'],
      protocols: ['HTTPS (OCI Distribution API)'],
      ports: ['443'],
      identity: ['Token de API (CI)', 'imagePullSecret gestionado por la integración DOKS–DOCR'],
      failureModes: [
        {
          name: 'manifest unknown / unauthorized',
          symptoms: 'ErrImagePull → ImagePullBackOff.',
          diagnosis: '"manifest unknown": tag inexistente. "unauthorized": falta el imagePullSecret en el namespace o el token expiró.',
          mitigation: 'Publicar antes de actualizar GitOps; revisar la integración del registry con el cluster.',
        },
      ],
      docs: [{ title: 'DigitalOcean Container Registry', url: 'https://docs.digitalocean.com/products/container-registry/' }],
      glossary: ['OCI', 'Digest'],
    },
  }),
  svc({
    id: 'do-managed-postgres',
    name: 'DigitalOcean Managed PostgreSQL',
    provider: 'digitalocean',
    category: 'Base de datos',
    layer: 'data',
    plane: 'data',
    role: 'PostgreSQL gestionado en la VPC',
    inspector: {
      summary: 'Cluster PostgreSQL gestionado con red privada en la VPC, trusted sources (sólo el cluster DOKS puede conectar) y nodos standby opcionales.',
      advanced:
        'Incluye connection pools (PgBouncer) configurables desde el panel/API, útiles con muchos Pods. Los standby nodes permiten failover automático. Trusted sources restringe qué recursos (cluster, Droplets, IPs) pueden conectar. Verifica en la documentación los puertos y límites de conexiones según el tamaño.',
      receives: ['Conexiones PostgreSQL desde los Pods'],
      processes: ['Queries', 'Replicación a standby'],
      emits: ['Result sets'],
      protocols: ['PostgreSQL wire protocol (TLS obligatorio)'],
      identity: ['Usuario/contraseña (guardar en un Secret de Kubernetes / gestor de secretos)'],
      trustBoundary: 'Red privada de la VPC + trusted sources.',
      typicalMetrics: ['conexiones', 'CPU', 'disco', 'replication lag'],
      failureModes: [
        {
          name: 'Pool agotado / query lenta',
          symptoms: 'Timeouts en orders (503).',
          diagnosis: 'Métricas del cluster y pg_stat_activity; trazas con el span db.query dominando.',
          mitigation: 'Usar el connection pool gestionado, índices y statement_timeout.',
        },
      ],
      docs: [{ title: 'Managed PostgreSQL', url: 'https://docs.digitalocean.com/products/databases/postgresql/' }],
      glossary: ['Connection pool', 'Failover'],
    },
  }),
  svc({
    id: 'do-managed-valkey',
    name: 'DigitalOcean Managed Valkey',
    provider: 'digitalocean',
    category: 'Cache',
    layer: 'data',
    plane: 'data',
    role: 'Cache en memoria (cache-aside) compatible con Redis',
    inspector: {
      summary: 'Cache gestionada Valkey en la VPC; catalog la usa como cache-aside delante de PostgreSQL.',
      advanced: 'Sustituye al antiguo producto Managed Caching (Redis), discontinuado en 2025. Valkey es un fork open source de Redis compatible con su protocolo. Conexión TLS (rediss://) restringida con trusted sources.',
      receives: ['Comandos GET/SET'],
      processes: ['Lookup en memoria'],
      emits: ['Valor o nil (miss)'],
      protocols: ['RESP sobre TLS'],
      docs: [{ title: 'Managed Valkey', url: 'https://docs.digitalocean.com/products/databases/valkey/' }],
      glossary: ['Cache-aside', 'Hit ratio'],
    },
  }),
  svc({
    id: 'do-managed-kafka',
    name: 'DigitalOcean Managed Kafka',
    provider: 'digitalocean',
    category: 'Mensajería',
    layer: 'messaging',
    plane: 'data',
    role: 'Log de eventos distribuido para trabajo asíncrono',
    inspector: {
      summary: 'orders publica un evento en un topic de Kafka sin esperar a los consumidores.',
      advanced:
        'DigitalOcean no ofrece una cola simple tipo SQS; Kafka es un log particionado: los consumidores leen a su ritmo con offsets, se conserva el historial según la retención y el orden se garantiza por partición. Es más potente y más complejo de operar que una cola. El contexto de traza viaja en los headers del mensaje.',
      receives: ['Produce (protocolo Kafka sobre TLS, SASL)'],
      processes: ['Append al log de la partición', 'Replicación entre brokers'],
      emits: ['Mensajes a consumer groups (no modelados en el MVP)'],
      protocols: ['Kafka protocol (TLS + SASL/SCRAM)'],
      typicalMetrics: ['mensajes in/out por topic', 'consumer lag'],
      docs: [{ title: 'Managed Kafka', url: 'https://docs.digitalocean.com/products/databases/kafka/' }],
      glossary: ['Asíncrono', 'At-least-once', 'Consumer lag'],
    },
  }),
  svc({
    id: 'do-spaces-tfstate',
    name: 'DigitalOcean Spaces (Terraform state)',
    provider: 'digitalocean',
    category: 'Almacenamiento',
    layer: 'iac',
    plane: 'control',
    role: 'Object storage S3-compatible usado con el backend s3',
    inspector: {
      summary: 'Bucket de Spaces usado como backend del state mediante el backend s3 de Terraform con endpoint personalizado.',
      advanced:
        'No existe un backend "digitalocean": se usa el backend s3 apuntando al endpoint de Spaces y desactivando validaciones propias de AWS. La guía de DigitalOcean incluye use_lockfile = true, pero ese locking se basa en escrituras condicionales de S3: comprueba que funciona en Spaces (p.ej. dos applies concurrentes) antes de confiar en él, o usa HCP Terraform / otro backend con locking garantizado.',
      receives: ['Lecturas/escrituras del state y del lock file'],
      processes: ['Almacenamiento de objetos'],
      emits: ['State'],
      protocols: ['HTTPS (API compatible con S3)'],
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO
terraform {
  backend "s3" {
    endpoints                   = { s3 = "https://fra1.digitaloceanspaces.com" }
    bucket                      = "example-tfstate"
    key                         = "shop/prod/terraform.tfstate"
    region                      = "us-east-1"   # requerido por el backend, ignorado por Spaces
    use_lockfile                = true          # verificar soporte real en Spaces
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_s3_checksum            = true
  }
}`,
      },
      docs: [{ title: 'Spaces as a Terraform backend', url: 'https://docs.digitalocean.com/products/spaces/reference/terraform-backend/' }],
      glossary: ['State', 'Lock'],
    },
  }),
];
