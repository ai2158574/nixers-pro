/* ============================================================
   NIXERS PRO — dashboard.js
   Global shared logic: theme, nav, topbar, sidebar, utilities,
   toast, modals, paginator, floating chat, shortcuts, avatar sync.
   Load this file BEFORE any role-specific JS (admin.js, worker.js, etc.)
   ============================================================ */

'use strict';

/* ============================================================
   1. SHARED DATA STORE REFERENCE
   Each role file must set window.APP_DATA.DB before this runs,
   or set it after DOMContentLoaded. dashboard.js itself only
   reads DB when it needs it (e.g. for notifications badge).
   ============================================================ */
const getDB = () => window.APP_DATA?.DB;

/* ============================================================
   2. DOM UTILITIES
   ============================================================ */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

/* ============================================================
   3. FORMAT UTILITIES
   ============================================================ */
function fmt(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d)) return date;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMoney(n) {
  // Uses currency settings if available, falls back to $
  if (typeof fmtMoneyWithSettings === 'function') return fmtMoneyWithSettings(n);
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function nowStr() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

/* ============================================================
   4. AVATAR / BADGE HELPERS
   ============================================================ */
function avatarEl(user, size = 34) {
  const DB = getDB();
  const u = typeof user === 'number' ? (DB?.users?.find(x => x.id === user)) : user;
  if (!u) return `<div class="u-av" style="width:${size}px;height:${size}px;background:#334155;color:#94a3b8;">?</div>`;
  const bg = u.avatarColor || '#eab308';
  const img = u.avatarImg ? `<img src="${u.avatarImg}" alt="">` : '';
  return `<div class="u-av" style="width:${size}px;height:${size}px;background:${img ? 'transparent' : bg + '22'};color:${bg};font-size:${size * 0.35}px;">${img || initials(u.name)}</div>`;
}

function roleBadge(role) {
  const map = { admin: 'b-admin', manager: 'b-manager', worker: 'b-worker' };
  return `<span class="badge ${map[role] || ''}">${role}</span>`;
}

function statusBadge(s) {
  return `<span class="badge b-${s}">${s.replace(/-/g, ' ')}</span>`;
}

function severityBadge(s) {
  const map = { critical: 'b-critical', high: 'b-high', medium: 'b-medium', low: 'b-low' };
  return `<span class="badge ${map[s] || 'b-low'}">${s}</span>`;
}

function priorityBadge(p) { return severityBadge(p); }

function onlineDot(user) {
  const DB = getDB();
  const u = typeof user === 'number' ? DB?.users?.find(x => x.id === user) : user;
  const st = u?.online || 'offline';
  return `<span class="online-dot ${st}" title="${st}"></span>`;
}

/* ============================================================
   5. TOAST
   ============================================================ */
function toast(msg, type = 'info', duration = 3000) {
  const icons = { success: 'fa-check-circle', error: 'fa-circle-xmark', info: 'fa-circle-info', warn: 'fa-triangle-exclamation' };
  const colors = { success: '#34d399', error: '#f87171', info: '#60a5fa', warn: '#eab308' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas ${icons[type] || 'fa-circle-info'}" style="color:${colors[type]};font-size:1rem;flex-shrink:0;"></i><span>${msg}</span>`;
  const wrap = $('toastWrap');
  if (wrap) wrap.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(100%)';
    t.style.transition = '0.3s';
    setTimeout(() => t.remove(), 300);
  }, duration);
}

/* ============================================================
   6. MODAL HELPERS
   ============================================================ */
function openM(id) { const el = $(id); if (el) el.classList.add('open'); }
function closeM(id) { const el = $(id); if (el) el.classList.remove('open'); }

/* Auto-wire all [data-close] buttons and overlay clicks */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-close]');
  if (btn) closeM(btn.dataset.close);
  if (e.target.classList.contains('modal-ov')) closeM(e.target.id);
  // Close profile dropdown
  if (!e.target.closest('#topAvatar') && !e.target.closest('#profileDropdown')) {
    $('profileDropdown')?.classList.remove('open');
  }
});

/* ============================================================
   7. PAGINATION SYSTEM
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

  init() { this.render(); }

  getTotalPages() { return Math.ceil(this.data.length / this.perPage); }

  getCurrentPageData() {
    const start = (this.currentPage - 1) * this.perPage;
    return this.data.slice(start, start + this.perPage);
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

    this.renderFn(currentData);

    const paginationHtml = `
      <div class="pagination-container">
        <div class="pagination-info">Showing ${start} to ${end} of ${this.data.length} entries</div>
        <div class="pagination-controls">
          <select class="per-page-select" id="perPage-${this.containerId}">
            ${this.perPageOptions.map(opt => `<option value="${opt}" ${this.perPage === opt ? 'selected' : ''}>${opt} per page</option>`).join('')}
          </select>
          <button class="pagination-btn" id="firstPage-${this.containerId}" ${this.currentPage === 1 ? 'disabled' : ''}><i class="fas fa-angle-double-left"></i></button>
          <button class="pagination-btn" id="prevPage-${this.containerId}" ${this.currentPage === 1 ? 'disabled' : ''}><i class="fas fa-angle-left"></i></button>
          <div class="pagination-numbers" id="pageNumbers-${this.containerId}">${this.generatePageNumbers(totalPages)}</div>
          <button class="pagination-btn" id="nextPage-${this.containerId}" ${this.currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}><i class="fas fa-angle-right"></i></button>
          <button class="pagination-btn" id="lastPage-${this.containerId}" ${this.currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}><i class="fas fa-angle-double-right"></i></button>
        </div>
      </div>`;

    const tableWrapper = container.closest('.panel') || container.parentElement;
    let paginationDiv = document.getElementById(`pagination-${this.containerId}`);
    if (!paginationDiv) {
      paginationDiv = document.createElement('div');
      paginationDiv.id = `pagination-${this.containerId}`;
      tableWrapper.appendChild(paginationDiv);
    }
    paginationDiv.innerHTML = paginationHtml;

    $(`perPage-${this.containerId}`)?.addEventListener('change', e => this.changePerPage(parseInt(e.target.value)));
    $(`firstPage-${this.containerId}`)?.addEventListener('click', () => this.changePage(1));
    $(`prevPage-${this.containerId}`)?.addEventListener('click', () => this.changePage(this.currentPage - 1));
    $(`nextPage-${this.containerId}`)?.addEventListener('click', () => this.changePage(this.currentPage + 1));
    $(`lastPage-${this.containerId}`)?.addEventListener('click', () => this.changePage(totalPages));

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

/* Global paginator store — shared across all role dashboards */
window.paginators = window.paginators || {};

function createPaginator(tableId, data, renderFn, options = {}) {
  if (window.paginators[tableId]) {
    window.paginators[tableId].updateData(data);
  } else {
    window.paginators[tableId] = new Paginator(data, tableId, renderFn, options);
  }
  return window.paginators[tableId];
}

/* ============================================================
   8. THEME
   ============================================================ */
function initTheme() {
  const saved = localStorage.getItem('nxTheme') || 'light';
  setTheme(saved, false);
}

function setTheme(theme, save = true) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('themeBtn');
  if (btn) btn.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
  if (save) localStorage.setItem('nxTheme', theme);
  // Redraw charts if chart instances exist
  const ci = window.chartInstances || {};
  Object.values(ci).forEach(c => {
    if (c.options?.plugins?.legend?.labels) c.options.plugins.legend.labels.color = chartTextColor();
    c.update?.();
  });
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  setTheme(cur === 'dark' ? 'light' : 'dark');
}

function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
function chartTextColor() { return isDark() ? '#94a3b8' : '#64748b'; }
function chartGridColor() { return isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'; }

function chartDefaults() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartTextColor(), font: { family: 'DM Sans', size: 11 } } } },
    scales: {
      x: { ticks: { color: chartTextColor() }, grid: { color: chartGridColor() } },
      y: { ticks: { color: chartTextColor() }, grid: { color: chartGridColor() } },
    }
  };
}

/* ============================================================
   9. CHART HELPERS  (require Chart.js to be loaded)
   ============================================================ */
window.chartInstances = window.chartInstances || {};

function destroyChart(id) {
  if (window.chartInstances[id]) { window.chartInstances[id].destroy(); delete window.chartInstances[id]; }
}

function makeChart(id, config) {
  destroyChart(id);
  const el = $(id);
  if (!el) return;
  window.chartInstances[id] = new Chart(el.getContext('2d'), config);
  return window.chartInstances[id];
}

/* ============================================================
   10. SIDEBAR + NAVIGATION
   ============================================================ */
function initNav() {
  $$('.sb-nav a').forEach(a => {
    a.addEventListener('click', () => {
      const page = a.dataset.page;
      if (!page) return;
      showPage(page);
      if (window.innerWidth < 768) closeMobileSidebar();
    });
  });
  $('menuBtn')?.addEventListener('click', toggleMobileSidebar);
  $('sidebarOv')?.addEventListener('click', closeMobileSidebar);
}

/**
 * showPage — hides all [id^="page-"] elements, shows the target,
 * updates nav active state and topbar title.
 * The role-specific file provides a renderPage(pageKey) function
 * that is called here to populate the page.
 */
function showPage(pageKey) {
  $$('[id^="page-"]').forEach(el => el.style.display = 'none');
  const target = $(`page-${pageKey}`);
  if (target) target.style.display = 'block';

  $$('.sb-nav a').forEach(a => a.classList.toggle('active', a.dataset.page === pageKey));

  // Page title map — role files can extend window.PAGE_TITLES
  const baseTitles = {
    dashboard: 'Dashboard', analytics: 'Analytics', reports: 'Reports',
    users: 'Users', leave: 'Leave Management', timesheets: 'Timesheets',
    payroll: 'Payroll Preview', tasks: 'Tasks & Projects', shifts: 'Shift Scheduling',
    equipment: 'Equipment & Inventory', sites: 'Sites', posts: 'Posts',
    documents: 'Documents', categories: 'Categories', messages: 'Messages',
    notifications: 'Notifications', emailcenter: 'Email Center',
    safety: 'Safety & Incidents', auditlog: 'Audit Log',
    rbac: 'RBAC Permissions', clientportal: 'Client Portal', settings: 'Settings',
  };
  const titles = Object.assign({}, baseTitles, window.PAGE_TITLES || {});
  const titleEl = $('pageTitle');
  if (titleEl) titleEl.textContent = titles[pageKey] || pageKey;

  // Delegate to role-specific renderer
  if (typeof renderPage === 'function') renderPage(pageKey);
}

function toggleMobileSidebar() {
  $('sidebar').classList.toggle('mobile-open');
  $('sidebarOv').classList.toggle('show');
}
function closeMobileSidebar() {
  $('sidebar')?.classList.remove('mobile-open');
  $('sidebarOv')?.classList.remove('show');
}

/* ============================================================
   11. TOPBAR WIRING
   ============================================================ */
function initTopbar() {
  $('themeBtn')?.addEventListener('click', toggleTheme);
  $('topAvatar')?.addEventListener('click', () => $('profileDropdown')?.classList.toggle('open'));

  // Profile dropdown items — role files can override these handlers
  $('pdMyProfile')?.addEventListener('click', () => {
    if (typeof openProfileModal === 'function') {
      const DB = getDB();
      const cu = window.currentUser || DB?.users?.[0];
      openProfileModal(cu?.id);
    }
    $('profileDropdown')?.classList.remove('open');
  });
  $('pdMyIdCard')?.addEventListener('click', () => {
    if (typeof openProfileModal === 'function') {
      const DB = getDB();
      const cu = window.currentUser || DB?.users?.[0];
      openProfileModal(cu?.id, 'pmIdCard');
    }
    $('profileDropdown')?.classList.remove('open');
  });
  $('pdSettings')?.addEventListener('click', () => {
    showPage('settings');
    $('profileDropdown')?.classList.remove('open');
  });
  $('pdLogout')?.addEventListener('click', doLogout);

  $('notifBtn')?.addEventListener('click', () => showPage('notifications'));
  $('msgTopBtn')?.addEventListener('click', () => showPage('messages'));
  $('globalSearch')?.addEventListener('input', doGlobalSearch);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); $('globalSearch')?.focus(); }
    if (e.key === 'Escape') { $$('.modal-ov.open').forEach(m => m.classList.remove('open')); }
  });

  // Dashboard quick action buttons (only present in admin layout)
  $('qaAddUser')?.addEventListener('click', () => { if (typeof openUserModal === 'function') openUserModal(); });
  $('qaCreatePost')?.addEventListener('click', () => { showPage('posts'); if (typeof openPostModal === 'function') openPostModal(); });
  $('qaNewTask')?.addEventListener('click', () => { showPage('tasks'); if (typeof openTaskModal === 'function') openTaskModal(); });
  $('qaAddSite')?.addEventListener('click', () => { showPage('sites'); if (typeof openSiteModal === 'function') openSiteModal(); });
  $('dashAuditMore')?.addEventListener('click', () => showPage('auditlog'));
}

function doLogout() {
  if (!confirm('Log out?')) return;
  if (typeof logAction === 'function') logAction('logout', 'system', 'User logged out');
  toast('Logged out successfully', 'info');
  setTimeout(() => window.location.reload(), 1000);
}

function doGlobalSearch() {
  const q = $('globalSearch')?.value.toLowerCase().trim();
  if (!q) return;
  const DB = getDB();
  if (!DB) return;
  const user = DB.users?.find(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  if (user) { showPage('users'); toast(`Showing results for "${q}"`, 'info'); return; }
  const site = DB.sites?.find(s => s.name.toLowerCase().includes(q));
  if (site) { showPage('sites'); toast(`Showing results for "${q}"`, 'info'); return; }
  const post = DB.posts?.find(p => p.title.toLowerCase().includes(q));
  if (post) { showPage('posts'); toast(`Showing results for "${q}"`, 'info'); }
}

/* ============================================================
   12. NOTIFICATION BADGE SYNC
   ============================================================ */
function syncNotifBadge() {
  const DB = getDB();
  if (!DB) return;
  const unread = DB.notifications?.filter(n => !n.read).length || 0;
  const nbNotifs = $('nbNotifs');
  const notifDot = $('notifDot');
  if (nbNotifs) { nbNotifs.textContent = unread; nbNotifs.style.display = unread > 0 ? '' : 'none'; }
  if (notifDot) notifDot.style.display = unread > 0 ? '' : 'none';
}

/* ============================================================
   13. TOPBAR AVATAR SYNC
   ============================================================ */
function updateTopbarAvatar() {
  const DB = getDB();
  const u = window.currentUser || DB?.users?.[0];
  if (!u) return;

  const topAv = $('topAvatar');
  const pdAv = $('pdAvatar');
  const sbAv = $('sbAvatar');

  function applyAvatar(el) {
    if (!el) return;
    if (u.avatarImg) {
      el.innerHTML = `<img src="${u.avatarImg}" alt="">`;
    } else {
      el.textContent = initials(u.name);
      el.style.background = u.avatarColor + '22';
      el.style.color = u.avatarColor;
    }
  }

  applyAvatar(topAv);
  applyAvatar(pdAv);
  applyAvatar(sbAv);

  const sbName = $('sbName');
  if (sbName) sbName.textContent = u.name;
  const pdName = $('pdName');
  if (pdName) pdName.textContent = u.name;
}

/* ============================================================
   14. IMPERSONATION BANNER
   ============================================================ */
function impersonateUser(userId) {
  const DB = getDB();
  const u = DB?.users?.find(x => x.id === userId);
  if (!u || u.role === 'admin') { toast('Cannot impersonate this user', 'warn'); return; }
  window.impersonating = u;
  const banner = $('impersonateBanner');
  if (banner) banner.style.display = 'flex';
  const nameEl = $('impersonateName');
  if (nameEl) nameEl.textContent = u.name;
  toast(`Viewing as ${u.name}`, 'warn');
  if (typeof logAction === 'function') logAction('impersonate', `User #${userId}`, `Viewed as ${u.name}`);
}

function exitImpersonate() {
  window.impersonating = null;
  const banner = $('impersonateBanner');
  if (banner) banner.style.display = 'none';
  toast('Exited impersonation', 'info');
}

/* ============================================================
   15. SIDEBAR ADMIN CARD
   ============================================================ */
function initSidebarCard() {
  $('sbAdminCard')?.addEventListener('click', () => {
    const DB = getDB();
    const cu = window.currentUser || DB?.users?.[0];
    if (typeof openProfileModal === 'function' && cu) openProfileModal(cu.id);
  });
}

/* ============================================================
   16. KEYBOARD SHORTCUTS
   ============================================================ */
function initShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.altKey) {
      const map = { d: 'dashboard', u: 'users', s: 'sites', p: 'posts', m: 'messages', a: 'analytics', t: 'tasks' };
      if (map[e.key]) { e.preventDefault(); showPage(map[e.key]); }
    }
  });
}

/* ============================================================
   17. FLOATING CHAT WIDGET
   ============================================================ */
function initFloatChat() {
  $('fcBtn')?.addEventListener('click', () => $('fcWidget')?.classList.toggle('open'));
  $('fcCloseBtn')?.addEventListener('click', () => $('fcWidget')?.classList.remove('open'));
  $('fcSendBtn')?.addEventListener('click', sendFCMsg);
  $('fcInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendFCMsg(); });
  addFCMsg('system', 'Hello! How can I help you today?');
}

function sendFCMsg() {
  const txt = $('fcInput')?.value.trim();
  if (!txt) return;
  addFCMsg('mine', txt);
  $('fcInput').value = '';
  setTimeout(() => addFCMsg('system', "Got it! I'll look into that for you."), 600);
}

function addFCMsg(who, text) {
  const box = $('fcMsgs');
  if (!box) return;
  const isSystem = who === 'system';
  const div = document.createElement('div');
  div.style.cssText = `display:flex;gap:0.4rem;align-items:flex-end;${isSystem ? '' : 'flex-direction:row-reverse;'}`;
  div.innerHTML = `<div style="max-width:80%;background:${isSystem ? 'var(--surface2)' : 'rgba(234,179,8,0.18)'};border-radius:12px;padding:0.5rem 0.75rem;font-size:0.8rem;line-height:1.4;">${text}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

/* ============================================================
   18. CSV / JSON EXPORT UTILITIES
   ============================================================ */
function exportCSV(rows, filename) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(','), ...rows.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = filename;
  a.click();
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
   19. EMAIL HELPER  (shared across all roles)
   ============================================================ */
function sendEmail(to, subject, template) {
  const DB = getDB();
  if (!DB) return;
  if (!DB.emailLog) DB.emailLog = [];
  if (!window._nextEmailId) window._nextEmailId = (DB.emailLog.length || 0) + 1;
  const entry = { id: window._nextEmailId++, to, subject, template, sentAt: nowStr(), status: 'sent' };
  DB.emailLog.unshift(entry);

  const s = DB.settings;
  if (s?.ejsService && s?.ejsPublicKey && window.emailjs) {
    const tplId = s[`ejsTpl${template.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('')}`] || template;
    window.emailjs.send(s.ejsService, tplId, { to_email: to, subject }, { publicKey: s.ejsPublicKey })
      .catch(() => { entry.status = 'failed'; });
  }
}

/* ============================================================
   20. STAT CARD HELPER  (used in multiple pages)
   ============================================================ */
function statCard(icon, color, num, label, trend, dir) {
  return `<div class="stat-card">
    <div class="sc-top">
      <div class="sc-icon ${color}"><i class="fas ${icon}"></i></div>
    </div>
    <div class="sc-num">${num}</div>
    <div class="sc-label">${label}</div>
    ${trend ? `<div class="sc-trend trend-${dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'flat'}"><i class="fas fa-arrow-${dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'right'}"></i>${trend}</div>` : ''}
  </div>`;
}

/* ============================================================
   21. DASHBOARD INIT  (called once on DOMContentLoaded)
   Initialises all shared/global systems.
   The role-specific file calls its own init() separately.
   ============================================================ */
function initDashboard() {
  initTheme();
  initNav();
  initTopbar();
  initFloatChat();
  initSidebarCard();
  initShortcuts();
  updateTopbarAvatar();
  syncNotifBadge();
}

/* Auto-run on DOMContentLoaded */
document.addEventListener('DOMContentLoaded', initDashboard);
