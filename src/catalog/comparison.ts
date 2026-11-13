/**
 * Contenido del modo comparación. Se compara la INTENCIÓN (qué función
 * cumple cada pieza), con notas por proveedor que explican diferencias
 * reales. No hay puntuación de "mejor cloud": cada fila describe trade-offs.
 *
 * Para añadir un proveedor, añade su entrada en `notes` de cada aspecto.
 */
import type { Intent, ProviderId } from '../model/schemas';

export interface ComparisonAspect {
  id: string;
  title: string;
  /** Intención de nodo asociada (para mostrar el servicio del escenario). */
  intent?: Intent;
  /** Qué hay que mirar al comparar este aspecto. */
  question: string;
  notes: Partial<Record<ProviderId, string>>;
}

export const comparisonAspects: ComparisonAspect[] = [
  {
    id: 'dns',
    title: 'DNS autoritativo',
    intent: 'dns-authoritative',
    question: '¿Cómo apunta el nombre al edge?',
    notes: {
      aws: 'Alias record A/AAAA de Route 53 hacia la distribución de CloudFront (funciona también en el apex).',
      azure: 'CNAME al endpoint *.azurefd.net de Front Door; en el apex, alias record de Azure DNS al perfil. El dominio personalizado se valida con un TXT _dnsauth.',
      gcp: 'Registro A de Cloud DNS a la IP anycast global del load balancer: no hace falta CNAME ni alias a un hostname del edge.',
      digitalocean: 'Cloudflare DNS con el registro proxied: devuelve IPs anycast de Cloudflare y oculta la IP del origen. DigitalOcean DNS es la alternativa, pero sin proxy ni WAF.',
    },
  },
  {
    id: 'edge',
    title: 'Edge / CDN',
    intent: 'edge-cdn',
    question: '¿Dónde termina TLS y cómo se protege el origen?',
    notes: {
      aws: 'CloudFront termina TLS (certificado ACM en us-east-1). Proteger el origen: prefix list gestionada de CloudFront en el security group del ALB y/o header secreto.',
      azure: 'Front Door termina TLS. Proteger el origen: service tag AzureFrontDoor.Backend + validar el header X-Azure-FDID (el service tag solo no basta: lo comparten otros clientes).',
      gcp: 'El edge ES el load balancer: el Application Load Balancer externo global termina TLS en los GFE; Cloud CDN se activa por backend service. Proteger los Pods: firewall sólo para rangos del GFE / health checks.',
      digitalocean: 'DigitalOcean no tiene CDN/WAF delante del load balancer: el edge es Cloudflare (externo). SSL Full (strict) hacia el origen; proteger el origen con rangos IP de Cloudflare, Authenticated Origin Pulls o Cloudflare Tunnel.',
    },
  },
  {
    id: 'waf',
    title: 'WAF',
    intent: 'waf',
    question: '¿Qué tier hace falta y cómo responde un bloqueo?',
    notes: {
      aws: 'AWS WAF web ACL asociada a CloudFront; managed rule groups disponibles. Bloqueo → 403 por defecto (respuesta personalizable).',
      azure: 'Política WAF de Front Door. Los managed rule sets (DRS, bots) requieren Front Door Premium; Standard sólo custom rules. Bloqueo → 403 "The request is blocked." por defecto.',
      gcp: 'Cloud Armor (security policy en el backend service). Reglas WAF preconfiguradas en CEL; deny admite 403, 404 o 502 (la documentación recomienda 403).',
      digitalocean: 'Cloudflare WAF (managed rulesets según plan, custom rules, rate limiting). Bloqueo → 403 con página de Cloudflare y Ray ID.',
    },
  },
  {
    id: 'lb',
    title: 'Load balancer → Pods',
    intent: 'load-balancer',
    question: '¿Es L4 o L7, cómo llega el tráfico al Pod y qué error da sin destinos sanos?',
    notes: {
      aws: 'ALB provisionado por el AWS Load Balancer Controller; con target-type ip registra IPs de Pod (VPC CNI). Sin targets sanos → 503 generado por el ALB.',
      azure: 'Application Gateway v2 configurado por AGIC (o Application Gateway for Containers); requiere subnet dedicado. Sin miembros sanos en el backend pool → 502.',
      gcp: 'Backend service con NEGs zonales (container-native): IPs de Pod directamente, configurado con Gateway API. Sin endpoints sanos → 502 failed_to_pick_backend (statusDetails en los logs).',
      digitalocean: 'Network Load Balancer L4 creado por DOKS al definir un Gateway: reparte conexiones TCP a los nodos; no ve HTTP. El L7 (host/path) lo hace Envoy dentro del cluster. Sin endpoints → 503 de Envoy; si falla el propio LB, Cloudflare da 52x.',
    },
  },
  {
    id: 'gateway',
    title: 'Gateway L7 dentro del cluster',
    intent: 'ingress-gateway',
    question: '¿Hay un salto extra de enrutado HTTP dentro de Kubernetes?',
    notes: {
      aws: 'No en este diseño: el ALB (L7) enruta por host/path y envía directo a la IP del Pod.',
      azure: 'No en este diseño: Application Gateway (L7, configurado por AGIC) envía directo a la IP del Pod.',
      gcp: 'No en este diseño: el URL map del load balancer global hace el L7 y el NEG apunta a los Pods.',
      digitalocean: 'Sí: el NLB es L4, así que Envoy (Gateway API gestionado por Cilium) termina TLS y aplica los HTTPRoute. ingress-nginx, el patrón clásico, se retiró en marzo de 2026.',
    },
  },
  {
    id: 'network',
    title: 'Red privada',
    question: '¿Cómo se segmenta la red?',
    notes: {
      aws: 'VPC regional; cada subnet pertenece a UNA zona de disponibilidad (multi-AZ = una subnet por AZ). Security groups (stateful, por ENI) y NACLs (stateless, por subnet).',
      azure: 'VNet regional; las subnets abarcan todas las zonas de la región. NSGs (stateful) por subnet o NIC; algunos servicios exigen subnet dedicado o delegado (Application Gateway, PostgreSQL Flexible).',
      gcp: 'VPC GLOBAL: una sola red para todas las regiones; las subnets son regionales y abarcan todas las zonas de su región. Reglas de firewall a nivel de VPC (con tags o service accounts como objetivo).',
      digitalocean: 'VPC regional con un único rango privado (sin subnets públicas/privadas como en AWS). Cloud Firewalls se aplican a Droplets por tag; las Managed Databases se restringen con trusted sources.',
    },
  },
  {
    id: 'identity',
    title: 'Identidad de workloads',
    question: '¿Cómo obtiene un Pod o el CI credenciales sin secretos estáticos?',
    notes: {
      aws: 'IAM roles: EKS Pod Identity o IRSA para Pods; OIDC del CI → sts:AssumeRoleWithWebIdentity. Los nodos usan su instance role para hacer pull de ECR.',
      azure: 'Microsoft Entra ID: Workload ID (federación del ServiceAccount) para Pods; service connection con workload identity federation para Azure Pipelines; la kubelet identity necesita AcrPull.',
      gcp: 'IAM con service accounts: Workload Identity Federation for GKE para Pods; Cloud Build usa su service account; los nodos hacen pull con el service account del nodo.',
      digitalocean: 'Tokens de API de DigitalOcean (con scopes) en lugar de identidad federada: el CI guarda el token como secret; DOKS inyecta imagePullSecrets para DOCR. Más simple, pero hay que rotar secretos.',
    },
  },
  {
    id: 'k8s',
    title: 'Kubernetes administrado',
    intent: 'k8s-control-plane',
    question: '¿Qué gestiona el proveedor y qué gestionas tú?',
    notes: {
      aws: 'EKS gestiona el control plane; nodos como managed node groups, Karpenter o Fargate. Acceso con access entries que mapean IAM → Kubernetes.',
      azure: 'AKS gestiona el control plane (tier Free sin SLA financiado, Standard con SLA); node pools de sistema y de usuario sobre VM Scale Sets. Acceso con Entra ID + Kubernetes RBAC o Azure RBAC.',
      gcp: 'GKE Standard (gestionas node pools) o Autopilot (Google gestiona los nodos); cluster regional con control plane replicado. VPC-native por defecto (alias IP).',
      digitalocean: 'DOKS: control plane gestionado (opción HA), node pools de Droplets, Cilium como CNI y Gateway API gestionado por defecto en clusters VPC-native recientes.',
    },
  },
  {
    id: 'registry',
    title: 'Registry de imágenes',
    intent: 'registry',
    question: '¿Cómo se autoriza push y pull?',
    notes: {
      aws: 'ECR con políticas IAM (ecr:PutImage para CI, lectura para el rol de los nodos). Nodos privados: VPC endpoints ecr.api, ecr.dkr y gateway endpoint de S3.',
      azure: 'ACR con Azure RBAC (AcrPush / AcrPull). Private endpoint y desactivar acceso público requieren SKU Premium.',
      gcp: 'Artifact Registry regional con IAM (artifactregistry.writer / reader). Container Registry (gcr.io) se apagó en 2025.',
      digitalocean: 'DOCR con autenticación por token de API (doctl registry login) e integración con DOKS que crea los imagePullSecrets.',
    },
  },
  {
    id: 'database',
    title: 'Base de datos',
    intent: 'database',
    question: '¿Cómo se accede en privado y qué pasa en un failover?',
    notes: {
      aws: 'RDS for PostgreSQL Multi-AZ en subnets privadas; failover cambia el endpoint DNS. RDS Proxy para pooling.',
      azure: 'PostgreSQL Flexible Server con VNet integration (subnet delegado) y HA zone-redundant; PgBouncer integrado opcional.',
      gcp: 'Cloud SQL for PostgreSQL con IP privada (Private Service Access = peering con la VPC del productor) y HA regional; en failover la IP se mantiene.',
      digitalocean: 'Managed PostgreSQL en la VPC con trusted sources, connection pools PgBouncer gestionados y nodos standby opcionales.',
    },
  },
  {
    id: 'cache',
    title: 'Cache',
    intent: 'cache',
    question: '¿Cómo se conecta el cliente?',
    notes: {
      aws: 'ElastiCache (Valkey / Redis OSS) dentro de la VPC (puerto 6379).',
      azure: 'Azure Managed Redis (sucesor de Azure Cache for Redis), clustered por defecto, sin VNet injection: acceso por private endpoint (puerto 10000).',
      gcp: 'Memorystore (Redis o Valkey) por IP privada (Private Service Access / Private Service Connect según el producto), puerto 6379.',
      digitalocean: 'Managed Valkey (sustituye a Managed Caching/Redis, discontinuado en 2025) en la red privada, TLS.',
    },
  },
  {
    id: 'queue',
    title: 'Mensajería',
    intent: 'queue',
    question: '¿Qué garantías ofrece la cola?',
    notes: {
      aws: 'SQS: cola gestionada simple (standard at-least-once o FIFO), DLQ por redrive policy; API HTTPS.',
      azure: 'Service Bus: broker con colas y topics, sesiones, transacciones y DLQ integrada; AMQP 1.0. Private endpoint requiere tier Premium.',
      gcp: 'Pub/Sub: servicio global de topics y subscriptions, at-least-once (exactly-once opcional en pull), dead-letter topics; se alcanza vía Private Google Access.',
      digitalocean: 'No hay cola simple gestionada: Managed Kafka (log particionado con consumer groups y retención). Más potente y más complejo que una cola.',
    },
  },
  {
    id: 'ci',
    title: 'CI y publicación',
    intent: 'ci',
    question: '¿Dónde corre el pipeline y cómo se autentica?',
    notes: {
      aws: 'Escenario con GitLab CI/CD (SaaS externo): id_token OIDC federado con un rol IAM.',
      azure: 'Escenario con Azure DevOps (Repos + Pipelines): service connection con workload identity federation.',
      gcp: 'Escenario con GitHub + Cloud Build (trigger por la GitHub App); Cloud Source Repositories ya no admite clientes nuevos.',
      digitalocean: 'Escenario con GitHub Actions (DigitalOcean no tiene CI propio): action doctl con un token guardado en GitHub Secrets.',
    },
  },
  {
    id: 'iac-state',
    title: 'State de Terraform',
    intent: 'iac-state',
    question: '¿Cómo se bloquea el state?',
    notes: {
      aws: 'Backend s3 con use_lockfile (Terraform ≥ 1.10); el locking con DynamoDB queda obsoleto.',
      azure: 'Backend azurerm: locking nativo de Blob Storage (lease sobre el blob); sin recurso adicional.',
      gcp: 'Backend gcs: el lock es un objeto .tflock creado de forma condicional junto al state; se recomienda Object Versioning.',
      digitalocean: 'No hay backend propio: backend s3 apuntando a Spaces. La guía de DO usa use_lockfile, pero su soporte de escrituras condicionales debe verificarse; alternativa: HCP Terraform.',
    },
  },
  {
    id: 'observability',
    title: 'Métricas y logs',
    question: '¿Dónde miras primero un 5xx?',
    notes: {
      aws: 'CloudWatch: HTTPCode_ELB_5XX_Count (lo genera el ALB) vs HTTPCode_Target_5XX_Count (la app); access logs del ALB con elb_status_code y target_status_code.',
      azure: 'Azure Monitor: UnhealthyHostCount y BackendResponseStatus de Application Gateway; ApplicationGatewayAccessLog con httpStatus y serverStatus en Log Analytics (KQL).',
      gcp: 'Cloud Monitoring (https/request_count, backend_latencies) y logs del load balancer con statusDetails: failed_to_pick_backend vs response_sent_by_backend.',
      digitalocean: 'DigitalOcean Monitoring para nodos y load balancers; métricas de aplicación con kube-prometheus-stack; Cilium Hubble para flujos y drops; Cloudflare Security Events y Ray ID en el edge.',
    },
  },
];
