// Capture the real UI with sample data, without credentials or external API calls.
// Run: node scripts/capture-readme-screenshots.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'docs/screenshots');
const capturedAt = new Date('2026-09-14T00:30:00Z'); // Monday, 08:30 in Manila.
const stamp = capturedAt.getTime();
const course = (id, day, title, start, end, code, instructor, roomCode = 'IL502A') => ({
  entryId: id, enrollmentSubjectId: `subject-${id}`, subjectId: `subject-${id}`,
  day, title, start, end, code, instructor, buildingCode: 'IL',
  buildingName: 'New Academic Building', floor: 5, roomCode, units: 3,
  originType: 'COR_IMPORT',
});
const entries = [
  course('programming', 'Monday', 'Fundamentals of Programming', '08:00', '10:00', 'CC102', 'Prof. Maria Santos'),
  course('mathematics', 'Monday', 'Mathematics in the Modern World', '11:00', '13:00', 'MATH 1', 'Prof. Paolo Cruz', 'IL601A'),
  course('hci', 'Wednesday', 'Human-Computer Interaction', '13:00', '16:00', 'HCI101', 'Prof. Elena Reyes'),
  course('fitness', 'Friday', 'Physical Fitness and Wellness', '09:00', '11:00', 'PE 1', 'Prof. Gabriel Lim'),
];
const tasks = [
  { taskId: 'task-programming', title: 'Finish the programming exercise', description: 'Practice loops and arrays, then submit your solutions before the next class.', subjectCode: 'CC102', subjectName: 'Fundamentals of Programming', subjectId: 'subject-programming', status: 'OPEN', priority: 'HIGH', dueDate: '2026-09-16', createdAt: stamp - 60000 },
  { taskId: 'task-mathematics', title: 'Review sets and logic', description: 'Work through the examples from today\'s lecture and prepare questions for discussion.', subjectCode: 'MATH 1', subjectName: 'Mathematics in the Modern World', status: 'OPEN', priority: 'MEDIUM', dueDate: '2026-09-17', createdAt: stamp - 120000 },
  { taskId: 'task-hci', title: 'Sketch a student app interface', description: 'Create a simple wireframe with clear navigation and accessible controls.', subjectCode: 'HCI101', subjectName: 'Human-Computer Interaction', status: 'OPEN', priority: 'LOW', dueDate: '2026-09-18', createdAt: stamp - 180000 },
];
const notes = [
  { noteId: 'note-programming', title: 'Loops and arrays: lecture notes', body: 'Use a for loop when the number of repetitions is known. Arrays store related values and use a zero-based index. Review the practice examples before the next laboratory session.', subjectCode: 'CC102', subjectName: 'Fundamentals of Programming', createdAt: stamp - 240000, updatedAt: stamp - 240000 },
  { noteId: 'note-hci', title: 'Designing for everyday use', body: 'Keep labels clear, show feedback after each action, and make important controls easy to reach. Test the same screen on both a phone and a desktop.', subjectCode: 'HCI101', subjectName: 'Human-Computer Interaction', createdAt: stamp - 300000, updatedAt: stamp - 300000 },
];
const buildings = JSON.parse(await readFile(resolve(root, 'data/buildings.json'), 'utf8'));
const dashboard = {
  status: 'OK', authenticated: true, routing: 'dashboard', cacheKey: 'readme-sample',
  profile: { name: 'Alexandra Reyes', email: 'student@example.test', picture: '', googleAccount: { name: 'Alexandra Reyes', email: 'student@example.test', picture: '', emailVerified: true } },
  enrollment: { yearLevel: 'FIRST_YEAR', sectionLabel: 'BSIT-1A' },
  academic: { program: { abbrev: 'BSIT', name: 'Bachelor of Science in Information Technology' }, campus: { shortName: 'San Bartolome', name: 'San Bartolome Campus' } },
  entries, tasks, notes, buildings,
};
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const publicPages = new Set(['index.html', 'schedule.html', 'workspace.html', 'settings.html', 'onboarding.html']);
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\//, '');
  const file = resolve(root, path || 'index.html');
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep) ||
      (!publicPages.has(path || 'index.html') && !/^(assets|data)\//.test(path))) {
    return response.writeHead(403).end();
  }
  try {
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});

let browser;
try {
  await mkdir(output, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const captures = [
    { name: 'dashboard-desktop', page: 'index', width: 1440, height: 1100, ready: '#auth-dashboard' },
    { name: 'schedule-desktop', page: 'schedule', width: 1440, height: 1250, ready: '.timeline-class' },
    { name: 'tasks-desktop', page: 'workspace', width: 1440, height: 1350, ready: '.task-card' },
    { name: 'notes-desktop', page: 'workspace', width: 1440, height: 1100, ready: '.note-card', notes: true },
    { name: 'dashboard-mobile', page: 'index', width: 390, height: 844, ready: '#auth-dashboard' },
    { name: 'settings-mobile', page: 'settings', width: 390, height: 844, ready: '#profile-name' },
    { name: 'onboarding-mobile', page: 'onboarding', width: 390, height: 844, ready: '#step-upload.active' },
  ];
  for (const capture of captures) {
    const context = await browser.newContext({
      viewport: { width: capture.width, height: capture.height },
      deviceScaleFactor: 1, timezoneId: 'Asia/Manila', reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'api.open-meteo.com') return route.fulfill({ json: { current: { temperature_2m: 29, weather_code: 2 } } });
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = url.pathname;
      let json = { status: 'OK', data: [] };
      if (path.endsWith('/bootstrap')) json = { status: 'OK', authenticated: true, routing: capture.page === 'onboarding' ? 'onboarding' : 'dashboard' };
      if (path.endsWith('/dashboard')) json = dashboard;
      if (path.endsWith('/session')) json = { status: 'OK', user: { userId: 'readme-student', name: 'Alexandra Reyes' } };
      if (path.endsWith('/onboarding/status')) json = { status: 'OK', stage: 'UPLOAD', nextAction: 'upload' };
      if (path.endsWith('/google/status')) json = { connected: false, status: 'not_connected' };
      if (path.endsWith('/tasks')) json = { status: 'OK', data: tasks };
      if (path.endsWith('/notes')) json = { status: 'OK', data: notes };
      return route.fulfill({ json });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: capturedAt });
    await page.goto(`${origin}/${capture.page}.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('[data-loading-region], [data-loading-cover]'));
    if (capture.notes) await page.locator('[data-workspace-view="notes"]').click();
    await page.locator(capture.ready).first().waitFor({ state: 'visible' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].filter(img => img.checkVisibility()).map(img => img.decode().catch(() => {})));
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.clock.runFor(400);
    assert.deepEqual(errors, [], `${capture.name}: unexpected browser errors`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${capture.name}: horizontal overflow`);
    await page.screenshot({ path: resolve(output, `${capture.name}.png`), fullPage: false, animations: 'disabled' });
    console.log(`Captured docs/screenshots/${capture.name}.png`);
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
