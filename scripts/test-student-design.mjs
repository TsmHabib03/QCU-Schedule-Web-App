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
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return response.writeHead(403).end();
  try { const bytes = await readFile(file); response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(bytes); }
  catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const entry = (id, day, title, start, end, code) => ({ entryId: id, enrollmentSubjectId: 'subject-' + id, day, title, start, end, code, buildingCode: 'IL', buildingName: 'New Academic Building', floor: 5, roomCode: 'IL502A', units: 3, originType: 'COR_IMPORT' });
const entries = [
  entry('class-1', 'Monday', 'Fundamentals of Programming', '08:00', '10:00', 'CC102'),
  entry('class-2', 'Monday', 'Mathematics in the Modern World', '11:00', '13:00', 'MATH 1'),
  entry('class-3', 'Wednesday', 'Introduction to Human-Computer Interaction and Information Systems', '13:00', '16:00', 'HCI101'),
  entry('class-4', 'Friday', 'Physical Fitness and Wellness', '09:00', '11:00', 'PE 1')
];
const dashboard = { status: 'OK', profile: { name: 'Alexandra Reyes', googleAccount: { name: 'Alexandra Google', email: 'alexandra@qcu.edu.ph', picture: '', emailVerified: true } }, academic: { program: { abbrev: 'BSIT' }, campus: { shortName: 'San Bartolome' } }, entries, buildings: [], tasks: [], notes: [] };
let mode = 'populated';
function reply(path) {
  if (path.endsWith('/bootstrap')) return { authenticated: true, routing: 'dashboard' };
  if (path.endsWith('/dashboard')) return mode === 'signedout' ? { status: 'UNAUTHENTICATED', authenticated: false } : { ...dashboard, entries: mode === 'empty' ? [] : entries };
  if (path.endsWith('/session')) return { status: 'OK', user: { userId: 'fixture', name: 'Alexandra Reyes' } };
  if (path.endsWith('/google/status')) return { connected: false, status: 'not_connected' };
  return { status: 'OK', data: [] };
}
let browser;
const failures = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 375, 390, 600, 768, 1023, 1024, 1440]) {
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
    for (const name of ['index', 'schedule', 'workspace', 'settings', 'buildings', 'campus-eta']) {
      mode = 'populated';
      await page.goto(`${origin}/${name}.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => !document.querySelector('[data-loading-region], [data-loading-cover]'));
      if (name === 'index') await page.locator('#auth-dashboard').waitFor({ state: 'visible' });
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const nav = document.getElementById('bottom-nav').getBoundingClientRect();
        const main = document.getElementById('main-content').getBoundingClientRect();
        const clipped = [...document.querySelectorAll('#main-content a, #main-content button, #main-content h1, #main-content td')]
          .filter(el => el.checkVisibility() && !el.closest('.home-date-strip, .schedule-days, .study-categories')).filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; })
          .map(el => el.tagName + ':' + el.textContent.trim().slice(0, 60));
        const firstNav = document.querySelector('#bottom-nav a').getBoundingClientRect();
        const navEl = document.getElementById('bottom-nav');
        const navStrip = navEl.firstElementChild;
        const navRect = navEl.getBoundingClientRect();
        const firstTab = navEl.querySelector('.nav-item');
        const add = navEl.querySelector('.nav-add').getBoundingClientRect();
        const tabs = [...navEl.querySelectorAll('.nav-item')].map(el => {
          const r = el.getBoundingClientRect(), label = el.querySelector('.nav-label');
          return { key: el.dataset.navPage, active: el.classList.contains('active'), left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, labelWidth: label.getBoundingClientRect().width, labelClipped: label.scrollWidth > label.clientWidth + 1, labelOpacity: getComputedStyle(label).opacity, current: el.getAttribute('aria-current') };
        });
        const mainStyle = getComputedStyle(document.getElementById('main-content'));
        return { overflow: document.documentElement.scrollWidth > innerWidth, clipped, navTop: nav.top, navBottom: nav.bottom, navPos: getComputedStyle(navEl).position, navHeight: navRect.height, clientWidth: document.documentElement.clientWidth, viewportHeight: innerHeight, navLeft: navRect.left, navRight: navRect.right, navRadius: parseFloat(getComputedStyle(navEl).borderRadius), tabDir: getComputedStyle(firstTab).flexDirection, bg: getComputedStyle(navEl).backgroundColor, tabs, add: { left: add.left, right: add.right, top: add.top, bottom: add.bottom, width: add.width, height: add.height } };
      });
      if (geometry.overflow || geometry.clipped.length) failures.push(`${name} at ${width}: ${JSON.stringify(geometry)}`);
      assert.equal(geometry.navPos, 'fixed', `${name}: fixed floating navigation at ${width}`);
      assert(geometry.navTop >= 900 && geometry.viewportHeight - geometry.navBottom >= 12, `${name}: bottom inset at ${width}`);
      assert(geometry.navLeft >= 12 && geometry.navRight <= geometry.clientWidth - 12, `${name}: screen-edge clearance at ${width}`);
      assert(geometry.navRadius >= geometry.navHeight / 2, `${name}: pill rounding at ${width}`);
      assert.equal(geometry.tabDir, 'row');
      assert.equal(geometry.bg, 'rgb(68, 53, 238)');
      assert.equal(geometry.tabs.filter(tab => tab.active).length, 1);
      const activeTab = geometry.tabs.find(tab => tab.active);
      const expectedKey = { index: 'home', schedule: 'schedule', workspace: 'workspace', 'campus-eta': 'campus-eta' }[name] || 'settings';
      assert.equal(geometry.tabs.length, 5, 'All five destinations remain in the navigation');
      assert.equal(await page.getByRole('link', { name: 'QC Bus', exact: true }).getAttribute('href'), 'campus-eta.html');
      assert.equal(activeTab.key, expectedKey, `${name}: correct destination is active`);
      assert.equal(activeTab.current, 'page');
      assert(!activeTab.labelClipped, `${name}: active label is fully readable at ${width} (${JSON.stringify(activeTab)})`);
      for (const tab of geometry.tabs) {
        assert(tab.left >= geometry.navLeft && tab.right <= geometry.navRight && tab.width >= (width < 359 ? 34 : 44) && tab.height >= 44, `${name}: tab containment and touch target at ${width}`);
        assert(tab.active ? tab.labelWidth > 20 && tab.labelOpacity === '1' : tab.labelWidth === 0 && tab.labelOpacity === '0', `${name}: only active label is visible`);
        if (!tab.active) assert(activeTab.width > tab.width, `${name}: active tab expands`);
      }
      assert(geometry.add.left >= Math.max(...geometry.tabs.map(tab => tab.right)) && geometry.add.right <= geometry.navRight, `${name}: action inside far right`);
      assert.equal(geometry.add.width, geometry.add.height);
      assert(geometry.add.width >= 44 && geometry.add.top >= geometry.navTop && geometry.add.bottom <= geometry.navBottom);
      assert.equal(await page.locator('#bottom-nav [aria-label="Add a class"]').count(), 0);
      if (name === 'workspace') {
        assert.equal(await page.locator('#main-content .fab').count(), 0, 'Workspace has no duplicate floating add button');
        assert.equal(await page.locator('#bottom-nav .nav-google').count(), 0);
        for (const kind of ['task', 'note']) {
          await page.locator(`[data-workspace-view="${kind}s"]`).click();
          const add = page.locator('#bottom-nav').getByRole('button', { name: `Add ${kind}`, exact: true });
          assert.equal(await add.getAttribute('aria-controls'), `${kind}-modal`);
          await add.click();
          const editor = page.locator(`#${kind}-modal.open`);
          await editor.waitFor();
          assert(await editor.evaluate(el => el.contains(document.activeElement)), 'Quick add focuses its form');
          assert(await editor.evaluate(el => Number(getComputedStyle(el).zIndex) > Number(getComputedStyle(document.getElementById('bottom-nav')).zIndex)), 'Editor overlays navigation');
          assert.equal(await page.locator(`#${kind === 'task' ? 'note' : 'task'}-modal.open, #crud-modal.open`).count(), 0, 'Only the selected form opens');
          await page.keyboard.press('Escape');
          assert(await add.evaluate(el => el === document.activeElement), 'Closing quick add returns focus to navbar');
        }
        await page.locator('[data-workspace-view="tasks"]').click();
        await page.locator('#bottom-nav .nav-add').evaluate(el => el.blur());
      } else {
        const google = page.locator('#bottom-nav').getByRole('link', { name: 'Google Classroom integration and updates', exact: true });
        assert.equal(await google.getAttribute('href'), 'settings.html#google-connection');
        assert.equal(await google.locator('svg path').count(), 4, 'Google shortcut shows the four-color logo');
        assert.equal(await google.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
        assert.equal(await page.locator('#bottom-nav button.nav-add').count(), 0);
      }
      if (name === 'schedule') {
        await page.locator('#schedule-add-btn').click();
        await page.locator('#crud-modal.open').waitFor();
        assert(await page.locator('#crud-subject').evaluate(el => el === document.activeElement));
        await page.keyboard.press('Shift+Tab');
        assert(await page.locator('#crud-modal').evaluate(el => el.contains(document.activeElement)), 'Class editor traps keyboard focus');
        await page.keyboard.press('Escape');
        assert(await page.locator('#schedule-add-btn').evaluate(el => el === document.activeElement), 'Closing class editor returns focus to its schedule control');
        await page.locator('#schedule-add-btn').evaluate(el => el.blur());
      }
      if ([320, 375, 390, 768, 1440].includes(width)) await page.screenshot({ path: resolve(output, `${name}-${width}.png`), fullPage: true });
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

        assert.equal(await page.locator('#home-greeting').textContent(), 'Good morning, Alexandra!');
        assert.equal(await page.locator('#home-summary').textContent(), 'You have 2 classes today');
        assert.equal(await page.locator('[role="tablist"][aria-label="Class schedule by day"]').count(), 1, 'One current-week date picker');
        assert.equal(await page.locator('#week-progress-grid, #home-week-strip').count(), 0, 'No redundant weekly calendars');
        assert.equal(await page.locator('#home-month-calendar button[data-date]').count(), 30, 'September has 30 selectable dates');
        assert.equal(await page.locator('#home-month-calendar [tabindex="0"]').count(), 1);
        assert.equal(await page.locator('#soft-calendar [role="tab"]').count(), 7);
        assert.equal(await page.locator('#soft-calendar [aria-selected="true"]').getAttribute('data-day-name'), 'Monday');
        assert.equal(await page.locator('#soft-calendar [tabindex="0"]').count(), 1, 'Date picker has one keyboard entry point');
        assert.equal(await page.locator('.home-today-professor').first().textContent(), 'Professor to be announced', 'Missing professor is explained');
        assert.equal(await page.locator('#auth-dashboard [data-lucide="menu"], #auth-dashboard input[type="search"]').count(), 0, 'No hamburger or task search widget');
        const dashboardStyle = await page.evaluate(() => ({
          font: getComputedStyle(document.getElementById('main-content')).fontFamily,
          supportWidth: document.querySelector('.home-support').getBoundingClientRect().width,
          panels: [...document.querySelectorAll('.home-support-panel')].map(el => el.getBoundingClientRect().width),
          connector: getComputedStyle(document.getElementById('today-grid'), '::before').content
        }));
        assert.match(dashboardStyle.font, /Public Sans/, 'Dashboard uses the local sans-serif font');
        assert.equal(dashboardStyle.connector, '""', 'Class timeline has a connector');
        if (width >= 1024) assert(dashboardStyle.panels.every(w => Math.abs(w - dashboardStyle.supportWidth) < 2), 'Desktop supporting panels fill their column');
        assert.equal(await page.locator('#app-header .header-right #home-avatar').count(), 1, 'Profile lives in the top-right header');
        assert.equal(await page.locator('.home-hero #home-avatar').count(), 0, 'Weather panel has no duplicate profile');
        const avatarGeometry = await page.locator('#home-avatar').evaluate(el => {
          const avatar = el.getBoundingClientRect();
          const header = document.getElementById('app-header').getBoundingClientRect();
          const brand = document.querySelector('#app-header .header-brand').getBoundingClientRect();
          return avatar.top >= header.top && avatar.bottom <= header.bottom && avatar.right <= header.right && avatar.left >= brand.right;
        });
        assert(avatarGeometry, 'Header avatar fits beside the brand at every viewport');
        assert.equal(await page.locator('#today-grid').getAttribute('aria-labelledby'), 'today-heading');
        const monday = page.locator('#soft-calendar [data-day-name="Monday"]').first();
        const wednesday = page.locator('#soft-calendar [data-day-name="Wednesday"]').first();
        const pickerHandle = await monday.elementHandle();
        await monday.focus();
        await page.keyboard.press('End');
        assert.equal(await page.locator('#soft-calendar [aria-selected="true"]').getAttribute('data-day-name'), 'Sunday');
        assert(await page.locator('#soft-calendar [data-day-name="Sunday"]').evaluate(el => {
          const box = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
          return el === document.activeElement && box.left >= parent.left && box.right <= parent.right;
        }), 'Keyboard selection scrolls the selected day into view');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#soft-calendar [aria-selected="true"]').getAttribute('data-day-name'), 'Monday', 'Arrow keys wrap at the week boundary');
        await page.keyboard.press('ArrowLeft');
        assert.equal(await page.locator('#soft-calendar [aria-selected="true"]').getAttribute('data-day-name'), 'Sunday');
        await page.keyboard.press('Home');
        await page.clock.runFor(60_000);
        assert(await pickerHandle.evaluate(el => el.isConnected && el === document.activeElement), 'Clock preserves the selected date button and its focus');
        await page.clock.setSystemTime(new Date('2026-09-14T00:30:00Z'));
        await page.evaluate(() => tick(true));
        await wednesday.click();
        assert.equal(await page.locator('#home-summary').textContent(), '1 class on Wednesday');
        assert.match(await page.locator('#today-grid').innerText(), /Human-Computer Interaction/);
        assert.equal(await page.locator('#today-grid .home-today-now, #today-grid .home-today-progress').count(), 0);
        assert.doesNotMatch(await page.locator('#today-grid').innerText(), /Starts in|left · ends/);
        assert.equal(await page.locator('#day-modal').evaluate(el => el.checkVisibility()), false, 'Day selection stays inline');
        await page.locator('#home-avatar').focus();
        const selectedHandle = await page.locator('#home-avatar').elementHandle();
        const futureCard = await page.locator('#today-grid .home-today-card').elementHandle();
        await page.evaluate(() => { window.__futureText = document.getElementById('today-grid').textContent; tick(); tick(); });
        assert(await selectedHandle.evaluate(el => el.isConnected && el === document.activeElement), 'Clock preserves focused profile');
        assert(await futureCard.evaluate(el => el.isConnected), 'Clock preserves future card');
        assert.equal(await page.locator('#today-grid').textContent(), await page.evaluate(() => window.__futureText), 'No countdown for a future weekday');
        await page.locator('#soft-calendar [data-day-name="Tuesday"]').first().click();
        assert.match(await page.locator('#today-grid').innerText(), /No classes on Tuesday/);
        await monday.click();
        assert.equal(await page.locator('#home-summary').textContent(), 'You have 2 classes today');

        await page.getByRole('button', { name: 'Next month', exact: true }).click();
        assert.equal(await page.locator('#home-month-label').textContent(), 'October 2026');
        assert.equal(await page.locator('#home-month-calendar button[data-date]').count(), 31);
        await page.locator('#home-month-calendar [data-date="2026-10-05"]').click();
        assert.match(await page.locator('#today-grid').innerText(), /Fundamentals of Programming/);
        assert.equal(await page.locator('#today-grid .current-tile, #today-grid .home-today-now, #today-grid .home-today-done-row').count(), 0, 'Future Monday is upcoming, even on Monday today');
        assert.equal(await page.locator('#calendar-label').textContent(), 'Oct 5 – Oct 11');
        await page.clock.runFor(1100);
        assert.doesNotMatch(await page.locator('#today-grid').innerText(), /left · ends|Starts in|Now/);
        await page.locator('#home-month-calendar [data-date="2026-10-05"]').focus();
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.locator('#home-month-calendar button:focus').getAttribute('data-date'), '2026-10-12');
        await page.keyboard.press('PageUp');
        assert.equal(await page.locator('#home-month-calendar button:focus').getAttribute('data-date'), '2026-09-12');
        await page.getByRole('button', { name: 'Today', exact: true }).click();
        assert.equal(await page.locator('#home-summary').textContent(), 'You have 2 classes today');
        assert.equal(await page.locator('#home-month-calendar [aria-current="date"]').getAttribute('data-date'), '2026-09-14');

        if (width === 375) {
          assert.equal(await page.locator('#home-avatar').innerText(), 'AR');
          assert.equal(await page.locator('#home-avatar').getAttribute('href'), 'settings.html');
          await page.route('https://avatar.example/**', route => route.fulfill({ status: 200, contentType: 'image/png', path: resolve(root, 'assets/images/cropped-logo.jpg') }));
          await page.evaluate(() => { state.profile.picture = 'https://avatar.example/photo.png'; renderHome(); });
          await page.waitForFunction(() => document.querySelector('#home-avatar img')?.naturalWidth > 0);
          assert.match(await page.locator('#home-avatar img').getAttribute('alt'), /Alexandra Reyes/);
          assert.equal(await page.locator('#home-avatar img').getAttribute('loading'), 'lazy');
          const avatarHandle = await page.locator('#home-avatar img').elementHandle();
          await page.locator('#home-avatar').focus();
          const liveCard = await page.locator('#today-grid .current-tile').elementHandle();
          await page.clock.runFor(60_000);
          assert.match(await page.locator('#today-grid .current-tile .home-today-live').innerText(), /1h 29m left/);
          assert(await liveCard.evaluate(el => el.isConnected), 'Countdown updates without rebuilding the card');
          assert(await page.locator('#home-avatar').evaluate(el => el === document.activeElement), 'Countdown preserves keyboard focus');
          await page.evaluate(() => renderHome());
          assert(await avatarHandle.evaluate(el => el.isConnected), 'Rendering preserves the loaded photo');
          await page.locator('#home-avatar img').evaluate(el => el.dispatchEvent(new Event('error')));
          assert.equal(await page.locator('#home-avatar').innerText(), 'AR', 'Broken image falls back to initials');
          await page.evaluate(() => { state.profile = {}; renderHome(); });
          assert.equal(await page.locator('#home-avatar svg').count(), 1, 'Missing name uses the generic user icon');
          await page.evaluate(() => {
            state.profile = { name: 'Alexandra Reyes' };
            window.__savedSchedule = state.schedule;
            state.schedule = [{ day: 'Monday', start: 'garbage', end: '', subject: '<Subject>', course: 'TBA', instructor: 'Professor <Reyes>', room: '', floor: '—' }];
            renderHome();
          });
          assert.match(await page.locator('#today-grid').innerText(), /Time not set/);
          assert.match(await page.locator('.home-today-professor').innerText(), /Professor <Reyes>/);
          assert.equal(await page.locator('#today-grid .home-today-now, #today-grid .home-today-progress, #today-grid .home-break-tile').count(), 0);
          assert.doesNotMatch(await page.locator('#today-grid').innerText(), /NaN|undefined|Inactive/);
          assert.equal(await page.locator('#today-grid subject, #today-grid reyes').count(), 0, 'Model strings are escaped');
          await page.evaluate(() => { state.schedule = window.__savedSchedule; renderHome(); });
          await page.clock.setSystemTime(new Date('2026-09-14T00:30:00Z'));
          await page.evaluate(() => tick(true));
        }

        // Day modal (weekly table): hours must add up, and a day whose classes
        // lost their time must explain the dash instead of showing "Hours 0".
        await page.evaluate(() => openDayModal('Monday'));
        const modal = await page.locator('#day-modal-content').innerText();
        assert.match(modal, /Fundamentals of Programming/, `Modal lists the class: ${modal}`);
        assert.match(modal, /HOURS[\s\S]*4\b/, `Hours add up to 4: ${modal}`);
        // The modal wears the Home dashboard theme: pastel stat tiles, floating
        // white rows with the line-up's radius, a pastel course pill.
        const modalStyle = await page.evaluate(() => {
          const card = document.querySelector('#day-modal-content');
          const stat = card.querySelector('.day-modal-stat');
          const row = card.querySelector('.day-modal-row');
          const pill = card.querySelector('.day-modal-course');
          return {
            cardRadius: getComputedStyle(card).borderRadius,
            statBg: getComputedStyle(stat).backgroundColor,
            statRadius: getComputedStyle(stat).borderRadius,
            rowRadius: getComputedStyle(row).borderRadius,
            rowBg: getComputedStyle(row).backgroundColor,
            pillRadius: getComputedStyle(pill).borderRadius,
            metaIcons: card.querySelectorAll('.day-modal-meta svg').length
          };
        });
        assert.equal(modalStyle.cardRadius, '28px', 'Day modal card uses the soft-UI radius');
        assert.equal(modalStyle.statRadius, '22px', 'Stat tiles are soft cards');
        assert.equal(modalStyle.statBg, 'rgb(224, 247, 246)', `Stat tile is pastel: ${modalStyle.statBg}`);
        assert.equal(modalStyle.rowBg, 'rgb(255, 255, 255)', 'Modal rows are white cards');
        assert.equal(modalStyle.rowRadius, '22px', 'Modal rows use the sub-card radius');
        assert.equal(modalStyle.pillRadius, '9999px', 'Course code is a pill');
        assert(modalStyle.metaIcons > 0, 'Modal rows carry the map-pin icon like the line-up');
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
      // The shell skeleton used to draw a Sign out pill in the header. The
      // control moved to Settings, so the placeholder had to go with it.
      const shellSkeleton = await page.evaluate(() => {
        const header = document.getElementById('app-header');
        return {
          headerButton: document.querySelectorAll('.loading-header-button, [class*="header-button"]').length,
          headerSkeletonButtons: header ? [...header.querySelectorAll('.loading-bar')].filter(el => /button/i.test(el.className)).length : 0,
        };
      });
      assert.equal(shellSkeleton.headerButton, 0, `${name}: no header button placeholder at ${width}`);
      assert.equal(shellSkeleton.headerSkeletonButtons, 0, `${name}: header skeleton draws no button at ${width}`);

      // Nav states must be identical on every page: no stray underline on the
      // active tab, and the active tab hovers like the others.
      const navStates = await page.evaluate(() => {
        const all = [...document.querySelectorAll('#bottom-nav .nav-item')];
        const tabs = all;
        const cs = el => { const s = getComputedStyle(el); return { color: s.color, shadow: s.boxShadow, bg: s.backgroundColor }; };
        return {
          anyActive: all.some(i => i.classList.contains('active')),
          activeTabs: tabs.filter(i => i.classList.contains('active')).map(cs),
        };
      });
      assert(navStates.anyActive, `${name}: a nav tab is active at ${width}`);
      for (const tab of navStates.activeTabs) {
        assert.equal(tab.shadow, 'none', `${name}: active tab has no underline at ${width} (${tab.shadow})`);
        assert.equal(tab.color, 'rgb(52, 36, 197)', `${name}: active tab is indigo at ${width}`);
        assert.equal(tab.bg, 'rgb(233, 229, 255)', `${name}: active tab has a pale pill at ${width}`);
      }

      if (name === 'schedule') {
        assert.equal(await page.locator('#schedule-result').textContent(), '4 classes this week');
        await page.getByRole('button', { name: 'Monday', exact: true }).click();
        assert.equal(await page.locator('#schedule-result').textContent(), '2 classes on Monday');
        assert.equal(await page.locator('#schedule-rows .timeline-slot[data-entry-id]').count(), 2);
        assert.equal(await page.locator('.break-row').count(), 1);

        // The same chronological cards on phones, tablets, and desktop.
        const tableLayout = await page.evaluate(() => {
          const de = document.documentElement;
          const row = document.querySelector('#schedule-rows .timeline-slot[data-entry-id]');
          const normal = row ? getComputedStyle(row) : null;
          const clipped = [];
          document.querySelectorAll('#schedule-rows .timeline-class, #schedule-rows .timeline-subject, #schedule-rows .timeline-detail, #schedule-rows .schedule-status').forEach(el => {
            if (el.scrollWidth - el.clientWidth > 1) clipped.push((el.className || el.tagName) + ':' + el.scrollWidth + '>' + el.clientWidth);
          });
          const edit = document.querySelector('#schedule-rows [data-action="edit-entry"]');
          return {
            rowDisplay: normal ? normal.display : null,
            rowRadius: row ? getComputedStyle(row.querySelector('.timeline-class')).borderRadius : null,
            editSize: edit ? Math.round(edit.getBoundingClientRect().width) : null,
            bodyOverflow: document.body.scrollWidth - de.clientWidth,
            clipped,
          };
        });
          assert.equal(tableLayout.rowDisplay, 'grid', `schedule: timeline at ${width}`);
          assert(parseFloat(tableLayout.rowRadius) >= 26, `schedule: rounded cards at ${width}`);
          assert(!tableLayout.clipped.length, `schedule: no clipped cells at ${width}: ${tableLayout.clipped.join(', ')}`);
          if (tableLayout.editSize !== null) {
            assert(tableLayout.editSize >= 40, `schedule: edit button is a 40px touch target at ${width} (${tableLayout.editSize})`);
          }
        assert.equal(await page.locator('table.schedule-table').count(), 0, 'No schedule table at any width');
        assert.equal(await page.locator('.timeline-class.is-highlighted').count(), 1, 'Current class receives a gradient accent');
        await page.getByRole('button', { name: 'Edit schedule', exact: true }).click();
        assert.equal(await page.locator('#schedule-title').innerText(), 'Edit Schedule');
        assert.equal(await page.locator('.timeline-class').count(), 2, 'Edit mode keeps the same cards');
        await page.getByRole('button', { name: 'Done editing', exact: true }).click();
        assert.equal(tableLayout.bodyOverflow, 0, `schedule: no horizontal overflow at ${width}`);
        await page.getByRole('button', { name: 'Tuesday', exact: true }).click();
        assert.equal(await page.locator('.schedule-state strong').textContent(), 'No classes on Tuesday');
        assert.equal(await page.getByRole('button', { name: 'Tuesday', exact: true }).getAttribute('aria-pressed'), 'true');
        await page.getByRole('button', { name: 'Full week', exact: true }).click();
        await page.getByRole('button', { name: 'Add class', exact: true }).click();
        assert(await page.locator('#crud-modal').isVisible());
        assert(await page.locator('#crud-subject').evaluate(el => el === document.activeElement));
        assert.equal(await page.getByLabel('Professor (optional)').getAttribute('maxlength'), '120');
        await page.getByRole('button', { name: 'Close', exact: true }).focus();
        await page.keyboard.press('Shift+Tab');
        assert(await page.locator('#crud-save-btn').evaluate(el => el === document.activeElement), 'Focus stays inside the class form');
        await page.keyboard.press('Tab');
        assert(await page.getByRole('button', { name: 'Close', exact: true }).evaluate(el => el === document.activeElement));
        if ([390, 1440].includes(width)) await page.screenshot({ path: resolve(output, `class-form-${width}.png`) });
        await page.keyboard.press('Escape');
        await page.locator('#crud-modal').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#crud-modal').isVisible(), false);
        assert(await page.getByRole('button', { name: 'Add class', exact: true }).evaluate(el => el === document.activeElement));
        const edit = page.locator('#schedule-rows button[data-entry-id="class-1"]');
        await edit.focus();
        await page.clock.runFor(1100);
        assert(await edit.evaluate(el => el === document.activeElement), 'Schedule refresh must preserve keyboard focus');
        assert(await edit.locator('svg').count() >= 2, 'Card icons remain rendered after refresh');
        if (width === 390) {
          const professor = 'Prof. Maria Reyes & Dr. Cruz';
          let saved;
          const apiEntries = () => entries.map(item => ({ ...item, dayOfWeek: item.day.toUpperCase(), startTime: item.start, endTime: item.end }));
          await page.route('**/api/v1/schedule/entries/class-1', async route => {
            assert.equal(route.request().method(), 'PATCH');
            saved = route.request().postDataJSON();
            entries[0].instructor = saved.instructorName;
            await route.fulfill({ json: { ok: true, data: apiEntries()[0] } });
          });
          await page.route('**/api/v1/schedule', route => route.fulfill({ json: { ok: true, data: { entries: apiEntries() } } }));
          await edit.click();
          assert.equal(await page.getByLabel('Professor (optional)').inputValue(), '', 'Edit prefill handles a missing professor');
          await page.getByLabel('Professor (optional)').fill(professor);
          await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
          await page.locator('#crud-modal').waitFor({ state: 'hidden' });
          await page.locator('#schedule-rows .schedule-professor').getByText(professor, { exact: true }).waitFor();
          assert.equal(saved.instructorName, professor, 'Class editor submits the professor');
          assert.equal(saved.enrollmentSubjectId, undefined, 'Professor-only edit preserves the subject');
          await page.screenshot({ path: resolve(output, 'schedule-professor-390.png'), fullPage: true });
          await edit.click();
          assert.equal(await page.getByLabel('Professor (optional)').inputValue(), professor, 'Saved professor is prefilled when reopening the class');
          await page.screenshot({ path: resolve(output, 'edit-professor-390.png') });
          await page.getByLabel('Professor (optional)').fill('');
          await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
          await page.locator('#crud-modal').waitFor({ state: 'hidden' });
          await page.waitForFunction(() => !document.querySelector('#schedule-rows .schedule-professor'));
          assert.equal(saved.instructorName, '', 'Clearing professor is sent explicitly');
          await page.screenshot({ path: resolve(output, 'schedule-professor-cleared-390.png'), fullPage: true });
          delete entries[0].instructor;
        }
      }
      if (name === 'workspace') {
        await page.getByRole('tab', { name: 'Notes', exact: true }).click();
        assert(await page.locator('#workspace-notes-panel').isVisible());
        assert.equal(await page.getByRole('tab', { name: 'Notes', exact: true }).getAttribute('aria-selected'), 'true');
        await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
        // Task cards must render a formatted deadline (raw ISO strings used to
        // leak through) and the pastel chip language of the Home dashboard.
        const card = await page.evaluate(() => {
          const list = document.getElementById('task-list');
          list.innerHTML = taskCardTemplate({ taskId: 'tsk_probe', title: 'test', priority: 'MEDIUM', dueDate: '2026-09-14T16:00:00.000Z', status: 'OPEN', createdAt: '2026-09-14T16:00:00.000Z' });
          if (window.lucide) window.lucide.createIcons();
          const el = list.querySelector('.task-card');
          const badge = el.querySelector('.priority-badge');
          const cs = getComputedStyle(el);
          return {
            text: el.innerText.replace(/\n/g, ' | '),
            hasIso: /\d{4}-\d{2}-\d{2}T/.test(el.textContent),
            accent: cs.borderLeftColor,
            badgeBg: getComputedStyle(badge).backgroundColor,
            badgeRadius: getComputedStyle(badge).borderRadius,
            radius: cs.borderRadius
          };
        });
        assert.equal(card.hasIso, false, `Task card must not show a raw ISO date: ${card.text}`);
        assert.match(card.text, /Sep 1[45]/, `Task card shows a formatted deadline: ${card.text}`);
        assert.equal(card.badgeRadius, '9999px', 'Priority is a pastel pill');
        assert.notEqual(card.accent, 'rgb(0, 0, 0)', `Priority accent colour: ${card.accent}`);
        assert.equal(card.radius, '24px', 'Task card uses the rounded planner radius');
        await page.evaluate(() => { document.getElementById('task-list').innerHTML = ''; });
      }
      if (name === 'settings') {
        const settings = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('.profile-row')];
          const so = document.getElementById('settings-signout');
          return {
            labels: rows.map(r => r.querySelector('.profile-row-title').textContent),
            signoutBg: so ? getComputedStyle(so.closest('.profile-group')).backgroundColor : null,
            signoutIcon: so ? getComputedStyle(so.querySelector('svg, i')).color : null,
            signoutClickable: typeof so?.onclick === 'function',
            removed: ['Class Notifications', 'Offline Mode', 'App Version', 'Reset All Preferences']
              .filter(t => document.body.innerText.includes(t))
          };
        });
        for (const label of ['General App Settings', 'Install this App', 'Notifications', 'Privacy Policy', 'Help/Support', 'Logout']) assert(settings.labels.includes(label));
        assert.equal(settings.signoutBg, 'rgb(255, 255, 255)', 'Sign out is the white closing card');
        assert.equal(settings.signoutIcon, 'rgb(209, 94, 114)', 'Logout icon is red tinted');
        assert(settings.signoutClickable, 'Sign out is wired to signOut()');
        assert.deepEqual(settings.removed, [], `Removed preferences stay removed: ${JSON.stringify(settings.removed)}`);
        assert.equal(await page.getByRole('heading', { name: 'My profile', exact: true }).count(), 1);
        assert.equal(await page.locator('#profile-name').textContent(), 'Alexandra Google', 'Profile uses the Google identity instead of the COR name');
        assert.equal(await page.locator('#profile-email').textContent(), 'alexandra@qcu.edu.ph');
        assert.equal(await page.locator('#profile-avatar').textContent(), 'AG', 'Missing Google photo gets initials');
        assert.equal(await page.locator('#profile-badge-label').textContent(), 'Student account');
        assert.equal(await page.getByRole('link', { name: 'Back to Home' }).getAttribute('href'), 'index.html');
        await page.locator('#general-settings-btn').click();
        assert.equal(await page.locator('#general-settings-btn').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.getByRole('link', { name: 'Google Integration', exact: true }).count(), 0);
        assert.equal(await page.getByRole('link', { name: 'Campus Buildings', exact: true }).getAttribute('href'), 'buildings.html');
        await page.locator('#general-settings-btn').click();
        await page.locator('#settings-help-btn').click();
        assert(await page.locator('#settings-help').evaluate(el => el.open && el.contains(document.activeElement)), 'Help opens and traps focus in its dialog');
        await page.keyboard.press('Escape');
        assert(await page.locator('#settings-help-btn').evaluate(el => el === document.activeElement));
        await page.getByRole('button', { name: 'Notification settings', exact: true }).click();
        assert(await page.locator('#notification-toggle').evaluate(el => el === document.activeElement), 'Header bell focuses notification switch');
      }
      // The header never carries a Sign out button any more (it lives in Settings).
      assert.equal(await page.locator('#app-header .signout-btn, #app-header [onclick*="signOut"]').count(), 0, `${name}: header has no Sign out button`);
    }
    assert.deepEqual(errors, [], `Runtime errors at ${width}`);
    await context.close();
    console.log(`PASS student interactions and navigation at ${width}px`);
  }
  // Today Task line-up: a finished day collapses to compact rows + a closing row,
  // and a day with no classes shows the soft empty tile (never a blank column).
  {
    const finishedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
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
    assert.equal(await finishedPage.locator('#today-heading').textContent(), 'Today’s schedule', 'Manila Monday is selected while the browser is still on Sunday');
    assert.equal(await finishedPage.locator('#soft-calendar .is-today .home-date-number').textContent(), '14', 'Calendar uses Manila dates');
    assert.equal(await finishedPage.locator('#home-summary').textContent(), 'All 2 classes done');
    const finished = await finishedPage.evaluate(() => {
      const grid = document.getElementById('today-grid');
      const cs = getComputedStyle(grid);
      const width = Math.round(grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
      return { width, kids: [...grid.children].map(el => ({ cls: el.className, w: Math.round(el.getBoundingClientRect().width), text: el.innerText.replace(/\n/g, ' | ') })) };
    });
    assert.equal(finished.kids.length, 3, `Finished day = 2 done rows + closing row: ${JSON.stringify(finished.kids)}`);
    assert(finished.kids.slice(0, 2).every(k => /home-today-done-row/.test(k.cls) && Math.abs(k.w - finished.width) < 2), `Done rows span the column: ${JSON.stringify(finished.kids)}`);
    assert.match(finished.kids[0].text, /Fundamentals of Programming[\s\S]*8:00 AM – 10:00 AM \| 2h/, `Done row keeps subject, time and duration: ${finished.kids[0].text}`);
    assert.match(finished.kids[2].cls, /home-today-all-done/, 'A finished day closes with the all-done row');
    assert.equal(await finishedPage.locator('#today-grid .home-today-card--feature').count(), 0, 'No feature box once every class ended');

    await finishedPage.clock.setSystemTime(new Date('2026-09-16T00:30:00Z'));
    await finishedPage.evaluate(() => tick(true));
    assert.equal(await finishedPage.locator('#home-summary').textContent(), 'You have 1 class today', 'Today selection follows the Manila day change');
    await finishedPage.locator('#soft-calendar [data-day-name="Monday"]').first().click();
    assert.equal(await finishedPage.locator('#today-grid .home-today-done-row').count(), 2, 'Past weekday sessions are marked done');
    assert.doesNotMatch(await finishedPage.locator('#today-grid').innerText(), /Starts in|left · ends|Now/);
    await finishedPage.clock.setSystemTime(new Date('2026-09-14T06:30:00Z'));

    await finishedPage.clock.setSystemTime(new Date('2027-01-01T00:30:00Z'));
    await finishedPage.evaluate(() => { homeSelectedDay = null; tick(true); });
    assert.equal(await finishedPage.locator('#calendar-label').textContent(), 'Dec 28 – Jan 3', 'Week picker spans month and year boundaries');
    assert.equal(await finishedPage.locator('#soft-calendar .is-today .home-date-number').textContent(), '1');
    assert.equal(await finishedPage.locator('#soft-calendar [aria-selected="true"]').getAttribute('data-day-name'), 'Friday');
    assert.equal(await finishedPage.locator('#home-month-label').textContent(), 'January 2027');
    await finishedPage.getByRole('button', { name: 'Next month', exact: true }).click();
    assert.equal(await finishedPage.locator('#home-month-calendar button[data-date]').count(), 28, 'February 2027 has 28 dates');
    await finishedPage.evaluate(() => selectHomeDate('2028-02-29'));
    assert.equal(await finishedPage.locator('#home-month-label').textContent(), 'February 2028');
    assert.equal(await finishedPage.locator('#home-month-calendar button[data-date]').count(), 29, 'Leap February has 29 dates');
    await finishedPage.locator('#home-month-calendar [data-date="2028-02-29"]').focus();
    await finishedPage.keyboard.press('ArrowRight');
    assert.equal(await finishedPage.locator('#home-month-label').textContent(), 'March 2028');
    assert.equal(await finishedPage.locator('#home-month-calendar button:focus').getAttribute('data-date'), '2028-03-01', 'Keyboard selection crosses the month boundary');
    await finishedPage.clock.setSystemTime(new Date('2026-09-14T06:30:00Z'));

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
  mode = 'populated';
  // Test real multipage links and the expansion with motion enabled.
  await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#bottom-nav [data-nav-page="home"]'));
  await page.locator('#bottom-nav [data-nav-page="schedule"]').click();
  await page.waitForURL('**/schedule.html');
  await page.waitForFunction(() => document.querySelector('#bottom-nav [data-nav-page="schedule"].active'));
  await page.waitForFunction(() => document.querySelector('#bottom-nav [data-nav-page="schedule"] .nav-label')?.getBoundingClientRect().width > 40);
  assert.equal(await page.locator('#bottom-nav [aria-current="page"]').getAttribute('data-nav-page'), 'schedule');
  assert.match(await page.locator('#bottom-nav .nav-label').first().evaluate(el => getComputedStyle(el).transitionProperty), /max-width/);
  await page.locator('#schedule-add-btn').click();
  await page.locator('#crud-modal.open').waitFor();
  await page.locator('#crud-modal').click({ position: { x: 5, y: 5 } });
  assert.equal(await page.locator('#crud-modal.open').count(), 0, 'Click outside closes editor');
  await page.locator('#bottom-nav [data-nav-page="workspace"]').click();
  await page.waitForURL('**/workspace.html');
  await page.waitForFunction(() => document.querySelector('#bottom-nav [data-nav-page="workspace"].active'));
  await page.locator('#bottom-nav').getByRole('button', { name: 'Add task', exact: true }).click();
  await page.locator('#task-modal.open').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('[data-workspace-view="notes"]').click();
  // Rebuilding the shell preserves the selected tab's quick-add action.
  await page.evaluate(() => { renderShell(); iconify(); });
  await page.locator('#bottom-nav').getByRole('button', { name: 'Add note', exact: true }).click();
  await page.locator('#note-modal.open').waitFor();
  await page.keyboard.press('Escape');
  await page.goto(`${origin}/workspace.html#notes`);
  await page.waitForFunction(() => !document.querySelector('[data-loading-region], [data-loading-cover]'));
  assert.equal(await page.locator('[data-workspace-view="notes"]').getAttribute('aria-selected'), 'true');
  await page.locator('#bottom-nav').getByRole('button', { name: 'Add note', exact: true }).click();
  await page.locator('#note-modal.open').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#bottom-nav [data-nav-page="home"]').click();
  await page.waitForURL('**/index.html');
  await page.locator('#bottom-nav .nav-google').click();
  await page.waitForURL('**/settings.html#google-connection');
  await page.waitForFunction(() => !document.querySelector('[data-loading-region], [data-loading-cover]'));
  assert.equal(await page.locator('#google-connection').evaluate(el => el.open), true, 'Shortcut opens the Classroom connection modal in Settings');
  assert.equal(await page.locator('#crud-modal.open').count(), 0, 'Google shortcut navigates without opening a class editor');
  console.log('PASS animated route links, Google integration shortcut, and contextual workspace quick add');
  // The standalone Today page is gone — today.html is a redirect stub now.
  await page.goto(`${origin}/today.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(url => url.pathname.endsWith('/index.html') || url.pathname === '/', { timeout: 5000 });
  assert(page.url().endsWith('/index.html') || new URL(page.url()).pathname === '/', `today.html redirects to the dashboard (landed on ${page.url()})`);
  assert.equal(await page.locator('#today-grid').count(), 1, 'the dashboard carries the today line-up');

  for (const name of ['schedule']) {
    for (const state of ['empty', 'error']) {
      mode = state;
      await page.goto(`${origin}/${name}.html`);
      await page.waitForFunction(() => !document.querySelector('[data-loading-region]'));
      const content = await page.locator(name === 'schedule' ? '#schedule-rows' : '#task-list').innerText();
      assert.match(content, state === 'error' ? /could not be loaded|Timetable unavailable|Retry/i : /empty|No classes|timetable/i);
      if (state === 'error') assert.equal(await page.getByRole('button', { name: 'Try again', exact: true }).count(), 1);
    }
  }
  await context.close();
  {
    const publicContext = await browser.newContext({ viewport: { width: 375, height: 844 } });
    await publicContext.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: reply(url.pathname) });
      return route.continue();
    });
    const publicPage = await publicContext.newPage();
    mode = 'signedout';
    for (const auth of ['', 'denied', 'failed', 'admin_denied', 'admin_expired', 'backend_unavailable']) {
      await publicPage.goto(`${origin}/index.html${auth ? `?auth=${auth}` : ''}`);
      await publicPage.locator('#auth-landing').waitFor({ state: 'visible' });
      assert.equal(await publicPage.locator('#auth-dashboard').evaluate(el => el.checkVisibility()), false, 'Public visits stay on the landing page');
      if (auth) {
        await publicPage.locator('#auth-error-msg').waitFor({ state: 'visible' });
        assert((await publicPage.locator('#auth-error-msg').textContent()).length > 20, `${auth} retains its recovery message`);
      }
    }
    mode = 'populated';
    await publicContext.close();
    console.log('PASS public landing and sign-in error states');
  }
  // Populated planner fixtures exercise category filtering and real UI mutations.
  for (const width of [320, 390, 768, 1440]) {
    let tasks = [
      { taskId: 'code-task', title: 'Build a student portal', subjectCode: 'CC102', subjectName: 'Fundamentals of Programming', description: 'Prepare the dashboard prototype.', dueDate: '2026-09-16', scheduleDay: 'MONDAY', scheduleTime: '08:00–10:00', status: 'OPEN', priority: 'HIGH', createdAt: '2026-09-14T01:00:00Z' },
      { taskId: 'business-task', title: 'Prepare a business proposal', subjectCode: 'NEW201', subjectName: 'Entrepreneurship and Business Management', dueDate: '2026-09-18', status: 'OPEN', priority: 'MEDIUM', createdAt: '2026-09-13T01:00:00Z' },
      { taskId: 'general-task', title: 'Read the next chapter', subjectCode: 'RIZAL', status: 'COMPLETED', priority: 'LOW', createdAt: '2026-09-12T01:00:00Z' }
    ];
    let notes = [
      { noteId: 'business-note', title: 'Ideas for our group project', subjectCode: 'NEW201', subjectName: 'Business Management', body: 'Outline the budget and roles for the team.', createdAt: '2026-09-14T01:00:00Z' },
      { noteId: 'general-note', title: 'Lecture highlights', subjectCode: 'RIZAL', body: 'Review the historical context before the quiz.', scheduleDay: 'FRIDAY', scheduleTime: '09:00–11:00', createdAt: '2026-09-13T01:00:00Z' }
    ];
    const mutations = [];
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'America/Los_Angeles' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), request = route.request();
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const match = url.pathname.match(/\/api\/v1\/(tasks|notes)(?:\/([^/]+))?$/);
      if (!match) return route.fulfill({ json: { ...reply(url.pathname), ...(url.pathname.endsWith('/dashboard') ? { tasks, notes } : {}) } });
      const kind = match[1], id = match[2];
      if (request.method() === 'PATCH') {
        const payload = request.postDataJSON();
        mutations.push({ kind, id, payload });
        const target = (kind === 'tasks' ? tasks : notes).find(item => (item.taskId || item.noteId) === id);
        Object.assign(target, payload);
      }
      if (request.method() === 'DELETE') {
        if (kind === 'tasks') tasks = tasks.filter(item => item.taskId !== id);
        else notes = notes.filter(item => item.noteId !== id);
      }
      return route.fulfill({ json: { ok: true, data: kind === 'tasks' ? tasks : notes } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-09-14T00:30:00Z') });
    await page.goto(`${origin}/workspace.html`);
    await page.waitForFunction(() => !document.querySelector('[data-loading-region]'));
    assert.equal(await page.locator('#task-list .task-card').count(), 3);
    assert.equal(await page.locator('[data-task-id="code-task"] .study-subject-icon .lucide-terminal').count(), 1);
    assert.equal(await page.locator('[data-task-id="business-task"] .study-subject-icon .lucide-briefcase-business').count(), 1, 'API subject names map even when the course code is new');
    assert.equal(await page.locator('[data-task-id="general-task"] .study-subject-icon .lucide-book-open').count(), 1);
    assert.match(await page.locator('[data-task-id="code-task"]').innerText(), /Mon · 8:00 AM – 10:00 AM/);
    assert(!/12:00 AM|8:00 AM/.test(await page.locator('[data-task-id="business-task"] .task-meta').innerText()), 'A date-only deadline never invents a clock time');
    await page.locator('#task-categories [data-study-category="business"]').click();
    assert.equal(await page.locator('#task-list .task-card').count(), 1);
    await page.locator('#task-categories [data-study-category="all"]').click();
    await page.locator('#task-filter-status').selectOption('pending');
    assert.equal(await page.locator('#task-list .task-card').count(), 2);
    await page.locator('#task-filter-status').selectOption('all');
    await page.locator('#task-search').fill('portal');
    assert.equal(await page.locator('#task-list .task-card').count(), 1);
    await page.locator('#task-search-clear').click();
    await page.locator('[data-task-id="code-task"] [data-action="toggle"]').click();
    await page.locator('[data-task-id="code-task"] .study-status.is-done').waitFor();
    assert.equal(mutations.at(-1).payload.status, 'COMPLETED');
    await page.locator('[data-task-id="code-task"] [data-action="toggle"]').click();
    await page.locator('[data-task-id="code-task"] .study-status.is-pending').waitFor();
    await page.locator('[data-task-id="code-task"] [data-action="edit"]').click();
    assert.equal(await page.locator('#tf-title').inputValue(), 'Build a student portal');
    await page.keyboard.press('Escape');
    await page.locator('#task-modal').waitFor({ state: 'hidden' });
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      clipped: [...document.querySelectorAll('.task-card, .note-card, .study-categories')].filter(el => el.checkVisibility()).some(el => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }),
      white: getComputedStyle(document.querySelector('.task-card')).backgroundColor,
      touch: [...document.querySelectorAll('.task-card button')].every(el => el.getBoundingClientRect().height >= 36)
    }));
    assert(!layout.overflow && !layout.clipped); assert.equal(layout.white, 'rgb(255, 255, 255)'); assert(layout.touch);
    if ([390, 1440].includes(width)) await page.screenshot({ path: resolve(output, `planner-tasks-${width}.png`), fullPage: true });
    await page.getByRole('tab', { name: 'Notes', exact: true }).click();
    assert.equal(await page.locator('#note-list .note-card').count(), 2);
    assert.equal(await page.locator('[data-note-id="business-note"] .lucide-briefcase-business').count(), 1);
    await page.locator('#note-categories [data-study-category="general"]').click();
    assert.equal(await page.locator('#note-list .note-card').count(), 1);
    await page.locator('#note-categories [data-study-category="all"]').click();
    if ([390, 1440].includes(width)) await page.screenshot({ path: resolve(output, `planner-notes-${width}.png`), fullPage: true });
    await page.locator('[data-note-id="business-note"] [data-action="edit-note"]').click();
    await page.locator('#nf-title').fill('Updated project ideas');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.locator('#note-modal').waitFor({ state: 'hidden' });
    await page.locator('[data-note-id="business-note"] .note-card-title').getByText('Updated project ideas').waitFor();
    assert.equal(mutations.at(-1).payload.title, 'Updated project ideas');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS planner categories, subject icons, linked times, completion, and note editing at ${width}px`);
  }
  // Settings permission and installation interactions use only local fixtures.
  {
    mode = 'populated';
    const settingsContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await settingsContext.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: reply(url.pathname) });
      return route.continue();
    });
    await settingsContext.addInitScript(() => {
      const notification = { permission: 'default', calls: 0, result: 'granted', async requestPermission() { this.calls++; this.permission = this.result; return this.result; } };
      Object.defineProperty(window, 'Notification', { configurable: true, value: notification });
    });
    const settingsPage = await settingsContext.newPage();
    const errors = [];
    settingsPage.on('pageerror', error => errors.push(error.message));
    await settingsPage.goto(`${origin}/settings.html`);
    await settingsPage.waitForFunction(() => !document.querySelector('[data-loading-cover]'));
    const toggle = settingsPage.getByRole('switch', { name: 'Notifications', exact: true });
    assert.equal(await settingsPage.evaluate(() => Notification.calls), 0, 'Page load never requests notification permission');
    await toggle.click();
    await settingsPage.waitForFunction(() => document.getElementById('notification-toggle').getAttribute('aria-checked') === 'true');
    assert.equal(await settingsPage.evaluate(() => Notification.calls), 1);
    assert.equal(await settingsPage.evaluate(() => localStorage.getItem('qcu-notifications')), 'true');
    await settingsPage.reload();
    await settingsPage.waitForFunction(() => !document.querySelector('[data-loading-cover]'));
    await settingsPage.evaluate(() => { Notification.permission = 'granted'; window.dispatchEvent(new Event('focus')); });
    assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'Preference survives reload when permission is granted');
    await toggle.click();
    assert.equal(await settingsPage.evaluate(() => localStorage.getItem('qcu-notifications')), 'false');
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await settingsPage.evaluate(() => { Notification.permission = 'denied'; window.dispatchEvent(new Event('focus')); });
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false', 'Denied permission cannot turn on alerts');
    assert.match(await settingsPage.locator('#notification-status').textContent(), /Blocked by your browser/);
    assert.equal(await settingsPage.evaluate(() => Notification.calls), 0, 'Denied permission is not requested again');
    await settingsPage.evaluate(() => { Notification.permission = 'default'; Notification.result = 'default'; });
    await toggle.click();
    assert.match(await settingsPage.locator('#notification-status').textContent(), /Permission was not granted/);
    await settingsPage.evaluate(() => { delete window.Notification; window.dispatchEvent(new Event('focus')); });
    // Clear the transient permission message through a storage event.
    await settingsPage.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'qcu-notifications' })));
    assert(await toggle.isDisabled());
    assert.match(await settingsPage.locator('#notification-status').textContent(), /does not support/);
    await settingsPage.evaluate(() => {
      window.QCUSettings.render({ googleAccount: { name: '<img src=x onerror=alert(1)> & Student', email: '<b>test@example.test</b>', picture: 'javascript:alert(1)' } });
    });
    assert.equal(await settingsPage.locator('#profile-name img, #profile-email b, #profile-avatar img').count(), 0, 'Identity strings are rendered safely');
    assert.equal(await settingsPage.locator('#profile-badge-label').textContent(), 'Student account', 'Unverified identity never gets a verified badge');
    await settingsPage.evaluate(() => window.QCUSettings.render({ googleAccount: { name: 'Google Student', picture: location.origin + '/missing-profile.jpg' } }));
    await settingsPage.waitForFunction(() => document.getElementById('profile-avatar').textContent === 'GS');
    await settingsPage.route('**/fixture-photo.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"><rect width="88" height="88" fill="#abc"/></svg>' }));
    await settingsPage.evaluate(() => window.QCUSettings.render({ googleAccount: { name: 'Google Student', picture: location.origin + '/fixture-photo.svg', email: 'google@example.test', emailVerified: true } }));
    await settingsPage.waitForFunction(() => document.querySelector('#profile-avatar img')?.naturalWidth > 0);
    assert.equal(await settingsPage.locator('#profile-avatar img').getAttribute('referrerpolicy'), 'no-referrer');
    await settingsPage.evaluate(() => window.dispatchEvent(new CustomEvent('qcu-dashboard-updated', { detail: { status: 'OK', entries: [], profile: { googleAccount: { name: 'Updated Google User', email: 'updated@example.test' } } } })));
    assert.equal(await settingsPage.locator('#profile-name').textContent(), 'Updated Google User', 'Authenticated dashboard refresh updates the card');

    // A dismissed automatic prompt must still open when explicitly requested.
    await settingsPage.evaluate(() => localStorage.setItem('qcu-install-prompt', JSON.stringify({ dismissedAt: Date.now() })));
    await settingsPage.locator('#install-app-btn').click();
    await settingsPage.locator('#install-prompt').waitFor({ state: 'visible' });
    assert.equal(await settingsPage.locator('#install-prompt .install-instructions').count(), 1);
    await settingsPage.locator('#install-btn-dismiss').click();
    await settingsPage.locator('#install-app-btn').click();
    assert.equal(await settingsPage.locator('#install-prompt').count(), 1, 'Immediately reopening uses one live prompt');
    await settingsPage.locator('#install-btn-dismiss').click();
    await settingsPage.waitForFunction(() => !document.querySelector('.install-prompt'));
    // Dispatch the native browser event with a synthetic accepted choice.
    await settingsPage.evaluate(() => {
      window.installCalls = 0;
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = async () => { window.installCalls++; };
      event.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(event);
    });
    await settingsPage.locator('#install-app-btn').click();
    await settingsPage.locator('#install-btn-install').click();
    await settingsPage.waitForFunction(() => document.getElementById('install-app-btn').disabled);
    assert.equal(await settingsPage.evaluate(() => window.installCalls), 1);
    assert.match(await settingsPage.locator('#install-app-status').textContent(), /Installed/);
    await settingsPage.evaluate(() => window.QCUInstallPrompt.trigger());
    assert.equal(await settingsPage.locator('#install-prompt').count(), 0, 'Installed apps do not get another prompt');
    await settingsPage.route('**/api/auth/logout', route => route.fulfill({ contentType: 'text/html', body: '<p>Signed out fixture</p>' }));
    await settingsPage.getByRole('button', { name: 'Logout', exact: true }).click();
    await settingsPage.waitForURL('**/api/auth/logout');
    assert.deepEqual(errors, []);
    await settingsContext.close();
    console.log('PASS Google profile safety and refresh, notification permissions and persistence, manual/native installation, and logout');
  }
  assert.deepEqual(failures, [], 'Responsive overflow');
  console.log('PASS populated, empty, and unavailable states; no clipped content');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
