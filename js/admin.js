/* ============================================================
   NIXERS PRO — admin.js
   Admin-specific page logic.
   Depends on: dashboard.js  (must be loaded first)
   ============================================================ */

'use strict';

/* ============================================================
   1. DATA STORE
   ============================================================ */
const DB = window.APP_DATA?.DB;
if (!DB) {
  throw new Error('Missing shared data store. Load js/data.js before js/admin.js');
}

/* ============================================================
   2. ID COUNTERS
   ============================================================ */
const nextId = {};
['users', 'sites', 'categories', 'posts', 'groups', 'leaveRequests', 'holidays', 'timesheets',
  'payroll', 'projects', 'tasks', 'equipment', 'incidents', 'documents', 'notifications',
  'emailLog', 'auditLog', 'clients', 'tickets'].forEach(k => {
  nextId[k] = (DB[k]?.length || 0) + 1;
});

/* ============================================================
   3. ADMIN STATE
   ============================================================ */
let currentUser = DB.users[0];
window.currentUser = currentUser;   // expose to dashboard.js

let impersonating = null;
let currentGroup = null;
let currentSite = null;
let selectedUserIds = new Set();
let postAssignees = [];
let postVoiceRecording = false;
let projectTeamMembers = [];
let taskAssignees = [];
let taskVoiceRecording = false;
let taskAttachments = [];
let siteWorkers = [];
let leaveCalDate = new Date();
let shiftWeekOffset = 0;
let currentPayrollPeriod = '2025-06';

/* ============================================================
   4. ADMIN UTILITIES
   ============================================================ */
function userById(id)    { return DB.users.find(u => u.id === id); }
function siteById(id)    { return DB.sites.find(s => s.id === id); }
function catById(id)     { return DB.categories.find(c => c.id === id); }
function projectById(id) { return DB.projects.find(p => p.id === id); }

function taskAssigneeIds(task) {
  if (!task) return [];
  if (Array.isArray(task.assigneeIds) && task.assigneeIds.length) return task.assigneeIds.map(Number).filter(Boolean);
  return task.assigneeId ? [Number(task.assigneeId)] : [];
}

function fmtMoney(n) {
  if (typeof fmtMoneyWithSettings === 'function') return fmtMoneyWithSettings(n);
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function generateId(key) { return nextId[key]++; }

function logAction(action, target, details) {
  DB.auditLog.unshift({
    id: generateId('auditLog'),
    time: nowStr(),
    userId: currentUser.id,
    action, target, details,
    ip: '127.0.0.1',
    status: 'success'
  });
}

/* ============================================================
   5. PAGE RENDERER  (called by dashboard.js showPage)
   ============================================================ */
function renderPage(page) {
  const map = {
    dashboard:    renderDashboard,
    analytics:    renderAnalytics,
    reports:      renderReports,
    users:        renderUsers,
    leave:        renderLeave,
    timesheets:   renderTimesheets,
    payroll:      renderPayroll,
    tasks:        renderTasks,
    shifts:       renderShifts,
    equipment:    renderEquipment,
    sites:        renderSites,
    posts:        renderPosts,
    documents:    renderDocuments,
    categories:   renderCategories,
    messages:     renderMessages,
    notifications:renderNotifications,
    emailcenter:  renderEmailCenter,
    safety:       renderSafety,
    auditlog:     renderAuditLog,
    rbac:         renderRBAC,
    clientportal: renderClientPortal,
    settings:     renderSettings,
  };
  map[page]?.();
}

/* ============================================================
   6. DASHBOARD PAGE
   ============================================================ */
function renderDashboard() {
  const pendingUsers = DB.users.filter(u => u.status === 'pending').length;
  const pendingLeave = DB.leaveRequests.filter(l => l.status === 'pending').length;
  const pendingDocs  = DB.documents.filter(d => d.status === 'pending').length;
  const totalPending = pendingUsers + pendingLeave + pendingDocs;
  const bar = $('pendingBar');
  if (totalPending > 0) {
    bar.style.display = 'flex';
    $('pendingBarText').textContent = `${totalPending} pending approval${totalPending > 1 ? 's' : ''}: ${pendingUsers} users, ${pendingLeave} leave requests, ${pendingDocs} documents`;
    $('pendingBarActions').innerHTML = `
      <button class="btn btn-accent btn-sm" onclick="showPage('users')">Users</button>
      <button class="btn btn-outline btn-sm" onclick="showPage('leave')">Leave</button>
      <button class="btn btn-outline btn-sm" onclick="showPage('documents')">Docs</button>`;
  } else { bar.style.display = 'none'; }

  const activeUsers   = DB.users.filter(u => u.status === 'active').length;
  const activeSites   = DB.sites.filter(s => s.status === 'active').length;
  const openIncidents = DB.incidents.filter(i => i.status === 'open').length;
  const totalTasks    = DB.tasks.length;
  const doneTasks     = DB.tasks.filter(t => t.status === 'done').length;

  $('statsGrid').innerHTML =
    statCard('fa-users',              'blue',   activeUsers,                          'Active Users',       '+2 this month', 'up') +
    statCard('fa-building',           'yellow', activeSites,                          'Active Sites',       '',              'flat') +
    statCard('fa-list-check',         'green',  doneTasks + '/' + totalTasks,         'Tasks Complete',     '',              'flat') +
    statCard('fa-money-bill-wave',    'purple', fmtMoney(DB.payroll.reduce((s, p) => s + netPay(p), 0)), 'Total Payroll', 'This month', 'flat') +
    statCard('fa-triangle-exclamation','red',   openIncidents,                        'Open Incidents',     openIncidents > 0 ? 'Action needed' : 'All clear', openIncidents > 0 ? 'down' : 'up') +
    statCard('fa-folder-open',        'orange', DB.documents.filter(d => d.status === 'pending').length, 'Docs Pending Review', '', 'flat');

  syncNotifBadge();

  const nbUsers = $('nbUsers');
  if (nbUsers) { nbUsers.textContent = pendingUsers; nbUsers.style.display = pendingUsers > 0 ? '' : 'none'; }

  setTimeout(() => {
    renderMainChart();
    renderRoleChart();
    renderTaskChart();
    renderActivityFeed();
    renderSysHealth();
    renderDashAudit();
  }, 50);
}

function renderMainChart() {
  makeChart('mainChart', {
    type: 'bar',
    data: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      datasets: [
        { label: 'Completed',   data: [4, 6, 3, 8, 5, 2, 1], backgroundColor: 'rgba(234,179,8,0.8)',  borderRadius: 6 },
        { label: 'In Progress', data: [2, 3, 5, 2, 4, 1, 0], backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 6 },
      ]
    },
    options: { ...chartDefaults() }
  });
}

function renderRoleChart() {
  const counts = ['admin', 'manager', 'worker'].map(r => DB.users.filter(u => u.role === r).length);
  makeChart('roleChart', {
    type: 'doughnut',
    data: {
      labels: ['Admin', 'Manager', 'Worker'],
      datasets: [{ data: counts, backgroundColor: ['rgba(139,92,246,0.8)', 'rgba(234,179,8,0.8)', 'rgba(59,130,246,0.8)'], borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: chartTextColor(), font: { family: 'DM Sans', size: 11 } } } }, cutout: '65%' }
  });
}

function renderTaskChart() {
  const cols   = ['todo', 'inprogress', 'review', 'done'];
  const labels = ['To Do', 'In Progress', 'Review', 'Done'];
  const counts = cols.map(c => DB.tasks.filter(t => t.status === c).length);
  makeChart('taskChart', {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Tasks', data: counts, backgroundColor: ['rgba(100,116,139,0.7)', 'rgba(234,179,8,0.7)', 'rgba(59,130,246,0.7)', 'rgba(16,185,129,0.7)'], borderRadius: 6 }] },
    options: { ...chartDefaults(), indexAxis: 'y', plugins: { legend: { display: false } } }
  });
}

function renderActivityFeed() {
  const feed = $('actFeed');
  const icons = { login: 'fa-sign-in-alt', logout: 'fa-sign-out-alt', create: 'fa-plus', update: 'fa-pen', delete: 'fa-trash', approve: 'fa-check', reject: 'fa-times', impersonate: 'fa-user-secret' };
  feed.innerHTML = DB.auditLog.slice(0, 8).map(l => {
    const u = userById(l.userId);
    return `<div style="display:flex;gap:0.6rem;align-items:flex-start;padding:0.4rem 0;border-bottom:1px solid var(--border);">
      <div style="width:28px;height:28px;border-radius:7px;background:var(--accent-glow);display:flex;align-items:center;justify-content:center;font-size:0.72rem;flex-shrink:0;color:var(--accent);">
        <i class="fas ${icons[l.action] || 'fa-circle'}"></i></div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.78rem;font-weight:500;">${u?.name || 'System'} <span style="color:var(--text3);">${l.action}</span> ${l.target}</div>
        <div style="font-size:0.68rem;color:var(--text3);">${l.time}</div>
      </div></div>`;
  }).join('') || '<div class="empty-state"><i class="fas fa-rss"></i>No recent activity</div>';
}

function renderSysHealth() {
  const storePct = 24;
  $('sysHealthGrid').innerHTML = `
    <div class="sys-health-item"><div class="sh-label">Storage</div><div class="sh-val" style="color:var(--accent);">2.4 / 10 MB</div><div class="pb sh-bar" style="height:5px;"><div class="pb-fill" style="width:${storePct}%;"></div></div></div>
    <div class="sys-health-item"><div class="sh-label">Active Users</div><div class="sh-val">${DB.users.filter(u => u.online === 'online').length} online</div></div>
    <div class="sys-health-item"><div class="sh-label">Pending Notifications</div><div class="sh-val">${DB.notifications.filter(n => !n.read).length} unread</div></div>
    <div class="sys-health-item"><div class="sh-label">Last Backup</div><div class="sh-val" style="color:#34d399;">Today 03:00</div></div>`;
}

function renderDashAudit() {
  $('dashAuditBody').innerHTML = DB.auditLog.slice(0, 5).map(l => {
    const u = userById(l.userId);
    return `<tr><td>${l.time}</td><td>${avatarEl(u, 24)} ${u?.name || '?'}</td><td>${l.action}</td><td>${l.target}</td><td><code style="font-size:0.72rem;">${l.ip}</code></td></tr>`;
  }).join('');
}

/* ============================================================
   7. USERS PAGE
   ============================================================ */
function renderUsers() {
  populateUserFilterSelects();
  wireUserFilters();
  wireUserBulk();
  $('addUserBtn')?.addEventListener('click', () => openUserModal());
  $('csvImportBtn')?.addEventListener('click', () => $('csvImportFile').click());
  $('csvImportFile')?.addEventListener('change', handleCSVImport);
  $('resetF')?.addEventListener('click', () => {
    ['fName', 'fEmail', 'fPhone', 'fRole', 'fStatus'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    filterAndUpdateUsers();
  });
  $$('[data-utab]').forEach(btn => btn.addEventListener('click', () => {
    $$('[data-utab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterAndUpdateUsers(btn.dataset.utab);
  }));
  filterAndUpdateUsers();
}

function populateUserFilterSelects() {
  const tsUser = $('tsUser');
  if (tsUser) tsUser.innerHTML = '<option value="">All Employees</option>' + DB.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  const docUser = $('docUser');
  if (docUser) docUser.innerHTML = '<option value="">All Employees</option>' + DB.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
}

function wireUserFilters() {
  ['fName', 'fEmail', 'fPhone', 'fRole', 'fStatus'].forEach(id => {
    $(id)?.addEventListener('input', () => filterAndUpdateUsers());
  });
}

function wireUserBulk() {
  $('selectAll')?.addEventListener('change', e => {
    let visibleUsers = window.paginators['uTbody'] ? window.paginators['uTbody'].getCurrentPageData() : DB.users;
    $$('.row-check').forEach(cb => { cb.checked = e.target.checked; });
    if (e.target.checked) visibleUsers.forEach(u => selectedUserIds.add(u.id));
    else visibleUsers.forEach(u => selectedUserIds.delete(u.id));
    updateBulkBar();
  });
  $('bulkActivate')?.addEventListener('click', () => {
    selectedUserIds.forEach(id => { const u = userById(id); if (u) u.status = 'active'; });
    selectedUserIds.clear(); filterAndUpdateUsers(); updateBulkBar(); toast('Users activated', 'success');
  });
  $('bulkDeactivate')?.addEventListener('click', () => {
    selectedUserIds.forEach(id => { const u = userById(id); if (u) u.status = 'inactive'; });
    selectedUserIds.clear(); filterAndUpdateUsers(); updateBulkBar(); toast('Users deactivated', 'warn');
  });
  $('bulkDelete')?.addEventListener('click', () => {
    if (!confirm(`Delete ${selectedUserIds.size} users?`)) return;
    DB.users.splice(0, DB.users.length, ...DB.users.filter(u => !selectedUserIds.has(u.id)));
    selectedUserIds.clear(); filterAndUpdateUsers(); updateBulkBar(); toast('Users deleted', 'success');
  });
  $('bulkClear')?.addEventListener('click', () => {
    selectedUserIds.clear();
    $$('.row-check').forEach(cb => cb.checked = false);
    if ($('selectAll')) $('selectAll').checked = false;
    updateBulkBar();
  });
}

function updateBulkBar() {
  const bar = $('bulkBar');
  if (!bar) return;
  bar.style.display = selectedUserIds.size > 0 ? 'flex' : 'none';
  $('bulkCount').textContent = `${selectedUserIds.size} selected`;
}

function filterAndUpdateUsers(tab = 'all') {
  const name   = $('fName')?.value.toLowerCase()  || '';
  const email  = $('fEmail')?.value.toLowerCase() || '';
  const phone  = $('fPhone')?.value.toLowerCase() || '';
  const role   = $('fRole')?.value  || '';
  const status = $('fStatus')?.value || '';

  let filteredUsers = DB.users.filter(u => {
    if (tab === 'pending' && u.status !== 'pending') return false;
    if (name  && !u.name.toLowerCase().includes(name))   return false;
    if (email && !u.email.toLowerCase().includes(email)) return false;
    if (phone && !u.phone.toLowerCase().includes(phone)) return false;
    if (role  && u.role !== role)   return false;
    if (status && u.status !== status) return false;
    return true;
  });

  $('uCount').textContent = `${filteredUsers.length} user${filteredUsers.length !== 1 ? 's' : ''}`;
  $('pendingCount').textContent = DB.users.filter(u => u.status === 'pending').length;
  $('pendingCount').style.display = DB.users.filter(u => u.status === 'pending').length > 0 ? '' : 'none';

  createPaginator('uTbody', filteredUsers, data => renderUserTableBody(data, tab), { perPage: 10 });
}

function renderUserTableBody(users, tab) {
  $('uTbody').innerHTML = users.length ? users.map(u => {
    const globalIndex = DB.users.findIndex(x => x.id === u.id) + 1;
    return `
      <tr>
        <td><input type="checkbox" class="row-check" data-uid="${u.id}" ${selectedUserIds.has(u.id) ? 'checked' : ''}></td>
        <td style="color:var(--text3);font-size:0.75rem;">${globalIndex}</td>
        <td><div class="user-cell">${avatarEl(u)} <div><div style="font-weight:600;">${u.name}</div><div style="font-size:0.72rem;color:var(--text3);">${u.empId}</div></div></div></td>
        <td>${u.email}</td>
        <td>${u.phone}</td>
        <td>${roleBadge(u.role)}</td>
        <td>${u.dept || '—'}</td>
        <td>${statusBadge(u.status)}</td>
        <td>${onlineDot(u)}</td>
        <td style="font-size:0.75rem;">${fmt(u.registered)}</td>
        <td style="font-size:0.75rem;">${u.lastLogin}</td>
        <td>
          <div style="display:flex;gap:0.2rem;flex-wrap:wrap;">
            <button class="abt inf" title="View Profile" onclick="openProfileModal(${u.id})"><i class="fas fa-eye"></i></button>
            <button class="abt warn" title="Edit" onclick="openUserModal(${u.id})"><i class="fas fa-pen"></i></button>
            ${u.status === 'pending' ? `<button class="abt suc" title="Approve" onclick="openApprovalModal(${u.id})"><i class="fas fa-check"></i></button>` : ''}
            <button class="abt" title="Switch to User" onclick="impersonateUser(${u.id})"><i class="fas fa-user-secret"></i></button>
            <button class="abt dan" title="Delete" onclick="deleteUser(${u.id})"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
  }).join('') : '<tr><td colspan="12"><div class="empty-state"><i class="fas fa-users"></i>No users found</div></td></tr>';

  $$('.row-check').forEach(cb => {
    cb.removeEventListener('change', handleRowCheck);
    cb.addEventListener('change', handleRowCheck);
  });
}

function renderUserTable() { filterAndUpdateUsers(); }

function handleRowCheck(e) {
  const uid = +e.target.dataset.uid;
  e.target.checked ? selectedUserIds.add(uid) : selectedUserIds.delete(uid);
  updateBulkBar();
  const selectAll = $('selectAll');
  if (selectAll) {
    const currentPageUsers = window.paginators['uTbody']?.getCurrentPageData() || [];
    selectAll.checked = currentPageUsers.length > 0 && currentPageUsers.every(u => selectedUserIds.has(u.id));
  }
}

function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  const idx = DB.users.findIndex(u => u.id === id);
  if (idx > -1) {
    DB.users.splice(idx, 1);
    logAction('delete', `User #${id}`, 'User deleted');
    filterAndUpdateUsers();
    toast('User deleted', 'success');
  }
}

function handleCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const lines = ev.target.result.split('\n').filter(Boolean);
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    let added = 0;
    lines.slice(1).forEach(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, i) => obj[h] = vals[i]);
      if (obj.name && obj.email) {
        DB.users.push({
          id: generateId('users'), name: obj.name, email: obj.email, phone: obj.phone || '',
          role: obj.role || 'worker', dept: obj.dept || '', status: 'pending',
          empId: `EMP-${String(nextId.users).padStart(4, '0')}`, idNum: '', natId: '', dob: '',
          hired: nowStr().slice(0, 10), salary: 0, addr: '', emerg: '', bio: '',
          avatarColor: '#eab308', avatarImg: '', lastLogin: 'Never',
          registered: nowStr().slice(0, 10), online: 'offline'
        });
        added++;
      }
    });
    filterAndUpdateUsers();
    toast(`Imported ${added} users`, 'success');
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ============================================================
   8. USER MODAL
   ============================================================ */
function openUserModal(userId = null) { openProfileModal(userId); }

/* ============================================================
   9. PROFILE MODAL
   ============================================================ */
function openProfileModal(userId = null, tab = 'pmEdit') {
  currentSite = null;
  const user = userId ? userById(userId) : {
    id: null, name: '', email: '', phone: '', role: 'worker', dept: '', status: 'active',
    empId: '', idNum: '', natId: '', dob: '', hired: '', salary: 0, addr: '', emerg: '',
    bio: '', avatarColor: '#eab308', avatarImg: '', registered: '', lastLogin: '', online: 'offline'
  };

  $('pmTitle').textContent  = userId ? 'Edit Profile' : 'Add User';
  $('pmName2').textContent  = user.name || 'New User';
  $('pmRole2').textContent  = user.role || '';
  $('pmFName').value  = user.name;
  $('pmEmail').value  = user.email;
  $('pmPhone').value  = user.phone;
  $('pmRole').value   = user.role;
  $('pmStatus').value = user.status;
  $('pmDept').value   = user.dept;
  $('pmEmpId').value  = user.empId;
  $('pmIdNum').value  = user.idNum;
  $('pmNatId').value  = user.natId;
  $('pmDob').value    = user.dob;
  $('pmHired').value  = user.hired;
  $('pmSalary').value = user.salary;
  $('pmAddr').value   = user.addr;
  $('pmEmerg').value  = user.emerg;
  $('pmBio').value    = user.bio;
  if ($('pmNewPassword'))     $('pmNewPassword').value = '';
  if ($('pmConfirmPassword')) $('pmConfirmPassword').value = '';
  if ($('pmPasswordStrength')) $('pmPasswordStrength').innerHTML = '';

  const avInit = $('pmAvInit'), avImg = $('pmAvImg');
  avInit.textContent = initials(user.name) || '?';
  avInit.style.color = user.avatarColor || '#eab308';
  if (user.avatarImg) { avImg.src = user.avatarImg; avImg.style.display = 'block'; avInit.style.display = 'none'; }
  else { avImg.style.display = 'none'; avInit.style.display = ''; }

  const colors = ['#eab308', '#3b82f6', '#10b981', '#8b5cf6', '#f43f5e', '#f97316', '#06b6d4', '#84cc16'];
  $('avColorOpts').innerHTML = colors.map(c =>
    `<div class="av-color-opt${user.avatarColor === c ? ' sel' : ''}" style="background:${c}22;color:${c};border-color:${user.avatarColor === c ? c : 'transparent'};" data-color="${c}" onclick="pickAvatarColor(this,'${c}')">${initials(user.name) || '?'}</div>`
  ).join('');

  switchPMTab(tab);
  if (userId) renderPMPerf(user);
  renderPMDocs(userId);
  renderPMHist(userId);
  renderIdCard(user);

  $('pmSaveBtn').onclick = () => savePMUser(userId);
  $('avUploadDrop')?.addEventListener('click', () => $('avatarFileInput').click());
  $('avatarFileInput').onchange = e => handleAvatarUpload(e, userId);
  if ($('pmNewPassword')) $('pmNewPassword').addEventListener('input', checkPMPasswordStrength);
  if ($('pmSendResetLink')) $('pmSendResetLink').onclick = () => sendPasswordResetLinkToUser(userId || currentUser.id);

  openM('profileModal');
}

function switchPMTab(tabId) {
  ['pmEdit', 'pmPerf', 'pmDocs', 'pmHist', 'pmIdCard'].forEach(id => {
    const el = $(id); if (el) el.style.display = id === tabId ? '' : 'none';
  });
  $$('.pm-tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.pmtab === tabId));
  $$('.pm-tab-btn').forEach(btn => { btn.onclick = () => switchPMTab(btn.dataset.pmtab); });
}

function pickAvatarColor(el, color) {
  $$('#avColorOpts .av-color-opt').forEach(o => { o.classList.remove('sel'); o.style.borderColor = 'transparent'; });
  el.classList.add('sel'); el.style.borderColor = color;
}

function handleAvatarUpload(e, userId) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const src = ev.target.result;
    const avImg = $('pmAvImg'), avInit = $('pmAvInit');
    avImg.src = src; avImg.style.display = 'block'; avInit.style.display = 'none';
    if (userId) { const u = userById(userId); if (u) u.avatarImg = src; }
    updateTopbarAvatar();
  };
  reader.readAsDataURL(file);
}

function checkPMPasswordStrength() {
  const password = $('pmNewPassword')?.value || '';
  const strengthEl = $('pmPasswordStrength');
  if (!strengthEl) return;
  if (!password.length) { strengthEl.innerHTML = ''; return; }
  let strength = 0;
  if (password.length >= 8)  strength++;
  if (password.length >= 12) strength++;
  if (/\d/.test(password))          strength++;
  if (/[A-Z]/.test(password))       strength++;
  if (/[a-z]/.test(password))       strength++;
  if (/[^A-Za-z0-9]/.test(password)) strength++;
  const message = strength <= 2 ? 'Weak password' : strength <= 4 ? 'Medium password' : 'Strong password';
  const color   = strength <= 2 ? '#f87171' : strength <= 4 ? '#f97316' : '#34d399';
  strengthEl.innerHTML = `<div style="display:flex;align-items:center;gap:0.5rem;"><div style="flex:1;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;"><div style="width:${(strength / 6) * 100}%;height:100%;background:${color};border-radius:2px;"></div></div><span style="color:${color};">${message}</span></div>`;
}

function sendPasswordResetLinkToUser(userId) {
  const user = userById(userId);
  if (!user?.email) { toast('No email address found for this user', 'error'); return; }
  const resetToken = generateResetToken();
  if (!DB.passwordResetTokens) DB.passwordResetTokens = {};
  DB.passwordResetTokens[resetToken] = { email: user.email, userId, expires: Date.now() + 3600000 };
  sendEmail(user.email, 'Password Reset Request', 'password_reset');
  toast(`Password reset link sent to ${user.email}`, 'success');
  logAction('request', 'Password Reset', `Reset link sent to ${user.name} (${user.email})`);
}

function generateResetToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function savePMUser(userId) {
  const data = {
    name:   $('pmFName').value.trim(),  email:  $('pmEmail').value.trim(),
    phone:  $('pmPhone').value.trim(),  role:   $('pmRole').value,
    status: $('pmStatus').value,        dept:   $('pmDept').value.trim(),
    empId:  $('pmEmpId').value.trim(),  idNum:  $('pmIdNum').value.trim(),
    natId:  $('pmNatId').value.trim(),  dob:    $('pmDob').value,
    hired:  $('pmHired').value,         salary: +$('pmSalary').value,
    addr:   $('pmAddr').value.trim(),   emerg:  $('pmEmerg').value.trim(),
    bio:    $('pmBio').value.trim(),
  };
  if (!data.name || !data.email) { toast('Name and email required', 'error'); return; }

  const selColor = document.querySelector('#avColorOpts .av-color-opt.sel');
  if (selColor) data.avatarColor = selColor.dataset.color;

  const newPassword    = $('pmNewPassword')?.value;
  const confirmPassword = $('pmConfirmPassword')?.value;
  if (newPassword || confirmPassword) {
    if (newPassword !== confirmPassword) { toast('Passwords do not match', 'error'); return; }
    const minLength = DB.settings?.passwordMinLen || 8;
    if (newPassword.length < minLength) { toast(`Password must be at least ${minLength} characters`, 'error'); return; }
    data.password = newPassword;
  }

  if (userId) {
    const u = userById(userId);
    Object.assign(u, data);
    if (data.password) { if (!DB.userPasswords) DB.userPasswords = {}; DB.userPasswords[userId] = data.password; }
    logAction('update', `User #${userId}`, `Updated ${data.name}`);
    toast('Profile saved', 'success');
  } else {
    const newUser = { id: generateId('users'), ...data, avatarImg: '', avatarColor: data.avatarColor || '#eab308', lastLogin: 'Never', registered: nowStr().slice(0, 10), online: 'offline' };
    DB.users.push(newUser);
    if (data.password) { if (!DB.userPasswords) DB.userPasswords = {}; DB.userPasswords[newUser.id] = data.password; }
    logAction('create', `User #${newUser.id}`, `Created ${data.name}`);
    toast('User created', 'success');
  }

  closeM('profileModal');
  if ($('page-users')?.style.display !== 'none') renderUserTable();
  updateTopbarAvatar();
}

function renderPMPerf(user) {
  const userTasks = DB.tasks.filter(t => taskAssigneeIds(t).includes(user.id));
  $('pf_tasks').textContent    = userTasks.filter(t => t.status === 'done').length;
  $('pf_proc').textContent     = userTasks.filter(t => t.status === 'inprogress').length;
  $('pf_pend').textContent     = userTasks.filter(t => t.status === 'todo').length;
  $('pf_issues').textContent   = DB.incidents.filter(i => i.reporterId === user.id).length;
  $('pf_rating').textContent   = '4.2';
  $('pf_attendance').textContent = '96%';
  setTimeout(() => {
    destroyChart('pmPerfChart');
    makeChart('pmPerfChart', {
      type: 'line',
      data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'], datasets: [{ label: 'Tasks Done', data: [2, 4, 3, 6, 5, 8, userTasks.filter(t => t.status === 'done').length], borderColor: '#eab308', backgroundColor: 'rgba(234,179,8,0.1)', fill: true, tension: 0.4 }] },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } }
    });
  }, 150);
}

function renderPMDocs(userId) {
  const docs = userId ? DB.documents.filter(d => d.userId === userId) : [];
  $('pmDocsList').innerHTML = docs.length ? docs.map(d =>
    `<div class="att-file"><i class="fas fa-file"></i><span>${d.name} <span class="badge b-${d.status}" style="margin-left:0.35rem;">${d.status}</span></span><span style="font-size:0.72rem;color:var(--text3);">Expires ${fmt(d.expiry)}</span></div>`
  ).join('') : '<div class="empty-state"><i class="fas fa-folder-open"></i>No documents</div>';
}

function renderPMHist(userId) {
  const logs = DB.auditLog.filter(l => l.userId === userId).slice(0, 10);
  $('pmHistList').innerHTML = logs.length ? logs.map(l =>
    `<div style="display:flex;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;"><span style="color:var(--text3);min-width:120px;">${l.time}</span><span class="badge b-${l.action}">${l.action}</span><span>${l.target} — ${l.details}</span></div>`
  ).join('') : '<div class="empty-state"><i class="fas fa-history"></i>No history</div>';
}

function renderIdCard(user) {
  const u = typeof user === 'number' ? userById(user) : user;
  $('icAv').textContent    = initials(u.name);
  $('icName').textContent  = u.name;
  $('icRole').textContent  = u.role?.toUpperCase();
  $('icEmpId').textContent = u.empId  || '—';
  $('icIdNum').textContent = u.idNum  || '—';
  $('icDept').textContent  = u.dept   || '—';
  $('icHired').textContent = fmt(u.hired);
  $('icBarcode').textContent = u.idNum || `NX-${String(u.id).padStart(3, '0')}-${new Date().getFullYear()}`;
  $('icInfoGrid').innerHTML = `
    <div class="info-item"><div class="il">Email</div><div class="iv">${u.email}</div></div>
    <div class="info-item"><div class="il">Phone</div><div class="iv">${u.phone}</div></div>
    <div class="info-item"><div class="il">National ID</div><div class="iv">${u.natId || '—'}</div></div>
    <div class="info-item"><div class="il">DOB</div><div class="iv">${fmt(u.dob)}</div></div>`;
}

$('printIdBtn')?.addEventListener('click', () => window.print());

/* ============================================================
   10. APPROVAL MODAL
   ============================================================ */
function openApprovalModal(userId) {
  const u = userById(userId);
  if (!u) return;
  $('approvalInfo').innerHTML = `<div class="user-cell">${avatarEl(u, 36)}<div><div style="font-weight:600;">${u.name}</div><div style="font-size:0.75rem;color:var(--text3);">${u.email} · ${u.role}</div></div></div>`;
  $('approvalApproveBtn').onclick = () => decideUserApproval(userId, 'active');
  $('approvalRejectBtn').onclick  = () => decideUserApproval(userId, 'inactive');
  openM('approvalModal');
}

function decideUserApproval(userId, decision) {
  const u = userById(userId);
  if (!u) return;
  u.status = decision;
  const comment = $('approvalComment')?.value || '';
  logAction(decision === 'active' ? 'approve' : 'reject', `User #${userId}`, `${decision === 'active' ? 'Approved' : 'Rejected'} ${u.name}. ${comment}`);
  closeM('approvalModal');
  renderUserTable();
  toast(`User ${decision === 'active' ? 'approved' : 'rejected'}`, decision === 'active' ? 'success' : 'warn');
  sendEmail(u.email, decision === 'active' ? 'Welcome to Nixers Pro' : 'Account not approved', 'welcome_approved');
}

/* ============================================================
   11. SITES PAGE
   ============================================================ */
function renderSites() {
  $('addSiteBtn')?.addEventListener('click', () => openSiteModal());
  filterAndUpdateSites();
}

function filterAndUpdateSites() {
  createPaginator('sTbody', [...DB.sites], renderSiteTableBody, { perPage: 10 });
}

function renderSiteTableBody(sites) {
  if (!sites.length) { $('sTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-building"></i>No sites found</div></td></tr>'; return; }
  $('sTbody').innerHTML = sites.map(s => {
    const mgr = userById(s.managerId);
    const workers = s.workerIds?.length || 0;
    return `<tr>
      <td><div style="font-weight:600;">${s.name}</div></td>
      <td><div class="user-cell">${avatarEl(mgr, 26)}<span style="font-size:0.82rem;">${mgr?.name || '—'}</span></div></td>
      <td>${workers}</td>
      <td><div style="display:flex;align-items:center;gap:0.5rem;min-width:100px;"><div class="pb" style="flex:1;height:7px;"><div class="pb-fill" style="width:${s.progress}%;"></div></div><span style="font-size:0.75rem;color:var(--text3);">${s.progress}%</span></div></td>
      <td>${fmtMoney(s.budget)}</td>
      <td>${fmtMoney(s.spent)}</td>
      <td>${statusBadge(s.status)}</td>
      <td style="font-size:0.78rem;">${fmt(s.endDate)}</td>
      <td>
        <button class="abt inf" onclick="openSiteDetail(${s.id})"><i class="fas fa-eye"></i></button>
        <button class="abt warn" onclick="openSiteModal(${s.id})"><i class="fas fa-pen"></i></button>
        <button class="abt dan" onclick="deleteSite(${s.id})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function renderSiteTable() { filterAndUpdateSites(); }

function searchSiteWorkers(q = '') {
  const res = $('sm_workerResults');
  if (!res) return;
  const query = q.trim().toLowerCase();
  if (!query) { res.classList.remove('show'); return; }
  const workers = DB.users.filter(u => u.role === 'worker' && u.status === 'active' && !siteWorkers.includes(u.id) && u.name.toLowerCase().includes(query));
  res.innerHTML = workers.length
    ? workers.map(w => `<div class="assign-opt" onclick="addSiteWorker(${w.id})">${avatarEl(w, 24)}<span>${w.name}</span><span style="font-size:0.7rem;color:var(--text3);margin-left:auto;">${w.dept || 'Worker'}</span></div>`).join('')
    : '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No workers found</div>';
  res.classList.add('show');
}

function addSiteWorker(id) {
  if (!siteWorkers.includes(id)) siteWorkers.push(id);
  renderSiteWorkerTags();
  $('sm_workerResults').classList.remove('show');
  $('sm_workerSearch').value = '';
}

function removeSiteWorker(id) {
  siteWorkers = siteWorkers.filter(x => x !== id);
  renderSiteWorkerTags();
}

function renderSiteWorkerTags() {
  const container = $('sm_workerTags');
  if (!container) return;
  if (!siteWorkers.length) { container.innerHTML = '<div style="font-size:0.78rem;color:var(--text3);padding:0.35rem 0;">No workers assigned</div>'; return; }
  container.innerHTML = siteWorkers.map(id => { const u = userById(id); return `<div class="assign-tag">${u?.name || id}<button onclick="removeSiteWorker(${id})">×</button></div>`; }).join('');
}

function openSiteModal(siteId = null) {
  const managers = DB.users.filter(u => u.role === 'manager');
  $('sm_mgr').innerHTML = managers.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  const s = siteId ? siteById(siteId) : null;
  siteWorkers = s?.workerIds ? [...s.workerIds] : [];
  $('smTitle').textContent = s ? 'Edit Site' : 'Add Site';
  $('sm_name').value   = s?.name    || '';
  $('sm_mgr').value    = s?.managerId || managers[0]?.id || '';
  $('sm_budget').value = s?.budget  || '';
  $('sm_spent').value  = s?.spent   || '';
  $('sm_status').value = s?.status  || 'planning';
  $('sm_start').value  = s?.startDate || '';
  $('sm_end').value    = s?.endDate   || '';
  $('sm_prog').value   = s?.progress  || 0;
  $('sm_desc').value   = s?.desc      || '';
  renderSiteWorkerTags();
  const workerSearch = $('sm_workerSearch');
  if (workerSearch) workerSearch.oninput = e => searchSiteWorkers(e.target.value);
  setTimeout(() => {
    document.addEventListener('click', function closeSWR(e) {
      if (!e.target.closest('#sm_workerSearch') && !e.target.closest('#sm_workerResults')) {
        $('sm_workerResults')?.classList.remove('show');
      }
    });
  }, 100);
  $('sm_save').onclick = () => saveSite(siteId);
  openM('siteModal');
}

function saveSite(siteId) {
  const data = {
    name: $('sm_name').value.trim(), managerId: +$('sm_mgr').value,
    budget: +$('sm_budget').value || 0, spent: +$('sm_spent').value || 0,
    status: $('sm_status').value, startDate: $('sm_start').value, endDate: $('sm_end').value,
    progress: +$('sm_prog').value || 0, desc: $('sm_desc').value.trim(), workerIds: [...siteWorkers],
  };
  if (!data.name) { toast('Site name required', 'error'); return; }
  if (siteId) { const site = siteById(siteId); if (site) { Object.assign(site, data); logAction('update', `Site #${siteId}`, `Updated ${data.name}`); } }
  else { DB.sites.push({ id: generateId('sites'), ...data }); logAction('create', 'Site', `Created ${data.name}`); }
  closeM('siteModal'); filterAndUpdateSites(); toast('Site saved', 'success');
}

function deleteSite(id) {
  if (!confirm('Delete this site?')) return;
  DB.sites.splice(DB.sites.findIndex(s => s.id === id), 1);
  logAction('delete', `Site #${id}`, 'Site deleted'); filterAndUpdateSites(); toast('Site deleted', 'success');
}

function openSiteDetail(siteId) {
  const s = siteById(siteId);
  if (!s) return;
  const mgr = userById(s.managerId);
  const workers = (s.workerIds || []).map(id => userById(id)).filter(Boolean);
  $('sdTitle').textContent = s.name;
  $('sdBody').innerHTML = `
    <div class="info-grid" style="margin-bottom:1rem;">
      <div class="info-item"><div class="il">Manager</div><div class="iv">${mgr?.name || '—'}</div></div>
      <div class="info-item"><div class="il">Status</div><div class="iv">${statusBadge(s.status)}</div></div>
      <div class="info-item"><div class="il">Budget</div><div class="iv">${fmtMoney(s.budget)}</div></div>
      <div class="info-item"><div class="il">Spent</div><div class="iv">${fmtMoney(s.spent)}</div></div>
      <div class="info-item"><div class="il">Start</div><div class="iv">${fmt(s.startDate)}</div></div>
      <div class="info-item"><div class="il">End</div><div class="iv">${fmt(s.endDate)}</div></div>
    </div>
    <div style="margin-bottom:1rem;"><div class="il fl">Progress</div>
      <div class="pb" style="height:10px;"><div class="pb-fill" style="width:${s.progress}%;"></div></div>
      <div style="font-size:0.75rem;color:var(--text3);margin-top:0.25rem;">${s.progress}% complete</div>
    </div>
    <div class="il fl">Workers (${workers.length})</div>
    <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.35rem;">
      ${workers.map(w => `<div class="user-cell" style="background:var(--surface2);padding:0.35rem 0.65rem;border-radius:8px;">${avatarEl(w, 24)}<span style="font-size:0.8rem;">${w.name}</span></div>`).join('') || '<span style="color:var(--text3);font-size:0.82rem;">No workers assigned</span>'}
    </div>
    ${s.desc ? `<hr class="div"><div style="font-size:0.83rem;">${s.desc}</div>` : ''}`;
  openM('siteDetailModal');
}

/* ============================================================
   12. POSTS PAGE
   ============================================================ */
function renderPosts() {
  populateCatFilter();
  filterAndUpdatePosts();
  $('addPostBtn')?.addEventListener('click', () => openPostModal());
  $('fPost')?.addEventListener('input', filterAndUpdatePosts);
  $('fVis')?.addEventListener('change', filterAndUpdatePosts);
  $('fCat')?.addEventListener('change', filterAndUpdatePosts);
}

function populateCatFilter() {
  const el = $('fCat'); if (!el) return;
  el.innerHTML = '<option value="">All Categories</option>' + DB.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const pmCat = $('pm_cat'); if (!pmCat) return;
  pmCat.innerHTML = DB.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function filterAndUpdatePosts() {
  const q   = $('fPost')?.value.toLowerCase() || '';
  const vis = $('fVis')?.value  || '';
  const cat = $('fCat')?.value  || '';
  const filtered = DB.posts.filter(p => {
    if (q   && !p.title.toLowerCase().includes(q)) return false;
    if (vis && p.visibility !== vis) return false;
    if (cat && p.catId !== +cat)     return false;
    return true;
  });
  createPaginator('pTbody', filtered, renderPostTableBody, { perPage: 10 });
}

function renderPostTableBody(posts) {
  if (!posts.length) { $('pTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-newspaper"></i>No posts found</div></td></tr>'; return; }
  $('pTbody').innerHTML = posts.map(p => {
    const author   = userById(p.authorId);
    const category = catById(p.catId);
    const assigned = (p.assignedIds || []).map(id => userById(id)?.name).filter(Boolean).join(', ');
    return `<tr>
      <td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.title}</td>
      <td><div class="user-cell">${avatarEl(author, 26)}<span style="font-size:0.82rem;">${author?.name || '—'}</span></div></td>
      <td>${category ? `<span class="badge" style="background:${category.color}22;color:${category.color};"><i class="fas ${category.icon}" style="font-size:0.65rem;"></i> ${category.name}</span>` : '—'}</td>
      <td>${statusBadge(p.visibility === 'all' ? 'published' : p.visibility)}</td>
      <td style="font-size:0.75rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${assigned || 'Everyone'}</td>
      <td style="font-size:0.75rem;">${fmt(p.created)}</td>
      <td>${statusBadge(p.status)}</td>
      <td>${p.views}</td>
      <td>
        <button class="abt warn" onclick="openPostModal(${p.id})"><i class="fas fa-pen"></i></button>
        <button class="abt dan" onclick="deletePost(${p.id})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function renderPostTable() { filterAndUpdatePosts(); }

function openPostModal(postId = null) {
  populateCatFilter();
  postAssignees = [];
  $('pm_assignTags').innerHTML = '';
  $('pm_attFiles').innerHTML   = '';
  const p = postId ? DB.posts.find(x => x.id === postId) : null;
  $('pomTitle').textContent   = p ? 'Edit Post' : 'New Post';
  $('pm_title').value         = p?.title    || '';
  $('pm_cat').value           = p?.catId    || (DB.categories[0]?.id || '');
  $('pm_vis').value           = p?.visibility || 'all';
  $('pm_content').value       = p?.content  || '';
  $('pm_loc').value           = p?.location || '';
  if (p) postAssignees = [...(p.assignedIds || [])];
  renderAssignTagsPost();
  $('pm_save').onclick = () => savePost(postId);
  $('detectLocBtn')?.addEventListener('click', detectLocation);
  $('pm_assignSearch')?.addEventListener('input', e => searchAssignees(e.target.value));
  $('pmAttachBtn')?.addEventListener('click', () => $('pm_files').click());
  $('pmVideoBtn')?.addEventListener('click', () => $('pm_video').click());
  $('pm_files')?.addEventListener('change', e => addPostFiles(e.target));
  $('pm_video')?.addEventListener('change', e => addPostFiles(e.target));
  $('voiceRecBtn')?.addEventListener('click', togglePostVoice);
  openM('postModal');
}

function searchAssignees(q) {
  const res = $('pm_assignResults');
  if (!q) { res.classList.remove('show'); return; }
  const workers = DB.users.filter(u => u.role === 'worker' && u.name.toLowerCase().includes(q.toLowerCase()) && !postAssignees.includes(u.id));
  res.innerHTML = workers.map(w => `<div class="assign-opt" onclick="addAssignee(${w.id})">${avatarEl(w, 24)}<span>${w.name}</span></div>`).join('') || '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.toggle('show', !!workers.length);
}

function addAssignee(id) {
  if (!postAssignees.includes(id)) postAssignees.push(id);
  renderAssignTagsPost();
  $('pm_assignResults').classList.remove('show');
  $('pm_assignSearch').value = '';
}

function renderAssignTagsPost() {
  $('pm_assignTags').innerHTML = postAssignees.map(id => {
    const u = userById(id);
    return `<div class="assign-tag">${u?.name || id}<button onclick="removeAssignee(${id})">×</button></div>`;
  }).join('');
}

function removeAssignee(id) { postAssignees = postAssignees.filter(x => x !== id); renderAssignTagsPost(); }

function addPostFiles(input) {
  Array.from(input.files).forEach(file => {
    $('pm_attFiles').innerHTML += `<div class="att-file"><i class="fas fa-file"></i><span>${file.name}</span><span style="color:var(--text3);font-size:0.72rem;">${(file.size / 1024).toFixed(1)} KB</span></div>`;
  });
}

function detectLocation() {
  if (!navigator.geolocation) { toast('Geolocation not supported', 'error'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => { $('pm_loc').value = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`; toast('Location detected', 'success'); },
    () => toast('Could not detect location', 'error')
  );
}

function togglePostVoice() {
  postVoiceRecording = !postVoiceRecording;
  const btn = $('voiceRecBtn');
  btn.classList.toggle('recording', postVoiceRecording);
  btn.innerHTML = postVoiceRecording ? '<i class="fas fa-stop"></i> Stop Recording' : '<i class="fas fa-microphone"></i> Record Voice';
  $('pm_voiceStatus').style.display = postVoiceRecording ? '' : 'none';
  if (!postVoiceRecording) toast('Voice note saved', 'success');
}

function savePost(postId) {
  const data = { title: $('pm_title').value.trim(), catId: +$('pm_cat').value, visibility: $('pm_vis').value, content: $('pm_content').value.trim(), location: $('pm_loc').value.trim(), assignedIds: [...postAssignees], files: [] };
  if (!data.title) { toast('Title required', 'error'); return; }
  if (postId) { const p = DB.posts.find(x => x.id === postId); Object.assign(p, data); logAction('update', `Post #${postId}`, `Updated "${data.title}"`); }
  else { DB.posts.push({ id: generateId('posts'), ...data, authorId: currentUser.id, created: nowStr().slice(0, 10), status: 'published', views: 0 }); logAction('create', 'Post', `Created "${data.title}"`); }
  closeM('postModal'); filterAndUpdatePosts(); toast('Post saved', 'success');
}

function deletePost(id) {
  if (!confirm('Delete this post?')) return;
  DB.posts.splice(DB.posts.findIndex(p => p.id === id), 1);
  logAction('delete', `Post #${id}`, 'Post deleted'); filterAndUpdatePosts(); toast('Post deleted', 'success');
}

/* ============================================================
   13. CATEGORIES PAGE
   ============================================================ */
function renderCategories() {
  renderCatList(); renderCatChart();
  $('addCatBtn')?.addEventListener('click', () => openM('addCatModal'));
  $('addCatSaveBtn')?.addEventListener('click', addCategory);
}

function renderCatList() {
  $('catList').innerHTML = DB.categories.map(c => `
    <div class="cat-item">
      <div class="ci-color" style="background:${c.color};"></div>
      <i class="fas ${c.icon}" style="color:${c.color};font-size:0.85rem;"></i>
      <span class="ci-name">${c.name}</span>
      <span style="font-size:0.72rem;color:var(--text3);">${DB.posts.filter(p => p.catId === c.id).length} posts</span>
      <button class="abt dan" onclick="deleteCat(${c.id})"><i class="fas fa-trash"></i></button>
    </div>`).join('') || '<div class="empty-state"><i class="fas fa-tags"></i>No categories</div>';
}

function renderCatChart() {
  makeChart('catChart', {
    type: 'doughnut',
    data: { labels: DB.categories.map(c => c.name), datasets: [{ data: DB.categories.map(c => DB.posts.filter(p => p.catId === c.id).length), backgroundColor: DB.categories.map(c => c.color + 'cc'), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: chartTextColor(), font: { family: 'DM Sans', size: 11 } } } }, cutout: '60%' }
  });
}

function addCategory() {
  const name = $('cat_name').value.trim(); const color = $('cat_color').value; const icon = $('cat_icon').value.trim() || 'fa-tag';
  if (!name) { toast('Name required', 'error'); return; }
  DB.categories.push({ id: generateId('categories'), name, color, icon });
  logAction('create', 'Category', `Created "${name}"`);
  closeM('addCatModal'); renderCatList(); renderCatChart(); populateCatFilter();
  $('cat_name').value = ''; toast('Category added', 'success');
}

function deleteCat(id) {
  if (!confirm('Delete this category?')) return;
  DB.categories.splice(DB.categories.findIndex(c => c.id === id), 1);
  renderCatList(); renderCatChart(); toast('Category deleted', 'success');
}

/* ============================================================
   14. MESSAGES PAGE
   ============================================================ */
function renderMessages() {
  renderGroupList();
  $('createGroupBtn')?.addEventListener('click', openCreateGroupModal);
  $('sendChatBtn')?.addEventListener('click', sendMessage);
  $('chatTxt')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
  $('chatMembersBtn')?.addEventListener('click', openGroupMembers);
  $('chatDeleteBtn')?.addEventListener('click', deleteCurrentGroup);
  $('chatAttachBtn')?.addEventListener('click', () => $('msgFileInput').click());
  $('chatVideoBtn')?.addEventListener('click', () => $('msgVideoInput').click());
  $('voiceNoteBtn')?.addEventListener('click', () => toast('Voice note recording (demo)', 'info'));
}

function renderGroupList() {
  const box = $('gListBox'); if (!box) return;
  box.innerHTML = DB.groups.map(g => {
    const msgs = DB.messages[g.id] || [];
    const last = msgs[msgs.length - 1];
    const active = currentGroup?.id === g.id ? ' active' : '';
    return `<div class="g-item${active}" onclick="selectGroup(${g.id})">
      <div class="gi-icon" style="background:var(--accent-glow);font-size:1.1rem;">${g.icon}</div>
      <div class="gi-info">
        <div class="gi-name">${g.name}</div>
        <div class="gi-last">${last ? userById(last.authorId)?.name + ': ' + last.text.slice(0, 30) : 'No messages'}</div>
      </div>
      ${msgs.length ? `<div class="gi-cnt">${msgs.length}</div>` : ''}
    </div>`;
  }).join('') || '<div class="empty-state"><i class="fas fa-comments"></i>No groups</div>';
  if (!currentGroup && DB.groups.length) selectGroup(DB.groups[0].id);
}

function selectGroup(id) {
  currentGroup = DB.groups.find(g => g.id === id);
  renderGroupList();
  $('chatGName').textContent = currentGroup?.name || 'Select Group';
  $('chatGMeta').textContent = `${currentGroup?.memberIds.length || 0} members`;
  $('chatGIcon').textContent = currentGroup?.icon || '💬';
  renderChatMsgs();
}

function renderChatMsgs() {
  const msgs = DB.messages[currentGroup?.id] || [];
  $('chatMsgsBox').innerHTML = msgs.map(m => {
    const u = userById(m.authorId);
    const mine = m.authorId === currentUser.id;
    return `<div class="msg-bbl${mine ? ' mine' : ''}">
      ${avatarEl(u, 30)}
      <div class="bbl-body"><div class="bbl-content">${m.text}</div><div class="bbl-meta">${u?.name} · ${m.time}</div></div>
    </div>`;
  }).join('') || '<div class="empty-state"><i class="fas fa-comment-slash"></i>No messages yet</div>';
  const box = $('chatMsgsBox');
  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const txt = $('chatTxt')?.value.trim();
  if (!txt || !currentGroup) return;
  const msgs = DB.messages[currentGroup.id] = DB.messages[currentGroup.id] || [];
  msgs.push({ id: msgs.length + 1, groupId: currentGroup.id, authorId: currentUser.id, text: txt, time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), files: [] });
  $('chatTxt').value = '';
  renderChatMsgs(); renderGroupList();
}

function openCreateGroupModal() {
  const box = $('cg_members'); if (!box) return;
  box.innerHTML = DB.users.map(u => `<label style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem;border-radius:7px;cursor:pointer;font-size:0.82rem;">
    <input type="checkbox" value="${u.id}" checked> ${avatarEl(u, 24)} ${u.name}</label>`).join('');
  $('cgMemberSearch')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    box.querySelectorAll('label').forEach(l => l.style.display = l.textContent.toLowerCase().includes(q) ? '' : 'none');
  });
  $('cg_name').value = $('cg_icon').value = $('cg_desc').value = '';
  $('cgCreateBtn').onclick = createGroup;
  openM('cgModal');
}

function createGroup() {
  const name = $('cg_name').value.trim();
  if (!name) { toast('Group name required', 'error'); return; }
  const memberIds = [...$('cg_members').querySelectorAll('input:checked')].map(i => +i.value);
  const g = { id: generateId('groups'), name, icon: $('cg_icon').value || '💬', desc: $('cg_desc').value, memberIds };
  DB.groups.push(g); DB.messages[g.id] = [];
  logAction('create', 'Group', `Created "${name}"`);
  closeM('cgModal'); renderGroupList(); toast('Group created', 'success');
}

function openGroupMembers() {
  if (!currentGroup) return;
  $('gmBody').innerHTML = `<div style="display:flex;flex-direction:column;gap:0.35rem;">` +
    currentGroup.memberIds.map(id => { const u = userById(id); return `<div class="user-cell" style="padding:0.35rem;">${avatarEl(u, 30)}<div><div style="font-weight:600;font-size:0.83rem;">${u?.name}</div><div style="font-size:0.72rem;color:var(--text3);">${u?.role}</div></div></div>`; }).join('')
    + `</div>`;
  openM('gmModal');
}

function deleteCurrentGroup() {
  if (!currentGroup || !confirm('Delete this group?')) return;
  DB.groups.splice(DB.groups.findIndex(g => g.id === currentGroup.id), 1);
  delete DB.messages[currentGroup.id];
  currentGroup = null;
  renderGroupList();
  $('chatGName').textContent = 'Select Group';
  $('chatGMeta').textContent = '';
  $('chatMsgsBox').innerHTML = '';
  toast('Group deleted', 'success');
}

/* ============================================================
   15. ANALYTICS PAGE
   ============================================================ */
function renderAnalytics() {
  const activeUsers = DB.users.filter(u => u.status === 'active').length;
  const totalTasks  = DB.tasks.length;
  const doneTasks   = DB.tasks.filter(t => t.status === 'done').length;
  $('anStatsGrid').innerHTML =
    statCard('fa-users',              'blue',   activeUsers,                          'Active Users',   '', 'flat') +
    statCard('fa-list-check',         'green',  `${doneTasks}/${totalTasks}`,         'Tasks Done',     '', 'flat') +
    statCard('fa-building',           'yellow', DB.sites.filter(s => s.status === 'active').length, 'Active Sites', '', 'flat') +
    statCard('fa-triangle-exclamation','red',   DB.incidents.length,                  'Total Incidents','', 'flat');

  setTimeout(() => {
    makeChart('anMonthly', {
      type: 'line',
      data: { labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], datasets: [{ label: 'Tasks Completed', data: [8,12,9,15,11,18,14,20,16,22,19,25], borderColor: '#eab308', backgroundColor: 'rgba(234,179,8,0.08)', fill: true, tension: 0.4 }] },
      options: { ...chartDefaults(), plugins: { legend: { display: false } } }
    });
    const statuses = ['todo','inprogress','review','done'];
    const counts   = statuses.map(s => DB.tasks.filter(t => t.status === s).length);
    makeChart('anStatus', {
      type: 'pie',
      data: { labels: ['To Do','In Progress','Review','Done'], datasets: [{ data: counts, backgroundColor: ['rgba(100,116,139,0.7)','rgba(234,179,8,0.7)','rgba(59,130,246,0.7)','rgba(16,185,129,0.7)'], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: chartTextColor() } } } }
    });
    const perfs = DB.users.map(u => ({ user: u, done: DB.tasks.filter(t => t.assigneeId === u.id && t.status === 'done').length })).sort((a, b) => b.done - a.done).slice(0, 5);
    $('topPerf').innerHTML = perfs.map((p, i) => `<div class="perf-row"><span class="perf-rank">${i + 1}</span>${avatarEl(p.user, 30)}<div style="flex:1;"><div style="font-size:0.83rem;font-weight:600;">${p.user.name}</div><div style="font-size:0.72rem;color:var(--text3);">${p.user.role}</div></div><span style="font-family:'Space Grotesk',sans-serif;font-weight:700;color:var(--accent);">${p.done} tasks</span></div>`).join('');
    makeChart('anSites', {
      type: 'bar',
      data: { labels: DB.sites.map(s => s.name.length > 15 ? s.name.slice(0, 15) + '…' : s.name), datasets: [{ label: 'Progress %', data: DB.sites.map(s => s.progress), backgroundColor: 'rgba(234,179,8,0.75)', borderRadius: 6 }] },
      options: { ...chartDefaults(), indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ...chartDefaults().scales.x, max: 100 }, y: chartDefaults().scales.y } }
    });
  }, 100);
}

/* ============================================================
   16. LEAVE MANAGEMENT
   ============================================================ */
function renderLeave() {
  wireLeaveTabs();
  filterAndUpdateLeaveRequests();
  filterAndUpdateLeaveBalances();
  filterAndUpdateHolidays();
  renderLeaveCalendar();
  $('lvExport')?.addEventListener('click', () => exportCSV(DB.leaveRequests.map(l => ({ ...l, userName: userById(l.userId)?.name })), 'leave_requests.csv'));
  $('addHolidayBtn')?.addEventListener('click', addHoliday);
  ['lvStatus','lvType','lvFrom','lvTo'].forEach(id => $(id)?.addEventListener('change', filterAndUpdateLeaveRequests));
}

function wireLeaveTabs() {
  const panels = { requests: 'lv-requests', balances: 'lv-balances', calendar: 'lv-calendar', holidays: 'lv-holidays' };
  $$('[data-lvtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-lvtab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.values(panels).forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
      const target = $(panels[btn.dataset.lvtab]);
      if (target) target.style.display = '';
      if (btn.dataset.lvtab === 'requests')  filterAndUpdateLeaveRequests();
      if (btn.dataset.lvtab === 'balances')  filterAndUpdateLeaveBalances();
      if (btn.dataset.lvtab === 'holidays')  filterAndUpdateHolidays();
    });
  });
}

function filterAndUpdateLeaveRequests() {
  const st   = $('lvStatus')?.value || '';
  const type = $('lvType')?.value   || '';
  const from = $('lvFrom')?.value   || '';
  const to   = $('lvTo')?.value     || '';
  const filtered = DB.leaveRequests.filter(l => {
    if (st   && l.status !== st) return false;
    if (type && l.type   !== type) return false;
    if (from && l.from < from)   return false;
    if (to   && l.to > to)       return false;
    return true;
  });
  createPaginator('lvTbody', filtered, renderLeaveTableBody, { perPage: 10 });
}

function renderLeaveTableBody(requests) {
  $('lvTbody').innerHTML = requests.length ? requests.map(l => {
    const u = userById(l.userId);
    return `<tr>
      <td><div class="user-cell">${avatarEl(u, 26)}<span>${u?.name}</span></div></td>
      <td><span class="badge b-update">${l.type}</span></td>
      <td>${fmt(l.from)}</td><td>${fmt(l.to)}</td><td>${l.days}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.reason}</td>
      <td>${statusBadge(l.status)}</td>
      <td style="font-size:0.75rem;">${fmt(l.applied)}</td>
      <td>${l.status === 'pending' ? `<button class="abt suc" onclick="openLeaveDecision(${l.id},'approve')"><i class="fas fa-check"></i></button><button class="abt dan" onclick="openLeaveDecision(${l.id},'reject')"><i class="fas fa-times"></i></button>` : '<span style="color:var(--text3);font-size:0.75rem;">—</span>'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-calendar"></i>No leave requests found</div></td></tr>';
}

function filterAndUpdateLeaveBalances() {
  const activeUsers = DB.users.filter(u => u.status === 'active');
  createPaginator('lvBalTbody', activeUsers, renderLeaveBalancesBody, { perPage: 10 });
}

function renderLeaveBalancesBody(users) {
  $('lvBalTbody').innerHTML = users.length ? users.map(u => {
    const b = DB.leaveBalance[u.id] || { annual: 20, sick: 10, emergency: 5, annualUsed: 0, sickUsed: 0, emergencyUsed: 0, unpaidUsed: 0 };
    return `<tr>
      <td><div class="user-cell">${avatarEl(u, 26)}<span>${u.name}</span></div></td>
      <td>${b.annual - b.annualUsed} / ${b.annual}</td>
      <td>${b.sick - b.sickUsed} / ${b.sick}</td>
      <td>${b.emergency - b.emergencyUsed} / ${b.emergency}</td>
      <td>${b.unpaidUsed}</td>
      <td>${b.annualUsed + b.sickUsed + b.emergencyUsed + b.unpaidUsed}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-users"></i>No active users found</div></td></tr>';
}

function filterAndUpdateHolidays() {
  createPaginator('holidayTbody', DB.holidays, renderHolidaysBody, { perPage: 10 });
}

function renderHolidaysBody(holidays) {
  $('holidayTbody').innerHTML = holidays.length ? holidays.map(h => `
    <tr>
      <td>${fmt(h.date)}</td>
      <td style="font-weight:600;">${h.name}</td>
      <td><span class="badge b-update">${h.type}</span></td>
      <td><button class="abt dan" onclick="deleteHoliday(${h.id})"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('') : '<tr><td colspan="4"><div class="empty-state"><i class="fas fa-calendar"></i>No holidays found</div></td></tr>';
}

function openLeaveDecision(leaveId, action) {
  const l = DB.leaveRequests.find(x => x.id === leaveId);
  const u = userById(l?.userId);
  $('ldTitle').textContent = action === 'approve' ? 'Approve Leave' : 'Reject Leave';
  $('ldInfo').innerHTML = `<strong>${u?.name}</strong> — ${l?.type} leave · ${l?.days} day(s) · ${fmt(l?.from)} to ${fmt(l?.to)}<br><em style="color:var(--text3);font-size:0.8rem;">${l?.reason}</em>`;
  $('ldComment').value = '';
  $('ldApproveBtn').onclick = () => decideLeave(leaveId, 'approved');
  $('ldRejectBtn').onclick  = () => decideLeave(leaveId, 'rejected');
  openM('leaveDecisionModal');
}

function decideLeave(leaveId, decision) {
  const l = DB.leaveRequests.find(x => x.id === leaveId);
  const u = userById(l?.userId);
  l.status = decision; l.comment = $('ldComment')?.value || '';
  logAction(decision === 'approved' ? 'approve' : 'reject', `Leave #${leaveId}`, `${decision} for ${u?.name}`);
  sendEmail(u?.email || '', `Leave ${decision}`, 'leave_decision');
  closeM('leaveDecisionModal'); filterAndUpdateLeaveRequests(); filterAndUpdateLeaveBalances();
  toast(`Leave ${decision}`, 'success');
}

function renderLeaveCalendar() {
  const label = $('lvCalLabel'), body = $('lvCalBody');
  if (!label || !body) return;
  const y = leaveCalDate.getFullYear(), m = leaveCalDate.getMonth();
  label.textContent = leaveCalDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = '<div class="leave-cal">' + dayNames.map(d => `<div class="cal-day-hdr">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day other-month"></div>`;
  const today = new Date();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = y === today.getFullYear() && m === today.getMonth() && d === today.getDate();
    const leaves  = DB.leaveRequests.filter(l => l.from <= dateStr && l.to >= dateStr && l.status === 'approved');
    const holiday = DB.holidays.find(h => h.date === dateStr);
    html += `<div class="cal-day${isToday ? ' today' : ''}">
      <div class="cal-day-num">${d}</div>
      ${holiday ? `<div class="cal-leave-tag" style="background:rgba(234,179,8,0.2);color:var(--accent);">${holiday.name}</div>` : ''}
      ${leaves.map(l => { const u = userById(l.userId); return `<div class="cal-leave-tag" style="background:rgba(59,130,246,0.15);color:#60a5fa;">${u?.name?.split(' ')[0]}</div>`; }).join('')}
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
  $('lvCalPrev')?.removeEventListener('click', handlePrevMonth);
  $('lvCalNext')?.removeEventListener('click', handleNextMonth);
  $('lvCalPrev')?.addEventListener('click', handlePrevMonth);
  $('lvCalNext')?.addEventListener('click', handleNextMonth);
}

function handlePrevMonth() { leaveCalDate.setMonth(leaveCalDate.getMonth() - 1); renderLeaveCalendar(); }
function handleNextMonth() { leaveCalDate.setMonth(leaveCalDate.getMonth() + 1); renderLeaveCalendar(); }

function addHoliday() {
  const name = prompt('Holiday name:'); if (!name) return;
  const date = prompt('Date (YYYY-MM-DD):'); if (!date) return;
  const type = prompt('Type (National/Cultural/Religious):', 'National') || 'National';
  DB.holidays.push({ id: generateId('holidays'), name, date, type });
  filterAndUpdateHolidays(); renderLeaveCalendar(); toast('Holiday added', 'success');
}

function deleteHoliday(id) {
  DB.holidays.splice(DB.holidays.findIndex(h => h.id === id), 1);
  filterAndUpdateHolidays(); renderLeaveCalendar(); toast('Holiday deleted', 'success');
}

/* ============================================================
   17. TIMESHEETS
   ============================================================ */
function renderTimesheets() {
  populateWeekSelect('tsWeek');
  const userSel = $('tsUser');
  if (userSel) userSel.innerHTML = '<option value="">All Employees</option>' + DB.users.filter(u => u.role !== 'admin').map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  renderTimesheetTable();
  ['tsUser','tsWeek','tsStatus2'].forEach(id => $(id)?.addEventListener('change', renderTimesheetTable));
  $('tsExport')?.addEventListener('click', () => exportCSV(DB.timesheets.map(t => ({ ...t, userName: userById(t.userId)?.name })), 'timesheets.csv'));
}

function populateWeekSelect(elId) {
  const el = $(elId); if (!el) return;
  const weeks = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(); d.setDate(d.getDate() - i * 7);
    const y = d.getFullYear();
    const w = String(getISOWeek(d)).padStart(2, '0');
    weeks.push(`${y}-W${w}`);
  }
  el.innerHTML = [...new Set(weeks)].map(w => `<option value="${w}">${w}</option>`).join('');
}

function getISOWeek(d) {
  const date = new Date(d); date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function renderTimesheetTable() {
  const userId = +$('tsUser')?.value  || 0;
  const week   = $('tsWeek')?.value   || '';
  const status = $('tsStatus2')?.value || '';
  const rows   = DB.timesheets.filter(t => {
    if (userId && t.userId !== userId) return false;
    if (week   && t.week   !== week)   return false;
    if (status && t.status !== status) return false;
    return true;
  });
  const total = rows.reduce((s, t) => s + (t.mon + t.tue + t.wed + t.thu + t.fri + t.sat + t.sun), 0);
  const ot    = rows.reduce((s, t) => { const hrs = t.mon + t.tue + t.wed + t.thu + t.fri + t.sat + t.sun; return s + (hrs > 40 ? hrs - 40 : 0); }, 0);
  $('tsStats').innerHTML =
    statCard('fa-clock',    'blue',   total + 'h', 'Total Hours', '', 'flat') +
    statCard('fa-fire',     'orange', ot + 'h',    'Overtime',    '', 'flat') +
    statCard('fa-check',    'green',  rows.filter(r => r.status === 'approved').length, 'Approved', '', 'flat') +
    statCard('fa-hourglass','yellow', rows.filter(r => r.status === 'pending').length,  'Pending',  '', 'flat');
  $('tsTbody').innerHTML = rows.map(t => {
    const u = userById(t.userId);
    const tot = t.mon + t.tue + t.wed + t.thu + t.fri + t.sat + t.sun;
    const ot  = tot > 40 ? tot - 40 : 0;
    return `<tr>
      <td><div class="user-cell">${avatarEl(u, 26)}<span>${u?.name}</span></div></td>
      <td style="font-size:0.75rem;">${t.week}</td>
      ${[t.mon,t.tue,t.wed,t.thu,t.fri,t.sat,t.sun].map(h => `<td style="text-align:center;${h === 0 ? 'color:var(--text3);' : ''}">${h || '—'}</td>`).join('')}
      <td style="font-weight:700;text-align:center;">${tot}h</td>
      <td style="text-align:center;color:${ot > 0 ? '#f97316' : 'var(--text3)'};">${ot > 0 ? ot + 'h' : '—'}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${t.status === 'pending' ? `<button class="abt suc" onclick="decideTimesheet(${t.id},'approved')"><i class="fas fa-check"></i></button><button class="abt dan" onclick="decideTimesheet(${t.id},'rejected')"><i class="fas fa-times"></i></button>` : '<span style="color:var(--text3);">—</span>'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="13"><div class="empty-state"><i class="fas fa-clock"></i>No timesheets found</div></td></tr>';
}

function decideTimesheet(id, decision) {
  const t = DB.timesheets.find(x => x.id === id); if (!t) return;
  t.status = decision; renderTimesheetTable(); toast(`Timesheet ${decision}`, 'success');
}

/* ============================================================
   18. PAYROLL
   ============================================================ */
function netPay(p) { return p.baseSalary + p.overtime + p.bonus + p.allowances - p.deductions; }

function renderPayroll() {
  populatePeriodSelect();
  filterAndUpdatePayroll();
  $('prExport')?.addEventListener('click', () => exportCSV(DB.payroll.map(p => ({ ...p, userName: userById(p.userId)?.name, netPay: netPay(p) })), 'payroll.csv'));
  $('prProcess')?.addEventListener('click', processPayroll);
  ['prPeriod','prStatus'].forEach(id => $(id)?.addEventListener('change', filterAndUpdatePayroll));
}

function populatePeriodSelect() {
  const el = $('prPeriod'); if (!el) return;
  const periods = ['2025-07','2025-06','2025-05','2025-04'];
  el.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');
  el.value = currentPayrollPeriod;
}

function filterAndUpdatePayroll() {
  const period = $('prPeriod')?.value || currentPayrollPeriod;
  const status = $('prStatus')?.value || '';
  const filtered = DB.payroll.filter(p => {
    if (p.period !== period) return false;
    if (status && p.status !== status) return false;
    return true;
  });
  updatePayrollStats(filtered);
  if (filtered.length > 0) {
    createPaginator('prTbody', filtered, renderPayrollTableBody, { perPage: 10 });
  } else {
    $('prTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-money-bill-wave"></i>No payroll data found</div></td></tr>';
    const ep = document.getElementById('pagination-prTbody');
    if (ep) ep.remove();
  }
}

function updatePayrollStats(payrollData) {
  const totalNet      = payrollData.reduce((s, p) => s + netPay(p), 0);
  const totalBase     = payrollData.reduce((s, p) => s + p.baseSalary, 0);
  const totalOvertime = payrollData.reduce((s, p) => s + p.overtime, 0);
  $('prStats').innerHTML =
    statCard('fa-users',      'blue',   payrollData.length,      'Employees',     '', 'flat') +
    statCard('fa-money-bill', 'green',  fmtMoney(totalBase),     'Base Total',    '', 'flat') +
    statCard('fa-fire',       'orange', fmtMoney(totalOvertime), 'Overtime Total','', 'flat') +
    statCard('fa-coins',      'yellow', fmtMoney(totalNet),      'Net Payroll',   '', 'flat');
}

function renderPayrollTableBody(payrollRows) {
  if (!payrollRows.length) { $('prTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-money-bill-wave"></i>No payroll data found</div></td></tr>'; return; }
  $('prTbody').innerHTML = payrollRows.map(p => {
    const u = userById(p.userId);
    return `<tr>
      <td><div class="user-cell">${avatarEl(u, 26)}<span>${u?.name || 'Unknown'}</span></div></td>
      <td>${fmtMoney(p.baseSalary)}</td>
      <td style="color:#f97316;">${fmtMoney(p.overtime)}</td>
      <td style="color:#34d399;">${fmtMoney(p.bonus)}</td>
      <td>${fmtMoney(p.allowances)}</td>
      <td style="color:#f87171;">(${fmtMoney(p.deductions)})</td>
      <td style="font-weight:700;color:var(--accent);">${fmtMoney(netPay(p))}</td>
      <td>${statusBadge(p.status)}</td>
      <td>
        <button class="abt inf" onclick="openPayslip(${p.id})"><i class="fas fa-eye"></i></button>
        <button class="abt" onclick="emailPayslip(${p.id})"><i class="fas fa-envelope"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function renderPayrollTable() { filterAndUpdatePayroll(); }

function processPayroll() {
  const period = $('prPeriod')?.value || currentPayrollPeriod;
  const entries = DB.payroll.filter(p => p.period === period && p.status === 'draft');
  if (!entries.length) { toast('No draft payroll entries found for this period', 'warn'); return; }
  if (confirm(`Process ${entries.length} payroll entries for period ${period}?`)) {
    entries.forEach(p => p.status = 'processed');
    filterAndUpdatePayroll();
    toast(`${entries.length} payroll entries processed`, 'success');
    logAction('update', 'Payroll', `Period ${period} processed with ${entries.length} entries`);
  }
}

function openPayslip(prId) {
  const p = DB.payroll.find(x => x.id === prId); if (!p) return;
  const u = userById(p.userId);
  $('payslipBody').innerHTML = `
    <div class="payslip-wrap">
      <div class="payslip-hdr">
        <div><div style="font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:1.1rem;">NIXERS.pro</div><div style="font-size:0.75rem;color:var(--text3);">Payslip — ${p.period}</div></div>
        <div style="text-align:right;">${avatarEl(u, 40)}</div>
      </div>
      <div style="margin-bottom:1rem;">${avatarEl(u, 36)} <strong>${u?.name}</strong> · ${u?.dept || u?.role}</div>
      <div class="payslip-row"><span>Basic Salary</span><span>${fmtMoney(p.baseSalary)}</span></div>
      <div class="payslip-row"><span>Overtime</span><span style="color:#f97316;">+${fmtMoney(p.overtime)}</span></div>
      <div class="payslip-row"><span>Bonus</span><span style="color:#34d399;">+${fmtMoney(p.bonus)}</span></div>
      <div class="payslip-row"><span>Allowances</span><span>+${fmtMoney(p.allowances)}</span></div>
      <div class="payslip-row"><span>Deductions</span><span style="color:#f87171;">-${fmtMoney(p.deductions)}</span></div>
      <hr class="div">
      <div class="payslip-row payslip-total"><span>Net Pay</span><span>${fmtMoney(netPay(p))}</span></div>
      <div style="margin-top:0.75rem;font-size:0.72rem;color:var(--text3);">Status: ${statusBadge(p.status)}</div>
    </div>`;
  $('payslipPrintBtn').onclick = () => window.print();
  $('payslipEmailBtn').onclick = () => emailPayslip(prId);
  openM('payslipModal');
}

function emailPayslip(prId) {
  const p = DB.payroll.find(x => x.id === prId);
  const u = userById(p?.userId);
  if (u?.email) { sendEmail(u.email, 'Your Payslip is Ready', 'payslip'); toast(`Payslip emailed to ${u.name}`, 'success'); }
  else toast('No email address found for this employee', 'error');
}

/* ============================================================
   19. TASKS & PROJECTS
   ============================================================ */
function renderTasks() {
  populateProjectSelects();
  wireTTabs();
  filterAndUpdateProjects();
  renderKanban();
  renderGantt();
  if ($('addProjectBtn')) $('addProjectBtn').onclick = () => openProjectModal();
  if ($('projSearch'))    $('projSearch').oninput = filterAndUpdateProjects;
  if ($('projStatus'))    $('projStatus').onchange = filterAndUpdateProjects;
  ['kanbanProject','kanbanAssignee','kanbanPriority'].forEach(id => { if ($(id)) $(id).onchange = renderKanban; });
  $$('.kanban-add-btn').forEach(btn => { btn.onclick = () => openTaskModal(null, btn.dataset.col); });
}

function populateProjectSelects() {
  const kp = $('kanbanProject'); if (kp) kp.innerHTML = '<option value="">All Projects</option>' + DB.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const ka = $('kanbanAssignee'); if (ka) ka.innerHTML = '<option value="">All Assignees</option>' + DB.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  const tmProj = $('tm_project'); if (tmProj) tmProj.innerHTML = DB.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const projSite = $('proj_site'); if (projSite) projSite.innerHTML = '<option value="">None</option>' + DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

function renderAssignTags(ids, targetId, removeFn) {
  const target = $(targetId); if (!target) return;
  target.innerHTML = ids.map(id => { const u = userById(id); return `<div class="assign-tag">${u?.name || id}<button onclick="${removeFn}(${id})">×</button></div>`; }).join('');
}

function searchProjectTeam(q = '') {
  const res = $('proj_teamResults'); if (!res) return;
  const query = q.trim().toLowerCase();
  const options = DB.users.filter(u => !projectTeamMembers.includes(u.id) && (!query || u.name.toLowerCase().includes(query)));
  res.innerHTML = options.map(u => `<div class="assign-opt" onclick="addProjectTeamMember(${u.id})">${avatarEl(u, 24)}<span>${u.name}</span></div>`).join('') || '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.add('show');
}

function addProjectTeamMember(id) {
  if (!projectTeamMembers.includes(id)) projectTeamMembers.push(id);
  renderAssignTags(projectTeamMembers, 'proj_teamTags', 'removeProjectTeamMember');
  $('proj_teamResults')?.classList.remove('show');
  if ($('proj_teamSearch')) $('proj_teamSearch').value = '';
}

function removeProjectTeamMember(id) { projectTeamMembers = projectTeamMembers.filter(x => x !== id); renderAssignTags(projectTeamMembers, 'proj_teamTags', 'removeProjectTeamMember'); }

function searchTaskAssignees(q = '') {
  const res = $('tm_assigneeResults'); if (!res) return;
  const query = q.trim().toLowerCase();
  const options = DB.users.filter(u => !taskAssignees.includes(u.id) && (!query || u.name.toLowerCase().includes(query)));
  res.innerHTML = options.map(u => `<div class="assign-opt" onclick="addTaskAssignee(${u.id})">${avatarEl(u, 24)}<span>${u.name}</span></div>`).join('') || '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.add('show');
}

function addTaskAssignee(id) {
  if (!taskAssignees.includes(id)) taskAssignees.push(id);
  renderAssignTags(taskAssignees, 'tm_assigneeTags', 'removeTaskAssignee');
  $('tm_assigneeResults')?.classList.remove('show');
  if ($('tm_assigneeSearch')) $('tm_assigneeSearch').value = '';
}

function removeTaskAssignee(id) { taskAssignees = taskAssignees.filter(x => x !== id); renderAssignTags(taskAssignees, 'tm_assigneeTags', 'removeTaskAssignee'); }

function renderTaskAttachments() {
  const box = $('tm_attFiles'); if (!box) return;
  box.innerHTML = taskAttachments.map((f, i) => `<div class="af-item"><i class="fas fa-file"></i><span>${f.name}</span><button class="abt dan" onclick="removeTaskAttachment(${i})"><i class="fas fa-times"></i></button></div>`).join('') || '<div style="font-size:0.78rem;color:var(--text3);">No attachments added</div>';
}

function removeTaskAttachment(index) { taskAttachments.splice(index, 1); renderTaskAttachments(); }

function toggleTaskVoice() {
  taskVoiceRecording = !taskVoiceRecording;
  const btn = $('tm_voiceBtn');
  if (btn) { btn.classList.toggle('recording', taskVoiceRecording); btn.innerHTML = taskVoiceRecording ? '<i class="fas fa-stop"></i> Stop Recording' : '<i class="fas fa-microphone"></i> Record Voice'; }
  if ($('tm_voiceStatus')) $('tm_voiceStatus').style.display = taskVoiceRecording ? '' : 'none';
  toast(taskVoiceRecording ? 'Voice recording started (demo)' : 'Voice recording stopped', 'info');
}

function wireTTabs() {
  const panels = { projects: 'tt-projects', kanban: 'tt-kanban', gantt: 'tt-gantt' };
  $$('[data-ttab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-ttab]').forEach(b => b.classList.remove('active')); btn.classList.add('active');
      Object.values(panels).forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
      const target = $(panels[btn.dataset.ttab]); if (target) target.style.display = '';
    });
  });
}

function filterAndUpdateProjects() {
  const q  = $('projSearch')?.value.toLowerCase() || '';
  const st = $('projStatus')?.value || '';
  const filtered = DB.projects.filter(p => {
    if (q  && !p.name.toLowerCase().includes(q)) return false;
    if (st && p.status !== st) return false;
    return true;
  });
  createPaginator('projTbody', filtered, renderProjectTableBody, { perPage: 10 });
}

function renderProjectTableBody(projects) {
  if (!projects.length) { $('projTbody').innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-folder-open"></i>No projects found</div></td></tr>'; return; }
  $('projTbody').innerHTML = projects.map(p => {
    const tasks = DB.tasks.filter(t => t.projectId === p.id);
    const done  = tasks.filter(t => t.status === 'done').length;
    return `<tr>
      <td style="font-weight:600;">${p.name}</td>
      <td><div style="display:flex;gap:-6px;">${(p.teamIds || []).slice(0, 3).map(id => avatarEl(userById(id), 26)).join('')}${(p.teamIds || []).length > 3 ? `<span style="font-size:0.72rem;color:var(--text3);padding-left:4px;">+${p.teamIds.length - 3}</span>` : ''}</div></td>
      <td><div style="display:flex;align-items:center;gap:0.5rem;min-width:80px;"><div class="pb" style="flex:1;height:6px;"><div class="pb-fill" style="width:${p.progress}%;"></div></div><span style="font-size:0.72rem;">${p.progress}%</span></div></td>
      <td>${priorityBadge(p.priority)}</td>
      <td style="font-size:0.78rem;">${fmt(p.dueDate)}</td>
      <td style="font-size:0.82rem;">${done}/${tasks.length}</td>
      <td>${statusBadge(p.status)}</td>
      <td>
        <button class="abt warn" onclick="openProjectModal(${p.id})"><i class="fas fa-pen"></i></button>
        <button class="abt dan" onclick="deleteProject(${p.id})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function renderProjectTable() { filterAndUpdateProjects(); }

function openProjectModal(projId = null) {
  populateProjectSelects();
  const p = projId ? projectById(projId) : null;
  $('projTitle').textContent = p ? 'Edit Project' : 'New Project';
  $('proj_name').value     = p?.name     || '';
  $('proj_status').value   = p?.status   || 'planning';
  $('proj_priority').value = p?.priority || 'medium';
  $('proj_due').value      = p?.dueDate  || '';
  $('proj_site').value     = p?.siteId   || '';
  $('proj_desc').value     = p?.desc     || '';
  projectTeamMembers = [...(p?.teamIds || [])];
  renderAssignTags(projectTeamMembers, 'proj_teamTags', 'removeProjectTeamMember');
  if ($('proj_teamSearch')) {
    $('proj_teamSearch').oninput = e => searchProjectTeam(e.target.value);
    $('proj_teamSearch').onfocus = e => searchProjectTeam(e.target.value);
  }
  $('proj_save').onclick = () => saveProject(projId);
  openM('projectModal');
}

function saveProject(projId) {
  const current = projId ? projectById(projId) : null;
  const data = { name: $('proj_name').value.trim(), status: $('proj_status').value, priority: $('proj_priority').value, dueDate: $('proj_due').value, desc: $('proj_desc').value.trim(), siteId: +$('proj_site')?.value || null, teamIds: [...projectTeamMembers], progress: current?.progress || 0 };
  if (!data.name) { toast('Name required', 'error'); return; }
  if (projId) { Object.assign(projectById(projId), data); logAction('update', `Project #${projId}`, `Updated ${data.name}`); }
  else { DB.projects.push({ id: generateId('projects'), ...data }); logAction('create', 'Project', `Created ${data.name}`); }
  closeM('projectModal'); filterAndUpdateProjects(); renderKanban(); renderGantt(); toast('Project saved', 'success');
}

function deleteProject(id) {
  if (!confirm('Delete this project?')) return;
  DB.projects.splice(DB.projects.findIndex(p => p.id === id), 1);
  DB.tasks = DB.tasks.filter(t => t.projectId !== id);
  filterAndUpdateProjects(); renderKanban(); toast('Project deleted', 'success');
}

function renderKanban() {
  const cols = ['todo','inprogress','review','done'];
  const projectFilter  = +($('kanbanProject')?.value  || 0);
  const assigneeFilter = +($('kanbanAssignee')?.value || 0);
  const priorityFilter = $('kanbanPriority')?.value   || '';
  cols.forEach(col => {
    const cards = $(`kCards-${col}`); if (!cards) return;
    const tasks = DB.tasks.filter(t => {
      if (t.status !== col) return false;
      if (projectFilter  && t.projectId !== projectFilter)  return false;
      if (priorityFilter && t.priority !== priorityFilter)  return false;
      if (assigneeFilter && !taskAssigneeIds(t).includes(assigneeFilter)) return false;
      return true;
    });
    $(`kc-${col}`).textContent = tasks.length;
    cards.innerHTML = tasks.map(t => {
      const assignees = taskAssigneeIds(t).map(userById).filter(Boolean);
      const proj = projectById(t.projectId);
      return `<div class="kanban-card" onclick="openTaskModal(${t.id})">
        <div class="kc-title">${t.title}</div>
        ${proj ? `<div style="font-size:0.7rem;color:var(--text3);margin-bottom:0.3rem;">${proj.name}</div>` : ''}
        <div class="kc-meta">
          ${priorityBadge(t.priority)}
          ${t.dueDate ? `<span style="font-size:0.68rem;color:var(--text3);">📅 ${fmt(t.dueDate)}</span>` : ''}
          <div class="kc-assignee">${assignees.slice(0, 2).map(u => avatarEl(u, 20)).join('')}${assignees.length > 2 ? `<span>+${assignees.length - 2}</span>` : ''}</div>
        </div>
      </div>`;
    }).join('') || '<div style="text-align:center;padding:1rem;color:var(--text3);font-size:0.75rem;">Drop tasks here</div>';
  });
}

function openTaskModal(taskId = null, col = 'todo') {
  populateProjectSelects();
  const t = taskId ? DB.tasks.find(x => x.id === taskId) : null;
  $('tmTitle').textContent  = t ? 'Edit Task' : 'New Task';
  $('tm_title').value       = t?.title    || '';
  $('tm_project').value     = t?.projectId || DB.projects[0]?.id || '';
  $('tm_priority').value    = t?.priority  || 'medium';
  $('tm_due').value         = t?.dueDate   || '';
  $('tm_desc').value        = t?.desc      || '';
  $('tm_status').value      = t?.status    || col;
  taskAssignees   = [...taskAssigneeIds(t)];
  taskAttachments = [...(t?.attachments || [])];
  taskVoiceRecording = false;
  renderAssignTags(taskAssignees, 'tm_assigneeTags', 'removeTaskAssignee');
  renderTaskAttachments();
  if ($('tm_assigneeSearch')) {
    $('tm_assigneeSearch').oninput = e => searchTaskAssignees(e.target.value);
    $('tm_assigneeSearch').onfocus = e => searchTaskAssignees(e.target.value);
  }
  if ($('tm_voiceBtn'))   $('tm_voiceBtn').onclick = toggleTaskVoice;
  if ($('tm_attachBtn'))  $('tm_attachBtn').onclick = () => $('tm_files')?.click();
  if ($('tm_files')) $('tm_files').onchange = e => {
    const files = [...(e.target.files || [])].map(f => ({ name: f.name, size: f.size, type: f.type }));
    if (files.length) taskAttachments.push(...files);
    renderTaskAttachments();
    e.target.value = '';
  };
  $('tm_save').onclick = () => saveTask(taskId);
  openM('taskModal');
}

function saveTask(taskId) {
  const assigneeIds = taskAssignees.length ? [...taskAssignees] : [DB.users[0]?.id].filter(Boolean);
  const data = { title: $('tm_title').value.trim(), projectId: +$('tm_project').value, priority: $('tm_priority').value, assigneeId: assigneeIds[0] || null, assigneeIds, dueDate: $('tm_due').value, desc: $('tm_desc').value.trim(), status: $('tm_status').value, attachments: [...taskAttachments] };
  if (!data.title) { toast('Title required', 'error'); return; }
  if (taskId) { Object.assign(DB.tasks.find(t => t.id === taskId), data); logAction('update', `Task #${taskId}`, `Updated ${data.title}`); }
  else {
    DB.tasks.push({ id: generateId('tasks'), ...data });
    const assignedNames = assigneeIds.map(id => userById(id)?.name).filter(Boolean).join(', ');
    logAction('create', 'Task', `Created "${data.title}" assigned to ${assignedNames || 'team'}`);
    assigneeIds.forEach(id => sendEmail(userById(id)?.email || '', 'New Task Assigned', 'task_assigned'));
  }
  closeM('taskModal'); renderKanban(); renderProjectTable(); toast('Task saved', 'success');
}

function renderGantt() {
  const body = $('ganttBody'); if (!body) return;
  if (!DB.projects.length) { body.innerHTML = '<div class="empty-state"><i class="fas fa-timeline"></i>No projects</div>'; return; }
  const allDates  = DB.projects.flatMap(p => [new Date(p.dueDate || new Date())]);
  const minDate   = new Date(Math.min(...allDates)); minDate.setMonth(minDate.getMonth() - 2);
  const maxDate   = new Date(Math.max(...allDates)); maxDate.setMonth(maxDate.getMonth() + 1);
  const totalDays = (maxDate - minDate) / 86400000 || 1;
  const headerDays = Math.min(totalDays, 12);
  const monthLabels = [];
  for (let i = 0; i < headerDays; i++) { const d = new Date(minDate); d.setDate(d.getDate() + i * Math.floor(totalDays / headerDays)); monthLabels.push(d.toLocaleString('default', { month: 'short' })); }
  body.innerHTML = `<div class="gantt-wrap"><table style="width:100%;border-collapse:collapse;">
    <thead><tr><th style="width:200px;text-align:left;padding:0.5rem;font-size:0.72rem;color:var(--text3);">Project</th>${monthLabels.map(m => `<th style="font-size:0.72rem;color:var(--text3);padding:0.25rem;">${m}</th>`).join('')}</tr></thead>
    <tbody>${DB.projects.map(p => {
      const due = new Date(p.dueDate || new Date()); const start = new Date(due); start.setMonth(start.getMonth() - 2);
      const leftPct  = Math.max(0, ((start - minDate) / 86400000 / totalDays) * 100);
      const widthPct = Math.max(5, ((due - start) / 86400000 / totalDays) * 100);
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:0.75rem 0.5rem;font-size:0.82rem;font-weight:500;white-space:nowrap;">${p.name.slice(0, 25)}</td>
        <td colspan="${headerDays}" style="position:relative;height:40px;">
          <div style="position:absolute;left:${leftPct}%;width:${widthPct}%;top:8px;height:24px;background:rgba(234,179,8,0.75);border-radius:6px;display:flex;align-items:center;padding:0 0.5rem;font-size:0.68rem;font-weight:600;color:#0a0f1a;white-space:nowrap;overflow:hidden;">${p.name.slice(0, 20)}</div>
        </td></tr>`;
    }).join('')}</tbody></table></div>`;
}

/* ============================================================
   20. SHIFT SCHEDULING
   ============================================================ */
const SHIFT_TYPES = ['Morning','Afternoon','Night','Off'];
const SHIFT_KEYS  = ['morning','afternoon','night','off'];

function renderShifts() {
  const siteSel = $('shiftSite'); if (siteSel) siteSel.innerHTML = '<option value="">All Sites</option>' + DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  populateWeekSelect('shiftWeek');
  renderShiftGrid(); renderShiftSwaps();
  $('shiftPrev')?.addEventListener('click', () => { shiftWeekOffset--; renderShiftGrid(); });
  $('shiftNext')?.addEventListener('click', () => { shiftWeekOffset++; renderShiftGrid(); });
  $('shiftExport')?.addEventListener('click', () => toast('Shift schedule exported', 'success'));
}

function renderShiftGrid() {
  const grid = $('shiftGrid'); if (!grid) return;
  const workers = DB.users.filter(u => u.role === 'worker');
  const days    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1 + shiftWeekOffset * 7);
  const weekStart = new Date(d);
  $('shiftWeekLabel').textContent = `Week of ${weekStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  grid.innerHTML = `<thead><tr><th>Worker</th>${days.map((day, i) => { const dd = new Date(weekStart); dd.setDate(dd.getDate() + i); return `<th>${day}<br><span style="font-size:0.65rem;font-weight:400;">${dd.getDate()}/${dd.getMonth() + 1}</span></th>`; }).join('')}</tr></thead>
    <tbody>${workers.map(w => `<tr>
      <td><div class="user-cell">${avatarEl(w, 26)}<span style="font-size:0.8rem;">${w.name}</span></div></td>
      ${days.map((day) => {
        const key   = `${w.id}_${day}_${shiftWeekOffset}`;
        const shift = DB.shifts[key] || 'off';
        const colorMap = { morning: 'shift-morning', afternoon: 'shift-afternoon', night: 'shift-night', off: 'shift-off' };
        return `<td class="shift-cell"><select class="shift-badge ${colorMap[shift]}" style="border:none;background:transparent;cursor:pointer;font-size:0.7rem;font-weight:600;" onchange="setShift('${key}',this.value,this)">${SHIFT_KEYS.map(s => `<option value="${s}"${shift === s ? ' selected' : ''}>${SHIFT_TYPES[SHIFT_KEYS.indexOf(s)]}</option>`).join('')}</select></td>`;
      }).join('')}
    </tr>`).join('')}</tbody>`;
}

function setShift(key, val, el) {
  DB.shifts[key] = val;
  const colorMap = { morning: 'shift-morning', afternoon: 'shift-afternoon', night: 'shift-night', off: 'shift-off' };
  el.className = `shift-badge ${colorMap[val]}`;
  el.style.border = 'none'; el.style.background = 'transparent'; el.style.cursor = 'pointer'; el.style.fontSize = '0.7rem'; el.style.fontWeight = '600';
}

function renderShiftSwaps() {
  $('shiftSwapTbody').innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="fas fa-arrows-rotate"></i>No swap requests</div></td></tr>';
}

/* ============================================================
   21. EQUIPMENT & INVENTORY
   ============================================================ */
function renderEquipment() {
  populateEqSelects();
  filterAndUpdateEquipment();
  filterAndUpdateCheckoutRequests();
  $('addEqBtn')?.addEventListener('click', () => openEqModal());
  $('eqExport')?.addEventListener('click', () => exportCSV(DB.equipment, 'equipment.csv'));
  ['eqSearch','eqCondition','eqStatus2'].forEach(id => $(id)?.addEventListener('input', filterAndUpdateEquipment));
}

function populateEqSelects() {
  const eqAss = $('eq_assignee'); if (eqAss) eqAss.innerHTML = '<option value="">Unassigned</option>' + DB.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  const eqSite = $('eq_site'); if (eqSite) eqSite.innerHTML = '<option value="">No Site</option>' + DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

function filterAndUpdateEquipment() {
  const q    = $('eqSearch')?.value.toLowerCase() || '';
  const cond = $('eqCondition')?.value || '';
  const st   = $('eqStatus2')?.value  || '';
  const filtered = DB.equipment.filter(e => {
    if (q    && !e.name.toLowerCase().includes(q) && !e.serial.toLowerCase().includes(q)) return false;
    if (cond && e.condition !== cond) return false;
    if (st   && e.status   !== st)   return false;
    return true;
  });
  updateEquipmentStats();
  createPaginator('eqTbody', filtered, renderEquipmentBody, { perPage: 10 });
}

function updateEquipmentStats() {
  $('eqStats').innerHTML =
    statCard('fa-toolbox',    'blue',   DB.equipment.length,                                         'Total Items',    '', 'flat') +
    statCard('fa-check',      'green',  DB.equipment.filter(e => e.status === 'available').length,   'Available',      '', 'flat') +
    statCard('fa-hand-holding','yellow',DB.equipment.filter(e => e.status === 'checked-out').length, 'Checked Out',    '', 'flat') +
    statCard('fa-wrench',     'orange', DB.equipment.filter(e => e.status === 'maintenance').length, 'In Maintenance', '', 'flat');
}

function renderEquipmentBody(equipment) {
  if (!equipment.length) { $('eqTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-toolbox"></i>No equipment found</div></td></tr>'; return; }
  $('eqTbody').innerHTML = equipment.map(e => {
    const u = userById(e.assigneeId);
    const s = siteById(e.siteId);
    const serviceAlert = e.nextService && new Date(e.nextService) < new Date() ? 'color:#f87171;' : '';
    const conditionBadge   = e.condition || 'good';
    const statusBadgeClass = e.status === 'available' ? 'active' : e.status === 'checked-out' ? 'in-progress' : 'on-hold';
    return `<tr>
      <td style="font-weight:600;">${e.name}</td>
      <td style="font-size:0.78rem;">${e.category}</td>
      <td><div style="display:flex;align-items:center;gap:0.4rem;"><code style="font-size:0.72rem;">${e.serial}</code><button class="abt" onclick="showQR('${e.serial}','${e.name}')" title="QR"><i class="fas fa-qrcode"></i></button></div></td>
      <td>${statusBadge(conditionBadge)}</td>
      <td>${u ? `<div class="user-cell">${avatarEl(u, 24)}<span style="font-size:0.8rem;">${u.name}</span></div>` : '<span style="color:var(--text3);">—</span>'}</td>
      <td style="font-size:0.78rem;">${s?.name || '—'}</td>
      <td>${statusBadge(statusBadgeClass)}</td>
      <td style="font-size:0.75rem;${serviceAlert}">${fmt(e.nextService)}</td>
      <td>
        <button class="abt warn" onclick="openEqModal(${e.id})"><i class="fas fa-pen"></i></button>
        <button class="abt dan" onclick="deleteEq(${e.id})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function renderEqTable() { filterAndUpdateEquipment(); }

function filterAndUpdateCheckoutRequests() {
  const checkoutRequests = [];
  if (checkoutRequests.length >= 0) {
    createPaginator('eqReqTbody', checkoutRequests, renderCheckoutRequestsBody, { perPage: 10 });
  } else {
    $('eqReqTbody').innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-hand-holding"></i>No checkout requests</div></td></tr>';
  }
}

function renderCheckoutRequestsBody(requests) {
  if (!requests.length) { $('eqReqTbody').innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-hand-holding"></i>No checkout requests found</div></td></tr>'; return; }
  $('eqReqTbody').innerHTML = requests.map(r => `<tr><td style="font-weight:600;">${r.item}</td><td>${r.requestedBy}</td><td style="font-size:0.75rem;">${fmt(r.date)}</td><td style="font-size:0.8rem;">${r.purpose}</td><td>${statusBadge(r.status === 'pending' ? 'pending' : r.status === 'approved' ? 'active' : 'inactive')}</td><td><button class="abt suc" onclick="approveCheckout(${r.id})"><i class="fas fa-check"></i></button><button class="abt dan" onclick="rejectCheckout(${r.id})"><i class="fas fa-times"></i></button></td></tr>`).join('');
}

function approveCheckout(requestId) { toast(`Checkout request #${requestId} approved`, 'success'); filterAndUpdateCheckoutRequests(); }
function rejectCheckout(requestId)  { toast(`Checkout request #${requestId} rejected`, 'warn');  filterAndUpdateCheckoutRequests(); }

function openEqModal(eqId = null) {
  populateEqSelects();
  const e = eqId ? DB.equipment.find(x => x.id === eqId) : null;
  $('eqTitle').textContent  = e ? 'Edit Equipment' : 'Add Equipment';
  $('eq_name').value        = e?.name       || '';
  $('eq_cat').value         = e?.category   || '';
  $('eq_serial').value      = e?.serial     || '';
  $('eq_condition').value   = e?.condition  || 'good';
  $('eq_assignee').value    = e?.assigneeId || '';
  $('eq_site').value        = e?.siteId     || '';
  $('eq_service').value     = e?.nextService|| '';
  $('eq_status').value      = e?.status     || 'available';
  $('eq_save').onclick = () => saveEq(eqId);
  openM('equipModal');
}

function saveEq(eqId) {
  const data = { name: $('eq_name').value.trim(), category: $('eq_cat').value.trim(), serial: $('eq_serial').value.trim(), condition: $('eq_condition').value, assigneeId: +$('eq_assignee').value || null, siteId: +$('eq_site').value || null, nextService: $('eq_service').value, status: $('eq_status').value };
  if (!data.name) { toast('Name required', 'error'); return; }
  if (eqId) { Object.assign(DB.equipment.find(e => e.id === eqId), data); logAction('update', 'Equipment', `Updated ${data.name}`); }
  else { DB.equipment.push({ id: generateId('equipment'), ...data }); logAction('create', 'Equipment', `Added ${data.name}`); }
  closeM('equipModal'); filterAndUpdateEquipment(); toast('Equipment saved', 'success');
}

function deleteEq(id) {
  if (!confirm('Delete this equipment?')) return;
  DB.equipment.splice(DB.equipment.findIndex(e => e.id === id), 1);
  filterAndUpdateEquipment(); toast('Equipment deleted', 'success');
}

function showQR(serial, name) {
  $('qrBody').innerHTML = `<div style="font-weight:700;margin-bottom:1rem;">${name}</div><div style="font-size:4rem;margin:1rem 0;">📦</div><div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:1.1rem;letter-spacing:3px;">${serial}</div><div style="font-size:0.75rem;color:var(--text3);margin-top:0.5rem;">(QR code would render here in production)</div>`;
  openM('qrModal');
}

/* ============================================================
   22. DOCUMENTS
   ============================================================ */
function renderDocuments() {
  filterAndUpdateDocuments();
  $('uploadDocBtn')?.addEventListener('click', () => toast('Document upload (demo — connect file server)', 'info'));
  $('docExport')?.addEventListener('click', () => exportCSV(DB.documents, 'documents.csv'));
  ['docSearch','docUser','docStatus'].forEach(id => $(id)?.addEventListener('input', filterAndUpdateDocuments));
}

function filterAndUpdateDocuments() {
  const q   = $('docSearch')?.value.toLowerCase() || '';
  const uid = +$('docUser')?.value || 0;
  const st  = $('docStatus')?.value || '';
  const filtered = DB.documents.filter(d => {
    if (q   && !d.name.toLowerCase().includes(q)) return false;
    if (uid && d.userId !== uid) return false;
    if (st === 'expiring') { const diff = (new Date(d.expiry) - new Date()) / 86400000; return diff >= 0 && diff <= 30; }
    if (st  && d.status !== st) return false;
    return true;
  });
  updateDocumentStats();
  createPaginator('docTbody', filtered, renderDocTableBody, { perPage: 10 });
}

function updateDocumentStats() {
  const approved = DB.documents.filter(d => d.status === 'approved').length;
  const pending  = DB.documents.filter(d => d.status === 'pending').length;
  const expiring = DB.documents.filter(d => { const diff = (new Date(d.expiry) - new Date()) / 86400000; return diff >= 0 && diff <= 30; }).length;
  $('docStats').innerHTML =
    statCard('fa-folder-open',       'blue',   DB.documents.length, 'Total Docs',    '', 'flat') +
    statCard('fa-check',             'green',  approved,            'Approved',      '', 'flat') +
    statCard('fa-hourglass',         'yellow', pending,             'Pending Review','', 'flat') +
    statCard('fa-triangle-exclamation','orange',expiring,           'Expiring Soon', '', 'flat');
}

function renderDocTableBody(documents) {
  if (!documents.length) { $('docTbody').innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-folder-open"></i>No documents found</div></td></tr>'; return; }
  $('docTbody').innerHTML = documents.map(d => {
    const u = userById(d.userId);
    const diff = (new Date(d.expiry) - new Date()) / 86400000;
    const expiryCls = diff < 0 ? 'color:#f87171;' : (diff < 30 ? 'color:#f97316;' : '');
    return `<tr>
      <td><div class="user-cell">${avatarEl(u, 26)}<span>${u?.name || 'Unknown'}</span></div></td>
      <td style="font-weight:600;">${d.name}</td>
      <td><span class="badge b-update">${d.type}</span></td>
      <td style="font-size:0.75rem;">${fmt(d.uploaded)}</td>
      <td style="font-size:0.75rem;${expiryCls}">${fmt(d.expiry)}${diff < 30 && diff >= 0 ? ' ⚠️' : ''}</td>
      <td>${statusBadge(d.status)}</td>
      <td style="font-size:0.75rem;">${d.notes || '—'}</td>
      <td>
        ${d.status === 'pending' ? `<button class="abt suc" onclick="decideDoc(${d.id},'approved')"><i class="fas fa-check"></i></button><button class="abt dan" onclick="decideDoc(${d.id},'rejected')"><i class="fas fa-times"></i></button>` : ''}
        <button class="abt inf" onclick="previewDoc(${d.id})"><i class="fas fa-eye"></i></button>
        <button class="abt" onclick="requestDoc(${d.userId})"><i class="fas fa-envelope"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function renderDocTable() { filterAndUpdateDocuments(); }

function decideDoc(id, decision) {
  const d = DB.documents.find(x => x.id === id); if (!d) return;
  const u = userById(d.userId);
  d.status = decision;
  logAction(decision === 'approved' ? 'approve' : 'reject', `Doc #${id}`, `${decision} "${d.name}" for ${u?.name}`);
  sendEmail(u?.email || '', `Document ${decision}`, 'doc_decision');
  filterAndUpdateDocuments(); toast(`Document ${decision}`, 'success');
}

function requestDoc(userId) {
  const u = userById(userId);
  if (u?.email) { sendEmail(u.email, 'Missing Document Request', 'doc_request'); toast(`Document request sent to ${u.name}`, 'info'); }
  else toast('No email address found for this user', 'error');
}

function previewDoc(docId) {
  const d = DB.documents.find(x => x.id === docId);
  if (d) toast(`Previewing: ${d.name} (demo)`, 'info');
}

/* ============================================================
   23. NOTIFICATIONS
   ============================================================ */
function renderNotifications() {
  renderNotifList();
  $('markAllReadBtn')?.addEventListener('click', () => { DB.notifications.forEach(n => n.read = true); renderNotifList(); renderDashboard(); toast('All marked read', 'success'); });
  $('clearNotifBtn')?.addEventListener('click', () => { if (confirm('Clear all notifications?')) { DB.notifications = []; renderNotifList(); renderDashboard(); toast('Notifications cleared', 'success'); } });
  renderNotifPrefs();
  ['notifTypeFilter','notifReadFilter'].forEach(id => $(id)?.addEventListener('change', renderNotifList));
}

function renderNotifList() {
  const type     = $('notifTypeFilter')?.value || '';
  const read     = $('notifReadFilter')?.value || '';
  const iconMap  = { approval: 'fa-user-check', task: 'fa-list-check', leave: 'fa-calendar', system: 'fa-server', alert: 'fa-triangle-exclamation' };
  const colorMap = { approval: 'rgba(16,185,129,0.15)', task: 'rgba(59,130,246,0.15)', leave: 'rgba(234,179,8,0.15)', system: 'rgba(100,116,139,0.15)', alert: 'rgba(239,68,68,0.15)' };
  const rows = DB.notifications.filter(n => {
    if (type && n.type !== type)     return false;
    if (read === 'unread' &&  n.read) return false;
    if (read === 'read'   && !n.read) return false;
    return true;
  });
  $('notifList').innerHTML = rows.map(n => `
    <div class="notif-item${n.read ? '' : ' unread'}" onclick="markNotifRead(${n.id})">
      <div class="notif-icon" style="background:${colorMap[n.type] || 'var(--surface2)'};"><i class="fas ${iconMap[n.type] || 'fa-bell'}"></i></div>
      <div class="notif-body"><div class="notif-title">${n.title}</div><div class="notif-desc">${n.desc}</div><div class="notif-time">${n.time}</div></div>
      ${n.read ? '' : '<div class="notif-unread-dot"></div>'}
      <button class="abt dan" onclick="deleteNotif(${n.id});event.stopPropagation()"><i class="fas fa-times"></i></button>
    </div>`).join('') || '<div class="empty-state"><i class="fas fa-bell-slash"></i>No notifications</div>';
}

function markNotifRead(id) { const n = DB.notifications.find(x => x.id === id); if (n) n.read = true; renderNotifList(); }
function deleteNotif(id)   { DB.notifications.splice(DB.notifications.findIndex(n => n.id === id), 1); renderNotifList(); }

function renderNotifPrefs() {
  const prefs = [{ label: 'Approval Notifications', key: 'approval' }, { label: 'Task Assignments', key: 'task' }, { label: 'Leave Decisions', key: 'leave' }, { label: 'System Alerts', key: 'system' }, { label: 'Equipment Alerts', key: 'alert' }];
  $('notifPrefs').innerHTML = prefs.map(p => `<div class="sw-row"><div class="sw-info"><div class="sw-label">${p.label}</div></div><label class="sw"><input type="checkbox" checked><span class="sw-sl"></span></label></div>`).join('');
}

/* ============================================================
   24. EMAIL CENTER
   ============================================================ */
function renderEmailCenter() {
  wireETabs();
  filterAndUpdateEmailLog();
  renderEmailTemplates();
  $('compSendBtn')?.addEventListener('click', sendComposedEmail);
  $('bulkSendBtn')?.addEventListener('click', sendBulkEmail);
}

function wireETabs() {
  const panels = { log: 'et-log', compose: 'et-compose', bulk: 'et-bulk', templates: 'et-templates' };
  $$('[data-etab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-etab]').forEach(b => b.classList.remove('active')); btn.classList.add('active');
      Object.values(panels).forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
      const target = $(panels[btn.dataset.etab]); if (target) target.style.display = '';
      if (btn.dataset.etab === 'log') filterAndUpdateEmailLog();
    });
  });
}

function filterAndUpdateEmailLog() {
  const st = $('emailLogStatus')?.value || '';
  const q  = $('emailLogSearch')?.value.toLowerCase() || '';
  const filtered = DB.emailLog.filter(e => {
    if (st && e.status !== st) return false;
    if (q  && !e.to.includes(q) && !e.subject.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  createPaginator('emailLogTbody', filtered, renderEmailLogBody, { perPage: 10 });
  $('emailLogSearch')?.addEventListener('input', filterAndUpdateEmailLog);
  $('emailLogStatus')?.addEventListener('change', filterAndUpdateEmailLog);
}

function renderEmailLogBody(emails) {
  if (!emails.length) { $('emailLogTbody').innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-inbox"></i>No emails found</div></td></tr>'; return; }
  $('emailLogTbody').innerHTML = emails.map(e => `
    <tr>
      <td>${e.to}</td>
      <td>${e.subject}</td>
      <td style="font-size:0.75rem;"><code>${e.template}</code></td>
      <td style="font-size:0.75rem;">${e.sentAt}</td>
      <td>${statusBadge(e.status === 'sent' ? 'active' : e.status === 'failed' ? 'inactive' : 'pending')}</td>
      <td><button class="abt inf" onclick="resendEmail(${e.id})"><i class="fas fa-rotate-right"></i></button></td>
    </tr>`).join('');
}

function renderEmailLog() { filterAndUpdateEmailLog(); }

function sendComposedEmail() {
  const to = $('compTo')?.value.trim(); const subject = $('compSubject')?.value.trim();
  if (!to || !subject) { toast('To and Subject required', 'error'); return; }
  sendEmail(to, subject, 'manual');
  toast(`Email sent to ${to}`, 'success');
  $('compTo').value = ''; $('compSubject').value = ''; $('compBody').value = '';
  filterAndUpdateEmailLog();
}

function sendBulkEmail() {
  const targets = [...$('bulkEmailTargets').querySelectorAll('input:checked')].map(i => i.value);
  if (!targets.length) { toast('Select at least one group', 'warn'); return; }
  let count = 0;
  if (targets.includes('all')) count = DB.users.length;
  else targets.forEach(t => { count += DB.users.filter(u => u.role === t).length; });
  toast(`Bulk email queued for ${count} recipients`, 'success');
  logAction('create', 'Email', `Bulk email to: ${targets.join(', ')}`);
  filterAndUpdateEmailLog();
}

function resendEmail(emailId) {
  const email = DB.emailLog.find(e => e.id === emailId);
  if (email) { sendEmail(email.to, email.subject, email.template); toast(`Resending email to ${email.to}`, 'info'); }
  else toast('Email not found', 'error');
}

function renderEmailTemplates() {
  const templates = [
    { id: 'welcome_approved', name: 'Welcome / Approved',   desc: 'Sent when a user is approved.' },
    { id: 'leave_decision',   name: 'Leave Decision',       desc: 'Sent on leave approve/reject.' },
    { id: 'task_assigned',    name: 'Task Assigned',        desc: 'Sent when a task is assigned.' },
    { id: 'payslip',          name: 'Payslip Ready',        desc: 'Sent when payslip is generated.' },
    { id: 'incident_alert',   name: 'Critical Incident',    desc: 'Sent on critical safety incident.' },
    { id: 'doc_request',      name: 'Document Request',     desc: 'Sent to request missing documents.' },
    { id: 'ticket_update',    name: 'Ticket Update',        desc: 'Sent when a ticket status changes.' },
    { id: 'password_reset',   name: 'Password Reset',       desc: 'Sent when user requests password reset.' },
  ];
  $('emailTemplatesList').innerHTML = templates.map(t => `
    <div class="cat-item" style="margin-bottom:0.5rem;">
      <i class="fas fa-file-lines" style="color:var(--accent);"></i>
      <div style="flex:1;"><div class="ci-name">${t.name}</div><div style="font-size:0.72rem;color:var(--text3);">${t.desc}</div></div>
      <code style="font-size:0.68rem;color:var(--text3);">${t.id}</code>
    </div>`).join('');
}

/* ============================================================
   25. SAFETY & INCIDENTS (MERGED — Incidents + Hazards unified)
   ============================================================ */

/* ── Modal builder (runs once, idempotent) ─────────────────── */
function createMergedSafetyModal() {
  if ($('mergedSafetyModal')) return;          /* already exists */
  
  const siteOpts = DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-ov" id="mergedSafetyModal">
      <div class="modal-box md">
        <div class="mhdr">
          <h4><i class="fas fa-shield-halved"></i> Report Incident / Hazard</h4>
          <button class="xbtn" data-close="mergedSafetyModal"><i class="fas fa-times"></i></button>
        </div>
        <div class="mbody">
          <div class="frow">
            <div class="fg">
              <label class="fl">Date &amp; Time</label>
              <input class="fc" id="ms_date" type="datetime-local">
            </div>
            <div class="fg">
              <label class="fl">Site</label>
              <select class="fc" id="ms_site">
                <option value="">Select Site</option>
                ${siteOpts}
              </select>
            </div>
          </div>
          <div class="frow">
            <div class="fg">
              <label class="fl">Type</label>
              <select class="fc" id="ms_type">
                <option value="injury">Injury</option>
                <option value="near-miss">Near Miss</option>
                <option value="property">Property Damage</option>
                <option value="hazard">Hazard</option>
                <option value="fire">Fire</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="fg">
              <label class="fl">Severity</label>
              <select class="fc" id="ms_severity">
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div class="fg">
            <label class="fl">Description</label>
            <textarea class="fc" id="ms_desc" rows="4" placeholder="Describe the incident or hazard in detail..."></textarea>
          </div>
          <div class="fg">
            <label class="fl">Immediate Actions Taken</label>
            <textarea class="fc" id="ms_actions" rows="2" placeholder="What actions were taken immediately?"></textarea>
          </div>
        </div>
        <div class="mftr">
          <button class="btn btn-outline" data-close="mergedSafetyModal">Cancel</button>
          <button class="btn btn-accent" id="ms_save"><i class="fas fa-paper-plane"></i> Submit Report</button>
        </div>
      </div>
    </div>`);
  
  // Bind save event - remove any existing listener first
  const saveBtn = $('ms_save');
  if (saveBtn) {
    const newBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newBtn, saveBtn);
    newBtn.addEventListener('click', saveMergedSafetyItem);
  }
}

/* ── Open modal: reset fields + populate sites fresh ────────── */
function openMergedSafetyModal() {
  createMergedSafetyModal();   /* no-op if already exists */

  /* Always refresh site list in case sites changed */
  const siteSelect = $('ms_site');
  if (siteSelect) {
    siteSelect.innerHTML = '<option value="">Select Site</option>' + DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    /* Pre-select first site so siteId is never empty */
    if (DB.sites.length) siteSelect.value = String(DB.sites[0].id);
  }

  /* Reset all fields */
  const dateInput = $('ms_date');
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 16);
  
  const typeSelect = $('ms_type');
  if (typeSelect) typeSelect.value = 'injury';
  
  const severitySelect = $('ms_severity');
  if (severitySelect) severitySelect.value = 'medium';
  
  const descTextarea = $('ms_desc');
  if (descTextarea) descTextarea.value = '';
  
  const actionsTextarea = $('ms_actions');
  if (actionsTextarea) actionsTextarea.value = '';

  openM('mergedSafetyModal');
}

/* ── Save merged safety item ───────────────────────────────── */
function saveMergedSafetyItem() {
  const dateEl = $('ms_date');
  const siteEl = $('ms_site');
  const typeEl = $('ms_type');
  const severityEl = $('ms_severity');
  const descEl = $('ms_desc');
  const actionsEl = $('ms_actions');

  /* Validation */
  const desc = descEl?.value.trim();
  if (!desc) {
    toast('Description is required', 'error');
    descEl?.focus();
    return;
  }

  const siteId = siteEl?.value ? +siteEl.value : (DB.sites[0]?.id || 1);
  if (!siteId || siteEl?.value === '') {
    toast('Please select a site', 'error');
    siteEl?.focus();
    return;
  }

  // Initialize nextId.incidents if it doesn't exist
  if (!nextId['incidents']) {
    nextId['incidents'] = (DB.incidents?.length || 0) + 1;
  }

  const entry = {
    id:         nextId['incidents']++,
    date:       dateEl?.value || nowStr(),
    siteId:     siteId,
    reporterId: currentUser.id,
    type:       typeEl?.value || 'other',
    severity:   severityEl?.value || 'medium',
    desc:       desc,
    actions:    actionsEl?.value.trim() || '',
    status:     'open',
  };

  // Initialize DB.incidents if it doesn't exist
  if (!DB.incidents) DB.incidents = [];
  
  DB.incidents.unshift(entry);
  logAction('create', 'Safety Issue', `${entry.severity} ${entry.type} at site #${entry.siteId}`);

  /* Close modal */
  closeM('mergedSafetyModal');

  /* Refresh all views */
  renderSafetyOverview();
  renderSafetyScores();
  
  /* Refresh the merged table if that tab is active or not (always refresh data) */
  filterAndUpdateMergedSafety();

  if (entry.severity === 'critical') {
    toast('⚠️ Critical alert — administrators notified', 'warn', 4000);
  }
  
  toast(`${entry.type.charAt(0).toUpperCase() + entry.type.slice(1)} reported successfully`, 'success');
}

/* ── Main render ───────────────────────────────────────────── */
function renderSafety() {
  createMergedSafetyModal();
  createSafetyDetailModal(); // Create the detail modal
  
  /* Tab panel map — matches data-stab values in the HTML */
  const PANELS = {
    overview:           'st-overview',
    inductions:         'st-inductions',
    'incidents-hazards':'st-incidents-hazards',
    exports:            'st-exports',
    checklist:          'st-checklist',
    training:           'st-training',
    score:              'st-score',
  };
 
  /* Hide all panels; show overview by default */
  Object.values(PANELS).forEach(id => { const el=$(id); if(el) el.style.display='none'; });
  const overviewEl = $('st-overview');
  if (overviewEl) overviewEl.style.display = '';
 
  /* Wire tab buttons (clone to avoid duplicate listeners) */
  $$('[data-stab]').forEach(btn => {
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', () => {
      $$('[data-stab]').forEach(b => b.classList.remove('active'));
      fresh.classList.add('active');
      Object.values(PANELS).forEach(id => { const el=$(id); if(el) el.style.display='none'; });
      const target = $(PANELS[fresh.dataset.stab]);
      if (target) target.style.display = '';
      /* Lazy-load tab content */
      switch (fresh.dataset.stab) {
        case 'overview':          renderSafetyOverview(); renderSafetyScores(); break;
        case 'inductions':        filterAndUpdateInductions(); break;
        case 'incidents-hazards': filterAndUpdateMergedSafety(); break;
        case 'checklist':         renderChecklist(); break;
        case 'training':          filterAndUpdateTraining(); break;
        case 'score':             renderSafetyScores(); break;
      }
    });
  });
 
  /* Populate all site selects */
  populateSafetySelects();
 
  /* Wire "Report" button (clone to avoid duplicates) */
  const rBtn = $('reportIncidentBtn');
  if (rBtn) {
    const fresh = rBtn.cloneNode(true);
    rBtn.parentNode.replaceChild(fresh, rBtn);
    fresh.addEventListener('click', openMergedSafetyModal);
  }
 
  /* Other action buttons */
  $('incExport')?.addEventListener('click', () => exportCSV(DB.incidents, 'incidents_hazards.csv'));
  $('addTrainingBtn')?.addEventListener('click', () => toast('Training form — coming soon', 'info'));
  $('safeRptGenerate')?.addEventListener('click', generateSafetyReport);
 
  /* Filter listeners for merged table */
  ['incSeverity','incSite','mergedStatusFilter'].forEach(id => {
    const el = $(id); if (!el) return;
    const fresh = el.cloneNode(true);
    el.parentNode.replaceChild(fresh, el);
    fresh.addEventListener('change', filterAndUpdateMergedSafety);
  });
 
  /* Filter listeners for inductions */
  ['indSearch','indStatus'].forEach(id => {
    const el = $(id);
    if (el) {
      const fresh = el.cloneNode(true);
      el.parentNode.replaceChild(fresh, el);
      fresh.addEventListener('input', filterAndUpdateInductions);
    }
  });
 
  /* Set active tab highlight on first load */
  const firstActive = document.querySelector('[data-stab].active');
  if (!firstActive) {
    const overviewBtn = document.querySelector('[data-stab="overview"]');
    if (overviewBtn) overviewBtn.classList.add('active');
  }
 
  /* Default data loads */
  renderSafetyOverview();
  renderChecklist();
  renderSafetyScores();
 
  /* Default export dates */
  if ($('safeRptFrom') && !$('safeRptFrom').value) $('safeRptFrom').value = new Date().toISOString().slice(0,10);
  if ($('safeRptTo') && !$('safeRptTo').value) $('safeRptTo').value = new Date().toISOString().slice(0,10);
}

/* ── Create Safety Detail Modal (matches other popup designs) ── */
function createSafetyDetailModal() {
  if ($('safetyDetailModal')) return;
  
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-ov" id="safetyDetailModal">
      <div class="modal-box lg">
        <div class="mhdr">
          <h4><i class="fas fa-shield-halved"></i> <span id="sdTitle">Incident / Hazard Details</span></h4>
          <button class="xbtn" data-close="safetyDetailModal"><i class="fas fa-times"></i></button>
        </div>
        <div class="mbody" id="safetyDetailBody"></div>
        <div class="mftr">
          <button class="btn btn-outline" data-close="safetyDetailModal">Close</button>
          <button class="btn btn-accent btn-sm" id="safetyDetailResolveBtn" style="display:none;"><i class="fas fa-check"></i> Resolve</button>
          <button class="btn btn-danger btn-sm" id="safetyDetailDeleteBtn" style="display:none;"><i class="fas fa-trash"></i> Delete</button>
        </div>
      </div>
    </div>
  `);
}
 
/* ── Site select populator ─────────────────────────────────── */
function populateSafetySelects() {
  const allOpt  = '<option value="">All Sites</option>';
  const selOpt  = '<option value="">Select a site</option>';
  const siteOpts = DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  
  const incSite = $('incSite');
  if (incSite) incSite.innerHTML = allOpt + siteOpts;
  
  const checklistSite = $('checklistSite');
  if (checklistSite) checklistSite.innerHTML = allOpt + siteOpts;
  
  const safeActiveSite = $('safeActiveSite');
  if (safeActiveSite) safeActiveSite.innerHTML = selOpt + siteOpts;
  
  const msSite = $('ms_site');
  if (msSite) msSite.innerHTML = selOpt + siteOpts;
}
 
/* ── Overview stats ────────────────────────────────────────── */
function renderSafetyOverview() {
  const el = $('safeOverviewStats'); if (!el) return;
  const total    = DB.incidents?.length || 0;
  const open     = (DB.incidents || []).filter(i => i.status === 'open').length;
  const critical = (DB.incidents || []).filter(i => i.severity === 'critical').length;
  const inducted = DB.users.filter(u => u.status === 'active').length;
  el.innerHTML =
    statCard('fa-users',               'blue',   DB.users.length, 'Total Workers',   '', 'flat') +
    statCard('fa-user-check',          'green',  inducted,        'Active / Inducted','', 'flat') +
    statCard('fa-triangle-exclamation','red',    open,            'Open Issues',      open > 0 ? 'Action needed' : '', open > 0 ? 'down' : 'flat') +
    statCard('fa-skull-crossbones',    'orange', critical,        'Critical',         critical > 0 ? 'Urgent' : '', critical > 0 ? 'down' : 'flat');
}
 
/* ── Merged Incidents & Hazards ────────────────────────────── */
function filterAndUpdateMergedSafety() {
  const severity     = $('incSeverity')?.value       || '';
  const siteId       = +($('incSite')?.value         || 0);
  const statusFilter = $('mergedStatusFilter')?.value || '';
 
  let filtered = (DB.incidents || []).filter(i =>
    (!severity     || i.severity === severity) &&
    (!siteId       || i.siteId   === siteId)   &&
    (!statusFilter || i.status   === statusFilter)
  );
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
 
  /* Stats banner */
  const statsEl = $('safetyStats');
  if (statsEl) {
    const crit  = filtered.filter(i => i.severity === 'critical').length;
    const high  = filtered.filter(i => i.severity === 'high').length;
    const open  = filtered.filter(i => i.status   === 'open').length;
    const res   = filtered.filter(i => i.status   === 'resolved').length;
    statsEl.innerHTML =
      statCard('fa-list',                'blue',   filtered.length, 'Total Records',  '', 'flat') +
      statCard('fa-skull-crossbones',    'red',    crit,            'Critical',        '', crit > 0 ? 'down' : 'flat') +
      statCard('fa-triangle-exclamation','orange', high,            'High Severity',   '', 'flat') +
      statCard('fa-folder-open',         'yellow', open,            'Open',            '', 'flat') +
      statCard('fa-check-circle',        'green',  res,             'Resolved',        '', 'flat');
  }
 
  createPaginator('mergedSafetyTbody', filtered, renderMergedSafetyBody, { perPage: 10 });
}
 
function renderMergedSafetyBody(incidents) {
  const tbody = $('mergedSafetyTbody'); if (!tbody) return;
  if (!incidents.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-shield-check"></i>No incidents or hazards found</div>NonNullable</td></tr>';
    return;
  }
  const typeIcon = { injury:'fa-user-injured', 'near-miss':'fa-eye', property:'fa-building', hazard:'fa-bug', fire:'fa-fire', other:'fa-circle-info' };
  tbody.innerHTML = incidents.map(item => {
    const site     = siteById(item.siteId);
    const reporter = userById(item.reporterId);
    const icon     = typeIcon[item.type] || 'fa-circle-info';
    const shortDesc = escapeHtml((item.desc||'').substring(0, 60)) + ((item.desc||'').length > 60 ? '…' : '');
    return `<tr>
      <td style="font-size:0.75rem;white-space:nowrap;">${item.date}</td>
      <td style="font-size:0.8rem;">${site?.name || '—'}</td>
      <td><div class="user-cell">${avatarEl(reporter,24)}<span style="font-size:0.78rem;">${reporter?.name || 'System'}</span></div></td>
      <td><span class="badge b-update"><i class="fas ${icon}"></i> ${item.type}</span></td>
      <td>${severityBadge(item.severity)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem;" title="${escapeHtml(item.desc||'')}">${shortDesc}</td>
      <td>${statusBadge(item.status === 'open' ? 'active' : 'completed')}</td>
      <td>
        <div style="display:flex;gap:0.2rem;">
          <button class="abt inf" title="View Detail" onclick="viewSafetyDetail(${item.id})"><i class="fas fa-eye"></i></button>
          ${item.status === 'open' ? `<button class="abt suc" title="Resolve" onclick="resolveSafetyItem(${item.id})"><i class="fas fa-check"></i></button>` : ''}
          <button class="abt dan" title="Delete" onclick="deleteSafetyItem(${item.id})"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}
 
/* ── Helper: escape HTML ───────────────────────────────────── */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
 
/* ── View detail in beautiful modal (matches other popups) ──── */
function viewSafetyDetail(id) {
  const item = (DB.incidents || []).find(x => x.id === id); 
  if (!item) return;
  
  const site = siteById(item.siteId);
  const reporter = userById(item.reporterId);
  
  // Get status badge HTML
  const statusHtml = item.status === 'open' 
    ? '<span class="badge" style="background:rgba(234,179,8,0.15);color:#eab308;"><i class="fas fa-circle" style="font-size:0.65rem;"></i> Open</span>'
    : '<span class="badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fas fa-check-circle"></i> Resolved</span>';
  
  // Get severity badge HTML
  let severityColor = '';
  let severityIcon = '';
  switch(item.severity) {
    case 'critical': severityColor = '#ef4444'; severityIcon = 'fa-skull-crossbones'; break;
    case 'high': severityColor = '#f97316'; severityIcon = 'fa-exclamation-triangle'; break;
    case 'medium': severityColor = '#eab308'; severityIcon = 'fa-chart-line'; break;
    default: severityColor = '#10b981'; severityIcon = 'fa-circle-info';
  }
  const severityHtml = `<span class="badge" style="background:${severityColor}22;color:${severityColor};"><i class="fas ${severityIcon}"></i> ${item.severity.toUpperCase()}</span>`;
  
  // Get type icon
  const typeIcons = { 
    injury: 'fa-user-injured', 
    'near-miss': 'fa-eye', 
    property: 'fa-building', 
    hazard: 'fa-bug', 
    fire: 'fa-fire', 
    other: 'fa-circle-info' 
  };
  const typeIcon = typeIcons[item.type] || 'fa-circle-info';
  
  // Build modal content
  const modalBody = `
    <div style="display:flex;flex-direction:column;gap:1.25rem;">
      <!-- Header with title and status -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;padding-bottom:0.75rem;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <div style="width:48px;height:48px;background:${severityColor}22;border-radius:12px;display:flex;align-items:center;justify-content:center;">
            <i class="fas ${typeIcon}" style="font-size:1.5rem;color:${severityColor};"></i>
          </div>
          <div>
            <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:1.1rem;">${item.type.charAt(0).toUpperCase() + item.type.slice(1)}</div>
            <div style="font-size:0.72rem;color:var(--text3);">ID: #${String(item.id).padStart(4, '0')}</div>
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;">
          ${severityHtml}
          ${statusHtml}
        </div>
      </div>
      
      <!-- Info grid (2 columns) -->
      <div class="info-grid" style="grid-template-columns: repeat(2, 1fr); gap: 1rem;">
        <div class="info-item">
          <div class="il" style="color:var(--text3);font-size:0.72rem;">Date &amp; Time</div>
          <div class="iv" style="font-size:0.9rem;font-weight:500;">${item.date}</div>
        </div>
        <div class="info-item">
          <div class="il" style="color:var(--text3);font-size:0.72rem;">Site</div>
          <div class="iv" style="font-size:0.9rem;font-weight:500;">${site?.name || '—'}</div>
        </div>
        <div class="info-item">
          <div class="il" style="color:var(--text3);font-size:0.72rem;">Reported By</div>
          <div class="iv" style="display:flex;align-items:center;gap:0.5rem;">
            ${avatarEl(reporter, 28)} 
            <span style="font-size:0.9rem;font-weight:500;">${reporter?.name || 'System'}</span>
          </div>
        </div>
        <div class="info-item">
          <div class="il" style="color:var(--text3);font-size:0.72rem;">Reported At</div>
          <div class="iv" style="font-size:0.9rem;font-weight:500;">${item.date}</div>
        </div>
      </div>
      
      <!-- Description section -->
      <div style="background:var(--surface2);border-radius:12px;padding:1rem;">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;">
          <i class="fas fa-file-alt" style="color:var(--accent);font-size:0.85rem;"></i>
          <span style="font-weight:600;font-size:0.85rem;">Description</span>
        </div>
        <div style="font-size:0.85rem;line-height:1.5;color:var(--text2);white-space:pre-wrap;">${escapeHtml(item.desc)}</div>
      </div>
      
      <!-- Actions section -->
      <div style="background:var(--surface2);border-radius:12px;padding:1rem;">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;">
          <i class="fas fa-clipboard-list" style="color:var(--accent);font-size:0.85rem;"></i>
          <span style="font-weight:600;font-size:0.85rem;">Immediate Actions Taken</span>
        </div>
        <div style="font-size:0.85rem;line-height:1.5;color:var(--text2);white-space:pre-wrap;">${item.actions || 'No actions reported'}</div>
      </div>
      
      <!-- Timeline / Activity -->
      <div style="background:var(--surface2);border-radius:12px;padding:1rem;">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;">
          <i class="fas fa-history" style="color:var(--accent);font-size:0.85rem;"></i>
          <span style="font-weight:600;font-size:0.85rem;">Activity Timeline</span>
        </div>
        <div style="font-size:0.8rem;color:var(--text3);">
          <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border);">
            <span><i class="fas fa-flag-checkered"></i> Reported</span>
            <span>${item.date}</span>
          </div>
          ${item.status === 'resolved' ? `
          <div style="display:flex;justify-content:space-between;padding:0.5rem 0;">
            <span><i class="fas fa-check-circle" style="color:#10b981;"></i> Resolved</span>
            <span>${item.resolvedAt || item.date}</span>
          </div>` : ''}
        </div>
      </div>
    </div>
  `;
  
  // Set modal content
  const bodyEl = $('safetyDetailBody');
  if (bodyEl) bodyEl.innerHTML = modalBody;
  
  // Set title
  const titleEl = $('sdTitle');
  if (titleEl) titleEl.textContent = `${item.type.charAt(0).toUpperCase() + item.type.slice(1)} Details`;
  
  // Configure action buttons
  const resolveBtn = $('safetyDetailResolveBtn');
  const deleteBtn = $('safetyDetailDeleteBtn');
  
  if (resolveBtn) {
    if (item.status === 'open') {
      resolveBtn.style.display = '';
      const newResolveBtn = resolveBtn.cloneNode(true);
      resolveBtn.parentNode.replaceChild(newResolveBtn, resolveBtn);
      newResolveBtn.addEventListener('click', () => {
        closeM('safetyDetailModal');
        resolveSafetyItem(id);
      });
    } else {
      resolveBtn.style.display = 'none';
    }
  }
  
  if (deleteBtn) {
    deleteBtn.style.display = '';
    const newDeleteBtn = deleteBtn.cloneNode(true);
    deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
    newDeleteBtn.addEventListener('click', () => {
      closeM('safetyDetailModal');
      deleteSafetyItem(id);
    });
  }
  
  openM('safetyDetailModal');
}
 
/* ── Resolve / Delete ──────────────────────────────────────── */
function resolveSafetyItem(id, closeModal = true) {
  if (!confirm('Mark this item as resolved?')) return;
  const item = (DB.incidents || []).find(x => x.id === id); 
  if (!item) return;
  item.status = 'resolved';
  item.resolvedAt = nowStr();
  logAction('update', `Safety Issue #${id}`, `Resolved: ${item.type}`);
  filterAndUpdateMergedSafety();
  renderSafetyOverview();
  renderSafetyScores();
  toast('Item marked as resolved', 'success');
}
 
function deleteSafetyItem(id, closeModal = true) {
  if (!confirm('⚠️ Permanently delete this record?')) return;
  const idx = (DB.incidents || []).findIndex(x => x.id === id);
  if (idx > -1) {
    const item = DB.incidents[idx];
    DB.incidents.splice(idx, 1);
    logAction('delete', `Safety Issue #${id}`, `Deleted: ${item.type}`);
  }
  filterAndUpdateMergedSafety();
  renderSafetyOverview();
  renderSafetyScores();
  toast('Record deleted', 'success');
}
 
/* ── Inductions ────────────────────────────────────────────── */
function filterAndUpdateInductions() {
  const q  = ($('indSearch')?.value  || '').toLowerCase();
  const st = $('indStatus')?.value   || '';
  const statusMap = ['Inducted','Pending Review','In Progress','Not Started','Expired'];
  const rows = DB.users
    .filter(u => u.role !== 'admin')
    .map((u, idx) => ({
      user:    u,
      company: siteById(DB.sites[idx % DB.sites.length]?.id)?.name || 'Main Contractor',
      status:  statusMap[idx % statusMap.length],
      updated: nowStr().slice(0,10),
    }))
    .filter(r =>
      (!q  || r.user.name.toLowerCase().includes(q) || r.company.toLowerCase().includes(q)) &&
      (!st || r.status === st)
    );
  createPaginator('indTbody', rows, renderInductionsBody, { perPage: 10 });
}
 
function renderInductionsBody(rows) {
  const tbody = $('indTbody'); if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><i class="fas fa-id-card"></i>No inductions found</div>NonNullable<tr></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const stKey = r.status === 'Inducted' ? 'active' : r.status === 'Expired' ? 'inactive' : 'pending';
    return `<tr>
      <td><div class="user-cell">${avatarEl(r.user,26)}<span>${r.user.name}</span></div></td>
      <td>${r.company}</td>
      <td>${statusBadge(stKey)}</td>
      <td style="font-size:0.76rem;">${r.updated}</td>
    </tr>`;
  }).join('');
}
 
/* ── Training ──────────────────────────────────────────────── */
function filterAndUpdateTraining() {
  const trainings = [
    { userId:3, training:'Working at Height', completed:'2025-01-15', expiry:'2026-01-15', status:'valid' },
    { userId:4, training:'First Aid',         completed:'2024-06-01', expiry:'2025-06-01', status:'expired' },
    { userId:5, training:'Fire Safety',       completed:'2025-03-10', expiry:'2026-03-10', status:'valid' },
    { userId:6, training:'Scaffolding Safety',completed:'2025-02-20', expiry:'2026-02-20', status:'valid' },
  ];
  createPaginator('trainingTbody', trainings, renderTrainingBody, { perPage: 10 });
}
 
function renderTrainingBody(rows) {
  const tbody = $('trainingTbody'); if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-graduation-cap"></i>No training records found</div>NonNullable</tr></tr>';
    return;
  }
  tbody.innerHTML = rows.map(t => {
    const u = userById(t.userId);
    return `<tr>
      <td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name||'?'}</span></div></td>
      <td>${t.training}</td>
      <td style="font-size:0.75rem;">${fmt(t.completed)}</td>
      <td style="font-size:0.75rem;">${fmt(t.expiry)}</td>
      <td>${statusBadge(t.status === 'valid' ? 'active' : 'inactive')}</td>
      <td><button class="abt warn" onclick="toast('Edit training #${t.userId} (demo)','info')"><i class="fas fa-pen"></i></button></td>
    </tr>`;
  }).join('');
}
 
/* ── Daily Checklist ───────────────────────────────────────── */
function renderChecklist() {
  const el = $('checklistBody'); if (!el) return;
  const items = [
    'All workers have PPE','Emergency exits clear',
    'Scaffolding inspected','Tools accounted for',
    'First aid kit stocked','Hazard zones marked',
    'Morning briefing done',
  ];
  el.innerHTML = `<div style="display:grid;gap:0.75rem;">${
    items.map((c, i) => `
      <div class="sw-row">
        <div class="sw-info"><div class="sw-label">${c}</div></div>
        <label class="sw"><input type="checkbox" id="chk${i}"><span class="sw-sl"></span></label>
      </div>`).join('')
  }</div>
  <button class="btn btn-accent btn-sm" style="margin-top:1rem;" onclick="submitChecklist()">
    <i class="fas fa-save"></i> Submit Checklist
  </button>`;
}
 
function submitChecklist() {
  logAction('create', 'Checklist', 'Daily safety checklist submitted');
  toast('Checklist submitted', 'success');
}
 
/* ── Safety Scores ─────────────────────────────────────────── */
function renderSafetyScores() {
  const el = $('safetyScoreBody'); if (!el) return;
  if (!DB.sites.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-star"></i>No sites found</div>'; return; }
  el.innerHTML = DB.sites.map(s => {
    const inc   = (DB.incidents || []).filter(i => i.siteId === s.id);
    const score = Math.max(0, 100 - inc.filter(i=>i.status==='open').length * 15 - inc.filter(i=>i.severity==='critical').length * 25);
    const color = score >= 80 ? '#34d399' : score >= 60 ? '#eab308' : '#f87171';
    return `<div class="safety-score-card" style="display:flex;align-items:center;gap:1rem;padding:0.75rem 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;font-weight:500;font-size:0.85rem;">${s.name}</div>
      <div style="flex:2;display:flex;align-items:center;gap:0.75rem;">
        <div class="pb" style="flex:1;height:8px;"><div class="pb-fill" style="width:${score}%;background:${color};"></div></div>
        <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;color:${color};width:36px;text-align:right;">${score}</div>
      </div>
      <div style="font-size:0.72rem;color:var(--text3);width:100px;">${inc.length} incident${inc.length !== 1 ? 's' : ''}</div>
    </div>`;
  }).join('');
}
 
/* ── Export Reports ────────────────────────────────────────── */
function generateSafetyReport() {
  const type = $('safeRptType')?.value;
  const fmt_ = $('safeRptFmt')?.value  || 'csv';
  if (!type) { toast('Select a report type', 'warn'); return; }
 
  let data = [];
  if (type === 'incidents') {
    data = (DB.incidents || []).map(i => ({
      Date:        i.date,
      Site:        siteById(i.siteId)?.name || '—',
      Type:        i.type,
      Severity:    i.severity,
      Description: i.desc,
      Actions:     i.actions || '',
      Status:      i.status,
      Reporter:    userById(i.reporterId)?.name || 'System',
    }));
  } else if (type === 'inductions') {
    const statusMap = ['Inducted','Pending Review','In Progress','Not Started','Expired'];
    data = DB.users.filter(u => u.role !== 'admin').map((u, idx) => ({
      Name:   u.name,
      Email:  u.email,
      Status: statusMap[idx % statusMap.length],
      Date:   nowStr().slice(0,10),
    }));
  }
 
  if (!data.length) { toast('No data to export', 'warn'); return; }
 
  if (fmt_ === 'json') {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `safety-${type}.json`; a.click();
    URL.revokeObjectURL(a.href);
  } else {
    exportCSV(data, `safety-${type}.csv`);
  }
  toast(`Export generated (${fmt_.toUpperCase()})`, 'success');
}
/* ============================================================
   26. AUDIT LOG
   ============================================================ */
function renderAuditLog() {
  renderAuditHeatmap();
  filterAndUpdateAuditLog();
  $('auditExport')?.addEventListener('click', () => exportCSV(DB.auditLog, 'audit_log.csv'));
  ['auditSearch','auditUser','auditAction','auditFrom','auditTo'].forEach(id => $(id)?.addEventListener('input', filterAndUpdateAuditLog));
  const userSel = $('auditUser');
  if (userSel) userSel.innerHTML = '<option value="">All Users</option>' + DB.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
}

function filterAndUpdateAuditLog() {
  const q      = $('auditSearch')?.value.toLowerCase() || '';
  const uid    = +$('auditUser')?.value   || 0;
  const action = $('auditAction')?.value  || '';
  const from   = $('auditFrom')?.value    || '';
  const to     = $('auditTo')?.value      || '';
  const filtered = DB.auditLog.filter(l => {
    if (q      && !l.details.toLowerCase().includes(q) && !l.target.toLowerCase().includes(q)) return false;
    if (uid    && l.userId !== uid)    return false;
    if (action && l.action !== action) return false;
    if (from   && l.time.slice(0, 10) < from) return false;
    if (to     && l.time.slice(0, 10) > to)   return false;
    return true;
  }).sort((a, b) => new Date(b.time) - new Date(a.time));
  createPaginator('auditTbody', filtered, renderAuditTableBody, { perPage: 10 });
}

function renderAuditTableBody(logs) {
  if (!logs.length) { $('auditTbody').innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-scroll"></i>No log entries found</div></td></tr>'; return; }
  $('auditTbody').innerHTML = logs.map(l => {
    const u = userById(l.userId);
    const badgeClass = l.action === 'delete' ? 'inactive' : l.action === 'approve' ? 'active' : 'update';
    return `<tr>
      <td style="font-size:0.75rem;white-space:nowrap;">${l.time}</td>
      <td><div class="user-cell">${avatarEl(u, 24)}<span style="font-size:0.8rem;">${u?.name || 'System'}</span></div></td>
      <td>${roleBadge(u?.role || 'worker')}</td>
      <td><span class="badge b-${badgeClass}">${l.action}</span></td>
      <td style="font-size:0.8rem;">${l.target}</td>
      <td style="font-size:0.78rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.details}</td>
      <td><code style="font-size:0.7rem;">${l.ip}</code></td>
      <td>${statusBadge(l.status === 'success' ? 'active' : 'inactive')}</td>
    </tr>`;
  }).join('');
}

function renderAuditTable() { filterAndUpdateAuditLog(); }

function renderAuditHeatmap() {
  const el = $('auditHeatmap'); if (!el) return;
  const counts = {};
  DB.auditLog.forEach(l => { const d = l.time.slice(0, 10); counts[d] = (counts[d] || 0) + 1; });
  const today = new Date();
  let html = '<div class="heatmap-grid">';
  for (let i = 51; i >= 0; i--) {
    for (let j = 0; j < 7; j++) {
      const d = new Date(today); d.setDate(d.getDate() - (i * 7 + j));
      const key = d.toISOString().slice(0, 10);
      const n   = counts[key] || 0;
      const level = n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
      html += `<div class="hm-cell hm-l${level}" title="${key}: ${n} actions"></div>`;
    }
  }
  html += '</div><div style="font-size:0.72rem;color:var(--text3);margin-top:0.5rem;">Last 52 weeks — each cell = 1 day</div>';
  el.innerHTML = html;
}

/* ============================================================
   27. RBAC PERMISSIONS
   ============================================================ */
function renderRBAC() {
  wireRTabs(); renderRBACMatrix(); renderRolesTable(); renderOverridesTable();
  $('addRoleBtn')?.addEventListener('click', () => openRoleModal());
}

function wireRTabs() {
  const panels = { matrix: 'rt-matrix', roles: 'rt-roles', overrides: 'rt-overrides' };
  $$('[data-rtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-rtab]').forEach(b => b.classList.remove('active')); btn.classList.add('active');
      Object.values(panels).forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
      const target = $(panels[btn.dataset.rtab]); if (target) target.style.display = '';
    });
  });
}

function renderRBACMatrix() {
  const perms = ['users','sites','tasks','posts','leave','payroll','reports','settings','audit'];
  const roles = ['admin','manager','worker'];
  let html = `<table class="rbac-table"><thead><tr><th>Permission / Module</th>${roles.map(r => `<th>${r.charAt(0).toUpperCase() + r.slice(1)}</th>`).join('')}</tr></thead><tbody>`;
  perms.forEach(perm => {
    html += `<tr><td>${perm.charAt(0).toUpperCase() + perm.slice(1)}</td>`;
    roles.forEach(role => { html += `<td><input type="checkbox" class="perm-check" ${DB.rbacPerms[role]?.[perm] ? 'checked' : ''} data-role="${role}" data-perm="${perm}"></td>`; });
    html += '</tr>';
  });
  html += '</tbody></table>';
  $('rbacMatrix').innerHTML = html;
  $$('.perm-check').forEach(cb => cb.addEventListener('change', e => {
    DB.rbacPerms[e.target.dataset.role][e.target.dataset.perm] = e.target.checked;
    toast('Permission updated', 'success');
  }));
}

function renderRolesTable() {
  $('rolesTbody').innerHTML = DB.roles.map(r => `<tr>
    <td><span class="badge" style="background:${r.color}22;color:${r.color};">${r.name}</span></td>
    <td><div style="width:20px;height:20px;background:${r.color};border-radius:4px;"></div></td>
    <td>${DB.users.filter(u => u.role === r.id).length}</td>
    <td style="font-size:0.75rem;">${Array.isArray(r.perms) ? r.perms.join(', ') : 'Custom'}</td>
    <td>
      <button class="abt warn" onclick="openRoleModal('${r.id}')"><i class="fas fa-pen"></i></button>
      ${r.id === 'admin' || r.id === 'manager' || r.id === 'worker' ? '' : `<button class="abt dan" onclick="deleteRole('${r.id}')"><i class="fas fa-trash"></i></button>`}
    </td>
  </tr>`).join('');
}

function openRoleModal(roleId = null) {
  const r = roleId ? DB.roles.find(x => x.id === roleId) : null;
  $('roleModalTitle').textContent = r ? 'Edit Role' : 'Create Role';
  $('rm_name').value  = r?.name  || '';
  $('rm_color').value = r?.color || '#3b82f6';
  const perms = ['users.view','users.edit','sites.view','sites.manage','tasks.view','tasks.manage','posts.view','posts.create','leave.apply','leave.approve','payroll.view','payroll.manage','reports.view','settings.edit','audit.view'];
  $('rm_perms').innerHTML = perms.map(p => `<label style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;"><input type="checkbox" value="${p}" ${r && Array.isArray(r.perms) && r.perms.includes(p) ? 'checked' : ''}> ${p}</label>`).join('');
  $('rm_save').onclick = () => saveRole(roleId);
  openM('roleModal');
}

function saveRole(roleId) {
  const name  = $('rm_name').value.trim(); if (!name) { toast('Name required', 'error'); return; }
  const color = $('rm_color').value;
  const perms = [...$('rm_perms').querySelectorAll('input:checked')].map(i => i.value);
  if (roleId) { const r = DB.roles.find(x => x.id === roleId); Object.assign(r, { name, color, perms }); }
  else DB.roles.push({ id: name.toLowerCase().replace(/\s+/g, '_'), name, color, perms });
  closeM('roleModal'); renderRolesTable(); toast('Role saved', 'success');
}

function deleteRole(id) { if (!confirm('Delete role?')) return; DB.roles.splice(DB.roles.findIndex(r => r.id === id), 1); renderRolesTable(); toast('Role deleted', 'success'); }

function renderOverridesTable() {
  $('overrideTbody').innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="fas fa-user-shield"></i>No overrides configured</div></td></tr>';
}

/* ============================================================
   28. CLIENT PORTAL
   ============================================================ */
function renderClientPortal() {
  wireCPTabs();
  filterAndUpdateClients();
  filterAndUpdateTickets();
  populateCPSelects();
  $('addClientBtn')?.addEventListener('click', () => openClientModal());
  $('addTicketBtn')?.addEventListener('click', () => openTicketModal());
  $('cl_save')?.addEventListener('click', () => saveClient(null));
  $('tk_save')?.addEventListener('click', () => saveTicket(null));
  ['clientSearch'].forEach(id => $(id)?.addEventListener('input', filterAndUpdateClients));
  ['ticketStatus','ticketClient'].forEach(id => $(id)?.addEventListener('change', filterAndUpdateTickets));
}

function wireCPTabs() {
  const panels = { clients: 'cp-clients', tickets: 'cp-tickets' };
  $$('[data-cptab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-cptab]').forEach(b => b.classList.remove('active')); btn.classList.add('active');
      Object.values(panels).forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
      const target = $(panels[btn.dataset.cptab]); if (target) target.style.display = '';
      if (btn.dataset.cptab === 'clients') filterAndUpdateClients();
      if (btn.dataset.cptab === 'tickets') filterAndUpdateTickets();
    });
  });
}

function populateCPSelects() {
  const tkClient = $('tk_client'); if (tkClient) tkClient.innerHTML = DB.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const tkAss    = $('tk_assignee'); if (tkAss) tkAss.innerHTML = DB.users.filter(u => u.role !== 'worker').map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  const ticketClient = $('ticketClient'); if (ticketClient) ticketClient.innerHTML = '<option value="">All Clients</option>' + DB.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const cl_sites = $('cl_sitesCheck'); if (cl_sites) cl_sites.innerHTML = DB.sites.map(s => `<label style="display:flex;align-items:center;gap:0.35rem;font-size:0.82rem;"><input type="checkbox" value="${s.id}"> ${s.name}</label>`).join('');
}

function filterAndUpdateClients() {
  const q = $('clientSearch')?.value.toLowerCase() || '';
  const filtered = DB.clients.filter(c => !q || c.name.toLowerCase().includes(q) || c.contact.toLowerCase().includes(q));
  createPaginator('clientTbody', filtered, renderClientTableBody, { perPage: 10 });
}

function renderClientTableBody(clients) {
  if (!clients.length) { $('clientTbody').innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="fas fa-briefcase"></i>No clients found</div></td></tr>'; return; }
  $('clientTbody').innerHTML = clients.map(c => `<tr>
    <td style="font-weight:600;">${c.name}</td>
    <td>${c.contact}</td>
    <td>${c.email}</td>
    <td style="font-size:0.78rem;">${(c.siteIds || []).map(id => siteById(id)?.name).filter(Boolean).join(', ') || 'None'}</td>
    <td>${DB.tickets.filter(t => t.clientId === c.id).length}</td>
    <td>${statusBadge(c.status)}</td>
    <td>
      <button class="abt warn" onclick="openClientModal(${c.id})"><i class="fas fa-pen"></i></button>
      <button class="abt dan" onclick="deleteClient(${c.id})"><i class="fas fa-trash"></i></button>
    </td>
  </tr>`).join('');
}

function renderClientTable() { filterAndUpdateClients(); }

function openClientModal(clientId = null) {
  populateCPSelects();
  const c = clientId ? DB.clients.find(x => x.id === clientId) : null;
  $('clientTitle').textContent = c ? 'Edit Client' : 'Add Client';
  $('cl_name').value    = c?.name    || '';
  $('cl_contact').value = c?.contact || '';
  $('cl_email').value   = c?.email   || '';
  $('cl_phone').value   = c?.phone   || '';
  if (c) $('cl_sitesCheck').querySelectorAll('input').forEach(cb => { cb.checked = (c.siteIds || []).includes(+cb.value); });
  $('cl_save').onclick = () => saveClient(clientId);
  openM('clientModal');
}

function saveClient(clientId) {
  const data = { name: $('cl_name').value.trim(), contact: $('cl_contact').value.trim(), email: $('cl_email').value.trim(), phone: $('cl_phone')?.value.trim(), siteIds: [...$('cl_sitesCheck').querySelectorAll('input:checked')].map(i => +i.value), status: 'active' };
  if (!data.name) { toast('Name required', 'error'); return; }
  if (clientId) Object.assign(DB.clients.find(c => c.id === clientId), data);
  else DB.clients.push({ id: generateId('clients'), ...data });
  closeM('clientModal'); filterAndUpdateClients(); toast('Client saved', 'success');
}

function deleteClient(id) {
  if (!confirm('Delete client?')) return;
  DB.clients.splice(DB.clients.findIndex(c => c.id === id), 1);
  filterAndUpdateClients(); toast('Client deleted', 'success');
}

function filterAndUpdateTickets() {
  const st  = $('ticketStatus')?.value || '';
  const cid = +$('ticketClient')?.value || 0;
  const filtered = DB.tickets.filter(t => {
    if (st  && t.status   !== st)  return false;
    if (cid && t.clientId !== cid) return false;
    return true;
  }).sort((a, b) => new Date(b.created) - new Date(a.created));
  createPaginator('ticketTbody', filtered, renderTicketTableBody, { perPage: 10 });
}

function renderTicketTableBody(tickets) {
  if (!tickets.length) { $('ticketTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-ticket"></i>No tickets found</div></td></tr>'; return; }
  $('ticketTbody').innerHTML = tickets.map(t => {
    const c = DB.clients.find(x => x.id === t.clientId);
    const a = userById(t.assigneeId);
    const statusClass = t.status === 'open' ? 'active' : t.status === 'in-progress' ? 'in-progress' : 'completed';
    return `<tr>
      <td style="font-family:'Space Grotesk',sans-serif;font-weight:700;">#${String(t.id).padStart(4, '0')}</td>
      <td>${c?.name || '—'}</td>
      <td style="font-weight:500;">${t.subject}</td>
      <td>${priorityBadge(t.priority)}</td>
      <td><div class="user-cell">${avatarEl(a, 24)}<span style="font-size:0.78rem;">${a?.name || '—'}</span></div></td>
      <td style="font-size:0.75rem;">${fmt(t.created)}</td>
      <td style="font-size:0.75rem;">${fmt(t.updated)}</td>
      <td>${statusBadge(statusClass)}</td>
      <td>
        <button class="abt warn" onclick="openTicketModal(${t.id})"><i class="fas fa-pen"></i></button>
        <button class="abt dan" onclick="deleteTicket(${t.id})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function renderTicketTable() { filterAndUpdateTickets(); }

function openTicketModal(ticketId = null) {
  populateCPSelects();
  const t = ticketId ? DB.tickets.find(x => x.id === ticketId) : null;
  $('ticketTitle').textContent = t ? 'Edit Ticket' : 'New Ticket';
  $('tk_client').value   = t?.clientId   || DB.clients[0]?.id || '';
  $('tk_priority').value = t?.priority   || 'medium';
  $('tk_subject').value  = t?.subject    || '';
  $('tk_desc').value     = t?.desc       || '';
  $('tk_assignee').value = t?.assigneeId || '';
  $('tk_save').onclick = () => saveTicket(ticketId);
  openM('ticketModal');
}

function saveTicket(ticketId) {
  const data = { clientId: +$('tk_client').value, priority: $('tk_priority').value, subject: $('tk_subject').value.trim(), desc: $('tk_desc').value.trim(), assigneeId: +$('tk_assignee').value, status: 'open', created: nowStr().slice(0, 10), updated: nowStr().slice(0, 10) };
  if (!data.subject) { toast('Subject required', 'error'); return; }
  if (ticketId) { Object.assign(DB.tickets.find(t => t.id === ticketId), { ...data, updated: nowStr().slice(0, 10) }); sendEmail(DB.clients.find(c => c.id === data.clientId)?.email || '', 'Ticket Updated', 'ticket_update'); }
  else { DB.tickets.push({ id: generateId('tickets'), ...data }); logAction('create', `Ticket #${nextId.tickets - 1}`, 'Created for client'); }
  closeM('ticketModal'); filterAndUpdateTickets(); toast('Ticket saved', 'success');
}

function deleteTicket(id) {
  if (!confirm('Delete ticket?')) return;
  DB.tickets.splice(DB.tickets.findIndex(t => t.id === id), 1);
  filterAndUpdateTickets(); toast('Ticket deleted', 'success');
}

/* ============================================================
   29. REPORTS
   ============================================================ */
function renderReports() {
  $('rptGenerate')?.addEventListener('click', generateReport);
  $('rptExport')?.addEventListener('click', () => {
    const currentData = window.currentReportData;
    if (currentData?.length) { exportCSV(currentData, 'report.csv'); toast('Report exported to CSV', 'success'); }
    else toast('No data to export', 'warn');
  });
  $('rptPrint')?.addEventListener('click', () => window.print());
}

function generateReport() {
  const type = $('rptType')?.value;
  const output = $('rptOutput');
  const reports = {
    leave:     () => ({ data: DB.leaveRequests.map(l => ({ User: userById(l.userId)?.name, Type: l.type, From: l.from, To: l.to, Days: l.days, Status: l.status })), title: 'Leave Summary' }),
    documents: () => ({ data: DB.users.map(u => ({ User: u.name, Docs: DB.documents.filter(d => d.userId === u.id).length, Approved: DB.documents.filter(d => d.userId === u.id && d.status === 'approved').length, Pending: DB.documents.filter(d => d.userId === u.id && d.status === 'pending').length })), title: 'Document Completion' }),
    activity:  () => ({ data: DB.auditLog.map(l => ({ Time: l.time, User: userById(l.userId)?.name, Action: l.action, Target: l.target, Details: l.details })), title: 'User Activity' }),
    payroll:   () => ({ data: DB.payroll.map(p => ({ Employee: userById(p.userId)?.name, Base: fmtMoney(p.baseSalary), Overtime: fmtMoney(p.overtime), Bonus: fmtMoney(p.bonus), Deductions: fmtMoney(p.deductions), Net: fmtMoney(netPay(p)), Status: p.status })), title: 'Payroll Summary' }),
    tasks:     () => ({ data: DB.tasks.map(t => ({ Task: t.title, Project: projectById(t.projectId)?.name, Assignee: userById(t.assigneeId)?.name, Status: t.status, Priority: t.priority, DueDate: fmt(t.dueDate) })), title: 'Task Completion' }),
    safety:    () => ({ data: DB.incidents.map(i => ({ Date: i.date, Site: siteById(i.siteId)?.name, Severity: i.severity, Type: i.type, Status: i.status === 'open' ? 'Open' : 'Resolved', Description: i.desc })), title: 'Safety Incidents' }),
  };
  const report = reports[type]?.();
  if (report?.data.length) {
    window.currentReportData = report.data;
    displayReportWithPagination(report.data, report.title, output);
  } else {
    output.innerHTML = '<div class="empty-state"><i class="fas fa-chart-bar"></i>No data available for this report</div>';
    window.currentReportData = [];
  }
}

function displayReportWithPagination(data, title, container) {
  if (!data.length) { container.innerHTML = '<div class="empty-state">No data for this report</div>'; return; }
  const keys = Object.keys(data[0]);
  container.innerHTML = `
    <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;margin-bottom:1rem;">${title}</div>
    <div style="overflow-x:auto;">
      <table class="dt" id="reportTable">
        <thead><tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr></thead>
        <tbody id="reportTbody"></tbody>
      </table>
    </div>`;
  createPaginator('reportTbody', data, pageData => {
    const tbody = $('reportTbody'); if (!tbody) return;
    tbody.innerHTML = pageData.map(row => `<tr>${keys.map(k => `<td>${row[k] || '—'}</td>`).join('')}</tr>`).join('');
  }, { perPage: 10 });
}

/* ============================================================
   30. SETTINGS
   ============================================================ */
function renderSettings() {
  wireSettingsTabs();
  loadSettingsValues();
  wireSettingsEvents();
}

function wireSettingsTabs() {
  const panels = { general: 'set-general', security: 'set-security', appearance: 'set-appearance', emailjs: 'set-emailjs', company: 'set-company', 'leave-policy': 'set-leave-policy', data: 'set-data' };
  $$('[data-settab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-settab]').forEach(b => b.classList.remove('active')); btn.classList.add('active');
      Object.values(panels).forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
      const target = $(panels[btn.dataset.settab]); if (target) target.style.display = '';
    });
  });
}

function loadSettingsValues() {
  const s = DB.settings;
  const set = (id, val) => { const el = $(id); if (!el) return; if (el.type === 'checkbox') el.checked = val; else el.value = val; };
  set('sysName', s.systemName); set('sysTz', s.timezone); set('sysDateFmt', s.dateFormat); set('sysCurrency', s.currency || 'USD'); set('currencyPosition', s.currencyPosition || 'before');
  set('swEmail', s.emailNotif); set('swSms', s.smsAlerts); set('swPush', s.pushNotif); set('swMaintenance', s.maintenanceMode);
  set('workStart', s.workStart); set('workEnd', s.workEnd);
  set('sesTimeout', s.sessionTimeout); set('maxLogin', s.maxLoginAttempts); set('pwdLen', s.passwordMinLen);
  set('sw2fa', s.twoFactor); set('swIp', s.ipWhitelist); set('swAudit', s.auditLogging);
  set('swCompact', s.compactMode); set('swAnims', s.animations);
  set('ejsService', s.ejsService); set('ejsPublicKey', s.ejsPublicKey);
  set('ejsTplWelcome', s.ejsTplWelcome); set('ejsTplLeave', s.ejsTplLeave); set('ejsTplDoc', s.ejsTplDoc);
  set('ejsTplTask', s.ejsTplTask); set('ejsTplPayslip', s.ejsTplPayslip); set('ejsTplIncident', s.ejsTplIncident); set('ejsTplTicket', s.ejsTplTicket);
  set('coName', s.companyName); set('coAddr', s.companyAddress); set('coPhone', s.companyPhone); set('coEmail', s.companyEmail); set('coWeb', s.companyWeb);
  set('lpAnnual', s.lpAnnual); set('lpSick', s.lpSick); set('lpEmergency', s.lpEmergency); set('lpMaxConsec', s.lpMaxConsec); set('lpNotice', s.lpNotice);
  set('swCarry', s.carryForward); set('swApproval', s.requireApproval);
  applyCurrencyFormatting();
}

function wireSettingsEvents() {
  $('saveSettingsBtn')?.addEventListener('click', saveSettings);
  $('clearCacheBtn')?.addEventListener('click', () => { if (confirm('Clear cache?')) toast('Cache cleared', 'success'); });
  $('wipeDataBtn')?.addEventListener('click',   () => { if (confirm('WARNING: Delete ALL data?')) { if (confirm('Are you REALLY sure?')) toast('Data wipe cancelled (demo only)', 'warn'); } });
  $('exportAllBtn')?.addEventListener('click',   () => exportCSV(DB.users, 'all_users.csv'));
  $('ejsTestBtn')?.addEventListener('click',     () => { sendEmail('test@nixers.pro', 'Test Email from Nixers Pro', 'welcome_approved'); toast('Test email sent', 'success'); });
  $('logoDropZone')?.addEventListener('click',   () => $('logoInput')?.click());
  $('logoInput')?.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = ev => { $('logoPreview').src = ev.target.result; $('logoPreview').style.display = 'block'; }; r.readAsDataURL(f);
  });
  $$('#colorSwatches .color-sw').forEach(sw => {
    sw.addEventListener('click', () => { $$('#colorSwatches .color-sw').forEach(s => s.classList.remove('sel')); sw.classList.add('sel'); setAccentColor(sw.dataset.color); });
  });
  $('tplPreviewSelect')?.addEventListener('change', updateTplPreview);
  updateTplPreview();
  $('sysCurrency')?.addEventListener('change',     () => updateCurrencyPreview($('sysCurrency').value, $('currencyPosition').value));
  $('currencyPosition')?.addEventListener('change', () => updateCurrencyPreview($('sysCurrency').value, $('currencyPosition').value));
  $('changePasswordBtn')?.addEventListener('click',     changePassword);
  $('resetPasswordLinkBtn')?.addEventListener('click',  sendPasswordResetLink);
  $('newPassword')?.addEventListener('input',           checkPasswordStrength);
}

function saveSettings() {
  const s = DB.settings;
  const get = (id, def = '') => { const el = $(id); if (!el) return def; if (el.type === 'checkbox') return el.checked; return el.value; };
  s.systemName = get('sysName'); s.timezone = get('sysTz'); s.dateFormat = get('sysDateFmt'); s.currency = get('sysCurrency'); s.currencyPosition = get('currencyPosition');
  s.emailNotif = get('swEmail'); s.smsAlerts = get('swSms'); s.pushNotif = get('swPush'); s.maintenanceMode = get('swMaintenance');
  s.workStart = get('workStart'); s.workEnd = get('workEnd');
  s.sessionTimeout = +get('sesTimeout'); s.maxLoginAttempts = +get('maxLogin'); s.passwordMinLen = +get('pwdLen');
  s.twoFactor = get('sw2fa'); s.ipWhitelist = get('swIp'); s.auditLogging = get('swAudit');
  s.compactMode = get('swCompact'); s.animations = get('swAnims');
  s.ejsService = get('ejsService'); s.ejsPublicKey = get('ejsPublicKey');
  s.ejsTplWelcome = get('ejsTplWelcome'); s.ejsTplLeave = get('ejsTplLeave'); s.ejsTplDoc = get('ejsTplDoc');
  s.ejsTplTask = get('ejsTplTask'); s.ejsTplPayslip = get('ejsTplPayslip'); s.ejsTplIncident = get('ejsTplIncident'); s.ejsTplTicket = get('ejsTplTicket');
  s.companyName = get('coName'); s.companyAddress = get('coAddr'); s.companyPhone = get('coPhone'); s.companyEmail = get('coEmail'); s.companyWeb = get('coWeb');
  s.lpAnnual = +get('lpAnnual'); s.lpSick = +get('lpSick'); s.lpEmergency = +get('lpEmergency'); s.lpMaxConsec = +get('lpMaxConsec'); s.lpNotice = +get('lpNotice');
  s.carryForward = get('swCarry'); s.requireApproval = get('swApproval');
  document.body.classList.toggle('compact', s.compactMode);
  applyCurrencyFormatting();
  logAction('update', 'Settings', 'System settings updated');
  toast('Settings saved', 'success');
}

function updateCurrencyPreview(currency, position) {
  const symbols = { USD: '$', EUR: '€', GBP: '£', BDT: '৳', AED: 'د.إ', SAR: 'ر.س', INR: '₹', CAD: 'C$', AUD: 'A$', JPY: '¥', CNY: '¥', SGD: 'S$', MYR: 'RM' };
  const symbol = symbols[currency] || '$';
  const amount = 1234.56;
  const fmt    = amount.toLocaleString();
  const map    = { before: `${symbol}${fmt}`, after: `${fmt}${symbol}`, space_before: `${symbol} ${fmt}`, space_after: `${fmt} ${symbol}` };
  const formatted = map[position] || `${symbol}${fmt}`;
  let previewEl = $('currencyPreview');
  if (!previewEl) {
    const currencyRow = document.querySelector('#sysCurrency')?.closest('.fg');
    if (currencyRow) {
      previewEl = document.createElement('div');
      previewEl.id = 'currencyPreview';
      previewEl.className = 'fg';
      previewEl.style.marginTop = '0.5rem';
      currencyRow.after(previewEl);
    }
  }
  if (previewEl) previewEl.innerHTML = `<span style="color:var(--accent);font-size:0.8rem;">Preview: ${formatted}</span>`;
}

function applyCurrencyFormatting() {
  const s = DB.settings;
  const symbols = { USD: '$', EUR: '€', GBP: '£', BDT: '৳', AED: 'د.إ', SAR: 'ر.س', INR: '₹', CAD: 'C$', AUD: 'A$', JPY: '¥', CNY: '¥', SGD: 'S$', MYR: 'RM' };
  window.currencySymbol   = symbols[s.currency || 'USD'] || '$';
  window.currencyPosition = s.currencyPosition || 'before';
}

function fmtMoneyWithSettings(amount) {
  if (amount === undefined || amount === null) return '—';
  const num = Number(amount); if (isNaN(num)) return '—';
  const symbol = window.currencySymbol   || '$';
  const position = window.currencyPosition || 'before';
  const fa = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const map = { before: `${symbol}${fa}`, after: `${fa}${symbol}`, space_before: `${symbol} ${fa}`, space_after: `${fa} ${symbol}` };
  return map[position] || `${symbol}${fa}`;
}
// Override global fmtMoney with currency-aware version
window.fmtMoney = fmtMoneyWithSettings;

function setAccentColor(color) { document.documentElement.style.setProperty('--accent', color); DB.settings.accentColor = color; toast('Accent color updated', 'success'); }

function updateTplPreview() {
  const type = $('tplPreviewSelect')?.value || 'welcome';
  const previews = {
    welcome: `<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Welcome to Nixers Pro<br><br>Dear <strong>{name}</strong>,<br><br>Your account has been approved. You can now log in to Nixers Pro.<br><br>Best regards,<br>Nixers Admin Team</div>`,
    leave:   `<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Leave Request Update<br><br>Dear <strong>{name}</strong>,<br><br>Your leave request for <strong>{type}</strong> leave from {from} to {to} has been <strong>{status}</strong>.<br><br>{comment}<br><br>Regards,<br>HR Team</div>`,
    task:    `<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> New Task Assigned<br><br>Hi <strong>{name}</strong>,<br><br>You have been assigned a new task: <strong>{task_title}</strong><br>Project: {project}<br>Due: {due_date}<br><br>Please log in to view details.<br><br>Thanks,<br>Nixers Team</div>`,
    payslip: `<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Your Payslip is Ready<br><br>Dear <strong>{name}</strong>,<br><br>Your payslip for <strong>{period}</strong> is ready.<br>Net Pay: <strong>{net_pay}</strong><br><br>Please log in to download.<br><br>Payroll Team</div>`,
  };
  if ($('tplPreviewBox')) $('tplPreviewBox').innerHTML = previews[type] || 'Select a template';
}

function changePassword() {
  const current  = $('currentPassword')?.value;
  const newPwd   = $('newPassword')?.value;
  const confirm  = $('confirmPassword')?.value;
  if (!current) { toast('Please enter current password', 'error'); return; }
  if (!newPwd)  { toast('Please enter new password', 'error'); return; }
  const minLength = DB.settings.passwordMinLen || 8;
  if (newPwd.length < minLength) { toast(`Password must be at least ${minLength} characters`, 'error'); return; }
  if (newPwd !== confirm) { toast('New passwords do not match', 'error'); return; }
  const storedPassword = DB.settings.userPassword || 'admin123';
  if (current !== storedPassword) { toast('Current password is incorrect', 'error'); return; }
  DB.settings.userPassword = newPwd;
  logAction('update', 'Password', `${currentUser?.name || 'User'} changed their password`);
  $('currentPassword').value = ''; $('newPassword').value = ''; $('confirmPassword').value = '';
  if ($('passwordStrength')) $('passwordStrength').innerHTML = '';
  toast('Password changed successfully', 'success');
}

function sendPasswordResetLink() {
  const userEmail = currentUser?.email || DB.settings.companyEmail;
  if (!userEmail) { toast('No email address found', 'error'); return; }
  const resetToken = generateResetToken();
  if (!DB.passwordResetTokens) DB.passwordResetTokens = {};
  DB.passwordResetTokens[resetToken] = { email: userEmail, expires: Date.now() + 3600000 };
  sendEmail(userEmail, 'Password Reset Request', 'password_reset');
  toast(`Password reset link sent to ${userEmail}`, 'success');
  logAction('request', 'Password Reset', `Reset link sent to ${userEmail}`);
}

function checkPasswordStrength() {
  const password  = $('newPassword')?.value || '';
  const strengthEl = $('passwordStrength');
  if (!strengthEl) return;
  if (!password.length) { strengthEl.innerHTML = ''; return; }
  let strength = 0;
  if (password.length >= 8)          strength++;
  if (password.length >= 12)         strength++;
  if (/\d/.test(password))           strength++;
  if (/[A-Z]/.test(password))        strength++;
  if (/[a-z]/.test(password))        strength++;
  if (/[^A-Za-z0-9]/.test(password)) strength++;
  const message = strength <= 2 ? 'Weak password' : strength <= 4 ? 'Medium password' : 'Strong password';
  const color   = strength <= 2 ? '#f87171' : strength <= 4 ? '#f97316' : '#34d399';
  strengthEl.innerHTML = `<div style="display:flex;align-items:center;gap:0.5rem;"><div style="flex:1;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;"><div style="width:${(strength / 6) * 100}%;height:100%;background:${color};border-radius:2px;"></div></div><span style="color:${color};">${message}</span></div>`;
}

/* ============================================================
   31. ADMIN INIT  (after dashboard.js initDashboard has run)
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // dashboard.js initDashboard() runs first via its own DOMContentLoaded listener.
  // Admin-specific boot:
  logAction('login', 'system', `${currentUser.name} logged in`);
  showPage('dashboard');
  console.log('%c NIXERS PRO ADMIN %c v2.0 ', 'background:#eab308;color:#0a0f1a;font-weight:800;padding:4px 8px;border-radius:4px 0 0 4px;', 'background:#111827;color:#eab308;font-weight:600;padding:4px 8px;border-radius:0 4px 4px 0;');
});
