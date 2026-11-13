/**
 * Catálogo AWS. Contenido educativo: nombres y capacidades a verificar contra
 * la documentación oficial vigente (ver enlaces). Configs ILUSTRATIVAS.
 */
import type { CatalogService } from '../../../model/schemas';
import { svc } from '../../generic';

export const awsServices: CatalogService[] = [
  svc({
    id: 'aws-route53',
    name: 'Amazon Route 53 (hosted zone pública)',
    provider: 'aws',
    category: 'DNS',
    layer: 'dns',
    plane: 'data',
    role: 'DNS autoritativo de la zona example.com',
    inspector: {
      summary: 'Servidor DNS autoritativo: responde con los registros de la zona. Un alias A/AAAA apunta a la distribución de CloudFront.',
      advanced:
        'Route 53 responde a los resolvers recursivos, no a los navegadores directamente. Los registros Alias hacia recursos AWS (CloudFront, ALB) se resuelven a las IPs actuales del recurso. Route 53 también ofrece Resolver (DNS dentro de la VPC), que es un servicio distinto.',
      receives: ['Queries del resolver recursivo'],
      processes: ['Lookup en la hosted zone', 'Políticas de routing (simple, weighted, latency, failover…)'],
      emits: ['Respuesta autoritativa (flag AA) con TTL'],
      protocols: ['DNS UDP/TCP'],
      ports: ['53'],
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO
resource "aws_route53_record" "shop" {
  zone_id = aws_route53_zone.example.zone_id
  name    = "shop.example.com"
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.shop.domain_name
    zone_id                = aws_cloudfront_distribution.shop.hosted_zone_id
    evaluate_target_health = false
  }
}`,
      },
      typicalLogs: ['Query logging: timestamp, hosted zone, qname, qtype, rcode, edge location'],
      typicalMetrics: ['DNSQueries', 'HealthCheckStatus'],
      failureModes: [
        {
          name: 'Registro incorrecto / inexistente',
          symptoms: 'NXDOMAIN o IP equivocada; el tráfico nunca llega al edge.',
          diagnosis: 'dig @<ns-route53> shop.example.com; comprobar NS delegados en el registrador.',
          mitigation: 'Corregir el registro; esperar a que expire el TTL en los resolvers.',
        },
      ],
      docs: [{ title: 'Route 53 Developer Guide', url: 'https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html' }],
      glossary: ['Hosted zone', 'Alias record', 'TTL'],
    },
  }),
  svc({
    id: 'aws-cloudfront',
    name: 'Amazon CloudFront',
    provider: 'aws',
    category: 'CDN / Edge',
    layer: 'edge',
    plane: 'data',
    role: 'Edge: terminación TLS, cache y reenvío al origen',
    inspector: {
      summary: 'CDN global. Termina TLS cerca del usuario, sirve contenido cacheable y reenvía el resto al origen (el ALB).',
      advanced:
        'Cada cache behavior (por path pattern) define TTLs, política de cache y de origin request. Las rutas /api/* suelen usar una política sin cache. CloudFront abre una conexión TLS nueva hacia el origen (re-encryption). AWS Shield Standard protege automáticamente frente a DDoS de capa 3/4. El origin response timeout por defecto es de 30 s.',
      receives: ['HTTPS del cliente (HTTP/2, HTTP/3 opcional)'],
      processes: ['TLS termination (certificado ACM en us-east-1)', 'Evaluación WAF', 'Cache lookup', 'Origin request'],
      emits: ['Request al origen', 'Respuesta al cliente con headers x-cache / x-amz-cf-pop'],
      protocols: ['HTTPS', 'HTTP/2', 'HTTP/3 (QUIC) opcional', 'TLS 1.2/1.3'],
      ports: ['443'],
      trustBoundary: 'Límite público: Internet → red de AWS. El origen debería aceptar sólo tráfico de CloudFront (prefix list gestionada o header secreto).',
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO
ordered_cache_behavior {
  path_pattern           = "/api/*"
  target_origin_id       = "alb-shop"
  viewer_protocol_policy = "https-only"
  cache_policy_id        = data.aws_cloudfront_cache_policy.disabled.id
}`,
      },
      typicalLogs: ['Standard/real-time logs: x-edge-result-type (Hit/Miss/Error), sc-status, time-taken'],
      typicalMetrics: ['Requests', 'CacheHitRate', '4xxErrorRate', '5xxErrorRate', 'OriginLatency'],
      failureModes: [
        {
          name: '502/504 desde CloudFront',
          symptoms: 'x-cache: Error from cloudfront.',
          diagnosis: '502: fallo TLS/conexión con el origen; 504: el origen no respondió a tiempo.',
          mitigation: 'Revisar certificado/SNI del origen, security groups y timeouts.',
        },
      ],
      docs: [{ title: 'CloudFront Developer Guide', url: 'https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html' }],
      glossary: ['PoP', 'Cache behavior', 'Origin'],
    },
  }),
  svc({
    id: 'aws-waf',
    name: 'AWS WAF (web ACL)',
    provider: 'aws',
    category: 'Seguridad',
    layer: 'security',
    plane: 'data',
    role: 'Filtra requests HTTP maliciosas en el edge',
    inspector: {
      summary: 'Web ACL asociada a la distribución de CloudFront. Evalúa reglas (managed rule groups, rate-based, IP sets) antes de llegar al origen.',
      advanced:
        'Simplificación: en la realidad la evaluación WAF ocurre dentro de CloudFront, no en un salto de red separado. Un bloqueo devuelve 403 desde el edge: la request NUNCA llega al ALB ni a la aplicación, así que no habrá logs en el backend. Distinguirlo de un 403 de la aplicación mirando los logs de WAF (action=BLOCK, terminatingRuleId).',
      receives: ['Request HTTP inspeccionada (headers, URI, query, body hasta el límite configurado)'],
      processes: ['Evaluación de reglas por prioridad'],
      emits: ['ALLOW / BLOCK / COUNT / CAPTCHA'],
      protocols: ['HTTP (inspección L7)'],
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO
rule {
  name     = "AWSManagedRulesCommonRuleSet"
  priority = 10
  override_action { none {} }
  statement {
    managed_rule_group_statement {
      vendor_name = "AWS"
      name        = "AWSManagedRulesCommonRuleSet"
    }
  }
}`,
      },
      typicalLogs: ['{"action":"BLOCK","terminatingRuleId":"AWS-AWSManagedRulesCommonRuleSet","httpRequest":{…}}'],
      typicalMetrics: ['AllowedRequests', 'BlockedRequests', 'CountedRequests'],
      failureModes: [
        {
          name: 'Falso positivo',
          symptoms: 'Usuarios legítimos reciben 403; el backend no registra nada.',
          diagnosis: 'Buscar el trace/request id en los logs de WAF; identificar la regla terminante.',
          mitigation: 'Poner la regla en COUNT, añadir scope-down o excepción específica; nunca desactivar todo el WAF.',
        },
      ],
      docs: [{ title: 'AWS WAF Developer Guide', url: 'https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html' }],
      glossary: ['Web ACL', 'Managed rule group', 'Rate-based rule'],
    },
  }),
  svc({
    id: 'aws-alb',
    name: 'Application Load Balancer',
    provider: 'aws',
    category: 'Load balancing (L7)',
    layer: 'load-balancing',
    plane: 'data',
    role: 'Balanceo HTTP con reglas host/path hacia target groups',
    inspector: {
      summary: 'Balanceador L7 en subnets públicas de varias AZ. Un listener HTTPS:443 evalúa reglas y envía la request a un target group.',
      advanced:
        'Provisionado por el AWS Load Balancer Controller a partir de un Ingress (o Gateway API). Con `target-type: ip` registra directamente las IPs de los Pods (VPC CNI) y hace health checks a cada Pod. Errores generados por el propio ALB: 502 (respuesta inválida/conexión cerrada por el target), 503 (sin targets sanos en el target group), 504 (el target no respondió dentro del idle timeout). En access logs: elb_status_code vs target_status_code.',
      receives: ['HTTPS desde CloudFront'],
      processes: ['TLS termination', 'Evaluación de reglas del listener', 'Selección de target (round robin / LOR)', 'Health checks'],
      emits: ['HTTP hacia el Pod seleccionado'],
      protocols: ['HTTPS', 'HTTP/1.1', 'HTTP/2', 'gRPC'],
      ports: ['443 (listener)', '8080 (targets)'],
      trustBoundary: 'Subnets públicas. El security group del ALB sólo debería admitir la prefix list de CloudFront.',
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO — Ingress gestionado por AWS Load Balancer Controller
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/healthcheck-path: /readyz
spec:
  ingressClassName: alb
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend: { service: { name: api, port: { number: 80 } } }`,
      },
      typicalLogs: ['access log: type, elb_status_code, target_status_code, request_processing_time, target_processing_time'],
      typicalMetrics: ['RequestCount', 'HTTPCode_ELB_5XX_Count', 'HTTPCode_Target_5XX_Count', 'TargetResponseTime', 'HealthyHostCount'],
      failureModes: [
        {
          name: '503 — sin targets sanos',
          symptoms: 'HTTPCode_ELB_5XX sube; HealthyHostCount = 0; target_status_code vacío en logs.',
          diagnosis: 'Revisar health checks del target group, readiness de los Pods y security groups nodo/pod.',
          mitigation: 'Corregir el health check path/puerto o la app; asegurar minReplicas y PodDisruptionBudget.',
        },
        {
          name: '504 — timeout del target',
          symptoms: 'request tarda ≈ idle timeout y termina en 504.',
          diagnosis: 'target_processing_time = -1; investigar latencia del servicio y sus dependencias.',
          mitigation: 'Timeouts coherentes en toda la cadena (cliente > edge > ALB > app > DB).',
        },
      ],
      docs: [
        { title: 'Application Load Balancers', url: 'https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html' },
        { title: 'AWS Load Balancer Controller', url: 'https://kubernetes-sigs.github.io/aws-load-balancer-controller/' },
      ],
      glossary: ['Listener', 'Target group', 'L7', 'Health check'],
    },
  }),
  svc({
    id: 'aws-eks-control-plane',
    name: 'Amazon EKS — control plane',
    provider: 'aws',
    category: 'Kubernetes administrado',
    layer: 'kubernetes',
    plane: 'control',
    role: 'kube-apiserver, etcd, scheduler y controllers gestionados por AWS',
    inspector: {
      summary: 'El control plane de Kubernetes lo opera AWS en una VPC gestionada. Los nodos (data plane) están en tus subnets privadas.',
      advanced:
        'Control plane ≠ data plane: si el API server no está disponible, los Pods ya en marcha siguen sirviendo tráfico, pero no se pueden programar cambios. El scheduler asigna Pods a nodos; el kubelet de cada nodo observa (watch) el API server y arranca los contenedores. En el mapa, el edge API server → workload representa ese watch iniciado por el kubelet.',
      receives: ['Applies de Argo CD', 'Watches de kubelets y controllers'],
      processes: ['Admisión/validación', 'Persistencia en etcd', 'Scheduling', 'Controllers (Deployment, ReplicaSet, EndpointSlice)'],
      emits: ['Eventos de Kubernetes', 'Pods asignados a nodos'],
      protocols: ['HTTPS (Kubernetes API)'],
      ports: ['443'],
      identity: ['Access entries / aws-auth mapean roles IAM a identidades Kubernetes'],
      trustBoundary: 'VPC gestionada por AWS; endpoint público y/o privado.',
      typicalLogs: ['Control plane logs: api, audit, authenticator, controllerManager, scheduler'],
      typicalMetrics: ['apiserver_request_total', 'apiserver_request_duration_seconds', 'scheduler_pending_pods'],
      failureModes: [
        {
          name: 'Pod Pending',
          symptoms: 'Pod sin nodo asignado; evento FailedScheduling.',
          diagnosis: 'kubectl describe pod: recursos insuficientes, taints, affinity o límites de IPs del VPC CNI.',
          mitigation: 'Escalar nodos (Karpenter/Cluster Autoscaler), ajustar requests o affinity.',
        },
      ],
      docs: [{ title: 'What is Amazon EKS?', url: 'https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html' }],
      glossary: ['Control plane', 'kubelet', 'etcd', 'Scheduler'],
    },
  }),
  svc({
    id: 'aws-ecr',
    name: 'Amazon ECR',
    provider: 'aws',
    category: 'Registry',
    layer: 'registry',
    plane: 'delivery',
    role: 'Registry privado de imágenes OCI',
    inspector: {
      summary: 'Almacena las imágenes de contenedor. CI publica (push); los nodos de EKS descargan (pull).',
      advanced:
        'Los nodos en subnets privadas llegan a ECR por NAT Gateway o, mejor, por VPC endpoints (ecr.api, ecr.dkr y el gateway endpoint de S3, donde residen las capas). Tags inmutables + despliegue por digest evitan que un tag cambie bajo tus pies. Puede escanear imágenes (basic o enhanced con Inspector).',
      receives: ['docker push desde CI', 'pull desde kubelet'],
      processes: ['Almacenar manifiestos y capas', 'Scan on push (opcional)'],
      emits: ['Manifiestos y capas'],
      protocols: ['HTTPS (OCI Distribution API)'],
      ports: ['443'],
      identity: ['CI: rol con ecr:PutImage', 'Nodos: rol con AmazonEC2ContainerRegistryReadOnly (o equivalente)'],
      typicalLogs: ['CloudTrail: PutImage, BatchGetImage'],
      failureModes: [
        {
          name: 'manifest unknown',
          symptoms: 'ErrImagePull / ImagePullBackOff en los Pods nuevos.',
          diagnosis: 'El tag referenciado en GitOps no existe en el repositorio.',
          mitigation: 'Publicar antes de actualizar GitOps (el orden del pipeline importa) o desplegar por digest.',
        },
      ],
      docs: [{ title: 'Amazon ECR User Guide', url: 'https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html' }],
      glossary: ['OCI', 'Digest', 'VPC endpoint'],
    },
  }),
  svc({
    id: 'aws-rds-postgres',
    name: 'Amazon RDS for PostgreSQL (Multi-AZ)',
    provider: 'aws',
    category: 'Base de datos',
    layer: 'data',
    plane: 'data',
    role: 'Base de datos relacional privada',
    inspector: {
      summary: 'PostgreSQL gestionado en subnets privadas. Instancia primaria con standby en otra AZ.',
      advanced:
        'Los servicios usan un pool de conexiones (en la app o con RDS Proxy). Si el pool se agota, las requests esperan y terminan en timeout aunque la base de datos esté "viva". En un failover Multi-AZ el endpoint DNS cambia a la standby (típicamente 1–2 minutos según la documentación); los clientes deben reconectar.',
      receives: ['Conexiones PostgreSQL desde los Pods'],
      processes: ['Queries', 'Transacciones', 'Replicación síncrona a la standby'],
      emits: ['Result sets'],
      protocols: ['PostgreSQL wire protocol (TLS)'],
      ports: ['5432'],
      identity: ['Usuario/contraseña en Secrets Manager o autenticación IAM'],
      trustBoundary: 'Subnet de datos privada; security group sólo admite el SG de los nodos/pods.',
      typicalLogs: ['postgresql.log: duration, slow queries (log_min_duration_statement)'],
      typicalMetrics: ['DatabaseConnections', 'CPUUtilization', 'ReadLatency', 'WriteLatency'],
      failureModes: [
        {
          name: 'Pool agotado / query lenta',
          symptoms: 'Timeouts en el servicio, 503; DatabaseConnections al máximo.',
          diagnosis: 'Trazas: el span db.query domina la duración; Performance Insights muestra la query.',
          mitigation: 'Índices, límites de pool coherentes con max_connections, RDS Proxy, timeouts por statement.',
        },
      ],
      docs: [{ title: 'Amazon RDS User Guide', url: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html' }],
      glossary: ['Connection pool', 'Multi-AZ', 'Failover'],
    },
  }),
  svc({
    id: 'aws-elasticache-redis',
    name: 'Amazon ElastiCache (Valkey/Redis OSS)',
    provider: 'aws',
    category: 'Cache',
    layer: 'data',
    plane: 'data',
    role: 'Cache en memoria (cache-aside)',
    inspector: {
      summary: 'Cache en memoria delante de la base de datos. El servicio catalog consulta la cache; en un miss lee de RDS y rellena la cache.',
      advanced: 'Patrón cache-aside: la app es responsable de leer/escribir la cache. Un hit ratio que cae (p.ej. tras un flush o un deploy que cambia el formato de clave) traslada carga a la base de datos.',
      receives: ['Comandos GET/SET'],
      processes: ['Lookup en memoria'],
      emits: ['Valor o nil (miss)'],
      protocols: ['RESP sobre TCP (TLS opcional)'],
      ports: ['6379'],
      typicalMetrics: ['CacheHits', 'CacheMisses', 'CurrConnections', 'EngineCPUUtilization'],
      failureModes: [
        {
          name: 'Caída del hit ratio',
          symptoms: 'Latencia p95 sube, más db.query por request.',
          diagnosis: 'Comparar CacheHits/CacheMisses con los deploys recientes.',
          mitigation: 'Precalentar la cache, TTLs escalonados, protección contra stampede.',
        },
      ],
      docs: [{ title: 'ElastiCache documentation', url: 'https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html' }],
      glossary: ['Cache-aside', 'Hit ratio', 'Stampede'],
    },
  }),
  svc({
    id: 'aws-sqs',
    name: 'Amazon SQS',
    provider: 'aws',
    category: 'Mensajería',
    layer: 'messaging',
    plane: 'data',
    role: 'Cola para trabajo asíncrono',
    inspector: {
      summary: 'El servicio orders publica un evento en una cola sin esperar a que se procese: la respuesta al usuario no depende del consumidor.',
      advanced: 'Llamada asíncrona: aparece en la traza como un span hijo cuya duración no suma a la request. El contexto de traza se propaga en los atributos del mensaje. Se accede vía VPC interface endpoint para no salir por NAT.',
      receives: ['SendMessage'],
      processes: ['Persistir el mensaje'],
      emits: ['Mensajes a consumidores (no modelados en el MVP)'],
      protocols: ['HTTPS (AWS API)'],
      ports: ['443'],
      typicalMetrics: ['ApproximateNumberOfMessagesVisible', 'ApproximateAgeOfOldestMessage'],
      docs: [{ title: 'Amazon SQS Developer Guide', url: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html' }],
      glossary: ['Asíncrono', 'At-least-once', 'DLQ'],
    },
  }),
  svc({
    id: 'aws-s3-tfstate',
    name: 'Amazon S3 (Terraform state)',
    provider: 'aws',
    category: 'Almacenamiento',
    layer: 'iac',
    plane: 'control',
    role: 'Backend remoto del state de Terraform con locking',
    inspector: {
      summary: 'Bucket versionado y cifrado donde Terraform guarda el state. El lock evita dos applies simultáneos.',
      advanced:
        'Desde Terraform 1.10 el backend S3 soporta locking nativo mediante un lock file (`use_lockfile = true`); el locking basado en DynamoDB quedó marcado como obsoleto. Verifica la versión que usas. El state contiene datos sensibles: cifrado, acceso mínimo y versionado obligatorios.',
      receives: ['Lecturas/escrituras del state y del lock file'],
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO
terraform {
  backend "s3" {
    bucket       = "example-tfstate"
    key          = "shop/prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true   # locking nativo en S3 (Terraform >= 1.10)
  }
}`,
      },
      processes: ['Almacenamiento versionado'],
      emits: ['State'],
      protocols: ['HTTPS (S3 API)'],
      docs: [{ title: 'Terraform S3 backend', url: 'https://developer.hashicorp.com/terraform/language/backend/s3' }],
      glossary: ['State', 'Lock'],
    },
  }),
];
