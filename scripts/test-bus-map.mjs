// Actual MapLibre/WebGL rendering with a deterministic local style and API fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const liveMap = process.argv.includes('--live');
const output = resolve(tmpdir(), liveMap ? 'qcu-bus-map-live' : 'qcu-bus-map');
await mkdir(output, { recursive: true });
const version = '4.7.1';
async function mapAsset(extension) {
  const local = resolve(root, '.build/bus-map-fixtures', 'maplibre-gl.' + extension);
  try { return await readFile(local); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(`https://unpkg.com/maplibre-gl@${version}/dist/maplibre-gl.${extension}`, { signal: AbortSignal.timeout(30000) });
  assert(response.ok, 'MapLibre fixture download');
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(resolve(root, '.build/bus-map-fixtures'), { recursive: true });
  await writeFile(local, bytes);
  return bytes;
}
const [mapJS, mapCSS, busJSON] = await Promise.all([mapAsset('js'), mapAsset('css'), readFile(resolve(root, 'data/qcity-bus.json'), 'utf8')]);
const busData = JSON.parse(busJSON);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const file = resolve(root, '.' + path);
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return response.writeHead(403).end();
  try { response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const dashboard = { status: 'OK', profile: { name: 'Alexandra Reyes', picture: '' }, entries: [], buildings: [], tasks: [], notes: [] };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  async function contextFor(viewport, mode = 'normal') {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', timezoneId: 'Asia/Manila' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'unpkg.com') {
        if (mode === 'no-map') return route.abort();
        return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: url.pathname.endsWith('.css') ? mapCSS : mapJS });
      }
      if (url.hostname === 'tiles.openfreemap.org') {
        if (liveMap) return route.continue();
        return route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf1f2' } }] } });
      }
      if (url.origin !== origin) return route.abort();
      if (mode === 'no-data' && url.pathname.endsWith('qcity-bus.json')) return route.fulfill({ status: 503, json: {} });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: url.pathname.endsWith('/bootstrap') ? { authenticated: true, routing: 'dashboard' } : url.pathname.endsWith('/dashboard') ? dashboard : { status: 'OK', data: [] } });
      return route.continue();
    });
    return context;
  }
  for (const viewport of [{ width: 320, height: 480 }, { width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
    const context = await contextFor(viewport);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/campus-eta.html');
    await page.waitForFunction(() => typeof map !== 'undefined' && map?.getLayer('route4-line') && !document.querySelector('[data-loading-region]'));
    await page.waitForFunction(() => map.loaded());
    if (liveMap) {
      assert(await page.evaluate(() => Object.keys(map.getStyle().sources).length > 1), 'OpenFreeMap basemap sources loaded');
      assert.match(await page.locator('.maplibregl-ctrl-attrib').innerText(), /OpenStreetMap/);
      const basemap = await page.evaluate(() => ({
        background: map.getPaintProperty('background', 'background-color'),
        water: map.getPaintProperty('water', 'fill-color'),
        road: map.getPaintProperty('road_trunk_primary', 'line-color'),
        roadCasing: map.getPaintProperty('road_trunk_primary_casing', 'line-color'),
        shieldsHidden: map.getStyle().layers.filter(layer => /shield/.test(layer.id)).every(layer => layer.layout.visibility === 'none'),
        placeLabels: map.getStyle().layers.some(layer => layer['source-layer'] === 'place' && layer.layout?.visibility !== 'none')
      }));
      assert.equal(basemap.background, '#F4F6F7');
      assert.equal(basemap.water, '#DAE4EB');
      assert.equal(basemap.road, '#FFFFFF');
      assert.equal(basemap.roadCasing, '#DCE2E6');
      assert(basemap.shieldsHidden && basemap.placeLabels, 'Muted map retains geographic labels without highway shield clutter');
    }
    const geometry = await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const marker = routeMarkers.find(item => item.priority === 3);
      const dot = marker.element.querySelector('.route-marker-dot').getBoundingClientRect();
      const projected = map.project(marker.coords);
      return {
        map: box('#eta-map'), header: box('#app-header'), title: box('.bus-map-heading'), card: box('.bus-trip-card'), nav: box('#bottom-nav'),
        controls: [...document.querySelectorAll('.bus-map-controls button, .maplibregl-ctrl-group button')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }),
        gradient: map.getPaintProperty('route4-line', 'line-gradient'), metrics: map.getSource('route4').serialize().lineMetrics,
        markers: routeMarkers.length, dotError: Math.hypot(dot.left + dot.width / 2 - projected.x, dot.top + dot.height / 2 - projected.y),
        ring: getComputedStyle(document.getElementById('home-avatar')).backgroundImage,
        compact: document.querySelectorAll('.route-marker.is-compact').length,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    });
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    assert.equal(geometry.map.height, viewport.height, 'Full viewport map');
    assert.equal(geometry.map.top, 0);
    assert(!geometry.overflow);
    assert(!overlap(geometry.card, geometry.nav), 'Trip card clears navigation');
    assert(!overlap(geometry.card, geometry.header), 'Trip card clears header');
    assert(!overlap(geometry.card, geometry.title), 'Trip card clears route title');
    assert(geometry.controls.every(control => !overlap(control, geometry.card) && !overlap(control, geometry.title)), `Map controls clear card and title: ${JSON.stringify(geometry)}`);
    assert.equal(geometry.metrics, true);
    assert(geometry.gradient.includes('#EF655B') && geometry.gradient.includes('#159C73') && geometry.gradient.includes('#2474E8'));
    assert.equal(geometry.markers, busData.route.stops.filter(stop => Array.isArray(stop.coords)).length, 'Verified stops only, no duplicate campus/termini');
    assert(geometry.dotError < 1, 'Blue dot exactly anchors the coordinate');
    assert.equal(geometry.ring, 'none', 'Unconnected header avatar has no verified ring');
    assert.equal(await page.locator('#home-avatar').getAttribute('href'), 'settings.html');
    const compact = viewport.width < 900 || viewport.height <= 540;
    assert.equal(await page.locator('#bus-toggle-trip').getAttribute('aria-expanded'), String(!compact), 'Collapsed by default on mobile and short screens');
    assert.match(await page.locator('#bus-trip-summary-distance').innerText(), /12.9 km/);
    assert.equal(geometry.controls.length, 4);
    assert(geometry.controls.every(control => control.left === geometry.controls[0].left && control.right <= viewport.width && control.top >= geometry.header.bottom && control.bottom <= viewport.height && !overlap(control, geometry.nav)), 'Four controls stack vertically within the usable viewport');
    if (compact) {
      if (viewport.width < viewport.height) assert(geometry.card.height < viewport.height * .4, 'Collapsed summary leaves the map visible');
      assert(await page.locator('#bus-trip-content').isHidden());
      await page.locator('#bus-toggle-trip').click();
    }
    assert.match(await page.locator('#bus-trip-distance').innerText(), /12.9.*km/);
    assert.match(await page.locator('.bus-trip-content').innerText(), /Travel time\s+Not published/);
    const expanded = await page.evaluate(() => {
      const card = document.querySelector('.bus-trip-card').getBoundingClientRect();
      const controls = document.querySelector('.bus-map-controls').getBoundingClientRect();
      const heading = document.querySelector('.bus-map-heading').getBoundingClientRect();
      return { card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom }, controls: { left: controls.left, right: controls.right, top: controls.top, bottom: controls.bottom }, heading: { left: heading.left, right: heading.right, top: heading.top, bottom: heading.bottom } };
    });
    assert(!overlap(expanded.card, expanded.controls) && !overlap(expanded.card, expanded.heading), 'Expanded details clear controls and title');
    assert(!overlap(expanded.card, geometry.header) && !overlap(expanded.card, geometry.nav), 'Expanded details clear app navigation');
    await page.locator('.bus-trip-endpoints').evaluate(el => el.scrollIntoView({ block: 'end' }));
    assert(await page.locator('.bus-trip-endpoints').isVisible(), 'Full route endpoints remain reachable in expanded details');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: resolve(output, `expanded-${viewport.width}x${viewport.height}.png`) });
    await page.locator('#bus-toggle-trip').click();
    assert(await page.locator('#bus-trip-content').isHidden());
    await page.locator('#bus-zoom-in').click();
    const zoomedIn = await page.evaluate(() => map.getZoom());
    await page.locator('#bus-zoom-out').click();
    assert((await page.evaluate(() => map.getZoom())) < zoomedIn, 'Custom zoom buttons work');
    await page.locator('#bus-open-details').click();
    await page.mouse.move(0, 0);
    assert(await page.locator('#bus-details').evaluate(el => el.open && el.contains(document.activeElement)));
    assert.equal(await page.locator('#bus-details-title').innerText(), 'Route 4 Stops');
    assert.equal(await page.locator('#bus-stop-list [aria-current="true"]').count(), 1);
    assert.equal(await page.locator('#bus-stop-list .bus-stop-node').count(), busData.route.stops.length);
    assert(await page.locator('#bus-details').evaluate(el => el.scrollWidth <= el.clientWidth), 'Timeline fits dialog width');
    const scrolling = await page.locator('.bus-details-scroll').evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
    assert(scrolling.content > scrolling.height, 'Timeline scrolls within a fixed header and footer');
    await page.screenshot({ path: resolve(output, `timeline-${viewport.width}x${viewport.height}.png`) });
    await page.locator('#bus-tab-sunday').click();
    assert.match(await page.locator('#bus-sched-body').innerText(), /8:00 AM/);
    assert.match(await page.locator('#bus-timeline-status').innerText(), /Sunday.*Published schedule/);
    assert.equal(await page.locator('#bus-stop-list li').count(), 15);
    assert.equal(await page.locator('#bus-stop-list [data-stop-index="3"]').count(), 0, 'Unverified location is not actionable');
    await page.locator('#bus-stop-list li').last().scrollIntoViewIfNeeded();
    assert.match(await page.locator('#bus-stop-list li').last().innerText(), /Gen\. Luis cor\. SB Road/);
    await page.keyboard.press('Escape');
    assert(await page.locator('#bus-open-details').evaluate(el => el === document.activeElement));
    await page.locator('#bus-open-details').click();
    await page.locator('#bus-close-details').focus();
    await page.keyboard.press('Shift+Tab');
    assert(await page.locator('#bus-return-map').evaluate(el => el === document.activeElement), 'Modal traps keyboard focus');
    await page.keyboard.press('Enter');
    assert(await page.locator('#bus-open-details').evaluate(el => el === document.activeElement), 'Footer action restores focus');
    await page.locator('#bus-find-campus').click();
    await page.waitForFunction(() => map.getZoom() === 15);
    await page.locator('#bus-open-details').click();
    assert.equal(await page.locator('#bus-stop-list [aria-current="true"]').getAttribute('data-timeline-index'), '9', 'Campus action selects stop 10');
    await page.locator('#bus-stop-list [data-stop-index="1"]').click();
    assert(!(await page.locator('#bus-details').evaluate(el => el.open)), 'Stop selection returns to map');
    assert.equal(await page.locator('#bus-stop-list [aria-current="true"]').getAttribute('data-timeline-index'), '1');
    await page.locator('#bus-fit-route').click();
    await page.waitForFunction(() => map.getZoom() < 15);
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('button', { name: /Stop 10: QCU Main Campus/ }).count(), 1, 'Campus marker keeps its descriptive accessible name');
    await page.screenshot({ path: resolve(output, `route-${viewport.width}x${viewport.height}.png`) });
    if (viewport.width === 390) {
      await page.locator('#home-avatar').click();
      await page.waitForURL('**/settings.html');
      await page.locator('#profile-name').waitFor();
      assert.match(await page.locator('#profile-name').innerText(), /Alexandra Reyes/);
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS actual MapLibre gradient, anchored markers, card/controls, schedule dialog and QC profile at ${viewport.width}x${viewport.height}`);
  }
  for (const mode of ['no-map', 'no-data']) {
    const context = await contextFor({ width: 390, height: 844 }, mode);
    const page = await context.newPage();
    await page.goto(origin + '/campus-eta.html');
    await page.waitForFunction(() => !document.getElementById('bus-trip-content').hasAttribute('aria-busy'));
    assert.equal(await page.locator('.bus-trip-skeleton').count(), 0);
    await page.locator('#bus-open-details').click();
    if (mode === 'no-map') {
      assert.match(await page.locator('.map-unavailable').innerText(), /Map unavailable/);
      assert(await page.locator('#bus-find-campus').isDisabled());
      assert.match(await page.locator('#bus-sched-body').innerText(), /AM/);
    } else {
      assert.match(await page.locator('#bus-trip-summary-distance').innerText(), /unavailable/);
      assert.match(await page.locator('#bus-stop-list').innerText(), /unavailable/);
      assert.match(await page.locator('#bus-sched-body').innerText(), /unavailable/i);
    }
    await context.close();
    console.log('PASS ' + mode + ' recovery without invented route facts');
  }
  console.log('Screenshots: ' + output);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
