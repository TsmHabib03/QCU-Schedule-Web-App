// Real-browser feedback fixtures; all requests stay local, including mutations.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
const root = resolve('.');
const output = resolve(tmpdir(), 'qcu-feedback-design');
await mkdir(output, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + sep)) return res.writeHead(403).end();
  try { res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const entry = { entryId: 'class-1', enrollmentSubjectId: 'subject-1', day: 'Monday', title: 'Fundamentals of Programming', code: 'CC102', start: '08:00', end: '10:00', modality: 'ONSITE' };
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    let deletes = 0;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (route.request().method() === 'DELETE') { deletes++; return route.fulfill({ json: { ok: true } }); }
      if (url.pathname.endsWith('/bootstrap')) return route.fulfill({ json: { authenticated: true, routing: 'dashboard' } });
      if (url.pathname.endsWith('/session')) return route.fulfill({ json: { status: 'OK', user: { userId: 'fixture', name: 'Alexandra Reyes' } } });
      if (url.pathname.endsWith('/dashboard')) return route.fulfill({ json: { status: 'OK', profile: { name: 'Alexandra Reyes' }, academic: {}, entries: [entry], buildings: [], tasks: [], notes: [] } });
      if (url.pathname.endsWith('/schedule')) return route.fulfill({ json: { ok: true, data: { entries: [entry] } } });
      return route.fulfill({ json: { status: 'OK', data: [], connected: false } });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/schedule.html');
    await page.locator('#bottom-nav .nav-add').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-loading-region], [data-loading-cover]'));
    await page.evaluate(() => document.fonts.ready);
    // Dialog variants use text nodes, matching semantic colors and structure.
    for (const variant of ['info', 'success', 'error']) {
      await page.evaluate(variant => {
        window.__answer = null;
        qcuDialog({ variant, label: { info: 'Schedule information', success: 'Schedule updated', error: 'Delete class' }[variant], title: { info: 'Review your class schedule', success: 'Your changes are saved', error: 'Remove this class?' }[variant], message: 'Fundamentals of Programming <CC102> is scheduled for Monday, 8:00–10:00 AM.', primaryLabel: variant === 'error' ? 'Delete class' : 'Got it', secondaryLabel: 'Cancel' }).then(value => window.__answer = value);
      }, variant);
      const dialog = page.locator('.qcu-dialog[open]'); await dialog.waitFor();
      await page.waitForTimeout(260);
      const layout = await dialog.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const body = el.querySelector('.feedback-intro').getBoundingClientRect();
        const icon = el.querySelector('.feedback-status-icon').getBoundingClientRect();
        const heading = el.querySelector('h2').getBoundingClientRect();
        return { bg: getComputedStyle(el).backgroundColor, header: getComputedStyle(el.querySelector('.feedback-header')).backgroundColor, radius: getComputedStyle(el).borderRadius, color: getComputedStyle(el.querySelector('.feedback-primary')).backgroundColor, left: rect.left, right: rect.right, overflow: el.scrollWidth - el.clientWidth, iconLeft: icon.left, headingLeft: heading.left, bodyTop: body.top };
      });
      assert.equal(layout.bg, 'rgb(255, 255, 255)'); assert.equal(layout.radius, '28px');
      assert.equal(layout.color, { info: 'rgb(74, 58, 255)', success: 'rgb(21, 128, 61)', error: 'rgb(220, 38, 38)' }[variant]);
      assert.notEqual(layout.header, layout.bg); assert(layout.left >= 15 && layout.right <= width - 15); assert.equal(layout.overflow, 0); assert(layout.iconLeft < layout.headingLeft);
      assert.equal(await dialog.locator('cc102').count(), 0);
      assert(await dialog.locator('.feedback-secondary').evaluate(el => el === document.activeElement));
      for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); assert(await dialog.evaluate(el => el.contains(document.activeElement))); }
      await page.screenshot({ path: resolve(output, `dialog-${variant}-${width}.png`) });
      await dialog.locator('.feedback-primary').click(); await dialog.waitFor({ state: 'detached' }); assert.equal(await page.evaluate(() => window.__answer), true);
    }
    // Every cancellation path leaves the underlying class editor intact.
    await page.evaluate(() => openCrudModal(state.schedule[0]));
    const editor = page.locator('#crud-modal.open'); await editor.waitFor(); await page.waitForTimeout(260);
    await page.screenshot({ path: resolve(output, `class-editor-${width}.png`) });
    await editor.locator('.crud-actions').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `class-editor-footer-${width}.png`) });
    console.log('Editor styles', width, await editor.evaluate(el => ({ description: getComputedStyle(el.querySelector('.feedback-description')).color, close: getComputedStyle(el.querySelector('.feedback-close')).width })));
    for (const cancel of ['secondary', 'close', 'escape', 'backdrop']) {
      await page.locator('#crud-delete-btn').click();
      const dialog = page.locator('.qcu-dialog[open]'); await dialog.waitFor();
      if (cancel === 'secondary') await dialog.locator('.feedback-secondary').click();
      if (cancel === 'close') await dialog.locator('.feedback-close').click();
      if (cancel === 'escape') await page.keyboard.press('Escape');
      if (cancel === 'backdrop') { await page.waitForTimeout(240); await page.mouse.click(3, 3); }
      await dialog.waitFor({ state: 'detached' }); assert.equal(deletes, 0); assert(await editor.isVisible());
      assert(await page.locator('#crud-delete-btn').evaluate(el => el === document.activeElement));
    }
    await page.locator('#crud-delete-btn').click();
    await page.locator('.qcu-dialog .feedback-primary').click();
    await page.waitForFunction(() => !document.querySelector('#crud-modal.open'));
    assert.equal(deletes, 1); await page.waitForTimeout(240);
    await page.evaluate(() => qcuToastDismiss('class-delete'));
    await page.waitForTimeout(220);
    await page.goto(origin + '/workspace.html');
    await page.waitForFunction(() => !document.querySelector('[data-loading-region], [data-loading-cover]'));
    for (const kind of ['task', 'note']) {
      await page.locator('#bottom-nav .nav-add').focus();
      await page.evaluate(kind => kind === 'task' ? openTaskModal() : openNoteModal(), kind);
      const formDialog = page.locator(`#${kind}-modal.open`);
      await page.waitForTimeout(260);
      await formDialog.locator('.feedback-actions').scrollIntoViewIfNeeded();
      const footer = await formDialog.locator('.feedback-actions').evaluate(el => {
        const buttons = [...el.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height, radius: getComputedStyle(button).borderRadius }; });
        return { buttons, overflow: el.scrollWidth - el.clientWidth };
      });
      assert.equal(footer.overflow, 0); assert(footer.buttons.every(b => b.left >= 15 && b.right <= width - 15 && b.height >= 44));
      assert.equal(footer.buttons[1].radius, '12px');
      assert(footer.buttons[0].right <= footer.buttons[1].left, 'Editor actions share a right-aligned row');
      await page.screenshot({ path: resolve(output, `${kind}-editor-footer-${width}.png`) });
      await formDialog.locator('.feedback-secondary').click();
      assert(await page.locator(`#${kind}-modal`).evaluate(el => el.inert));
      assert(await page.locator('#bottom-nav .nav-add').evaluate(el => el === document.activeElement));
      await page.waitForTimeout(220);
    }
    for (const variant of ['info', 'success', 'error']) {
      await page.evaluate(variant => qcuToast(variant, { info: 'Your schedule was refreshed.', success: 'Class changes saved.', error: 'Could not save your class. Please try again.' }[variant], { variant, duration: 0 }), variant);
    }
    await page.waitForTimeout(260);
    const toasts = page.locator('.qcu-toast'); assert.equal(await toasts.count(), 3);
    const toastRects = await toasts.evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, overflow: el.scrollWidth - el.clientWidth, role: el.getAttribute('role'), state: el.dataset.feedbackState, icon: el.querySelector('.qcu-toast-icon-block svg') !== null }; }));
    for (const rect of toastRects) { assert(rect.left >= 15 && rect.right <= width - 15); assert.equal(rect.overflow, 0); assert(rect.icon); assert.equal(rect.role, rect.state === 'error' ? 'alert' : 'status'); }
    const navTop = await page.locator('#bottom-nav').evaluate(el => el.getBoundingClientRect().top); assert(toastRects.every(r => r.bottom < navTop));
    await page.screenshot({ path: resolve(output, `toasts-${width}.png`) });
    await page.evaluate(() => { qcuToastDismiss('info'); qcuToast('info', 'Updated during dismissal.', { duration: 0 }); });
    await page.waitForTimeout(300); assert.equal(await page.locator('#qcu-toast-info').count(), 1); assert.match(await page.locator('#qcu-toast-info').innerText(), /Updated during dismissal/);
    await page.evaluate(() => { qcuToastDismiss('info'); qcuToastDismiss('success'); qcuToastDismiss('error'); qcuToast('action', 'Your schedule needs a refresh.', { duration: 0, actionLabel: 'Refresh', onAction: () => window.__actionCount = (window.__actionCount || 0) + 1 }); });
    await page.waitForTimeout(260);
    await page.screenshot({ path: resolve(output, `toast-action-${width}.png`) });
    await page.locator('#qcu-toast-action .qcu-toast-action').click(); await page.waitForTimeout(220); assert.equal(await page.evaluate(() => window.__actionCount), 1); assert.equal(await page.locator('#qcu-toast-action').count(), 0);
    // Timers pause while pointer or keyboard focus is on the notification.
    await page.mouse.move(0, 0);
    await page.evaluate(() => qcuToast('timer', 'Changes saved.', { variant: 'success', duration: 700 }));
    await page.locator('#qcu-toast-timer').hover(); await page.waitForTimeout(850); assert(await page.locator('#qcu-toast-timer').isVisible());
    await page.locator('#qcu-toast-timer .qcu-toast-close').focus(); await page.mouse.move(0, 0); await page.waitForTimeout(850); assert(await page.locator('#qcu-toast-timer').isVisible());
    await page.locator('#bottom-nav .nav-add').focus(); await page.locator('#qcu-toast-timer').waitFor({ state: 'detached' });
    await context.close(); assert.deepEqual(errors, []); console.log(`PASS feedback variants, confirmations, focus, toast lifecycle at ${width}px`);
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
console.log(`Feedback screenshots: ${output}`);
