/**
 * Componentes agnósticos de proveedor (cliente, DNS recursivo, toolchain de
 * delivery y workloads de Kubernetes). Se reutilizan en todos los perfiles.
 */
import type { CatalogService } from '../model/schemas';

type Input = Omit<CatalogService, 'inspector'> & { inspector: Partial<CatalogService['inspector']> & Pick<CatalogService['inspector'], 'summary' | 'advanced'> };

export function svc(s: Input): CatalogService {
  return {
    ...s,
    inspector: {
      receives: [],
      processes: [],
      emits: [],
      protocols: [],
      ports: [],
      identity: [],
      typicalLogs: [],
      typicalMetrics: [],
      failureModes: [],
      docs: [],
      glossary: [],
      ...s.inspector,
    },
  };
}

export const genericServices: CatalogService[] = [
  svc({
    id: 'browser-client',
    name: 'Cliente (navegador / app)',
    provider: 'generic',
    category: 'Cliente',
    layer: 'client',
    plane: 'data',
    role: 'Origen de las requests norte-sur',
    inspector: {
      summary: 'El usuario abre la aplicación. El cliente resuelve el nombre, abre una conexión TLS y envía la petición HTTP.',
      advanced:
        'El navegador consulta su cache DNS y la del sistema operativo antes de preguntar al resolver recursivo. Después abre TCP+TLS 1.3 (o QUIC para HTTP/3 si el edge lo anuncia vía Alt-Svc/HTTPS RR) y negocia HTTP/2 por ALPN. Inyecta un header W3C `traceparent` si hay instrumentación RUM.',
      receives: ['Respuesta HTTP (status, headers, body)'],
      processes: ['Resolución DNS', 'Handshake TCP/TLS', 'Envío de la request'],
      emits: ['DNS query', 'ClientHello (SNI)', 'GET /api/cart/summary'],
      protocols: ['DNS', 'TCP', 'TLS 1.3', 'HTTP/2'],
      ports: ['53/udp (al resolver)', '443/tcp'],
      typicalLogs: ['RUM: navigation timing, TTFB, errores JS'],
      typicalMetrics: ['TTFB', 'LCP', 'tasa de errores de cliente'],
      failureModes: [
        {
          name: 'NXDOMAIN / SERVFAIL',
          symptoms: 'El navegador muestra "DNS_PROBE_FINISHED_NXDOMAIN"; no llega ninguna request al edge.',
          diagnosis: 'dig +trace shop.example.com; comprobar delegación NS y el registro en la zona autoritativa.',
          mitigation: 'Corregir el registro; recordar que los resolvers mantienen la respuesta (positiva o negativa) durante el TTL.',
        },
      ],
      docs: [{ title: 'MDN — An overview of HTTP', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview' }],
      glossary: ['SNI', 'ALPN', 'TTFB'],
    },
  }),
  svc({
    id: 'recursive-resolver',
    name: 'Resolver DNS recursivo',
    provider: 'generic',
    category: 'DNS',
    layer: 'dns',
    plane: 'data',
    role: 'Resuelve nombres en nombre del cliente y cachea respuestas según TTL',
    inspector: {
      summary: 'Servidor DNS del ISP, de la empresa o público que resuelve el nombre preguntando a los servidores autoritativos.',
      advanced:
        'El resolver recursivo NO es dueño de la zona: recorre raíz → TLD → servidores autoritativos (salvo que tenga la respuesta en cache). Respeta el TTL del registro; también cachea respuestas negativas (NXDOMAIN) según el SOA (RFC 2308). En la simulación, la probabilidad de cache hit representa respuestas aún dentro del TTL.',
      receives: ['Query A/AAAA/HTTPS del cliente'],
      processes: ['Consulta de cache', 'Recursión hacia el autoritativo', 'Validación DNSSEC (si aplica)'],
      emits: ['Respuesta con registros + TTL restante'],
      protocols: ['DNS sobre UDP/TCP', 'DoH/DoT opcional'],
      ports: ['53/udp', '53/tcp', '443 (DoH)', '853 (DoT)'],
      typicalLogs: ['query log: qname, qtype, rcode, latency, cache=hit|miss'],
      typicalMetrics: ['cache hit ratio', 'SERVFAIL rate', 'latencia de resolución'],
      failureModes: [
        {
          name: 'Registro obsoleto por TTL',
          symptoms: 'Algunos clientes siguen yendo a la IP antigua tras un cambio.',
          diagnosis: 'Comparar respuesta del autoritativo (dig @ns) con la del resolver; revisar el TTL.',
          mitigation: 'Bajar el TTL antes de migraciones planificadas.',
        },
      ],
      docs: [{ title: 'RFC 1034 — Domain Names: Concepts', url: 'https://www.rfc-editor.org/rfc/rfc1034' }],
      glossary: ['TTL', 'Resolver recursivo', 'Servidor autoritativo', 'Negative caching'],
    },
  }),
  svc({
    id: 'developer',
    name: 'Developer',
    provider: 'generic',
    category: 'Delivery',
    layer: 'delivery',
    plane: 'delivery',
    role: 'Origen del cambio de código',
    inspector: {
      summary: 'Una persona modifica código, hace commit y push a la rama principal (normalmente vía merge request revisado).',
      advanced: 'El push dispara un webhook del sistema de control de versiones. En equipos maduros la rama main está protegida y sólo recibe merges tras revisión y pipeline verde.',
      receives: ['Feedback del pipeline'],
      processes: ['git commit', 'git push'],
      emits: ['Push event'],
      protocols: ['SSH', 'HTTPS (Git smart protocol)'],
      ports: ['22', '443'],
      docs: [{ title: 'Git — git-push', url: 'https://git-scm.com/docs/git-push' }],
    },
  }),
  svc({
    id: 'gitlab-repo',
    name: 'GitLab — repositorio de aplicación',
    provider: 'generic',
    category: 'Control de versiones',
    layer: 'delivery',
    plane: 'delivery',
    role: 'Fuente del código; dispara pipelines',
    inspector: {
      summary: 'Repositorio Git con el código de los microservicios (monorepo en este escenario).',
      advanced: 'Un push a main crea un pipeline según .gitlab-ci.yml. Las reglas `rules:changes` permiten construir sólo los servicios modificados.',
      receives: ['git push'],
      processes: ['Almacenar commits', 'Evaluar reglas de pipeline'],
      emits: ['Pipeline trigger'],
      protocols: ['HTTPS', 'SSH'],
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO — no es configuración productiva
workflow:
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
build-catalog:
  rules:
    - changes: [services/catalog/**/*]`,
      },
      docs: [{ title: 'GitLab CI/CD', url: 'https://docs.gitlab.com/ci/' }],
    },
  }),
  svc({
    id: 'github-repo',
    name: 'GitHub — repositorio de aplicación',
    provider: 'generic',
    category: 'Control de versiones',
    layer: 'delivery',
    plane: 'delivery',
    role: 'Fuente del código; dispara el CI',
    inspector: {
      summary: 'Repositorio Git en GitHub con el código de los microservicios. Un push a main notifica al sistema de CI (aquí, un trigger de Cloud Build mediante la GitHub App).',
      advanced: 'Las reglas de protección de rama (o rulesets) exigen PR, revisión y checks verdes antes de llegar a main.',
      receives: ['git push'],
      processes: ['Almacenar commits', 'Branch protection', 'Webhooks / GitHub App'],
      emits: ['Evento push'],
      protocols: ['HTTPS', 'SSH'],
      docs: [{ title: 'GitHub — About protected branches', url: 'https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches' }],
    },
  }),
  svc({
    id: 'github-actions',
    name: 'GitHub Actions (runner)',
    provider: 'generic',
    category: 'CI',
    layer: 'delivery',
    plane: 'delivery',
    role: 'Integración continua: test, scan, build, publish',
    inspector: {
      summary: 'Un workflow de GitHub Actions ejecuta tests, scans, build y push de imágenes, y actualiza el repo GitOps.',
      advanced:
        'CI ≠ CD: el workflow no aplica nada al cluster. Con AWS, Azure o GCP puede autenticarse por OIDC (id-token: write) sin secretos de larga duración. Con proveedores que sólo admiten tokens de API (como DigitalOcean en este escenario), el token se guarda como secret del repositorio o del environment: scopes mínimos, rotación y environments con revisores.',
      receives: ['Evento push'],
      processes: ['checkout', 'lint', 'tests', 'SAST/SCA', 'docker build', 'image scan', 'push', 'commit GitOps'],
      emits: ['Imagen OCI', 'Commit al repo GitOps'],
      protocols: ['HTTPS'],
      identity: ['OIDC (id-token) cuando el proveedor lo soporta; si no, token de API en GitHub Secrets'],
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO — .github/workflows/release.yml
on: { push: { branches: [main] } }
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix: { service: [api, catalog, orders] }
    steps:
      - uses: actions/checkout@v4
      - run: make test
      - uses: digitalocean/action-doctl@v2
        with: { token: \${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }} }
      - run: doctl registry login --expiry-seconds 600
      - run: |
          docker build -t registry.digitalocean.com/shop/\${{ matrix.service }}:$VERSION services/\${{ matrix.service }}
          docker push registry.digitalocean.com/shop/\${{ matrix.service }}:$VERSION`,
      },
      failureModes: [
        {
          name: 'Tests fallidos',
          symptoms: 'El job falla en tests; no se publican imágenes.',
          diagnosis: 'Logs del job; reproducir localmente.',
          mitigation: 'Corregir el código; producción no cambia.',
        },
        {
          name: 'Token expirado o sin scope',
          symptoms: 'unauthorized al hacer login/push en el registry.',
          diagnosis: 'Revisar el secret y los scopes del token.',
          mitigation: 'Rotar el token con scopes mínimos; preferir OIDC donde exista.',
        },
      ],
      docs: [{ title: 'GitHub Actions documentation', url: 'https://docs.github.com/en/actions' }],
      glossary: ['CI', 'OIDC'],
    },
  }),
  svc({
    id: 'gitlab-ci',
    name: 'GitLab CI/CD (runner)',
    provider: 'generic',
    category: 'CI',
    layer: 'delivery',
    plane: 'delivery',
    role: 'Integración continua: test, scan, build, publish',
    inspector: {
      summary: 'Ejecuta el pipeline (.gitlab-ci.yml): tests, análisis estático, escaneo de dependencias, build de la imagen OCI, escaneo de imagen y publicación en el registry. Al final actualiza el repo GitOps.',
      advanced:
        'CI ≠ CD. El pipeline NO despliega en el cluster: publica artefactos inmutables (imagen con digest) y modifica la referencia declarativa (tag/digest en kustomization.yaml). Argo CD hace el resto. Para publicar en el registry usa credenciales de corta duración (id_token OIDC federado con un rol del proveedor cloud), nunca claves estáticas.',
      receives: ['Pipeline trigger'],
      processes: ['checkout', 'lint', 'unit tests', 'SAST', 'dependency scan', 'docker build', 'image scan', 'docker push', 'commit GitOps'],
      emits: ['Imagen OCI al registry', 'Commit al repo GitOps', 'Estado del pipeline'],
      protocols: ['HTTPS (registry API v2)', 'Git'],
      identity: ['OIDC id_token → rol cloud con permiso de push (p.ej. sts:AssumeRoleWithWebIdentity + ecr:PutImage en AWS)'],
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO
stages: [test, scan, build, publish, gitops]
unit-tests:
  stage: test
  script: [make test]
build-image:
  stage: build
  parallel:
    matrix: [{ SERVICE: [api, catalog, orders] }]
  script: [docker build -t $REGISTRY/$SERVICE:$VERSION services/$SERVICE]
update-gitops:
  stage: gitops
  script:
    - kustomize edit set image $REGISTRY/$SERVICE:$VERSION
    - git commit -am "bump $SERVICE $VERSION" && git push`,
      },
      typicalLogs: ['job log por etapa', 'JUnit report', 'informe SAST/SCA'],
      typicalMetrics: ['duración del pipeline', 'tasa de fallos por etapa', 'lead time for changes'],
      failureModes: [
        {
          name: 'Tests fallidos',
          symptoms: 'Etapa unit-tests en rojo; no se construyen ni publican imágenes.',
          diagnosis: 'Revisar el JUnit report del job; reproducir localmente.',
          mitigation: 'Corregir el código. El cluster no se ve afectado porque CI se detiene antes de publicar.',
        },
        {
          name: 'Sin permisos para publicar',
          symptoms: 'docker push → 401/403 denied (p.ej. "not authorized to perform ecr:InitiateLayerUpload").',
          diagnosis: 'Revisar la federación OIDC del rol y los permisos sobre el repositorio del registry.',
          mitigation: 'Ajustar permisos mínimos sobre el repositorio concreto.',
        },
      ],
      docs: [{ title: 'GitLab CI/CD', url: 'https://docs.gitlab.com/ci/' }],
      glossary: ['CI', 'Artefacto inmutable', 'Digest', 'OIDC'],
    },
  }),
  svc({
    id: 'gitops-repo',
    name: 'Repositorio GitOps (manifiestos)',
    provider: 'generic',
    category: 'GitOps',
    layer: 'gitops',
    plane: 'delivery',
    role: 'Desired state declarativo del cluster',
    inspector: {
      summary: 'Repositorio con los manifiestos Kubernetes (Kustomize/Helm). Es la fuente de verdad de lo que debe correr en el cluster.',
      advanced: 'Separar el repo de aplicación del repo GitOps evita bucles de CI y permite auditar cada cambio de entorno. Un rollback es un `git revert`, no un `kubectl` manual.',
      receives: ['Commit del pipeline (bump de imagen)', 'git revert en rollback'],
      processes: ['Versionar el desired state'],
      emits: ['Revisiones consumidas por Argo CD'],
      protocols: ['Git sobre HTTPS/SSH'],
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO — overlays/prod/kustomization.yaml
resources: [../../base]
images:
  - name: catalog
    newName: <registry>/shop/catalog
    newTag: "1.8.4"`,
      },
      docs: [{ title: 'Kustomize — images', url: 'https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/images/' }],
      glossary: ['GitOps', 'Desired state', 'Drift'],
    },
  }),
  svc({
    id: 'argocd',
    name: 'Argo CD',
    provider: 'generic',
    category: 'CD / GitOps',
    layer: 'gitops',
    plane: 'control',
    role: 'Reconcilia el desired state de Git con el live state del cluster',
    inspector: {
      summary: 'Controlador que corre dentro del cluster, observa el repo GitOps y aplica los cambios para que el cluster coincida con Git.',
      advanced:
        'Argo CD compara manifiestos renderizados con el estado vivo (diff). Estados: Sync (Synced/OutOfSync) y Health (Healthy/Progressing/Degraded). No compila código ni construye imágenes. Por defecto hace polling del repo (≈3 min) o reacciona a un webhook. Un Deployment que no progresa queda Degraded, pero Argo CD no revierte automáticamente: el rollback es un nuevo commit (o Argo Rollouts para estrategias progresivas).',
      receives: ['Revisiones del repo GitOps'],
      processes: ['Render (Kustomize/Helm)', 'Diff desired vs live', 'Sync (apply)', 'Evaluación de health'],
      emits: ['Requests al kube-apiserver', 'Eventos de sync/health'],
      protocols: ['Git', 'HTTPS (kube-apiserver)'],
      ports: ['443 → kube-apiserver'],
      identity: ['ServiceAccount argocd-application-controller (RBAC en el cluster)'],
      trustBoundary: 'Dentro del cluster (namespace argocd); accede al repo con credenciales de sólo lectura.',
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata: { name: shop, namespace: argocd }
spec:
  source:
    repoURL: https://gitlab.example.com/platform/gitops.git
    path: overlays/prod
    targetRevision: main
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }`,
      },
      typicalLogs: ['Comparing app state', 'Sync operation succeeded', 'Health status changed'],
      typicalMetrics: ['argocd_app_info{sync_status,health_status}', 'argocd_app_sync_total'],
      failureModes: [
        {
          name: 'OutOfSync recurrente (drift)',
          symptoms: 'La app vuelve a OutOfSync tras cada sync.',
          diagnosis: 'Ver el diff: un controlador o un humano modifica campos (p.ej. replicas por HPA).',
          mitigation: 'ignoreDifferences para campos gestionados por otros controladores; prohibir cambios manuales.',
        },
      ],
      docs: [{ title: 'Argo CD docs', url: 'https://argo-cd.readthedocs.io/en/stable/' }],
      glossary: ['GitOps', 'Reconciliation loop', 'Self-heal'],
    },
  }),
  svc({
    id: 'k8s-microservice',
    name: 'Microservicio (Deployment)',
    provider: 'generic',
    category: 'Workload',
    layer: 'kubernetes',
    plane: 'data',
    role: 'Lógica de negocio en Pods detrás de un Service',
    inspector: {
      summary: 'Un Deployment gestiona un ReplicaSet de Pods idénticos. Un Service (ClusterIP) les da un nombre DNS y una IP virtual estable.',
      advanced:
        'El tráfico este-oeste usa el DNS interno (svc.cluster.local) y la ClusterIP; kube-proxy (iptables/IPVS) o un dataplane eBPF traduce a la IP de un Pod listado en la EndpointSlice. Sólo los Pods con readiness OK aparecen como endpoints listos. Cuando el load balancer del proveedor enruta directamente a la IP del Pod (AWS Load Balancer Controller en modo `target-type: ip`, Application Gateway Ingress Controller con Azure CNI), el tráfico norte-sur no pasa por kube-proxy.',
      receives: ['HTTP desde ALB o desde otros servicios'],
      processes: ['AuthN/AuthZ', 'Validación', 'Lógica de negocio', 'Llamadas a dependencias'],
      emits: ['Respuestas HTTP', 'Logs estructurados', 'Spans OpenTelemetry', 'Métricas /metrics'],
      protocols: ['HTTP/1.1', 'HTTP/2', 'PostgreSQL wire', 'RESP (Redis)'],
      ports: ['8080 (contenedor)', '80 (Service)'],
      identity: ['ServiceAccount federado con la identidad de workload del proveedor (EKS Pod Identity / IRSA, Microsoft Entra Workload ID…)'],
      exampleConfig: {
        language: 'yaml',
        code: `# ILUSTRATIVO
apiVersion: apps/v1
kind: Deployment
metadata: { name: catalog, namespace: shop }
spec:
  replicas: 3
  progressDeadlineSeconds: 120
  strategy:
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  template:
    spec:
      containers:
        - name: app
          image: <registry>/shop/catalog:1.8.3
          ports: [{ containerPort: 8080 }]
          readinessProbe: { httpGet: { path: /readyz, port: 8080 }, periodSeconds: 5 }
          livenessProbe:  { httpGet: { path: /livez,  port: 8080 }, periodSeconds: 10 }`,
      },
      typicalLogs: ['{"level":"info","msg":"request completed","status":200,"trace_id":"…"}'],
      typicalMetrics: ['http_server_request_duration_seconds', 'container_cpu_usage_seconds_total', 'kube_deployment_status_replicas_available'],
      failureModes: [
        {
          name: 'ImagePullBackOff',
          symptoms: 'Pod nuevo atascado; eventos Failed/BackOff pulling image.',
          diagnosis: 'kubectl describe pod → "manifest unknown" (tag inexistente) o 401/403 (permisos del nodo).',
          mitigation: 'Corregir tag/digest en GitOps; revisar permisos de pull del rol del nodo.',
        },
        {
          name: 'Readiness fallida / CrashLoopBackOff',
          symptoms: 'Pods Running pero 0/1 Ready; reinicios crecientes.',
          diagnosis: 'kubectl logs --previous; revisar dependencias (DB, config, secretos).',
          mitigation: 'Corregir la configuración; rollback GitOps mientras tanto.',
        },
        {
          name: 'Service sin endpoints',
          symptoms: 'Llamadas este-oeste fallan con connection refused / 503.',
          diagnosis: 'kubectl get endpointslices -l kubernetes.io/service-name=<svc>; comparar selector vs labels.',
          mitigation: 'Corregir el selector o las labels del Pod.',
        },
        {
          name: 'NetworkPolicy bloquea tráfico',
          symptoms: 'Timeouts (no errores) entre servicios: los paquetes se descartan.',
          diagnosis: 'Revisar NetworkPolicies del namespace destino; el CNI debe soportar NetworkPolicy.',
          mitigation: 'Añadir regla ingress explícita desde el ServiceAccount/namespace origen.',
        },
      ],
      docs: [
        { title: 'Kubernetes — Deployments', url: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' },
        { title: 'Kubernetes — Service', url: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
        { title: 'Kubernetes — Probes', url: 'https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/' },
      ],
      glossary: ['ReplicaSet', 'EndpointSlice', 'ClusterIP', 'kube-proxy', 'Readiness'],
    },
  }),
  svc({
    id: 'terraform',
    name: 'Terraform (job de IaC)',
    provider: 'generic',
    category: 'IaC',
    layer: 'iac',
    plane: 'control',
    role: 'Gestiona infraestructura cloud de forma declarativa',
    inspector: {
      summary: 'Terraform crea y modifica recursos cloud (red, balanceadores, cluster, base de datos). Se ejecuta cuando cambia la infraestructura, no en cada release de aplicación.',
      advanced:
        'Flujo: init (backend + providers) → lock del state → refresh/plan (lee recursos reales vía API del proveedor) → revisión/aprobación → apply del plan guardado → escritura del state → unlock. Si alguien cambió recursos fuera de Terraform, el plan muestra drift. IaC ≠ GitOps: Terraform administra infraestructura; Argo CD reconcilia aplicaciones dentro de Kubernetes.',
      receives: ['Cambio en el repo de infraestructura'],
      processes: ['init', 'plan', 'apply', 'gestión del state'],
      emits: ['Llamadas a la API del proveedor', 'State actualizado', 'Outputs'],
      protocols: ['HTTPS (APIs del proveedor)'],
      identity: ['Identidad de despliegue con permisos acotados (federada vía OIDC desde CI)'],
      exampleConfig: {
        language: 'bash',
        code: `# ILUSTRATIVO — flujo típico en CI
terraform init -input=false
terraform plan -input=false -out=tfplan   # revisar y aprobar
terraform apply -input=false tfplan       # aplica exactamente el plan revisado
# El backend del state (y su locking) depende del proveedor: ver el nodo de state.`,
      },
      typicalLogs: ['Acquiring state lock', 'Plan: 1 to add, 1 to change, 0 to destroy', 'Apply complete!'],
      failureModes: [
        {
          name: 'State lock ocupado',
          symptoms: 'Error acquiring the state lock.',
          diagnosis: 'Ver quién tiene el lock (Lock Info); comprobar si hay otro job en curso.',
          mitigation: 'Esperar o, sólo si el proceso murió, terraform force-unlock <ID>.',
        },
        {
          name: 'Drift',
          symptoms: 'El plan propone cambios que nadie pidió.',
          diagnosis: '"Objects have changed outside of Terraform" en el plan; revisar CloudTrail.',
          mitigation: 'Revertir el cambio manual vía apply o incorporarlo al código.',
        },
      ],
      docs: [
        { title: 'Terraform — S3 backend', url: 'https://developer.hashicorp.com/terraform/language/backend/s3' },
        { title: 'Terraform — State locking', url: 'https://developer.hashicorp.com/terraform/language/state/locking' },
      ],
      glossary: ['IaC', 'State', 'Drift', 'Plan'],
    },
  }),
];
