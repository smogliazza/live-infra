/**
 * Cloudflare como edge externo (DNS autoritativo + proxy inverso + WAF).
 * Reutilizable por cualquier perfil como "variante Cloudflare".
 * Capacidades por plan: verificar en la documentación oficial vigente.
 */
import type { CatalogService } from '../../../model/schemas';
import { svc } from '../../generic';

export const cloudflareServices: CatalogService[] = [
  svc({
    id: 'cloudflare-dns',
    name: 'Cloudflare DNS (zona en Cloudflare)',
    provider: 'cloudflare',
    category: 'DNS',
    layer: 'dns',
    plane: 'data',
    role: 'DNS autoritativo; los registros "proxied" devuelven IPs anycast de Cloudflare',
    inspector: {
      summary: 'La zona example.com está delegada a Cloudflare. shop.example.com está "proxied" (nube naranja): el DNS no devuelve la IP del origen sino IPs anycast de Cloudflare.',
      advanced:
        'Diferencia clave: un registro proxied oculta el origen y hace que todo el tráfico pase por el proxy de Cloudflare; un registro "DNS only" (nube gris) devuelve la IP real y Cloudflare no interviene en el tráfico. Para un registro proxied el TTL que ven los resolvers es el que fija Cloudflare (Auto). DigitalOcean DNS es la alternativa si no se usa Cloudflare, pero entonces no hay proxy ni WAF.',
      receives: ['Queries del resolver recursivo'],
      processes: ['Lookup en la zona', 'Sustitución por IPs anycast en registros proxied'],
      emits: ['Respuesta autoritativa'],
      protocols: ['DNS UDP/TCP', 'DNSSEC opcional'],
      ports: ['53'],
      exampleConfig: {
        language: 'hcl',
        code: `# ILUSTRATIVO (provider cloudflare/cloudflare; nombres de recursos según la versión del provider)
resource "cloudflare_dns_record" "shop" {
  zone_id = var.zone_id
  name    = "shop"
  type    = "A"
  content = digitalocean_loadbalancer.gateway.ip   # IP del origen, oculta al público
  proxied = true
  ttl     = 1   # 1 = automático
}`,
      },
      failureModes: [
        {
          name: 'Registro eliminado o en "DNS only"',
          symptoms: 'NXDOMAIN; o el tráfico va directo al origen saltándose el WAF.',
          diagnosis: 'dig shop.example.com: si devuelve la IP del load balancer en vez de IPs de Cloudflare, el registro no está proxied.',
          mitigation: 'Restaurar el registro proxied; restringir el origen a los rangos IP de Cloudflare.',
        },
      ],
      docs: [{ title: 'Cloudflare — Proxy status', url: 'https://developers.cloudflare.com/dns/proxy-status/' }],
      glossary: ['TTL', 'Servidor autoritativo', 'Anycast'],
    },
  }),
  svc({
    id: 'cloudflare-proxy',
    name: 'Cloudflare (proxy inverso + CDN)',
    provider: 'cloudflare',
    category: 'CDN / Edge',
    layer: 'edge',
    plane: 'data',
    role: 'Edge externo: TLS, cache, protección DDoS y reenvío al origen en DigitalOcean',
    inspector: {
      summary: 'Red anycast de Cloudflare delante del origen. Termina TLS del cliente, aplica WAF y reglas, y abre una conexión TLS nueva hacia el load balancer de DigitalOcean.',
      advanced:
        'El modo SSL/TLS debe ser "Full (strict)": Cloudflare valida el certificado del origen (p.ej. un Cloudflare Origin CA en el Gateway). Errores propios de Cloudflare: 521 (el origen rechaza la conexión), 522 (timeout de conexión con el origen), 524 (el origen no responde a tiempo), 525/526 (handshake / certificado del origen). Si el origen devuelve un 5xx, Cloudflare lo reenvía tal cual. Cada respuesta lleva el header cf-ray para correlacionar con los logs.',
      receives: ['HTTPS del cliente (HTTP/2, HTTP/3)'],
      processes: ['TLS termination', 'WAF / reglas', 'Cache', 'Origin request'],
      emits: ['Request al origen con CF-Connecting-IP y cf-ray'],
      protocols: ['HTTPS', 'HTTP/2', 'HTTP/3 (QUIC)'],
      ports: ['443'],
      trustBoundary: 'Internet → red de Cloudflare → Internet → DigitalOcean. El origen sigue teniendo IP pública: restringirlo a los rangos IP de Cloudflare, usar Authenticated Origin Pulls (mTLS) o Cloudflare Tunnel.',
      typicalLogs: ['HTTP request logs (Logpush según plan): EdgeResponseStatus, OriginResponseStatus, RayID, CacheCacheStatus'],
      typicalMetrics: ['requests por status', 'origin response time', 'cache ratio'],
      failureModes: [
        {
          name: '52x de Cloudflare',
          symptoms: 'Página de error de Cloudflare con 521/522/524 y un Ray ID.',
          diagnosis: '521: nada escucha o el firewall rechaza; 522: paquetes descartados (firewall que no permite rangos de Cloudflare); 524: el origen tarda demasiado.',
          mitigation: 'Permitir los rangos IP de Cloudflare en el firewall del origen; revisar la salud del load balancer y los timeouts.',
        },
      ],
      docs: [
        { title: 'Cloudflare — 5xx errors', url: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/' },
        { title: 'Cloudflare — Full (strict) SSL mode', url: 'https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/' },
      ],
      glossary: ['Anycast', 'PoP', 'Origin'],
    },
  }),
  svc({
    id: 'cloudflare-waf',
    name: 'Cloudflare WAF',
    provider: 'cloudflare',
    category: 'Seguridad',
    layer: 'security',
    plane: 'data',
    role: 'Filtra requests HTTP en el edge de Cloudflare',
    inspector: {
      summary: 'Managed rulesets (Cloudflare Managed Ruleset, OWASP Core Ruleset), custom rules y rate limiting evaluados en el edge.',
      advanced:
        'Simplificación: la evaluación ocurre dentro del proxy, no en un salto separado. Qué rulesets gestionados están disponibles depende del plan (verifícalo). Un bloqueo devuelve 403 con la página de Cloudflare y un Ray ID; en Security Events se ve la regla y el ruleset que bloquearon. La request nunca llega a DigitalOcean.',
      receives: ['Request HTTP inspeccionada'],
      processes: ['Custom rules', 'Managed rulesets', 'Rate limiting'],
      emits: ['Allow / Block / Managed Challenge / Log'],
      protocols: ['HTTP (inspección L7)'],
      typicalLogs: ['Security Events: action=block, ruleId, rulesetId, rayId'],
      failureModes: [
        {
          name: 'Falso positivo',
          symptoms: '403 de Cloudflare con Ray ID; nada en DigitalOcean.',
          diagnosis: 'Buscar el Ray ID en Security Events para identificar la regla.',
          mitigation: 'Override de esa regla (acción Log o skip con una expresión acotada); no desactivar todo el ruleset.',
        },
      ],
      docs: [{ title: 'Cloudflare WAF', url: 'https://developers.cloudflare.com/waf/' }],
      glossary: ['Web ACL', 'Managed rule group', 'Rate-based rule'],
    },
  }),
];
