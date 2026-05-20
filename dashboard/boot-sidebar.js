/**
 * Bootstrap carte (index.html) — sidebar hamburger, fin de <body>.
 */
import { initDashboardSidebar } from './nav-shell.js';

initDashboardSidebar();
document.documentElement.classList.add('shell-ready');
