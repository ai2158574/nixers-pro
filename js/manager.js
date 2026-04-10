/* ============================================================
   NIXERS PRO — manager.js  (clean version)
   Manager-specific page logic.
   Depends on: dashboard.js  (must be loaded first)
   dashboard.js owns: $, $$, toast, openM, closeM, createPaginator,
   avatarEl, roleBadge, statusBadge, severityBadge, priorityBadge,
   onlineDot, fmt, fmtMoney, initials, nowStr, exportCSV,
   statCard, sendEmail, updateTopbarAvatar, syncNotifBadge,
   initDashboard (runs automatically on DOMContentLoaded)
   ============================================================ */

'use strict';

/* ============================================================
   1. VERIFY SHARED DATA STORE
   ============================================================ */
const DB = window.APP_DATA?.DB;
if (!DB) {
  throw new Error('Missing shared data store. Load js/data.js before js/manager.js');
}

/* ============================================================
   2. ID COUNTERS
   ============================================================ */
const nextId = {};
['users','sites','categories','posts','groups','leaveRequests','holidays','timesheets',
 'payroll','projects','tasks','equipment','incidents','documents','notifications',
 'emailLog','auditLog','clients','tickets'].forEach(k => {
  nextId[k] = (DB[k]?.length || 0) + 1;
});

/* ============================================================
   3. MANAGER STATE
   ============================================================ */
let currentUser        = DB.users.find(u => u.role === 'manager') || DB.users[0];
window.currentUser     = currentUser;   // expose to dashboard.js

let currentGroup       = null;
let currentSite        = null;
let selectedUserIds    = new Set();
let postAssignees      = [];
let postVoiceRecording = false;
let projectTeamMembers = [];
let taskAssignees      = [];
let taskVoiceRecording = false;
let taskAttachments    = [];
let siteWorkers        = [];
let leaveCalDate       = new Date();
let shiftWeekOffset    = 0;
let currentPayrollPeriod = '2025-06';

/* ============================================================
   4. MANAGER UTILITIES
   ============================================================ */
function userById(id)    { return DB.users.find(u => u.id === id); }
function siteById(id)    { return DB.sites.find(s => s.id === id); }
function catById(id)     { return DB.categories.find(c => c.id === id); }
function projectById(id) { return DB.projects.find(p => p.id === id); }

function taskAssigneeIds(task) {
  if (!task) return [];
  if (Array.isArray(task.assigneeIds) && task.assigneeIds.length)
    return task.assigneeIds.map(Number).filter(Boolean);
  return task.assigneeId ? [Number(task.assigneeId)] : [];
}

function generateId(key) { return nextId[key]++; }

function logAction(action, target, details) {
  DB.auditLog.unshift({
    id: generateId('auditLog'), time: nowStr(),
    userId: currentUser.id, action, target, details,
    ip: '127.0.0.1', status: 'success'
  });
}

/* ── Manager team helpers ─────────────────────────────────── */
function getManagerTeamIds() {
  const managedSites = DB.sites.filter(s => s.managerId === currentUser.id);
  const ids = new Set([currentUser.id]);
  managedSites.forEach(s => (s.workerIds || []).forEach(id => ids.add(id)));
  return ids;
}

function getManagedSiteIds() {
  return new Set(DB.sites.filter(s => s.managerId === currentUser.id).map(s => s.id));
}

function canViewSafetyItem(item) {
  const team = getManagerTeamIds();
  const mSites = getManagedSiteIds();
  return item.reporterId === currentUser.id
    || (item.siteId && mSites.has(item.siteId))
    || team.has(item.reporterId);
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
  const team    = getManagerTeamIds();
  const mSites  = getManagedSiteIds();

  const myUsers    = DB.users.filter(u => team.has(u.id));
  const myTasks    = DB.tasks.filter(t => taskAssigneeIds(t).some(id => team.has(id)));
  const mySites    = DB.sites.filter(s => mSites.has(s.id));
  const myIncidents= (DB.incidents||[]).filter(i => canViewSafetyItem(i));
  const myDocs     = DB.documents.filter(d => team.has(d.userId));
  const myLeave    = DB.leaveRequests.filter(l => team.has(l.userId));
  const myPayroll  = DB.payroll.filter(p => team.has(p.userId));

  /* Pending bar */
  const pendingLeave = myLeave.filter(l => l.status === 'pending').length;
  const pendingDocs  = myDocs.filter(d => d.status === 'pending').length;
  const totalPending = pendingLeave + pendingDocs;
  const bar = $('pendingBar');
  if (bar) {
    if (totalPending > 0) {
      bar.style.display = 'flex';
      const txt = $('pendingBarText');
      if (txt) txt.textContent = `${totalPending} pending: ${pendingLeave} leave requests, ${pendingDocs} documents`;
      const acts = $('pendingBarActions');
      if (acts) acts.innerHTML = `
        <button class="btn btn-accent btn-sm" onclick="showPage('leave')">Leave</button>
        <button class="btn btn-outline btn-sm" onclick="showPage('documents')">Docs</button>`;
    } else { bar.style.display = 'none'; }
  }

  /* Stats */
  const activeUsers  = myUsers.filter(u => u.status === 'active').length;
  const activeSites  = mySites.filter(s => s.status === 'active').length;
  const openIncidents= myIncidents.filter(i => i.status === 'open').length;
  const doneTasks    = myTasks.filter(t => t.status === 'done').length;
  const totalNet     = myPayroll.reduce((s, p) => s + netPay(p), 0);

  const sg = $('statsGrid');
  if (sg) sg.innerHTML =
    statCard('fa-users',               'blue',   activeUsers,                     'Team Members',   '', 'flat') +
    statCard('fa-building',            'yellow', activeSites,                     'My Sites',       '', 'flat') +
    statCard('fa-list-check',          'green',  doneTasks+'/'+myTasks.length,    'Tasks Complete', '', 'flat') +
    statCard('fa-money-bill-wave',     'purple', fmtMoney(totalNet),              'Team Payroll',   '', 'flat') +
    statCard('fa-triangle-exclamation','red',    openIncidents,                   'Open Incidents', openIncidents>0?'Action needed':'All clear', openIncidents>0?'down':'up') +
    statCard('fa-folder-open',         'orange', pendingDocs,                     'Docs Pending',   '', 'flat');

  syncNotifBadge();

  setTimeout(() => {
    renderMainChart(myTasks);
    renderRoleChart(myUsers);
    renderTaskChart(myTasks);
    renderActivityFeed(team);
    renderSysHealth();
    renderDashAudit(team);
  }, 50);
}

function netPay(p) {
  return (p.baseSalary||0) + (p.overtime||0) + (p.bonus||0) + (p.allowances||0) - (p.deductions||0);
}

function renderMainChart(tasks) {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const comp = new Array(7).fill(0);
  const prog = new Array(7).fill(0);
  tasks.forEach(t => {
    if (t.status === 'done')       comp[Math.floor(Math.random()*7)]++;
    if (t.status === 'inprogress') prog[Math.floor(Math.random()*7)]++;
  });
  makeChart('mainChart', {
    type: 'bar',
    data: {
      labels: days,
      datasets: [
        { label:'Completed',   data: comp, backgroundColor:'rgba(234,179,8,0.8)',  borderRadius:6 },
        { label:'In Progress', data: prog, backgroundColor:'rgba(59,130,246,0.6)', borderRadius:6 },
      ]
    },
    options: { ...chartDefaults() }
  });
}

function renderRoleChart(users) {
  const counts = ['admin','manager','worker'].map(r => users.filter(u => u.role===r).length);
  makeChart('roleChart', {
    type: 'doughnut',
    data: {
      labels: ['Admin','Manager','Worker'],
      datasets: [{ data: counts, backgroundColor:['rgba(139,92,246,0.8)','rgba(234,179,8,0.8)','rgba(59,130,246,0.8)'], borderWidth:0 }]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:chartTextColor(), font:{ family:'DM Sans', size:11 } } } }, cutout:'65%' }
  });
}

function renderTaskChart(tasks) {
  const cols   = ['todo','inprogress','review','done'];
  const labels = ['To Do','In Progress','Review','Done'];
  const counts = cols.map(c => tasks.filter(t => t.status===c).length);
  makeChart('taskChart', {
    type: 'bar',
    data: { labels, datasets:[{ label:'Tasks', data:counts, backgroundColor:['rgba(100,116,139,0.7)','rgba(234,179,8,0.7)','rgba(59,130,246,0.7)','rgba(16,185,129,0.7)'], borderRadius:6 }] },
    options: { ...chartDefaults(), indexAxis:'y', plugins:{ legend:{ display:false } } }
  });
}

function renderActivityFeed(team) {
  const feed = $('actFeed'); if (!feed) return;
  const icons = { login:'fa-sign-in-alt', logout:'fa-sign-out-alt', create:'fa-plus', update:'fa-pen', delete:'fa-trash', approve:'fa-check', reject:'fa-times', impersonate:'fa-user-secret' };
  const logs  = DB.auditLog.filter(l => !team || team.has(l.userId)).slice(0,8);
  feed.innerHTML = logs.map(l => {
    const u = userById(l.userId);
    return `<div style="display:flex;gap:0.6rem;align-items:flex-start;padding:0.4rem 0;border-bottom:1px solid var(--border);">
      <div style="width:28px;height:28px;border-radius:7px;background:var(--accent-glow);display:flex;align-items:center;justify-content:center;font-size:0.72rem;flex-shrink:0;color:var(--accent);">
        <i class="fas ${icons[l.action]||'fa-circle'}"></i></div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.78rem;font-weight:500;">${u?.name||'System'} <span style="color:var(--text3);">${l.action}</span> ${l.target}</div>
        <div style="font-size:0.68rem;color:var(--text3);">${l.time}</div>
      </div></div>`;
  }).join('') || '<div class="empty-state"><i class="fas fa-rss"></i>No recent activity</div>';
}

function renderSysHealth() {
  const el = $('sysHealthGrid'); if (!el) return;
  el.innerHTML = `
    <div class="sys-health-item"><div class="sh-label">Storage</div><div class="sh-val" style="color:var(--accent);">2.4 / 10 MB</div><div class="pb sh-bar" style="height:5px;"><div class="pb-fill" style="width:24%;"></div></div></div>
    <div class="sys-health-item"><div class="sh-label">Active Users</div><div class="sh-val">${DB.users.filter(u=>u.online==='online').length} online</div></div>
    <div class="sys-health-item"><div class="sh-label">Pending Notifications</div><div class="sh-val">${DB.notifications.filter(n=>!n.read).length} unread</div></div>
    <div class="sys-health-item"><div class="sh-label">Last Backup</div><div class="sh-val" style="color:#34d399;">Today 03:00</div></div>`;
}

function renderDashAudit(team) {
  const el = $('dashAuditBody'); if (!el) return;
  const logs = DB.auditLog.filter(l => !team || team.has(l.userId)).slice(0,5);
  el.innerHTML = logs.map(l => {
    const u = userById(l.userId);
    return `<tr><td>${l.time}</td><td>${avatarEl(u,24)} ${u?.name||'?'}</td><td>${l.action}</td><td>${l.target}</td><td><code style="font-size:0.72rem;">${l.ip}</code></td></tr>`;
  }).join('');
}

/* ============================================================
   7. USERS PAGE  (manager sees only their team)
   ============================================================ */
function renderUsers() {
  populateUserFilterSelects();
  wireUserFilters();
  wireUserBulk();
  $('addUserBtn')?.addEventListener('click', () => openUserModal());
  $('csvImportBtn')?.addEventListener('click', () => $('csvImportFile').click());
  $('csvImportFile')?.addEventListener('change', handleCSVImport);
  $('resetF')?.addEventListener('click', () => {
    ['fName','fEmail','fPhone','fRole','fStatus'].forEach(id => { const el=$(id); if(el) el.value=''; });
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
  const team = getManagerTeamIds();
  const teamUsers = DB.users.filter(u => team.has(u.id));
  const tsUser = $('tsUser');
  if (tsUser) tsUser.innerHTML = '<option value="">All Employees</option>' + teamUsers.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  const docUser = $('docUser');
  if (docUser) docUser.innerHTML = '<option value="">All Employees</option>' + teamUsers.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
}

function wireUserFilters() {
  ['fName','fEmail','fPhone','fRole','fStatus'].forEach(id => $(id)?.addEventListener('input', () => filterAndUpdateUsers()));
}

function wireUserBulk() {
  $('selectAll')?.addEventListener('change', e => {
    const visible = window.paginators?.['uTbody']?.getCurrentPageData() || [];
    $$('.row-check').forEach(cb => cb.checked = e.target.checked);
    if (e.target.checked) visible.forEach(u => selectedUserIds.add(u.id));
    else visible.forEach(u => selectedUserIds.delete(u.id));
    updateBulkBar();
  });
  $('bulkActivate')?.addEventListener('click', () => {
    selectedUserIds.forEach(id => { const u=userById(id); if(u) u.status='active'; });
    selectedUserIds.clear(); filterAndUpdateUsers(); updateBulkBar(); toast('Users activated','success');
  });
  $('bulkDeactivate')?.addEventListener('click', () => {
    selectedUserIds.forEach(id => { const u=userById(id); if(u) u.status='inactive'; });
    selectedUserIds.clear(); filterAndUpdateUsers(); updateBulkBar(); toast('Users deactivated','warn');
  });
  $('bulkClear')?.addEventListener('click', () => {
    selectedUserIds.clear();
    $$('.row-check').forEach(cb => cb.checked=false);
    if($('selectAll')) $('selectAll').checked=false;
    updateBulkBar();
  });
  /* bulkDelete disabled for managers */
  const bd = $('bulkDelete'); if (bd) bd.style.display = 'none';
}

function updateBulkBar() {
  const bar = $('bulkBar'); if (!bar) return;
  bar.style.display = selectedUserIds.size > 0 ? 'flex' : 'none';
  if($('bulkCount')) $('bulkCount').textContent = `${selectedUserIds.size} selected`;
}

function filterAndUpdateUsers(tab='all') {
  const team   = getManagerTeamIds();
  const name   = $('fName')?.value.toLowerCase()  || '';
  const email  = $('fEmail')?.value.toLowerCase() || '';
  const phone  = $('fPhone')?.value.toLowerCase() || '';
  const role   = $('fRole')?.value  || '';
  const status = $('fStatus')?.value || '';

  let filtered = DB.users.filter(u => {
    if (!team.has(u.id)) return false;
    if (tab==='pending' && u.status!=='pending') return false;
    if (name  && !u.name.toLowerCase().includes(name))   return false;
    if (email && !u.email.toLowerCase().includes(email)) return false;
    if (phone && !u.phone.toLowerCase().includes(phone)) return false;
    if (role  && u.role!==role)   return false;
    if (status && u.status!==status) return false;
    return true;
  });

  if($('uCount')) $('uCount').textContent = `${filtered.length} user${filtered.length!==1?'s':''}`;
  const pendingN = DB.users.filter(u => team.has(u.id) && u.status==='pending').length;
  const pc = $('pendingCount');
  if(pc){ pc.textContent=pendingN; pc.style.display=pendingN>0?'':'none'; }

  createPaginator('uTbody', filtered, data => renderUserTableBody(data, tab), { perPage:10 });
}

function renderUserTableBody(users, tab) {
  const tbody = $('uTbody'); if (!tbody) return;
  tbody.innerHTML = users.length ? users.map(u => {
    const gi = DB.users.findIndex(x=>x.id===u.id)+1;
    return `<tr>
      <td><input type="checkbox" class="row-check" data-uid="${u.id}" ${selectedUserIds.has(u.id)?'checked':''}></td>
      <td style="color:var(--text3);font-size:0.75rem;">${gi}</td>
      <td><div class="user-cell">${avatarEl(u)} <div><div style="font-weight:600;">${u.name}</div><div style="font-size:0.72rem;color:var(--text3);">${u.empId}</div></div></div></td>
      <td>${u.email}</td><td>${u.phone}</td>
      <td>${roleBadge(u.role)}</td><td>${u.dept||'—'}</td>
      <td>${statusBadge(u.status)}</td><td>${onlineDot(u)}</td>
      <td style="font-size:0.75rem;">${fmt(u.registered)}</td>
      <td style="font-size:0.75rem;">${u.lastLogin}</td>
      <td>
        <div style="display:flex;gap:0.2rem;flex-wrap:wrap;">
          <button class="abt inf" title="View Profile" onclick="openProfileModal(${u.id})"><i class="fas fa-eye"></i></button>
          <button class="abt warn" title="Edit" onclick="openUserModal(${u.id})"><i class="fas fa-pen"></i></button>
          ${u.status==='pending'?`<button class="abt suc" title="Approve" onclick="openApprovalModal(${u.id})"><i class="fas fa-check"></i></button>`:''}
        </div>
      </td></tr>`;
  }).join('') : '<tr><td colspan="12"><div class="empty-state"><i class="fas fa-users"></i>No team members found</div></td></tr>';

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
}

function openUserModal(userId=null) { openProfileModal(userId); }

function handleCSVImport(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const lines = ev.target.result.split('\n').filter(Boolean);
    const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
    let added = 0;
    lines.slice(1).forEach(line => {
      const vals = line.split(',').map(v=>v.trim().replace(/^"|"$/g,''));
      const obj = {}; headers.forEach((h,i) => obj[h]=vals[i]);
      if (obj.name && obj.email) {
        DB.users.push({ id:generateId('users'), name:obj.name, email:obj.email, phone:obj.phone||'', role:'worker', dept:obj.dept||'', status:'pending', empId:`EMP-${String(nextId.users).padStart(4,'0')}`, idNum:'', natId:'', dob:'', hired:nowStr().slice(0,10), salary:0, addr:'', emerg:'', bio:'', avatarColor:'#eab308', avatarImg:'', lastLogin:'Never', registered:nowStr().slice(0,10), online:'offline' });
        added++;
      }
    });
    filterAndUpdateUsers(); toast(`Imported ${added} users`,'success'); e.target.value='';
  };
  reader.readAsText(file);
}

function deleteUser(id) { toast('Managers cannot delete users','warn'); }

/* ============================================================
   8. PROFILE MODAL
   ============================================================ */
function openProfileModal(userId=null, tab='pmEdit') {
  currentSite = null;
  /* Restrict to own team */
  if (userId) {
    const team = getManagerTeamIds();
    if (!team.has(userId)) { toast('You can only view your own profile or team members','warn'); return; }
  }
  const user = userId ? userById(userId) : {
    id:null, name:'', email:'', phone:'', role:'worker', dept:'', status:'active',
    empId:'', idNum:'', natId:'', dob:'', hired:'', salary:0, addr:'', emerg:'',
    bio:'', avatarColor:'#eab308', avatarImg:'', registered:'', lastLogin:'', online:'offline'
  };

  if($('pmTitle'))  $('pmTitle').textContent  = userId ? 'Edit Profile' : 'Add User';
  if($('pmName2'))  $('pmName2').textContent  = user.name || 'New User';
  if($('pmRole2'))  $('pmRole2').textContent  = user.role || '';
  if($('pmFName'))  $('pmFName').value  = user.name;
  if($('pmEmail'))  $('pmEmail').value  = user.email;
  if($('pmPhone'))  $('pmPhone').value  = user.phone;
  if($('pmRole'))   $('pmRole').value   = user.role;
  if($('pmStatus')) $('pmStatus').value = user.status;
  if($('pmDept'))   $('pmDept').value   = user.dept;
  if($('pmEmpId'))  $('pmEmpId').value  = user.empId;
  if($('pmIdNum'))  $('pmIdNum').value  = user.idNum;
  if($('pmNatId'))  $('pmNatId').value  = user.natId;
  if($('pmDob'))    $('pmDob').value    = user.dob;
  if($('pmHired'))  $('pmHired').value  = user.hired;
  if($('pmSalary')) $('pmSalary').value = user.salary;
  if($('pmAddr'))   $('pmAddr').value   = user.addr;
  if($('pmEmerg'))  $('pmEmerg').value  = user.emerg;
  if($('pmBio'))    $('pmBio').value    = user.bio;
  if($('pmNewPassword'))     $('pmNewPassword').value = '';
  if($('pmConfirmPassword')) $('pmConfirmPassword').value = '';
  if($('pmPasswordStrength')) $('pmPasswordStrength').innerHTML = '';

  const avInit = $('pmAvInit'), avImg = $('pmAvImg');
  if (avInit) { avInit.textContent = initials(user.name)||'?'; avInit.style.color = user.avatarColor||'#eab308'; }
  if (avImg) {
    if (user.avatarImg) { avImg.src=user.avatarImg; avImg.style.display='block'; if(avInit) avInit.style.display='none'; }
    else { avImg.style.display='none'; if(avInit) avInit.style.display=''; }
  }

  /* Manager role field locked to worker for editing others */
  const pmRole = $('pmRole');
  if (pmRole && userId && userId !== currentUser.id) {
    pmRole.innerHTML = '<option value="worker">Worker</option>';
    pmRole.disabled  = true;
  } else if (pmRole) {
    pmRole.innerHTML = '<option value="admin">Admin</option><option value="manager">Manager</option><option value="worker">Worker</option>';
    pmRole.disabled  = false;
    pmRole.value     = user.role;
  }

  const colors = ['#eab308','#3b82f6','#10b981','#8b5cf6','#f43f5e','#f97316','#06b6d4','#84cc16'];
  if($('avColorOpts')) $('avColorOpts').innerHTML = colors.map(c =>
    `<div class="av-color-opt${user.avatarColor===c?' sel':''}" style="background:${c}22;color:${c};border-color:${user.avatarColor===c?c:'transparent'};" data-color="${c}" onclick="pickAvatarColor(this,'${c}')">${initials(user.name)||'?'}</div>`
  ).join('');

  switchPMTab(tab);
  if (userId) renderPMPerf(user);
  renderPMDocs(userId);
  renderPMHist(userId);
  renderIdCard(user);

  const saveBtn = $('pmSaveBtn');
  if (saveBtn) saveBtn.onclick = () => savePMUser(userId);
  $('avUploadDrop')?.addEventListener('click', () => $('avatarFileInput').click());
  if($('avatarFileInput')) $('avatarFileInput').onchange = e => handleAvatarUpload(e, userId);
  if($('pmNewPassword'))     $('pmNewPassword').addEventListener('input', checkPMPasswordStrength);
  if($('pmSendResetLink'))   $('pmSendResetLink').onclick = () => sendPasswordResetLinkToUser(userId||currentUser.id);

  openM('profileModal');
}

function switchPMTab(tabId) {
  ['pmEdit','pmPerf','pmDocs','pmHist','pmIdCard'].forEach(id => {
    const el=$(id); if(el) el.style.display = id===tabId?'':'none';
  });
  $$('.pm-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pmtab===tabId);
    btn.onclick = () => switchPMTab(btn.dataset.pmtab);
  });
}

function pickAvatarColor(el, color) {
  $$('#avColorOpts .av-color-opt').forEach(o => { o.classList.remove('sel'); o.style.borderColor='transparent'; });
  el.classList.add('sel'); el.style.borderColor=color;
}

function handleAvatarUpload(e, userId) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const src = ev.target.result;
    const avImg=$('pmAvImg'), avInit=$('pmAvInit');
    if(avImg){ avImg.src=src; avImg.style.display='block'; }
    if(avInit) avInit.style.display='none';
    if (userId) { const u=userById(userId); if(u) u.avatarImg=src; }
    updateTopbarAvatar();
  };
  reader.readAsDataURL(file);
}

function checkPMPasswordStrength() {
  const pw = $('pmNewPassword')?.value||'';
  const el = $('pmPasswordStrength'); if (!el) return;
  if (!pw.length) { el.innerHTML=''; return; }
  let s=0;
  if(pw.length>=8) s++; if(pw.length>=12) s++;
  if(/\d/.test(pw)) s++; if(/[A-Z]/.test(pw)) s++; if(/[a-z]/.test(pw)) s++;
  if(/[^A-Za-z0-9]/.test(pw)) s++;
  const msg   = s<=2?'Weak':s<=4?'Medium':'Strong';
  const color = s<=2?'#f87171':s<=4?'#f97316':'#34d399';
  el.innerHTML=`<div style="display:flex;align-items:center;gap:0.5rem;"><div style="flex:1;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;"><div style="width:${(s/6)*100}%;height:100%;background:${color};border-radius:2px;"></div></div><span style="color:${color};">${msg} password</span></div>`;
}

function sendPasswordResetLinkToUser(userId) {
  const u = userById(userId);
  if (!u?.email) { toast('No email address found','error'); return; }
  sendEmail(u.email,'Password Reset Request','password_reset');
  toast(`Password reset link sent to ${u.email}`,'success');
  logAction('request','Password Reset',`Reset link sent to ${u.name}`);
}

function savePMUser(userId) {
  const data = {
    name:   $('pmFName')?.value.trim(), email:  $('pmEmail')?.value.trim(),
    phone:  $('pmPhone')?.value.trim(), role:   $('pmRole')?.value||'worker',
    status: $('pmStatus')?.value,       dept:   $('pmDept')?.value.trim(),
    empId:  $('pmEmpId')?.value.trim(), idNum:  $('pmIdNum')?.value.trim(),
    natId:  $('pmNatId')?.value.trim(), dob:    $('pmDob')?.value,
    hired:  $('pmHired')?.value,        salary: +($('pmSalary')?.value||0),
    addr:   $('pmAddr')?.value.trim(),  emerg:  $('pmEmerg')?.value.trim(),
    bio:    $('pmBio')?.value.trim(),
  };
  if (!data.name||!data.email) { toast('Name and email required','error'); return; }

  const selColor = document.querySelector('#avColorOpts .av-color-opt.sel');
  if (selColor) data.avatarColor = selColor.dataset.color;

  const newPw = $('pmNewPassword')?.value;
  const confPw= $('pmConfirmPassword')?.value;
  if (newPw||confPw) {
    if (newPw!==confPw) { toast('Passwords do not match','error'); return; }
    if (newPw.length < (DB.settings?.passwordMinLen||8)) { toast(`Password too short`,'error'); return; }
    data.password = newPw;
  }

  if (userId) {
    const u = userById(userId); Object.assign(u, data);
    if (data.password) { if (!DB.userPasswords) DB.userPasswords={}; DB.userPasswords[userId]=data.password; }
    logAction('update',`User #${userId}`,`Updated ${data.name}`);
    toast('Profile saved','success');
  } else {
    const newUser = { id:generateId('users'), ...data, avatarImg:'', avatarColor:data.avatarColor||'#eab308', lastLogin:'Never', registered:nowStr().slice(0,10), online:'offline' };
    DB.users.push(newUser);
    if (data.password) { if (!DB.userPasswords) DB.userPasswords={}; DB.userPasswords[newUser.id]=data.password; }
    logAction('create',`User #${newUser.id}`,`Created ${data.name}`);
    toast('User created','success');
  }
  closeM('profileModal');
  if ($('page-users')?.style.display!=='none') renderUserTable();
  updateTopbarAvatar();
}

function renderPMPerf(user) {
  const userTasks = DB.tasks.filter(t => taskAssigneeIds(t).includes(user.id));
  if($('pf_tasks'))      $('pf_tasks').textContent     = userTasks.filter(t=>t.status==='done').length;
  if($('pf_proc'))       $('pf_proc').textContent      = userTasks.filter(t=>t.status==='inprogress').length;
  if($('pf_pend'))       $('pf_pend').textContent      = userTasks.filter(t=>t.status==='todo').length;
  if($('pf_issues'))     $('pf_issues').textContent    = (DB.incidents||[]).filter(i=>i.reporterId===user.id).length;
  if($('pf_rating'))     $('pf_rating').textContent    = '4.2';
  if($('pf_attendance')) $('pf_attendance').textContent= '96%';
  setTimeout(() => {
    destroyChart('pmPerfChart');
    makeChart('pmPerfChart',{
      type:'line',
      data:{ labels:['Jan','Feb','Mar','Apr','May','Jun','Jul'], datasets:[{ label:'Tasks Done', data:[2,4,3,6,5,8,userTasks.filter(t=>t.status==='done').length], borderColor:'#eab308', backgroundColor:'rgba(234,179,8,0.1)', fill:true, tension:0.4 }] },
      options:{ responsive:true, maintainAspectRatio:true, plugins:{ legend:{ display:false } } }
    });
  }, 150);
}

function renderPMDocs(userId) {
  const docs = userId ? DB.documents.filter(d=>d.userId===userId) : [];
  const el = $('pmDocsList'); if (!el) return;
  el.innerHTML = docs.length ? docs.map(d =>
    `<div class="att-file"><i class="fas fa-file"></i><span>${d.name} <span class="badge b-${d.status}" style="margin-left:0.35rem;">${d.status}</span></span><span style="font-size:0.72rem;color:var(--text3);">Expires ${fmt(d.expiry)}</span></div>`
  ).join('') : '<div class="empty-state"><i class="fas fa-folder-open"></i>No documents</div>';
}

function renderPMHist(userId) {
  const logs = DB.auditLog.filter(l=>l.userId===userId).slice(0,10);
  const el = $('pmHistList'); if (!el) return;
  el.innerHTML = logs.length ? logs.map(l =>
    `<div style="display:flex;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;"><span style="color:var(--text3);min-width:120px;">${l.time}</span><span class="badge b-${l.action}">${l.action}</span><span>${l.target} — ${l.details}</span></div>`
  ).join('') : '<div class="empty-state"><i class="fas fa-history"></i>No history</div>';
}

function renderIdCard(user) {
  const u = typeof user==='number' ? userById(user) : user;
  if($('icAv'))      $('icAv').textContent    = initials(u.name);
  if($('icName'))    $('icName').textContent  = u.name;
  if($('icRole'))    $('icRole').textContent  = u.role?.toUpperCase();
  if($('icEmpId'))   $('icEmpId').textContent = u.empId||'—';
  if($('icIdNum'))   $('icIdNum').textContent = u.idNum||'—';
  if($('icDept'))    $('icDept').textContent  = u.dept||'—';
  if($('icHired'))   $('icHired').textContent = fmt(u.hired);
  if($('icBarcode')) $('icBarcode').textContent = u.idNum||`NX-${String(u.id).padStart(3,'0')}-${new Date().getFullYear()}`;
  const ig = $('icInfoGrid');
  if (ig) ig.innerHTML = `
    <div class="info-item"><div class="il">Email</div><div class="iv">${u.email}</div></div>
    <div class="info-item"><div class="il">Phone</div><div class="iv">${u.phone}</div></div>
    <div class="info-item"><div class="il">National ID</div><div class="iv">${u.natId||'—'}</div></div>
    <div class="info-item"><div class="il">DOB</div><div class="iv">${fmt(u.dob)}</div></div>`;
}

$('printIdBtn')?.addEventListener('click', () => window.print());

/* ============================================================
   9. APPROVAL MODAL
   ============================================================ */
function openApprovalModal(userId) {
  const u = userById(userId); if (!u) return;
  if($('approvalInfo')) $('approvalInfo').innerHTML = `<div class="user-cell">${avatarEl(u,36)}<div><div style="font-weight:600;">${u.name}</div><div style="font-size:0.75rem;color:var(--text3);">${u.email} · ${u.role}</div></div></div>`;
  const approveBtn = $('approvalApproveBtn'), rejectBtn = $('approvalRejectBtn');
  if (approveBtn) approveBtn.onclick = () => decideUserApproval(userId,'active');
  if (rejectBtn)  rejectBtn.onclick  = () => decideUserApproval(userId,'inactive');
  openM('approvalModal');
}

function decideUserApproval(userId, decision) {
  const u = userById(userId); if (!u) return;
  u.status = decision;
  const comment = $('approvalComment')?.value||'';
  logAction(decision==='active'?'approve':'reject',`User #${userId}`,`${decision==='active'?'Approved':'Rejected'} ${u.name}. ${comment}`);
  closeM('approvalModal');
  renderUserTable();
  toast(`User ${decision==='active'?'approved':'rejected'}`, decision==='active'?'success':'warn');
  sendEmail(u.email, decision==='active'?'Welcome to Nixers Pro':'Account not approved','welcome_approved');
}

/* ============================================================
   10. SITES PAGE
   ============================================================ */
function renderSites() {
  const addBtn = $('addSiteBtn');
  if (addBtn) { const n=addBtn.cloneNode(true); addBtn.parentNode.replaceChild(n,addBtn); n.addEventListener('click',()=>openSiteModal()); }
  filterAndUpdateSites();
}

function filterAndUpdateSites() {
  const mySites = DB.sites.filter(s => s.managerId===currentUser.id);
  createPaginator('sTbody', mySites, renderSiteTableBody, { perPage:10 });
}

function renderSiteTableBody(sites) {
  const tbody = $('sTbody'); if (!tbody) return;
  if (!sites.length) { tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><i class="fas fa-building"></i>No sites assigned to you</div></td></tr>'; return; }
  tbody.innerHTML = sites.map(s => {
    const mgr = userById(s.managerId);
    return `<tr>
      <td><div style="font-weight:600;">${s.name}</div></td>
      <td><div class="user-cell">${avatarEl(mgr,26)}<span style="font-size:0.82rem;">${mgr?.name||'—'}</span></div></td>
      <td>${s.workerIds?.length||0}</td>
      <td><div style="display:flex;align-items:center;gap:0.5rem;min-width:100px;"><div class="pb" style="flex:1;height:7px;"><div class="pb-fill" style="width:${s.progress}%;"></div></div><span style="font-size:0.75rem;color:var(--text3);">${s.progress}%</span></div></td>
      <td>${fmtMoney(s.budget)}</td><td>${fmtMoney(s.spent)}</td>
      <td>${statusBadge(s.status)}</td>
      <td style="font-size:0.78rem;">${fmt(s.endDate)}</td>
      <td>
        <button class="abt inf" onclick="openSiteDetail(${s.id})"><i class="fas fa-eye"></i></button>
        <button class="abt warn" onclick="openSiteModal(${s.id})"><i class="fas fa-pen"></i></button>
      </td></tr>`;
  }).join('');
}

function renderSiteTable() { filterAndUpdateSites(); }

function openSiteModal(siteId=null) {
  if (siteId) {
    const site = siteById(siteId);
    if (!site||site.managerId!==currentUser.id) { toast('You can only edit sites assigned to you','warn'); return; }
  }
  const managers = DB.users.filter(u=>u.role==='manager');
  const mgrSel = $('sm_mgr');
  if (mgrSel) { mgrSel.innerHTML=`<option value="${currentUser.id}">${currentUser.name} (You)</option>`; mgrSel.disabled=true; }
  const s = siteId ? siteById(siteId) : null;
  siteWorkers = s?.workerIds ? [...s.workerIds] : [];
  if($('smTitle')) $('smTitle').textContent = s?'Edit Site':'Add Site';
  if($('sm_name'))   $('sm_name').value   = s?.name    ||'';
  if($('sm_budget')) $('sm_budget').value = s?.budget  ||'';
  if($('sm_spent'))  $('sm_spent').value  = s?.spent   ||'';
  if($('sm_status')) $('sm_status').value = s?.status  ||'planning';
  if($('sm_start'))  $('sm_start').value  = s?.startDate||'';
  if($('sm_end'))    $('sm_end').value    = s?.endDate  ||'';
  if($('sm_prog'))   $('sm_prog').value   = s?.progress ||0;
  if($('sm_desc'))   $('sm_desc').value   = s?.desc     ||'';
  renderSiteWorkerTags();
  const wsEl = $('sm_workerSearch');
  if (wsEl) wsEl.oninput = e => searchSiteWorkers(e.target.value);
  const saveBtn = $('sm_save');
  if (saveBtn) { const n=saveBtn.cloneNode(true); saveBtn.parentNode.replaceChild(n,saveBtn); n.onclick=()=>saveSite(siteId); }
  openM('siteModal');
}

function searchSiteWorkers(q='') {
  const res = $('sm_workerResults'); if (!res) return;
  const query = q.trim().toLowerCase();
  if (!query) { res.classList.remove('show'); return; }
  const team = getManagerTeamIds();
  const workers = DB.users.filter(u => u.role==='worker' && u.status==='active' && team.has(u.id) && !siteWorkers.includes(u.id) && u.name.toLowerCase().includes(query));
  res.innerHTML = workers.length
    ? workers.map(w=>`<div class="assign-opt" onclick="addSiteWorker(${w.id})">${avatarEl(w,24)}<span>${w.name}</span></div>`).join('')
    : '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No workers found</div>';
  res.classList.add('show');
}

function addSiteWorker(id) { if(!siteWorkers.includes(id)) siteWorkers.push(id); renderSiteWorkerTags(); const r=$('sm_workerResults'); if(r) r.classList.remove('show'); const s=$('sm_workerSearch'); if(s) s.value=''; }
function removeSiteWorker(id) { siteWorkers=siteWorkers.filter(x=>x!==id); renderSiteWorkerTags(); }
function renderSiteWorkerTags() {
  const c=$('sm_workerTags'); if(!c) return;
  c.innerHTML = siteWorkers.length ? siteWorkers.map(id=>{const u=userById(id);return`<div class="assign-tag">${u?.name||id}<button onclick="removeSiteWorker(${id})">×</button></div>`;}).join('')
    : '<div style="font-size:0.78rem;color:var(--text3);padding:0.35rem 0;">No workers assigned</div>';
}

function saveSite(siteId) {
  const data = { name:$('sm_name')?.value.trim(), managerId:currentUser.id, budget:+($('sm_budget')?.value||0), spent:+($('sm_spent')?.value||0), status:$('sm_status')?.value, startDate:$('sm_start')?.value, endDate:$('sm_end')?.value, progress:+($('sm_prog')?.value||0), desc:$('sm_desc')?.value.trim(), workerIds:[...siteWorkers] };
  if (!data.name) { toast('Site name required','error'); return; }
  if (siteId) { const site=siteById(siteId); if(site){ Object.assign(site,data); logAction('update',`Site #${siteId}`,`Updated ${data.name}`); } }
  else { DB.sites.push({id:generateId('sites'),...data}); logAction('create','Site',`Created ${data.name}`); }
  closeM('siteModal'); filterAndUpdateSites(); toast('Site saved','success');
}

function deleteSite(id) { toast('Managers cannot delete sites','warn'); }

function openSiteDetail(siteId) {
  const s = siteById(siteId); if (!s) return;
  if (s.managerId!==currentUser.id) { toast('You can only view sites assigned to you','warn'); return; }
  const mgr = userById(s.managerId);
  const workers = (s.workerIds||[]).map(id=>userById(id)).filter(Boolean);
  if($('sdTitle')) $('sdTitle').textContent = s.name;
  const sdBody = $('sdBody');
  if (sdBody) sdBody.innerHTML = `
    <div class="info-grid" style="margin-bottom:1rem;">
      <div class="info-item"><div class="il">Manager</div><div class="iv">${mgr?.name||'—'}</div></div>
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
      ${workers.map(w=>`<div class="user-cell" style="background:var(--surface2);padding:0.35rem 0.65rem;border-radius:8px;">${avatarEl(w,24)}<span style="font-size:0.8rem;">${w.name}</span></div>`).join('')||'<span style="color:var(--text3);font-size:0.82rem;">No workers assigned</span>'}
    </div>
    ${s.desc?`<hr class="div"><div style="font-size:0.83rem;">${s.desc}</div>`:''}`;
  openM('siteDetailModal');
}

/* ============================================================
   11. POSTS PAGE  (manager sees only own posts)
   ============================================================ */
function renderPosts() {
  populateCatFilter();
  filterAndUpdatePosts();
  const addBtn = $('addPostBtn');
  if (addBtn) { const n=addBtn.cloneNode(true); addBtn.parentNode.replaceChild(n,addBtn); n.addEventListener('click',()=>openPostModal()); }
  ['fPost','fVis','fCat'].forEach(id => $(id)?.addEventListener('input', filterAndUpdatePosts));
  ['fPost','fVis','fCat'].forEach(id => $(id)?.addEventListener('change', filterAndUpdatePosts));
}

function populateCatFilter() {
  const el=$('fCat'); if(!el) return;
  el.innerHTML='<option value="">All Categories</option>'+DB.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const pmCat=$('pm_cat'); if(pmCat) pmCat.innerHTML=DB.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
}

function filterAndUpdatePosts() {
  const q   = $('fPost')?.value.toLowerCase()||'';
  const vis = $('fVis')?.value||'';
  const cat = $('fCat')?.value||'';
  const filtered = DB.posts.filter(p => {
    if (p.authorId!==currentUser.id) return false;
    if (q   && !p.title.toLowerCase().includes(q)) return false;
    if (vis && p.visibility!==vis) return false;
    if (cat && p.catId!==+cat) return false;
    return true;
  });
  createPaginator('pTbody', filtered, renderPostTableBody, { perPage:10 });
}

function renderPostTableBody(posts) {
  const tbody=$('pTbody'); if(!tbody) return;
  if (!posts.length) { tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><i class="fas fa-newspaper"></i>No posts found. Click "Create Post" to add one.</div></td></tr>'; return; }
  tbody.innerHTML = posts.map(p => {
    const author=userById(p.authorId), category=catById(p.catId);
    const assigned=(p.assignedIds||[]).map(id=>userById(id)?.name).filter(Boolean).join(', ');
    return `<tr>
      <td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.title}</td>
      <td><div class="user-cell">${avatarEl(author,26)}<span style="font-size:0.82rem;">${author?.name||'—'}</span></div></td>
      <td>${category?`<span class="badge" style="background:${category.color}22;color:${category.color};"><i class="fas ${category.icon}" style="font-size:0.65rem;"></i> ${category.name}</span>`:'—'}</td>
      <td>${statusBadge(p.visibility==='all'?'published':p.visibility)}</td>
      <td style="font-size:0.75rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${assigned||'Everyone'}</td>
      <td style="font-size:0.75rem;">${fmt(p.created)}</td>
      <td>${statusBadge(p.status)}</td><td>${p.views}</td>
      <td>
        <button class="abt warn" onclick="openPostModal(${p.id})"><i class="fas fa-pen"></i></button>
        <button class="abt dan" onclick="deletePost(${p.id})"><i class="fas fa-trash"></i></button>
      </td></tr>`;
  }).join('');
}

function renderPostTable() { filterAndUpdatePosts(); }

function openPostModal(postId=null) {
  populateCatFilter();
  postAssignees=[];
  const assignTags=$('pm_assignTags'); if(assignTags) assignTags.innerHTML='';
  const attFiles=$('pm_attFiles'); if(attFiles) attFiles.innerHTML='';
  const p = postId ? DB.posts.find(x=>x.id===postId) : null;
  if (p && p.authorId!==currentUser.id) { toast('You can only edit your own posts','warn'); return; }
  if($('pomTitle')) $('pomTitle').textContent = p?'Edit Post':'New Post';
  if($('pm_title')) $('pm_title').value = p?.title||'';
  if($('pm_cat'))   $('pm_cat').value   = p?.catId||(DB.categories[0]?.id||'');
  /* Visibility options limited for managers */
  const visEl = $('pm_vis');
  if (visEl) visEl.innerHTML = `<option value="all" ${p?.visibility==='all'?'selected':''}>Everyone</option><option value="hidden" ${p?.visibility==='hidden'?'selected':''}>Hidden</option>`;
  if($('pm_content')) $('pm_content').value = p?.content||'';
  if($('pm_loc'))     $('pm_loc').value     = p?.location||'';
  if (p) postAssignees=[...(p.assignedIds||[])];
  renderAssignTagsPost();
  const saveBtn=$('pm_save'); if(saveBtn){const n=saveBtn.cloneNode(true);saveBtn.parentNode.replaceChild(n,saveBtn);n.onclick=()=>savePost(postId);}
  $('detectLocBtn')?.addEventListener('click', detectLocation);
  $('pm_assignSearch')?.addEventListener('input', e=>searchAssignees(e.target.value));
  $('pmAttachBtn')?.addEventListener('click', ()=>$('pm_files')?.click());
  $('pmVideoBtn')?.addEventListener('click', ()=>$('pm_video')?.click());
  $('pm_files')?.addEventListener('change', e=>addPostFiles(e.target));
  $('pm_video')?.addEventListener('change', e=>addPostFiles(e.target));
  $('voiceRecBtn')?.addEventListener('click', togglePostVoice);
  openM('postModal');
}

function searchAssignees(q) {
  const res=$('pm_assignResults'); if(!res) return;
  if(!q){res.classList.remove('show');return;}
  const team=getManagerTeamIds();
  const workers=DB.users.filter(u=>u.role==='worker'&&team.has(u.id)&&u.name.toLowerCase().includes(q.toLowerCase())&&!postAssignees.includes(u.id));
  res.innerHTML=workers.map(w=>`<div class="assign-opt" onclick="addAssignee(${w.id})">${avatarEl(w,24)}<span>${w.name}</span></div>`).join('')||'<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.toggle('show',!!workers.length);
}

function addAssignee(id) { if(!postAssignees.includes(id)) postAssignees.push(id); renderAssignTagsPost(); const r=$('pm_assignResults');if(r) r.classList.remove('show'); const s=$('pm_assignSearch');if(s) s.value=''; }
function removeAssignee(id) { postAssignees=postAssignees.filter(x=>x!==id); renderAssignTagsPost(); }
function renderAssignTagsPost() {
  const c=$('pm_assignTags'); if(!c) return;
  c.innerHTML=postAssignees.map(id=>{const u=userById(id);return`<div class="assign-tag">${u?.name||id}<button onclick="removeAssignee(${id})">×</button></div>`;}).join('');
}
function addPostFiles(input) { Array.from(input.files).forEach(f=>{const c=$('pm_attFiles');if(c) c.innerHTML+=`<div class="att-file"><i class="fas fa-file"></i><span>${f.name}</span><span style="color:var(--text3);font-size:0.72rem;">${(f.size/1024).toFixed(1)} KB</span></div>`;}); }
function detectLocation() { if(!navigator.geolocation){toast('Geolocation not supported','error');return;} navigator.geolocation.getCurrentPosition(pos=>{const l=$('pm_loc');if(l) l.value=`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;toast('Location detected','success');},()=>toast('Could not detect location','error')); }
function togglePostVoice() { postVoiceRecording=!postVoiceRecording; const btn=$('voiceRecBtn'); if(btn){btn.classList.toggle('recording',postVoiceRecording);btn.innerHTML=postVoiceRecording?'<i class="fas fa-stop"></i> Stop Recording':'<i class="fas fa-microphone"></i> Record Voice';}const vs=$('pm_voiceStatus');if(vs) vs.style.display=postVoiceRecording?'':'none';if(!postVoiceRecording) toast('Voice note saved','success'); }

function savePost(postId) {
  const data={title:$('pm_title')?.value.trim(), catId:+($('pm_cat')?.value||0), visibility:$('pm_vis')?.value, content:$('pm_content')?.value.trim(), location:$('pm_loc')?.value.trim(), assignedIds:[...postAssignees], files:[]};
  if(!data.title){toast('Title required','error');return;}
  if(postId){const p=DB.posts.find(x=>x.id===postId);if(p&&p.authorId!==currentUser.id){toast('You can only edit your own posts','warn');return;}if(p) Object.assign(p,data);}
  else DB.posts.push({id:generateId('posts'),...data,authorId:currentUser.id,created:nowStr().slice(0,10),status:'published',views:0});
  closeM('postModal'); filterAndUpdatePosts(); toast('Post saved','success');
}

function deletePost(id) {
  const p=DB.posts.find(x=>x.id===id);
  if(!p||p.authorId!==currentUser.id){toast('You can only delete your own posts','warn');return;}
  if(!confirm('Delete this post?')) return;
  DB.posts.splice(DB.posts.findIndex(x=>x.id===id),1);
  filterAndUpdatePosts(); toast('Post deleted','success');
}

/* ============================================================
   12. CATEGORIES PAGE
   ============================================================ */
function renderCategories() {
  renderCatList(); renderCatChart();
  const addBtn=$('addCatBtn'); if(addBtn){const n=addBtn.cloneNode(true);addBtn.parentNode.replaceChild(n,addBtn);n.addEventListener('click',()=>openM('addCatModal'));}
  const saveBtn=$('addCatSaveBtn'); if(saveBtn){const n=saveBtn.cloneNode(true);saveBtn.parentNode.replaceChild(n,saveBtn);n.addEventListener('click',addCategory);}
}

function renderCatList() {
  const el=$('catList'); if(!el) return;
  el.innerHTML=DB.categories.map(c=>`<div class="cat-item"><div class="ci-color" style="background:${c.color};"></div><i class="fas ${c.icon}" style="color:${c.color};font-size:0.85rem;"></i><span class="ci-name">${c.name}</span><span style="font-size:0.72rem;color:var(--text3);">${DB.posts.filter(p=>p.catId===c.id).length} posts</span></div>`).join('')||'<div class="empty-state"><i class="fas fa-tags"></i>No categories</div>';
}

function renderCatChart() {
  makeChart('catChart',{ type:'doughnut', data:{ labels:DB.categories.map(c=>c.name), datasets:[{ data:DB.categories.map(c=>DB.posts.filter(p=>p.catId===c.id).length), backgroundColor:DB.categories.map(c=>c.color+'cc'), borderWidth:0 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:chartTextColor(), font:{ family:'DM Sans', size:11 } } } }, cutout:'60%' } });
}

function addCategory() {
  const name=$('cat_name')?.value.trim(), color=$('cat_color')?.value, icon=$('cat_icon')?.value.trim()||'fa-tag';
  if(!name){toast('Name required','error');return;}
  DB.categories.push({id:generateId('categories'),name,color,icon});
  logAction('create','Category',`Created "${name}"`);
  closeM('addCatModal'); renderCatList(); renderCatChart(); populateCatFilter();
  const cn=$('cat_name'); if(cn) cn.value=''; toast('Category added','success');
}

function deleteCat(id) { toast('Managers cannot delete categories','warn'); }

/* ============================================================
   13. MESSAGES PAGE
   ============================================================ */
function renderMessages() {
  renderGroupList();
  const cb=$('createGroupBtn'); if(cb){const n=cb.cloneNode(true);cb.parentNode.replaceChild(n,cb);n.addEventListener('click',openCreateGroupModal);}
  const sb=$('sendChatBtn'); if(sb){const n=sb.cloneNode(true);sb.parentNode.replaceChild(n,sb);n.addEventListener('click',sendMessage);}
  const ct=$('chatTxt'); if(ct){const n=ct.cloneNode(true);ct.parentNode.replaceChild(n,ct);n.addEventListener('keydown',e=>{if(e.key==='Enter') sendMessage();});}
  const mb=$('chatMembersBtn'); if(mb){const n=mb.cloneNode(true);mb.parentNode.replaceChild(n,mb);n.addEventListener('click',openGroupMembers);}
  const db=$('chatDeleteBtn'); if(db){const n=db.cloneNode(true);db.parentNode.replaceChild(n,db);n.addEventListener('click',deleteCurrentGroup);}
  $('chatAttachBtn')?.addEventListener('click',()=>$('msgFileInput')?.click());
  $('voiceNoteBtn')?.addEventListener('click',()=>toast('Voice note recording (demo)','info'));
}

function renderGroupList() {
  const box=$('gListBox'); if(!box) return;
  const team=getManagerTeamIds();
  const myGroups=DB.groups.filter(g=>g.memberIds.includes(currentUser.id));
  box.innerHTML=myGroups.map(g=>{
    const msgs=DB.messages[g.id]||[], last=msgs[msgs.length-1], active=currentGroup?.id===g.id?' active':'';
    return `<div class="g-item${active}" onclick="selectGroup(${g.id})"><div class="gi-icon" style="background:var(--accent-glow);font-size:1.1rem;">${g.icon}</div><div class="gi-info"><div class="gi-name">${g.name}</div><div class="gi-last">${last?userById(last.authorId)?.name+': '+last.text.slice(0,30):'No messages'}</div></div>${msgs.length?`<div class="gi-cnt">${msgs.length}</div>`:''}</div>`;
  }).join('')||'<div class="empty-state"><i class="fas fa-comments"></i>No groups</div>';
  if(!currentGroup&&myGroups.length) selectGroup(myGroups[0].id);
}

function selectGroup(id) {
  currentGroup=DB.groups.find(g=>g.id===id);
  renderGroupList();
  if($('chatGName')) $('chatGName').textContent=currentGroup?.name||'Select Group';
  if($('chatGMeta')) $('chatGMeta').textContent=`${currentGroup?.memberIds.length||0} members`;
  if($('chatGIcon')) $('chatGIcon').textContent=currentGroup?.icon||'💬';
  renderChatMsgs();
}

function renderChatMsgs() {
  const msgs=DB.messages[currentGroup?.id]||[], box=$('chatMsgsBox'); if(!box) return;
  box.innerHTML=msgs.map(m=>{const u=userById(m.authorId),mine=m.authorId===currentUser.id;return`<div class="msg-bbl${mine?' mine':''}"> ${avatarEl(u,30)}<div class="bbl-body"><div class="bbl-content">${m.text}</div><div class="bbl-meta">${u?.name} · ${m.time}</div></div></div>`;}).join('')||'<div class="empty-state"><i class="fas fa-comment-slash"></i>No messages yet</div>';
  box.scrollTop=box.scrollHeight;
}

function sendMessage() {
  const txt=$('chatTxt')?.value.trim(); if(!txt||!currentGroup) return;
  const msgs=DB.messages[currentGroup.id]=DB.messages[currentGroup.id]||[];
  msgs.push({id:msgs.length+1,groupId:currentGroup.id,authorId:currentUser.id,text:txt,time:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),files:[]});
  const ct=$('chatTxt'); if(ct) ct.value='';
  renderChatMsgs(); renderGroupList();
}

function openCreateGroupModal() {
  const box=$('cg_members'); if(!box) return;
  const team=getManagerTeamIds();
  const teamUsers=DB.users.filter(u=>team.has(u.id));
  box.innerHTML=teamUsers.map(u=>`<label style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem;border-radius:7px;cursor:pointer;font-size:0.82rem;"><input type="checkbox" value="${u.id}" ${u.id===currentUser.id?'checked':''}> ${avatarEl(u,24)} ${u.name}</label>`).join('');
  const cs=$('cgMemberSearch'); if(cs) cs.addEventListener('input',e=>{const q=e.target.value.toLowerCase();box.querySelectorAll('label').forEach(l=>l.style.display=l.textContent.toLowerCase().includes(q)?'':'none');});
  const cn=$('cg_name'),ci=$('cg_icon'),cd=$('cg_desc'); if(cn) cn.value=''; if(ci) ci.value=''; if(cd) cd.value='';
  const createBtn=$('cgCreateBtn'); if(createBtn){const n=createBtn.cloneNode(true);createBtn.parentNode.replaceChild(n,createBtn);n.onclick=createGroup;}
  openM('cgModal');
}

function createGroup() {
  const name=$('cg_name')?.value.trim(); if(!name){toast('Group name required','error');return;}
  const memberIds=[...$('cg_members').querySelectorAll('input:checked')].map(i=>+i.value);
  const g={id:generateId('groups'),name,icon:$('cg_icon')?.value||'💬',desc:$('cg_desc')?.value||'',memberIds,createdBy:currentUser.id};
  DB.groups.push(g); DB.messages[g.id]=[];
  logAction('create','Group',`Created "${name}"`); closeM('cgModal'); renderGroupList(); toast('Group created','success');
}

function openGroupMembers() {
  if(!currentGroup) return;
  const el=$('gmBody'); if(!el) return;
  el.innerHTML='<div style="display:flex;flex-direction:column;gap:0.35rem;">'+currentGroup.memberIds.map(id=>{const u=userById(id);return`<div class="user-cell" style="padding:0.35rem;">${avatarEl(u,30)}<div><div style="font-weight:600;font-size:0.83rem;">${u?.name}</div><div style="font-size:0.72rem;color:var(--text3);">${u?.role}</div></div></div>`;}).join('')+'</div>';
  openM('gmModal');
}

function deleteCurrentGroup() {
  if(!currentGroup) return;
  if(currentGroup.createdBy!==currentUser.id){toast('You can only delete groups you created','warn');return;}
  if(!confirm('Delete this group?')) return;
  DB.groups.splice(DB.groups.findIndex(g=>g.id===currentGroup.id),1);
  delete DB.messages[currentGroup.id]; currentGroup=null; renderGroupList();
  if($('chatGName')) $('chatGName').textContent='Select Group';
  if($('chatMsgsBox')) $('chatMsgsBox').innerHTML='';
  toast('Group deleted','success');
}

/* ============================================================
   14. ANALYTICS PAGE
   ============================================================ */
function renderAnalytics() {
  const team=getManagerTeamIds(), mSites=getManagedSiteIds();
  const myUsers    = DB.users.filter(u=>team.has(u.id));
  const myTasks    = DB.tasks.filter(t=>taskAssigneeIds(t).some(id=>team.has(id)));
  const mySites    = DB.sites.filter(s=>mSites.has(s.id));
  const myIncidents= (DB.incidents||[]).filter(i=>canViewSafetyItem(i));
  const activeUsers=myUsers.filter(u=>u.status==='active').length;
  const doneTasks  =myTasks.filter(t=>t.status==='done').length;
  const sg=$('anStatsGrid');
  if(sg) sg.innerHTML=
    statCard('fa-users','blue',activeUsers,'Team Members','','flat')+
    statCard('fa-list-check','green',`${doneTasks}/${myTasks.length}`,'Tasks Done','','flat')+
    statCard('fa-building','yellow',mySites.filter(s=>s.status==='active').length,'Active Sites','','flat')+
    statCard('fa-triangle-exclamation','red',myIncidents.length,'Total Incidents','','flat');
  setTimeout(()=>{
    makeChart('anMonthly',{ type:'line', data:{ labels:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], datasets:[{ label:'Tasks Completed', data:new Array(12).fill(0).map(()=>Math.floor(Math.random()*5+2)), borderColor:'#eab308', backgroundColor:'rgba(234,179,8,0.08)', fill:true, tension:0.4 }] }, options:{...chartDefaults(),plugins:{legend:{display:false}}} });
    const counts=['todo','inprogress','review','done'].map(s=>myTasks.filter(t=>t.status===s).length);
    makeChart('anStatus',{ type:'pie', data:{ labels:['To Do','In Progress','Review','Done'], datasets:[{ data:counts, backgroundColor:['rgba(100,116,139,0.7)','rgba(234,179,8,0.7)','rgba(59,130,246,0.7)','rgba(16,185,129,0.7)'], borderWidth:0 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:chartTextColor() } } } } });
    const perfs=myUsers.map(u=>({user:u,done:myTasks.filter(t=>taskAssigneeIds(t).includes(u.id)&&t.status==='done').length})).sort((a,b)=>b.done-a.done).slice(0,5);
    const tp=$('topPerf'); if(tp) tp.innerHTML=perfs.map((p,i)=>`<div class="perf-row"><span class="perf-rank">${i+1}</span>${avatarEl(p.user,30)}<div style="flex:1;"><div style="font-size:0.83rem;font-weight:600;">${p.user.name}</div><div style="font-size:0.72rem;color:var(--text3);">${p.user.role}</div></div><span style="font-family:'Space Grotesk',sans-serif;font-weight:700;color:var(--accent);">${p.done} tasks</span></div>`).join('');
    if(mySites.length) makeChart('anSites',{ type:'bar', data:{ labels:mySites.map(s=>s.name.length>15?s.name.slice(0,15)+'…':s.name), datasets:[{ label:'Progress %', data:mySites.map(s=>s.progress), backgroundColor:'rgba(234,179,8,0.75)', borderRadius:6 }] }, options:{...chartDefaults(),indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{...chartDefaults().scales.x,max:100},y:chartDefaults().scales.y}} });
  },100);
}

/* ============================================================
   15. LEAVE MANAGEMENT
   ============================================================ */
function renderLeave() {
  wireLeaveTabs();
  filterAndUpdateLeaveRequests();
  filterAndUpdateLeaveBalances();
  filterAndUpdateHolidays();
  renderLeaveCalendar();
  const lvExp=$('lvExport'); if(lvExp){const n=lvExp.cloneNode(true);lvExp.parentNode.replaceChild(n,lvExp);n.addEventListener('click',()=>{const team=getManagerTeamIds();exportCSV(DB.leaveRequests.filter(l=>team.has(l.userId)).map(l=>({...l,userName:userById(l.userId)?.name})),'leave_requests.csv');});}
  /* Holidays add btn - disabled for managers */
  const ahBtn=$('addHolidayBtn'); if(ahBtn){ahBtn.disabled=true;ahBtn.style.opacity='0.5';ahBtn.title='Only administrators can add holidays';}
  ['lvStatus','lvType','lvFrom','lvTo'].forEach(id=>{const el=$(id);if(el){const n=el.cloneNode(true);el.parentNode.replaceChild(n,el);n.addEventListener('change',filterAndUpdateLeaveRequests);}});
}

function wireLeaveTabs() {
  const panels={'requests':'lv-requests','balances':'lv-balances','calendar':'lv-calendar','holidays':'lv-holidays'};
  $$('[data-lvtab]').forEach(btn=>{
    const n=btn.cloneNode(true); btn.parentNode.replaceChild(n,btn);
    n.addEventListener('click',()=>{
      $$('[data-lvtab]').forEach(b=>b.classList.remove('active')); n.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el) el.style.display='none';});
      const target=$(panels[n.dataset.lvtab]); if(target) target.style.display='';
      if(n.dataset.lvtab==='requests') filterAndUpdateLeaveRequests();
      if(n.dataset.lvtab==='balances') filterAndUpdateLeaveBalances();
      if(n.dataset.lvtab==='holidays') filterAndUpdateHolidays();
    });
  });
}

function filterAndUpdateLeaveRequests() {
  const team=getManagerTeamIds();
  const st=$('lvStatus')?.value||'', type=$('lvType')?.value||'', from=$('lvFrom')?.value||'', to=$('lvTo')?.value||'';
  const filtered=DB.leaveRequests.filter(l=>{
    if(!team.has(l.userId)) return false;
    if(st&&l.status!==st) return false; if(type&&l.type!==type) return false;
    if(from&&l.from<from) return false; if(to&&l.to>to) return false;
    return true;
  });
  createPaginator('lvTbody', filtered, renderLeaveTableBody, {perPage:10});
}

function renderLeaveTableBody(requests) {
  const tbody=$('lvTbody'); if(!tbody) return;
  tbody.innerHTML=requests.length?requests.map(l=>{const u=userById(l.userId);return`<tr><td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name}</span></div></td><td><span class="badge b-update">${l.type}</span></td><td>${fmt(l.from)}</td><td>${fmt(l.to)}</td><td>${l.days}</td><td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.reason}</td><td>${statusBadge(l.status)}</td><td style="font-size:0.75rem;">${fmt(l.applied)}</td><td>${l.status==='pending'?`<button class="abt suc" onclick="openLeaveDecision(${l.id},'approve')"><i class="fas fa-check"></i></button><button class="abt dan" onclick="openLeaveDecision(${l.id},'reject')"><i class="fas fa-times"></i></button>`:'<span style="color:var(--text3);font-size:0.75rem;">—</span>'}</td></tr>`;}).join(''):'<tr><td colspan="9"><div class="empty-state"><i class="fas fa-calendar"></i>No leave requests found for your team</div></td></tr>';
}

function filterAndUpdateLeaveBalances() {
  const team=getManagerTeamIds();
  const users=DB.users.filter(u=>team.has(u.id)&&u.status==='active');
  createPaginator('lvBalTbody', users, renderLeaveBalancesBody, {perPage:10});
}

function renderLeaveBalancesBody(users) {
  const tbody=$('lvBalTbody'); if(!tbody) return;
  tbody.innerHTML=users.length?users.map(u=>{const b=DB.leaveBalance?.[u.id]||{annual:20,sick:10,emergency:5,annualUsed:0,sickUsed:0,emergencyUsed:0,unpaidUsed:0};return`<tr><td><div class="user-cell">${avatarEl(u,26)}<span>${u.name}</span></div></td><td>${b.annual-b.annualUsed} / ${b.annual}</td><td>${b.sick-b.sickUsed} / ${b.sick}</td><td>${b.emergency-b.emergencyUsed} / ${b.emergency}</td><td>${b.unpaidUsed}</td><td>${b.annualUsed+b.sickUsed+b.emergencyUsed+b.unpaidUsed}</td></tr>`;}).join(''):'<tr><td colspan="6"><div class="empty-state"><i class="fas fa-users"></i>No team members found</div></td></tr>';
}

function filterAndUpdateHolidays() {
  createPaginator('holidayTbody', DB.holidays, holidays=>{
    const tbody=$('holidayTbody'); if(!tbody) return;
    tbody.innerHTML=holidays.length?holidays.map(h=>`<tr><td>${fmt(h.date)}</td><td style="font-weight:600;">${h.name}</td><td><span class="badge b-update">${h.type}</span></td><td><span style="color:var(--text3);font-size:0.75rem;">—</span></td></tr>`).join(''):'<tr><td colspan="4"><div class="empty-state"><i class="fas fa-calendar"></i>No holidays found</div></td></tr>';
  },{perPage:10});
}

function openLeaveDecision(leaveId, action) {
  const l=DB.leaveRequests.find(x=>x.id===leaveId);
  const u=userById(l?.userId);
  const team=getManagerTeamIds();
  if(!team.has(l?.userId)){toast('You can only decide leave for your team members','warn');return;}
  if($('ldTitle')) $('ldTitle').textContent=action==='approve'?'Approve Leave':'Reject Leave';
  if($('ldInfo')) $('ldInfo').innerHTML=`<strong>${u?.name}</strong> — ${l?.type} leave · ${l?.days} day(s) · ${fmt(l?.from)} to ${fmt(l?.to)}<br><em style="color:var(--text3);font-size:0.8rem;">${l?.reason}</em>`;
  if($('ldComment')) $('ldComment').value='';
  const ab=$('ldApproveBtn'); if(ab){const n=ab.cloneNode(true);ab.parentNode.replaceChild(n,ab);n.onclick=()=>decideLeave(leaveId,'approved');}
  const rb=$('ldRejectBtn');  if(rb){const n=rb.cloneNode(true);rb.parentNode.replaceChild(n,rb);n.onclick=()=>decideLeave(leaveId,'rejected');}
  openM('leaveDecisionModal');
}

function decideLeave(leaveId, decision) {
  const l=DB.leaveRequests.find(x=>x.id===leaveId); const u=userById(l?.userId);
  l.status=decision; l.comment=$('ldComment')?.value||'';
  logAction(decision==='approved'?'approve':'reject',`Leave #${leaveId}`,`${decision} for ${u?.name}`);
  sendEmail(u?.email||'',`Leave ${decision}`,'leave_decision');
  closeM('leaveDecisionModal'); filterAndUpdateLeaveRequests(); filterAndUpdateLeaveBalances();
  toast(`Leave ${decision}`,'success');
}

function renderLeaveCalendar() {
  const label=$('lvCalLabel'), body=$('lvCalBody'); if(!label||!body) return;
  const y=leaveCalDate.getFullYear(),m=leaveCalDate.getMonth();
  label.textContent=leaveCalDate.toLocaleString('default',{month:'long',year:'numeric'});
  const firstDay=new Date(y,m,1).getDay(), daysInMonth=new Date(y,m+1,0).getDate();
  const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html='<div class="leave-cal">'+dayNames.map(d=>`<div class="cal-day-hdr">${d}</div>`).join('');
  for(let i=0;i<firstDay;i++) html+=`<div class="cal-day other-month"></div>`;
  const today=new Date();
  const team=getManagerTeamIds();
  const approvedLeaves=DB.leaveRequests.filter(l=>l.status==='approved'&&team.has(l.userId));
  for(let d=1;d<=daysInMonth;d++){
    const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday=y===today.getFullYear()&&m===today.getMonth()&&d===today.getDate();
    const leaves=approvedLeaves.filter(l=>l.from<=ds&&l.to>=ds);
    const holiday=DB.holidays?.find(h=>h.date===ds);
    html+=`<div class="cal-day${isToday?' today':''}"><div class="cal-day-num">${d}</div>${holiday?`<div class="cal-leave-tag" style="background:rgba(234,179,8,0.2);color:var(--accent);">${holiday.name}</div>`:''}${leaves.map(l=>{const u=userById(l.userId);return`<div class="cal-leave-tag" style="background:rgba(59,130,246,0.15);color:#60a5fa;">${u?.name?.split(' ')[0]}</div>`;}).join('')}</div>`;
  }
  html+='</div>'; body.innerHTML=html;
  const prevBtn=$('lvCalPrev'),nextBtn=$('lvCalNext');
  if(prevBtn){const n=prevBtn.cloneNode(true);prevBtn.parentNode.replaceChild(n,prevBtn);n.addEventListener('click',()=>{leaveCalDate.setMonth(leaveCalDate.getMonth()-1);renderLeaveCalendar();});}
  if(nextBtn){const n=nextBtn.cloneNode(true);nextBtn.parentNode.replaceChild(n,nextBtn);n.addEventListener('click',()=>{leaveCalDate.setMonth(leaveCalDate.getMonth()+1);renderLeaveCalendar();});}
}

function addHoliday() { toast('Only administrators can add holidays','warn'); }
function deleteHoliday(id) { toast('Only administrators can delete holidays','warn'); }

/* ============================================================
   16. TIMESHEETS
   ============================================================ */
function renderTimesheets() {
  populateWeekSelect('tsWeek');
  const team=getManagerTeamIds();
  const teamUsers=DB.users.filter(u=>team.has(u.id)&&u.role!=='admin');
  const userSel=$('tsUser'); if(userSel) userSel.innerHTML='<option value="">All Employees</option>'+teamUsers.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  renderTimesheetTable();
  ['tsUser','tsWeek','tsStatus2'].forEach(id=>{const el=$(id);if(el){const n=el.cloneNode(true);el.parentNode.replaceChild(n,el);n.addEventListener('change',renderTimesheetTable);}});
  const exp=$('tsExport');if(exp){const n=exp.cloneNode(true);exp.parentNode.replaceChild(n,exp);n.addEventListener('click',()=>{const team=getManagerTeamIds();exportCSV(DB.timesheets.filter(t=>team.has(t.userId)).map(t=>({...t,userName:userById(t.userId)?.name})),'timesheets.csv');});}
}

function populateWeekSelect(elId) {
  const el=$(elId); if(!el) return;
  const weeks=[];
  for(let i=0;i<8;i++){const d=new Date();d.setDate(d.getDate()-i*7);const y=d.getFullYear(),w=String(getISOWeek(d)).padStart(2,'0');weeks.push(`${y}-W${w}`);}
  el.innerHTML=[...new Set(weeks)].map(w=>`<option value="${w}">${w}</option>`).join('');
}

function getISOWeek(d) {
  const date=new Date(d); date.setHours(0,0,0,0); date.setDate(date.getDate()+3-(date.getDay()+6)%7);
  const week1=new Date(date.getFullYear(),0,4);
  return 1+Math.round(((date-week1)/86400000-3+(week1.getDay()+6)%7)/7);
}

function renderTimesheetTable() {
  const team=getManagerTeamIds();
  const userId=+($('tsUser')?.value||0), week=$('tsWeek')?.value||'', status=$('tsStatus2')?.value||'';
  const rows=DB.timesheets.filter(t=>{
    if(!team.has(t.userId)) return false;
    if(userId&&t.userId!==userId) return false;
    if(week&&t.week!==week) return false;
    if(status&&t.status!==status) return false;
    return true;
  });
  const total=rows.reduce((s,t)=>s+(t.mon+t.tue+t.wed+t.thu+t.fri+t.sat+t.sun),0);
  const ot=rows.reduce((s,t)=>{const hrs=t.mon+t.tue+t.wed+t.thu+t.fri+t.sat+t.sun;return s+(hrs>40?hrs-40:0);},0);
  const ts=$('tsStats');
  if(ts) ts.innerHTML=statCard('fa-clock','blue',total+'h','Total Hours','','flat')+statCard('fa-fire','orange',ot+'h','Overtime','','flat')+statCard('fa-check','green',rows.filter(r=>r.status==='approved').length,'Approved','','flat')+statCard('fa-hourglass','yellow',rows.filter(r=>r.status==='pending').length,'Pending','','flat');
  const tbody=$('tsTbody'); if(!tbody) return;
  tbody.innerHTML=rows.map(t=>{const u=userById(t.userId),tot=t.mon+t.tue+t.wed+t.thu+t.fri+t.sat+t.sun,ot=tot>40?tot-40:0;return`<tr><td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name}</span></div></td><td style="font-size:0.75rem;">${t.week}</td>${[t.mon,t.tue,t.wed,t.thu,t.fri,t.sat,t.sun].map(h=>`<td style="text-align:center;${h===0?'color:var(--text3);':''}">${h||'—'}</td>`).join('')}<td style="font-weight:700;text-align:center;">${tot}h</td><td style="text-align:center;color:${ot>0?'#f97316':'var(--text3)'};">${ot>0?ot+'h':'—'}</td><td>${statusBadge(t.status)}</td><td>${t.status==='pending'?`<button class="abt suc" onclick="decideTimesheet(${t.id},'approved')"><i class="fas fa-check"></i></button><button class="abt dan" onclick="decideTimesheet(${t.id},'rejected')"><i class="fas fa-times"></i></button>`:'<span style="color:var(--text3);">—</span>'}</td></tr>`;}).join('')||'<tr><td colspan="13"><div class="empty-state"><i class="fas fa-clock"></i>No timesheets found</div></td></tr>';
}

function decideTimesheet(id, decision) {
  const t=DB.timesheets.find(x=>x.id===id); if(!t) return;
  const team=getManagerTeamIds(); if(!team.has(t.userId)){toast('You can only decide timesheets for your team','warn');return;}
  t.status=decision; renderTimesheetTable(); toast(`Timesheet ${decision}`,'success');
}

/* ============================================================
   17. PAYROLL
   ============================================================ */
function renderPayroll() {
  populatePeriodSelect();
  filterAndUpdatePayroll();
  /* Process btn disabled for managers */
  const pb=$('prProcess'); if(pb){pb.disabled=true;pb.style.opacity='0.5';pb.title='Only administrators can process payroll';}
  const exp=$('prExport');if(exp){const n=exp.cloneNode(true);exp.parentNode.replaceChild(n,exp);n.addEventListener('click',()=>{const period=$('prPeriod')?.value||currentPayrollPeriod;const team=getManagerTeamIds();exportCSV(DB.payroll.filter(p=>team.has(p.userId)&&p.period===period).map(p=>({...p,userName:userById(p.userId)?.name,netPay:netPay(p)})),'payroll.csv');});}
  ['prPeriod','prStatus'].forEach(id=>{const el=$(id);if(el){const n=el.cloneNode(true);el.parentNode.replaceChild(n,el);n.addEventListener('change',filterAndUpdatePayroll);}});
}

function populatePeriodSelect() {
  const el=$('prPeriod'); if(!el) return;
  const periods=['2025-07','2025-06','2025-05','2025-04'];
  el.innerHTML=periods.map(p=>`<option value="${p}">${p}</option>`).join('');
  el.value=currentPayrollPeriod;
}

function filterAndUpdatePayroll() {
  const team=getManagerTeamIds(), period=$('prPeriod')?.value||currentPayrollPeriod, status=$('prStatus')?.value||'';
  const filtered=DB.payroll.filter(p=>{
    if(!team.has(p.userId)) return false;
    if(p.period!==period) return false;
    if(status&&p.status!==status) return false;
    return true;
  });
  const totalNet=filtered.reduce((s,p)=>s+netPay(p),0), totalBase=filtered.reduce((s,p)=>s+p.baseSalary,0), totalOT=filtered.reduce((s,p)=>s+p.overtime,0);
  const ps=$('prStats'); if(ps) ps.innerHTML=statCard('fa-users','blue',filtered.length,'Employees','','flat')+statCard('fa-money-bill','green',fmtMoney(totalBase),'Base Total','','flat')+statCard('fa-fire','orange',fmtMoney(totalOT),'Overtime Total','','flat')+statCard('fa-coins','yellow',fmtMoney(totalNet),'Net Payroll','','flat');
  if(filtered.length) createPaginator('prTbody', filtered, renderPayrollTableBody, {perPage:10});
  else { const tbody=$('prTbody');if(tbody) tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><i class="fas fa-money-bill-wave"></i>No payroll data found for your team</div></td></tr>'; }
}

function renderPayrollTableBody(rows) {
  const tbody=$('prTbody'); if(!tbody) return;
  tbody.innerHTML=rows.map(p=>{const u=userById(p.userId);return`<tr><td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name||'Unknown'}</span></div></td><td>${fmtMoney(p.baseSalary)}</td><td style="color:#f97316;">${fmtMoney(p.overtime)}</td><td style="color:#34d399;">${fmtMoney(p.bonus)}</td><td>${fmtMoney(p.allowances)}</td><td style="color:#f87171;">(${fmtMoney(p.deductions)})</td><td style="font-weight:700;color:var(--accent);">${fmtMoney(netPay(p))}</td><td>${statusBadge(p.status)}</td><td><button class="abt inf" onclick="openPayslip(${p.id})"><i class="fas fa-eye"></i></button><button class="abt" onclick="emailPayslip(${p.id})"><i class="fas fa-envelope"></i></button></td></tr>`;}).join('');
}

function renderPayrollTable() { filterAndUpdatePayroll(); }

function openPayslip(prId) {
  const p=DB.payroll.find(x=>x.id===prId); if(!p) return;
  const team=getManagerTeamIds(); if(!team.has(p.userId)){toast('You can only view payslips for your team','warn');return;}
  const u=userById(p.userId);
  const pb=$('payslipBody');
  if(pb) pb.innerHTML=`<div class="payslip-wrap"><div class="payslip-hdr"><div><div style="font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:1.1rem;">NIXERS.pro</div><div style="font-size:0.75rem;color:var(--text3);">Payslip — ${p.period}</div></div><div style="text-align:right;">${avatarEl(u,40)}</div></div><div style="margin-bottom:1rem;">${avatarEl(u,36)} <strong>${u?.name}</strong> · ${u?.dept||u?.role}</div><div class="payslip-row"><span>Basic Salary</span><span>${fmtMoney(p.baseSalary)}</span></div><div class="payslip-row"><span>Overtime</span><span style="color:#f97316;">+${fmtMoney(p.overtime)}</span></div><div class="payslip-row"><span>Bonus</span><span style="color:#34d399;">+${fmtMoney(p.bonus)}</span></div><div class="payslip-row"><span>Allowances</span><span>+${fmtMoney(p.allowances)}</span></div><div class="payslip-row"><span>Deductions</span><span style="color:#f87171;">-${fmtMoney(p.deductions)}</span></div><hr class="div"><div class="payslip-row payslip-total"><span>Net Pay</span><span>${fmtMoney(netPay(p))}</span></div></div>`;
  const ppb=$('payslipPrintBtn'); if(ppb){const n=ppb.cloneNode(true);ppb.parentNode.replaceChild(n,ppb);n.onclick=()=>window.print();}
  const peb=$('payslipEmailBtn'); if(peb){const n=peb.cloneNode(true);peb.parentNode.replaceChild(n,peb);n.onclick=()=>emailPayslip(prId);}
  openM('payslipModal');
}

function emailPayslip(prId) {
  const p=DB.payroll.find(x=>x.id===prId); const u=userById(p?.userId);
  if(u?.email){sendEmail(u.email,'Your Payslip is Ready','payslip');toast(`Payslip emailed to ${u.name}`,'success');}
  else toast('No email address found','error');
}

/* ============================================================
   18. TASKS & PROJECTS
   ============================================================ */
function renderTasks() {
  populateProjectSelects();
  wireTTabs();
  filterAndUpdateProjects();
  renderKanban();
  renderGantt();
  const apb=$('addProjectBtn'); if(apb){const n=apb.cloneNode(true);apb.parentNode.replaceChild(n,apb);n.onclick=()=>openProjectModal();}
  const ps=$('projSearch'); if(ps){const n=ps.cloneNode(true);ps.parentNode.replaceChild(n,ps);n.oninput=filterAndUpdateProjects;}
  const pst=$('projStatus'); if(pst){const n=pst.cloneNode(true);pst.parentNode.replaceChild(n,pst);n.onchange=filterAndUpdateProjects;}
  ['kanbanProject','kanbanAssignee','kanbanPriority'].forEach(id=>{const el=$(id);if(el){const n=el.cloneNode(true);el.parentNode.replaceChild(n,el);n.onchange=renderKanban;}});
  $$('.kanban-add-btn').forEach(btn=>{const n=btn.cloneNode(true);btn.parentNode.replaceChild(n,btn);n.onclick=()=>openTaskModal(null,n.dataset.col);});
}

function populateProjectSelects() {
  const mSites=getManagedSiteIds();
  const myProjects=DB.projects.filter(p=>mSites.has(p.siteId)||p.createdBy===currentUser.id);
  const team=getManagerTeamIds();
  const teamUsers=DB.users.filter(u=>team.has(u.id));
  const mySites=DB.sites.filter(s=>s.managerId===currentUser.id);
  const kp=$('kanbanProject'); if(kp) kp.innerHTML='<option value="">All Projects</option>'+myProjects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const ka=$('kanbanAssignee'); if(ka) ka.innerHTML='<option value="">All Assignees</option>'+teamUsers.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  const tp=$('tm_project'); if(tp) tp.innerHTML=myProjects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const ps=$('proj_site'); if(ps) ps.innerHTML='<option value="">None</option>'+mySites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
}

function wireTTabs() {
  const panels={projects:'tt-projects',kanban:'tt-kanban',gantt:'tt-gantt'};
  $$('[data-ttab]').forEach(btn=>{
    const n=btn.cloneNode(true); btn.parentNode.replaceChild(n,btn);
    n.addEventListener('click',()=>{
      $$('[data-ttab]').forEach(b=>b.classList.remove('active')); n.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el) el.style.display='none';});
      const target=$(panels[n.dataset.ttab]); if(target) target.style.display='';
    });
  });
}

function filterAndUpdateProjects() {
  const mSites=getManagedSiteIds(), q=$('projSearch')?.value.toLowerCase()||'', st=$('projStatus')?.value||'';
  const filtered=DB.projects.filter(p=>{
    if(!mSites.has(p.siteId)&&p.createdBy!==currentUser.id) return false;
    if(q&&!p.name.toLowerCase().includes(q)) return false;
    if(st&&p.status!==st) return false;
    return true;
  });
  createPaginator('projTbody', filtered, renderProjectTableBody, {perPage:10});
}

function renderProjectTableBody(projects) {
  const tbody=$('projTbody'); if(!tbody) return;
  if(!projects.length){tbody.innerHTML='<tr><td colspan="8"><div class="empty-state"><i class="fas fa-folder-open"></i>No projects found</div></td></tr>';return;}
  tbody.innerHTML=projects.map(p=>{const tasks=DB.tasks.filter(t=>t.projectId===p.id),done=tasks.filter(t=>t.status==='done').length;return`<tr><td style="font-weight:600;">${p.name}</td><td><div style="display:flex;gap:-6px;">${(p.teamIds||[]).slice(0,3).map(id=>avatarEl(userById(id),26)).join('')}${(p.teamIds||[]).length>3?`<span style="font-size:0.72rem;color:var(--text3);padding-left:4px;">+${p.teamIds.length-3}</span>`:''}</div></td><td><div style="display:flex;align-items:center;gap:0.5rem;min-width:80px;"><div class="pb" style="flex:1;height:6px;"><div class="pb-fill" style="width:${p.progress}%;"></div></div><span style="font-size:0.72rem;">${p.progress}%</span></div></td><td>${priorityBadge(p.priority)}</td><td style="font-size:0.78rem;">${fmt(p.dueDate)}</td><td style="font-size:0.82rem;">${done}/${tasks.length}</td><td>${statusBadge(p.status)}</td><td><button class="abt warn" onclick="openProjectModal(${p.id})"><i class="fas fa-pen"></i></button></td></tr>`;}).join('');
}

function renderProjectTable() { filterAndUpdateProjects(); }

function openProjectModal(projId=null) {
  populateProjectSelects();
  const p=projId?projectById(projId):null;
  if($('projTitle')) $('projTitle').textContent=p?'Edit Project':'New Project';
  if($('proj_name'))     $('proj_name').value     = p?.name    ||'';
  if($('proj_status'))   $('proj_status').value   = p?.status  ||'planning';
  if($('proj_priority')) $('proj_priority').value = p?.priority||'medium';
  if($('proj_due'))      $('proj_due').value       = p?.dueDate ||'';
  if($('proj_site'))     $('proj_site').value      = p?.siteId  ||'';
  if($('proj_desc'))     $('proj_desc').value      = p?.desc    ||'';
  projectTeamMembers=[...(p?.teamIds||[])];
  renderAssignTags(projectTeamMembers,'proj_teamTags','removeProjectTeamMember');
  const ts=$('proj_teamSearch'); if(ts){const n=ts.cloneNode(true);ts.parentNode.replaceChild(n,ts);n.oninput=e=>searchProjectTeam(e.target.value);n.onfocus=e=>searchProjectTeam(e.target.value);}
  const sb=$('proj_save'); if(sb){const n=sb.cloneNode(true);sb.parentNode.replaceChild(n,sb);n.onclick=()=>saveProject(projId);}
  openM('projectModal');
}

function saveProject(projId) {
  const data={name:$('proj_name')?.value.trim(),status:$('proj_status')?.value,priority:$('proj_priority')?.value,dueDate:$('proj_due')?.value,desc:$('proj_desc')?.value.trim(),siteId:+($('proj_site')?.value||0)||null,teamIds:[...projectTeamMembers],progress:projId?projectById(projId)?.progress||0:0,createdBy:currentUser.id};
  if(!data.name){toast('Name required','error');return;}
  if(projId){Object.assign(projectById(projId),data);logAction('update',`Project #${projId}`,`Updated ${data.name}`);}
  else{DB.projects.push({id:generateId('projects'),...data});logAction('create','Project',`Created ${data.name}`);}
  closeM('projectModal'); filterAndUpdateProjects(); renderKanban(); renderGantt(); toast('Project saved','success');
}

function deleteProject(id) { toast('Managers cannot delete projects','warn'); }

function searchProjectTeam(q='') {
  const res=$('proj_teamResults'); if(!res) return;
  const query=q.trim().toLowerCase(), team=getManagerTeamIds();
  const options=DB.users.filter(u=>team.has(u.id)&&!projectTeamMembers.includes(u.id)&&(!query||u.name.toLowerCase().includes(query)));
  res.innerHTML=options.map(u=>`<div class="assign-opt" onclick="addProjectTeamMember(${u.id})">${avatarEl(u,24)}<span>${u.name}</span></div>`).join('')||'<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.toggle('show',!!options.length);
}

function addProjectTeamMember(id){if(!projectTeamMembers.includes(id)) projectTeamMembers.push(id);renderAssignTags(projectTeamMembers,'proj_teamTags','removeProjectTeamMember');const r=$('proj_teamResults');if(r) r.classList.remove('show');const s=$('proj_teamSearch');if(s) s.value='';}
function removeProjectTeamMember(id){projectTeamMembers=projectTeamMembers.filter(x=>x!==id);renderAssignTags(projectTeamMembers,'proj_teamTags','removeProjectTeamMember');}

function renderAssignTags(ids, targetId, removeFn) {
  const target=$(targetId); if(!target) return;
  target.innerHTML=ids.map(id=>{const u=userById(id);return`<div class="assign-tag">${u?.name||id}<button onclick="${removeFn}(${id})">×</button></div>`;}).join('');
}

function searchTaskAssignees(q='') {
  const res=$('tm_assigneeResults'); if(!res) return;
  const query=q.trim().toLowerCase(), team=getManagerTeamIds();
  const options=DB.users.filter(u=>team.has(u.id)&&!taskAssignees.includes(u.id)&&(!query||u.name.toLowerCase().includes(query)));
  res.innerHTML=options.map(u=>`<div class="assign-opt" onclick="addTaskAssignee(${u.id})">${avatarEl(u,24)}<span>${u.name}</span></div>`).join('')||'<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.toggle('show',!!options.length);
}

function addTaskAssignee(id){if(!taskAssignees.includes(id)) taskAssignees.push(id);renderAssignTags(taskAssignees,'tm_assigneeTags','removeTaskAssignee');const r=$('tm_assigneeResults');if(r) r.classList.remove('show');const s=$('tm_assigneeSearch');if(s) s.value='';}
function removeTaskAssignee(id){taskAssignees=taskAssignees.filter(x=>x!==id);renderAssignTags(taskAssignees,'tm_assigneeTags','removeTaskAssignee');}

function renderTaskAttachments(){const box=$('tm_attFiles');if(!box) return;box.innerHTML=taskAttachments.map((f,i)=>`<div class="af-item"><i class="fas fa-file"></i><span>${f.name}</span><button class="abt dan" onclick="removeTaskAttachment(${i})"><i class="fas fa-times"></i></button></div>`).join('')||'<div style="font-size:0.78rem;color:var(--text3);">No attachments added</div>';}
function removeTaskAttachment(index){taskAttachments.splice(index,1);renderTaskAttachments();}

function renderKanban() {
  const cols=['todo','inprogress','review','done'];
  const mSites=getManagedSiteIds(),team=getManagerTeamIds();
  const pf=+($('kanbanProject')?.value||0),af=+($('kanbanAssignee')?.value||0),prf=$('kanbanPriority')?.value||'';
  const myTasks=DB.tasks.filter(t=>{const a=taskAssigneeIds(t);return a.some(id=>team.has(id));});
  cols.forEach(col=>{
    const cards=$(`kCards-${col}`); if(!cards) return;
    const tasks=myTasks.filter(t=>{
      if(t.status!==col) return false;
      if(pf&&t.projectId!==pf) return false;
      if(prf&&t.priority!==prf) return false;
      if(af&&!taskAssigneeIds(t).includes(af)) return false;
      return true;
    });
    const cnt=$(`kc-${col}`); if(cnt) cnt.textContent=tasks.length;
    cards.innerHTML=tasks.map(t=>{const assignees=taskAssigneeIds(t).map(userById).filter(Boolean),proj=projectById(t.projectId);return`<div class="kanban-card" onclick="openTaskModal(${t.id})"><div class="kc-title">${t.title}</div>${proj?`<div style="font-size:0.7rem;color:var(--text3);margin-bottom:0.3rem;">${proj.name}</div>`:''}<div class="kc-meta">${priorityBadge(t.priority)}${t.dueDate?`<span style="font-size:0.68rem;color:var(--text3);">📅 ${fmt(t.dueDate)}</span>`:''}<div class="kc-assignee">${assignees.slice(0,2).map(u=>avatarEl(u,20)).join('')}${assignees.length>2?`<span>+${assignees.length-2}</span>`:''}</div></div></div>`;}).join('')||'<div style="text-align:center;padding:1rem;color:var(--text3);font-size:0.75rem;">No tasks</div>';
  });
}

function openTaskModal(taskId=null, col='todo') {
  populateProjectSelects();
  const t=taskId?DB.tasks.find(x=>x.id===taskId):null;
  if($('tmTitle')) $('tmTitle').textContent=t?'Edit Task':'New Task';
  if($('tm_title'))    $('tm_title').value    = t?.title    ||'';
  if($('tm_project'))  $('tm_project').value  = t?.projectId||DB.projects[0]?.id||'';
  if($('tm_priority')) $('tm_priority').value = t?.priority ||'medium';
  if($('tm_due'))      $('tm_due').value      = t?.dueDate  ||'';
  if($('tm_desc'))     $('tm_desc').value     = t?.desc     ||'';
  if($('tm_status'))   $('tm_status').value   = t?.status   ||col;
  taskAssignees=[...taskAssigneeIds(t)]; taskAttachments=[...(t?.attachments||[])]; taskVoiceRecording=false;
  renderAssignTags(taskAssignees,'tm_assigneeTags','removeTaskAssignee');
  renderTaskAttachments();
  const tas=$('tm_assigneeSearch');if(tas){const n=tas.cloneNode(true);tas.parentNode.replaceChild(n,tas);n.oninput=e=>searchTaskAssignees(e.target.value);n.onfocus=e=>searchTaskAssignees(e.target.value);}
  const tvb=$('tm_voiceBtn');if(tvb){const n=tvb.cloneNode(true);tvb.parentNode.replaceChild(n,tvb);n.onclick=()=>{taskVoiceRecording=!taskVoiceRecording;n.classList.toggle('recording',taskVoiceRecording);n.innerHTML=taskVoiceRecording?'<i class="fas fa-stop"></i> Stop Recording':'<i class="fas fa-microphone"></i> Record Voice';};}
  const tab=$('tm_attachBtn');if(tab){const n=tab.cloneNode(true);tab.parentNode.replaceChild(n,tab);n.onclick=()=>$('tm_files')?.click();}
  const tf=$('tm_files');if(tf){const n=tf.cloneNode(true);tf.parentNode.replaceChild(n,tf);n.onchange=e=>{const files=[...(e.target.files||[])].map(f=>({name:f.name,size:f.size,type:f.type}));if(files.length) taskAttachments.push(...files);renderTaskAttachments();e.target.value='';};}
  const tsb=$('tm_save');if(tsb){const n=tsb.cloneNode(true);tsb.parentNode.replaceChild(n,tsb);n.onclick=()=>saveTask(taskId);}
  openM('taskModal');
}

function saveTask(taskId) {
  const assigneeIds=taskAssignees.length?[...taskAssignees]:[currentUser.id];
  const data={title:$('tm_title')?.value.trim(),projectId:+($('tm_project')?.value||0),priority:$('tm_priority')?.value,assigneeId:assigneeIds[0]||null,assigneeIds,dueDate:$('tm_due')?.value,desc:$('tm_desc')?.value.trim(),status:$('tm_status')?.value,attachments:[...taskAttachments]};
  if(!data.title){toast('Title required','error');return;}
  if(taskId){Object.assign(DB.tasks.find(t=>t.id===taskId),data);logAction('update',`Task #${taskId}`,`Updated ${data.title}`);}
  else{DB.tasks.push({id:generateId('tasks'),...data});logAction('create','Task',`Created "${data.title}"`);assigneeIds.forEach(id=>sendEmail(userById(id)?.email||'','New Task Assigned','task_assigned'));}
  closeM('taskModal'); renderKanban(); renderProjectTable(); toast('Task saved','success');
}

function renderGantt() {
  const body=$('ganttBody'); if(!body) return;
  const mSites=getManagedSiteIds();
  const myProjects=DB.projects.filter(p=>mSites.has(p.siteId)||p.createdBy===currentUser.id);
  if(!myProjects.length){body.innerHTML='<div class="empty-state"><i class="fas fa-timeline"></i>No projects</div>';return;}
  const allDates=myProjects.flatMap(p=>[new Date(p.dueDate||new Date())]);
  const minDate=new Date(Math.min(...allDates));minDate.setMonth(minDate.getMonth()-2);
  const maxDate=new Date(Math.max(...allDates));maxDate.setMonth(maxDate.getMonth()+1);
  const totalDays=(maxDate-minDate)/86400000||1;
  const headerDays=Math.min(totalDays,12);
  const monthLabels=[];
  for(let i=0;i<headerDays;i++){const d=new Date(minDate);d.setDate(d.getDate()+i*Math.floor(totalDays/headerDays));monthLabels.push(d.toLocaleString('default',{month:'short'}));}
  body.innerHTML=`<div class="gantt-wrap"><table style="width:100%;border-collapse:collapse;"><thead><tr><th style="width:200px;text-align:left;padding:0.5rem;font-size:0.72rem;color:var(--text3);">Project</th>${monthLabels.map(m=>`<th style="font-size:0.72rem;color:var(--text3);padding:0.25rem;">${m}</th>`).join('')}</tr></thead><tbody>${myProjects.map(p=>{const due=new Date(p.dueDate||new Date()),start=new Date(due);start.setMonth(start.getMonth()-2);const lp=Math.max(0,((start-minDate)/86400000/totalDays)*100),wp=Math.max(5,((due-start)/86400000/totalDays)*100);return`<tr style="border-bottom:1px solid var(--border);"><td style="padding:0.75rem 0.5rem;font-size:0.82rem;font-weight:500;white-space:nowrap;">${p.name.slice(0,25)}</td><td colspan="${headerDays}" style="position:relative;height:40px;"><div style="position:absolute;left:${lp}%;width:${wp}%;top:8px;height:24px;background:rgba(234,179,8,0.75);border-radius:6px;display:flex;align-items:center;padding:0 0.5rem;font-size:0.68rem;font-weight:600;color:#0a0f1a;white-space:nowrap;overflow:hidden;">${p.name.slice(0,20)}</div></td></tr>`;}).join('')}</tbody></table></div>`;
}

/* ============================================================
   19. SHIFT SCHEDULING
   ============================================================ */
const SHIFT_TYPES=['Morning','Afternoon','Night','Off'];
const SHIFT_KEYS =['morning','afternoon','night','off'];

function renderShifts() {
  const siteSel=$('shiftSite'); if(siteSel){const mySites=DB.sites.filter(s=>s.managerId===currentUser.id);siteSel.innerHTML='<option value="">All Sites</option>'+mySites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');}
  populateWeekSelect('shiftWeek');
  renderShiftGrid(); renderShiftSwaps();
  const sp=$('shiftPrev');if(sp){const n=sp.cloneNode(true);sp.parentNode.replaceChild(n,sp);n.addEventListener('click',()=>{shiftWeekOffset--;renderShiftGrid();});}
  const sn=$('shiftNext');if(sn){const n=sn.cloneNode(true);sn.parentNode.replaceChild(n,sn);n.addEventListener('click',()=>{shiftWeekOffset++;renderShiftGrid();});}
  const se=$('shiftExport');if(se){const n=se.cloneNode(true);se.parentNode.replaceChild(n,se);n.addEventListener('click',()=>toast('Shift schedule exported','success'));}
}

function renderShiftGrid() {
  const grid=$('shiftGrid'); if(!grid) return;
  const team=getManagerTeamIds();
  const workers=DB.users.filter(u=>team.has(u.id));
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const d=new Date(); d.setDate(d.getDate()-d.getDay()+1+shiftWeekOffset*7);
  const weekStart=new Date(d);
  const wl=$('shiftWeekLabel'); if(wl) wl.textContent=`Week of ${weekStart.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`;
  const colorMap={morning:'shift-morning',afternoon:'shift-afternoon',night:'shift-night',off:'shift-off'};
  grid.innerHTML=`<thead><tr><th>Worker</th>${days.map((day,i)=>{const dd=new Date(weekStart);dd.setDate(dd.getDate()+i);return`<th>${day}<br><span style="font-size:0.65rem;font-weight:400;">${dd.getDate()}/${dd.getMonth()+1}</span></th>`;}).join('')}</tr></thead><tbody>${workers.map(w=>`<tr><td><div class="user-cell">${avatarEl(w,26)}<span style="font-size:0.8rem;">${w.name}</span></div></td>${days.map(day=>{const key=`${w.id}_${day}_${shiftWeekOffset}`,shift=DB.shifts?.[key]||'off';return`<td class="shift-cell"><select class="shift-badge ${colorMap[shift]}" style="border:none;background:transparent;cursor:pointer;font-size:0.7rem;font-weight:600;" onchange="setShift('${key}',this.value,this)">${SHIFT_KEYS.map(s=>`<option value="${s}"${shift===s?' selected':''}>${SHIFT_TYPES[SHIFT_KEYS.indexOf(s)]}</option>`).join('')}</select></td>`;}).join('')}</tr>`).join('')}</tbody>`;
}

function setShift(key, val, el) {
  if(!DB.shifts) DB.shifts={};
  DB.shifts[key]=val;
  const colorMap={morning:'shift-morning',afternoon:'shift-afternoon',night:'shift-night',off:'shift-off'};
  el.className=`shift-badge ${colorMap[val]}`;
  el.style.border='none'; el.style.background='transparent'; el.style.cursor='pointer'; el.style.fontSize='0.7rem'; el.style.fontWeight='600';
}

function renderShiftSwaps() {
  const tbody=$('shiftSwapTbody'); if(!tbody) return;
  tbody.innerHTML='<tr><td colspan="7"><div class="empty-state"><i class="fas fa-arrows-rotate"></i>No swap requests</div></td></tr>';
}

/* ============================================================
   20. EQUIPMENT & INVENTORY
   ============================================================ */
function renderEquipment() {
  populateEqSelects();
  filterAndUpdateEquipment();
  filterAndUpdateCheckoutRequests();
  const addBtn=$('addEqBtn'); if(addBtn){const n=addBtn.cloneNode(true);addBtn.parentNode.replaceChild(n,addBtn);n.addEventListener('click',()=>openEqModal());}
  const exp=$('eqExport'); if(exp){const n=exp.cloneNode(true);exp.parentNode.replaceChild(n,exp);n.addEventListener('click',()=>exportCSV(DB.equipment,'equipment.csv'));}
  ['eqSearch','eqCondition','eqStatus2'].forEach(id=>{const el=$(id);if(el){const n=el.cloneNode(true);el.parentNode.replaceChild(n,el);n.addEventListener('input',filterAndUpdateEquipment);}});
}

function populateEqSelects() {
  const team=getManagerTeamIds(),mySites=DB.sites.filter(s=>s.managerId===currentUser.id);
  const eqAss=$('eq_assignee'); if(eqAss) eqAss.innerHTML='<option value="">Unassigned</option>'+DB.users.filter(u=>team.has(u.id)).map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  const eqSite=$('eq_site'); if(eqSite) eqSite.innerHTML='<option value="">No Site</option>'+mySites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
}

function filterAndUpdateEquipment() {
  const q=$('eqSearch')?.value.toLowerCase()||'', cond=$('eqCondition')?.value||'', st=$('eqStatus2')?.value||'';
  const team=getManagerTeamIds(),mSites=getManagedSiteIds();
  const filtered=DB.equipment.filter(e=>{
    const visible=(!e.siteId&&!e.assigneeId)||(e.siteId&&mSites.has(e.siteId))||(e.assigneeId&&team.has(e.assigneeId));
    if(!visible) return false;
    if(q&&!e.name.toLowerCase().includes(q)&&!e.serial.toLowerCase().includes(q)) return false;
    if(cond&&e.condition!==cond) return false; if(st&&e.status!==st) return false;
    return true;
  });
  const eqS=$('eqStats');
  if(eqS) eqS.innerHTML=statCard('fa-toolbox','blue',filtered.length,'Total Items','','flat')+statCard('fa-check','green',filtered.filter(e=>e.status==='available').length,'Available','','flat')+statCard('fa-hand-holding','yellow',filtered.filter(e=>e.status==='checked-out').length,'Checked Out','','flat')+statCard('fa-wrench','orange',filtered.filter(e=>e.status==='maintenance').length,'In Maintenance','','flat');
  createPaginator('eqTbody', filtered, renderEquipmentBody, {perPage:10});
}

function renderEquipmentBody(equipment) {
  const tbody=$('eqTbody'); if(!tbody) return;
  if(!equipment.length){tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><i class="fas fa-toolbox"></i>No equipment found</div></td></tr>';return;}
  tbody.innerHTML=equipment.map(e=>{const u=userById(e.assigneeId),s=siteById(e.siteId),sa=e.nextService&&new Date(e.nextService)<new Date()?'color:#f87171;':'',sc=e.status==='available'?'active':e.status==='checked-out'?'in-progress':'on-hold';return`<tr><td style="font-weight:600;">${e.name}</td><td style="font-size:0.78rem;">${e.category}</td><td><div style="display:flex;align-items:center;gap:0.4rem;"><code style="font-size:0.72rem;">${e.serial}</code><button class="abt" onclick="showQR('${e.serial}','${e.name}')" title="QR"><i class="fas fa-qrcode"></i></button></div></td><td>${statusBadge(e.condition||'good')}</td><td>${u?`<div class="user-cell">${avatarEl(u,24)}<span style="font-size:0.8rem;">${u.name}</span></div>`:'<span style="color:var(--text3);">—</span>'}</td><td style="font-size:0.78rem;">${s?.name||'—'}</td><td>${statusBadge(sc)}</td><td style="font-size:0.75rem;${sa}">${fmt(e.nextService)}</td><td><button class="abt warn" onclick="openEqModal(${e.id})"><i class="fas fa-pen"></i></button></td></tr>`;}).join('');
}

function filterAndUpdateCheckoutRequests() {
  const tbody=$('eqReqTbody'); if(!tbody) return;
  tbody.innerHTML='<tr><td colspan="6"><div class="empty-state"><i class="fas fa-hand-holding"></i>No checkout requests</div></td></tr>';
}

function openEqModal(eqId=null) {
  populateEqSelects();
  const e=eqId?DB.equipment.find(x=>x.id===eqId):null;
  if($('eqTitle')) $('eqTitle').textContent=e?'Edit Equipment':'Add Equipment';
  if($('eq_name'))      $('eq_name').value      = e?.name       ||'';
  if($('eq_cat'))       $('eq_cat').value        = e?.category   ||'';
  if($('eq_serial'))    $('eq_serial').value     = e?.serial     ||'';
  if($('eq_condition')) $('eq_condition').value  = e?.condition  ||'good';
  if($('eq_assignee'))  $('eq_assignee').value   = e?.assigneeId ||'';
  if($('eq_site'))      $('eq_site').value       = e?.siteId     ||'';
  if($('eq_service'))   $('eq_service').value    = e?.nextService||'';
  if($('eq_status'))    $('eq_status').value     = e?.status     ||'available';
  const sb=$('eq_save'); if(sb){const n=sb.cloneNode(true);sb.parentNode.replaceChild(n,sb);n.onclick=()=>saveEq(eqId);}
  openM('equipModal');
}

function saveEq(eqId) {
  const data={name:$('eq_name')?.value.trim(),category:$('eq_cat')?.value.trim(),serial:$('eq_serial')?.value.trim(),condition:$('eq_condition')?.value,assigneeId:+($('eq_assignee')?.value||0)||null,siteId:+($('eq_site')?.value||0)||null,nextService:$('eq_service')?.value,status:$('eq_status')?.value};
  if(!data.name){toast('Name required','error');return;}
  if(eqId){Object.assign(DB.equipment.find(e=>e.id===eqId),data);logAction('update','Equipment',`Updated ${data.name}`);}
  else{DB.equipment.push({id:generateId('equipment'),...data});logAction('create','Equipment',`Added ${data.name}`);}
  closeM('equipModal'); filterAndUpdateEquipment(); toast('Equipment saved','success');
}

function deleteEq(id) { toast('Managers cannot delete equipment','warn'); }

function showQR(serial, name) {
  const qb=$('qrBody'); if(qb) qb.innerHTML=`<div style="font-weight:700;margin-bottom:1rem;">${name}</div><div style="font-size:4rem;margin:1rem 0;">📦</div><div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:1.1rem;letter-spacing:3px;">${serial}</div><div style="font-size:0.75rem;color:var(--text3);margin-top:0.5rem;">(QR code would render here in production)</div>`;
  openM('qrModal');
}

/* ============================================================
   21. DOCUMENTS
   ============================================================ */
function renderDocuments() {
  filterAndUpdateDocuments();
  $('uploadDocBtn')?.addEventListener('click',()=>toast('Document upload (demo — connect file server)','info'));
  $('docExport')?.addEventListener('click',()=>exportCSV(DB.documents,'documents.csv'));
  ['docSearch','docUser','docStatus'].forEach(id=>$(id)?.addEventListener('input',filterAndUpdateDocuments));
}

function filterAndUpdateDocuments() {
  const team=getManagerTeamIds();
  /* Populate user select with team only */
  const docUser=$('docUser');
  if(docUser) docUser.innerHTML='<option value="">All Employees</option>'+DB.users.filter(u=>team.has(u.id)).map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  const q=$('docSearch')?.value.toLowerCase()||'', uid=+($('docUser')?.value||0), st=$('docStatus')?.value||'';
  const filtered=DB.documents.filter(d=>{
    if(!team.has(d.userId)) return false;
    if(q&&!d.name.toLowerCase().includes(q)) return false;
    if(uid&&d.userId!==uid) return false;
    if(st==='expiring'){const diff=(new Date(d.expiry)-new Date())/86400000;return diff>=0&&diff<=30;}
    if(st&&d.status!==st) return false;
    return true;
  });
  const approved=filtered.filter(d=>d.status==='approved').length,pending=filtered.filter(d=>d.status==='pending').length,expiring=filtered.filter(d=>{const diff=(new Date(d.expiry)-new Date())/86400000;return diff>=0&&diff<=30;}).length;
  const ds=$('docStats'); if(ds) ds.innerHTML=statCard('fa-folder-open','blue',filtered.length,'Total Docs','','flat')+statCard('fa-check','green',approved,'Approved','','flat')+statCard('fa-hourglass','yellow',pending,'Pending Review','','flat')+statCard('fa-triangle-exclamation','orange',expiring,'Expiring Soon','','flat');
  createPaginator('docTbody', filtered, renderDocTableBody, {perPage:10});
}

function renderDocTableBody(documents) {
  const tbody=$('docTbody'); if(!tbody) return;
  if(!documents.length){tbody.innerHTML='<tr><td colspan="8"><div class="empty-state"><i class="fas fa-folder-open"></i>No documents found for your team</div></td></tr>';return;}
  tbody.innerHTML=documents.map(d=>{const u=userById(d.userId),diff=(new Date(d.expiry)-new Date())/86400000,ec=diff<0?'color:#f87171;':diff<30?'color:#f97316;':'';return`<tr><td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name||'Unknown'}</span></div></td><td style="font-weight:600;">${d.name}</td><td><span class="badge b-update">${d.type}</span></td><td style="font-size:0.75rem;">${fmt(d.uploaded)}</td><td style="font-size:0.75rem;${ec}">${fmt(d.expiry)}${diff<30&&diff>=0?' ⚠️':''}</td><td>${statusBadge(d.status)}</td><td style="font-size:0.75rem;">${d.notes||'—'}</td><td>${d.status==='pending'?`<button class="abt suc" onclick="decideDoc(${d.id},'approved')"><i class="fas fa-check"></i></button><button class="abt dan" onclick="decideDoc(${d.id},'rejected')"><i class="fas fa-times"></i></button>`:''}<button class="abt inf" onclick="previewDoc(${d.id})"><i class="fas fa-eye"></i></button><button class="abt" onclick="requestDoc(${d.userId})"><i class="fas fa-envelope"></i></button></td></tr>`;}).join('');
}

function renderDocTable() { filterAndUpdateDocuments(); }

function decideDoc(id, decision) {
  const d=DB.documents.find(x=>x.id===id); if(!d) return;
  const team=getManagerTeamIds(); if(!team.has(d.userId)){toast('You can only review documents from your team','warn');return;}
  const u=userById(d.userId); d.status=decision;
  logAction(decision==='approved'?'approve':'reject',`Doc #${id}`,`${decision} "${d.name}" for ${u?.name}`);
  sendEmail(u?.email||'',`Document ${decision}`,'doc_decision');
  filterAndUpdateDocuments(); toast(`Document ${decision}`,'success');
}

function requestDoc(userId) {
  const u=userById(userId); if(u?.email){sendEmail(u.email,'Missing Document Request','doc_request');toast(`Document request sent to ${u.name}`,'info');}
  else toast('No email address found','error');
}

function previewDoc(docId) { const d=DB.documents.find(x=>x.id===docId); if(d) toast(`Previewing: ${d.name} (demo)`,'info'); }

/* ============================================================
   22. NOTIFICATIONS
   ============================================================ */
function renderNotifications() {
  renderNotifList();
  $('markAllReadBtn')?.addEventListener('click',()=>{DB.notifications.forEach(n=>n.read=true);renderNotifList();toast('All marked read','success');});
  $('clearNotifBtn')?.addEventListener('click',()=>{if(confirm('Clear all notifications?')){DB.notifications=[];renderNotifList();toast('Notifications cleared','success');}});
  renderNotifPrefs();
  ['notifTypeFilter','notifReadFilter'].forEach(id=>$(id)?.addEventListener('change',renderNotifList));
}

function renderNotifList() {
  const type=$('notifTypeFilter')?.value||'', read=$('notifReadFilter')?.value||'';
  const iconMap={approval:'fa-user-check',task:'fa-list-check',leave:'fa-calendar',system:'fa-server',alert:'fa-triangle-exclamation'};
  const colorMap={approval:'rgba(16,185,129,0.15)',task:'rgba(59,130,246,0.15)',leave:'rgba(234,179,8,0.15)',system:'rgba(100,116,139,0.15)',alert:'rgba(239,68,68,0.15)'};
  const rows=DB.notifications.filter(n=>{if(type&&n.type!==type)return false;if(read==='unread'&&n.read)return false;if(read==='read'&&!n.read)return false;return true;});
  const el=$('notifList'); if(!el) return;
  el.innerHTML=rows.map(n=>`<div class="notif-item${n.read?'':' unread'}" onclick="markNotifRead(${n.id})"><div class="notif-icon" style="background:${colorMap[n.type]||'var(--surface2)'};"><i class="fas ${iconMap[n.type]||'fa-bell'}"></i></div><div class="notif-body"><div class="notif-title">${n.title}</div><div class="notif-desc">${n.desc}</div><div class="notif-time">${n.time}</div></div>${n.read?'':'<div class="notif-unread-dot"></div>'}<button class="abt dan" onclick="deleteNotif(${n.id});event.stopPropagation()"><i class="fas fa-times"></i></button></div>`).join('')||'<div class="empty-state"><i class="fas fa-bell-slash"></i>No notifications</div>';
}

function markNotifRead(id){const n=DB.notifications.find(x=>x.id===id);if(n) n.read=true;renderNotifList();}
function deleteNotif(id){DB.notifications.splice(DB.notifications.findIndex(n=>n.id===id),1);renderNotifList();}

function renderNotifPrefs() {
  const prefs=[{label:'Approval Notifications',key:'approval'},{label:'Task Assignments',key:'task'},{label:'Leave Decisions',key:'leave'},{label:'System Alerts',key:'system'},{label:'Equipment Alerts',key:'alert'}];
  const el=$('notifPrefs'); if(!el) return;
  el.innerHTML=prefs.map(p=>`<div class="sw-row"><div class="sw-info"><div class="sw-label">${p.label}</div></div><label class="sw"><input type="checkbox" checked><span class="sw-sl"></span></label></div>`).join('');
}

/* ============================================================
   23. EMAIL CENTER
   ============================================================ */
function renderEmailCenter() {
  wireETabs();
  filterAndUpdateEmailLog();
  renderEmailTemplates();
  const cs=$('compSendBtn'); if(cs){const n=cs.cloneNode(true);cs.parentNode.replaceChild(n,cs);n.addEventListener('click',sendComposedEmail);}
  const bs=$('bulkSendBtn'); if(bs){const n=bs.cloneNode(true);bs.parentNode.replaceChild(n,bs);n.addEventListener('click',sendBulkEmail);}
  /* Restrict bulk email targets for managers */
  const bt=$('bulkEmailTargets');
  if(bt){['all','admin'].forEach(v=>{const inp=bt.querySelector(`input[value="${v}"]`);if(inp) inp.closest('label')?.remove();});}
}

function wireETabs() {
  const panels={log:'et-log',compose:'et-compose',bulk:'et-bulk'};
  $$('[data-etab]').forEach(btn=>{
    if(btn.dataset.etab==='templates') return; /* hide templates tab for managers */
    const n=btn.cloneNode(true); btn.parentNode.replaceChild(n,btn);
    n.addEventListener('click',()=>{
      $$('[data-etab]').forEach(b=>b.classList.remove('active')); n.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el) el.style.display='none';});
      const target=$(panels[n.dataset.etab]); if(target) target.style.display='';
      if(n.dataset.etab==='log') filterAndUpdateEmailLog();
    });
  });
  /* Hide templates tab button */
  const tplBtn=document.querySelector('[data-etab="templates"]'); if(tplBtn) tplBtn.style.display='none';
}

function filterAndUpdateEmailLog() {
  const st=$('emailLogStatus')?.value||'', q=$('emailLogSearch')?.value.toLowerCase()||'';
  const filtered=DB.emailLog.filter(e=>{
    if(st&&e.status!==st) return false;
    if(q&&!e.to.includes(q)&&!e.subject.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=>new Date(b.sentAt)-new Date(a.sentAt));
  createPaginator('emailLogTbody', filtered, renderEmailLogBody, {perPage:10});
  const els=$('emailLogSearch'); if(els){const n=els.cloneNode(true);els.parentNode.replaceChild(n,els);n.addEventListener('input',filterAndUpdateEmailLog);}
  const elst=$('emailLogStatus'); if(elst){const n=elst.cloneNode(true);elst.parentNode.replaceChild(n,elst);n.addEventListener('change',filterAndUpdateEmailLog);}
}

function renderEmailLogBody(emails) {
  const tbody=$('emailLogTbody'); if(!tbody) return;
  if(!emails.length){tbody.innerHTML='<tr><td colspan="6"><div class="empty-state"><i class="fas fa-inbox"></i>No emails found</div></td></tr>';return;}
  tbody.innerHTML=emails.map(e=>`<tr><td>${e.to}</td><td>${e.subject}</td><td style="font-size:0.75rem;"><code>${e.template}</code></td><td style="font-size:0.75rem;">${e.sentAt}</td><td>${statusBadge(e.status==='sent'?'active':e.status==='failed'?'inactive':'pending')}</td><td><button class="abt inf" onclick="resendEmail(${e.id})"><i class="fas fa-rotate-right"></i></button></td></tr>`).join('');
}

function renderEmailLog() { filterAndUpdateEmailLog(); }

function sendComposedEmail() {
  const to=$('compTo')?.value.trim(), subject=$('compSubject')?.value.trim();
  if(!to||!subject){toast('To and Subject required','error');return;}
  sendEmail(to,subject,'manual'); toast(`Email sent to ${to}`,'success');
  if($('compTo')) $('compTo').value=''; if($('compSubject')) $('compSubject').value=''; if($('compBody')) $('compBody').value='';
  filterAndUpdateEmailLog();
}

function sendBulkEmail() {
  const targets=[...$('bulkEmailTargets').querySelectorAll('input:checked')].map(i=>i.value);
  if(!targets.length){toast('Select at least one group','warn');return;}
  let count=0; targets.forEach(t=>{count+=DB.users.filter(u=>u.role===t).length;});
  toast(`Bulk email queued for ${count} recipients`,'success');
  logAction('create','Email',`Bulk email to: ${targets.join(', ')}`);
  filterAndUpdateEmailLog();
}

function resendEmail(emailId) {
  const email=DB.emailLog.find(e=>e.id===emailId);
  if(email){sendEmail(email.to,email.subject,email.template);toast(`Resending email to ${email.to}`,'info');}
  else toast('Email not found','error');
}

function renderEmailTemplates() {
  const el=$('emailTemplatesList'); if(!el) return;
  const templates=[{id:'welcome_approved',name:'Welcome / Approved',desc:'Sent when a user is approved.'},{id:'leave_decision',name:'Leave Decision',desc:'Sent on leave approve/reject.'},{id:'task_assigned',name:'Task Assigned',desc:'Sent when a task is assigned.'},{id:'payslip',name:'Payslip Ready',desc:'Sent when payslip is generated.'}];
  el.innerHTML=templates.map(t=>`<div class="cat-item" style="margin-bottom:0.5rem;"><i class="fas fa-file-lines" style="color:var(--accent);"></i><div style="flex:1;"><div class="ci-name">${t.name}</div><div style="font-size:0.72rem;color:var(--text3);">${t.desc}</div></div><code style="font-size:0.68rem;color:var(--text3);">${t.id}</code></div>`).join('');
}

/* ============================================================
   24. SAFETY & INCIDENTS
   ============================================================ */
function renderSafety() {
  const PANELS={overview:'st-overview',inductions:'st-inductions','incidents-hazards':'st-incidents-hazards',exports:'st-exports',checklist:'st-checklist',training:'st-training',score:'st-score'};
  Object.values(PANELS).forEach(id=>{const el=$(id);if(el) el.style.display='none';});
  const overviewEl=$(PANELS.overview); if(overviewEl) overviewEl.style.display='';

  $$('[data-stab]').forEach(btn=>{
    const fresh=btn.cloneNode(true); btn.parentNode.replaceChild(fresh,btn);
    fresh.addEventListener('click',()=>{
      $$('[data-stab]').forEach(b=>b.classList.remove('active')); fresh.classList.add('active');
      Object.values(PANELS).forEach(id=>{const el=$(id);if(el) el.style.display='none';});
      const target=$(PANELS[fresh.dataset.stab]); if(target) target.style.display='';
      switch(fresh.dataset.stab){
        case 'overview': renderSafetyOverview(); renderSafetyScores(); break;
        case 'inductions': filterAndUpdateInductions(); break;
        case 'incidents-hazards': filterAndUpdateMergedSafety(); break;
        case 'checklist': renderChecklist(); break;
        case 'training': filterAndUpdateTraining(); break;
        case 'score': renderSafetyScores(); break;
      }
    });
  });

  populateSafetySelects();
  const rBtn=$('reportIncidentBtn'); if(rBtn){const n=rBtn.cloneNode(true);rBtn.parentNode.replaceChild(n,rBtn);n.addEventListener('click',openMergedSafetyModal);}
  $('incExport')?.addEventListener('click',()=>exportCSV((DB.incidents||[]).filter(i=>canViewSafetyItem(i)),'incidents_hazards.csv'));
  $('addTrainingBtn')?.addEventListener('click',()=>toast('Training form — coming soon','info'));
  $('safeRptGenerate')?.addEventListener('click',generateSafetyReport);
  ['incSeverity','incSite','mergedStatusFilter'].forEach(id=>{const el=$(id);if(el){const n=el.cloneNode(true);el.parentNode.replaceChild(n,el);n.addEventListener('change',filterAndUpdateMergedSafety);}});
  ['indSearch','indStatus'].forEach(id=>{const el=$(id);if(el){const n=el.cloneNode(true);el.parentNode.replaceChild(n,el);n.addEventListener('input',filterAndUpdateInductions);}});

  renderSafetyOverview(); renderChecklist(); renderSafetyScores();
  if($('safeRptFrom')&&!$('safeRptFrom').value) $('safeRptFrom').value=new Date().toISOString().slice(0,10);
  if($('safeRptTo')&&!$('safeRptTo').value)     $('safeRptTo').value=new Date().toISOString().slice(0,10);
}

function populateSafetySelects() {
  const mySites=DB.sites.filter(s=>s.managerId===currentUser.id);
  const allOpt='<option value="">All Sites</option>';
  const selOpt='<option value="">Select a site</option>';
  const siteOpts=mySites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  const ids=['incSite','checklistSite','safeActiveSite'];
  ids.forEach(id=>{const el=$(id);if(el) el.innerHTML=(id==='safeActiveSite'?selOpt:allOpt)+siteOpts;});
}

function renderSafetyOverview() {
  const el=$('safeOverviewStats'); if(!el) return;
  const team=getManagerTeamIds(), visible=(DB.incidents||[]).filter(i=>canViewSafetyItem(i));
  el.innerHTML=statCard('fa-users','blue',DB.users.filter(u=>team.has(u.id)&&u.role==='worker').length,'Team Workers','','flat')+statCard('fa-user-check','green',DB.users.filter(u=>team.has(u.id)&&u.status==='active').length,'Active','','flat')+statCard('fa-triangle-exclamation','red',visible.filter(i=>i.status==='open').length,'Open Issues','','flat')+statCard('fa-skull-crossbones','orange',visible.filter(i=>i.severity==='critical').length,'Critical','','flat');
}

function openMergedSafetyModal() {
  if(!$('mergedSafetyModal')) createMergedSafetyModal();
  const siteSelect=$('ms_site');
  if(siteSelect){const mySites=DB.sites.filter(s=>s.managerId===currentUser.id);siteSelect.innerHTML='<option value="">Select Site</option>'+mySites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');if(mySites.length) siteSelect.value=String(mySites[0].id);}
  const di=$('ms_date');if(di) di.value=new Date().toISOString().slice(0,16);
  const ti=$('ms_type');if(ti) ti.value='injury';
  const si=$('ms_severity');if(si) si.value='medium';
  const desc=$('ms_desc');if(desc) desc.value='';
  const acts=$('ms_actions');if(acts) acts.value='';
  openM('mergedSafetyModal');
}

function createMergedSafetyModal() {
  if($('mergedSafetyModal')) return;
  const mySites=DB.sites.filter(s=>s.managerId===currentUser.id);
  const siteOpts=mySites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-ov" id="mergedSafetyModal"><div class="modal-box md"><div class="mhdr"><h4><i class="fas fa-shield-halved"></i> Report Incident / Hazard</h4><button class="xbtn" data-close="mergedSafetyModal"><i class="fas fa-times"></i></button></div><div class="mbody"><div class="frow"><div class="fg"><label class="fl">Date &amp; Time</label><input class="fc" id="ms_date" type="datetime-local"></div><div class="fg"><label class="fl">Site</label><select class="fc" id="ms_site"><option value="">Select Site</option>${siteOpts}</select></div></div><div class="frow"><div class="fg"><label class="fl">Type</label><select class="fc" id="ms_type"><option value="injury">Injury</option><option value="near-miss">Near Miss</option><option value="property">Property Damage</option><option value="hazard">Hazard</option><option value="fire">Fire</option><option value="other">Other</option></select></div><div class="fg"><label class="fl">Severity</label><select class="fc" id="ms_severity"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div></div><div class="fg"><label class="fl">Description</label><textarea class="fc" id="ms_desc" rows="4" placeholder="Describe the incident or hazard in detail..."></textarea></div><div class="fg"><label class="fl">Immediate Actions Taken</label><textarea class="fc" id="ms_actions" rows="2" placeholder="What actions were taken immediately?"></textarea></div></div><div class="mftr"><button class="btn btn-outline" data-close="mergedSafetyModal">Cancel</button><button class="btn btn-accent" id="ms_save"><i class="fas fa-paper-plane"></i> Submit Report</button></div></div></div>`);
  const sb=$('ms_save'); if(sb){const n=sb.cloneNode(true);sb.parentNode.replaceChild(n,sb);n.addEventListener('click',saveMergedSafetyItem);}
}

function saveMergedSafetyItem() {
  const desc=$('ms_desc')?.value.trim(); if(!desc){toast('Description is required','error');return;}
  const siteId=$('ms_site')?.value?+$('ms_site').value:null;
  if(!siteId){toast('Please select a site','error');return;}
  const site=siteById(siteId); if(!site||site.managerId!==currentUser.id){toast('You can only report for sites you manage','warn');return;}
  if(!DB.incidents) DB.incidents=[];
  if(!nextId['incidents']) nextId['incidents']=(DB.incidents.length||0)+1;
  const entry={id:nextId['incidents']++,date:$('ms_date')?.value||nowStr(),siteId,reporterId:currentUser.id,type:$('ms_type')?.value||'other',severity:$('ms_severity')?.value||'medium',desc,actions:$('ms_actions')?.value.trim()||'',status:'open'};
  DB.incidents.unshift(entry);
  logAction('create','Safety Issue',`${entry.severity} ${entry.type} at site #${entry.siteId}`);
  closeM('mergedSafetyModal');
  renderSafetyOverview(); renderSafetyScores(); filterAndUpdateMergedSafety();
  if(entry.severity==='critical') toast('⚠️ Critical alert — administrators notified','warn',4000);
  toast(`${entry.type.charAt(0).toUpperCase()+entry.type.slice(1)} reported successfully`,'success');
}

function filterAndUpdateMergedSafety() {
  const severity=$('incSeverity')?.value||'', siteId=+($('incSite')?.value||0), statusFilter=$('mergedStatusFilter')?.value||'';
  let filtered=(DB.incidents||[]).filter(i=>canViewSafetyItem(i)&&(!severity||i.severity===severity)&&(!siteId||i.siteId===siteId)&&(!statusFilter||i.status===statusFilter));
  filtered.sort((a,b)=>new Date(b.date)-new Date(a.date));
  const ss=$('safetyStats');
  if(ss){const crit=filtered.filter(i=>i.severity==='critical').length,high=filtered.filter(i=>i.severity==='high').length,open=filtered.filter(i=>i.status==='open').length,res=filtered.filter(i=>i.status==='resolved').length;ss.innerHTML=statCard('fa-list','blue',filtered.length,'Total Records','','flat')+statCard('fa-skull-crossbones','red',crit,'Critical','',crit>0?'down':'flat')+statCard('fa-triangle-exclamation','orange',high,'High Severity','','flat')+statCard('fa-folder-open','yellow',open,'Open','','flat')+statCard('fa-check-circle','green',res,'Resolved','','flat');}
  createPaginator('mergedSafetyTbody', filtered, renderMergedSafetyBody, {perPage:10});
}

function renderMergedSafetyBody(incidents) {
  const tbody=$('mergedSafetyTbody'); if(!tbody) return;
  if(!incidents.length){tbody.innerHTML='<tr><td colspan="8"><div class="empty-state"><i class="fas fa-shield-check"></i>No incidents or hazards found</div></td></tr>';return;}
  const typeIcon={injury:'fa-user-injured','near-miss':'fa-eye',property:'fa-building',hazard:'fa-bug',fire:'fa-fire',other:'fa-circle-info'};
  tbody.innerHTML=incidents.map(item=>{const site=siteById(item.siteId),reporter=userById(item.reporterId),icon=typeIcon[item.type]||'fa-circle-info',shortDesc=(item.desc||'').substring(0,60)+((item.desc||'').length>60?'…':'');return`<tr><td style="font-size:0.75rem;white-space:nowrap;">${item.date}</td><td style="font-size:0.8rem;">${site?.name||'—'}</td><td><div class="user-cell">${avatarEl(reporter,24)}<span style="font-size:0.78rem;">${reporter?.name||'System'}</span></div></td><td><span class="badge b-update"><i class="fas ${icon}"></i> ${item.type}</span></td><td>${severityBadge(item.severity)}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem;">${shortDesc}</td><td>${statusBadge(item.status==='open'?'active':'completed')}</td><td><div style="display:flex;gap:0.2rem;">${item.status==='open'?`<button class="abt suc" title="Resolve" onclick="resolveSafetyItem(${item.id})"><i class="fas fa-check"></i></button>`:''}<button class="abt dan" title="Delete" onclick="deleteSafetyItem(${item.id})"><i class="fas fa-trash"></i></button></div></td></tr>`;}).join('');
}

function resolveSafetyItem(id){if(!confirm('Mark this item as resolved?'))return;const item=(DB.incidents||[]).find(x=>x.id===id);if(!item)return;item.status='resolved';item.resolvedAt=nowStr();logAction('update',`Safety Issue #${id}`,`Resolved: ${item.type}`);filterAndUpdateMergedSafety();renderSafetyOverview();renderSafetyScores();toast('Item marked as resolved','success');}
function deleteSafetyItem(id){if(!confirm('⚠️ Permanently delete this record?'))return;const idx=(DB.incidents||[]).findIndex(x=>x.id===id);if(idx>-1){const item=DB.incidents[idx];DB.incidents.splice(idx,1);logAction('delete',`Safety Issue #${id}`,`Deleted: ${item.type}`);}filterAndUpdateMergedSafety();renderSafetyOverview();renderSafetyScores();toast('Record deleted','success');}

function filterAndUpdateInductions() {
  const q=($('indSearch')?.value||'').toLowerCase(),st=$('indStatus')?.value||'';
  const team=getManagerTeamIds(),statusMap=['Inducted','Pending Review','In Progress','Not Started','Expired'];
  const rows=DB.users.filter(u=>team.has(u.id)&&u.role==='worker').map((u,idx)=>({user:u,company:DB.sites.find(s=>(s.workerIds||[]).includes(u.id))?.name||'Main Contractor',status:statusMap[(u.id*7)%statusMap.length],updated:u.registered||nowStr().slice(0,10)})).filter(r=>(!q||r.user.name.toLowerCase().includes(q)||r.company.toLowerCase().includes(q))&&(!st||r.status===st));
  createPaginator('indTbody',rows,data=>{const tbody=$('indTbody');if(!tbody)return;tbody.innerHTML=data.length?data.map(r=>`<tr><td><div class="user-cell">${avatarEl(r.user,26)}<span>${r.user.name}</span></div></td><td>${r.company}</td><td>${statusBadge(r.status==='Inducted'?'active':r.status==='Expired'?'inactive':'pending')}</td><td style="font-size:0.76rem;">${r.updated}</td></tr>`).join(''):'<tr><td colspan="4"><div class="empty-state"><i class="fas fa-id-card"></i>No team members found</div></td></tr>';},{perPage:10});
}

function filterAndUpdateTraining() {
  const team=getManagerTeamIds(),teamWorkerIds=Array.from(team).filter(id=>{const u=userById(id);return u&&u.role==='worker';}),types=['Working at Height','First Aid','Fire Safety','Scaffolding Safety','PPE Training'];
  const trainings=teamWorkerIds.flatMap((uid,idx)=>[{userId:uid,training:types[idx%types.length],completed:nowStr().slice(0,10),expiry:new Date(Date.now()+365*86400000).toISOString().slice(0,10),status:'valid'}]);
  createPaginator('trainingTbody',trainings,data=>{const tbody=$('trainingTbody');if(!tbody)return;tbody.innerHTML=data.length?data.map(t=>{const u=userById(t.userId);return`<tr><td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name}</span></div></td><td>${t.training}</td><td style="font-size:0.75rem;">${fmt(t.completed)}</td><td style="font-size:0.75rem;">${fmt(t.expiry)}</td><td>${statusBadge(t.status==='valid'?'active':'inactive')}</td><td><button class="abt warn" onclick="toast('Edit training (demo)','info')"><i class="fas fa-pen"></i></button></td></tr>`;}).join(''):'<tr><td colspan="6"><div class="empty-state"><i class="fas fa-graduation-cap"></i>No training records found</div></td></tr>';},{perPage:10});
}

function renderChecklist() {
  const el=$('checklistBody'); if(!el) return;
  const items=['All workers have PPE','Emergency exits clear','Scaffolding inspected','Tools accounted for','First aid kit stocked','Hazard zones marked','Morning briefing done'];
  el.innerHTML=`<div style="display:grid;gap:0.75rem;">${items.map((c,i)=>`<div class="sw-row"><div class="sw-info"><div class="sw-label">${c}</div></div><label class="sw"><input type="checkbox" id="chk${i}"><span class="sw-sl"></span></label></div>`).join('')}</div><button class="btn btn-accent btn-sm" style="margin-top:1rem;" onclick="submitChecklist()"><i class="fas fa-save"></i> Submit Checklist</button>`;
}

function submitChecklist() { logAction('create','Checklist','Daily safety checklist submitted'); toast('Checklist submitted','success'); }

function renderSafetyScores() {
  const el=$('safetyScoreBody'); if(!el) return;
  const mySites=DB.sites.filter(s=>s.managerId===currentUser.id);
  if(!mySites.length){el.innerHTML='<div class="empty-state"><i class="fas fa-star"></i>No sites assigned to you</div>';return;}
  el.innerHTML=mySites.map(s=>{const inc=(DB.incidents||[]).filter(i=>i.siteId===s.id),score=Math.max(0,100-inc.filter(i=>i.status==='open').length*15-inc.filter(i=>i.severity==='critical').length*25),color=score>=80?'#34d399':score>=60?'#eab308':'#f87171';return`<div style="display:flex;align-items:center;gap:1rem;padding:0.75rem 0;border-bottom:1px solid var(--border);"><div style="flex:1;font-weight:500;font-size:0.85rem;">${s.name}</div><div style="flex:2;display:flex;align-items:center;gap:0.75rem;"><div class="pb" style="flex:1;height:8px;"><div class="pb-fill" style="width:${score}%;background:${color};"></div></div><div style="font-family:'Space Grotesk',sans-serif;font-weight:700;color:${color};width:36px;text-align:right;">${score}</div></div><div style="font-size:0.72rem;color:var(--text3);width:100px;">${inc.length} incident${inc.length!==1?'s':''}</div></div>`;}).join('');
}

function generateSafetyReport() {
  const type=$('safeRptType')?.value, fmt_=$('safeRptFmt')?.value||'csv';
  if(!type){toast('Select a report type','warn');return;}
  let data=[];
  if(type==='incidents') data=(DB.incidents||[]).filter(i=>canViewSafetyItem(i)).map(i=>({Date:i.date,Site:siteById(i.siteId)?.name||'—',Type:i.type,Severity:i.severity,Status:i.status,Description:i.desc,Reporter:userById(i.reporterId)?.name||'System'}));
  else if(type==='inductions'){const team=getManagerTeamIds(),statusMap=['Inducted','Pending Review','In Progress','Not Started','Expired'];data=DB.users.filter(u=>team.has(u.id)&&u.role==='worker').map((u,idx)=>({Name:u.name,Email:u.email,Status:statusMap[(u.id*7)%statusMap.length],Date:nowStr().slice(0,10)}));}
  if(!data.length){toast('No data to export','warn');return;}
  if(fmt_==='json'){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`safety-${type}.json`;a.click();URL.revokeObjectURL(a.href);}
  else exportCSV(data,`safety-${type}.csv`);
  toast(`Export generated (${fmt_.toUpperCase()})`,'success');
}

/* ============================================================
   25. AUDIT LOG
   ============================================================ */
function renderAuditLog() {
  renderAuditHeatmap();
  filterAndUpdateAuditLog();
  const exp=$('auditExport'); if(exp){const n=exp.cloneNode(true);exp.parentNode.replaceChild(n,exp);n.addEventListener('click',()=>{const team=getManagerTeamIds();exportCSV(DB.auditLog.filter(l=>team.has(l.userId)),'audit_log.csv');});}
  ['auditSearch','auditAction','auditFrom','auditTo'].forEach(id=>{const el=$(id);if(el){const n=el.cloneNode(true);el.parentNode.replaceChild(n,el);n.addEventListener('input',filterAndUpdateAuditLog);}});
  const userSel=$('auditUser');
  if(userSel){const team=getManagerTeamIds();userSel.innerHTML='<option value="">All Users</option>'+DB.users.filter(u=>team.has(u.id)).map(u=>`<option value="${u.id}">${u.name}</option>`).join('');const n=userSel.cloneNode(true);userSel.parentNode.replaceChild(n,userSel);n.addEventListener('change',filterAndUpdateAuditLog);}
}

function filterAndUpdateAuditLog() {
  const team=getManagerTeamIds(), q=$('auditSearch')?.value.toLowerCase()||'', uid=+($('auditUser')?.value||0), action=$('auditAction')?.value||'', from=$('auditFrom')?.value||'', to=$('auditTo')?.value||'';
  const filtered=DB.auditLog.filter(l=>{
    if(!team.has(l.userId)) return false;
    if(q&&!l.details.toLowerCase().includes(q)&&!l.target.toLowerCase().includes(q)) return false;
    if(uid&&l.userId!==uid) return false; if(action&&l.action!==action) return false;
    if(from&&l.time.slice(0,10)<from) return false; if(to&&l.time.slice(0,10)>to) return false;
    return true;
  }).sort((a,b)=>new Date(b.time)-new Date(a.time));
  createPaginator('auditTbody', filtered, renderAuditTableBody, {perPage:10});
}

function renderAuditTableBody(logs) {
  const tbody=$('auditTbody'); if(!tbody) return;
  if(!logs.length){tbody.innerHTML='<tr><td colspan="8"><div class="empty-state"><i class="fas fa-scroll"></i>No log entries found</div></td></tr>';return;}
  tbody.innerHTML=logs.map(l=>{const u=userById(l.userId),bc=l.action==='delete'?'inactive':l.action==='approve'?'active':'update';return`<tr><td style="font-size:0.75rem;white-space:nowrap;">${l.time}</td><td><div class="user-cell">${avatarEl(u,24)}<span style="font-size:0.8rem;">${u?.name||'System'}</span></div></td><td>${roleBadge(u?.role||'worker')}</td><td><span class="badge b-${bc}">${l.action}</span></td><td style="font-size:0.8rem;">${l.target}</td><td style="font-size:0.78rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.details}</td><td><code style="font-size:0.7rem;">${l.ip}</code></td><td>${statusBadge(l.status==='success'?'active':'inactive')}</td></tr>`;}).join('');
}

function renderAuditTable() { filterAndUpdateAuditLog(); }

function renderAuditHeatmap() {
  const el=$('auditHeatmap'); if(!el) return;
  const team=getManagerTeamIds(), counts={};
  DB.auditLog.filter(l=>team.has(l.userId)).forEach(l=>{const d=l.time.slice(0,10);counts[d]=(counts[d]||0)+1;});
  const today=new Date(); let html='<div class="heatmap-grid">';
  for(let i=51;i>=0;i--){for(let j=0;j<7;j++){const d=new Date(today);d.setDate(d.getDate()-(i*7+j));const key=d.toISOString().slice(0,10),n=counts[key]||0,level=n===0?0:n<=1?1:n<=3?2:n<=5?3:4;html+=`<div class="hm-cell hm-l${level}" title="${key}: ${n} actions"></div>`;}}
  html+='</div><div style="font-size:0.72rem;color:var(--text3);margin-top:0.5rem;">Last 52 weeks — each cell = 1 day</div>';
  el.innerHTML=html;
}

/* ============================================================
   26. RBAC  (access denied for managers)
   ============================================================ */
function renderRBAC() {
  const page=$('page-rbac'); if(!page) return;
  page.innerHTML=`<div class="empty-state" style="padding:3rem;text-align:center;"><i class="fas fa-lock" style="font-size:3rem;color:var(--accent);margin-bottom:1rem;"></i><h3 style="margin-bottom:0.5rem;">Access Denied</h3><p style="color:var(--text3);">Only administrators can access RBAC Permissions.</p><button class="btn btn-accent btn-sm" onclick="showPage('dashboard')" style="margin-top:1rem;"><i class="fas fa-arrow-left"></i> Back to Dashboard</button></div>`;
}

/* ============================================================
   27. CLIENT PORTAL
   ============================================================ */
function renderClientPortal() {
  wireCPTabs(); filterAndUpdateClients(); filterAndUpdateTickets(); populateCPSelects();
  const acb=$('addClientBtn'); if(acb){const n=acb.cloneNode(true);acb.parentNode.replaceChild(n,acb);n.addEventListener('click',()=>openClientModal());}
  const atb=$('addTicketBtn'); if(atb){const n=atb.cloneNode(true);atb.parentNode.replaceChild(n,atb);n.addEventListener('click',()=>openTicketModal());}
  const cs=$('clientSearch'); if(cs){const n=cs.cloneNode(true);cs.parentNode.replaceChild(n,cs);n.addEventListener('input',filterAndUpdateClients);}
  ['ticketStatus','ticketClient'].forEach(id=>{const el=$(id);if(el){const n=el.cloneNode(true);el.parentNode.replaceChild(n,el);n.addEventListener('change',filterAndUpdateTickets);}});
}

function wireCPTabs() {
  const panels={clients:'cp-clients',tickets:'cp-tickets'};
  $$('[data-cptab]').forEach(btn=>{const n=btn.cloneNode(true);btn.parentNode.replaceChild(n,btn);n.addEventListener('click',()=>{$$('[data-cptab]').forEach(b=>b.classList.remove('active'));n.classList.add('active');Object.values(panels).forEach(id=>{const el=$(id);if(el) el.style.display='none';});const target=$(panels[n.dataset.cptab]);if(target) target.style.display='';if(n.dataset.cptab==='clients') filterAndUpdateClients();if(n.dataset.cptab==='tickets') filterAndUpdateTickets();});});
}

function populateCPSelects() {
  const mSites=getManagedSiteIds();
  const myClients=DB.clients.filter(c=>(c.siteIds||[]).some(id=>mSites.has(id)));
  const tkc=$('tk_client'); if(tkc) tkc.innerHTML=myClients.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const tka=$('tk_assignee'); if(tka) tka.innerHTML=DB.users.filter(u=>getManagerTeamIds().has(u.id)).map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  const tcc=$('ticketClient'); if(tcc) tcc.innerHTML='<option value="">All Clients</option>'+myClients.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const cls=$('cl_sitesCheck'); if(cls){const mySites=DB.sites.filter(s=>s.managerId===currentUser.id);cls.innerHTML=mySites.map(s=>`<label style="display:flex;align-items:center;gap:0.35rem;font-size:0.82rem;"><input type="checkbox" value="${s.id}"> ${s.name}</label>`).join('');}
}

function filterAndUpdateClients() {
  const mSites=getManagedSiteIds(), q=$('clientSearch')?.value.toLowerCase()||'';
  const myClients=DB.clients.filter(c=>(c.siteIds||[]).some(id=>mSites.has(id))&&(!q||c.name.toLowerCase().includes(q)||c.contact.toLowerCase().includes(q)));
  createPaginator('clientTbody', myClients, renderClientTableBody, {perPage:10});
}

function renderClientTableBody(clients) {
  const tbody=$('clientTbody'); if(!tbody) return;
  if(!clients.length){tbody.innerHTML='<tr><td colspan="7"><div class="empty-state"><i class="fas fa-briefcase"></i>No clients found</div></td></tr>';return;}
  tbody.innerHTML=clients.map(c=>`<tr><td style="font-weight:600;">${c.name}</td><td>${c.contact}</td><td>${c.email}</td><td style="font-size:0.78rem;">${(c.siteIds||[]).map(id=>siteById(id)?.name).filter(Boolean).join(', ')||'None'}</td><td>${DB.tickets.filter(t=>t.clientId===c.id).length}</td><td>${statusBadge(c.status)}</td><td><button class="abt warn" onclick="openClientModal(${c.id})"><i class="fas fa-pen"></i></button></td></tr>`).join('');
}

function renderClientTable() { filterAndUpdateClients(); }

function openClientModal(clientId=null) {
  populateCPSelects();
  const c=clientId?DB.clients.find(x=>x.id===clientId):null;
  if($('clientTitle')) $('clientTitle').textContent=c?'Edit Client':'Add Client';
  if($('cl_name'))    $('cl_name').value    = c?.name   ||'';
  if($('cl_contact')) $('cl_contact').value = c?.contact||'';
  if($('cl_email'))   $('cl_email').value   = c?.email  ||'';
  if($('cl_phone'))   $('cl_phone').value   = c?.phone  ||'';
  if(c) $('cl_sitesCheck')?.querySelectorAll('input').forEach(cb=>{cb.checked=(c.siteIds||[]).includes(+cb.value);});
  const sb=$('cl_save'); if(sb){const n=sb.cloneNode(true);sb.parentNode.replaceChild(n,sb);n.onclick=()=>saveClient(clientId);}
  openM('clientModal');
}

function saveClient(clientId) {
  const data={name:$('cl_name')?.value.trim(),contact:$('cl_contact')?.value.trim(),email:$('cl_email')?.value.trim(),phone:$('cl_phone')?.value.trim(),siteIds:[...$('cl_sitesCheck').querySelectorAll('input:checked')].map(i=>+i.value),status:'active'};
  if(!data.name){toast('Name required','error');return;}
  if(clientId) Object.assign(DB.clients.find(c=>c.id===clientId),data);
  else DB.clients.push({id:generateId('clients'),...data});
  closeM('clientModal'); filterAndUpdateClients(); toast('Client saved','success');
}

function deleteClient(id) { toast('Only administrators can delete clients','warn'); }

function filterAndUpdateTickets() {
  const mSites=getManagedSiteIds(), myClientIds=new Set(DB.clients.filter(c=>(c.siteIds||[]).some(id=>mSites.has(id))).map(c=>c.id));
  const st=$('ticketStatus')?.value||'', cid=+($('ticketClient')?.value||0);
  const filtered=(DB.tickets||[]).filter(t=>{if(!myClientIds.has(t.clientId)) return false;if(st&&t.status!==st) return false;if(cid&&t.clientId!==cid) return false;return true;}).sort((a,b)=>new Date(b.created)-new Date(a.created));
  createPaginator('ticketTbody', filtered, renderTicketTableBody, {perPage:10});
}

function renderTicketTableBody(tickets) {
  const tbody=$('ticketTbody'); if(!tbody) return;
  if(!tickets.length){tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><i class="fas fa-ticket"></i>No tickets found</div></td></tr>';return;}
  tbody.innerHTML=tickets.map(t=>{const c=DB.clients.find(x=>x.id===t.clientId),a=userById(t.assigneeId),sc=t.status==='open'?'active':t.status==='in-progress'?'in-progress':'completed';return`<tr><td style="font-family:'Space Grotesk',sans-serif;font-weight:700;">#${String(t.id).padStart(4,'0')}</td><td>${c?.name||'—'}</td><td style="font-weight:500;">${t.subject}</td><td>${priorityBadge(t.priority)}</td><td><div class="user-cell">${avatarEl(a,24)}<span style="font-size:0.78rem;">${a?.name||'—'}</span></div></td><td style="font-size:0.75rem;">${fmt(t.created)}</td><td style="font-size:0.75rem;">${fmt(t.updated)}</td><td>${statusBadge(sc)}</td><td><button class="abt warn" onclick="openTicketModal(${t.id})"><i class="fas fa-pen"></i></button></td></tr>`;}).join('');
}

function renderTicketTable() { filterAndUpdateTickets(); }

function openTicketModal(ticketId=null) {
  populateCPSelects();
  const t=ticketId?(DB.tickets||[]).find(x=>x.id===ticketId):null;
  if($('ticketTitle')) $('ticketTitle').textContent=t?'Edit Ticket':'New Ticket';
  if($('tk_client'))   $('tk_client').value   = t?.clientId  ||(DB.clients[0]?.id||'');
  if($('tk_priority')) $('tk_priority').value = t?.priority  ||'medium';
  if($('tk_subject'))  $('tk_subject').value  = t?.subject   ||'';
  if($('tk_desc'))     $('tk_desc').value     = t?.desc      ||'';
  if($('tk_assignee')) $('tk_assignee').value = t?.assigneeId||'';
  const sb=$('tk_save'); if(sb){const n=sb.cloneNode(true);sb.parentNode.replaceChild(n,sb);n.onclick=()=>saveTicket(ticketId);}
  openM('ticketModal');
}

function saveTicket(ticketId) {
  const data={clientId:+($('tk_client')?.value||0),priority:$('tk_priority')?.value,subject:$('tk_subject')?.value.trim(),desc:$('tk_desc')?.value.trim(),assigneeId:+($('tk_assignee')?.value||0),status:'open',created:nowStr().slice(0,10),updated:nowStr().slice(0,10)};
  if(!data.subject){toast('Subject required','error');return;}
  if(!DB.tickets) DB.tickets=[];
  if(ticketId) Object.assign(DB.tickets.find(t=>t.id===ticketId),{...data,updated:nowStr().slice(0,10)});
  else{DB.tickets.push({id:generateId('tickets'),...data});logAction('create',`Ticket #${nextId.tickets-1}`,'Created for client');}
  closeM('ticketModal'); filterAndUpdateTickets(); toast('Ticket saved','success');
}

function deleteTicket(id) { toast('Only administrators can delete tickets','warn'); }

/* ============================================================
   28. REPORTS
   ============================================================ */
function renderReports() {
  const rg=$('rptGenerate'); if(rg){const n=rg.cloneNode(true);rg.parentNode.replaceChild(n,rg);n.addEventListener('click',generateReport);}
  const re=$('rptExport'); if(re){const n=re.cloneNode(true);re.parentNode.replaceChild(n,re);n.addEventListener('click',()=>{const cd=window.currentReportData;if(cd?.length){exportCSV(cd,'report.csv');toast('Report exported to CSV','success');}else toast('No data to export','warn');});}
  const rp=$('rptPrint'); if(rp){const n=rp.cloneNode(true);rp.parentNode.replaceChild(n,rp);n.addEventListener('click',()=>window.print());}
}

function generateReport() {
  const type=$('rptType')?.value, output=$('rptOutput'); if(!output) return;
  const team=getManagerTeamIds(), mSites=getManagedSiteIds();
  const reports={
    leave:     ()=>{const data=DB.leaveRequests.filter(l=>team.has(l.userId)).map(l=>({User:userById(l.userId)?.name,Type:l.type,From:l.from,To:l.to,Days:l.days,Status:l.status}));return{data,title:'Leave Summary'};},
    documents: ()=>{const data=DB.users.filter(u=>team.has(u.id)).map(u=>({User:u.name,Docs:DB.documents.filter(d=>d.userId===u.id).length,Approved:DB.documents.filter(d=>d.userId===u.id&&d.status==='approved').length,Pending:DB.documents.filter(d=>d.userId===u.id&&d.status==='pending').length}));return{data,title:'Document Completion'};},
    activity:  ()=>{const data=DB.auditLog.filter(l=>team.has(l.userId)).map(l=>({Time:l.time,User:userById(l.userId)?.name,Action:l.action,Target:l.target,Details:l.details}));return{data,title:'User Activity'};},
    payroll:   ()=>{const data=DB.payroll.filter(p=>team.has(p.userId)).map(p=>({Employee:userById(p.userId)?.name,Base:fmtMoney(p.baseSalary),Overtime:fmtMoney(p.overtime),Bonus:fmtMoney(p.bonus),Deductions:fmtMoney(p.deductions),Net:fmtMoney(netPay(p)),Status:p.status}));return{data,title:'Payroll Summary'};},
    tasks:     ()=>{const myTasks=DB.tasks.filter(t=>taskAssigneeIds(t).some(id=>team.has(id)));const data=myTasks.map(t=>({Task:t.title,Project:projectById(t.projectId)?.name,Assignee:userById(t.assigneeId)?.name,Status:t.status,Priority:t.priority,DueDate:fmt(t.dueDate)}));return{data,title:'Task Completion'};},
    safety:    ()=>{const data=(DB.incidents||[]).filter(i=>canViewSafetyItem(i)).map(i=>({Date:i.date,Site:siteById(i.siteId)?.name,Severity:i.severity,Type:i.type,Status:i.status==='open'?'Open':'Resolved',Description:i.desc}));return{data,title:'Safety Incidents'};},
  };
  const report=reports[type]?.();
  if(report?.data.length){window.currentReportData=report.data;displayReportWithPagination(report.data,report.title,output);}
  else{output.innerHTML='<div class="empty-state"><i class="fas fa-chart-bar"></i>No data available for this report</div>';window.currentReportData=[];}
}

function displayReportWithPagination(data, title, container) {
  if(!data.length){container.innerHTML='<div class="empty-state">No data</div>';return;}
  const keys=Object.keys(data[0]);
  container.innerHTML=`<div style="font-family:'Space Grotesk',sans-serif;font-weight:700;margin-bottom:1rem;">${title}</div><div style="overflow-x:auto;"><table class="dt" id="reportTable"><thead><tr>${keys.map(k=>`<th>${k}</th>`).join('')}</tr></thead><tbody id="reportTbody"></tbody></table></div>`;
  createPaginator('reportTbody',data,pd=>{const tbody=$('reportTbody');if(!tbody)return;tbody.innerHTML=pd.map(row=>`<tr>${keys.map(k=>`<td>${row[k]||'—'}</td>`).join('')}</tr>`).join('');},{perPage:10});
}

/* ============================================================
   29. SETTINGS  (manager: password change only)
   ============================================================ */
function renderSettings() {
  wireSettingsTabs();
  loadSettingsValues();
  wireSettingsEvents();
  applyManagerSettingsRestrictions();
}

function wireSettingsTabs() {
  const restricted=['emailjs','company','leave-policy','data'];
  const panels={general:'set-general',security:'set-security',appearance:'set-appearance',emailjs:'set-emailjs',company:'set-company','leave-policy':'set-leave-policy',data:'set-data'};
  $$('[data-settab]').forEach(btn=>{
    if(restricted.includes(btn.dataset.settab)){btn.style.display='none';return;}
    const n=btn.cloneNode(true); btn.parentNode.replaceChild(n,btn);
    n.addEventListener('click',()=>{
      $$('[data-settab]').forEach(b=>b.classList.remove('active')); n.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el) el.style.display='none';});
      const target=$(panels[n.dataset.settab]); if(target) target.style.display='';
    });
  });
}

function loadSettingsValues() {
  const s=DB.settings;
  const set=(id,val)=>{const el=$(id);if(!el)return;if(el.type==='checkbox') el.checked=val;else el.value=val;};
  set('sysName',s.systemName); set('sysTz',s.timezone); set('sysDateFmt',s.dateFormat); set('sysCurrency',s.currency||'USD'); set('currencyPosition',s.currencyPosition||'before');
  set('swEmail',s.emailNotif); set('swSms',s.smsAlerts); set('swPush',s.pushNotif); set('swMaintenance',s.maintenanceMode);
  set('workStart',s.workStart); set('workEnd',s.workEnd);
  set('sesTimeout',s.sessionTimeout); set('maxLogin',s.maxLoginAttempts); set('pwdLen',s.passwordMinLen);
  set('sw2fa',s.twoFactor); set('swIp',s.ipWhitelist); set('swAudit',s.auditLogging);
  set('swCompact',s.compactMode); set('swAnims',s.animations);
  set('coName',s.companyName); set('coAddr',s.companyAddress); set('coPhone',s.companyPhone); set('coEmail',s.companyEmail); set('coWeb',s.companyWeb);
}

function wireSettingsEvents() {
  /* Save btn disabled for managers */
  const sb=$('saveSettingsBtn'); if(sb){sb.disabled=true;sb.style.opacity='0.5';sb.title='Only administrators can save system settings';}
  /* Color swatches allowed for personal accent */
  $$('#colorSwatches .color-sw').forEach(sw=>{const n=sw.cloneNode(true);sw.parentNode.replaceChild(n,sw);n.addEventListener('click',()=>{$$('#colorSwatches .color-sw').forEach(s=>s.classList.remove('sel'));n.classList.add('sel');setAccentColor(n.dataset.color);});});
  /* Template preview */
  const tps=$('tplPreviewSelect'); if(tps){const n=tps.cloneNode(true);tps.parentNode.replaceChild(n,tps);n.addEventListener('change',updateTplPreview);} updateTplPreview();
  /* Password change */
  const cpb=$('changePasswordBtn'); if(cpb){const n=cpb.cloneNode(true);cpb.parentNode.replaceChild(n,cpb);n.addEventListener('click',changePassword);}
  const rpl=$('resetPasswordLinkBtn'); if(rpl){const n=rpl.cloneNode(true);rpl.parentNode.replaceChild(n,rpl);n.addEventListener('click',sendPasswordResetLink);}
  const np=$('newPassword'); if(np){const n=np.cloneNode(true);np.parentNode.replaceChild(n,np);n.addEventListener('input',checkPasswordStrength);}
}

function applyManagerSettingsRestrictions() {
  const restrictedFields=['sysName','sysTz','sysDateFmt','sysCurrency','currencyPosition','workStart','workEnd','sesTimeout','maxLogin','pwdLen','sw2fa','swIp','swAudit','swEmail','swSms','swPush','swMaintenance','swCompact','swAnims'];
  restrictedFields.forEach(id=>{const el=$(id);if(!el) return;el.disabled=true;el.style.opacity='0.6';el.style.cursor='not-allowed';});
  /* Remove any old banners */
  document.querySelectorAll('.mgr-settings-banner').forEach(b=>b.remove());
  /* Add info banner to general settings */
  const genEl=$('set-general');
  if(genEl){const banner=document.createElement('div');banner.className='mgr-settings-banner';banner.style.cssText='background:rgba(234,179,8,0.1);border-left:4px solid var(--accent);padding:0.75rem 1rem;margin-bottom:1.5rem;border-radius:8px;display:flex;align-items:center;gap:0.75rem;';banner.innerHTML='<i class="fas fa-lock" style="color:var(--accent);font-size:1rem;"></i><div style="flex:1;font-size:0.8rem;color:var(--text2);"><strong style="color:var(--accent);">Manager View Mode</strong><br>System settings are read-only. You can change your password in the Security tab.</div>';genEl.insertBefore(banner,genEl.firstChild);}
  /* Ensure password fields are enabled */
  ['currentPassword','newPassword','confirmPassword','changePasswordBtn','resetPasswordLinkBtn'].forEach(id=>{const el=$(id);if(el){el.disabled=false;el.style.opacity='1';el.style.cursor=el.tagName==='BUTTON'?'pointer':'text';}});
}

function setAccentColor(color){document.documentElement.style.setProperty('--accent',color);if(DB.settings) DB.settings.accentColor=color;toast('Accent color updated','success');}

function updateTplPreview() {
  const type=$('tplPreviewSelect')?.value||'welcome';
  const previews={welcome:`<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Welcome to Nixers Pro<br><br>Dear <strong>{name}</strong>,<br><br>Your account has been approved.<br><br>Best regards,<br>Nixers Admin Team</div>`,leave:`<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Leave Request Update<br><br>Dear <strong>{name}</strong>,<br><br>Your leave request has been <strong>{status}</strong>.<br><br>Regards,<br>HR Team</div>`,task:`<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> New Task Assigned<br><br>Hi <strong>{name}</strong>,<br><br>You have been assigned: <strong>{task_title}</strong><br><br>Thanks,<br>Nixers Team</div>`,payslip:`<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Your Payslip is Ready<br><br>Dear <strong>{name}</strong>,<br>Net Pay: <strong>{net_pay}</strong><br><br>Payroll Team</div>`};
  const el=$('tplPreviewBox'); if(el) el.innerHTML=previews[type]||'Select a template';
}

function changePassword() {
  const current=$('currentPassword')?.value, newPw=$('newPassword')?.value, confirm=$('confirmPassword')?.value;
  if(!current){toast('Please enter current password','error');return;}
  if(!newPw){toast('Please enter new password','error');return;}
  const minLen=DB.settings?.passwordMinLen||8;
  if(newPw.length<minLen){toast(`Password must be at least ${minLen} characters`,'error');return;}
  if(newPw!==confirm){toast('New passwords do not match','error');return;}
  const stored=DB.settings?.userPassword||'admin123';
  if(current!==stored){toast('Current password is incorrect','error');return;}
  if(DB.settings) DB.settings.userPassword=newPw;
  logAction('update','Password',`${currentUser.name} changed their password`);
  const cp=$('currentPassword');if(cp) cp.value=''; const np=$('newPassword');if(np) np.value=''; const cfp=$('confirmPassword');if(cfp) cfp.value='';
  const ps=$('passwordStrength');if(ps) ps.innerHTML='';
  toast('Password changed successfully','success');
}

function sendPasswordResetLink() {
  const email=currentUser?.email||DB.settings?.companyEmail;
  if(!email){toast('No email address found','error');return;}
  sendEmail(email,'Password Reset Request','password_reset');
  toast(`Password reset link sent to ${email}`,'success');
  logAction('request','Password Reset',`Reset link sent to ${email}`);
}

function checkPasswordStrength() {
  const pw=$('newPassword')?.value||'', el=$('passwordStrength'); if(!el) return;
  if(!pw.length){el.innerHTML='';return;}
  let s=0;
  if(pw.length>=8)s++;if(pw.length>=12)s++;if(/\d/.test(pw))s++;if(/[A-Z]/.test(pw))s++;if(/[a-z]/.test(pw))s++;if(/[^A-Za-z0-9]/.test(pw))s++;
  const msg=s<=2?'Weak':s<=4?'Medium':'Strong', color=s<=2?'#f87171':s<=4?'#f97316':'#34d399';
  el.innerHTML=`<div style="display:flex;align-items:center;gap:0.5rem;"><div style="flex:1;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;"><div style="width:${(s/6)*100}%;height:100%;background:${color};border-radius:2px;"></div></div><span style="color:${color};">${msg} password</span></div>`;
}

/* ============================================================
   30. MANAGER INIT  (after dashboard.js initDashboard has run)
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  /* dashboard.js initDashboard() runs first via its own DOMContentLoaded listener */
  /* Manager-specific boot: */
  window.currentUser = currentUser;    /* ensure dashboard.js sees manager as current user */
  updateTopbarAvatar();                /* refresh avatar with manager's data */

  /* Restrict navigation */
  const rbacNav = document.querySelector('[data-page="rbac"]');
  if (rbacNav) rbacNav.style.display = 'none';

  logAction('login', 'system', `${currentUser.name} logged in`);
  showPage('dashboard');

  console.log('%c NIXERS PRO MANAGER %c v2.0 ',
    'background:#3b82f6;color:#fff;font-weight:800;padding:4px 8px;border-radius:4px 0 0 4px;',
    'background:#111827;color:#3b82f6;font-weight:600;padding:4px 8px;border-radius:0 4px 4px 0;');
});
