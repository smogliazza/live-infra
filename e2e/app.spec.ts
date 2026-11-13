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
    await expect(inspector).toContainText('ILUSTRATIVA');
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
});
