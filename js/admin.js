/* ============================================================
   NIXERS PRO — admin.js
   Full admin console logic
   ============================================================ */

'use strict';

/* ============================================================
   1. DATA STORE
   ============================================================ */
const DB = window.APP_DATA?.DB;
if (!DB) {
  throw new Error('Missing shared data store. Load js/data.js before js/admin.js');
}

/* next IDs */
const nextId = {};
['users','sites','categories','posts','groups','leaveRequests','holidays','timesheets','payroll','projects','tasks','equipment','incidents','documents','notifications','emailLog','auditLog','clients','tickets'].forEach(k => {
  nextId[k] = (DB[k]?.length || 0) + 1;
});

let currentUser = DB.users[0];
let impersonating = null;
let currentGroup = null;
let currentSite = null;
let chartInstances = {};
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
   2. UTILITIES
   ============================================================ */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function userById(id)     { return DB.users.find(u => u.id === id); }
function siteById(id)     { return DB.sites.find(s => s.id === id); }
function catById(id)      { return DB.categories.find(c => c.id === id); }
function projectById(id)  { return DB.projects.find(p => p.id === id); }
function taskAssigneeIds(task) {
  if (!task) return [];
  if (Array.isArray(task.assigneeIds) && task.assigneeIds.length) return task.assigneeIds.map(Number).filter(Boolean);
  return task.assigneeId ? [Number(task.assigneeId)] : [];
}
function fmt(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d)) return date;
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}

function fmtMoney(n) { return '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
}

function avatarEl(user, size=34) {
  const u = typeof user === 'number' ? userById(user) : user;
  if (!u) return `<div class="u-av" style="width:${size}px;height:${size}px;background:#334155;color:#94a3b8;">${'?'}</div>`;
  const bg = u.avatarColor || '#eab308';
  const img = u.avatarImg ? `<img src="${u.avatarImg}" alt="">` : '';
  return `<div class="u-av" style="width:${size}px;height:${size}px;background:${img?'transparent':bg+'22'};color:${bg};font-size:${size*0.35}px;">${img || initials(u.name)}</div>`;
}

function roleBadge(role) {
  const map = {admin:'b-admin',manager:'b-manager',worker:'b-worker'};
  return `<span class="badge ${map[role]||''}">${role}</span>`;
}

function statusBadge(s) {
  return `<span class="badge b-${s}">${s.replace(/-/g,' ')}</span>`;
}

function severityBadge(s) {
  const map = {critical:'b-critical',high:'b-high',medium:'b-medium',low:'b-low'};
  return `<span class="badge ${map[s]||'b-low'}">${s}</span>`;
}

function priorityBadge(p) { return severityBadge(p); }

function onlineDot(user) {
  const u = typeof user === 'number' ? userById(user) : user;
  const st = u?.online || 'offline';
  return `<span class="online-dot ${st}" title="${st}"></span>`;
}

function generateId(key) { return nextId[key]++; }

function logAction(action, target, details) {
  DB.auditLog.unshift({ id: generateId('auditLog'), time: nowStr(), userId: currentUser.id, action, target, details, ip:'127.0.0.1', status:'success' });
}

function nowStr() {
  return new Date().toISOString().slice(0,16).replace('T',' ');
}

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

function makeChart(id, config) {
  destroyChart(id);
  const el = $(id);
  if (!el) return;
  chartInstances[id] = new Chart(el.getContext('2d'), config);
  return chartInstances[id];
}

function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
function chartTextColor() { return isDark() ? '#94a3b8' : '#64748b'; }
function chartGridColor()  { return isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'; }

function chartDefaults() {
  return {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ labels:{ color:chartTextColor(), font:{family:'DM Sans',size:11} } } },
    scales:{
      x:{ ticks:{ color:chartTextColor() }, grid:{ color:chartGridColor() } },
      y:{ ticks:{ color:chartTextColor() }, grid:{ color:chartGridColor() } },
    }
  };
}

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(','), ...rows.map(r => keys.map(k => JSON.stringify(r[k]??'')).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}

/* ============================================================
   3. TOAST
   ============================================================ */
function toast(msg, type='info', duration=3000) {
  const icons = { success:'fa-check-circle', error:'fa-circle-xmark', info:'fa-circle-info', warn:'fa-triangle-exclamation' };
  const colors = { success:'#34d399', error:'#f87171', info:'#60a5fa', warn:'#eab308' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas ${icons[type]||'fa-circle-info'}" style="color:${colors[type]};font-size:1rem;flex-shrink:0;"></i><span>${msg}</span>`;
  $('toastWrap').appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(100%)'; t.style.transition='0.3s'; setTimeout(() => t.remove(), 300); }, duration);
}

/* ============================================================
   4. MODAL HELPERS
   ============================================================ */
function openM(id) { const el=$(id); if(el){ el.classList.add('open'); } }
function closeM(id) { const el=$(id); if(el){ el.classList.remove('open'); } }

/* Auto-wire all [data-close] buttons */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-close]');
  if (btn) closeM(btn.dataset.close);
  /* close modals on overlay click */
  if (e.target.classList.contains('modal-ov')) closeM(e.target.id);
  /* close profile dropdown */
  if (!e.target.closest('#topAvatar') && !e.target.closest('#profileDropdown')) {
    $('profileDropdown')?.classList.remove('open');
  }
});

/* ============================================================
   PAGINATION SYSTEM
   ============================================================ */
class Paginator {
  constructor(data, containerId, renderFn, options = {}) {
    this.data = data;
    this.containerId = containerId;
    this.renderFn = renderFn;
    this.currentPage = 1;
    this.perPage = options.perPage || 10;
    this.perPageOptions = options.perPageOptions || [10, 20, 50, 100, 200];
    this.onPageChange = options.onPageChange || null;
    this.init();
  }
  
  init() {
    this.render();
  }
  
  getTotalPages() {
    return Math.ceil(this.data.length / this.perPage);
  }
  
  getCurrentPageData() {
    const start = (this.currentPage - 1) * this.perPage;
    const end = start + this.perPage;
    return this.data.slice(start, end);
  }
  
  changePage(page) {
    if (page < 1 || page > this.getTotalPages()) return;
    this.currentPage = page;
    this.render();
    if (this.onPageChange) this.onPageChange(this.getCurrentPageData(), this.currentPage);
  }
  
  changePerPage(perPage) {
    this.perPage = perPage;
    this.currentPage = 1;
    this.render();
    if (this.onPageChange) this.onPageChange(this.getCurrentPageData(), this.currentPage);
  }
  
  render() {
    const container = $(this.containerId);
    if (!container) return;
    
    const currentData = this.getCurrentPageData();
    const totalPages = this.getTotalPages();
    const start = (this.currentPage - 1) * this.perPage + 1;
    const end = Math.min(this.currentPage * this.perPage, this.data.length);
    
    // Render the table body
    this.renderFn(currentData);
    
    // Generate pagination HTML
    const paginationHtml = `
      <div class="pagination-container">
        <div class="pagination-info">
          Showing ${start} to ${end} of ${this.data.length} entries
        </div>
        <div class="pagination-controls">
          <select class="per-page-select" id="perPage-${this.containerId}">
            ${this.perPageOptions.map(opt => `<option value="${opt}" ${this.perPage === opt ? 'selected' : ''}>${opt} per page</option>`).join('')}
          </select>
          <button class="pagination-btn" id="firstPage-${this.containerId}" ${this.currentPage === 1 ? 'disabled' : ''}>
            <i class="fas fa-angle-double-left"></i>
          </button>
          <button class="pagination-btn" id="prevPage-${this.containerId}" ${this.currentPage === 1 ? 'disabled' : ''}>
            <i class="fas fa-angle-left"></i>
          </button>
          <div class="pagination-numbers" id="pageNumbers-${this.containerId}">
            ${this.generatePageNumbers(totalPages)}
          </div>
          <button class="pagination-btn" id="nextPage-${this.containerId}" ${this.currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}>
            <i class="fas fa-angle-right"></i>
          </button>
          <button class="pagination-btn" id="lastPage-${this.containerId}" ${this.currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}>
            <i class="fas fa-angle-double-right"></i>
          </button>
        </div>
      </div>
    `;
    
    // Add pagination after the table
    const tableWrapper = container.closest('.panel') || container.parentElement;
    let paginationDiv = document.getElementById(`pagination-${this.containerId}`);
    
    if (!paginationDiv) {
      paginationDiv = document.createElement('div');
      paginationDiv.id = `pagination-${this.containerId}`;
      tableWrapper.appendChild(paginationDiv);
    }
    
    paginationDiv.innerHTML = paginationHtml;
    
    // Bind events
    $(`perPage-${this.containerId}`)?.addEventListener('change', (e) => {
      this.changePerPage(parseInt(e.target.value));
    });
    
    $(`firstPage-${this.containerId}`)?.addEventListener('click', () => this.changePage(1));
    $(`prevPage-${this.containerId}`)?.addEventListener('click', () => this.changePage(this.currentPage - 1));
    $(`nextPage-${this.containerId}`)?.addEventListener('click', () => this.changePage(this.currentPage + 1));
    $(`lastPage-${this.containerId}`)?.addEventListener('click', () => this.changePage(totalPages));
    
    // Bind page number clicks
    document.querySelectorAll(`#pageNumbers-${this.containerId} .page-number`).forEach(btn => {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.dataset.page);
        if (page) this.changePage(page);
      });
    });
  }
  
  generatePageNumbers(totalPages) {
    if (totalPages <= 1) return '';
    
    let pages = [];
    let start = Math.max(1, this.currentPage - 2);
    let end = Math.min(totalPages, this.currentPage + 2);
    
    if (start > 1) {
      pages.push(`<div class="page-number" data-page="1">1</div>`);
      if (start > 2) pages.push(`<div class="page-number disabled">...</div>`);
    }
    
    for (let i = start; i <= end; i++) {
      pages.push(`<div class="page-number ${i === this.currentPage ? 'pagination-active' : ''}" data-page="${i}">${i}</div>`);
    }
    
    if (end < totalPages) {
      if (end < totalPages - 1) pages.push(`<div class="page-number disabled">...</div>`);
      pages.push(`<div class="page-number" data-page="${totalPages}">${totalPages}</div>`);
    }
    
    return pages.join('');
  }
  
  updateData(newData) {
    this.data = newData;
    this.currentPage = 1;
    this.render();
  }
}

// Store paginator instances
let paginators = {};

// Helper function to create paginator for a table
function createPaginator(tableId, data, renderFn, options = {}) {
  if (paginators[tableId]) {
    paginators[tableId].updateData(data);
  } else {
    paginators[tableId] = new Paginator(data, tableId, renderFn, options);
  }
  return paginators[tableId];
}

/* ============================================================
   5. THEME
   ============================================================ */
function initTheme() {
  const saved = localStorage.getItem('nxTheme') || 'light';
  setTheme(saved, false);
}

function setTheme(theme, save=true) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('themeBtn');
  if (btn) btn.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
  if (save) localStorage.setItem('nxTheme', theme);
  /* redraw charts */
  Object.values(chartInstances).forEach(c => {
    if (c.options.plugins?.legend?.labels) c.options.plugins.legend.labels.color = chartTextColor();
    c.update();
  });
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  setTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ============================================================
   6. SIDEBAR + NAVIGATION
   ============================================================ */
function initNav() {
  $$('.sb-nav a').forEach(a => {
    a.addEventListener('click', () => {
      const page = a.dataset.page;
      if (!page) return;
      showPage(page);
      /* mobile: close sidebar */
      if (window.innerWidth < 768) closeMobileSidebar();
    });
  });

  $('menuBtn')?.addEventListener('click', toggleMobileSidebar);
  $('sidebarOv')?.addEventListener('click', closeMobileSidebar);
}

function showPage(pageKey) {
  /* hide all pages */
  $$('[id^="page-"]').forEach(el => el.style.display = 'none');
  /* show target */
  const target = $(`page-${pageKey}`);
  if (target) target.style.display = 'block';
  /* update nav active state */
  $$('.sb-nav a').forEach(a => a.classList.toggle('active', a.dataset.page === pageKey));
  /* update topbar title */
  const titles = {
    dashboard:'Dashboard', analytics:'Analytics', reports:'Reports',
    users:'Users', leave:'Leave Management', timesheets:'Timesheets', payroll:'Payroll Preview',
    tasks:'Tasks & Projects', shifts:'Shift Scheduling', equipment:'Equipment & Inventory',
    sites:'Sites', posts:'Posts', documents:'Documents', categories:'Categories',
    messages:'Messages', notifications:'Notifications', emailcenter:'Email Center',
    safety:'Safety & Incidents', auditlog:'Audit Log',
    rbac:'RBAC Permissions', clientportal:'Client Portal', settings:'Settings',
  };
  $('pageTitle').textContent = titles[pageKey] || pageKey;
  /* render page */
  renderPage(pageKey);
}

function toggleMobileSidebar() {
  $('sidebar').classList.toggle('mobile-open');
  $('sidebarOv').classList.toggle('show');
}
function closeMobileSidebar() {
  $('sidebar').classList.remove('mobile-open');
  $('sidebarOv').classList.remove('show');
}

/* ============================================================
   7. TOPBAR WIRING
   ============================================================ */
function initTopbar() {
  $('themeBtn')?.addEventListener('click', toggleTheme);
  $('topAvatar')?.addEventListener('click', () => $('profileDropdown')?.classList.toggle('open'));
  $('pdMyProfile')?.addEventListener('click', () => { openProfileModal(currentUser.id); $('profileDropdown').classList.remove('open'); });
  $('pdMyIdCard')?.addEventListener('click',  () => { openProfileModal(currentUser.id,'pmIdCard'); $('profileDropdown').classList.remove('open'); });
  $('pdSettings')?.addEventListener('click',  () => { showPage('settings'); $('profileDropdown').classList.remove('open'); });
  $('pdLogout')?.addEventListener('click',    doLogout);
  $('notifBtn')?.addEventListener('click',    () => showPage('notifications'));
  $('msgTopBtn')?.addEventListener('click',   () => showPage('messages'));
  $('globalSearch')?.addEventListener('input', doGlobalSearch);

  /* Ctrl+K focus search */
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); $('globalSearch')?.focus(); }
    if (e.key === 'Escape') { $$('.modal-ov.open').forEach(m => m.classList.remove('open')); }
  });

  /* Dashboard quick actions */
  $('qaAddUser')?.addEventListener('click', () => openUserModal());
  $('qaCreatePost')?.addEventListener('click', () => { showPage('posts'); openPostModal(); });
  $('qaNewTask')?.addEventListener('click', () => { showPage('tasks'); openTaskModal(); });
  $('qaAddSite')?.addEventListener('click', () => { showPage('sites'); openSiteModal(); });
  $('dashAuditMore')?.addEventListener('click', () => showPage('auditlog'));
}

function doLogout() {
  if (!confirm('Log out?')) return;
  logAction('logout','system','Admin logged out');
  toast('Logged out successfully', 'info');
  setTimeout(() => window.location.reload(), 1000);
}

function doGlobalSearch() {
  const q = $('globalSearch').value.toLowerCase().trim();
  if (!q) return;
  const user = DB.users.find(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  if (user) { showPage('users'); toast(`Showing results for "${q}"`, 'info'); return; }
  const site = DB.sites.find(s => s.name.toLowerCase().includes(q));
  if (site) { showPage('sites'); toast(`Showing results for "${q}"`, 'info'); return; }
  const post = DB.posts.find(p => p.title.toLowerCase().includes(q));
  if (post) { showPage('posts'); toast(`Showing results for "${q}"`, 'info'); }
}

/* ============================================================
   8. IMPERSONATION
   ============================================================ */
function impersonateUser(userId) {
  const u = userById(userId);
  if (!u || u.role === 'admin') { toast('Cannot impersonate this user','warn'); return; }
  impersonating = u;
  $('impersonateBanner').style.display = 'flex';
  $('impersonateName').textContent = u.name;
  toast(`Viewing as ${u.name}`, 'warn');
  logAction('impersonate', `User #${userId}`, `Admin viewed as ${u.name}`);
}

function exitImpersonate() {
  impersonating = null;
  $('impersonateBanner').style.display = 'none';
  toast('Exited impersonation', 'info');
}

/* ============================================================
   9. PAGE RENDERER
   ============================================================ */
function renderPage(page) {
  const map = {
    dashboard:     renderDashboard,
    analytics:     renderAnalytics,
    reports:       renderReports,
    users:         renderUsers,
    leave:         renderLeave,
    timesheets:    renderTimesheets,
    payroll:       renderPayroll,
    tasks:         renderTasks,
    shifts:        renderShifts,
    equipment:     renderEquipment,
    sites:         renderSites,
    posts:         renderPosts,
    documents:     renderDocuments,
    categories:    renderCategories,
    messages:      renderMessages,
    notifications: renderNotifications,
    emailcenter:   renderEmailCenter,
    safety:        renderSafety,
    auditlog:      renderAuditLog,
    rbac:          renderRBAC,
    clientportal:  renderClientPortal,
    settings:      renderSettings,
  };
  map[page]?.();
}

/* ============================================================
   10. DASHBOARD
   ============================================================ */
function renderDashboard() {
  /* Pending approvals bar */
  const pendingUsers = DB.users.filter(u => u.status === 'pending').length;
  const pendingLeave = DB.leaveRequests.filter(l => l.status === 'pending').length;
  const pendingDocs  = DB.documents.filter(d => d.status === 'pending').length;
  const totalPending = pendingUsers + pendingLeave + pendingDocs;
  const bar = $('pendingBar');
  if (totalPending > 0) {
    bar.style.display = 'flex';
    $('pendingBarText').textContent = `${totalPending} pending approval${totalPending>1?'s':''}: ${pendingUsers} users, ${pendingLeave} leave requests, ${pendingDocs} documents`;
    $('pendingBarActions').innerHTML = `
      <button class="btn btn-accent btn-sm" onclick="showPage('users')">Users</button>
      <button class="btn btn-outline btn-sm" onclick="showPage('leave')">Leave</button>
      <button class="btn btn-outline btn-sm" onclick="showPage('documents')">Docs</button>`;
  } else { bar.style.display = 'none'; }

  /* Stats */
  const activeUsers = DB.users.filter(u => u.status==='active').length;
  const activeSites = DB.sites.filter(s => s.status==='active').length;
  const openIncidents = DB.incidents.filter(i => i.status==='open').length;
  const totalTasks = DB.tasks.length;
  const doneTasks = DB.tasks.filter(t => t.status==='done').length;

  $('statsGrid').innerHTML = statCard('fa-users','blue', activeUsers,'Active Users','+2 this month','up') +
    statCard('fa-building','yellow', activeSites,'Active Sites','','flat') +
    statCard('fa-list-check','green', doneTasks+'/'+totalTasks,'Tasks Complete','','flat') +
    statCard('fa-money-bill-wave','purple', fmtMoney(DB.payroll.reduce((s,p)=>s+netPay(p),0)),'Total Payroll','This month','flat') +
    statCard('fa-triangle-exclamation','red', openIncidents,'Open Incidents',openIncidents>0?'Action needed':'All clear', openIncidents>0?'down':'up') +
    statCard('fa-folder-open','orange', DB.documents.filter(d=>d.status==='pending').length,'Docs Pending Review','','flat');

  /* Notification badge */
  const unread = DB.notifications.filter(n=>!n.read).length;
  $('nbNotifs').textContent = unread;
  $('nbNotifs').style.display = unread > 0 ? '' : 'none';
  $('notifDot').style.display = unread > 0 ? '' : 'none';

  /* Pending users badge */
  $('nbUsers').textContent = pendingUsers;
  $('nbUsers').style.display = pendingUsers > 0 ? '' : 'none';

  /* Charts */
  setTimeout(() => {
    renderMainChart();
    renderRoleChart();
    renderTaskChart();
    renderActivityFeed();
    renderSysHealth();
    renderDashAudit();
  }, 50);
}

function statCard(icon, color, num, label, trend, dir) {
  return `<div class="stat-card">
    <div class="sc-top">
      <div class="sc-icon ${color}"><i class="fas ${icon}"></i></div>
    </div>
    <div class="sc-num">${num}</div>
    <div class="sc-label">${label}</div>
    ${trend ? `<div class="sc-trend trend-${dir==='up'?'up':dir==='down'?'down':'flat'}"><i class="fas fa-arrow-${dir==='up'?'up':dir==='down'?'down':'right'}"></i>${trend}</div>` : ''}
  </div>`;
}

function renderMainChart() {
  makeChart('mainChart', {
    type:'bar',
    data:{
      labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
      datasets:[
        { label:'Completed', data:[4,6,3,8,5,2,1], backgroundColor:'rgba(234,179,8,0.8)', borderRadius:6 },
        { label:'In Progress',data:[2,3,5,2,4,1,0], backgroundColor:'rgba(59,130,246,0.6)', borderRadius:6 },
      ]
    },
    options:{ ...chartDefaults(), plugins:{...chartDefaults().plugins, legend:{...chartDefaults().plugins.legend}} }
  });
}

function renderRoleChart() {
  const counts = ['admin','manager','worker'].map(r => DB.users.filter(u=>u.role===r).length);
  makeChart('roleChart', {
    type:'doughnut',
    data:{
      labels:['Admin','Manager','Worker'],
      datasets:[{ data:counts, backgroundColor:['rgba(139,92,246,0.8)','rgba(234,179,8,0.8)','rgba(59,130,246,0.8)'], borderWidth:0 }]
    },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:chartTextColor(), font:{family:'DM Sans',size:11} } } }, cutout:'65%' }
  });
}

function renderTaskChart() {
  const cols = ['todo','inprogress','review','done'];
  const labels = ['To Do','In Progress','Review','Done'];
  const counts = cols.map(c => DB.tasks.filter(t=>t.status===c).length);
  makeChart('taskChart', {
    type:'bar',
    data:{
      labels,
      datasets:[{ label:'Tasks', data:counts, backgroundColor:['rgba(100,116,139,0.7)','rgba(234,179,8,0.7)','rgba(59,130,246,0.7)','rgba(16,185,129,0.7)'], borderRadius:6 }]
    },
    options:{ ...chartDefaults(), indexAxis:'y', plugins:{legend:{display:false}} }
  });
}

function renderActivityFeed() {
  const feed = $('actFeed');
  const items = DB.auditLog.slice(0,8).map(l => {
    const u = userById(l.userId);
    const icons = {login:'fa-sign-in-alt',logout:'fa-sign-out-alt',create:'fa-plus',update:'fa-pen',delete:'fa-trash',approve:'fa-check',reject:'fa-times',impersonate:'fa-user-secret'};
    return `<div style="display:flex;gap:0.6rem;align-items:flex-start;padding:0.4rem 0;border-bottom:1px solid var(--border);">
      <div style="width:28px;height:28px;border-radius:7px;background:var(--accent-glow);display:flex;align-items:center;justify-content:center;font-size:0.72rem;flex-shrink:0;color:var(--accent);">
        <i class="fas ${icons[l.action]||'fa-circle'}"></i></div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.78rem;font-weight:500;">${u?.name||'System'} <span style="color:var(--text3);">${l.action}</span> ${l.target}</div>
        <div style="font-size:0.68rem;color:var(--text3);">${l.time}</div>
      </div></div>`;
  }).join('');
  feed.innerHTML = items || '<div class="empty-state"><i class="fas fa-rss"></i>No recent activity</div>';
}

function renderSysHealth() {
  const storePct = 24;
  $('sysHealthGrid').innerHTML = `
    <div class="sys-health-item"><div class="sh-label">Storage</div><div class="sh-val" style="color:var(--accent);">2.4 / 10 MB</div><div class="pb sh-bar" style="height:5px;"><div class="pb-fill" style="width:${storePct}%;"></div></div></div>
    <div class="sys-health-item"><div class="sh-label">Active Users</div><div class="sh-val">${DB.users.filter(u=>u.online==='online').length} online</div></div>
    <div class="sys-health-item"><div class="sh-label">Pending Notifications</div><div class="sh-val">${DB.notifications.filter(n=>!n.read).length} unread</div></div>
    <div class="sys-health-item"><div class="sh-label">Last Backup</div><div class="sh-val" style="color:#34d399;">Today 03:00</div></div>`;
}

function renderDashAudit() {
  $('dashAuditBody').innerHTML = DB.auditLog.slice(0,5).map(l => {
    const u = userById(l.userId);
    return `<tr><td>${l.time}</td><td>${avatarEl(u,24)} ${u?.name||'?'}</td><td>${l.action}</td><td>${l.target}</td><td><code style="font-size:0.72rem;">${l.ip}</code></td></tr>`;
  }).join('');
}

/* ============================================================
   11. USERS PAGE
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
  
  // Initial load
  filterAndUpdateUsers();
}

function populateUserFilterSelects() {
  const tsUser = $('tsUser');
  if (tsUser) {
    tsUser.innerHTML = '<option value="">All Employees</option>' +
      DB.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  }
  const docUser = $('docUser');
  if (docUser) {
    docUser.innerHTML = '<option value="">All Employees</option>' +
      DB.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  }
}

function wireUserFilters() {
  ['fName','fEmail','fPhone','fRole','fStatus'].forEach(id => {
    $(id)?.addEventListener('input', () => filterAndUpdateUsers());
  });
}

function wireUserBulk() {
  $('selectAll')?.addEventListener('change', e => {
    // Get current visible users from paginator
    let visibleUsers = [];
    if (paginators['uTbody']) {
      visibleUsers = paginators['uTbody'].getCurrentPageData();
    } else {
      visibleUsers = DB.users;
    }
    
    $$('.row-check').forEach(cb => { 
      cb.checked = e.target.checked; 
    });
    
    if (e.target.checked) {
      visibleUsers.forEach(u => selectedUserIds.add(u.id));
    } else {
      visibleUsers.forEach(u => selectedUserIds.delete(u.id));
    }
    updateBulkBar();
  });
  
  $('bulkActivate')?.addEventListener('click', () => {
    selectedUserIds.forEach(id => { const u=userById(id); if(u) u.status='active'; });
    selectedUserIds.clear(); 
    filterAndUpdateUsers(); 
    updateBulkBar(); 
    toast('Users activated','success');
  });
  
  $('bulkDeactivate')?.addEventListener('click', () => {
    selectedUserIds.forEach(id => { const u=userById(id); if(u) u.status='inactive'; });
    selectedUserIds.clear(); 
    filterAndUpdateUsers(); 
    updateBulkBar(); 
    toast('Users deactivated','warn');
  });
  
  $('bulkDelete')?.addEventListener('click', () => {
    if (!confirm(`Delete ${selectedUserIds.size} users?`)) return;
    DB.users.splice(0, DB.users.length, ...DB.users.filter(u=>!selectedUserIds.has(u.id)));
    selectedUserIds.clear(); 
    filterAndUpdateUsers(); 
    updateBulkBar(); 
    toast('Users deleted','success');
  });
  
  $('bulkClear')?.addEventListener('click', () => {
    selectedUserIds.clear(); 
    $$('.row-check').forEach(cb=>cb.checked=false);
    if($('selectAll')) $('selectAll').checked=false;
    updateBulkBar();
  });
}

function updateBulkBar() {
  const bar = $('bulkBar');
  if (!bar) return;
  bar.style.display = selectedUserIds.size > 0 ? 'flex' : 'none';
  $('bulkCount').textContent = `${selectedUserIds.size} selected`;
}

// New function to filter users and update paginator
function filterAndUpdateUsers(tab = 'all') {
  const name   = $('fName')?.value.toLowerCase()  || '';
  const email  = $('fEmail')?.value.toLowerCase() || '';
  const phone  = $('fPhone')?.value.toLowerCase() || '';
  const role   = $('fRole')?.value  || '';
  const status = $('fStatus')?.value|| '';

  let filteredUsers = DB.users.filter(u => {
    if (tab==='pending' && u.status!=='pending') return false;
    if (name   && !u.name.toLowerCase().includes(name))   return false;
    if (email  && !u.email.toLowerCase().includes(email)) return false;
    if (phone  && !u.phone.toLowerCase().includes(phone)) return false;
    if (role   && u.role !== role)   return false;
    if (status && u.status !== status) return false;
    return true;
  });

  $('uCount').textContent = `${filteredUsers.length} user${filteredUsers.length!==1?'s':''}`;
  $('pendingCount').textContent = DB.users.filter(u=>u.status==='pending').length;
  $('pendingCount').style.display = DB.users.filter(u=>u.status==='pending').length>0 ? '' : 'none';
  
  // Create or update paginator
  createPaginator('uTbody', filteredUsers, (data) => {
    renderUserTableBody(data, tab);
  }, { perPage: 10 });
}

// New function to render only the table body (without pagination logic)
function renderUserTableBody(users, tab) {
  $('uTbody').innerHTML = users.length ? users.map((u,i) => {
    const globalIndex = DB.users.findIndex(user => user.id === u.id) + 1;
    return `
      <tr>
        <td><input type="checkbox" class="row-check" data-uid="${u.id}" ${selectedUserIds.has(u.id)?'checked':''}></td>
        <td style="color:var(--text3);font-size:0.75rem;">${globalIndex}</td>
        <td><div class="user-cell">${avatarEl(u)} <div><div style="font-weight:600;">${u.name}</div><div style="font-size:0.72rem;color:var(--text3);">${u.empId}</div></div></div></td>
        <td>${u.email}</td>
        <td>${u.phone}</td>
        <td>${roleBadge(u.role)}</td>
        <td>${u.dept||'—'}</td>
        <td>${statusBadge(u.status)}</td>
        <td>${onlineDot(u)}</td>
        <td style="font-size:0.75rem;">${fmt(u.registered)}</td>
        <td style="font-size:0.75rem;">${u.lastLogin}</td>
        <td>
          <div style="display:flex;gap:0.2rem;flex-wrap:wrap;">
            <button class="abt inf" title="View Profile" onclick="openProfileModal(${u.id})"><i class="fas fa-eye"></i></button>
            <button class="abt warn" title="Edit" onclick="openUserModal(${u.id})"><i class="fas fa-pen"></i></button>
            ${u.status==='pending'?`<button class="abt suc" title="Approve" onclick="openApprovalModal(${u.id})"><i class="fas fa-check"></i></button>`:''}
            <button class="abt" title="Switch to User" onclick="impersonateUser(${u.id})"><i class="fas fa-user-secret"></i></button>
            <button class="abt dan" title="Delete" onclick="deleteUser(${u.id})"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
  }).join('') :
    '<tr><td colspan="12"><div class="empty-state"><i class="fas fa-users"></i>No users found</div></td></tr>';
    
  // Wire row checkboxes
  $$('.row-check').forEach(cb => {
    cb.removeEventListener('change', handleRowCheck);
    cb.addEventListener('change', handleRowCheck);
  });
}

function handleRowCheck(e) {
  const uid = +e.target.dataset.uid;
  e.target.checked ? selectedUserIds.add(uid) : selectedUserIds.delete(uid);
  updateBulkBar();
  
  // Update select all checkbox
  const selectAll = $('selectAll');
  if (selectAll) {
    const currentPageUsers = paginators['uTbody']?.getCurrentPageData() || [];
    const allChecked = currentPageUsers.length > 0 && currentPageUsers.every(u => selectedUserIds.has(u.id));
    selectAll.checked = allChecked;
  }
}

function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  const idx = DB.users.findIndex(u => u.id === id);
  if (idx > -1) { 
    DB.users.splice(idx,1); 
    logAction('delete',`User #${id}`,'User deleted'); 
    filterAndUpdateUsers(); 
    toast('User deleted','success'); 
  }
}

function handleCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const lines = ev.target.result.split('\n').filter(Boolean);
    const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
    let added = 0;
    lines.slice(1).forEach(line => {
      const vals = line.split(',').map(v=>v.trim().replace(/^"|"$/g,''));
      const obj = {};
      headers.forEach((h,i) => obj[h] = vals[i]);
      if (obj.name && obj.email) {
        DB.users.push({ id:generateId('users'), name:obj.name, email:obj.email, phone:obj.phone||'', role:obj.role||'worker', dept:obj.dept||'', status:'pending', empId:`EMP-${String(nextId.users).padStart(4,'0')}`, idNum:'', natId:'', dob:'', hired:nowStr().slice(0,10), salary:0, addr:'', emerg:'', bio:'', avatarColor:'#eab308', avatarImg:'', lastLogin:'Never', registered:nowStr().slice(0,10), online:'offline' });
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
   12. USER MODAL (ADD / EDIT)
   ============================================================ */
function openUserModal(userId=null) {
  openProfileModal(userId);
}

/* ============================================================
   13. PROFILE MODAL
   ============================================================ */
function openProfileModal(userId=null, tab='pmEdit') {
  currentSite = null;
  const user = userId ? userById(userId) : { id:null, name:'', email:'', phone:'', role:'worker', dept:'', status:'active', empId:'', idNum:'', natId:'', dob:'', hired:'', salary:0, addr:'', emerg:'', bio:'', avatarColor:'#eab308', avatarImg:'', registered:'', lastLogin:'', online:'offline' };

  $('pmTitle').textContent   = userId ? 'Edit Profile' : 'Add User';
  $('pmName2').textContent   = user.name || 'New User';
  $('pmRole2').textContent   = user.role || '';
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
  
  // Clear password fields
  if ($('pmNewPassword')) $('pmNewPassword').value = '';
  if ($('pmConfirmPassword')) $('pmConfirmPassword').value = '';
  if ($('pmPasswordStrength')) $('pmPasswordStrength').innerHTML = '';

  /* Avatar */
  const avInit = $('pmAvInit'), avImg = $('pmAvImg');
  avInit.textContent = initials(user.name) || '?';
  avInit.style.color = user.avatarColor || '#eab308';
  if (user.avatarImg) { avImg.src = user.avatarImg; avImg.style.display='block'; avInit.style.display='none'; }
  else { avImg.style.display='none'; avInit.style.display=''; }

  /* Avatar colors */
  const colors = ['#eab308','#3b82f6','#10b981','#8b5cf6','#f43f5e','#f97316','#06b6d4','#84cc16'];
  $('avColorOpts').innerHTML = colors.map(c => `<div class="av-color-opt${user.avatarColor===c?' sel':''}" style="background:${c}22;color:${c};border-color:${user.avatarColor===c?c:'transparent'};" data-color="${c}" onclick="pickAvatarColor(this,'${c}')">${initials(user.name)||'?'}</div>`).join('');

  /* Tab switching */
  switchPMTab(tab);

  /* Performance tab */
  if (userId) renderPMPerf(user);
  /* Documents tab */
  renderPMDocs(userId);
  /* History tab */
  renderPMHist(userId);
  /* ID card tab */
  renderIdCard(user);

  /* Save button */
  const saveBtn = $('pmSaveBtn');
  saveBtn.onclick = () => savePMUser(userId);

  /* Avatar upload */
  $('avUploadDrop')?.addEventListener('click', () => $('avatarFileInput').click());
  $('avatarFileInput').onchange = e => handleAvatarUpload(e, userId);
  
  /* Password strength checker */
  if ($('pmNewPassword')) {
    $('pmNewPassword').addEventListener('input', checkPMPasswordStrength);
  }
  
  /* Send reset link button */
  if ($('pmSendResetLink')) {
    $('pmSendResetLink').onclick = () => sendPasswordResetLinkToUser(userId || currentUser.id);
  }

  openM('profileModal');
}

function switchPMTab(tabId) {
  ['pmEdit','pmPerf','pmDocs','pmHist','pmIdCard'].forEach(id => {
    const el = $(id); if(el) el.style.display = id===tabId ? '' : 'none';
  });
  $$('.pm-tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.pmtab === tabId));
  /* Wire tab buttons */
  $$('.pm-tab-btn').forEach(btn => { btn.onclick = () => switchPMTab(btn.dataset.pmtab); });
}

function pickAvatarColor(el, color) {
  $$('#avColorOpts .av-color-opt').forEach(o => { o.classList.remove('sel'); o.style.borderColor='transparent'; });
  el.classList.add('sel'); el.style.borderColor = color;
}

function handleAvatarUpload(e, userId) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const src = ev.target.result;
    const avImg = $('pmAvImg'), avInit = $('pmAvInit');
    avImg.src = src; avImg.style.display='block'; avInit.style.display='none';
    if (userId) { const u = userById(userId); if(u) u.avatarImg = src; }
    updateTopbarAvatar();
  };
  reader.readAsDataURL(file);
}

// Check password strength in profile modal
function checkPMPasswordStrength() {
  const password = $('pmNewPassword')?.value || '';
  const strengthEl = $('pmPasswordStrength');
  
  if (!strengthEl) return;
  
  if (password.length === 0) {
    strengthEl.innerHTML = '';
    return;
  }
  
  let strength = 0;
  let message = '';
  let color = '';
  
  // Length check
  if (password.length >= 8) strength++;
  if (password.length >= 12) strength++;
  
  // Contains number
  if (/\d/.test(password)) strength++;
  
  // Contains uppercase
  if (/[A-Z]/.test(password)) strength++;
  
  // Contains lowercase
  if (/[a-z]/.test(password)) strength++;
  
  // Contains special character
  if (/[^A-Za-z0-9]/.test(password)) strength++;
  
  // Determine strength
  if (strength <= 2) {
    message = 'Weak password';
    color = '#f87171';
  } else if (strength <= 4) {
    message = 'Medium password';
    color = '#f97316';
  } else {
    message = 'Strong password';
    color = '#34d399';
  }
  
  strengthEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.5rem;">
      <div style="flex:1;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;">
        <div style="width:${(strength / 6) * 100}%;height:100%;background:${color};border-radius:2px;"></div>
      </div>
      <span style="color:${color};">${message}</span>
    </div>
  `;
}

// Send password reset link to a specific user
function sendPasswordResetLinkToUser(userId) {
  const user = userById(userId);
  
  if (!user || !user.email) {
    toast('No email address found for this user', 'error');
    return;
  }
  
  // Generate reset token
  const resetToken = generateResetToken();
  const resetLink = `${window.location.origin}/reset-password?token=${resetToken}&user=${userId}`;
  
  // Store reset token
  if (!DB.passwordResetTokens) DB.passwordResetTokens = {};
  DB.passwordResetTokens[resetToken] = {
    email: user.email,
    userId: userId,
    expires: Date.now() + 3600000 // 1 hour expiry
  };
  
  // Send email with reset link
  sendEmail(
    user.email,
    'Password Reset Request',
    'password_reset'
  );
  
  // Log for demo
  console.log(`Password reset link for ${user.name}:`, resetLink);
  
  toast(`Password reset link sent to ${user.email}`, 'success');
  logAction('request', 'Password Reset', `Reset link sent to ${user.name} (${user.email})`);
}

// Generate a random reset token
function generateResetToken() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

function savePMUser(userId) {
  const data = {
    name:$('pmFName').value.trim(), email:$('pmEmail').value.trim(), phone:$('pmPhone').value.trim(),
    role:$('pmRole').value, status:$('pmStatus').value, dept:$('pmDept').value.trim(),
    empId:$('pmEmpId').value.trim(), idNum:$('pmIdNum').value.trim(), natId:$('pmNatId').value.trim(),
    dob:$('pmDob').value, hired:$('pmHired').value, salary:+$('pmSalary').value,
    addr:$('pmAddr').value.trim(), emerg:$('pmEmerg').value.trim(), bio:$('pmBio').value.trim(),
  };
  if (!data.name || !data.email) { toast('Name and email required','error'); return; }

  /* Avatar color */
  const selColor = document.querySelector('#avColorOpts .av-color-opt.sel');
  if (selColor) data.avatarColor = selColor.dataset.color;
  
  /* Password change */
  const newPassword = $('pmNewPassword')?.value;
  const confirmPassword = $('pmConfirmPassword')?.value;
  
  if (newPassword || confirmPassword) {
    if (newPassword !== confirmPassword) {
      toast('Passwords do not match', 'error');
      return;
    }
    const minLength = DB.settings?.passwordMinLen || 8;
    if (newPassword.length < minLength) {
      toast(`Password must be at least ${minLength} characters`, 'error');
      return;
    }
    data.password = newPassword;
  }

  if (userId) {
    const u = userById(userId);
    Object.assign(u, data);
    // Store password separately if changed
    if (data.password) {
      if (!DB.userPasswords) DB.userPasswords = {};
      DB.userPasswords[userId] = data.password;
    }
    logAction('update',`User #${userId}`,`Updated ${data.name}`);
    toast('Profile saved','success');
  } else {
    const newUser = { id:generateId('users'), ...data, avatarImg:'', avatarColor: data.avatarColor||'#eab308', lastLogin:'Never', registered:nowStr().slice(0,10), online:'offline' };
    DB.users.push(newUser);
    // Store password for new user
    if (data.password) {
      if (!DB.userPasswords) DB.userPasswords = {};
      DB.userPasswords[newUser.id] = data.password;
    }
    logAction('create',`User #${newUser.id}`,`Created ${data.name}`);
    toast('User created','success');
  }

  closeM('profileModal');
  if ($('page-users').style.display !== 'none') renderUserTable();
  updateTopbarAvatar();
}

function renderPMPerf(user) {
  const userTasks = DB.tasks.filter(t => taskAssigneeIds(t).includes(user.id));
  $('pf_tasks').textContent = userTasks.filter(t=>t.status==='done').length;
  $('pf_proc').textContent  = userTasks.filter(t=>t.status==='inprogress').length;
  $('pf_pend').textContent  = userTasks.filter(t=>t.status==='todo').length;
  $('pf_issues').textContent= DB.incidents.filter(i=>i.reporterId===user.id).length;
  $('pf_rating').textContent= '4.2';
  $('pf_attendance').textContent= '96%';
  
  setTimeout(() => {
    // Destroy existing chart if it exists
    if (chartInstances['pmPerfChart']) {
      chartInstances['pmPerfChart'].destroy();
      delete chartInstances['pmPerfChart'];
    }
    
    makeChart('pmPerfChart',{
      type:'line',
      data:{ 
        labels:['Jan','Feb','Mar','Apr','May','Jun','Jul'], 
        datasets:[{
          label:'Tasks Done', 
          data:[2,4,3,6,5,8,userTasks.filter(t=>t.status==='done').length], 
          borderColor:'#eab308', 
          backgroundColor:'rgba(234,179,8,0.1)', 
          fill:true, 
          tension:0.4
        }]
      },
      options:{
        responsive: true,
        maintainAspectRatio: true,  
        plugins:{
          legend:{ display: false }
        }
      }
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
  const logs = DB.auditLog.filter(l => l.userId === userId).slice(0,10);
  $('pmHistList').innerHTML = logs.length ? logs.map(l =>
    `<div style="display:flex;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;"><span style="color:var(--text3);min-width:120px;">${l.time}</span><span class="badge b-${l.action}">${l.action}</span><span>${l.target} — ${l.details}</span></div>`
  ).join('') : '<div class="empty-state"><i class="fas fa-history"></i>No history</div>';
}

function renderIdCard(user) {
  const u = typeof user==='number' ? userById(user) : user;
  $('icAv').textContent = initials(u.name);
  $('icName').textContent = u.name;
  $('icRole').textContent = u.role?.toUpperCase();
  $('icEmpId').textContent  = u.empId || '—';
  $('icIdNum').textContent  = u.idNum || '—';
  $('icDept').textContent   = u.dept  || '—';
  $('icHired').textContent  = fmt(u.hired);
  $('icBarcode').textContent= u.idNum || `NX-${String(u.id).padStart(3,'0')}-${new Date().getFullYear()}`;
  $('icInfoGrid').innerHTML = `
    <div class="info-item"><div class="il">Email</div><div class="iv">${u.email}</div></div>
    <div class="info-item"><div class="il">Phone</div><div class="iv">${u.phone}</div></div>
    <div class="info-item"><div class="il">National ID</div><div class="iv">${u.natId||'—'}</div></div>
    <div class="info-item"><div class="il">DOB</div><div class="iv">${fmt(u.dob)}</div></div>`;
}

$('printIdBtn')?.addEventListener('click', printIdCard);
function printIdCard() { window.print(); }

/* ============================================================
   14. APPROVAL MODAL
   ============================================================ */
function openApprovalModal(userId) {
  const u = userById(userId);
  if (!u) return;
  $('approvalInfo').innerHTML = `<div class="user-cell">${avatarEl(u,36)}<div><div style="font-weight:600;">${u.name}</div><div style="font-size:0.75rem;color:var(--text3);">${u.email} · ${u.role}</div></div></div>`;
  $('approvalApproveBtn').onclick = () => decideUserApproval(userId, 'active');
  $('approvalRejectBtn').onclick  = () => decideUserApproval(userId, 'inactive');
  openM('approvalModal');
}

function decideUserApproval(userId, decision) {
  const u = userById(userId);
  if (!u) return;
  u.status = decision;
  const comment = $('approvalComment')?.value || '';
  logAction(decision==='active'?'approve':'reject',`User #${userId}`,`${decision==='active'?'Approved':'Rejected'} ${u.name}. ${comment}`);
  closeM('approvalModal');
  renderUserTable();
  toast(`User ${decision==='active'?'approved':'rejected'}`, decision==='active'?'success':'warn');
  sendEmail(u.email, decision==='active'?'Welcome to Nixers Pro':'Account not approved', 'welcome_approved');
}

/* ============================================================
   15. SITES PAGE
   ============================================================ */
function renderSites() {
  $('addSiteBtn')?.addEventListener('click', () => openSiteModal());
  filterAndUpdateSites(); // Changed from renderSiteTable()
}

// New function to filter and paginate sites
function filterAndUpdateSites() {
  // You can add search/filter functionality here if needed
  // For now, just show all sites
  const allSites = [...DB.sites];
  
  // Create paginator for sites table
  if (allSites.length >= 0) {
    createPaginator('sTbody', allSites, (data) => {
      renderSiteTableBody(data);
    }, { perPage: 10 });
  }
}

// New function to render only the table body
function renderSiteTableBody(sites) {
  if (!sites.length) {
    $('sTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-building"></i>No sites found</div></td></tr>';
    return;
  }
  
  $('sTbody').innerHTML = sites.map(s => {
    const mgr = userById(s.managerId);
    const workers = s.workerIds?.length || 0;
    const pct = s.progress;
    return `
      <tr>
        <td><div style="font-weight:600;">${s.name}</div></td>
        <td><div class="user-cell">${avatarEl(mgr,26)}<span style="font-size:0.82rem;">${mgr?.name || '—'}</span></div></td>
        <td>${workers}</td>
        <td>
          <div style="display:flex;align-items:center;gap:0.5rem;min-width:100px;">
            <div class="pb" style="flex:1;height:7px;"><div class="pb-fill" style="width:${pct}%;"></div></div>
            <span style="font-size:0.75rem;color:var(--text3);">${pct}%</span>
          </div>
        </td>
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

// Keep original function for compatibility (if called elsewhere)
function renderSiteTable() {
  filterAndUpdateSites();
}

// Function to search workers for site assignment
function searchSiteWorkers(q = '') {
  const res = $('sm_workerResults');
  if (!res) return;
  
  const query = q.trim().toLowerCase();
  if (!query) {
    res.classList.remove('show');
    return;
  }
  
  const workers = DB.users.filter(u => 
    u.role === 'worker' && 
    u.status === 'active' &&
    !siteWorkers.includes(u.id) && 
    u.name.toLowerCase().includes(query)
  );
  
  if (workers.length) {
    res.innerHTML = workers.map(w => `
      <div class="assign-opt" onclick="addSiteWorker(${w.id})">
        ${avatarEl(w, 24)}
        <span>${w.name}</span>
        <span style="font-size:0.7rem;color:var(--text3);margin-left:auto;">${w.dept || 'Worker'}</span>
      </div>
    `).join('');
    res.classList.add('show');
  } else {
    res.innerHTML = '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No workers found</div>';
    res.classList.add('show');
  }
}

// Function to add a worker to the site
function addSiteWorker(id) {
  if (!siteWorkers.includes(id)) {
    siteWorkers.push(id);
  }
  renderSiteWorkerTags();
  $('sm_workerResults').classList.remove('show');
  $('sm_workerSearch').value = '';
}

// Function to remove a worker from the site
function removeSiteWorker(id) {
  siteWorkers = siteWorkers.filter(x => x !== id);
  renderSiteWorkerTags();
}

// Function to render worker tags
function renderSiteWorkerTags() {
  const container = $('sm_workerTags');
  if (!container) return;
  
  if (siteWorkers.length === 0) {
    container.innerHTML = '<div style="font-size:0.78rem;color:var(--text3);padding:0.35rem 0;">No workers assigned</div>';
    return;
  }
  
  container.innerHTML = siteWorkers.map(id => {
    const u = userById(id);
    return `<div class="assign-tag">${u?.name || id}<button onclick="removeSiteWorker(${id})">×</button></div>`;
  }).join('');
}

function openSiteModal(siteId=null) {
  const managers = DB.users.filter(u=>u.role==='manager');
  $('sm_mgr').innerHTML = managers.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  const s = siteId ? siteById(siteId) : null;
  
  // Reset and load site workers
  siteWorkers = s?.workerIds ? [...s.workerIds] : [];
  
  $('smTitle').textContent = s ? 'Edit Site' : 'Add Site';
  $('sm_name').value   = s?.name   || '';
  $('sm_mgr').value    = s?.managerId || managers[0]?.id || '';
  $('sm_budget').value = s?.budget  || '';
  $('sm_spent').value  = s?.spent   || '';
  $('sm_status').value = s?.status  || 'planning';
  $('sm_start').value  = s?.startDate|| '';
  $('sm_end').value    = s?.endDate  || '';
  $('sm_prog').value   = s?.progress || 0;
  $('sm_desc').value   = s?.desc     || '';
  
  // Render worker tags
  renderSiteWorkerTags();
  
  // Setup worker search
  const workerSearch = $('sm_workerSearch');
  if (workerSearch) {
    // Remove any existing event listeners
    workerSearch.oninput = null;
    workerSearch.oninput = (e) => searchSiteWorkers(e.target.value);
  }
  
  // Close results when clicking outside
  setTimeout(() => {
    document.addEventListener('click', function closeSiteWorkerResults(e) {
      if (!e.target.closest('#sm_workerSearch') && !e.target.closest('#sm_workerResults')) {
        const results = $('sm_workerResults');
        if (results) results.classList.remove('show');
      }
    });
  }, 100);
  
  $('sm_save').onclick = () => saveSite(siteId);
  openM('siteModal');
}

function saveSite(siteId) {
  const data = {
    name:$('sm_name').value.trim(), 
    managerId:+$('sm_mgr').value,
    budget:+$('sm_budget').value||0, 
    spent:+$('sm_spent').value||0,
    status:$('sm_status').value,
    startDate:$('sm_start').value, 
    endDate:$('sm_end').value,
    progress:+$('sm_prog').value||0, 
    desc:$('sm_desc').value.trim(), 
    workerIds: [...siteWorkers],
  };
  
  if (!data.name) { toast('Site name required','error'); return; }
  
  if (siteId) { 
    const site = siteById(siteId);
    if (site) {
      Object.assign(site, data); 
      logAction('update',`Site #${siteId}`,`Updated ${data.name} with ${data.workerIds.length} workers`); 
    }
  } else { 
    DB.sites.push({id:generateId('sites'),...data}); 
    logAction('create','Site',`Created ${data.name} with ${data.workerIds.length} workers`); 
  }
  
  closeM('siteModal'); 
  filterAndUpdateSites(); // Updated to use paginated version
  toast('Site saved','success');
}

function deleteSite(id) {
  if (!confirm('Delete this site?')) return;
  DB.sites.splice(DB.sites.findIndex(s=>s.id===id),1);
  logAction('delete',`Site #${id}`,'Site deleted'); 
  filterAndUpdateSites(); // Updated to use paginated version
  toast('Site deleted','success');
}

function openSiteDetail(siteId) {
  const s = siteById(siteId);
  if (!s) return;
  const mgr = userById(s.managerId);
  const workers = (s.workerIds || []).map(id=>userById(id)).filter(Boolean);
  $('sdTitle').textContent = s.name;
  $('sdBody').innerHTML = `
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
   16. POSTS PAGE
   ============================================================ */
function renderPosts() {
  populateCatFilter();
  filterAndUpdatePosts(); // Changed from renderPostTable()
  $('addPostBtn')?.addEventListener('click', () => openPostModal());
  $('fPost')?.addEventListener('input', filterAndUpdatePosts);
  $('fVis')?.addEventListener('change', filterAndUpdatePosts);
  $('fCat')?.addEventListener('change', filterAndUpdatePosts);
}

function populateCatFilter() {
  const el = $('fCat'); if(!el) return;
  el.innerHTML = '<option value="">All Categories</option>' + DB.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const pmCat = $('pm_cat'); if(!pmCat) return;
  pmCat.innerHTML = DB.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
}

// New function to filter and paginate posts
function filterAndUpdatePosts() {
  const q   = $('fPost')?.value.toLowerCase() || '';
  const vis = $('fVis')?.value || '';
  const cat = $('fCat')?.value || '';
  
  const filteredPosts = DB.posts.filter(p => {
    if (q && !p.title.toLowerCase().includes(q)) return false;
    if (vis && p.visibility !== vis) return false;
    if (cat && p.catId !== +cat) return false;
    return true;
  });
  
  // Create paginator for posts table
  if (filteredPosts.length >= 0) {
    createPaginator('pTbody', filteredPosts, (data) => {
      renderPostTableBody(data);
    }, { perPage: 10 });
  }
}

// New function to render only the table body
function renderPostTableBody(posts) {
  if (!posts.length) {
    $('pTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-newspaper"></i>No posts found</div></td></tr>';
    return;
  }
  
  $('pTbody').innerHTML = posts.map(p => {
    const author = userById(p.authorId);
    const category = catById(p.catId);
    const assigned = (p.assignedIds || []).map(id => userById(id)?.name).filter(Boolean).join(', ');
    return `
      <tr>
        <td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.title}</td>
        <td><div class="user-cell">${avatarEl(author,26)}<span style="font-size:0.82rem;">${author?.name || '—'}</span></div></td>
        <td>
          ${category ? `<span class="badge" style="background:${category.color}22;color:${category.color};"><i class="fas ${category.icon}" style="font-size:0.65rem;"></i> ${category.name}</span>` : '—'}
        </td>
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

// Keep original function for compatibility (if called elsewhere)
function renderPostTable() {
  filterAndUpdatePosts();
}

function openPostModal(postId=null) {
  populateCatFilter();
  postAssignees = [];
  $('pm_assignTags').innerHTML = '';
  $('pm_attFiles').innerHTML = '';
  const p = postId ? DB.posts.find(x=>x.id===postId) : null;
  $('pomTitle').textContent = p ? 'Edit Post' : 'New Post';
  $('pm_title').value    = p?.title   || '';
  $('pm_cat').value      = p?.catId   || (DB.categories[0]?.id||'');
  $('pm_vis').value      = p?.visibility||'all';
  $('pm_content').value  = p?.content || '';
  $('pm_loc').value      = p?.location|| '';
  if (p) postAssignees = [...(p.assignedIds||[])];
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
  const workers = DB.users.filter(u => u.role==='worker' && u.name.toLowerCase().includes(q.toLowerCase()) && !postAssignees.includes(u.id));
  res.innerHTML = workers.map(w=>`<div class="assign-opt" onclick="addAssignee(${w.id})">${avatarEl(w,24)}<span>${w.name}</span></div>`).join('') || '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.toggle('show', !!workers.length);
}

function addAssignee(id) {
  if (!postAssignees.includes(id)) { postAssignees.push(id); }
  renderAssignTagsPost();
  $('pm_assignResults').classList.remove('show');
  $('pm_assignSearch').value = '';
}

function renderAssignTagsPost() {
  $('pm_assignTags').innerHTML = postAssignees.map(id => {
    const u = userById(id);
    return `<div class="assign-tag">${u?.name||id}<button onclick="removeAssignee(${id})">×</button></div>`;
  }).join('');
}

function removeAssignee(id) { postAssignees = postAssignees.filter(x=>x!==id); renderAssignTagsPost(); }

function addPostFiles(input) {
  Array.from(input.files).forEach(file => {
    $('pm_attFiles').innerHTML += `<div class="att-file"><i class="fas fa-file"></i><span>${file.name}</span><span style="color:var(--text3);font-size:0.72rem;">${(file.size/1024).toFixed(1)} KB</span></div>`;
  });
}

function detectLocation() {
  if (!navigator.geolocation) { toast('Geolocation not supported','error'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    $('pm_loc').value = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
    toast('Location detected','success');
  }, () => toast('Could not detect location','error'));
}

function togglePostVoice() {
  postVoiceRecording = !postVoiceRecording;
  const btn = $('voiceRecBtn');
  btn.classList.toggle('recording', postVoiceRecording);
  btn.innerHTML = postVoiceRecording ? '<i class="fas fa-stop"></i> Stop Recording' : '<i class="fas fa-microphone"></i> Record Voice';
  $('pm_voiceStatus').style.display = postVoiceRecording ? '' : 'none';
  if (!postVoiceRecording) toast('Voice note saved','success');
}

function savePost(postId) {
  const data = {
    title:$('pm_title').value.trim(), 
    catId:+$('pm_cat').value,
    visibility:$('pm_vis').value, 
    content:$('pm_content').value.trim(),
    location:$('pm_loc').value.trim(), 
    assignedIds:[...postAssignees], 
    files:[],
  };
  if (!data.title) { toast('Title required','error'); return; }
  if (postId) {
    const p = DB.posts.find(x=>x.id===postId);
    Object.assign(p, data);
    logAction('update',`Post #${postId}`,`Updated "${data.title}"`);
  } else {
    DB.posts.push({id:generateId('posts'),...data, authorId:currentUser.id, created:nowStr().slice(0,10), status:'published', views:0});
    logAction('create','Post',`Created "${data.title}"`);
  }
  closeM('postModal'); 
  filterAndUpdatePosts(); // Updated to use paginated version
  toast('Post saved','success');
}

function deletePost(id) {
  if (!confirm('Delete this post?')) return;
  DB.posts.splice(DB.posts.findIndex(p=>p.id===id),1);
  logAction('delete',`Post #${id}`,'Post deleted'); 
  filterAndUpdatePosts(); // Updated to use paginated version
  toast('Post deleted','success');
}

/* ============================================================
   17. CATEGORIES PAGE
   ============================================================ */
function renderCategories() {
  renderCatList();
  renderCatChart();
  $('addCatBtn')?.addEventListener('click', () => openM('addCatModal'));
  $('addCatSaveBtn')?.addEventListener('click', addCategory);
}

function renderCatList() {
  $('catList').innerHTML = DB.categories.map(c => `
    <div class="cat-item">
      <div class="ci-color" style="background:${c.color};"></div>
      <i class="fas ${c.icon}" style="color:${c.color};font-size:0.85rem;"></i>
      <span class="ci-name">${c.name}</span>
      <span style="font-size:0.72rem;color:var(--text3);">${DB.posts.filter(p=>p.catId===c.id).length} posts</span>
      <button class="abt dan" onclick="deleteCat(${c.id})"><i class="fas fa-trash"></i></button>
    </div>`).join('') || '<div class="empty-state"><i class="fas fa-tags"></i>No categories</div>';
}

function renderCatChart() {
  const labels = DB.categories.map(c=>c.name);
  const data   = DB.categories.map(c=>DB.posts.filter(p=>p.catId===c.id).length);
  const colors = DB.categories.map(c=>c.color+'cc');
  makeChart('catChart',{
    type:'doughnut',
    data:{labels, datasets:[{data, backgroundColor:colors, borderWidth:0}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{color:chartTextColor(),font:{family:'DM Sans',size:11}}}}, cutout:'60%'}
  });
}

function addCategory() {
  const name = $('cat_name').value.trim();
  const color= $('cat_color').value;
  const icon = $('cat_icon').value.trim() || 'fa-tag';
  if (!name) { toast('Name required','error'); return; }
  DB.categories.push({id:generateId('categories'),name,color,icon});
  logAction('create','Category',`Created "${name}"`);
  closeM('addCatModal');
  renderCatList(); renderCatChart(); populateCatFilter();
  $('cat_name').value=''; toast('Category added','success');
}

function deleteCat(id) {
  if (!confirm('Delete this category?')) return;
  DB.categories.splice(DB.categories.findIndex(c=>c.id===id),1);
  renderCatList(); renderCatChart(); toast('Category deleted','success');
}

/* ============================================================
   18. MESSAGES PAGE
   ============================================================ */
function renderMessages() {
  renderGroupList();
  $('createGroupBtn')?.addEventListener('click', openCreateGroupModal);
  $('sendChatBtn')?.addEventListener('click', sendMessage);
  $('chatTxt')?.addEventListener('keydown', e => { if(e.key==='Enter') sendMessage(); });
  $('chatMembersBtn')?.addEventListener('click', openGroupMembers);
  $('chatDeleteBtn')?.addEventListener('click', deleteCurrentGroup);
  $('chatAttachBtn')?.addEventListener('click', () => $('msgFileInput').click());
  $('chatVideoBtn')?.addEventListener('click', () => $('msgVideoInput').click());
  $('voiceNoteBtn')?.addEventListener('click', () => toast('Voice note recording (demo)','info'));
}

function renderGroupList() {
  const box = $('gListBox'); if(!box) return;
  box.innerHTML = DB.groups.map(g => {
    const msgs = DB.messages[g.id]||[];
    const last = msgs[msgs.length-1];
    const active = currentGroup?.id === g.id ? ' active' : '';
    return `<div class="g-item${active}" onclick="selectGroup(${g.id})">
      <div class="gi-icon" style="background:var(--accent-glow);font-size:1.1rem;">${g.icon}</div>
      <div class="gi-info">
        <div class="gi-name">${g.name}</div>
        <div class="gi-last">${last?userById(last.authorId)?.name+': '+last.text.slice(0,30):'No messages'}</div>
      </div>
      ${msgs.length?`<div class="gi-cnt">${msgs.length}</div>`:''}
    </div>`;
  }).join('') || '<div class="empty-state"><i class="fas fa-comments"></i>No groups</div>';
  if (!currentGroup && DB.groups.length) selectGroup(DB.groups[0].id);
}

function selectGroup(id) {
  currentGroup = DB.groups.find(g=>g.id===id);
  renderGroupList();
  $('chatGName').textContent = currentGroup?.name || 'Select Group';
  $('chatGMeta').textContent = `${currentGroup?.memberIds.length||0} members`;
  $('chatGIcon').textContent = currentGroup?.icon || '💬';
  renderChatMsgs();
}

function renderChatMsgs() {
  const msgs = DB.messages[currentGroup?.id] || [];
  $('chatMsgsBox').innerHTML = msgs.map(m => {
    const u = userById(m.authorId);
    const mine = m.authorId === currentUser.id;
    return `<div class="msg-bbl${mine?' mine':''}">
      ${avatarEl(u,30)}
      <div class="bbl-body">
        <div class="bbl-content">${m.text}</div>
        <div class="bbl-meta">${u?.name} · ${m.time}</div>
      </div>
    </div>`;
  }).join('') || '<div class="empty-state"><i class="fas fa-comment-slash"></i>No messages yet</div>';
  const box = $('chatMsgsBox');
  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const txt = $('chatTxt')?.value.trim();
  if (!txt || !currentGroup) return;
  const msgs = DB.messages[currentGroup.id] = DB.messages[currentGroup.id] || [];
  msgs.push({ id:msgs.length+1, groupId:currentGroup.id, authorId:currentUser.id, text:txt, time:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}), files:[] });
  $('chatTxt').value = '';
  renderChatMsgs();
  renderGroupList();
}

function openCreateGroupModal() {
  const box = $('cg_members'); if(!box) return;
  box.innerHTML = DB.users.map(u=>`<label style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem;border-radius:7px;cursor:pointer;font-size:0.82rem;">
    <input type="checkbox" value="${u.id}" checked> ${avatarEl(u,24)} ${u.name}</label>`).join('');
  $('cgMemberSearch')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    box.querySelectorAll('label').forEach(l => l.style.display = l.textContent.toLowerCase().includes(q)?'':'none');
  });
  $('cg_name').value = $('cg_icon').value = $('cg_desc').value = '';
  $('cgCreateBtn').onclick = createGroup;
  openM('cgModal');
}

function createGroup() {
  const name = $('cg_name').value.trim();
  if (!name) { toast('Group name required','error'); return; }
  const memberIds = [...$('cg_members').querySelectorAll('input:checked')].map(i=>+i.value);
  const g = { id:generateId('groups'), name, icon:$('cg_icon').value||'💬', desc:$('cg_desc').value, memberIds };
  DB.groups.push(g);
  DB.messages[g.id] = [];
  logAction('create','Group',`Created "${name}"`);
  closeM('cgModal'); renderGroupList(); toast('Group created','success');
}

function openGroupMembers() {
  if (!currentGroup) return;
  $('gmBody').innerHTML = `<div style="display:flex;flex-direction:column;gap:0.35rem;">` +
    currentGroup.memberIds.map(id=>{const u=userById(id);return `<div class="user-cell" style="padding:0.35rem;">${avatarEl(u,30)}<div><div style="font-weight:600;font-size:0.83rem;">${u?.name}</div><div style="font-size:0.72rem;color:var(--text3);">${u?.role}</div></div></div>`;}).join('')
  + `</div>`;
  openM('gmModal');
}

function deleteCurrentGroup() {
  if (!currentGroup || !confirm('Delete this group?')) return;
  DB.groups.splice(DB.groups.findIndex(g=>g.id===currentGroup.id),1);
  delete DB.messages[currentGroup.id];
  currentGroup = null;
  renderGroupList();
  $('chatGName').textContent = 'Select Group';
  $('chatGMeta').textContent = '';
  $('chatMsgsBox').innerHTML = '';
  toast('Group deleted','success');
}

/* ============================================================
   19. ANALYTICS PAGE
   ============================================================ */
function renderAnalytics() {
  const activeUsers = DB.users.filter(u=>u.status==='active').length;
  const totalTasks  = DB.tasks.length;
  const doneTasks   = DB.tasks.filter(t=>t.status==='done').length;
  $('anStatsGrid').innerHTML =
    statCard('fa-users','blue', activeUsers, 'Active Users','','flat') +
    statCard('fa-list-check','green', `${doneTasks}/${totalTasks}`, 'Tasks Done','','flat') +
    statCard('fa-building','yellow', DB.sites.filter(s=>s.status==='active').length, 'Active Sites','','flat') +
    statCard('fa-triangle-exclamation','red', DB.incidents.length, 'Total Incidents','','flat');

  setTimeout(() => {
    makeChart('anMonthly',{
      type:'line',
      data:{ labels:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        datasets:[{label:'Tasks Completed',data:[8,12,9,15,11,18,14,20,16,22,19,25], borderColor:'#eab308', backgroundColor:'rgba(234,179,8,0.08)', fill:true, tension:0.4}] },
      options:{...chartDefaults(),plugins:{legend:{display:false}}}
    });
    const statuses = ['todo','inprogress','review','done'];
    const counts   = statuses.map(s=>DB.tasks.filter(t=>t.status===s).length);
    makeChart('anStatus',{
      type:'pie',
      data:{labels:['To Do','In Progress','Review','Done'], datasets:[{data:counts, backgroundColor:['rgba(100,116,139,0.7)','rgba(234,179,8,0.7)','rgba(59,130,246,0.7)','rgba(16,185,129,0.7)'], borderWidth:0}]},
      options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{color:chartTextColor()}}}}
    });
    /* Top performers */
    const perfs = DB.users.map(u=>({user:u, done:DB.tasks.filter(t=>t.assigneeId===u.id&&t.status==='done').length})).sort((a,b)=>b.done-a.done).slice(0,5);
        $('topPerf').innerHTML = perfs.map((p,i)=>`<div class="perf-row"><span class="perf-rank">${i+1}</span>${avatarEl(p.user,30)}<div style="flex:1;"><div style="font-size:0.83rem;font-weight:600;">${p.user.name}</div><div style="font-size:0.72rem;color:var(--text3);">${p.user.role}</div></div><span style="font-family:'Space Grotesk',sans-serif;font-weight:700;color:var(--accent);">${p.done} tasks</span></div>`).join('');
    /* Site progress */
    makeChart('anSites',{
      type:'bar',
      data:{ labels:DB.sites.map(s=>s.name.length>15?s.name.slice(0,15)+'…':s.name), datasets:[{label:'Progress %', data:DB.sites.map(s=>s.progress), backgroundColor:'rgba(234,179,8,0.75)', borderRadius:6}] },
      options:{...chartDefaults(), indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{...chartDefaults().scales.x,max:100},y:chartDefaults().scales.y}}
    });
  },100);
}

/* ============================================================
   20. LEAVE MANAGEMENT
   ============================================================ */
function renderLeave() {
  wireLeaveTabs();
  filterAndUpdateLeaveRequests();
  filterAndUpdateLeaveBalances();
  filterAndUpdateHolidays();
  renderLeaveCalendar();
  $('lvExport')?.addEventListener('click',()=>exportCSV(DB.leaveRequests.map(l=>({...l, userName:userById(l.userId)?.name})),'leave_requests.csv'));
  $('addHolidayBtn')?.addEventListener('click', addHoliday);
  ['lvStatus','lvType','lvFrom','lvTo'].forEach(id => $(id)?.addEventListener('change', filterAndUpdateLeaveRequests));
}

function wireLeaveTabs() {
  const panels = {'requests':'lv-requests','balances':'lv-balances','calendar':'lv-calendar','holidays':'lv-holidays'};
  $$('[data-lvtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-lvtab]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      Object.values(panels).forEach(id=>{ const el=$(id); if(el) el.style.display='none'; });
      const target = $(panels[btn.dataset.lvtab]);
      if(target) target.style.display='';
      
      // Refresh pagination when switching tabs
      if (btn.dataset.lvtab === 'requests') {
        filterAndUpdateLeaveRequests();
      } else if (btn.dataset.lvtab === 'balances') {
        filterAndUpdateLeaveBalances();
      } else if (btn.dataset.lvtab === 'holidays') {
        filterAndUpdateHolidays();
      }
    });
  });
}

// ========== LEAVE REQUESTS TABLE ==========
function filterAndUpdateLeaveRequests() {
  const st   = $('lvStatus')?.value||'';
  const type = $('lvType')?.value||'';
  const from = $('lvFrom')?.value||'';
  const to   = $('lvTo')?.value||'';
  
  const filteredRequests = DB.leaveRequests.filter(l => {
    if(st   && l.status !== st)   return false;
    if(type && l.type !== type)   return false;
    if(from && l.from < from)     return false;
    if(to   && l.to > to)         return false;
    return true;
  });
  
  createPaginator('lvTbody', filteredRequests, (data) => {
    renderLeaveTableBody(data);
  }, { perPage: 10 });
}

function renderLeaveTableBody(requests) {
  $('lvTbody').innerHTML = requests.length ? requests.map(l => {
    const u = userById(l.userId);
    return `
      <tr>
        <td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name}</span></div></td>
        <td><span class="badge b-update">${l.type}</span></td>
        <td>${fmt(l.from)}</td><td>${fmt(l.to)}</td><td>${l.days}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.reason}</td>
        <td>${statusBadge(l.status)}</td>
        <td style="font-size:0.75rem;">${fmt(l.applied)}</td>
        <td>
          ${l.status === 'pending' ? `
            <button class="abt suc" title="Approve" onclick="openLeaveDecision(${l.id},'approve')"><i class="fas fa-check"></i></button>
            <button class="abt dan" title="Reject" onclick="openLeaveDecision(${l.id},'reject')"><i class="fas fa-times"></i></button>
          ` : '<span style="color:var(--text3);font-size:0.75rem;">—</span>'}
         </td>
      </tr>`;
  }).join('') : '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-calendar"></i>No leave requests found</div></td></tr>';
}

// ========== LEAVE BALANCES TABLE ==========
function filterAndUpdateLeaveBalances() {
  const activeUsers = DB.users.filter(u => u.status === 'active');
  
  createPaginator('lvBalTbody', activeUsers, (data) => {
    renderLeaveBalancesBody(data);
  }, { perPage: 10 });
}

function renderLeaveBalancesBody(users) {
  $('lvBalTbody').innerHTML = users.length ? users.map(u => {
    const b = DB.leaveBalance[u.id] || {annual:20, sick:10, emergency:5, annualUsed:0, sickUsed:0, emergencyUsed:0, unpaidUsed:0};
    return `
      <tr>
        <td><div class="user-cell">${avatarEl(u,26)}<span>${u.name}</span></div></td>
        <td>${b.annual - b.annualUsed} / ${b.annual}</td>
        <td>${b.sick - b.sickUsed} / ${b.sick}</td>
        <td>${b.emergency - b.emergencyUsed} / ${b.emergency}</td>
        <td>${b.unpaidUsed}</td>
        <td>${b.annualUsed + b.sickUsed + b.emergencyUsed + b.unpaidUsed}</td>
      </tr>`;
  }).join('') : '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-users"></i>No active users found</div></td></tr>';
}

// ========== PUBLIC HOLIDAYS TABLE ==========
function filterAndUpdateHolidays() {
  createPaginator('holidayTbody', DB.holidays, (data) => {
    renderHolidaysBody(data);
  }, { perPage: 10 });
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

// ========== LEAVE DECISION FUNCTIONS ==========
function openLeaveDecision(leaveId, action) {
  const l = DB.leaveRequests.find(x=>x.id===leaveId);
  const u = userById(l?.userId);
  $('ldTitle').textContent = action === 'approve' ? 'Approve Leave' : 'Reject Leave';
  $('ldInfo').innerHTML = `<strong>${u?.name}</strong> — ${l?.type} leave · ${l?.days} day(s) · ${fmt(l?.from)} to ${fmt(l?.to)}<br><em style="color:var(--text3);font-size:0.8rem;">${l?.reason}</em>`;
  $('ldComment').value = '';
  $('ldApproveBtn').onclick = () => decideLeave(leaveId, 'approved');
  $('ldRejectBtn').onclick  = () => decideLeave(leaveId, 'rejected');
  openM('leaveDecisionModal');
}

function decideLeave(leaveId, decision) {
  const l = DB.leaveRequests.find(x=>x.id===leaveId);
  const u = userById(l?.userId);
  l.status = decision; 
  l.comment = $('ldComment')?.value || '';
  logAction(decision === 'approved' ? 'approve' : 'reject', `Leave #${leaveId}`, `${decision} for ${u?.name}`);
  sendEmail(u?.email || '', `Leave ${decision}`, 'leave_decision');
  closeM('leaveDecisionModal'); 
  filterAndUpdateLeaveRequests();
  filterAndUpdateLeaveBalances();
  toast(`Leave ${decision}`, 'success');
}

// ========== LEAVE CALENDAR ==========
function renderLeaveCalendar() {
  const label = $('lvCalLabel'), body = $('lvCalBody'); 
  if(!label||!body) return;
  const y = leaveCalDate.getFullYear(), m = leaveCalDate.getMonth();
  label.textContent = leaveCalDate.toLocaleString('default',{month:'long', year:'numeric'});
  const firstDay = new Date(y,m,1).getDay();
  const daysInMonth = new Date(y,m+1,0).getDate();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = '<div class="leave-cal">' + dayNames.map(d=>`<div class="cal-day-hdr">${d}</div>`).join('');
  for(let i=0;i<firstDay;i++) html += `<div class="cal-day other-month"></div>`;
  const today = new Date();
  for(let d=1;d<=daysInMonth;d++){
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = y===today.getFullYear()&&m===today.getMonth()&&d===today.getDate();
    const leaves = DB.leaveRequests.filter(l=>l.from<=dateStr&&l.to>=dateStr&&l.status==='approved');
    const holiday = DB.holidays.find(h=>h.date===dateStr);
    html += `<div class="cal-day${isToday?' today':''}">
      <div class="cal-day-num">${d}</div>
      ${holiday?`<div class="cal-leave-tag" style="background:rgba(234,179,8,0.2);color:var(--accent);">${holiday.name}</div>`:''}
      ${leaves.map(l=>{const u=userById(l.userId);return `<div class="cal-leave-tag" style="background:rgba(59,130,246,0.15);color:#60a5fa;">${u?.name?.split(' ')[0]}</div>`;}).join('')}
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
  
  $('lvCalPrev')?.removeEventListener('click', handlePrevMonth);
  $('lvCalNext')?.removeEventListener('click', handleNextMonth);
  $('lvCalPrev')?.addEventListener('click', handlePrevMonth);
  $('lvCalNext')?.addEventListener('click', handleNextMonth);
}

function handlePrevMonth() {
  leaveCalDate.setMonth(leaveCalDate.getMonth() - 1);
  renderLeaveCalendar();
}

function handleNextMonth() {
  leaveCalDate.setMonth(leaveCalDate.getMonth() + 1);
  renderLeaveCalendar();
}

// ========== HOLIDAY MANAGEMENT ==========
function addHoliday() {
  const name = prompt('Holiday name:'); 
  if(!name) return;
  const date = prompt('Date (YYYY-MM-DD):'); 
  if(!date) return;
  const type = prompt('Type (National/Cultural/Religious):', 'National')||'National';
  DB.holidays.push({id:generateId('holidays'), name, date, type});
  filterAndUpdateHolidays();
  renderLeaveCalendar();
  toast('Holiday added','success');
}

function deleteHoliday(id) { 
  DB.holidays.splice(DB.holidays.findIndex(h=>h.id===id),1); 
  filterAndUpdateHolidays();
  renderLeaveCalendar();
  toast('Holiday deleted','success');
}

/* ============================================================
   21. TIMESHEETS
   ============================================================ */
function renderTimesheets() {
  populateWeekSelect('tsWeek');
  const userSel = $('tsUser');
  if(userSel) userSel.innerHTML = '<option value="">All Employees</option>' + DB.users.filter(u=>u.role!=='admin').map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  renderTimesheetTable();
  ['tsUser','tsWeek','tsStatus2'].forEach(id=>$(id)?.addEventListener('change',renderTimesheetTable));
  $('tsExport')?.addEventListener('click',()=>exportCSV(DB.timesheets.map(t=>({...t,userName:userById(t.userId)?.name})),'timesheets.csv'));
}

function populateWeekSelect(elId) {
  const el = $(elId); if(!el) return;
  const weeks = [];
  for(let i=0;i<8;i++){
    const d = new Date(); d.setDate(d.getDate()-i*7);
    const y = d.getFullYear();
    const w = String(getISOWeek(d)).padStart(2,'0');
    weeks.push(`${y}-W${w}`);
  }
  el.innerHTML = [...new Set(weeks)].map(w=>`<option value="${w}">${w}</option>`).join('');
}

function getISOWeek(d) {
  const date = new Date(d); date.setHours(0,0,0,0);
  date.setDate(date.getDate()+3-(date.getDay()+6)%7);
  const week1=new Date(date.getFullYear(),0,4);
  return 1+Math.round(((date-week1)/86400000-3+(week1.getDay()+6)%7)/7);
}

function renderTimesheetTable() {
  const userId = +$('tsUser')?.value||0;
  const week   = $('tsWeek')?.value||'';
  const status = $('tsStatus2')?.value||'';
  const rows   = DB.timesheets.filter(t=>{
    if(userId && t.userId!==userId) return false;
    if(week   && t.week!==week)   return false;
    if(status && t.status!==status) return false;
    return true;
  });
  const total = rows.reduce((s,t)=>s+(t.mon+t.tue+t.wed+t.thu+t.fri+t.sat+t.sun),0);
  const ot    = rows.reduce((s,t)=>{ const hrs=t.mon+t.tue+t.wed+t.thu+t.fri+t.sat+t.sun; return s+(hrs>40?hrs-40:0); },0);
  $('tsStats').innerHTML =
    statCard('fa-clock','blue', total+'h', 'Total Hours','','flat') +
    statCard('fa-fire','orange', ot+'h', 'Overtime','','flat') +
    statCard('fa-check','green', rows.filter(r=>r.status==='approved').length, 'Approved','','flat') +
    statCard('fa-hourglass','yellow', rows.filter(r=>r.status==='pending').length, 'Pending','','flat');
  $('tsTbody').innerHTML = rows.map(t=>{
    const u=userById(t.userId);
    const total=t.mon+t.tue+t.wed+t.thu+t.fri+t.sat+t.sun;
    const ot=total>40?total-40:0;
    return `<tr>
      <td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name}</span></div></td>
      <td style="font-size:0.75rem;">${t.week}</td>
      ${[t.mon,t.tue,t.wed,t.thu,t.fri,t.sat,t.sun].map(h=>`<td style="text-align:center;${h===0?'color:var(--text3);':''}">${h||'—'}</td>`).join('')}
      <td style="font-weight:700;text-align:center;">${total}h</td>
      <td style="text-align:center;color:${ot>0?'#f97316':'var(--text3)'};">${ot>0?ot+'h':'—'}</td>
      <td>${statusBadge(t.status)}</td>
      <td>
        ${t.status==='pending'?`
          <button class="abt suc" title="Approve" onclick="decideTimesheet(${t.id},'approved')"><i class="fas fa-check"></i></button>
          <button class="abt dan" title="Reject"  onclick="decideTimesheet(${t.id},'rejected')"><i class="fas fa-times"></i></button>
        `:'<span style="color:var(--text3);">—</span>'}
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="13"><div class="empty-state"><i class="fas fa-clock"></i>No timesheets found</div></td></tr>';
}

function decideTimesheet(id, decision) {
  const t=DB.timesheets.find(x=>x.id===id); if(!t) return;
  t.status=decision; renderTimesheetTable(); toast(`Timesheet ${decision}`,'success');
}

/* ============================================================
   22. PAYROLL
   ============================================================ */
function netPay(p) { return p.baseSalary + p.overtime + p.bonus + p.allowances - p.deductions; }

function renderPayroll() {
  populatePeriodSelect();
  filterAndUpdatePayroll();
  $('prExport')?.addEventListener('click', () => exportCSV(DB.payroll.map(p => ({...p, userName: userById(p.userId)?.name, netPay: netPay(p)})), 'payroll.csv'));
  $('prProcess')?.addEventListener('click', processPayroll);
  ['prPeriod', 'prStatus'].forEach(id => $(id)?.addEventListener('change', filterAndUpdatePayroll));
}

function populatePeriodSelect() {
  const el = $('prPeriod'); 
  if (!el) return;
  const periods = ['2025-07', '2025-06', '2025-05', '2025-04'];
  el.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');
  el.value = currentPayrollPeriod;
}

function filterAndUpdatePayroll() {
  const period = $('prPeriod')?.value || currentPayrollPeriod;
  const status = $('prStatus')?.value || '';
  
  // Filter data
  const filteredPayroll = DB.payroll.filter(p => {
    if (p.period !== period) return false;
    if (status && p.status !== status) return false;
    return true;
  });
  
  // Update stats based on ALL filtered data (not just current page)
  updatePayrollStats(filteredPayroll);
  
  // Create paginator for the table
  if (filteredPayroll.length > 0) {
    createPaginator('prTbody', filteredPayroll, (data) => {
      renderPayrollTableBody(data);
    }, { perPage: 10 });
  } else {
    // If no data, show empty state
    $('prTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-money-bill-wave"></i>No payroll data found</div></td></tr>';
    // Remove any existing pagination
    const existingPagination = document.getElementById('pagination-prTbody');
    if (existingPagination) existingPagination.remove();
  }
}

function updatePayrollStats(payrollData) {
  const totalNet = payrollData.reduce((s, p) => s + netPay(p), 0);
  const totalBase = payrollData.reduce((s, p) => s + p.baseSalary, 0);
  const totalOvertime = payrollData.reduce((s, p) => s + p.overtime, 0);
  
  $('prStats').innerHTML =
    statCard('fa-users', 'blue', payrollData.length, 'Employees', '', 'flat') +
    statCard('fa-money-bill', 'green', fmtMoney(totalBase), 'Base Total', '', 'flat') +
    statCard('fa-fire', 'orange', fmtMoney(totalOvertime), 'Overtime Total', '', 'flat') +
    statCard('fa-coins', 'yellow', fmtMoney(totalNet), 'Net Payroll', '', 'flat');
}

function renderPayrollTableBody(payrollRows) {
  if (!payrollRows.length) {
    $('prTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-money-bill-wave"></i>No payroll data found</div></td></tr>';
    return;
  }
  
  $('prTbody').innerHTML = payrollRows.map(p => {
    const u = userById(p.userId);
    return `
      <tr>
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

// Keep original function for compatibility (if called elsewhere)
function renderPayrollTable() {
  filterAndUpdatePayroll();
}

function processPayroll() {
  const period = $('prPeriod')?.value || currentPayrollPeriod;
  const payrollEntries = DB.payroll.filter(p => p.period === period && p.status === 'draft');
  
  if (payrollEntries.length === 0) {
    toast('No draft payroll entries found for this period', 'warn');
    return;
  }
  
  if (confirm(`Process ${payrollEntries.length} payroll entries for period ${period}?`)) {
    payrollEntries.forEach(p => p.status = 'processed');
    filterAndUpdatePayroll(); // Refresh the view
    toast(`${payrollEntries.length} payroll entries processed`, 'success');
    logAction('update', 'Payroll', `Period ${period} processed with ${payrollEntries.length} entries`);
  }
}

function openPayslip(prId) {
  const p = DB.payroll.find(x => x.id === prId); 
  if (!p) return;
  const u = userById(p.userId);
  
  $('payslipBody').innerHTML = `
    <div class="payslip-wrap">
      <div class="payslip-hdr">
        <div>
          <div style="font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:1.1rem;">NIXERS.pro</div>
          <div style="font-size:0.75rem;color:var(--text3);">Payslip — ${p.period}</div>
        </div>
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
  if (u?.email) {
    sendEmail(u.email, 'Your Payslip is Ready', 'payslip');
    toast(`Payslip emailed to ${u.name}`, 'success');
  } else {
    toast('No email address found for this employee', 'error');
  }
}

/* ============================================================
   23. TASKS & PROJECTS
   ============================================================ */
function renderTasks() {
  populateProjectSelects();
  wireTTabs();
  filterAndUpdateProjects(); // Changed from renderProjectTable()
  renderKanban();
  renderGantt();
  if ($('addProjectBtn')) $('addProjectBtn').onclick = () => openProjectModal();
  if ($('projSearch')) $('projSearch').oninput = filterAndUpdateProjects;
  if ($('projStatus')) $('projStatus').onchange = filterAndUpdateProjects;
  ['kanbanProject','kanbanAssignee','kanbanPriority'].forEach(id => { if ($(id)) $(id).onchange = renderKanban; });
  $$('.kanban-add-btn').forEach(btn => { btn.onclick = () => openTaskModal(null, btn.dataset.col); });
}

function populateProjectSelects() {
  const kp=$('kanbanProject'); if(kp) kp.innerHTML='<option value="">All Projects</option>'+DB.projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const ka=$('kanbanAssignee'); if(ka) ka.innerHTML='<option value="">All Assignees</option>'+DB.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  const tmProj=$('tm_project'); if(tmProj) tmProj.innerHTML=DB.projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const projSite=$('proj_site'); if(projSite) projSite.innerHTML='<option value="">None</option>'+DB.sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
}

function renderAssignTags(ids, targetId, removeFn) {
  const target = $(targetId);
  if (!target) return;
  target.innerHTML = ids.map(id => {
    const u = userById(id);
    return `<div class="assign-tag">${u?.name || id}<button onclick="${removeFn}(${id})">×</button></div>`;
  }).join('');
}

function searchProjectTeam(q='') {
  const res = $('proj_teamResults');
  if (!res) return;
  const query = q.trim().toLowerCase();
  const options = DB.users.filter(u => !projectTeamMembers.includes(u.id) && (!query || u.name.toLowerCase().includes(query)));
  res.innerHTML = options.map(u=>`<div class="assign-opt" onclick="addProjectTeamMember(${u.id})">${avatarEl(u,24)}<span>${u.name}</span></div>`).join('') || '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.add('show');
}

function addProjectTeamMember(id) {
  if (!projectTeamMembers.includes(id)) projectTeamMembers.push(id);
  renderAssignTags(projectTeamMembers, 'proj_teamTags', 'removeProjectTeamMember');
  $('proj_teamResults')?.classList.remove('show');
  if ($('proj_teamSearch')) $('proj_teamSearch').value = '';
}

function removeProjectTeamMember(id) {
  projectTeamMembers = projectTeamMembers.filter(x => x !== id);
  renderAssignTags(projectTeamMembers, 'proj_teamTags', 'removeProjectTeamMember');
}

function searchTaskAssignees(q='') {
  const res = $('tm_assigneeResults');
  if (!res) return;
  const query = q.trim().toLowerCase();
  const options = DB.users.filter(u => !taskAssignees.includes(u.id) && (!query || u.name.toLowerCase().includes(query)));
  res.innerHTML = options.map(u=>`<div class="assign-opt" onclick="addTaskAssignee(${u.id})">${avatarEl(u,24)}<span>${u.name}</span></div>`).join('') || '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.add('show');
}

function addTaskAssignee(id) {
  if (!taskAssignees.includes(id)) taskAssignees.push(id);
  renderAssignTags(taskAssignees, 'tm_assigneeTags', 'removeTaskAssignee');
  $('tm_assigneeResults')?.classList.remove('show');
  if ($('tm_assigneeSearch')) $('tm_assigneeSearch').value = '';
}

function removeTaskAssignee(id) {
  taskAssignees = taskAssignees.filter(x => x !== id);
  renderAssignTags(taskAssignees, 'tm_assigneeTags', 'removeTaskAssignee');
}

function renderTaskAttachments() {
  const box = $('tm_attFiles');
  if (!box) return;
  box.innerHTML = taskAttachments.map((f, i) => `<div class="af-item"><i class="fas fa-file"></i><span>${f.name}</span><button class="abt dan" onclick="removeTaskAttachment(${i})"><i class="fas fa-times"></i></button></div>`).join('') || '<div style="font-size:0.78rem;color:var(--text3);">No attachments added</div>';
}

function removeTaskAttachment(index) {
  taskAttachments.splice(index, 1);
  renderTaskAttachments();
}

function toggleTaskVoice() {
  taskVoiceRecording = !taskVoiceRecording;
  const btn = $('tm_voiceBtn');
  if (btn) btn.classList.toggle('recording', taskVoiceRecording);
  if (btn) btn.innerHTML = taskVoiceRecording ? '<i class="fas fa-stop"></i> Stop Recording' : '<i class="fas fa-microphone"></i> Record Voice';
  if ($('tm_voiceStatus')) $('tm_voiceStatus').style.display = taskVoiceRecording ? '' : 'none';
  toast(taskVoiceRecording ? 'Voice recording started (demo)' : 'Voice recording stopped', 'info');
}

function wireTTabs() {
  const panels={'projects':'tt-projects','kanban':'tt-kanban','gantt':'tt-gantt'};
  $$('[data-ttab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('[data-ttab]').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el)el.style.display='none';});
      const target=$(panels[btn.dataset.ttab]); if(target) target.style.display='';
    });
  });
}

// NEW: Function to filter projects and apply pagination
function filterAndUpdateProjects() {
  const q = $('projSearch')?.value.toLowerCase() || '';
  const st = $('projStatus')?.value || '';
  
  const filteredProjects = DB.projects.filter(p => {
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (st && p.status !== st) return false;
    return true;
  });
  
  // Create paginator for projects table
  createPaginator('projTbody', filteredProjects, (data) => {
    renderProjectTableBody(data);
  }, { perPage: 10 });
}

// NEW: Function to render only the table body (without pagination logic)
function renderProjectTableBody(projects) {
  if (!projects.length) {
    $('projTbody').innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-folder-open"></i>No projects found</div></td></tr>';
    return;
  }
  
  $('projTbody').innerHTML = projects.map(p => {
    const tasks = DB.tasks.filter(t => t.projectId === p.id);
    const done = tasks.filter(t => t.status === 'done').length;
    return `
      <tr>
        <td style="font-weight:600;">${p.name}</td>
        <td>
          <div style="display:flex;gap:-6px;">
            ${(p.teamIds || []).slice(0,3).map(id => avatarEl(userById(id), 26)).join('')}
            ${(p.teamIds || []).length > 3 ? `<span style="font-size:0.72rem;color:var(--text3);padding-left:4px;">+${p.teamIds.length - 3}</span>` : ''}
          </div>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:0.5rem;min-width:80px;">
            <div class="pb" style="flex:1;height:6px;"><div class="pb-fill" style="width:${p.progress}%;"></div></div>
            <span style="font-size:0.72rem;">${p.progress}%</span>
          </div>
        </td>
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

// Keep original function for compatibility (if called elsewhere)
function renderProjectTable() {
  filterAndUpdateProjects();
}

function openProjectModal(projId=null) {
  populateProjectSelects();
  const p = projId ? projectById(projId) : null;
  $('projTitle').textContent = p ? 'Edit Project' : 'New Project';
  $('proj_name').value = p?.name || '';
  $('proj_status').value = p?.status || 'planning';
  $('proj_priority').value = p?.priority || 'medium';
  $('proj_due').value = p?.dueDate || '';
  $('proj_site').value = p?.siteId || '';
  $('proj_desc').value = p?.desc || '';
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
  const data = {
    name: $('proj_name').value.trim(),
    status: $('proj_status').value,
    priority: $('proj_priority').value,
    dueDate: $('proj_due').value,
    desc: $('proj_desc').value.trim(),
    siteId: +$('proj_site')?.value || null,
    teamIds: [...projectTeamMembers],
    progress: current?.progress || 0
  };
  if (!data.name) { toast('Name required', 'error'); return; }
  if (projId) {
    Object.assign(projectById(projId), data);
    logAction('update', `Project #${projId}`, `Updated ${data.name}`);
  } else {
    DB.projects.push({ id: generateId('projects'), ...data });
    logAction('create', 'Project', `Created ${data.name}`);
  }
  closeM('projectModal');
  filterAndUpdateProjects(); // Refresh with pagination
  renderKanban();
  renderGantt();
  toast('Project saved', 'success');
}

function deleteProject(id) {
  if (!confirm('Delete this project?')) return;
  DB.projects.splice(DB.projects.findIndex(p => p.id === id), 1);
  DB.tasks = DB.tasks.filter(t => t.projectId !== id);
  filterAndUpdateProjects(); // Refresh with pagination
  renderKanban();
  toast('Project deleted', 'success');
}

function renderKanban() {
  const cols=['todo','inprogress','review','done'];
    const projectFilter = +($('kanbanProject')?.value || 0);
  const assigneeFilter = +($('kanbanAssignee')?.value || 0);
  const priorityFilter = $('kanbanPriority')?.value || '';
  cols.forEach(col=>{
    const cards=$(`kCards-${col}`); if(!cards) return;
       const tasks=DB.tasks.filter(t=>{
      if (t.status !== col) return false;
      if (projectFilter && t.projectId !== projectFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (assigneeFilter && !taskAssigneeIds(t).includes(assigneeFilter)) return false;
      return true;
    });
    $(`kc-${col}`).textContent=tasks.length;
    cards.innerHTML=tasks.map(t=>{
      const assignees = taskAssigneeIds(t).map(userById).filter(Boolean);
      const proj=projectById(t.projectId);
      return `<div class="kanban-card" onclick="openTaskModal(${t.id})">
        <div class="kc-title">${t.title}</div>
        ${proj?`<div style="font-size:0.7rem;color:var(--text3);margin-bottom:0.3rem;">${proj.name}</div>`:''}
        <div class="kc-meta">
          ${priorityBadge(t.priority)}
          ${t.dueDate?`<span style="font-size:0.68rem;color:var(--text3);">📅 ${fmt(t.dueDate)}</span>`:''}
          <div class="kc-assignee">${assignees.slice(0,2).map(u=>avatarEl(u,20)).join('')}${assignees.length>2?`<span>+${assignees.length-2}</span>`:''}</div>
        </div>
      </div>`;
    }).join('')||'<div style="text-align:center;padding:1rem;color:var(--text3);font-size:0.75rem;">Drop tasks here</div>';
  });
}

function openTaskModal(taskId=null, col='todo') {
  populateProjectSelects();
  const t=taskId?DB.tasks.find(x=>x.id===taskId):null;
  $('tmTitle').textContent=t?'Edit Task':'New Task';
  $('tm_title').value=t?.title||'';
  $('tm_project').value=t?.projectId||DB.projects[0]?.id||'';
  $('tm_priority').value=t?.priority||'medium';

  $('tm_due').value=t?.dueDate||'';
  $('tm_desc').value=t?.desc||'';
  $('tm_status').value=t?.status||col;
    taskAssignees = [...taskAssigneeIds(t)];
  taskAttachments = [...(t?.attachments || [])];
  taskVoiceRecording = false;
  renderAssignTags(taskAssignees, 'tm_assigneeTags', 'removeTaskAssignee');
  renderTaskAttachments();
  if ($('tm_assigneeSearch')) {
    $('tm_assigneeSearch').oninput = e => searchTaskAssignees(e.target.value);
    $('tm_assigneeSearch').onfocus = e => searchTaskAssignees(e.target.value);
  }
  if ($('tm_voiceBtn')) $('tm_voiceBtn').onclick = toggleTaskVoice;
  if ($('tm_attachBtn')) $('tm_attachBtn').onclick = () => $('tm_files')?.click();
  if ($('tm_files')) $('tm_files').onchange = e => {
    const files = [...(e.target.files || [])].map(f => ({name:f.name, size:f.size, type:f.type}));
    if (files.length) taskAttachments.push(...files);
    renderTaskAttachments();
    e.target.value = '';
  };
  $('tm_save').onclick=()=>saveTask(taskId);
  openM('taskModal');
}

function saveTask(taskId) {
  const assigneeIds = taskAssignees.length ? [...taskAssignees] : [DB.users[0]?.id].filter(Boolean);
  const data={title:$('tm_title').value.trim(),projectId:+$('tm_project').value,priority:$('tm_priority').value,assigneeId:assigneeIds[0]||null,assigneeIds,dueDate:$('tm_due').value,desc:$('tm_desc').value.trim(),status:$('tm_status').value,attachments:[...taskAttachments]};
  if(!data.title){toast('Title required','error');return;}
  if(taskId){Object.assign(DB.tasks.find(t=>t.id===taskId),data);logAction('update',`Task #${taskId}`,`Updated ${data.title}`);}
  else{
    DB.tasks.push({id:generateId('tasks'),...data});
       const assignedNames = assigneeIds.map(id=>userById(id)?.name).filter(Boolean).join(', ');
    logAction('create','Task',`Created "${data.title}" assigned to ${assignedNames || 'team'}`);
    assigneeIds.forEach(id => sendEmail(userById(id)?.email||'','New Task Assigned','task_assigned'));
  }
  closeM('taskModal');renderKanban();renderProjectTable();toast('Task saved','success');
}

function renderGantt() {
  const body=$('ganttBody'); if(!body) return;
  if(!DB.projects.length){body.innerHTML='<div class="empty-state"><i class="fas fa-timeline"></i>No projects</div>';return;}
  const allDates=DB.projects.flatMap(p=>[new Date(p.dueDate||new Date())]);
  const minDate=new Date(Math.min(...allDates)); minDate.setMonth(minDate.getMonth()-2);
  const maxDate=new Date(Math.max(...allDates)); maxDate.setMonth(maxDate.getMonth()+1);
  const totalDays=(maxDate-minDate)/86400000||1;
  const headerDays=Math.min(totalDays,12);
  const monthLabels=[];
  for(let i=0;i<headerDays;i++){const d=new Date(minDate);d.setDate(d.getDate()+i*Math.floor(totalDays/headerDays));monthLabels.push(d.toLocaleString('default',{month:'short'}));}
  body.innerHTML=`<div class="gantt-wrap"><table style="width:100%;border-collapse:collapse;">
    <thead><tr><th style="width:200px;text-align:left;padding:0.5rem;font-size:0.72rem;color:var(--text3);">Project</th>${monthLabels.map(m=>`<th style="font-size:0.72rem;color:var(--text3);padding:0.25rem;">${m}</th>`).join('')}</tr></thead>
    <tbody>${DB.projects.map(p=>{
      const due=new Date(p.dueDate||new Date());
      const start=new Date(due); start.setMonth(start.getMonth()-2);
      const leftPct=Math.max(0,((start-minDate)/86400000/totalDays)*100);
      const widthPct=Math.max(5,((due-start)/86400000/totalDays)*100);
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:0.75rem 0.5rem;font-size:0.82rem;font-weight:500;white-space:nowrap;">${p.name.slice(0,25)}</td>
        <td colspan="${headerDays}" style="position:relative;height:40px;">
          <div style="position:absolute;left:${leftPct}%;width:${widthPct}%;top:8px;height:24px;background:rgba(234,179,8,0.75);border-radius:6px;display:flex;align-items:center;padding:0 0.5rem;font-size:0.68rem;font-weight:600;color:#0a0f1a;white-space:nowrap;overflow:hidden;">${p.name.slice(0,20)}</div>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

/* ============================================================
   24. SHIFT SCHEDULING
   ============================================================ */
const SHIFT_TYPES=['Morning','Afternoon','Night','Off'];
const SHIFT_KEYS=['morning','afternoon','night','off'];

function renderShifts() {
  const siteSel=$('shiftSite'); if(siteSel) siteSel.innerHTML='<option value="">All Sites</option>'+DB.sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  populateWeekSelect('shiftWeek');
  renderShiftGrid();
  renderShiftSwaps();
  $('shiftPrev')?.addEventListener('click',()=>{shiftWeekOffset--;renderShiftGrid();});
  $('shiftNext')?.addEventListener('click',()=>{shiftWeekOffset++;renderShiftGrid();});
  $('shiftExport')?.addEventListener('click',()=>toast('Shift schedule exported','success'));
}

function renderShiftGrid() {
  const grid=$('shiftGrid'); if(!grid) return;
  const workers=DB.users.filter(u=>u.role==='worker');
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const d=new Date(); d.setDate(d.getDate()-d.getDay()+1+shiftWeekOffset*7);
  const weekStart=new Date(d);
  $('shiftWeekLabel').textContent=`Week of ${weekStart.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`;
  grid.innerHTML=`<thead><tr><th>Worker</th>${days.map((day,i)=>{const dd=new Date(weekStart);dd.setDate(dd.getDate()+i);return`<th>${day}<br><span style="font-size:0.65rem;font-weight:400;">${dd.getDate()}/${dd.getMonth()+1}</span></th>`;}).join('')}</tr></thead>
    <tbody>${workers.map(w=>`<tr>
      <td><div class="user-cell">${avatarEl(w,26)}<span style="font-size:0.8rem;">${w.name}</span></div></td>
      ${days.map((day,i)=>{
        const key=`${w.id}_${day}_${shiftWeekOffset}`;
        const shift=DB.shifts[key]||'off';
        const colorMap={morning:'shift-morning',afternoon:'shift-afternoon',night:'shift-night',off:'shift-off'};
        const labelMap={morning:'Morning','afternoon':'Afternoon',night:'Night',off:'Off'};
        return`<td class="shift-cell"><select class="shift-badge ${colorMap[shift]}" style="border:none;background:transparent;cursor:pointer;font-size:0.7rem;font-weight:600;" onchange="setShift('${key}',this.value,this)">${SHIFT_KEYS.map(s=>`<option value="${s}"${shift===s?' selected':''}>${SHIFT_TYPES[SHIFT_KEYS.indexOf(s)]}</option>`).join('')}</select></td>`;
      }).join('')}
    </tr>`).join('')}</tbody>`;
}

function setShift(key,val,el){
  DB.shifts[key]=val;
  const colorMap={morning:'shift-morning',afternoon:'shift-afternoon',night:'shift-night',off:'shift-off'};
  el.className=`shift-badge ${colorMap[val]}`;
  el.style.border='none'; el.style.background='transparent'; el.style.cursor='pointer'; el.style.fontSize='0.7rem'; el.style.fontWeight='600';
}

function renderShiftSwaps() {
  $('shiftSwapTbody').innerHTML='<tr><td colspan="7"><div class="empty-state"><i class="fas fa-arrows-rotate"></i>No swap requests</div></td></tr>';
}

/* ============================================================
   25. EQUIPMENT & INVENTORY
   ============================================================ */
function renderEquipment() {
  populateEqSelects();
  filterAndUpdateEquipment(); // Changed from renderEqTable()
  filterAndUpdateCheckoutRequests(); // Added for checkout requests
  $('addEqBtn')?.addEventListener('click', () => openEqModal());
  $('eqExport')?.addEventListener('click', () => exportCSV(DB.equipment, 'equipment.csv'));
  ['eqSearch', 'eqCondition', 'eqStatus2'].forEach(id => $(id)?.addEventListener('input', filterAndUpdateEquipment));
}

function populateEqSelects() {
  const eqAss = $('eq_assignee');
  if (eqAss) eqAss.innerHTML = '<option value="">Unassigned</option>' + DB.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  const eqSite = $('eq_site');
  if (eqSite) eqSite.innerHTML = '<option value="">No Site</option>' + DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

// ========== EQUIPMENT TABLE (with pagination) ==========
function filterAndUpdateEquipment() {
  const q = $('eqSearch')?.value.toLowerCase() || '';
  const cond = $('eqCondition')?.value || '';
  const st = $('eqStatus2')?.value || '';
  
  const filteredEquipment = DB.equipment.filter(e => {
    if (q && !e.name.toLowerCase().includes(q) && !e.serial.toLowerCase().includes(q)) return false;
    if (cond && e.condition !== cond) return false;
    if (st && e.status !== st) return false;
    return true;
  });
  
  // Update equipment stats
  updateEquipmentStats();
  
  // Create paginator for equipment table
  if (filteredEquipment.length >= 0) {
    createPaginator('eqTbody', filteredEquipment, (data) => {
      renderEquipmentBody(data);
    }, { perPage: 10 });
  }
}

function updateEquipmentStats() {
  const avail = DB.equipment.filter(e => e.status === 'available').length;
  const out = DB.equipment.filter(e => e.status === 'checked-out').length;
  const maint = DB.equipment.filter(e => e.status === 'maintenance').length;
  
  $('eqStats').innerHTML =
    statCard('fa-toolbox', 'blue', DB.equipment.length, 'Total Items', '', 'flat') +
    statCard('fa-check', 'green', avail, 'Available', '', 'flat') +
    statCard('fa-hand-holding', 'yellow', out, 'Checked Out', '', 'flat') +
    statCard('fa-wrench', 'orange', maint, 'In Maintenance', '', 'flat');
}

function renderEquipmentBody(equipment) {
  if (!equipment.length) {
    $('eqTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-toolbox"></i>No equipment found</div></td></tr>';
    return;
  }
  
  $('eqTbody').innerHTML = equipment.map(e => {
    const u = userById(e.assigneeId);
    const s = siteById(e.siteId);
    const serviceAlert = e.nextService && new Date(e.nextService) < new Date() ? 'color:#f87171;' : '';
    let conditionBadge = 'good';
    if (e.condition === 'good') conditionBadge = 'good';
    else if (e.condition === 'fair') conditionBadge = 'fair';
    else if (e.condition === 'damaged') conditionBadge = 'damaged';
    
    let statusBadgeClass = 'active';
    if (e.status === 'available') statusBadgeClass = 'active';
    else if (e.status === 'checked-out') statusBadgeClass = 'in-progress';
    else if (e.status === 'maintenance') statusBadgeClass = 'on-hold';
    
    return `
      <tr>
        <td style="font-weight:600;">${e.name}</td>
        <td style="font-size:0.78rem;">${e.category}</td>
        <td>
          <div style="display:flex;align-items:center;gap:0.4rem;">
            <code style="font-size:0.72rem;">${e.serial}</code>
            <button class="abt" onclick="showQR('${e.serial}', '${e.name}')" title="QR"><i class="fas fa-qrcode"></i></button>
          </div>
        </td>
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

// Keep original for compatibility
function renderEqTable() {
  filterAndUpdateEquipment();
}

// ========== CHECKOUT REQUESTS TABLE (with pagination) ==========
function filterAndUpdateCheckoutRequests() {
  // Sample checkout requests data - you can replace with actual data from DB
  const checkoutRequests = [
    // Add your checkout request data here
    // Example: { id: 1, item: 'Drill', requestedBy: 'John Doe', date: '2025-01-15', purpose: 'Site work', status: 'pending' }
  ];
  
  if (checkoutRequests.length >= 0) {
    createPaginator('eqReqTbody', checkoutRequests, (data) => {
      renderCheckoutRequestsBody(data);
    }, { perPage: 10 });
  } else {
    $('eqReqTbody').innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-hand-holding"></i>No checkout requests</div></td></tr>';
  }
}

function renderCheckoutRequestsBody(requests) {
  if (!requests.length) {
    $('eqReqTbody').innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-hand-holding"></i>No checkout requests found</div></td></tr>';
    return;
  }
  
  $('eqReqTbody').innerHTML = requests.map(r => `
    <tr>
      <td style="font-weight:600;">${r.item}</td>
      <td>${r.requestedBy}</td>
      <td style="font-size:0.75rem;">${fmt(r.date)}</td>
      <td style="font-size:0.8rem;">${r.purpose}</td>
      <td>${statusBadge(r.status === 'pending' ? 'pending' : (r.status === 'approved' ? 'active' : 'inactive'))}</td>
      <td>
        <button class="abt suc" onclick="approveCheckout(${r.id})" title="Approve"><i class="fas fa-check"></i></button>
        <button class="abt dan" onclick="rejectCheckout(${r.id})" title="Reject"><i class="fas fa-times"></i></button>
      </td>
    </tr>`).join('');
}

// Functions for checkout request actions
function approveCheckout(requestId) {
  toast(`Checkout request #${requestId} approved`, 'success');
  filterAndUpdateCheckoutRequests();
}

function rejectCheckout(requestId) {
  toast(`Checkout request #${requestId} rejected`, 'warn');
  filterAndUpdateCheckoutRequests();
}

function openEqModal(eqId = null) {
  populateEqSelects();
  const e = eqId ? DB.equipment.find(x => x.id === eqId) : null;
  $('eqTitle').textContent = e ? 'Edit Equipment' : 'Add Equipment';
  $('eq_name').value = e?.name || '';
  $('eq_cat').value = e?.category || '';
  $('eq_serial').value = e?.serial || '';
  $('eq_condition').value = e?.condition || 'good';
  $('eq_assignee').value = e?.assigneeId || '';
  $('eq_site').value = e?.siteId || '';
  $('eq_service').value = e?.nextService || '';
  $('eq_status').value = e?.status || 'available';
  $('eq_save').onclick = () => saveEq(eqId);
  openM('equipModal');
}

function saveEq(eqId) {
  const data = {
    name: $('eq_name').value.trim(),
    category: $('eq_cat').value.trim(),
    serial: $('eq_serial').value.trim(),
    condition: $('eq_condition').value,
    assigneeId: +$('eq_assignee').value || null,
    siteId: +$('eq_site').value || null,
    nextService: $('eq_service').value,
    status: $('eq_status').value
  };
  if (!data.name) {
    toast('Name required', 'error');
    return;
  }
  if (eqId) {
    Object.assign(DB.equipment.find(e => e.id === eqId), data);
    logAction('update', 'Equipment', `Updated ${data.name}`);
  } else {
    DB.equipment.push({ id: generateId('equipment'), ...data });
    logAction('create', 'Equipment', `Added ${data.name}`);
  }
  closeM('equipModal');
  filterAndUpdateEquipment();
  toast('Equipment saved', 'success');
}

function deleteEq(id) {
  if (!confirm('Delete this equipment?')) return;
  DB.equipment.splice(DB.equipment.findIndex(e => e.id === id), 1);
  filterAndUpdateEquipment();
  toast('Equipment deleted', 'success');
}

function showQR(serial, name) {
  $('qrBody').innerHTML = `
    <div style="font-weight:700;margin-bottom:1rem;">${name}</div>
    <div style="font-size:4rem;margin:1rem 0;">📦</div>
    <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:1.1rem;letter-spacing:3px;">${serial}</div>
    <div style="font-size:0.75rem;color:var(--text3);margin-top:0.5rem;">(QR code would render here in production)</div>`;
  openM('qrModal');
}

/* ============================================================
   26. DOCUMENTS
   ============================================================ */
function renderDocuments(){
  filterAndUpdateDocuments(); // Changed from renderDocTable()
  $('uploadDocBtn')?.addEventListener('click',()=>toast('Document upload (demo — connect file server)','info'));
  $('docExport')?.addEventListener('click',()=>exportCSV(DB.documents,'documents.csv'));
  ['docSearch','docUser','docStatus'].forEach(id => $(id)?.addEventListener('input', filterAndUpdateDocuments));
}

// New function to filter and paginate documents
function filterAndUpdateDocuments() {
  const q = $('docSearch')?.value.toLowerCase() || '';
  const uid = +$('docUser')?.value || 0;
  const st = $('docStatus')?.value || '';
  
  const filteredDocs = DB.documents.filter(d => {
    if (q && !d.name.toLowerCase().includes(q)) return false;
    if (uid && d.userId !== uid) return false;
    if (st === 'expiring') {
      const exp = d.expiry;
      const diff = (new Date(exp) - new Date()) / 86400000;
      return diff >= 0 && diff <= 30;
    }
    if (st && d.status !== st) return false;
    return true;
  });
  
  // Update stats based on ALL filtered data (not just current page)
  updateDocumentStats();
  
  // Create paginator for documents table
  if (filteredDocs.length >= 0) {
    createPaginator('docTbody', filteredDocs, (data) => {
      renderDocTableBody(data);
    }, { perPage: 10 });
  }
}

// New function to update document statistics
function updateDocumentStats() {
  const approved = DB.documents.filter(d => d.status === 'approved').length;
  const pending = DB.documents.filter(d => d.status === 'pending').length;
  const expiring = DB.documents.filter(d => {
    const diff = (new Date(d.expiry) - new Date()) / 86400000;
    return diff >= 0 && diff <= 30;
  }).length;
  
  $('docStats').innerHTML =
    statCard('fa-folder-open', 'blue', DB.documents.length, 'Total Docs', '', 'flat') +
    statCard('fa-check', 'green', approved, 'Approved', '', 'flat') +
    statCard('fa-hourglass', 'yellow', pending, 'Pending Review', '', 'flat') +
    statCard('fa-triangle-exclamation', 'orange', expiring, 'Expiring Soon', '', 'flat');
}

// New function to render only the table body
function renderDocTableBody(documents) {
  if (!documents.length) {
    $('docTbody').innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-folder-open"></i>No documents found</div></td></tr>';
    return;
  }
  
  $('docTbody').innerHTML = documents.map(d => {
    const u = userById(d.userId);
    const diff = (new Date(d.expiry) - new Date()) / 86400000;
    const expiryCls = diff < 0 ? 'color:#f87171;' : (diff < 30 ? 'color:#f97316;' : '');
    return `
      <tr>
        <td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name || 'Unknown'}</span></div></td>
        <td style="font-weight:600;">${d.name}</td>
        <td><span class="badge b-update">${d.type}</span></td>
        <td style="font-size:0.75rem;">${fmt(d.uploaded)}</td>
        <td style="font-size:0.75rem;${expiryCls}">${fmt(d.expiry)}${diff < 30 && diff >= 0 ? ' ⚠️' : ''}</td>
        <td>${statusBadge(d.status)}</td>
        <td style="font-size:0.75rem;">${d.notes || '—'}</td>
        <td>
          ${d.status === 'pending' ? `
            <button class="abt suc" onclick="decideDoc(${d.id},'approved')" title="Approve"><i class="fas fa-check"></i></button>
            <button class="abt dan" onclick="decideDoc(${d.id},'rejected')" title="Reject"><i class="fas fa-times"></i></button>
          ` : ''}
          <button class="abt inf" title="Preview" onclick="previewDoc(${d.id})"><i class="fas fa-eye"></i></button>
          <button class="abt" title="Request doc" onclick="requestDoc(${d.userId})"><i class="fas fa-envelope"></i></button>
        </td>
      </tr>`;
  }).join('');
}

// Keep original function for compatibility (if called elsewhere)
function renderDocTable() {
  filterAndUpdateDocuments();
}

function decideDoc(id, decision) {
  const d = DB.documents.find(x => x.id === id); 
  if (!d) return;
  const u = userById(d.userId);
  d.status = decision; 
  logAction(decision === 'approved' ? 'approve' : 'reject', `Doc #${id}`, `${decision} "${d.name}" for ${u?.name}`);
  sendEmail(u?.email || '', `Document ${decision}`, 'doc_decision');
  filterAndUpdateDocuments(); // Updated to use paginated version
  toast(`Document ${decision}`, 'success');
}

function requestDoc(userId) {
  const u = userById(userId);
  if (u?.email) {
    sendEmail(u.email, 'Missing Document Request', 'doc_request');
    toast(`Document request sent to ${u.name}`, 'info');
  } else {
    toast('No email address found for this user', 'error');
  }
}

// Helper function for document preview
function previewDoc(docId) {
  const d = DB.documents.find(x => x.id === docId);
  if (d) {
    toast(`Previewing: ${d.name} (demo)`, 'info');
  }
}

/* ============================================================
   27. NOTIFICATIONS
   ============================================================ */
function renderNotifications(){
  renderNotifList();
  $('markAllReadBtn')?.addEventListener('click',()=>{DB.notifications.forEach(n=>n.read=true);renderNotifList();renderDashboard();toast('All marked read','success');});
  $('clearNotifBtn')?.addEventListener('click',()=>{if(confirm('Clear all notifications?')){DB.notifications=[];renderNotifList();renderDashboard();toast('Notifications cleared','success');}});
  renderNotifPrefs();
  ['notifTypeFilter','notifReadFilter'].forEach(id=>$(id)?.addEventListener('change',renderNotifList));
}

function renderNotifList(){
  const type=$('notifTypeFilter')?.value||'';
  const read=$('notifReadFilter')?.value||'';
  const iconMap={approval:'fa-user-check',task:'fa-list-check',leave:'fa-calendar',system:'fa-server',alert:'fa-triangle-exclamation'};
  const colorMap={approval:'rgba(16,185,129,0.15)',task:'rgba(59,130,246,0.15)',leave:'rgba(234,179,8,0.15)',system:'rgba(100,116,139,0.15)',alert:'rgba(239,68,68,0.15)'};
  const rows=DB.notifications.filter(n=>{
    if(type&&n.type!==type)return false;
    if(read==='unread'&&n.read)return false;
    if(read==='read'&&!n.read)return false;
    return true;
  });
  $('notifList').innerHTML=rows.map(n=>`
    <div class="notif-item${n.read?'':' unread'}" onclick="markNotifRead(${n.id})">
      <div class="notif-icon" style="background:${colorMap[n.type]||'var(--surface2)'};"><i class="fas ${iconMap[n.type]||'fa-bell'}"></i></div>
      <div class="notif-body"><div class="notif-title">${n.title}</div><div class="notif-desc">${n.desc}</div><div class="notif-time">${n.time}</div></div>
      ${n.read?'':'<div class="notif-unread-dot"></div>'}
      <button class="abt dan" onclick="deleteNotif(${n.id});event.stopPropagation()"><i class="fas fa-times"></i></button>
    </div>`).join('')||'<div class="empty-state"><i class="fas fa-bell-slash"></i>No notifications</div>';
}

function markNotifRead(id){const n=DB.notifications.find(x=>x.id===id);if(n)n.read=true;renderNotifList();}
function deleteNotif(id){DB.notifications.splice(DB.notifications.findIndex(n=>n.id===id),1);renderNotifList();}

function renderNotifPrefs(){
  const prefs=[{label:'Approval Notifications',key:'approval'},{label:'Task Assignments',key:'task'},{label:'Leave Decisions',key:'leave'},{label:'System Alerts',key:'system'},{label:'Equipment Alerts',key:'alert'}];
  $('notifPrefs').innerHTML=prefs.map(p=>`<div class="sw-row"><div class="sw-info"><div class="sw-label">${p.label}</div></div><label class="sw"><input type="checkbox" checked><span class="sw-sl"></span></label></div>`).join('');
}

/* ============================================================
   28. EMAIL CENTER
   ============================================================ */
function renderEmailCenter() {
  wireETabs();
  filterAndUpdateEmailLog(); // Changed from renderEmailLog()
  renderEmailTemplates();
  $('compSendBtn')?.addEventListener('click', sendComposedEmail);
  $('bulkSendBtn')?.addEventListener('click', sendBulkEmail);
}

function wireETabs() {
  const panels = { log: 'et-log', compose: 'et-compose', bulk: 'et-bulk', templates: 'et-templates' };
  $$('[data-etab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-etab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.values(panels).forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
      });
      const target = $(panels[btn.dataset.etab]);
      if (target) target.style.display = '';
      
      // Refresh email log when switching to log tab
      if (btn.dataset.etab === 'log') {
        filterAndUpdateEmailLog();
      }
    });
  });
}

// New function to filter and paginate email log
function filterAndUpdateEmailLog() {
  const st = $('emailLogStatus')?.value || '';
  const q = $('emailLogSearch')?.value.toLowerCase() || '';
  
  const filteredEmails = DB.emailLog.filter(e => {
    if (st && e.status !== st) return false;
    if (q && !e.to.includes(q) && !e.subject.toLowerCase().includes(q)) return false;
    return true;
  });
  
  // Sort by sent date (newest first)
  filteredEmails.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  
  // Create paginator for email log table
  if (filteredEmails.length >= 0) {
    createPaginator('emailLogTbody', filteredEmails, (data) => {
      renderEmailLogBody(data);
    }, { perPage: 10 });
  }
  
  // Re-attach event listeners for search and filter
  $('emailLogSearch')?.addEventListener('input', filterAndUpdateEmailLog);
  $('emailLogStatus')?.addEventListener('change', filterAndUpdateEmailLog);
}

// New function to render only the table body
function renderEmailLogBody(emails) {
  if (!emails.length) {
    $('emailLogTbody').innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-inbox"></i>No emails found</div></td></tr>';
    return;
  }
  
  $('emailLogTbody').innerHTML = emails.map(e => `
    <tr>
      <td>${e.to}</td>
      <td>${e.subject}</td>
      <td style="font-size:0.75rem;"><code>${e.template}</code></td>
      <td style="font-size:0.75rem;">${e.sentAt}</td>
      <td>${statusBadge(e.status === 'sent' ? 'active' : (e.status === 'failed' ? 'inactive' : 'pending'))}</td>
      <td>
        <button class="abt inf" title="Resend" onclick="resendEmail(${e.id})"><i class="fas fa-rotate-right"></i></button>
      </td>
    </tr>`).join('');
}

// Keep original function for compatibility (if called elsewhere)
function renderEmailLog() {
  filterAndUpdateEmailLog();
}

function sendComposedEmail() {
  const to = $('compTo')?.value.trim();
  const subject = $('compSubject')?.value.trim();
  if (!to || !subject) {
    toast('To and Subject required', 'error');
    return;
  }
  sendEmail(to, subject, 'manual');
  toast(`Email sent to ${to}`, 'success');
  $('compTo').value = '';
  $('compSubject').value = '';
  $('compBody').value = '';
  filterAndUpdateEmailLog(); // Refresh the email log
}

function sendBulkEmail() {
  const targets = [...$('bulkEmailTargets').querySelectorAll('input:checked')].map(i => i.value);
  if (!targets.length) {
    toast('Select at least one group', 'warn');
    return;
  }
  let count = 0;
  if (targets.includes('all')) {
    count = DB.users.length;
  } else {
    targets.forEach(t => {
      count += DB.users.filter(u => u.role === t).length;
    });
  }
  toast(`Bulk email queued for ${count} recipients`, 'success');
  logAction('create', 'Email', `Bulk email to: ${targets.join(', ')}`);
  filterAndUpdateEmailLog(); // Refresh the email log
}

// New function to resend an email
function resendEmail(emailId) {
  const email = DB.emailLog.find(e => e.id === emailId);
  if (email) {
    sendEmail(email.to, email.subject, email.template);
    toast(`Resending email to ${email.to}`, 'info');
  } else {
    toast('Email not found', 'error');
  }
}

function renderEmailTemplates() {
  const templates = [
    { id: 'welcome_approved', name: 'Welcome / Approved', desc: 'Sent when a user is approved.' },
    { id: 'leave_decision', name: 'Leave Decision', desc: 'Sent on leave approve/reject.' },
    { id: 'task_assigned', name: 'Task Assigned', desc: 'Sent when a task is assigned.' },
    { id: 'payslip', name: 'Payslip Ready', desc: 'Sent when payslip is generated.' },
    { id: 'incident_alert', name: 'Critical Incident', desc: 'Sent on critical safety incident.' },
    { id: 'doc_request', name: 'Document Request', desc: 'Sent to request missing documents.' },
    { id: 'ticket_update', name: 'Ticket Update', desc: 'Sent when a ticket status changes.' },
    { id: 'password_reset', name: 'Password Reset', desc: 'Sent when user requests password reset.' } // Added
  ];
  
  $('emailTemplatesList').innerHTML = templates.map(t => `
    <div class="cat-item" style="margin-bottom:0.5rem;">
      <i class="fas fa-file-lines" style="color:var(--accent);"></i>
      <div style="flex:1;">
        <div class="ci-name">${t.name}</div>
        <div style="font-size:0.72rem;color:var(--text3);">${t.desc}</div>
      </div>
      <code style="font-size:0.68rem;color:var(--text3);">${t.id}</code>
    </div>
  `).join('');
}

/* ============================================================
   29. SAFETY & INCIDENTS
   ============================================================ */
function renderSafety() {
   document.querySelectorAll('[id^="st-"]').forEach(el => {
    el.style.display = 'none';
  });
  const overviewEl = document.getElementById('st-overview');
  if (overviewEl) overviewEl.style.display = 'block';
  wireSTabs();
  renderSafetyOverview();
  
  // Only load data for the active tab initially
  const activeTab = document.querySelector('[data-stab].active');
  const activeTabName = activeTab?.dataset.stab || 'overview';
  
  if (activeTabName === 'inductions') {
    filterAndUpdateInductions();
  } else if (activeTabName === 'hazards') {
    filterAndUpdateHazards();
  } else if (activeTabName === 'incidents') {
    filterAndUpdateIncidents();
  } else if (activeTabName === 'training') {
    filterAndUpdateTraining();
  } else {
    // For overview tab, clear table containers
    if ($('indTbody')) $('indTbody').innerHTML = '';
    if ($('hazTbody')) $('hazTbody').innerHTML = '';
    if ($('incTbody')) $('incTbody').innerHTML = '';
    if ($('trainingTbody')) $('trainingTbody').innerHTML = '';
  }
  
  renderChecklist();
  renderSafetyScores();
  populateSafetySelects();
  
  $('reportIncidentBtn')?.addEventListener('click', () => openM('incidentModal'));
  $('inc_save')?.addEventListener('click', saveIncident);
  $('incExport')?.addEventListener('click', () => exportCSV(DB.incidents, 'incidents.csv'));
  $('addTrainingBtn')?.addEventListener('click', () => toast('Training record form (demo)', 'info'));
  
  ['incSeverity', 'incSite'].forEach(id => $(id)?.addEventListener('change', filterAndUpdateIncidents));
  ['indSearch', 'indStatus'].forEach(id => $(id)?.addEventListener('input', filterAndUpdateInductions));
  ['hazSearch', 'hazStatus', 'hazType'].forEach(id => $(id)?.addEventListener('input', filterAndUpdateHazards));
  
  $('hazApply')?.addEventListener('click', filterAndUpdateHazards);
  $('safeRptGenerate')?.addEventListener('click', generateSafetyExport);
  
  if ($('safeRptFrom') && !$('safeRptFrom').value) $('safeRptFrom').value = new Date().toISOString().slice(0, 10);
  if ($('safeRptTo') && !$('safeRptTo').value) $('safeRptTo').value = new Date().toISOString().slice(0, 10);
}

function wireSTabs() {
  const panels = {
    overview: 'st-overview',
    inductions: 'st-inductions',
    hazards: 'st-hazards',
    exports: 'st-exports',
    incidents: 'st-incidents',
    checklist: 'st-checklist',
    training: 'st-training',
    score: 'st-score'
  };
  
  $$('[data-stab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-stab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      Object.values(panels).forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
      });
      
      const target = $(panels[btn.dataset.stab]);
      if (target) target.style.display = '';
      
      // Load data only when switching to specific tabs
      const tabName = btn.dataset.stab;
      if (tabName === 'inductions') {
        filterAndUpdateInductions();
      } else if (tabName === 'hazards') {
        filterAndUpdateHazards();
      } else if (tabName === 'incidents') {
        filterAndUpdateIncidents();
      } else if (tabName === 'training') {
        filterAndUpdateTraining();
      }
    });
  });
}

function populateSafetySelects() {
  const siteOpts = '<option value="">All Sites</option>' + DB.sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  ['incSite', 'checklistSite', 'inc_site', 'safeActiveSite'].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = siteOpts;
  });
}

function renderSafetyOverview() {
  const openHazards = DB.incidents.filter(i => i.status === 'open').length;
  const overdueHazards = DB.incidents.filter(i => i.status === 'open' && i.severity !== 'low').length;
  const inducted = DB.users.filter(u => u.status === 'active').length;
  $('safeOverviewStats').innerHTML =
    statCard('fa-users', 'blue', DB.users.length, 'Total Workers', '', 'flat') +
    statCard('fa-user-check', 'green', inducted, 'Inducted', '', 'flat') +
    statCard('fa-triangle-exclamation', 'red', openHazards, 'Open Safety Issues', '', 'flat') +
    statCard('fa-clock', 'yellow', overdueHazards, 'Overdue Hazards', '', 'flat');
}

// ========== INDUCTIONS TABLE (with pagination) ==========
function filterAndUpdateInductions() {
  const q = ($('indSearch')?.value || '').toLowerCase();
  const st = $('indStatus')?.value || '';
  
  let inductionData = DB.users
    .filter(u => u.role !== 'admin')
    .map((u, idx) => {
      const statusMap = ['Inducted', 'Pending Review', 'In Progress', 'Not Started', 'Expired'];
      const status = statusMap[idx % statusMap.length];
      return {
        user: u,
        company: siteById(DB.sites[idx % DB.sites.length]?.id)?.name || 'Main Contractor',
        status: status,
        updated: nowStr().slice(0, 10)
      };
    })
    .filter(r => (!q || r.user.name.toLowerCase().includes(q) || r.company.toLowerCase().includes(q)) && (!st || r.status === st));
  
  createPaginator('indTbody', inductionData, (data) => {
    renderInductionsBody(data);
  }, { perPage: 10 });
}

function renderInductionsBody(rows) {
  if (!rows.length) {
    $('indTbody').innerHTML = '<tr><td colspan="4"><div class="empty-state"><i class="fas fa-id-card"></i>No inductions found</div></td></tr>';
    return;
  }
  
  $('indTbody').innerHTML = rows.map(r => `
    <tr>
      <td><div class="user-cell">${avatarEl(r.user, 26)}<span>${r.user.name}</span></div></td>
      <td>${r.company}</td>
      <td>${statusBadge(r.status.toLowerCase().replace(/\s+/g, '') === 'inducted' ? 'active' : (r.status === 'Expired' ? 'inactive' : 'pending'))}</td>
      <td style="font-size:0.76rem;">${r.updated}</td>
    </tr>`).join('');
}

// Keep original for compatibility
function renderInductions() {
  filterAndUpdateInductions();
}

// ========== HAZARDS TABLE (with pagination) ==========
function filterAndUpdateHazards() {
  const q = ($('hazSearch')?.value || '').toLowerCase();
  const st = $('hazStatus')?.value || '';
  const type = $('hazType')?.value || '';
  
  const filteredHazards = DB.incidents.filter(i => {
    if (st && i.status !== st) return false;
    if (type && i.type !== type) return false;
    if (q && !(`${i.desc} ${siteById(i.siteId)?.name || ''}`).toLowerCase().includes(q)) return false;
    return true;
  });
  
  updateHazardStats();
  
  createPaginator('hazTbody', filteredHazards, (data) => {
    renderHazardsBody(data);
  }, { perPage: 10 });
}

function updateHazardStats() {
  $('hazardStats').innerHTML =
    statCard('fa-folder-open', 'yellow', DB.incidents.filter(i => i.status === 'open').length, 'Open', '', 'flat') +
    statCard('fa-clock', 'red', DB.incidents.filter(i => i.status === 'open' && i.severity !== 'low').length, 'Overdue', '', 'flat') +
    statCard('fa-check', 'green', DB.incidents.filter(i => i.status === 'resolved').length, 'Closed', '', 'flat');
}

function renderHazardsBody(hazards) {
  if (!hazards.length) {
    $('hazTbody').innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="fas fa-triangle-exclamation"></i>No hazards found</div></td></tr>';
    return;
  }
  
  $('hazTbody').innerHTML = hazards.map(i => `
    <tr>
      <td style="font-size:0.75rem;">${i.date}</td>
      <td>${siteById(i.siteId)?.name || '—'}</td>
      <td><span class="badge b-update">${i.type}</span></td>
      <td style="font-size:0.8rem;">${i.desc}</td>
      <td>${statusBadge(i.status === 'open' ? 'active' : 'completed')}</td>
    </tr>`).join('');
}

// Keep original for compatibility
function renderHazards() {
  filterAndUpdateHazards();
}

// ========== INCIDENTS TABLE (with pagination) ==========
function filterAndUpdateIncidents() {
  const sev = $('incSeverity')?.value || '';
  const site = +$('incSite')?.value || 0;
  
  const filteredIncidents = DB.incidents.filter(i => {
    if (sev && i.severity !== sev) return false;
    if (site && i.siteId !== site) return false;
    return true;
  });
  
  updateIncidentStats();
  
  createPaginator('incTbody', filteredIncidents, (data) => {
    renderIncidentsBody(data);
  }, { perPage: 10 });
}

function updateIncidentStats() {
  const critical = DB.incidents.filter(i => i.severity === 'critical').length;
  const open = DB.incidents.filter(i => i.status === 'open').length;
  const resolved = DB.incidents.filter(i => i.status === 'resolved').length;
  
  $('safetyStats').innerHTML =
    statCard('fa-triangle-exclamation', 'red', DB.incidents.length, 'Total Incidents', '', 'flat') +
    statCard('fa-skull', 'red', critical, 'Critical', '', 'flat') +
    statCard('fa-folder-open', 'yellow', open, 'Open', '', 'flat') +
    statCard('fa-check', 'green', resolved, 'Resolved', '', 'flat');
}

function renderIncidentsBody(incidents) {
  if (!incidents.length) {
    $('incTbody').innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-shield-check"></i>No incidents found</div></td><tr>';
    return;
  }
  
  $('incTbody').innerHTML = incidents.map(i => {
    const s = siteById(i.siteId);
    const r = userById(i.reporterId);
    return `
      <tr>
        <td style="font-size:0.75rem;">${i.date}</td>
        <td style="font-size:0.8rem;">${s?.name || '—'}</td>
        <td><div class="user-cell">${avatarEl(r, 24)}<span style="font-size:0.78rem;">${r?.name}</span></div></td>
        <td><span class="badge b-update">${i.type}</span></td>
        <td>${severityBadge(i.severity)}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem;">${i.desc}</td>
        <td>${statusBadge(i.status === 'open' ? 'active' : 'completed')}</td>
        <td>
          <button class="abt inf" title="Details" onclick="toast('Incident details (demo)', 'info')"><i class="fas fa-eye"></i></button>
          ${i.status === 'open' ? `<button class="abt suc" title="Resolve" onclick="resolveIncident(${i.id})"><i class="fas fa-check"></i></button>` : ''}
        </td>
      </tr>`;
  }).join('');
}

// Keep original for compatibility
function renderIncidentTable() {
  filterAndUpdateIncidents();
}

function saveIncident() {
  const data = {
    date: $('inc_date')?.value || nowStr(),
    siteId: +$('inc_site')?.value || 1,
    reporterId: currentUser.id,
    type: $('inc_type')?.value,
    severity: $('inc_severity')?.value,
    desc: $('inc_desc')?.value.trim(),
    actions: $('inc_actions')?.value.trim(),
    status: 'open'
  };
  if (!data.desc) {
    toast('Description required', 'error');
    return;
  }
  DB.incidents.unshift({ id: generateId('incidents'), ...data });
  logAction('create', 'Incident', `${data.severity} incident at site #${data.siteId}`);
  if (data.severity === 'critical') sendEmail('admin@nixers.pro', 'CRITICAL: Safety Incident Reported', 'incident_alert');
  closeM('incidentModal');
  filterAndUpdateIncidents();
  filterAndUpdateHazards();
  toast('Incident reported', 'success');
}

function resolveIncident(id) {
  const i = DB.incidents.find(x => x.id === id);
  if (i) i.status = 'resolved';
  filterAndUpdateIncidents();
  filterAndUpdateHazards();
  toast('Incident resolved', 'success');
}

// ========== TRAINING TABLE (with pagination) ==========
function filterAndUpdateTraining() {
  const trainings = [
    { userId: 3, training: 'Working at Height', completed: '2025-01-15', expiry: '2026-01-15', status: 'valid' },
    { userId: 4, training: 'First Aid', completed: '2024-06-01', expiry: '2025-06-01', status: 'expired' },
    { userId: 5, training: 'Fire Safety', completed: '2025-03-10', expiry: '2026-03-10', status: 'valid' },
    { userId: 6, training: 'Scaffolding Safety', completed: '2025-02-20', expiry: '2026-02-20', status: 'valid' }
  ];
  
  createPaginator('trainingTbody', trainings, (data) => {
    renderTrainingBody(data);
  }, { perPage: 10 });
}

function renderTrainingBody(trainings) {
  if (!trainings.length) {
    $('trainingTbody').innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-graduation-cap"></i>No training records found</div></td></tr>';
    return;
  }
  
  $('trainingTbody').innerHTML = trainings.map(t => {
    const u = userById(t.userId);
    return `
      <tr>
        <td><div class="user-cell">${avatarEl(u, 26)}<span>${u?.name}</span></div></td>
        <td>${t.training}</td>
        <td style="font-size:0.75rem;">${fmt(t.completed)}</td>
        <td style="font-size:0.75rem;">${fmt(t.expiry)}</td>
        <td>${statusBadge(t.status === 'valid' ? 'active' : 'inactive')}</td>
        <td><button class="abt warn" onclick="editTraining(${t.userId})"><i class="fas fa-pen"></i></button></td>
      </tr>`;
  }).join('');
}

// Keep original for compatibility
function renderTraining() {
  filterAndUpdateTraining();
}

function editTraining(userId) {
  toast(`Edit training record for user #${userId} (demo)`, 'info');
}

function renderChecklist() {
  const checks = ['All workers have PPE', 'Emergency exits clear', 'Scaffolding inspected', 'Tools accounted for', 'First aid kit stocked', 'Hazard zones marked', 'Morning briefing done'];
  $('checklistBody').innerHTML = checks.map((c, i) => `
    <div class="sw-row">
      <div class="sw-info"><div class="sw-label">${c}</div></div>
      <label class="sw"><input type="checkbox" id="chk${i}"><span class="sw-sl"></span></label>
    </div>`).join('') +
    `<div style="margin-top:1rem;"><button class="btn btn-accent btn-sm" onclick="submitChecklist()"><i class="fas fa-save"></i> Submit Checklist</button></div>`;
}

function submitChecklist() {
  logAction('create', 'Checklist', 'Daily safety checklist submitted');
  toast('Checklist submitted', 'success');
}

function renderSafetyScores() {
  $('safetyScoreBody').innerHTML = DB.sites.map(s => {
    const incidents = DB.incidents.filter(i => i.siteId === s.id);
    const score = Math.max(0, 100 - incidents.length * 15);
    const color = score >= 80 ? '#34d399' : (score >= 60 ? 'var(--accent)' : '#f87171');
    return `
      <div class="safety-score-card">
        <div class="ss-site">${s.name}</div>
        <div style="display:flex;align-items:center;gap:1rem;">
          <div class="ss-score" style="color:${color};">${score}</div>
          <div style="flex:1;">
            <div class="pb ss-bar"><div class="pb-fill" style="width:${score}%;background:${color};"></div></div>
            <div style="font-size:0.72rem;color:var(--text3);margin-top:0.25rem;">${incidents.length} incident${incidents.length !== 1 ? 's' : ''} recorded</div>
          </div>
        </div>
      </div>`;
  }).join('') || '<div class="empty-state"><i class="fas fa-star"></i>No sites found</div>';
}

function generateSafetyExport() {
  const type = $('safeRptType')?.value;
  const fmt = $('safeRptFmt')?.value || 'csv';
  if (!type) {
    toast('Select report type', 'error');
    return;
  }
  if (type === 'incidents' || type === 'hazards') {
    if (fmt === 'json') downloadJSON(DB.incidents, `${type}.json`);
    else exportCSV(DB.incidents, `${type}.csv`);
  } else {
    const rows = DB.users.filter(u => u.role !== 'admin').map((u, idx) => ({ name: u.name, status: ['Inducted', 'Pending Review', 'In Progress', 'Not Started', 'Expired'][idx % 5] }));
    if (fmt === 'json') downloadJSON(rows, 'inductions.json');
    else exportCSV(rows, 'inductions.csv');
  }
  toast('Safety export generated', 'success');
}

function downloadJSON(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
   30. AUDIT LOG
   ============================================================ */
function renderAuditLog() {
  renderAuditHeatmap();
  filterAndUpdateAuditLog(); // Changed from renderAuditTable()
  $('auditExport')?.addEventListener('click', () => exportCSV(DB.auditLog, 'audit_log.csv'));
  ['auditSearch', 'auditUser', 'auditAction', 'auditFrom', 'auditTo'].forEach(id => $(id)?.addEventListener('input', filterAndUpdateAuditLog));
  const userSel = $('auditUser');
  if (userSel) userSel.innerHTML = '<option value="">All Users</option>' + DB.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
}

// New function to filter and paginate audit log
function filterAndUpdateAuditLog() {
  const q = $('auditSearch')?.value.toLowerCase() || '';
  const uid = +$('auditUser')?.value || 0;
  const action = $('auditAction')?.value || '';
  const from = $('auditFrom')?.value || '';
  const to = $('auditTo')?.value || '';
  
  const filteredLogs = DB.auditLog.filter(l => {
    if (q && !l.details.toLowerCase().includes(q) && !l.target.toLowerCase().includes(q)) return false;
    if (uid && l.userId !== uid) return false;
    if (action && l.action !== action) return false;
    if (from && l.time.slice(0, 10) < from) return false;
    if (to && l.time.slice(0, 10) > to) return false;
    return true;
  });
  
  // Sort by time (newest first)
  filteredLogs.sort((a, b) => new Date(b.time) - new Date(a.time));
  
  // Create paginator for audit log table
  if (filteredLogs.length >= 0) {
    createPaginator('auditTbody', filteredLogs, (data) => {
      renderAuditTableBody(data);
    }, { perPage: 10 });
  }
}

// New function to render only the table body
function renderAuditTableBody(logs) {
  if (!logs.length) {
    $('auditTbody').innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-scroll"></i>No log entries found</div></td></tr>';
    return;
  }
  
  $('auditTbody').innerHTML = logs.map(l => {
    const u = userById(l.userId);
    let badgeClass = 'update';
    if (l.action === 'login' || l.action === 'logout') badgeClass = 'update';
    else if (l.action === 'delete') badgeClass = 'inactive';
    else if (l.action === 'approve') badgeClass = 'active';
    else badgeClass = 'update';
    
    return `
      <tr>
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

// Keep original function for compatibility (if called elsewhere)
function renderAuditTable() {
  filterAndUpdateAuditLog();
}

function renderAuditHeatmap() {
  const el = $('auditHeatmap');
  if (!el) return;
  
  const counts = {};
  DB.auditLog.forEach(l => {
    const d = l.time.slice(0, 10);
    counts[d] = (counts[d] || 0) + 1;
  });
  
  const today = new Date();
  let html = '<div class="heatmap-grid">';
  
  for (let i = 51; i >= 0; i--) {
    for (let j = 0; j < 7; j++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (i * 7 + j));
      const key = d.toISOString().slice(0, 10);
      const n = counts[key] || 0;
      const level = n === 0 ? 0 : (n <= 1 ? 1 : (n <= 3 ? 2 : (n <= 5 ? 3 : 4)));
      html += `<div class="hm-cell hm-l${level}" title="${key}: ${n} actions"></div>`;
    }
  }
  
  html += '</div><div style="font-size:0.72rem;color:var(--text3);margin-top:0.5rem;">Last 52 weeks — each cell = 1 day</div>';
  el.innerHTML = html;
}

/* ============================================================
   31. RBAC PERMISSIONS
   ============================================================ */
function renderRBAC(){
  wireRTabs();
  renderRBACMatrix();
  renderRolesTable();
  renderOverridesTable();
  $('addRoleBtn')?.addEventListener('click',()=>openRoleModal());
}

function wireRTabs(){
  const panels={matrix:'rt-matrix',roles:'rt-roles',overrides:'rt-overrides'};
  $$('[data-rtab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('[data-rtab]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el)el.style.display='none';});
      const target=$(panels[btn.dataset.rtab]);if(target)target.style.display='';
    });
  });
}

function renderRBACMatrix(){
  const perms=['users','sites','tasks','posts','leave','payroll','reports','settings','audit'];
  const roles=['admin','manager','worker'];
  let html=`<table class="rbac-table"><thead><tr><th>Permission / Module</th>${roles.map(r=>`<th>${r.charAt(0).toUpperCase()+r.slice(1)}</th>`).join('')}</tr></thead><tbody>`;
  perms.forEach(perm=>{
    html+=`<tr><td>${perm.charAt(0).toUpperCase()+perm.slice(1)}</td>`;
    roles.forEach(role=>{html+=`<td><input type="checkbox" class="perm-check" ${DB.rbacPerms[role]?.[perm]?'checked':''} data-role="${role}" data-perm="${perm}"></td>`;});
    html+='</tr>';
  });
  html+='</tbody></table>';
  $('rbacMatrix').innerHTML=html;
  $$('.perm-check').forEach(cb=>cb.addEventListener('change',e=>{
    DB.rbacPerms[e.target.dataset.role][e.target.dataset.perm]=e.target.checked;
    toast('Permission updated','success');
  }));
}

function renderRolesTable(){
  $('rolesTbody').innerHTML=DB.roles.map(r=>`<tr>
    <td><span class="badge" style="background:${r.color}22;color:${r.color};">${r.name}</span></td>
    <td><div style="width:20px;height:20px;background:${r.color};border-radius:4px;"></div></td>
    <td>${DB.users.filter(u=>u.role===r.id).length}</td>
    <td style="font-size:0.75rem;">${Array.isArray(r.perms)?r.perms.join(', '):'Custom'}</td>
    <td>
      <button class="abt warn" onclick="openRoleModal('${r.id}')"><i class="fas fa-pen"></i></button>
      ${r.id==='admin'||r.id==='manager'||r.id==='worker'?'':`<button class="abt dan" onclick="deleteRole('${r.id}')"><i class="fas fa-trash"></i></button>`}
    </td>
  </tr>`).join('');
}

function openRoleModal(roleId=null){
  const r=roleId?DB.roles.find(x=>x.id===roleId):null;
  $('roleModalTitle').textContent=r?'Edit Role':'Create Role';
  $('rm_name').value=r?.name||'';
  $('rm_color').value=r?.color||'#3b82f6';
  const perms=['users.view','users.edit','sites.view','sites.manage','tasks.view','tasks.manage','posts.view','posts.create','leave.apply','leave.approve','payroll.view','payroll.manage','reports.view','settings.edit','audit.view'];
  $('rm_perms').innerHTML=perms.map(p=>`<label style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;"><input type="checkbox" value="${p}" ${r&&Array.isArray(r.perms)&&r.perms.includes(p)?'checked':''}> ${p}</label>`).join('');
  $('rm_save').onclick=()=>saveRole(roleId);
  openM('roleModal');
}

function saveRole(roleId){
  const name=$('rm_name').value.trim();if(!name){toast('Name required','error');return;}
  const color=$('rm_color').value;
  const perms=[...$('rm_perms').querySelectorAll('input:checked')].map(i=>i.value);
  if(roleId){const r=DB.roles.find(x=>x.id===roleId);Object.assign(r,{name,color,perms});}
  else{DB.roles.push({id:name.toLowerCase().replace(/\s+/g,'_'),name,color,perms});}
  closeM('roleModal');renderRolesTable();toast('Role saved','success');
}

function deleteRole(id){if(!confirm('Delete role?'))return;DB.roles.splice(DB.roles.findIndex(r=>r.id===id),1);renderRolesTable();toast('Role deleted','success');}

function renderOverridesTable(){
  $('overrideTbody').innerHTML='<tr><td colspan="5"><div class="empty-state"><i class="fas fa-user-shield"></i>No overrides configured</div></td></tr>';
}

/* ============================================================
   32. CLIENT PORTAL
   ============================================================ */
function renderClientPortal() {
  wireCPTabs();
  filterAndUpdateClients(); // Changed from renderClientTable()
  filterAndUpdateTickets();  // Changed from renderTicketTable()
  populateCPSelects();
  $('addClientBtn')?.addEventListener('click', () => openClientModal());
  $('addTicketBtn')?.addEventListener('click', () => openTicketModal());
  $('cl_save')?.addEventListener('click', () => saveClient(null));
  $('tk_save')?.addEventListener('click', () => saveTicket(null));
  ['clientSearch'].forEach(id => $(id)?.addEventListener('input', filterAndUpdateClients));
  ['ticketStatus', 'ticketClient'].forEach(id => $(id)?.addEventListener('change', filterAndUpdateTickets));
}

function wireCPTabs() {
  const panels = { clients: 'cp-clients', tickets: 'cp-tickets' };
  $$('[data-cptab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-cptab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.values(panels).forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
      });
      const target = $(panels[btn.dataset.cptab]);
      if (target) target.style.display = '';
      
      // Refresh data when switching tabs
      if (btn.dataset.cptab === 'clients') {
        filterAndUpdateClients();
      } else if (btn.dataset.cptab === 'tickets') {
        filterAndUpdateTickets();
      }
    });
  });
}

function populateCPSelects() {
  const tkClient = $('tk_client');
  if (tkClient) tkClient.innerHTML = DB.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const tkAss = $('tk_assignee');
  if (tkAss) tkAss.innerHTML = DB.users.filter(u => u.role !== 'worker').map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  const ticketClient = $('ticketClient');
  if (ticketClient) ticketClient.innerHTML = '<option value="">All Clients</option>' + DB.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const cl_sites = $('cl_sitesCheck');
  if (cl_sites) cl_sites.innerHTML = DB.sites.map(s => `<label style="display:flex;align-items:center;gap:0.35rem;font-size:0.82rem;"><input type="checkbox" value="${s.id}"> ${s.name}</label>`).join('');
}

// ========== CLIENTS TABLE (with pagination) ==========
function filterAndUpdateClients() {
  const q = $('clientSearch')?.value.toLowerCase() || '';
  
  const filteredClients = DB.clients.filter(c => 
    !q || c.name.toLowerCase().includes(q) || c.contact.toLowerCase().includes(q)
  );
  
  createPaginator('clientTbody', filteredClients, (data) => {
    renderClientTableBody(data);
  }, { perPage: 10 });
}

function renderClientTableBody(clients) {
  if (!clients.length) {
    $('clientTbody').innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="fas fa-briefcase"></i>No clients found</div></td></tr>';
    return;
  }
  
  $('clientTbody').innerHTML = clients.map(c => `
    <tr>
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

// Keep original for compatibility
function renderClientTable() {
  filterAndUpdateClients();
}

function openClientModal(clientId = null) {
  populateCPSelects();
  const c = clientId ? DB.clients.find(x => x.id === clientId) : null;
  $('clientTitle').textContent = c ? 'Edit Client' : 'Add Client';
  $('cl_name').value = c?.name || '';
  $('cl_contact').value = c?.contact || '';
  $('cl_email').value = c?.email || '';
  $('cl_phone').value = c?.phone || '';
  if (c) {
    $('cl_sitesCheck').querySelectorAll('input').forEach(cb => {
      cb.checked = (c.siteIds || []).includes(+cb.value);
    });
  }
  $('cl_save').onclick = () => saveClient(clientId);
  openM('clientModal');
}

function saveClient(clientId) {
  const data = {
    name: $('cl_name').value.trim(),
    contact: $('cl_contact').value.trim(),
    email: $('cl_email').value.trim(),
    phone: $('cl_phone')?.value.trim(),
    siteIds: [...$('cl_sitesCheck').querySelectorAll('input:checked')].map(i => +i.value),
    status: 'active'
  };
  if (!data.name) {
    toast('Name required', 'error');
    return;
  }
  if (clientId) {
    Object.assign(DB.clients.find(c => c.id === clientId), data);
  } else {
    DB.clients.push({ id: generateId('clients'), ...data });
  }
  closeM('clientModal');
  filterAndUpdateClients();
  toast('Client saved', 'success');
}

function deleteClient(id) {
  if (!confirm('Delete client?')) return;
  DB.clients.splice(DB.clients.findIndex(c => c.id === id), 1);
  filterAndUpdateClients();
  toast('Client deleted', 'success');
}

// ========== TICKETS TABLE (with pagination) ==========
function filterAndUpdateTickets() {
  const st = $('ticketStatus')?.value || '';
  const cid = +$('ticketClient')?.value || 0;
  
  const filteredTickets = DB.tickets.filter(t => {
    if (st && t.status !== st) return false;
    if (cid && t.clientId !== cid) return false;
    return true;
  });
  
  // Sort by created date (newest first)
  filteredTickets.sort((a, b) => new Date(b.created) - new Date(a.created));
  
  createPaginator('ticketTbody', filteredTickets, (data) => {
    renderTicketTableBody(data);
  }, { perPage: 10 });
}

function renderTicketTableBody(tickets) {
  if (!tickets.length) {
    $('ticketTbody').innerHTML = '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-ticket"></i>No tickets found</div></td></tr>';
    return;
  }
  
  $('ticketTbody').innerHTML = tickets.map(t => {
    const c = DB.clients.find(x => x.id === t.clientId);
    const a = userById(t.assigneeId);
    let statusClass = 'active';
    if (t.status === 'open') statusClass = 'active';
    else if (t.status === 'in-progress') statusClass = 'in-progress';
    else if (t.status === 'closed') statusClass = 'completed';
    
    return `
      <tr>
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

// Keep original for compatibility
function renderTicketTable() {
  filterAndUpdateTickets();
}

function openTicketModal(ticketId = null) {
  populateCPSelects();
  const t = ticketId ? DB.tickets.find(x => x.id === ticketId) : null;
  $('ticketTitle').textContent = t ? 'Edit Ticket' : 'New Ticket';
  $('tk_client').value = t?.clientId || DB.clients[0]?.id || '';
  $('tk_priority').value = t?.priority || 'medium';
  $('tk_subject').value = t?.subject || '';
  $('tk_desc').value = t?.desc || '';
  $('tk_assignee').value = t?.assigneeId || '';
  $('tk_save').onclick = () => saveTicket(ticketId);
  openM('ticketModal');
}

function saveTicket(ticketId) {
  const data = {
    clientId: +$('tk_client').value,
    priority: $('tk_priority').value,
    subject: $('tk_subject').value.trim(),
    desc: $('tk_desc').value.trim(),
    assigneeId: +$('tk_assignee').value,
    status: 'open',
    created: nowStr().slice(0, 10),
    updated: nowStr().slice(0, 10)
  };
  if (!data.subject) {
    toast('Subject required', 'error');
    return;
  }
  if (ticketId) {
    Object.assign(DB.tickets.find(t => t.id === ticketId), { ...data, updated: nowStr().slice(0, 10) });
    sendEmail(DB.clients.find(c => c.id === data.clientId)?.email || '', 'Ticket Updated', 'ticket_update');
  } else {
    DB.tickets.push({ id: generateId('tickets'), ...data });
    logAction('create', `Ticket #${nextId.tickets - 1}`, `Created for client`);
  }
  closeM('ticketModal');
  filterAndUpdateTickets();
  toast('Ticket saved', 'success');
}

function deleteTicket(id) {
  if (!confirm('Delete ticket?')) return;
  DB.tickets.splice(DB.tickets.findIndex(t => t.id === id), 1);
  filterAndUpdateTickets();
  toast('Ticket deleted', 'success');
}
/* ============================================================
   33. REPORTS
   ============================================================ */
function renderReports() {
  $('rptGenerate')?.addEventListener('click', generateReport);
  $('rptExport')?.addEventListener('click', () => {
    const currentData = window.currentReportData;
    if (currentData && currentData.length) {
      exportCSV(currentData, 'report.csv');
      toast('Report exported to CSV', 'success');
    } else {
      toast('No data to export', 'warn');
    }
  });
  $('rptPrint')?.addEventListener('click', () => window.print());
}

function generateReport() {
  const type = $('rptType')?.value;
  const output = $('rptOutput');
  
  const reports = {
    leave: () => {
      const data = DB.leaveRequests.map(l => ({
        User: userById(l.userId)?.name,
        Type: l.type,
        From: l.from,
        To: l.to,
        Days: l.days,
        Status: l.status
      }));
      return { data, title: 'Leave Summary' };
    },
    documents: () => {
      const data = DB.users.map(u => ({
        User: u.name,
        Docs: DB.documents.filter(d => d.userId === u.id).length,
        Approved: DB.documents.filter(d => d.userId === u.id && d.status === 'approved').length,
        Pending: DB.documents.filter(d => d.userId === u.id && d.status === 'pending').length
      }));
      return { data, title: 'Document Completion' };
    },
    activity: () => {
      const data = DB.auditLog.map(l => ({
        Time: l.time,
        User: userById(l.userId)?.name,
        Action: l.action,
        Target: l.target,
        Details: l.details
      }));
      return { data, title: 'User Activity' };
    },
    payroll: () => {
      const data = DB.payroll.map(p => ({
        Employee: userById(p.userId)?.name,
        Base: fmtMoney(p.baseSalary),
        Overtime: fmtMoney(p.overtime),
        Bonus: fmtMoney(p.bonus),
        Deductions: fmtMoney(p.deductions),
        Net: fmtMoney(netPay(p)),
        Status: p.status
      }));
      return { data, title: 'Payroll Summary' };
    },
    tasks: () => {
      const data = DB.tasks.map(t => ({
        Task: t.title,
        Project: projectById(t.projectId)?.name,
        Assignee: userById(t.assigneeId)?.name,
        Status: t.status,
        Priority: t.priority,
        DueDate: fmt(t.dueDate)
      }));
      return { data, title: 'Task Completion' };
    },
    safety: () => {
      const data = DB.incidents.map(i => ({
        Date: i.date,
        Site: siteById(i.siteId)?.name,
        Severity: i.severity,
        Type: i.type,
        Status: i.status === 'open' ? 'Open' : 'Resolved',
        Description: i.desc
      }));
      return { data, title: 'Safety Incidents' };
    }
  };
  
  const report = reports[type]?.();
  if (report && report.data.length) {
    window.currentReportData = report.data;
    displayReportWithPagination(report.data, report.title, output);
  } else {
    output.innerHTML = '<div class="empty-state"><i class="fas fa-chart-bar"></i>No data available for this report</div>';
    window.currentReportData = [];
  }
}

function displayReportWithPagination(data, title, container) {
  if (!data.length) {
    container.innerHTML = '<div class="empty-state">No data for this report</div>';
    return;
  }
  
  const keys = Object.keys(data[0]);
  
  // Create table structure
  const tableHtml = `
    <div style="font-family:\'Space Grotesk\',sans-serif;font-weight:700;margin-bottom:1rem;">${title}</div>
    <div style="overflow-x:auto;">
      <table class="dt" id="reportTable">
        <thead>
          <tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr>
        </thead>
        <tbody id="reportTbody"></tbody>
      </table>
    </div>
  `;
  
  container.innerHTML = tableHtml;
  
  // Create paginator for report table
  createPaginator('reportTbody', data, (pageData) => {
    renderReportBody(pageData, keys);
  }, { perPage: 10 });
}

function renderReportBody(pageData, keys) {
  const tbody = $('reportTbody');
  if (!tbody) return;
  
  tbody.innerHTML = pageData.map(row => `
    <tr>
      ${keys.map(k => `<td>${row[k] || '—'}</td>`).join('')}
    </tr>
  `).join('');
}

// Keep original function for compatibility
function tableFromData(data, title) {
  if (!data.length) return '<div class="empty-state">No data for this report</div>';
  
  const keys = Object.keys(data[0]);
  const container = document.createElement('div');
  displayReportWithPagination(data, title, container);
  return container.innerHTML;
}

/* ============================================================
   34. SETTINGS
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
      $$('[data-settab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.values(panels).forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
      });
      const target = $(panels[btn.dataset.settab]);
      if (target) target.style.display = '';
    });
  });
}

function loadSettingsValues() {
  const s = DB.settings;
  const set = (id, val) => {
    const el = $(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = val;
    else el.value = val;
  };
  
  set('sysName', s.systemName);
  set('sysTz', s.timezone);
  set('sysDateFmt', s.dateFormat);
  set('sysCurrency', s.currency || 'USD');
  set('currencyPosition', s.currencyPosition || 'before');
  set('swEmail', s.emailNotif);
  set('swSms', s.smsAlerts);
  set('swPush', s.pushNotif);
  set('swMaintenance', s.maintenanceMode);
  set('workStart', s.workStart);
  set('workEnd', s.workEnd);
  set('sesTimeout', s.sessionTimeout);
  set('maxLogin', s.maxLoginAttempts);
  set('pwdLen', s.passwordMinLen);
  set('sw2fa', s.twoFactor);
  set('swIp', s.ipWhitelist);
  set('swAudit', s.auditLogging);
  set('swCompact', s.compactMode);
  set('swAnims', s.animations);
  set('ejsService', s.ejsService);
  set('ejsPublicKey', s.ejsPublicKey);
  set('ejsTplWelcome', s.ejsTplWelcome);
  set('ejsTplLeave', s.ejsTplLeave);
  set('ejsTplDoc', s.ejsTplDoc);
  set('ejsTplTask', s.ejsTplTask);
  set('ejsTplPayslip', s.ejsTplPayslip);
  set('ejsTplIncident', s.ejsTplIncident);
  set('ejsTplTicket', s.ejsTplTicket);
  set('coName', s.companyName);
  set('coAddr', s.companyAddress);
  set('coPhone', s.companyPhone);
  set('coEmail', s.companyEmail);
  set('coWeb', s.companyWeb);
  set('lpAnnual', s.lpAnnual);
  set('lpSick', s.lpSick);
  set('lpEmergency', s.lpEmergency);
  set('lpMaxConsec', s.lpMaxConsec);
  set('lpNotice', s.lpNotice);
  set('swCarry', s.carryForward);
  set('swApproval', s.requireApproval);
  
  // Apply currency formatting to all money displays
  applyCurrencyFormatting();
}

function wireSettingsEvents() {
  $('saveSettingsBtn')?.addEventListener('click', saveSettings);
  $('clearCacheBtn')?.addEventListener('click', () => { if (confirm('Clear cache?')) toast('Cache cleared', 'success'); });
  $('wipeDataBtn')?.addEventListener('click', () => { if (confirm('WARNING: This will delete ALL data. Are you sure?')) { if (confirm('Are you REALLY sure?')) toast('Data wipe cancelled (demo only)', 'warn'); } });
  $('exportAllBtn')?.addEventListener('click', () => exportCSV(DB.users, 'all_users.csv'));
  $('ejsTestBtn')?.addEventListener('click', () => { sendEmail('test@nixers.pro', 'Test Email from Nixers Pro', 'welcome_approved'); toast('Test email sent', 'success'); });
  $('logoDropZone')?.addEventListener('click', () => $('logoInput')?.click());
  $('logoInput')?.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = ev => { $('logoPreview').src = ev.target.result; $('logoPreview').style.display = 'block'; }; r.readAsDataURL(f);
  });
  $$('#colorSwatches .color-sw').forEach(sw => {
    sw.addEventListener('click', () => {
      $$('#colorSwatches .color-sw').forEach(s => s.classList.remove('sel'));
      sw.classList.add('sel');
      setAccentColor(sw.dataset.color);
    });
  });
  $('tplPreviewSelect')?.addEventListener('change', updateTplPreview);
  updateTplPreview();
  
  // Live currency preview when selection changes
  $('sysCurrency')?.addEventListener('change', () => {
    const currency = $('sysCurrency').value;
    const position = $('currencyPosition').value;
    updateCurrencyPreview(currency, position);
  });
  $('currencyPosition')?.addEventListener('change', () => {
    const currency = $('sysCurrency').value;
    const position = $('currencyPosition').value;
    updateCurrencyPreview(currency, position);
  });
  
  // Password change events
  $('changePasswordBtn')?.addEventListener('click', changePassword);
  $('resetPasswordLinkBtn')?.addEventListener('click', sendPasswordResetLink);
  $('newPassword')?.addEventListener('input', checkPasswordStrength);
}

function saveSettings() {
  const s = DB.settings;
  const get = (id, def = '') => {
    const el = $(id);
    if (!el) return def;
    if (el.type === 'checkbox') return el.checked;
    return el.value;
  };
  
  s.systemName = get('sysName');
  s.timezone = get('sysTz');
  s.dateFormat = get('sysDateFmt');
  s.currency = get('sysCurrency');
  s.currencyPosition = get('currencyPosition');
  s.emailNotif = get('swEmail');
  s.smsAlerts = get('swSms');
  s.pushNotif = get('swPush');
  s.maintenanceMode = get('swMaintenance');
  s.workStart = get('workStart');
  s.workEnd = get('workEnd');
  s.sessionTimeout = +get('sesTimeout');
  s.maxLoginAttempts = +get('maxLogin');
  s.passwordMinLen = +get('pwdLen');
  s.twoFactor = get('sw2fa');
  s.ipWhitelist = get('swIp');
  s.auditLogging = get('swAudit');
  s.compactMode = get('swCompact');
  s.animations = get('swAnims');
  s.ejsService = get('ejsService');
  s.ejsPublicKey = get('ejsPublicKey');
  s.ejsTplWelcome = get('ejsTplWelcome');
  s.ejsTplLeave = get('ejsTplLeave');
  s.ejsTplDoc = get('ejsTplDoc');
  s.ejsTplTask = get('ejsTplTask');
  s.ejsTplPayslip = get('ejsTplPayslip');
  s.ejsTplIncident = get('ejsTplIncident');
  s.ejsTplTicket = get('ejsTplTicket');
  s.companyName = get('coName');
  s.companyAddress = get('coAddr');
  s.companyPhone = get('coPhone');
  s.companyEmail = get('coEmail');
  s.companyWeb = get('coWeb');
  s.lpAnnual = +get('lpAnnual');
  s.lpSick = +get('lpSick');
  s.lpEmergency = +get('lpEmergency');
  s.lpMaxConsec = +get('lpMaxConsec');
  s.lpNotice = +get('lpNotice');
  s.carryForward = get('swCarry');
  s.requireApproval = get('swApproval');
  
  document.body.classList.toggle('compact', s.compactMode);
  
  // Apply currency formatting
  applyCurrencyFormatting();
  
  logAction('update', 'Settings', 'System settings updated');
  toast('Settings saved', 'success');
}

// Function to update currency preview
function updateCurrencyPreview(currency, position) {
  const symbols = {
    USD: '$', EUR: '€', GBP: '£', BDT: '৳', AED: 'د.إ', SAR: 'ر.س',
    INR: '₹', CAD: 'C$', AUD: 'A$', JPY: '¥', CNY: '¥', SGD: 'S$', MYR: 'RM'
  };
  const symbol = symbols[currency] || '$';
  const amount = 1234.56;
  let formatted = '';
  
  switch (position) {
    case 'before':
      formatted = `${symbol}${amount.toLocaleString()}`;
      break;
    case 'after':
      formatted = `${amount.toLocaleString()}${symbol}`;
      break;
    case 'space_before':
      formatted = `${symbol} ${amount.toLocaleString()}`;
      break;
    case 'space_after':
      formatted = `${amount.toLocaleString()} ${symbol}`;
      break;
    default:
      formatted = `${symbol}${amount.toLocaleString()}`;
  }
  
  // Show preview if preview element exists
  const previewEl = $('currencyPreview');
  if (previewEl) {
    previewEl.innerHTML = `<span style="color:var(--accent);">Preview: ${formatted}</span>`;
  } else {
    // Create preview element if it doesn't exist
    const currencyRow = document.querySelector('#sysCurrency')?.closest('.fg');
    if (currencyRow && !$('currencyPreview')) {
      const previewDiv = document.createElement('div');
      previewDiv.id = 'currencyPreview';
      previewDiv.className = 'fg';
      previewDiv.style.marginTop = '0.5rem';
      previewDiv.innerHTML = `<span style="color:var(--accent);font-size:0.8rem;">Preview: ${formatted}</span>`;
      currencyRow.after(previewDiv);
    } else if ($('currencyPreview')) {
      $('currencyPreview').innerHTML = `<span style="color:var(--accent);font-size:0.8rem;">Preview: ${formatted}</span>`;
    }
  }
}

// Function to apply currency formatting to all money displays
function applyCurrencyFormatting() {
  const currency = DB.settings.currency || 'USD';
  const position = DB.settings.currencyPosition || 'before';
  const symbols = {
    USD: '$', EUR: '€', GBP: '£', BDT: '৳', AED: 'د.إ', SAR: 'ر.س',
    INR: '₹', CAD: 'C$', AUD: 'A$', JPY: '¥', CNY: '¥', SGD: 'S$', MYR: 'RM'
  };
  const symbol = symbols[currency] || '$';
  
  // Store current settings globally for use in fmtMoney function
  window.currencySymbol = symbol;
  window.currencyPosition = position;
  
  // Update all money displays on the page
  document.querySelectorAll('[data-money]').forEach(el => {
    const amount = parseFloat(el.dataset.money);
    if (!isNaN(amount)) {
      el.textContent = formatMoneyWithSettings(amount);
    }
  });
}

// Enhanced fmtMoney function that uses currency settings
function fmtMoneyWithSettings(amount) {
  if (amount === undefined || amount === null) return '—';
  const num = Number(amount);
  if (isNaN(num)) return '—';
  
  const symbol = window.currencySymbol || '$';
  const position = window.currencyPosition || 'before';
  const formattedAmount = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  switch (position) {
    case 'before': return `${symbol}${formattedAmount}`;
    case 'after': return `${formattedAmount}${symbol}`;
    case 'space_before': return `${symbol} ${formattedAmount}`;
    case 'space_after': return `${formattedAmount} ${symbol}`;
    default: return `${symbol}${formattedAmount}`;
  }
}

// Override the global fmtMoney function
if (typeof originalFmtMoney === 'undefined') {
  var originalFmtMoney = fmtMoney;
}
window.fmtMoney = fmtMoneyWithSettings;

function setAccentColor(color) {
  document.documentElement.style.setProperty('--accent', color);
  DB.settings.accentColor = color;
  toast('Accent color updated', 'success');
}

function updateTplPreview() {
  const type = $('tplPreviewSelect')?.value || 'welcome';
  const previews = {
    welcome: `<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Welcome to Nixers Pro<br><br>Dear <strong>{name}</strong>,<br><br>Your account has been approved. You can now log in to Nixers Pro.<br><br>Best regards,<br>Nixers Admin Team</div>`,
    leave: `<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Leave Request Update<br><br>Dear <strong>{name}</strong>,<br><br>Your leave request for <strong>{type}</strong> leave from {from} to {to} has been <strong>{status}</strong>.<br><br>{comment}<br><br>Regards,<br>HR Team</div>`,
    task: `<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> New Task Assigned<br><br>Hi <strong>{name}</strong>,<br><br>You have been assigned a new task: <strong>{task_title}</strong><br>Project: {project}<br>Due: {due_date}<br><br>Please log in to view details.<br><br>Thanks,<br>Nixers Team</div>`,
    payslip: `<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Your Payslip is Ready<br><br>Dear <strong>{name}</strong>,<br><br>Your payslip for <strong>{period}</strong> is ready.<br>Net Pay: <strong>{net_pay}</strong><br><br>Please log in to download.<br><br>Payroll Team</div>`,
  };
  if ($('tplPreviewBox')) $('tplPreviewBox').innerHTML = previews[type] || 'Select a template';
}

// ========== PASSWORD MANAGEMENT FUNCTIONS ==========

// Function to change password
function changePassword() {
  const currentPassword = $('currentPassword')?.value;
  const newPassword = $('newPassword')?.value;
  const confirmPassword = $('confirmPassword')?.value;
  
  // Validation
  if (!currentPassword) {
    toast('Please enter current password', 'error');
    return;
  }
  
  if (!newPassword) {
    toast('Please enter new password', 'error');
    return;
  }
  
  const minLength = DB.settings.passwordMinLen || 8;
  if (newPassword.length < minLength) {
    toast(`Password must be at least ${minLength} characters`, 'error');
    return;
  }
  
  if (newPassword !== confirmPassword) {
    toast('New passwords do not match', 'error');
    return;
  }
  
  // In a real app, you would verify current password against stored hash
  // For demo, we'll check against a stored password
  const storedPassword = DB.settings.userPassword || 'admin123';
  
  if (currentPassword !== storedPassword) {
    toast('Current password is incorrect', 'error');
    return;
  }
  
  // Update password (in real app, hash and store)
  DB.settings.userPassword = newPassword;
  logAction('update', 'Password', `${currentUser?.name || 'User'} changed their password`);
  
  // Clear fields
  $('currentPassword').value = '';
  $('newPassword').value = '';
  $('confirmPassword').value = '';
  $('passwordStrength').innerHTML = '';
  
  toast('Password changed successfully', 'success');
}

// Function to send password reset link
function sendPasswordResetLink() {
  const userEmail = currentUser?.email || DB.settings.companyEmail;
  
  if (!userEmail) {
    toast('No email address found', 'error');
    return;
  }
  
  // Generate reset token (in real app, store in DB with expiry)
  const resetToken = generateResetToken();
  const resetLink = `${window.location.origin}/reset-password?token=${resetToken}`;
  
  // Store reset token (for demo purposes)
  if (!DB.passwordResetTokens) DB.passwordResetTokens = {};
  DB.passwordResetTokens[resetToken] = {
    email: userEmail,
    expires: Date.now() + 3600000 // 1 hour expiry
  };
  
  // Send email with reset link
  sendEmail(
    userEmail,
    'Password Reset Request',
    'password_reset'
  );
  
  // Also log the reset link for demo purposes
  console.log('Password reset link (demo):', resetLink);
  
  toast(`Password reset link sent to ${userEmail}`, 'success');
  logAction('request', 'Password Reset', `Reset link sent to ${userEmail}`);
}

// Generate a random reset token
function generateResetToken() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// Check password strength
function checkPasswordStrength() {
  const password = $('newPassword')?.value || '';
  const strengthEl = $('passwordStrength');
  
  if (!strengthEl) return;
  
  if (password.length === 0) {
    strengthEl.innerHTML = '';
    return;
  }
  
  let strength = 0;
  let message = '';
  let color = '';
  
  // Length check
  if (password.length >= 8) strength++;
  if (password.length >= 12) strength++;
  
  // Contains number
  if (/\d/.test(password)) strength++;
  
  // Contains uppercase
  if (/[A-Z]/.test(password)) strength++;
  
  // Contains lowercase
  if (/[a-z]/.test(password)) strength++;
  
  // Contains special character
  if (/[^A-Za-z0-9]/.test(password)) strength++;
  
  // Determine strength
  if (strength <= 2) {
    message = 'Weak password';
    color = '#f87171';
  } else if (strength <= 4) {
    message = 'Medium password';
    color = '#f97316';
  } else {
    message = 'Strong password';
    color = '#34d399';
  }
  
  strengthEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.5rem;">
      <div style="flex:1;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;">
        <div style="width:${(strength / 6) * 100}%;height:100%;background:${color};border-radius:2px;"></div>
      </div>
      <span style="color:${color};">${message}</span>
    </div>
  `;
}

/* ============================================================
   35. EMAIL HELPER
   ============================================================ */
function sendEmail(to, subject, template){
  const entry={id:generateId('emailLog'),to,subject,template,sentAt:nowStr(),status:'sent'};
  DB.emailLog.unshift(entry);
  /* If EmailJS is configured, send real email */
  const s=DB.settings;
  if(s.ejsService&&s.ejsPublicKey&&window.emailjs){
    const tplId=s[`ejsTpl${template.split('_').map(w=>w[0].toUpperCase()+w.slice(1)).join('')}`]||template;
    window.emailjs.send(s.ejsService,tplId,{to_email:to,subject},{publicKey:s.ejsPublicKey})
      .catch(()=>{ entry.status='failed'; });
  }
}

/* ============================================================
   36. FLOATING CHAT WIDGET
   ============================================================ */
function initFloatChat(){
  $('fcBtn')?.addEventListener('click',()=>$('fcWidget').classList.toggle('open'));
  $('fcCloseBtn')?.addEventListener('click',()=>$('fcWidget').classList.remove('open'));
  $('fcSendBtn')?.addEventListener('click',sendFCMsg);
  $('fcInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')sendFCMsg();});
  /* initial message */
  addFCMsg('system','Hello! How can I help you today?');
}

function sendFCMsg(){
  const txt=$('fcInput')?.value.trim();if(!txt)return;
  addFCMsg('mine',txt);
  $('fcInput').value='';
  setTimeout(()=>addFCMsg('system','Got it! I\'ll look into that for you.'),600);
}

function addFCMsg(who,text){
  const box=$('fcMsgs');if(!box)return;
  const isSystem=who==='system';
  const div=document.createElement('div');
  div.style.cssText=`display:flex;gap:0.4rem;align-items:flex-end;${isSystem?'':'flex-direction:row-reverse;'}`;
  div.innerHTML=`<div style="max-width:80%;background:${isSystem?'var(--surface2)':'rgba(234,179,8,0.18)'};border-radius:12px;padding:0.5rem 0.75rem;font-size:0.8rem;line-height:1.4;">${text}</div>`;
  box.appendChild(div);box.scrollTop=box.scrollHeight;
}

/* ============================================================
   37. TOPBAR AVATAR SYNC
   ============================================================ */
function updateTopbarAvatar(){
  const u=currentUser;
  const topAv=$('topAvatar');
  const pdAv=$('pdAvatar');
  const sbAv=$('sbAvatar');
  if(!topAv)return;
  if(u.avatarImg){
    topAv.innerHTML=`<img src="${u.avatarImg}" alt="">`;
    if(pdAv)pdAv.innerHTML=`<img src="${u.avatarImg}" alt="">`;
    if(sbAv)sbAv.innerHTML=`<img src="${u.avatarImg}" alt="">`;
  } else {
    topAv.textContent=initials(u.name);
    topAv.style.background=u.avatarColor+'22';
    topAv.style.color=u.avatarColor;
    if(pdAv){pdAv.textContent=initials(u.name);pdAv.style.background=u.avatarColor+'22';pdAv.style.color=u.avatarColor;}
    if(sbAv){sbAv.textContent=initials(u.name);sbAv.style.background=u.avatarColor+'22';sbAv.style.color=u.avatarColor;}
  }
  if($('sbName'))$('sbName').textContent=u.name;
  if($('pdName'))$('pdName').textContent=u.name;
}

/* ============================================================
   38. SIDEBAR ADMIN CARD
   ============================================================ */
function initSidebarCard(){
  $('sbAdminCard')?.addEventListener('click',()=>openProfileModal(currentUser.id));
}

/* ============================================================
   39. KEYBOARD SHORTCUTS
   ============================================================ */
function initShortcuts(){
  document.addEventListener('keydown',e=>{
    if(e.altKey){
      const map={'d':'dashboard','u':'users','s':'sites','p':'posts','m':'messages','a':'analytics','t':'tasks'};
      if(map[e.key]){e.preventDefault();showPage(map[e.key]);}
    }
  });
}

/* ============================================================
   40. INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded',()=>{
  initTheme();
  initNav();
  initTopbar();
  initFloatChat();
  initSidebarCard();
  initShortcuts();
  updateTopbarAvatar();
  showPage('dashboard');
  /* Log login */
  logAction('login','system',`${currentUser.name} logged in`);
  console.log('%c NIXERS PRO ADMIN %c v2.0 ', 'background:#eab308;color:#0a0f1a;font-weight:800;padding:4px 8px;border-radius:4px 0 0 4px;','background:#111827;color:#eab308;font-weight:600;padding:4px 8px;border-radius:0 4px 4px 0;');
});
