'use strict';
const $ = id => document.getElementById(id);
let page = 1, token = '', selected = null, busy = false, searchTimer;
let queuedPage = null, mutation = null;
const date = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—';
const actionNames = { suspend: 'Suspend account', reactivate: 'Reactivate account', close: 'Close account', purge: 'Delete account permanently' };
function releaseBusy() {
  busy = false;
  if (queuedPage !== null) { page = queuedPage; queuedPage = null; load(); }
}
function queueLoad(nextPage = 1) {
  if (busy) { queuedPage = nextPage; return; }
  page = nextPage;
  return load();
}
function el(tag, text, className) { const node = document.createElement(tag); node.textContent = text ?? '—'; if (className) node.className = className; return node; }
async function api(params = '', body, renewed = false) {
  let response;
  try {
    response = await fetch('/api/admin/users' + params, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(35000), headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': token } : {}, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined });
  } catch (_) { throw new Error(body ? 'The server did not confirm the change. Your form is preserved; retrying this same request will check its previous result.' : 'Unable to reach the database. Check your connection and try Refresh data.'); }
  let data;
  try { data = await response.json(); }
  catch (_) { throw new Error('The admin API returned an invalid response. Check the Apps Script and website deployments.'); }
  if (!response.ok) {
    if (body && data.code === 'CSRF_INVALID' && !renewed) {
      await api('?userId=' + encodeURIComponent(body.userId));
      return api(params, body, true);
    }
    if (response.status === 401 || (response.status === 403 && data.code === 'FORBIDDEN')) {
      token = ''; selected = null; $('workspace').hidden = true; $('admin-identity').hidden = true;
      $('users').replaceChildren(); $('detail-content').replaceChildren(); $('audit').replaceChildren(); $('metrics').replaceChildren();
      if ($('details').open) $('details').close();
      window.location.replace(response.status === 401 ? '/?auth=admin_expired' : '/?auth=admin_denied');
    }
    const error = new Error(data.error || 'Request failed. Please retry.'); error.status = response.status; error.code = data.code; throw error; }
  if (body && data.ok !== true) throw new Error('The database did not confirm the change. Reopen the account details before retrying.');
  if (data.csrfToken) token = data.csrfToken;
  return data;
}
async function load() {
  if (busy) { queuedPage = page; return false; }
  busy = true; window.QCULoading.button($('refresh'), true);
  $('message').textContent = 'Loading accounts…';
  try {
    const params = new URLSearchParams(new FormData($('filters'))); params.set('page', page);
    const data = await api('?' + params);
    page = data.page || page;
    $('workspace').hidden = false; $('signin').hidden = true; $('admin-identity').hidden = false;
    for (const [name, key] of [['campus','campuses'],['program','programs'],['section','sections']]) {
      const select = $('filters').elements[name], value = select.value;
      const first = select.options[0]; select.replaceChildren(first);
      for (const item of data.filters[key]) { const option = el('option',item.label); option.value = item.value; select.append(option); }
      select.value = value;
    }
    $('metrics').replaceChildren();
    for (const [key, label] of [['total','Total accounts'],['today','Registered today'],['week','Last 7 days'],['active','Onboarding complete'],['suspended','Suspended']]) {
      const metric = el('div', '', 'metric'); metric.append(el('span', label), el('strong', data.counts[key])); $('metrics').append(metric);
    }
    $('users').replaceChildren();
    for (const user of data.users) {
      const row = document.createElement('tr'); const name = el('td',''); name.append(el('strong',user.displayName || (user.accountStatus === 'DELETED' ? 'Deleted account' : user.accountStatus === 'CLOSED' ? 'Closed account' : 'Unnamed student')),el('small',user.email || user.userId)); row.append(name);
      const state = el('td',''); state.append(el('span',user.accountStatus,'badge ' + user.accountStatus)); row.append(state, el('td',({AUTHENTICATED:'Signed in',ONBOARDING:'In progress',ACTIVE:'Complete'})[user.onboardingState] || user.onboardingState),el('td',date(user.createdAt)),el('td',date(user.lastLoginAt)));
      const cell = el('td',''); const button = el('button','View'); button.type = 'button'; button.setAttribute('aria-label','View ' + (user.displayName || user.userId)); button.onclick = () => openUser(user.userId, button); cell.append(button); row.append(cell); $('users').append(row);
    }
    if (!data.users.length) { const row = el('tr',''); const cell = el('td','No accounts match these filters.'); cell.colSpan = 6; row.append(cell); $('users').append(row); }
    $('results').textContent = data.total + ' matching accounts'; $('page').textContent = 'Page ' + page;
    $('prev').disabled = page <= 1; $('next').disabled = page * data.pageSize >= data.total;
    $('updated').textContent = 'Updated ' + date(data.refreshedAt);
    $('audit').replaceChildren(...data.audit.map(event => el('li',date(event.occurredAt) + ' · ' + (actionNames[event.action.replace('admin.', '')] || event.action) + ' · ' + event.targetId + ' · ' + event.result)));
    if (!data.audit.length) $('audit').append(el('li','No administrative actions recorded yet.'));
    $('message').textContent = '';
    return true;
  } catch (error) {
    $('message').textContent = error.message;
    if ([401,403].includes(error.status)) { $('workspace').hidden = true; $('users').replaceChildren(); $('signin').hidden = false; }
    return false;
  } finally { window.QCULoading.button($('refresh'), false); window.QCULoading.finish('admin'); releaseBusy(); }
}
function record(title, entries) {
  const section = el('section',''); section.append(el('h3',title));
  for (const entry of entries) {
    const list = el('dl','','record');
    for (const [key,value] of Object.entries(entry)) {
      const label = key.replace(/_/g,' ').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/\bId\b/g,'ID').replace(/^./,letter => letter.toUpperCase());
      list.append(el('dt',label),el('dd',value));
    }
    section.append(list);
  }
  if (!entries.length) section.append(el('p','No records.'));
  return section;
}
async function openUser(id, button) {
  if (busy) return;
  selected = null; mutation = null;
  busy = true; $('message').textContent = 'Loading account details…';
  window.QCULoading.button(button, true);
  try {
    const data = await api('?userId=' + encodeURIComponent(id)); selected = data.user;
    $('detail-title').textContent = selected.displayName || (selected.accountStatus === 'DELETED' ? 'Deleted account' : 'Closed account');
    $('detail-content').replaceChildren(record('Account',[selected]),record('Profile',data.profiles),record('Enrollment',data.enrollments),record('Schedule',data.schedule),record('COR processing',data.cor),record('Records affected by deletion',[data.dependencies]));
    $('action-form').reset(); $('action-form').hidden = data.protected; $('action-message').textContent = '';
    for (const option of $('operation').options) {
      option.disabled = option.value === 'reactivate' ? selected.accountStatus !== 'SUSPENDED' : option.value === 'suspend' ? selected.accountStatus !== 'ACTIVE' : option.value === 'close' ? selected.accountStatus === 'CLOSED' : false;
    }
    $('operation').value = selected.accountStatus === 'SUSPENDED' ? 'reactivate' : selected.accountStatus === 'CLOSED' ? 'purge' : 'suspend';
    updateOperation();
    if (!$('details').open) $('details').showModal(); $('message').textContent = '';
  } catch (error) { $('message').textContent = error.message; }
  finally { window.QCULoading.button(button, false); releaseBusy(); }
}
function updateOperation() {
  const deleting = $('operation').value === 'purge';
  $('confirm-label').hidden = !deleting;
  $('confirm').required = deleting;
  $('confirm').value = '';
  $('ack').checked = false;
  $('apply').textContent = actionNames[$('operation').value];
  $('operation-help').textContent = deleting ? 'This closes the account, removes its student records, and moves its COR files to Drive Trash. The blocked identity and audit history remain.' : $('operation').value === 'reactivate' ? 'The student must sign in again after reactivation.' : 'Existing sessions will be revoked immediately.';
}
$('filters').addEventListener('reset', () => { clearTimeout(searchTimer); setTimeout(() => queueLoad(1), 0); });
$('filters').addEventListener('submit',event => event.preventDefault());
$('filters').addEventListener('input',() => { clearTimeout(searchTimer); searchTimer = setTimeout(() => queueLoad(1),350); });
$('prev').onclick = () => { if (!busy) { page--; load(); } };
$('next').onclick = () => { if (!busy) { page++; load(); } };
$('refresh').onclick = load;
$('close-dialog').onclick = () => { if (!$('apply').disabled) $('details').close(); };
$('details').addEventListener('cancel', event => { if ($('apply').disabled) event.preventDefault(); });
$('details').addEventListener('close', () => { selected = null; mutation = null; });
$('operation').onchange = updateOperation;
$('action-form').onsubmit = async event => {
  event.preventDefault(); if (busy || !selected) return;
  if (!$('action-form').reportValidity()) return;
  const body = { userId: selected.userId, version: selected.version, operation: $('operation').value, reason: $('reason').value.trim(), confirm: $('confirm').value.trim() };
  if (body.reason.length < 3) { $('action-message').textContent = 'Enter a reason with at least 3 characters.'; return; }
  if (body.operation === 'purge' && body.confirm !== body.userId) { $('action-message').textContent = 'Type the exact user ID shown in the account details.'; return; }
  const key = JSON.stringify(body);
  if (!mutation || mutation.key !== key) mutation = { key, id: crypto.randomUUID() };
  body.mutationId = mutation.id;
  busy = true; window.QCULoading.button($('apply'), true); $('action-message').textContent = 'Applying account change…';
  const controls = ['operation','reason','confirm','ack','close-dialog'].map($);
  controls.forEach(control => { control.disabled = true; });
  let saved = false;
  try {
    await api('', body);
    saved = true;
    $('account-result').hidden = false;
    $('account-result').textContent = ({ suspend: 'Account suspended.', reactivate: 'Account reactivated. The student can sign in again.', close: 'Account closed.', purge: 'Account deleted. Its blocked identity and audit history were retained.' })[body.operation];
    $('details').close();
  } catch (error) {
    $('action-message').textContent = error.message + (error.code === 'CONFLICT' ? ' Close and reopen these details to get the current account version.' : '');
  } finally {
    controls.forEach(control => { control.disabled = false; });
    window.QCULoading.button($('apply'), false);
    if (saved) queuedPage = page;
    releaseBusy();
  }
};
load();

// Do not restore private account data from browser back/forward navigation.
window.addEventListener('pagehide', () => {
  token = ''; selected = null; $('workspace').hidden = true;
  $('users').replaceChildren(); $('detail-content').replaceChildren();
  if ($('details').open) $('details').close();
});
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
