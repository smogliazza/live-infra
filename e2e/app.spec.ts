import { expect, test } from '@playwright/test';

test.describe('Cloud Flow Lab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('node-api')).toBeVisible();
  });

  test('una request recorre el mapa y genera una traza 200', async ({ page }) => {
    await page.getByLabel('Velocidad').selectOption('10');
    await page.getByTestId('send-request').click();
    await expect(page.getByTestId('event-log')).toContainText('request.completed', { timeout: 30_000 });
    await expect(page.getByTestId('event-log')).toContainText('HTTP 200');
    await page.getByTestId('tab-traces').click();
    await page.locator('.cfl-trace-item').first().click();
    await expect(page.getByTestId('waterfall')).toContainText('catalog');
    await expect(page.getByTestId('waterfall')).toContainText('orders');
  });

  test('seleccionar un nodo abre el inspector y filtra la consola', async ({ page }) => {
    await page.getByTestId('node-alb').click();
    const inspector = page.getByTestId('inspector');
    await expect(inspector).toContainText('Application Load Balancer');
    // El contenido técnico se organiza en secciones del inspector.
    await page.getByTestId('inspector-tab-config').click();
    await expect(inspector).toContainText('ILUSTRATIVA');
    await expect(inspector).toContainText('tg-shop-api');
    await page.getByTestId('inspector-tab-troubleshooting').click();
    await expect(inspector).toContainText('503 — sin targets sanos');
  });

  test('regresión: seleccionar varios nodos seguidos no rompe el canvas (React #185)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    for (const id of ['api', 'catalog', 'alb', 'orders', 'api']) {
      await page.getByTestId(`node-${id}`).click();
    }
    await expect(page.getByTestId('inspector')).toContainText('Microservicio');
    // Teclado: Enter sobre un nodo con foco también lo selecciona.
    await page.locator('.react-flow__node[data-id=alb]').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('inspector')).toContainText('Application Load Balancer');
    expect(errors).toEqual([]);
  });

  test('consola: el scroll manual hacia arriba no se ve forzado al fondo mientras corre la simulación', async ({ page }) => {
    await page.getByLabel('Velocidad').selectOption('10');
    await page.getByLabel('Carga en RPS').selectOption('50');
    const log = page.getByTestId('event-log');
    await expect(page.locator('.cfl-log-row').nth(60)).toBeAttached({ timeout: 30_000 });
    // El usuario sube con la rueda: se desactiva el seguimiento.
    await log.hover();
    await page.mouse.wheel(0, -400);
    await expect(page.getByTestId('follow-toggle')).not.toBeChecked();
    const top = await log.evaluate((el) => el.scrollTop);
    await page.waitForTimeout(1500); // siguen llegando eventos
    expect(await log.evaluate((el) => el.scrollTop)).toBe(top);
    await expect(page.getByTestId('jump-latest')).toBeVisible();
    // Volver al fondo reactiva el seguimiento.
    await log.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.getByTestId('follow-toggle')).toBeChecked();
    await page.waitForTimeout(800);
    expect(await log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(8);
  });

  test('fallo WAF: 403 desde el edge', async ({ page }) => {
    await page.getByTestId('open-faults').click();
    await page.getByTestId('fault-waf-false-positive').check();
    await page.getByLabel('Velocidad').selectOption('10');
    await page.getByTestId('send-request').click();
    await page.getByTestId('tab-events').click();
    await expect(page.getByTestId('event-log')).toContainText('HTTP 403', { timeout: 30_000 });
  });

  test('pausa y paso a paso controlan el reloj virtual', async ({ page }) => {
    await page.getByTestId('send-request').click();
    await page.getByTestId('play-toggle').click(); // pausa
    const clock = page.getByTestId('clock');
    const before = await clock.textContent();
    await page.waitForTimeout(400);
    expect(await clock.textContent()).toBe(before);
    await page.getByTestId('step-forward').click();
    await expect(clock).not.toHaveText(before ?? '');
  });

  test('perfil Azure: Application Gateway sin backends sanos devuelve 502', async ({ page }) => {
    await page.getByLabel('Proveedor', { exact: true }).selectOption('azure');
    await expect(page.getByTestId('node-appgw')).toBeVisible();
    await page.getByTestId('open-faults').click();
    await page.getByTestId('fault-lb-no-healthy-targets').check();
    await page.getByLabel('Velocidad').selectOption('10');
    await page.getByTestId('send-request').click();
    await page.getByTestId('tab-events').click();
    await expect(page.getByTestId('event-log')).toContainText('HTTP 502', { timeout: 30_000 });
    await page.getByTestId('node-appgw').click();
    await expect(page.getByTestId('inspector')).toContainText('Application Gateway');
  });

  test('perfil GCP: backend service sin endpoints sanos devuelve 502', async ({ page }) => {
    await page.getByLabel('Proveedor', { exact: true }).selectOption('gcp');
    await expect(page.getByTestId('node-gfe')).toBeVisible();
    await page.getByTestId('open-faults').click();
    await page.getByTestId('fault-lb-no-healthy-targets').check();
    await page.getByLabel('Velocidad').selectOption('10');
    await page.getByTestId('send-request').click();
    await page.getByTestId('tab-events').click();
    await expect(page.getByTestId('event-log')).toContainText('failed_to_pick_backend', { timeout: 30_000 });
    await page.getByTestId('node-backend').click();
    await expect(page.getByTestId('inspector')).toContainText('container-native');
  });

  test('perfil DigitalOcean: Cloudflare como edge y gateway L7 en el cluster', async ({ page }) => {
    await page.getByLabel('Proveedor', { exact: true }).selectOption('digitalocean');
    await expect(page.getByTestId('node-gateway')).toBeVisible();
    await page.getByTestId('open-faults').click();
    await page.getByTestId('fault-lb-no-healthy-targets').check();
    await page.getByLabel('Velocidad').selectOption('10');
    await page.getByTestId('send-request').click();
    await page.getByTestId('tab-events').click();
    await expect(page.getByTestId('event-log')).toContainText('no healthy upstream', { timeout: 30_000 });
    await page.getByTestId('node-cloudflare').click();
    await expect(page.getByTestId('inspector')).toContainText('CLOUDFLARE');
  });

  test('modo comparación: el mismo fallo da 503 en AWS y 502 en Azure', async ({ page }) => {
    await page.getByTestId('compare-select').selectOption('azure');
    await expect(page.getByTestId('compare-view')).toBeVisible();
    await page.getByTestId('open-faults').click();
    await page.getByTestId('fault-lb-no-healthy-targets').check();
    await page.getByLabel('Velocidad').selectOption('10');
    await page.getByTestId('send-request').click();
    const hops = page.getByTestId('compare-hops');
    await expect(hops).toContainText('HTTP 503', { timeout: 30_000 });
    await expect(hops).toContainText('HTTP 502');
    await expect(page.getByTestId('compare-table')).toContainText('Application Gateway');
  });

  test('release completa con rollout y smoke test', async ({ page }) => {
    await page.getByLabel('Velocidad').selectOption('25');
    await page.getByTestId('start-release').click();
    await page.getByTestId('tab-delivery').click();
    await expect(page.getByTestId('pipeline-stages')).toContainText('Smoke tests', { timeout: 45_000 });
    await page.getByTestId('tab-events').click();
    await expect(page.getByTestId('event-log')).toContainText('release.completed', { timeout: 45_000 });
  });

  // ---------------------------------------------------------- rediseño UI

  test('tema: alterna Dark Graphite / Light Technical y persiste entre sesiones', async ({ page }) => {
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    const initial = await theme();
    await page.getByTestId('theme-toggle').click();
    const toggled = await theme();
    expect(toggled).not.toBe(initial);
    await page.reload();
    await expect(page.getByTestId('node-api')).toBeVisible();
    expect(await theme()).toBe(toggled);
  });

  test('seleccionar una conexión muestra protocolo, puerto y regla de enrutado', async ({ page }) => {
    const edge = page.locator('.react-flow__edge[data-id="e-alb-api"]');
    await edge.locator('.cfl-edge-hit').dispatchEvent('click');
    const inspector = page.getByTestId('inspector');
    await expect(inspector).toHaveAttribute('data-view', 'edge');
    await expect(inspector).toContainText('HTTP/1.1 → Pod IP');
    await expect(inspector).toContainText('8080');
    await expect(inspector).toContainText('tg-shop-api');
  });

  test('seleccionar un evento muestra sus IDs, payload y relación causal', async ({ page }) => {
    await page.getByLabel('Velocidad').selectOption('10');
    await page.getByTestId('send-request').click();
    await expect(page.getByTestId('event-log')).toContainText('span.start', { timeout: 30_000 });
    await page.locator('.cfl-log-row', { hasText: 'span.start' }).first().click();
    const inspector = page.getByTestId('inspector');
    await expect(inspector).toHaveAttribute('data-view', 'event');
    await expect(inspector).toContainText('trace_id');
    await expect(inspector).toContainText('span_id');
    await expect(inspector).toContainText('Payload');
  });

  test('capas: ocultar una capa atenúa sus nodos sin alterar la simulación', async ({ page }) => {
    await page.getByTestId('layers-menu').click();
    await page.getByTestId('layer-delivery').uncheck();
    await expect(page.getByTestId('node-gitlab')).toHaveClass(/is-ghost/);
    await expect(page.getByTestId('node-api')).not.toHaveClass(/is-ghost/);
    // La capa de observabilidad no tiene componentes en el modelo: deshabilitada.
    await expect(page.getByTestId('layer-observability')).toBeDisabled();
    await page.getByLabel('Velocidad').selectOption('10');
    await page.getByTestId('send-request').click();
    await page.getByTestId('tab-events').click();
    await expect(page.getByTestId('event-log')).toContainText('HTTP 200', { timeout: 30_000 });
  });

  test('reorganización visual: arrastrar un nodo no cambia la topología y se puede restaurar', async ({ page }) => {
    const node = page.getByTestId('node-sqs');
    const before = await node.boundingBox();
    await node.hover();
    await page.mouse.down();
    await page.mouse.move(before!.x + 60, before!.y + 80, { steps: 8 });
    await page.mouse.up();
    const moved = await node.boundingBox();
    expect(Math.abs(moved!.y - before!.y)).toBeGreaterThan(30);
    await expect(page.getByTestId('reset-layout')).toBeEnabled();
    // La conexión orders → sqs sigue existiendo.
    await expect(page.locator('.react-flow__edge[data-id="e-orders-sqs"]')).toHaveCount(1);
    await page.getByTestId('reset-layout').click();
    const restored = await node.boundingBox();
    expect(Math.abs(restored!.y - before!.y)).toBeLessThan(2);
  });

  test('inspector: se puede ocultar y volver a mostrar sin perder la selección', async ({ page }) => {
    await page.getByTestId('node-catalog').click();
    await page.getByRole('button', { name: 'Ocultar inspector' }).click();
    await expect(page.getByTestId('inspector')).toHaveCount(0);
    await page.getByTestId('inspector-open').click();
    await expect(page.getByTestId('inspector')).toContainText('Microservicio');
  });

  test('leyenda y minimapa se muestran bajo demanda', async ({ page }) => {
    // Texto más ancho que el de este entorno (como las fuentes del runner de CI).
    await page.addStyleTag({ content: '.cfl-legend { letter-spacing: 0.6px; font-size: 12.5px !important; }' });
    await page.getByTestId('legend-toggle').click();
    await expect(page.getByTestId('legend')).toContainText('Control plane');
    // La leyenda no debe tapar los controles del canvas.
    const legend = (await page.getByTestId('legend').boundingBox())!;
    const controls = (await page.locator('.react-flow__controls').boundingBox())!;
    const overlap = !(legend.x > controls.x + controls.width || legend.x + legend.width < controls.x || legend.y > controls.y + controls.height || legend.y + legend.height < controls.y);
    expect(overlap).toBe(false);
    await page.getByTestId('minimap-toggle').click();
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
  });

  test('movimiento reducido: los pulsos pasan a marcadores estáticos', async ({ page }) => {
    await page.getByTestId('layers-menu').click();
    await page.getByLabel('Movimiento reducido').check();
    await expect(page.locator('.cfl-app')).toHaveClass(/reduced-motion/);
    await page.getByTestId('send-request').click();
    await expect(page.locator('.cfl-pulse.static').first()).toBeAttached({ timeout: 30_000 });
  });
});
