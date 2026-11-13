/**
 * La aplicación "shop" es la MISMA en todos los proveedores: mismo árbol de
 * llamadas, mismos timeouts y mismas etapas de pipeline. Sólo cambian los
 * componentes de infraestructura que la soportan. Así el modo comparación
 * compara la misma intención arquitectónica.
 */
import type { DeliveryDef, FlowStep, ScenarioDef } from '../model/schemas';

export interface ShopComponents {
  client: string;
  resolver: string;
  dnsAuthoritative: string;
  edge: string;
  waf: string;
  loadBalancer: string;
  cache: string;
  database: string;
  queue: string;
}

export function shopRequest(c: ShopComponents): ScenarioDef['request'] {
  const root: FlowStep = {
    id: 'client',
    component: c.client,
    operation: 'GET /api/cart/summary',
    processMs: [0.2, 0.5],
    sequential: true,
    children: [
      {
        id: 'dns',
        component: c.resolver,
        operation: 'DNS A shop.example.com',
        processMs: [0.2, 0.5],
        // Probabilidad de que el registro siga en cache (dentro del TTL).
        cacheHitRatio: 0.6,
        sequential: true,
        children: [{ id: 'dns-auth', component: c.dnsAuthoritative, operation: 'DNS authoritative answer', processMs: [0.3, 0.8], when: 'previous-cache-miss', responseBytes: 120 }],
        responseBytes: 120,
      },
      {
        id: 'edge',
        component: c.edge,
        operation: 'GET /api/cart/summary',
        processMs: [0.8, 1.6],
        sequential: true,
        children: [
          { id: 'waf', component: c.waf, operation: 'WAF policy evaluation', processMs: [0.2, 0.5], responseBytes: 0 },
          {
            id: 'lb',
            component: c.loadBalancer,
            operation: 'listener HTTPS:443',
            processMs: [0.4, 0.9],
            children: [
              {
                id: 'api',
                component: 'api',
                operation: 'GET /api/cart/summary',
                processMs: [1, 2.5],
                children: [
                  {
                    id: 'catalog',
                    component: 'catalog',
                    operation: 'GET /products?ids=42,77',
                    processMs: [0.8, 1.8],
                    timeoutMs: 250,
                    retries: 1,
                    sequential: true,
                    children: [
                      { id: 'cache', component: c.cache, operation: 'GET product:42,77', processMs: [0.1, 0.3], cacheHitRatio: 0.8, responseBytes: 900 },
                      { id: 'catalog-db', component: c.database, operation: 'SELECT * FROM products WHERE id = ANY($1)', processMs: [2, 6], when: 'previous-cache-miss', responseBytes: 900 },
                    ],
                  },
                  {
                    id: 'orders',
                    component: 'orders',
                    operation: 'GET /carts/c-1029',
                    processMs: [0.8, 1.8],
                    timeoutMs: 400,
                    sequential: true,
                    onChildError: 503,
                    children: [
                      { id: 'orders-db', component: c.database, operation: CART_QUERY, processMs: [1.5, 4], timeoutMs: 300, responseBytes: 600 },
                      { id: 'orders-queue', component: c.queue, operation: 'publish cart.viewed', processMs: [3, 6], async: true },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  return { host: 'shop.example.com', path: '/api/cart/summary', method: 'GET', root };
}

export const CART_QUERY = 'SELECT * FROM cart_items WHERE cart_id = $1';

/** Etapas del pipeline: idénticas en todos los proveedores salvo el registry. */
export function shopStages(ci: string, registryName: string): DeliveryDef['stages'] {
  return [
    { id: 'checkout', name: 'checkout', component: ci, durationS: [5, 9], perService: false, kind: 'ci' },
    { id: 'lint', name: 'lint', component: ci, durationS: [10, 18], perService: false, kind: 'ci' },
    { id: 'unit-tests', name: 'unit tests', component: ci, durationS: [30, 55], perService: false, kind: 'ci' },
    { id: 'sast', name: 'SAST + dependency scan', component: ci, durationS: [20, 35], perService: false, kind: 'scan' },
    { id: 'build', name: 'docker build', component: ci, durationS: [45, 90], perService: true, kind: 'build' },
    { id: 'image-scan', name: 'image scan', component: ci, durationS: [15, 30], perService: true, kind: 'scan' },
    { id: 'publish', name: `push a ${registryName}`, component: ci, durationS: [8, 16], perService: true, kind: 'publish' },
    { id: 'gitops-update', name: 'actualizar GitOps', component: ci, durationS: [4, 8], perService: false, kind: 'gitops' },
  ];
}
