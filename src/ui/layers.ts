/**
 * Capas conceptuales del canvas: vistas de lectura sobre la MISMA topología.
 *
 * La pertenencia a una capa se deriva de datos que ya existen en el modelo
 * (capa del servicio en el catálogo, intención del nodo, tipo de boundary).
 * No se inventan componentes: si una capa no tiene elementos en el escenario
 * (p.ej. observabilidad), se muestra deshabilitada.
 */
import type { CatalogService, NodeDef, Boundary } from '../model/schemas';

export type LayerId = 'cloud' | 'networking' | 'kubernetes' | 'application' | 'delivery' | 'observability';

export interface LayerInfo {
  id: LayerId;
  label: string;
  description: string;
}

export const LAYERS: LayerInfo[] = [
  { id: 'cloud', label: 'Cloud', description: 'Regiones, VPC/VNet/VCN, subnets y servicios de plataforma' },
  { id: 'networking', label: 'Networking', description: 'DNS, edge, WAF, load balancers y gateways' },
  { id: 'kubernetes', label: 'Kubernetes', description: 'Control plane, cluster, namespaces, workloads y controladores' },
  { id: 'application', label: 'Aplicación', description: 'Cliente, microservicios, cache, mensajería y bases de datos' },
  { id: 'delivery', label: 'Delivery', description: 'Repositorios, CI, registry, GitOps e IaC' },
  { id: 'observability', label: 'Observabilidad', description: 'Componentes de observabilidad del escenario' },
];

/** Capas a las que pertenece un nodo (puede ser más de una). */
export function nodeLayers(node: NodeDef, svc: CatalogService | undefined): LayerId[] {
  const out = new Set<LayerId>();
  const layer = svc?.layer;
  if (layer === 'dns' || layer === 'edge' || layer === 'security' || layer === 'load-balancing' || layer === 'network') out.add('networking');
  if (layer === 'kubernetes') out.add('kubernetes');
  if (layer === 'data' || layer === 'messaging' || layer === 'client' || layer === 'compute') out.add('application');
  if (layer === 'delivery' || layer === 'registry' || layer === 'iac' || layer === 'gitops') out.add('delivery');
  if (layer === 'observability') out.add('observability');
  switch (node.intent) {
    case 'microservice':
      out.add('application');
      out.add('kubernetes');
      break;
    case 'gitops-controller':
      out.add('kubernetes');
      out.add('delivery');
      break;
    case 'ingress-gateway':
      out.add('networking');
      out.add('kubernetes');
      break;
    case 'k8s-control-plane':
      out.add('kubernetes');
      out.add('cloud');
      break;
    case 'registry':
      out.add('cloud');
      break;
    default:
      break;
  }
  if (out.size === 0) out.add('application');
  return [...out];
}

export function boundaryLayer(b: Boundary): LayerId {
  switch (b.kind) {
    case 'cluster':
    case 'namespace':
      return 'kubernetes';
    case 'delivery':
      return 'delivery';
    case 'internet':
    case 'edge':
      return 'networking';
    default:
      return 'cloud';
  }
}

/** Un elemento es visible si al menos una de sus capas está activa. */
export function isVisible(layers: LayerId[], hidden: ReadonlySet<string>): boolean {
  return layers.some((l) => !hidden.has(l));
}
