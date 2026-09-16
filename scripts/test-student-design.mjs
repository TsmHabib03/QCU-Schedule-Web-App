// Local UI fixtures: no real accounts, API writes, or external services.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(tmpdir(), 'qcu-student-design');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return response.writeHead(403).end();
  try { response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const entry = (id, day, title, start, end, code) => ({ entryId: id, day, title, start, end, code, buildingCode: 'IL', buildingName: 'New Academic Building', floor: 5, roomCode: 'IL502A', units: 3, originType: 'COR_IMPORT' });
const entries = [
  entry('class-1', 'Monday', 'Fundamentals of Programming', '08:00', '10:00', 'CC102'),
  entry('class-2', 'Monday', 'Mathematics in the Modern World', '11:00', '13:00', 'MATH 1'),
  entry('class-3', 'Wednesday', 'Introduction to Human-Computer Interaction and Information Systems', '13:00', '16:00', 'HCI101'),
  entry('class-4', 'Friday', 'Physical Fitness and Wellness', '09:00', '11:00', 'PE 1')
];
const dashboard = { status: 'OK', profile: { name: 'Alexandra Reyes' }, academic: { program: { abbrev: 'BSIT' }, campus: { shortName: 'San Bartolome' } }, entries, buildings: [], tasks: [], notes: [] };
let mode = 'populated';
function reply(path) {
  if (path.endsWith('/bootstrap')) return { authenticated: true, routing: 'dashboard' };
  if (path.endsWith('/dashboard')) return { ...dashboard, entries: mode === 'empty' ? [] : entries };
  if (path.endsWith('/session')) return { status: 'OK', user: { userId: 'fixture', name: 'Alexandra Reyes' } };
  if (path.endsWith('/google/status')) return { connected: false, status: 'not_connected' };
  return { status: 'OK', data: [] };
}
let browser;
const failures = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'Asia/Manila' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith('/api/')) {
        if (mode === 'error' && url.pathname.endsWith('/dashboard')) return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
        return route.fulfill({ json: reply(url.pathname) });
      }
      return route.continue();
    });
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-09-14T00:30:00Z') });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const name of ['index', 'schedule', 'today', 'workspace', 'settings', 'google', 'buildings', 'campus-eta']) {
      mode = 'populated';
      await page.goto(`${origin}/${name}.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => !document.querySelector('[data-loading-region], [data-loading-cover]'));
      if (name === 'index') await page.locator('#auth-dashboard').waitFor({ state: 'visible' });
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const nav = document.getElementById('bottom-nav').getBoundingClientRect();
        const main = document.getElementById('main-content').getBoundingClientRect();
        const clipped = [...document.querySelectorAll('#main-content a, #main-content button, #main-content h1, #main-content td')]
          .filter(el => el.checkVisibility()).filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; })
          .map(el => el.tagName + ':' + el.textContent.trim().slice(0, 60));
        const firstNav = document.querySelector('#bottom-nav a').getBoundingClientRect();
        const navEl = document.getElementById('bottom-nav');
        const navStrip = navEl.firstElementChild;
        const mainStyle = getComputedStyle(document.getElementById('main-content'));
        return { overflow: document.documentElement.scrollWidth > innerWidth, clipped, navTop: nav.top, navBottom: nav.bottom, mainTop: main.top, firstNavLeft: firstNav.left, mainLeft: main.left + parseFloat(mainStyle.paddingLeft), navPos: getComputedStyle(navEl).position, navFlex: getComputedStyle(navStrip).flexDirection, navPadLeft: parseFloat(getComputedStyle(navStrip).paddingLeft), mainPadLeft: parseFloat(mainStyle.paddingLeft), navHeight: navEl.getBoundingClientRect().height };
      });
      if (geometry.overflow || geometry.clipped.length) failures.push(`${name} at ${width}: ${JSON.stringify(geometry)}`);
      assert(width >= 1024 ? geometry.navBottom <= geometry.mainTop : geometry.navTop >= 900, `${name}: navigation placement at ${width}`);
      if (width >= 1024) {
        // Desktop nav is a top app bar: in flow above <main>, tabs in a row, and
        // horizontally aligned to the page container's padding.
        assert.equal(geometry.navPos, 'sticky', `${name}: desktop nav is a top app bar at ${width}`);
        assert.equal(geometry.navFlex, 'row', `${name}: desktop nav tabs sit in a row at ${width}`);
        assert(geometry.navHeight >= 50, `${name}: desktop nav height at ${width} (${geometry.navHeight})`);
        assert.equal(geometry.navPadLeft, geometry.mainPadLeft, `${name}: desktop nav shares the content padding at ${width}`);
      }
      if ([390, 1440].includes(width)) await page.screenshot({ path: resolve(output, `${name}-${width}.png`), fullPage: true });
      if (name === 'index') {
        // Today Task line-up: vertical, full-width boxes, live timing.
        // Fixture clock is Mon 14 Sep 08:30 PHT → class-1 (08:00–10:00) is in
        // session and class-2 (11:00–13:00) is next.
        const today = await page.evaluate(() => {
          const grid = document.getElementById('today-grid');
          const kids = [...grid.children];
          const feature = grid.querySelector('.home-today-card--feature');
          const bar = grid.querySelector('.home-today-card--feature .home-today-progress span');
          const cs = getComputedStyle(grid);
          return {
            dir: cs.flexDirection,
            width: Math.round(grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
            first: kids[0]?.className || '',
            featureBg: feature ? getComputedStyle(feature).backgroundColor : null,
            featureWidth: feature ? Math.round(feature.getBoundingClientRect().width) : 0,
            progress: bar ? bar.style.width : null,
            rows: kids.map(el => ({ cls: el.className, w: Math.round(el.getBoundingClientRect().width), text: el.innerText.replace(/\n/g, ' | ') }))
          };
        });
        const text = today.rows.map(r => r.text).join(' || ');
        assert.equal(today.dir, 'column', 'Today Task stacks vertically');
        assert.match(today.first, /home-today-now/, 'Today Task starts with the Now marker');
        assert(today.rows.every(r => Math.abs(r.w - today.width) < 2), `Today Task boxes span the column: ${JSON.stringify(today.rows)}`);
        assert.equal(today.featureWidth, today.width, 'In-session box fills the column');
        assert.equal(today.featureBg, 'rgb(74, 58, 255)', 'In-session box is the purple feature card');
        assert.match(text, /8:00 AM[\s\S]*10:00 AM/, `Start/end times render: ${text}`);
        assert.match(text, /1h 30m left · ends 10:00 AM/, `Live time left renders: ${text}`);
        assert.match(today.progress || '', /%$/, 'In-session box shows a progress bar');
        assert.match(text, /Free for 1h/, `Break row renders between classes: ${text}`);
        assert.match(text, /UP NEXT[\s\S]*Starts in 2h 30m · 2h long/, `Next class renders its countdown: ${text}`);

        // Day modal (weekly table): hours must add up, and a day whose classes
        // lost their time must explain the dash instead of showing "Hours 0".
        await page.evaluate(() => openDayModal('Monday'));
        const modal = await page.locator('#day-modal-content').innerText();
        assert.match(modal, /Fundamentals of Programming/, `Modal lists the class: ${modal}`);
        assert.match(modal, /HOURS[\s\S]*4\b/, `Hours add up to 4: ${modal}`);
        await page.locator('#day-modal [data-close-modal]').click();
        await page.evaluate(() => {
          window.__savedSchedule = state.schedule;
          state.schedule = [{ day: 'Monday', start: '', end: '', subject: 'NSTP 1', course: 'NSTP 1', room: 'SB OG', floor: '—', units: 3, entryId: 'no-time', originType: 'COR_IMPORT' }];
          openDayModal('Monday');
        });
        const timelessModal = await page.locator('#day-modal-content').innerText();
        assert.match(timelessModal, /HOURS[\s\S]*—/, `Hours shows a dash when no time is saved: ${timelessModal}`);
        assert.match(timelessModal, /Time not set/, `Timeless class says so: ${timelessModal}`);
        assert.match(timelessModal, /no time saved yet/, `Modal explains the missing time: ${timelessModal}`);
        await page.locator('#day-modal [data-close-modal]').click();
        await page.evaluate(() => { state.schedule = window.__savedSchedule; renderHome(); });
      }
      if (name === 'schedule') {
        assert.equal(await page.locator('#schedule-result').textContent(), '4 classes this week');
        await page.getByRole('button', { name: 'Monday', exact: true }).click();
        assert.equal(await page.locator('#schedule-result').textContent(), '2 classes on Monday');
        assert.equal(await page.locator('#schedule-rows tr[data-entry-id]').count(), 2);
        assert.equal(await page.locator('.break-row').count(), 1);
        await page.getByRole('button', { name: 'Tuesday', exact: true }).click();
        assert.equal(await page.locator('.schedule-state strong').textContent(), 'No classes on Tuesday');
        assert.equal(await page.getByRole('button', { name: 'Tuesday', exact: true }).getAttribute('aria-pressed'), 'true');
        await page.getByRole('button', { name: 'Full week', exact: true }).click();
        await page.getByRole('button', { name: 'Add class', exact: true }).click();
        assert(await page.getByRole('dialog', { name: 'Schedule entry form' }).isVisible());
        assert(await page.locator('#crud-subject').evaluate(el => el === document.activeElement));
        await page.getByRole('button', { name: 'Close', exact: true }).focus();
        await page.keyboard.press('Shift+Tab');
        assert(await page.locator('#crud-save-btn').evaluate(el => el === document.activeElement), 'Focus stays inside the class form');
        await page.keyboard.press('Tab');
        assert(await page.getByRole('button', { name: 'Close', exact: true }).evaluate(el => el === document.activeElement));
        if ([390, 1440].includes(width)) await page.screenshot({ path: resolve(output, `class-form-${width}.png`) });
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Schedule entry form' }).waitFor({ state: 'hidden' });
        assert.equal(await page.getByRole('dialog', { name: 'Schedule entry form' }).isVisible(), false);
        assert(await page.getByRole('button', { name: 'Add class', exact: true }).evaluate(el => el === document.activeElement));
        const edit = page.locator('#schedule-rows tr[data-entry-id="class-1"] button');
        await edit.focus();
        await page.clock.runFor(1100);
        assert(await edit.evaluate(el => el === document.activeElement), 'Schedule refresh must preserve keyboard focus');
        assert.equal(await edit.locator('svg').count(), 1, 'Edit icon remains rendered after refresh');
      }
      if (name === 'today') {
        assert.match(await page.locator('#today-date').textContent(), /Monday, September 14/);
        assert.equal(await page.locator('#today-cards article').count(), 2);
        await page.locator('#today-cards [data-entry-id="class-1"] button').click();
        assert(await page.getByRole('dialog', { name: 'Schedule entry form' }).isVisible());
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      }
      if (name === 'workspace') {
        await page.getByRole('tab', { name: 'Notes', exact: true }).click();
        assert(await page.locator('#workspace-notes-panel').isVisible());
        assert.equal(await page.getByRole('tab', { name: 'Notes', exact: true }).getAttribute('aria-selected'), 'true');
      }
    }
    assert.deepEqual(errors, [], `Runtime errors at ${width}`);
    await context.close();
    console.log(`PASS student interactions and navigation at ${width}px`);
  }
  // Today Task line-up: a finished day collapses to compact rows + a closing row,
  // and a day with no classes shows the soft empty tile (never a blank column).
  {
    const finishedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Manila' });
    await finishedContext.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, json: reply(url.pathname) });
      return route.continue();
    });
    const finishedPage = await finishedContext.newPage();
    // Mon 14 Sep 14:30 PHT — both Monday fixtures already ended.
    await finishedPage.clock.install({ time: new Date('2026-09-14T06:30:00Z') });
    await finishedPage.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await finishedPage.locator('#auth-dashboard').waitFor({ state: 'visible' });
    await finishedPage.waitForFunction(() => !document.querySelector('[data-loading-region], [data-loading-cover]'));
    const finished = await finishedPage.evaluate(() => {
      const grid = document.getElementById('today-grid');
      const cs = getComputedStyle(grid);
      const width = Math.round(grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
      return { width, kids: [...grid.children].map(el => ({ cls: el.className, w: Math.round(el.getBoundingClientRect().width), text: el.innerText.replace(/\n/g, ' | ') })) };
    });
    assert.equal(finished.kids.length, 3, `Finished day = 2 done rows + closing row: ${JSON.stringify(finished.kids)}`);
    assert(finished.kids.slice(0, 2).every(k => /home-today-done-row/.test(k.cls) && Math.abs(k.w - finished.width) < 2), `Done rows span the column: ${JSON.stringify(finished.kids)}`);
    assert.match(finished.kids[0].text, /Fundamentals of Programming \| 8:00 AM – 10:00 AM \| 2h/, `Done row keeps subject, time and duration: ${finished.kids[0].text}`);
    assert.match(finished.kids[2].cls, /home-today-all-done/, 'A finished day closes with the all-done row');
    assert.equal(await finishedPage.locator('#today-grid .home-today-card--feature').count(), 0, 'No feature box once every class ended');

    mode = 'empty';
    await finishedPage.reload({ waitUntil: 'load' });
    await finishedPage.locator('#auth-dashboard').waitFor({ state: 'visible' });
    await finishedPage.waitForFunction(() => !document.querySelector('[data-loading-region], [data-loading-cover]'));
    const emptyText = await finishedPage.locator('#today-grid').innerText();
    assert.match(emptyText, /No classes today/, `No-class day shows the empty tile: ${emptyText}`);
    mode = 'populated';
    await finishedContext.close();
    console.log('PASS today line-up: finished rows, all-done row, and empty day');
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: mode === 'error' ? 503 : 200, json: mode === 'error' ? { error: 'Temporarily unavailable' } : reply(url.pathname) });
    return route.continue();
  });
  const page = await context.newPage();
  for (const name of ['schedule', 'today']) {
    for (const state of ['empty', 'error']) {
      mode = state;
      await page.goto(`${origin}/${name}.html`);
      await page.waitForFunction(() => !document.querySelector('[data-loading-region]'));
      const content = await page.locator(name === 'schedule' ? '#schedule-rows' : '#today-cards').innerText();
      assert.match(content, state === 'error' ? /could not be loaded/i : /empty|No classes scheduled/);
      if (state === 'error') assert.equal(await page.getByRole('button', { name: 'Try again', exact: true }).count(), 1);
    }
  }
  await context.close();
  assert.deepEqual(failures, [], 'Responsive overflow');
  console.log('PASS populated, empty, and unavailable states; no clipped content');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
