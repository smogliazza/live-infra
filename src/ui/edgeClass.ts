/**
 * Clasificación VISUAL de las conexiones, derivada de datos existentes del
 * modelo (EdgeDef.traffic + intención de los extremos). No cambia el edge:
 * sólo decide cómo se dibuja y cómo se describe.
 */
import type { EdgeDef, NodeDef } from '../model/schemas';

export type EdgeClass = 'traffic' | 'internal' | 'delivery' | 'control' | 'iac';

export const EDGE_CLASS_LABEL: Record<EdgeClass, string> = {
  traffic: 'Tráfico norte-sur (requests de usuarios)',
  internal: 'Tráfico este-oeste (dentro de la red privada)',
  delivery: 'Delivery (CI, registry, image pull)',
  control: 'Control plane / reconciliación GitOps',
  iac: 'Infraestructura como código (APIs del proveedor)',
};

export function edgeClass(e: EdgeDef, nodes: Map<string, NodeDef>): EdgeClass {
  if (e.traffic === 'north-south') return 'traffic';
  if (e.traffic === 'east-west') return 'internal';
  const src = nodes.get(e.source)?.intent;
  if (src === 'iac') return 'iac';
  if (e.traffic === 'control' || src === 'gitops-controller' || src === 'k8s-control-plane') return 'control';
  return 'delivery';
}
