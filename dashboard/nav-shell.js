/**
 * Navigation mobile (hamburger) + tiroir — pages dashboard secondaires.
 * index.html conserve sa sidebar dédiée carte + agents.
 */

export const APP_NAV = [
  { id: 'carte',    href: 'index.html',    label: 'Carte en direct', icon: '🗺️' },
  { id: 'flotte',   href: 'fleet.html',    label: 'Ma Flotte',       icon: '🚗' },
  { id: 'rapport',  href: 'rapport.html',  label: 'Rapports PDF',    icon: '📄' },
  { id: 'licence',  href: 'licence.html',  label: 'Abonnements',     icon: '🔑' },
];

/**
 * Tiroir latéral (fleet, rapport, licence).
 * @param {string} activeId — carte | flotte | rapport | licence
 */
export function initAppNavShell(activeId) {
  const overlay = document.getElementById('navOverlay');
  const drawer  = document.getElementById('navDrawer');
  const toggle  = document.getElementById('navToggle');
  const close   = document.getElementById('navClose');

  if (!drawer) return;

  drawer.querySelectorAll('[data-nav-id]').forEach((link) => {
    const on = link.dataset.navId === activeId;
    link.classList.toggle('nav-drawer__link--active', on);
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  const open  = () => {
    drawer.classList.add('is-open');
    overlay?.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('nav-open');
    toggle?.setAttribute('aria-expanded', 'true');
  };
  const shut = () => {
    drawer.classList.remove('is-open');
    overlay?.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('nav-open');
    toggle?.setAttribute('aria-expanded', 'false');
  };

  toggle?.addEventListener('click', open);
  close?.addEventListener('click', shut);
  overlay?.addEventListener('click', shut);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') shut();
  });

  drawer.querySelectorAll('.nav-drawer__link').forEach((a) => {
    a.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 767px)').matches) shut();
    });
  });

  // Gestion de la bascule de thème dans les pages secondaires
  const btnToggleTheme = document.getElementById('btnToggleTheme');
  if (btnToggleTheme) {
    btnToggleTheme.addEventListener('click', () => {
      const currentTheme = localStorage.getItem('gps-tracker-theme') || 'dark';
      let nextTheme = 'dark';
      if (currentTheme === 'dark') nextTheme = 'light';
      else if (currentTheme === 'light') nextTheme = 'amoled';
      else nextTheme = 'dark';

      localStorage.setItem('gps-tracker-theme', nextTheme);
      document.documentElement.className = 'theme-' + nextTheme;
    });
  }
}

/**
 * Sidebar carte (index.html uniquement).
 */
export function initDashboardSidebar() {
  const sidebar  = document.querySelector('.sidebar-new');
  const overlay  = document.getElementById('sidebarOverlay');
  const btnOpen  = document.getElementById('sidebarToggle');
  const btnClose = document.getElementById('sidebarClose');
  if (!sidebar) return;

  const open  = () => {
    sidebar.classList.add('is-open');
    overlay?.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  };
  const shut = () => {
    sidebar.classList.remove('is-open');
    overlay?.classList.remove('is-open');
    document.body.style.overflow = '';
  };

  btnOpen?.addEventListener('click', open);
  btnClose?.addEventListener('click', shut);
  overlay?.addEventListener('click', shut);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') shut();
  });
}

/**
 * Menu hamburger vitrine publique (index.html racine).
 */
/**
 * En-tête + tiroir hamburger pour fleet / rapport / licence.
 */
export function mountAppShell(activeId, pageTitle) {
  const root = document.getElementById('appShellRoot');
  if (!root) return;

  const labelMap = {
    carte: 'Carte',
    flotte: 'Flotte',
    rapport: 'Rapports',
    licence: 'Licences'
  };

  const linksHtml = APP_NAV.map((n) => `
    <a href="${n.href}" data-nav-id="${n.id}" class="nav-drawer__link">
      <span class="nav-drawer__icon" aria-hidden="true">${n.icon}</span>
      <span>${n.label}</span>
    </a>`).join('');

  const desktopNav = APP_NAV.map((n) => `
    <a href="${n.href}" class="app-topbar__nav-link${n.id === activeId ? ' app-topbar__nav-link--active' : ''}">${n.icon} ${n.label}</a>`).join('');

  const mobileNavItems = APP_NAV.map((n) => `
    <a href="${n.href}" class="mobile-nav-item${n.id === activeId ? ' mobile-nav-item--active' : ''}" data-mobile-nav="${n.id}">
      <span class="mobile-nav-icon">${n.icon}</span>
      <span>${labelMap[n.id] || n.label}</span>
    </a>`).join('');

  root.innerHTML = `
    <div id="navOverlay" class="nav-overlay" aria-hidden="true"></div>
    <header class="app-topbar">
      <div class="app-topbar__inner container mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div class="app-topbar__left flex items-center gap-2 min-w-0">
          <button type="button" id="navToggle" class="nav-hamburger" aria-label="Ouvrir le menu" aria-expanded="false">
            <span class="nav-hamburger__bar"></span>
            <span class="nav-hamburger__bar"></span>
            <span class="nav-hamburger__bar"></span>
          </button>
          <div class="min-w-0">
            <p class="app-topbar__brand">GPS Tracker</p>
            <p class="app-topbar__page">${pageTitle}</p>
          </div>
        </div>
        
        <div class="flex items-center gap-2">
          <button type="button" id="btnToggleTheme" class="theme-switcher-btn" style="width: 2.25rem; height: 2.25rem; border-radius: 0.5rem;" title="Changer de thème">🌓</button>
          <nav class="app-topbar__desktop hidden md:flex items-center gap-2 flex-wrap justify-end">
            <span id="companyName" class="app-topbar__company text-slate-400 text-sm truncate max-w-[140px]"></span>
            ${desktopNav}
            <button type="button" id="btnSignOut" class="app-topbar__logout">Déconnexion</button>
          </nav>
        </div>
      </div>
    </header>
    <aside id="navDrawer" class="nav-drawer" aria-hidden="true">
      <div class="nav-drawer__head">
        <span class="nav-drawer__brand">GPS Tracker</span>
        <button type="button" id="navClose" class="nav-drawer__close" aria-label="Fermer le menu">✕</button>
      </div>
      <p class="nav-drawer__subtitle">${pageTitle}</p>
      <nav class="nav-drawer__links">${linksHtml}</nav>
      <div class="nav-drawer__foot">
        <button type="button" id="btnSignOutMobile" class="nav-drawer__logout">Déconnexion</button>
      </div>
    </aside>
    <nav class="mobile-nav-bar md:hidden" aria-label="Navigation mobile principale">
      ${mobileNavItems}
    </nav>`;
}

export function initVitrineNav() {
  const overlay = document.getElementById('vitrineNavOverlay');
  const drawer  = document.getElementById('vitrineNavDrawer');
  const toggle  = document.getElementById('vitrineNavToggle');
  const close   = document.getElementById('vitrineNavClose');
  if (!drawer) return;

  const open  = () => {
    drawer.classList.add('is-open');
    overlay?.classList.add('is-open');
    document.body.classList.add('nav-open');
  };
  const shut = () => {
    drawer.classList.remove('is-open');
    overlay?.classList.remove('is-open');
    document.body.classList.remove('nav-open');
  };

  toggle?.addEventListener('click', open);
  close?.addEventListener('click', shut);
  overlay?.addEventListener('click', shut);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') shut();
  });
}
