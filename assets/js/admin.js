'use strict';
const $ = id => document.getElementById(id);
let page = 1, token = '', selected = null, busy = false, searchTimer;
const date = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—';
function el(tag, text, className) { const node = document.createElement(tag); node.textContent = text ?? '—'; if (className) node.className = className; return node; }
async function api(params = '', body) {
  const response = await fetch('/api/admin/users' + params, { credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': token } : {}, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) {
    if ([401,403].includes(response.status)) {
      token = ''; selected = null; $('workspace').hidden = true; $('admin-identity').hidden = true;
      $('users').replaceChildren(); $('detail-content').replaceChildren(); $('audit').replaceChildren(); $('metrics').replaceChildren();
      if ($('details').open) $('details').close();
      window.location.replace('/?auth=admin_denied');
    }
    const error = new Error(data.error || 'Request failed. Please retry.'); error.status = response.status; throw error; }
  if (data.csrfToken) token = data.csrfToken;
  return data;
}
async function load() {
  if (busy) return;
  busy = true; $('refresh').disabled = true;
  $('message').textContent = 'Loading accounts…';
  try {
    const params = new URLSearchParams(new FormData($('filters'))); params.set('page', page);
    const data = await api('?' + params);
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
      const row = document.createElement('tr'); const name = el('td',''); name.append(el('strong',user.displayName || (user.accountStatus === 'CLOSED' ? 'Closed account' : 'Unnamed student')),el('small',user.email || user.userId)); row.append(name);
      const state = el('td',''); state.append(el('span',user.accountStatus,'badge ' + user.accountStatus)); row.append(state, el('td',({AUTHENTICATED:'Signed in',ONBOARDING:'In progress',ACTIVE:'Complete'})[user.onboardingState] || user.onboardingState),el('td',date(user.createdAt)),el('td',date(user.lastLoginAt)));
      const cell = el('td',''); const button = el('button','View'); button.type = 'button'; button.setAttribute('aria-label','View ' + (user.displayName || user.userId)); button.onclick = () => openUser(user.userId); cell.append(button); row.append(cell); $('users').append(row);
    }
    if (!data.users.length) { const row = el('tr',''); const cell = el('td','No accounts match these filters.'); cell.colSpan = 6; row.append(cell); $('users').append(row); }
    $('results').textContent = data.total + ' matching accounts'; $('page').textContent = 'Page ' + page;
    $('prev').disabled = page <= 1; $('next').disabled = page * data.pageSize >= data.total;
    $('updated').textContent = 'Updated ' + date(data.refreshedAt);
    $('audit').replaceChildren(...data.audit.map(event => el('li',date(event.occurredAt) + ' · ' + event.action + ' · ' + event.targetId + ' · ' + event.result)));
    if (!data.audit.length) $('audit').append(el('li','No administrative actions recorded yet.'));
    $('message').textContent = '';
  } catch (error) {
    $('message').textContent = error.message;
    if ([401,403].includes(error.status)) { $('workspace').hidden = true; $('users').replaceChildren(); $('signin').hidden = false; }
  } finally { busy = false; $('refresh').disabled = false; }
}
function record(title, entries) {
  const section = el('section',''); section.append(el('h3',title));
  for (const entry of entries) {
    const list = el('dl','','record');
    for (const [key,value] of Object.entries(entry)) { list.append(el('dt',key.replace(/([A-Z])/g,' $1')),el('dd',value)); }
    section.append(list);
  }
  if (!entries.length) section.append(el('p','No records.'));
  return section;
}
async function openUser(id) {
  if (busy) return;
  busy = true; $('message').textContent = 'Loading account details…';
  try {
    const data = await api('?userId=' + encodeURIComponent(id)); selected = data.user;
    $('detail-title').textContent = selected.displayName || 'Closed account';
    $('detail-content').replaceChildren(record('Account',[selected]),record('Profile',data.profiles),record('Enrollment',data.enrollments),record('Schedule',data.schedule),record('COR processing',data.cor),record('Records affected by deletion',[data.dependencies]));
    $('action-form').reset(); $('confirm').required = false; $('action-form').hidden = data.protected; $('confirm-label').hidden = true; $('action-message').textContent = '';
    if (!$('details').open) $('details').showModal(); $('message').textContent = '';
  } catch (error) { $('message').textContent = error.message; }
  finally { busy = false; }
}
$('filters').addEventListener('reset', () => { clearTimeout(searchTimer); setTimeout(() => { page = 1; load(); }, 0); });
$('filters').addEventListener('submit',event => event.preventDefault());
$('filters').addEventListener('input',() => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 1; load(); },350); });
$('prev').onclick = () => { if (!busy) { page--; load(); } };
$('next').onclick = () => { if (!busy) { page++; load(); } };
$('refresh').onclick = load;
$('close-dialog').onclick = () => $('details').close();
$('operation').onchange = () => { $('confirm-label').hidden = $('operation').value !== 'purge'; $('confirm').required = $('operation').value === 'purge'; $('ack').checked = false; };
$('action-form').onsubmit = async event => {
  event.preventDefault(); if (busy || !selected) return;
  busy = true; $('apply').disabled = true; $('action-message').textContent = 'Applying account change…';
  try {
    await api('',{ userId: selected.userId, version: selected.version, operation: $('operation').value, reason: $('reason').value.trim(), confirm: $('confirm').value, mutationId: crypto.randomUUID() });
    $('details').close(); busy = false; await load(); $('message').textContent = 'Account change saved and audited.';
  } catch (error) { $('action-message').textContent = error.message + ' Close and reopen the details to refresh before retrying.'; }
  finally { busy = false; $('apply').disabled = false; }
};
load();

// Do not restore private account data from browser back/forward navigation.
window.addEventListener('pagehide', () => {
  token = ''; selected = null; $('workspace').hidden = true;
  $('users').replaceChildren(); $('detail-content').replaceChildren();
  if ($('details').open) $('details').close();
});
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
