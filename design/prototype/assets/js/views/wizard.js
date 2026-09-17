/* View: New campaign wizard — Describe → Clarify → Generate → Review. */
(function () {
  const { api, ui, store, views } = window.DCS;
  const { I, $, $$, esc, svg } = ui;
  const { EXAMPLES } = window.DCS.data;

  const STEPS = ['Describe', 'Clarify', 'Generate', 'Review'];
  const stepsHtml = (s) => `<div class="steps" aria-label="Progress">${STEPS.map((l, i) => `<div class="step ${s === i + 1 ? 'on' : s > i + 1 ? 'done' : ''}"><b>${s > i + 1 ? I.check : i + 1}</b>${l}</div>${i < 3 ? '<span class="sep"></span>' : ''}`).join('')}</div>`;

  views.new = function () {
    let text = store.get('draft', '') || '';
    let clar = null; let answers = [];
    views.shell('new', 'New campaign', `<div id="wiz" class="stack lg"></div>`);
    const wiz = $('#wiz');
    const est = api.credits.estimate('generate_campaign');

    function describe() {
      wiz.innerHTML = `${stepsHtml(1)}
      <div class="stack lg" style="max-width:760px">
        <div><h1>What do you sell, and to whom?</h1><p class="sub">One or two sentences. Price point, business model and the buyer you have in mind all help.</p></div>
        <div class="hero-input">
          <label class="sr-only" for="desc">Business description</label>
          <textarea class="textarea" id="desc" placeholder="We sell…">${esc(text)}</textarea>
          <div class="row between wrap">
            <div class="examples">${EXAMPLES.map((e, i) => `<button type="button" class="chip" data-ex="${i}">${esc(e.length > 38 ? e.slice(0, 36) + '…' : e)}</button>`).join('')}</div>
            <button class="btn primary" id="next">Check clarity ${I.arrow}</button>
          </div>
        </div>
        <div class="banner">${I.info}<span>Clarity checks are free. Vague or off-topic input is fine — the next step asks for what it needs before any credits are spent.</span></div>
      </div>`;
      $$('[data-ex]', wiz).forEach((b) => { b.onclick = () => { $('#desc').value = EXAMPLES[+b.dataset.ex]; }; });
      $('#next').onclick = () => { text = $('#desc').value.trim(); if (!text) { $('#desc').focus(); return; } store.set('draft', text); clarify(); };
    }

    function clarify() {
      clar = api.clarity(text); const vague = clar.score < 60; const qs = clar.questions;
      answers = new Array(qs.length).fill(null);
      const r = 52; const circ = 2 * Math.PI * r; const col = ui.scoreCls(clar.score);
      const canAfford = est.balance >= est.base;
      wiz.innerHTML = `${stepsHtml(2)}
      <div class="stack lg" style="max-width:820px">
        <div><h1>${vague ? 'We need a little more to match well.' : "Got it. Here's what we understood."}</h1><p class="sub">Input clarity is scored before anything is generated, so a vague brief never produces a confident-looking wrong plan.</p></div>
        <div class="card pad" style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
          <div class="meter" role="img" aria-label="Clarity ${clar.score} of 100"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--line-2)" stroke-width="10"/><circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--${col})" stroke-width="10" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - clar.score / 100)}"/></svg><div class="c"><div><b class="num">${clar.score}</b><small>${clar.label}</small></div></div></div>
          <div class="grow stack" style="min-width:240px">
            <span class="eyebrow">Your input</span>
            <p style="font-size:15px">“${esc(text)}”</p>
            <div class="divider"></div>
            <div class="row wrap" style="gap:6px">${clar.signals.map((s) => `<span class="pill ${vague ? 'bad' : 'good'}">${vague ? I.x : I.check} ${esc(s)}</span>`).join('')}</div>
            ${vague ? '' : `<p class="help"><b style="color:var(--ink)">Interpretation:</b> ${esc(clar.summary)}</p>`}
          </div>
        </div>
        ${vague ? `<div class="stack" id="qs">${qs.map((q, i) => `<div class="q"><div class="qt">${i + 1}. ${esc(q.q)}</div><div class="opts">${q.opts.map((o, j) => `<button type="button" class="chip" data-q="${i}" data-o="${j}">${esc(o)}</button>`).join('')}<label class="sr-only" for="free${i}">Other answer</label><input class="input" id="free${i}" style="height:32px;max-width:220px" placeholder="Or type your own…" data-free="${i}"></div></div>`).join('')}</div>` : ''}
        ${canAfford ? '' : `<div class="banner bad">${I.warn}<span>You have ${est.balance} credits; generating needs at least ${est.base}. Edits, exports and compare still work.</span></div>`}
        <div class="row between wrap">
          <button class="btn ghost" id="back">${I.back} Edit description</button>
          <div class="row wrap"><span class="help" id="qhint">${vague ? 'Answer all 3 to continue' : ''}</span><button class="btn primary" id="gen" ${vague || !canAfford ? 'disabled' : ''}>${I.spark} Generate campaign <span class="cost">· ~${est.total} credits</span></button></div>
        </div>
      </div>`;
      $('#back').onclick = describe;
      const update = () => { const done = answers.every(Boolean); $('#gen').disabled = !done || !canAfford; $('#qhint').textContent = done ? `${est.balance} credits available` : `${answers.filter(Boolean).length} of ${qs.length} answered`; };
      $$('[data-q]', wiz).forEach((b) => { b.onclick = () => { const q = +b.dataset.q; $$(`[data-q="${q}"]`, wiz).forEach((x) => x.classList.remove('on')); b.classList.add('on'); answers[q] = b.textContent; $(`[data-free="${q}"]`, wiz).value = ''; update(); }; });
      $$('[data-free]', wiz).forEach((inp) => { inp.oninput = () => { const q = +inp.dataset.free; $$(`[data-q="${q}"]`, wiz).forEach((x) => x.classList.remove('on')); answers[q] = inp.value.trim() || null; update(); }; });
      $('#gen').onclick = () => generate(vague);
    }

    async function generate(vague) {
      const stages = [['Parsing brief', 'extract product, buyer, price tier, model'], ['Scoring 20 publishers', 'category · persona overlap · AOV · audience'], ['Selecting personas', '4 of 10, with fit scores'], ['Writing creative', 'headline + body per persona'], ['Assembling config', 'bid strategy, budget split, targeting'], ['Running 11 checks', 'validators + bounded repair']];
      wiz.innerHTML = `${stepsHtml(3)}
      <div class="stack lg" style="max-width:640px">
        <div><h1>Building your campaign</h1><p class="sub">${vague ? 'Using your answers: ' + esc(answers.join(' · ')) : 'This usually takes 8–15 seconds with the real model. Credits are reserved now and settled from actual usage.'}</p></div>
        <div class="progress" id="prog" aria-live="polite">${stages.map(([t, d], i) => `<div class="pstep" id="ps${i}"><span class="ic"></span><span><b>${t}</b> <span class="help">— ${d}</span></span><span class="d"></span></div>`).join('')}</div>
      </div>`;
      const t0 = Date.now();
      try {
        const res = await api.generate({ text, answers, onStage: (i, st) => { const p = $('#ps' + i); if (!p) return; p.className = 'pstep ' + st; if (st === 'done') { p.querySelector('.ic').innerHTML = I.check; p.querySelector('.d').textContent = ((Date.now() - t0) / 1000).toFixed(1) + 's'; } } });
        store.set('draft', '');
        ui.toast(`Campaign built · ${res.credits.charged} credits (${res.credits.base} base + ${res.credits.usage} usage)`);
        location.hash = '#/campaign/' + res.campaign.id;
      } catch (e) {
        ui.toast(e.code === 402 ? 'Not enough credits to generate.' : 'Generation failed — nothing was charged.', 'warn');
        clarify();
      }
    }

    text ? clarify() : describe();
  };
})();
