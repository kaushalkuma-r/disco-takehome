/* Router + boot. Hash routes keep the prototype a single static page. */
(function () {
  const { api, ui, views, store, seed } = window.DCS;

  const ROUTES = {
    login: () => views.login(),
    dashboard: () => views.dashboard(),
    new: () => views.new(),
    campaign: (id, tab) => views.campaign(id, tab),
    chat: () => views.chat(),
    history: () => views.history(),
    compare: (a, b) => views.compare(a, b),
    memory: () => views.memory(),
    credits: () => views.credits(),
  };

  function route() {
    const hash = location.hash || '#/dashboard';
    const [path, ...rest] = hash.slice(2).split('?')[0].split('/');
    const signedIn = !!api.me().user;
    if (!signedIn && path !== 'login') { location.hash = '#/login'; return; }
    if (signedIn && path === 'login') { location.hash = '#/dashboard'; return; }
    window.scrollTo(0, 0);
    ui.$$('.popover').forEach((p) => p.remove());
    (ROUTES[path] || ROUTES.dashboard)(...rest);
  }

  const theme = store.get('theme', null);
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  seed();
  window.addEventListener('hashchange', route);
  route();
})();
