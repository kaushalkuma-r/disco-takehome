/* Views: login, app shell (sidebar/topbar/mobile nav), dashboard. */
(function () {
  const { api, ui, state, store } = window.DCS;
  const { I, $, $$, esc, svg } = ui;
  const { EXAMPLES } = window.DCS.data;
  const app = () => document.getElementById('app');
  const views = (window.DCS.views = window.DCS.views || {});

  /* ------------------------------------------------------------------ login */
  views.login = function () {
    let mode = 'in';
    const render = () => {
      app().innerHTML = `
      <div class="auth">
        <section class="brand" aria-label="About Campaign Studio">
          <div class="logo"><span class="mark">${I.spark}</span>Disco Campaign Studio</div>
          <div class="stack lg">
            <h1>Intelligent offers, from one sentence.</h1>
            <p>Describe your business. Get the publishers where your offer belongs, creative written for the shoppers who'll see it, and a campaign config ready to run — with every decision explained and every credit accounted for.</p>
          </div>
          <div class="demo">
            <div class="h">Reviewer walkthrough</div>
            <div class="line"><b>1</b><span>Sign in with the demo account (pre-filled). New accounts start with 100 credits.</span></div>
            <div class="line"><b>2</b><span>Start a campaign from an example — try the vague one to see the clarity gate.</span></div>
            <div class="line"><b>3</b><span>Use 👍/👎 on any card, check the Checks panel, then compare two runs in History.</span></div>
          </div>
        </section>
        <section class="form">
          <form class="box" id="authForm" novalidate>
            <div>
              <h2>${mode === 'in' ? 'Welcome back' : 'Create your account'}</h2>
              <p class="help" style="margin-top:6px">${mode === 'in' ? 'Sign in to your workspace.' : 'Free while in beta. 100 credits included, no card needed.'}</p>
            </div>
            <button type="button" class="btn lg block" id="google">${I.google} Continue with Google</button>
            <div class="orline">or with email</div>
            ${mode === 'up' ? `<div class="field"><label class="label" for="name">Full name</label><input class="input" id="name" placeholder="Ada Lovelace" autocomplete="name"></div>` : ''}
            <div class="field"><label class="label" for="email">Work email</label><input class="input" id="email" type="email" placeholder="you@company.com" autocomplete="email" value="${mode === 'in' ? 'demo@disconetwork.com' : ''}"><div class="err hidden" id="emailErr"></div></div>
            <div class="field"><div class="row between"><label class="label" for="pw">Password</label>${mode === 'in' ? '<a href="#" class="help" id="forgot">Forgot?</a>' : ''}</div><input class="input" id="pw" type="password" placeholder="••••••••" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" value="${mode === 'in' ? 'disco-demo' : ''}"><div class="err hidden" id="pwErr"></div></div>
            <button class="btn primary lg block" id="submit">${mode === 'in' ? 'Sign in' : 'Create account'} ${I.arrow}</button>
            <p class="help" style="text-align:center">${mode === 'in' ? `New here? <a href="#" id="swap">Create an account</a>` : `Already have an account? <a href="#" id="swap">Sign in</a>`}</p>
            <p class="help" style="text-align:center;font-size:11.5px">Prototype: auth is mocked in-browser. Production uses Supabase Auth (email + Google) with JWTs verified by the API.</p>
          </form>
        </section>
      </div>`;
      $('#swap').onclick = (e) => { e.preventDefault(); mode = mode === 'in' ? 'up' : 'in'; render(); };
      const forgot = $('#forgot'); if (forgot) forgot.onclick = (e) => { e.preventDefault(); ui.toast('Reset link sent to ' + ($('#email').value || 'your email')); };
      $('#google').onclick = () => signIn({ name: 'Demo Advertiser', email: 'demo@disconetwork.com', provider: 'google' });
      $('#authForm').onsubmit = (e) => {
        e.preventDefault();
        const email = $('#email').value.trim(); const pw = $('#pw').value; let ok = true;
        const setErr = (id, msg) => { const el = $('#' + id + 'Err'); const inp = $('#' + id); if (msg) { el.textContent = msg; el.classList.remove('hidden'); inp.classList.add('bad'); ok = false; } else { el.classList.add('hidden'); inp.classList.remove('bad'); } };
        setErr('email', /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? '' : 'Enter a valid email address.');
        setErr('pw', pw.length >= 6 ? '' : 'Password needs at least 6 characters.');
        if (!ok) return;
        const btn = $('#submit'); btn.disabled = true; btn.textContent = mode === 'in' ? 'Signing in…' : 'Creating account…';
        const name = mode === 'up' ? ($('#name').value.trim() || email.split('@')[0]) : (email === 'demo@disconetwork.com' ? 'Demo Advertiser' : email.split('@')[0]);
        setTimeout(() => signIn({ name, email, provider: 'email' }), 600);
      };
    };
    render();
  };
  function signIn(user) { api.signIn(user); location.hash = '#/dashboard'; ui.toast(`Signed in as ${user.email}`); }

  /* ------------------------------------------------------------------ shell */
  const NAV = [
    ['dashboard', 'Dashboard', 'home'], ['new', 'New campaign', 'plus'], ['chat', 'Chat', 'chat'], ['history', 'History', 'hist'],
  ];
  const NAV2 = [['memory', 'Memory', 'brain'], ['credits', 'Credits', 'coin']];

  views.shell = function (active, crumb, body) {
    const me = api.me(); const init = (me.user.name || '?').split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
    const bal = me.balance; const cls = ui.creditCls(bal);
    const link = ([k, l, ic]) => `<a href="#/${k}" class="${active === k ? 'on' : ''}">${I[ic]}${l}</a>`;
    app().innerHTML = `
    <div class="shell">
      <aside class="side">
        <a href="#/dashboard" class="logo"><span class="mark">${I.spark}</span>Campaign Studio</a>
        <nav class="nav" aria-label="Primary">${NAV.map(link).join('')}<div class="sec">Workspace</div>${NAV2.map(link).join('')}</nav>
        <div class="foot">
          <a href="#/credits" class="card credit-card" aria-label="Credits: ${bal} remaining">
            <div class="row between"><span class="eyebrow">Credits</span><span class="pill ${cls || 'purple'}">${bal < 10 ? 'Low' : bal < 20 ? 'Running low' : 'Beta plan'}</span></div>
            <div class="v num">${bal} <small>of 100</small></div>
            <div class="bar ${cls || ''}"><i style="width:${Math.max(2, bal)}%"></i></div>
            <span class="help">Generation ≈ 12 · regenerate ≈ 3 · edits free</span>
          </a>
          <button class="btn ghost sm" id="theme" style="justify-content:flex-start">${I.sun} Toggle theme</button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="crumb">${crumb}</div>
          <div class="row" style="position:relative">
            <a href="#/credits" class="credit-pill ${cls}" title="Credits remaining">${I.coin}<span class="num">${bal}</span></a>
            <a href="#/new" class="btn primary sm hide-sm">${I.plus} New campaign</a>
            <button class="avatar" id="avBtn" aria-label="Account menu" aria-haspopup="menu">${init}</button>
            <div class="menu hidden" id="menu" role="menu">
              <div class="who"><b>${esc(me.user.name)}</b>${esc(me.user.email)}</div>
              <button id="mTheme" role="menuitem">${I.sun} Toggle theme</button>
              <button id="mReset" role="menuitem">${I.refresh} Reset demo data</button>
              <button id="mOut" role="menuitem" style="color:var(--bad)">${I.out} Sign out</button>
            </div>
          </div>
        </header>
        <main class="page" id="body">${body}</main>
        <nav class="mobnav" aria-label="Primary (mobile)">${[...NAV, NAV2[1]].map(([k, l, ic]) => `<a href="#/${k}" class="${active === k ? 'on' : ''}">${I[ic]}${l.split(' ')[0]}</a>`).join('')}</nav>
      </div>
    </div>`;
    const toggleTheme = () => { const r = document.documentElement; const cur = r.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); r.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark'); store.set('theme', r.getAttribute('data-theme')); };
    $('#theme').onclick = toggleTheme; $('#mTheme').onclick = toggleTheme;
    $('#avBtn').onclick = (e) => { e.stopPropagation(); const m = $('#menu'); m.classList.toggle('hidden'); if (!m.classList.contains('hidden')) ui.bindClickOutside(m, () => m.classList.add('hidden')); };
    $('#mOut').onclick = () => { api.signOut(); location.hash = '#/login'; };
    $('#mReset').onclick = () => { api.resetDemo(); location.reload(); };
    return $('#body');
  };

  /* Re-render just the credit indicators after a charge (avoids a full shell re-render). */
  views.refreshCredits = function () {
    const bal = api.me().balance; const cls = ui.creditCls(bal);
    const pill = $('.credit-pill'); if (pill) { pill.className = 'credit-pill ' + cls; pill.querySelector('span').textContent = bal; }
    const card = $('.credit-card'); if (card) { card.querySelector('.v').innerHTML = `${bal} <small>of 100</small>`; card.querySelector('.bar > i').style.width = Math.max(2, bal) + '%'; card.querySelector('.bar').className = 'bar ' + (cls || ''); }
  };

  /* ------------------------------------------------------------------ dashboard */
  views.dashboard = function () {
    const list = api.list(); const me = api.me();
    const avgClar = Math.round(list.reduce((s, c) => s + c.clarity.score, 0) / Math.max(1, list.length));
    const first = (me.user.name || 'there').split(' ')[0];
    const spent = 100 - me.balance;
    const body = views.shell('dashboard', 'Dashboard', `
      <div>
        <h1>Good to see you, ${esc(first)}.</h1>
        <p class="sub">Describe a business and get a ranked media plan, persona-tuned creative, and a runnable config.</p>
      </div>
      <div class="hero-input">
        <label class="eyebrow" for="desc">Describe your business</label>
        <textarea class="textarea" id="desc" placeholder="e.g. Refillable, concentrated cleaning products. Skip the single-use plastic bottles. We want to show up where people who already care about sustainability are checking out."></textarea>
        <div class="row between wrap">
          <div class="examples">${EXAMPLES.map((e, i) => `<button type="button" class="chip" data-ex="${i}">${esc(e.length > 38 ? e.slice(0, 36) + '…' : e)}</button>`).join('')}</div>
          <button class="btn grad" id="go">${I.spark} Build campaign <span class="cost">· ~${api.credits.estimate('generate_campaign').total} credits</span></button>
        </div>
      </div>
      <div class="grid g4">
        <div class="card stat"><span class="eyebrow">Campaigns</span><span class="v num">${list.length}</span><span class="d">${list.filter((c) => c.status === 'ready').length} marked ready</span></div>
        <div class="card stat"><span class="eyebrow">Publishers matched</span><span class="v num">${new Set(list.flatMap((c) => c.publishers.map((p) => p.id))).size}<small> / 20</small></span><span class="d">across all campaigns</span></div>
        <div class="card stat"><span class="eyebrow">Creatives written</span><span class="v num">${list.reduce((s, c) => s + c.personas.length, 0)}</span><span class="d">persona-tuned variants</span></div>
        <div class="card stat"><span class="eyebrow">Credits used</span><span class="v num">${spent}<small> / 100</small></span><span class="d">${me.balance} left · avg clarity ${avgClar}</span></div>
      </div>
      <div class="grid g-main">
        <div class="card pad">
          <div class="row between" style="margin-bottom:8px"><h3>Recent campaigns</h3><a href="#/history" class="help">View all</a></div>
          <div>${list.length ? list.slice(0, 5).map((c) => `
            <div class="crow" data-open="${c.id}" role="link" tabindex="0">
              <div class="grow"><div class="t">${esc(c.name)}</div><div class="s">${esc(c.input)}</div></div>
              <span class="pill ${ui.scoreCls(c.clarity.score)} hide-sm">Clarity ${c.clarity.score}</span>
              <span class="help num">${ui.dateS(c.createdAt)}</span>
            </div>`).join('') : `<div class="empty">${I.layers}<b>No campaigns yet</b><span>Describe a business above to build your first one.</span></div>`}</div>
        </div>
        <div class="card pad stack">
          <h3>How the brain works</h3>
          ${[['1', 'Parse & score clarity', 'The model extracts product, buyer, price tier, model. Vague input triggers up to 3 targeted questions. Free.'], ['2', 'Rank publishers', 'Deterministic pre-score (category, persona overlap, AOV, audience) + bounded LLM adjustment with a written reason — including exclusions.'], ['3', 'Pick personas, write creative', '3–5 personas with fit scores; one headline + body each, tuned to their preferences and disinterests.'], ['4', 'Check, charge, save', '11 validators run; failures are repaired once. Credits are charged from real token usage and shown on the ledger.']].map(([n, t, d]) => `
            <div class="howto"><b>${n}</b><div><div style="font-weight:600">${t}</div><div class="help">${d}</div></div></div>`).join('')}
        </div>
      </div>`);
    $$('[data-ex]', body).forEach((b) => { b.onclick = () => { $('#desc').value = EXAMPLES[+b.dataset.ex]; $('#desc').focus(); }; });
    $$('[data-open]', body).forEach((r) => { const go = () => { location.hash = '#/campaign/' + r.dataset.open; }; r.onclick = go; r.onkeydown = (e) => { if (e.key === 'Enter') go(); }; });
    $('#go').onclick = () => { const v = $('#desc').value.trim(); if (!v) { $('#desc').focus(); ui.toast('Describe your business first', 'info'); return; } store.set('draft', v); location.hash = '#/new'; };
  };
})();
