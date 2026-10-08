/* Sentinel home page: live demo search, mask explorer, Spot the scam, try a link. */
(() => {
  'use strict';

  const Site = window.Site;
  const { $, $$, reduced } = Site;
  const Masks = window.SentinelMasks;

  const ORDER = ['scam', 'virus', 'malware'];
  const NAMES = { scam: 'Scam', virus: 'Virus', malware: 'Malware' };
  const COLOR = { yellow: 'var(--yellow)', orange: 'var(--orange)', red: 'var(--red)' };
  const colorOf = (badge) => COLOR[badge] || 'var(--green)';
  const RANK = { null: 0, yellow: 1, orange: 2, red: 3 };
  const rank = (badge) => RANK[badge || null];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

  /** Masks for every threat that earned a colour, worst first. */
  const flagged = (v) => ORDER.filter((t) => v.threats[t] && v.threats[t].badge)
    .sort((a, b) => rank(v.threats[b].badge) - rank(v.threats[a].badge));

  // On a static export the verdicts are baked in at build time; with a server
  // behind the page they come from the live engine.
  const examples = window.SENTINEL_DEMO
    ? Promise.resolve(window.SENTINEL_DEMO)
    : fetch('/api/v1/demo/examples')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch(() => null);

  /* ================================================================ demo search */

  const stage = $('[data-stage]');
  if (stage) {
    const serp = $('[data-serp]', stage);
    const scanline = $('[data-scanline]', stage);
    const queryText = $('[data-query-text]', stage);
    const verdictFloat = $('[data-float="verdict"]', stage);
    const mailFloat = $('[data-float="mail"]', stage);
    const chips = $$('[data-query]', stage);
    const replay = $('[data-replay]', stage);
    const v = {
      icon: $('[data-v-icon]', stage),
      title: $('[data-v-title]', stage),
      host: $('[data-v-host]', stage),
      why: $('[data-v-why]', stage),
      checks: $('[data-v-checks]', stage),
      source: $('[data-v-source]', stage)
    };

    let data = null;
    let current = 'paypal';
    let run = 0; // bumps on every new scan so stale timers stop quietly
    let rows = [];

    function showVerdict(result, row) {
      rows.forEach((r) => { r.classList.toggle('is-selected', r === row); r.setAttribute('aria-pressed', String(r === row)); });
      const worst = flagged(result)[0];
      const badge = worst ? result.threats[worst].badge : null;
      v.icon.innerHTML = Masks.svg(worst || 'scam');
      v.icon.classList.toggle('is-clear', !badge);
      v.icon.classList.toggle('is-yellow', badge === 'yellow');
      v.icon.classList.toggle('is-orange', badge === 'orange');
      v.title.textContent = badge ? result.overall.label : 'No threats found';
      v.host.textContent = result.host;
      const kind = worst && result.threats[worst].kind;
      const kindEl = stage.querySelector('[data-v-kind]');
      if (kindEl) {
        kindEl.hidden = !kind;
        kindEl.innerHTML = kind ? `${Masks.kindIcon(kind)}<span>${esc(result.threats[worst].kindLabel)}</span>` : '';
        kindEl.style.setProperty('--c', colorOf(badge));
      }
      for (const t of ORDER) {
        const bar = $(`[data-v-bar="${t}"]`, stage);
        const threat = result.threats[t];
        bar.style.setProperty('--c', colorOf(threat.badge));
        $('.bar__fill', bar).style.setProperty('--w', Math.max(threat.score, 2));
        $('b', bar).textContent = threat.score;
        bar.title = threat.label;
      }
      const reasons = result.reasons.slice(0, 3);
      v.why.innerHTML = reasons.length
        ? reasons.map((r) => `<li>${esc(r.text)}</li>`).join('')
        : `<li>${result.discounted ? 'No record of this site in any threat feed, so scores were lowered' : 'Nothing in the checklist raised a concern'}</li>`;
      v.checks.textContent = `${result.checks.total - (result.checks.skipped || 0)} checks · ${result.checks.failed + result.checks.warned} flagged`;
      v.source.textContent = result.known ? 'Known threat' : 'Checklist';
      verdictFloat.classList.add('is-on');
      verdictFloat.classList.remove('is-updating');
      void verdictFloat.offsetWidth;
      verdictFloat.classList.add('is-updating');
    }

    function renderResults(set) {
      serp.innerHTML = '<div class="serp__q">About 48,200,000 results</div>' + set.results.map((r, i) => `
        <div class="res is-entering" role="button" tabindex="0" aria-pressed="false" style="--d:${i * 0.06}s" data-i="${i}">
          <div class="res__title">${esc(r.title)} <span class="masks"></span></div>
          <div class="res__url">${esc(r.url)}</div>
          <p class="res__desc">${esc(r.desc)}</p>
        </div>`).join('');
      serp.appendChild(scanline);
      rows = $$('.res', serp);
      rows.forEach((row) => {
        const pick = () => showVerdict(set.results[Number(row.dataset.i)], row);
        row.addEventListener('click', pick);
        row.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); }
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            const next = rows[rows.indexOf(row) + (ev.key === 'ArrowDown' ? 1 : -1)];
            if (next) { next.focus(); next.click(); }
          }
        });
      });
    }

    async function typeQuery(text, id) {
      if (reduced) { queryText.textContent = text; return; }
      queryText.textContent = '';
      for (let i = 1; i <= text.length; i++) {
        if (id !== run) return;
        queryText.textContent = text.slice(0, i);
        await wait(22 + Math.random() * 30);
      }
    }

    async function play(key) {
      if (!data) return;
      const id = ++run;
      current = key;
      const set = data.serp[key];
      chips.forEach((c) => c.setAttribute('aria-selected', String(c.dataset.query === key)));
      verdictFloat.classList.remove('is-on');
      mailFloat.classList.remove('is-on');
      await typeQuery(set.query, id);
      if (id !== run) return;
      renderResults(set);
      serp.style.setProperty('--scan-end', `${serp.offsetHeight + 20}px`);
      scanline.classList.remove('is-running');
      void scanline.offsetWidth;
      if (!reduced) scanline.classList.add('is-running');

      // After the gold line, the results corrupt into binary for a moment (delicate scanning digging in, binary.js):
      // gold digits, and over each result's title the masks' colours, settling on its own verdict once it is in.
      const verdictColor = new Map();
      const dig = window.SentinelBinary ? window.SentinelBinary.dig(serp, {
        links: () => {
          const s = serp.getBoundingClientRect();
          return rows.map((row, i) => {
            const t = $('.res__title', row);
            if (!t) return null;
            const r = t.getBoundingClientRect();
            return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height, color: verdictColor.get(i) || null };
          }).filter(Boolean);
        }
      }) : null;

      await Promise.all(rows.map(async (row, i) => {
        await wait(280 + (row.offsetTop / serp.offsetHeight) * 2300);
        if (id !== run) return;
        const result = set.results[i];
        const slot = $('.masks', row);
        const threats = flagged(result);
        verdictColor.set(i, threats.length ? result.threats[threats[0]].badge : 'green');
        threats.forEach((t, k) => {
          const m = document.createElement('span');
          m.className = `m m--${result.threats[t].badge}`;
          m.title = result.threats[t].label;
          m.setAttribute('role', 'img');
          m.setAttribute('aria-label', `${Masks.NAMES[t]}: ${result.threats[t].label}`);
          m.innerHTML = Masks.svg(t);
          slot.appendChild(m);
          setTimeout(() => m.classList.add('is-on'), reduced ? 0 : k * 110);
        });
        if (threats.length && result.threats[threats[0]].badge === 'red') row.classList.add('is-danger');
      }));
      if (dig) { await wait(250); await dig.finish(); }
      if (id !== run) return;

      // Open the most dangerous result so the panel always has something to explain.
      let worst = 0;
      set.results.forEach((r, i) => {
        const score = (x) => Math.max(...ORDER.map((t) => rank(x.threats[t].badge) * 1000 + x.threats[t].score));
        if (score(r) > score(set.results[worst])) worst = i;
      });
      showVerdict(set.results[worst], rows[worst]);
      await wait(600);
      if (id === run) mailFloat.classList.add('is-on');
    }

    chips.forEach((chip, i) => {
      chip.addEventListener('click', () => {
        // The window turns over to the new search.
        const win = $('.window', stage);
        win.classList.remove('is-swapping');
        void win.offsetWidth;
        win.classList.add('is-swapping');
        play(chip.dataset.query);
      });
      chip.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        const next = chips[(i + (ev.key === 'ArrowRight' ? 1 : chips.length - 1)) % chips.length];
        next.focus();
        next.click();
      });
    });
    replay.addEventListener('click', () => play(current));

    let started = false;
    new IntersectionObserver((entries, obs) => {
      if (!entries[0].isIntersecting) return;
      obs.disconnect();
      stage.classList.add('is-in');
      examples.then((d) => {
        if (!d) {
          // Offline or rate limited: keep the static markup and just reveal it.
          $$('.res', serp).forEach((row) => (row.dataset.masks || '').split(',').filter(Boolean).forEach((pair) => {
            const [threat, color] = pair.split(':');
            $('.masks', row).insertAdjacentHTML('beforeend', `<span class="m m--${color} is-on" role="img" aria-label="${Masks.NAMES[threat]}: ${{ yellow: 'possible', orange: 'likely', red: 'confirmed' }[color]}">${Masks.svg(threat)}</span>`);
          }));
          verdictFloat.classList.add('is-on');
          $$('.bar__fill', stage).forEach((b) => { b.style.setProperty('--w', Number(b.dataset.w) || 0); });
          $('.stage__controls', stage).hidden = true;
          $('.stage__hint', stage).hidden = true;
          return;
        }
        data = d;
        if (!started) { started = true; play(current); }
      });
    }, { threshold: 0.25 }).observe(stage);
  }

  /* ============================================================== mask explorer */

  for (const card of $$('[data-trio]')) {
    const threat = card.dataset.threat;
    const buttons = $$('[data-sev]', card);
    const slot = $('[data-example]', card);

    const exampleHTML = (ex) => {
      const t = ex.threats[threat];
      const reasons = ex.reasons.filter((r) => r.threat === threat).concat(ex.reasons.filter((r) => r.threat !== threat)).slice(0, 3);
      return `
        <div class="example__context">${esc(ex.context)}</div>
        <div class="example__url">${esc(ex.url)}</div>
        <div class="example__meter"><div class="bar__track"><div class="bar__fill"></div></div><b>${t.score}/100</b></div>
        <ul class="example__why">${reasons.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul>
        <span class="example__tag">${t.kind ? `${Masks.kindIcon(t.kind)} ${esc(t.kindShort)} · ` : ''}${esc(t.label)} · ${ex.known ? 'known threat' : `${ex.checks.failed + ex.checks.warned} of ${ex.checks.total} checks flagged`}</span>`;
    };
    // The example box keeps the height of its tallest severity, so switching never moves the buttons or the page:
    // all three are measured once (and again when the width changes).
    let reservedAt = -1;
    const reserve = (d) => {
      const width = slot.clientWidth;
      if (!d || !d.masks[threat] || width === reservedAt) return;
      reservedAt = width;
      slot.style.minHeight = '';
      const keep = slot.innerHTML;
      let tallest = 0;
      for (const ex of Object.values(d.masks[threat])) {
        slot.innerHTML = exampleHTML(ex);
        tallest = Math.max(tallest, slot.offsetHeight);
      }
      slot.innerHTML = keep;
      slot.style.minHeight = `${tallest}px`;
    };
    addEventListener('resize', () => { reservedAt = -1; examples.then((d) => { if (!slot.hidden) reserve(d); }); }, { passive: true });

    // how: 'user' (a click or a key) or 'auto' (the card walking its own stages).
    let shown = (buttons.find((x) => x.getAttribute('aria-pressed') === 'true') || buttons[0]).dataset.sev;
    const choose = async (b, focus, how) => {
      buttons.forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b));
        x.tabIndex = x === b ? 0 : -1;
      });
      if (focus) b.focus();
      const sev = b.dataset.sev;
      card.style.setProperty('--c', COLOR[sev]);
      // The mask itself takes the colour: each card carries a render in every severity colour, and in 3D the model
      // changes. A choice the reader makes, and the stages wrapping round from confirmed back to suspicious, open a
      // black hole that takes the old mask and gives back the new one (cosmos.js); the steps up glow and shift.
      $$('[data-tint]', card).forEach((img) => img.classList.toggle('is-on', img.dataset.tint === sev));
      const before = shown;
      shown = sev;
      if (window.SentinelBlackHole && sev !== before) {
        if (how === 'user' || (before === 'red' && sev === 'yellow')) window.SentinelBlackHole.play(card, sev);
        else window.SentinelBlackHole.pulse(card, sev);
      }

      const d = await examples;
      const ex = d && d.masks[threat] && d.masks[threat][sev];
      if (!ex || b.getAttribute('aria-pressed') !== 'true') return;
      const t = ex.threats[threat];
      slot.hidden = false;
      reserve(d);
      slot.innerHTML = exampleHTML(ex);
      // Restart the entrance animation for each switch.
      slot.style.animation = 'none';
      void slot.offsetWidth;
      slot.style.animation = '';
      requestAnimationFrame(() => { $('.bar__fill', slot).style.setProperty('--w', Math.max(t.score, 2)); });
    };

    // Each card walks its own severities so all three can be read at a glance;
    // any interaction stops it, and the button below puts the reader in charge.
    const cycle = document.createElement('button');
    cycle.type = 'button';
    cycle.className = 'severity-cycle';
    const name = $('h3', card).textContent;
    let timer = null;

    // A stop the reader asked for is 'paused', so scrolling back into view does not restart it.
    const stop = (byUser = false) => {
      clearInterval(timer);
      timer = null;
      card.dataset.cycling = byUser ? 'paused' : 'false';
      cycle.textContent = 'Play stages';
      cycle.setAttribute('aria-label', `Play ${name} severity stages`);
    };
    const start = () => {
      if (reduced) return;
      clearInterval(timer);
      card.dataset.cycling = 'true';
      cycle.textContent = 'Pause stages';
      cycle.setAttribute('aria-label', `Pause ${name} severity stages`);
      timer = setInterval(() => {
        // Never in the middle of a black hole.
        if (card.classList.contains('is-singular')) return;
        const at = buttons.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
        choose(buttons[(at + 1) % buttons.length], false, 'auto');
      }, 4400);
    };
    cycle.addEventListener('click', () => (timer ? stop(true) : start()));
    // Beside the severity buttons, in the plate's panel when the card has one.
    ($('.plate__info', card) || card).appendChild(cycle);
    stop();
    // The example for the severity already showing, from the start: the box never appears mid-scroll.
    choose(buttons.find((x) => x.getAttribute('aria-pressed') === 'true') || buttons[0]);

    buttons.forEach((b, i) => {
      b.tabIndex = b.getAttribute('aria-pressed') === 'true' ? 0 : -1;
      b.addEventListener('click', () => { stop(true); choose(b, false, 'user'); });
      b.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        ev.preventDefault();
        stop(true);
        choose(buttons[(i + (ev.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length], true, 'user');
      });
    });

    // Only cycle while the card is actually on screen.
    new Site.Observer((entries) => {
      const visible = entries[0].isIntersecting;
      if (visible && !timer && card.dataset.cycling !== 'paused') start();
      else if (!visible && timer) { clearInterval(timer); timer = null; }
    }, { threshold: 0.4 }).observe(card);
  }

  /* ============================================================== spot the scam */

  const game = $('[data-game]');
  if (game) {
    const stageEl = $('[data-game-stage]', game);
    const dots = $('[data-game-dots]', game);
    const scoreEl = $('[data-game-score]', game);
    const ROUNDS = 6;
    const ANSWERS = [
      { badge: null, name: 'Safe', hint: 'Nothing wrong' },
      { badge: 'yellow', name: 'Suspicious', hint: 'Look closer' },
      { badge: 'orange', name: 'Likely', hint: 'Probably dangerous' },
      { badge: 'red', name: 'Confirmed', hint: 'Proven threat' }
    ];
    let pool = [];
    let round = 0;
    let points = 0;
    let marks = [];
    let answered = false;

    const truthOf = (v) => {
      const worst = flagged(v)[0];
      return { badge: worst ? v.threats[worst].badge : null, threat: worst || null };
    };

    function paintDots() {
      dots.innerHTML = Array.from({ length: ROUNDS }, (_, i) => `<i class="${marks[i] ? `is-${marks[i]}` : i === round ? 'is-current' : ''}"></i>`).join('');
      scoreEl.textContent = `Score ${points}`;
    }

    function start(d) {
      // A fair mix: always some safe links, some dangerous ones, shuffled.
      const shuffled = d.game.slice().sort(() => Math.random() - 0.5);
      const safe = shuffled.filter((v) => !truthOf(v).badge);
      const bad = shuffled.filter((v) => truthOf(v).badge);
      pool = safe.slice(0, 2).concat(bad.slice(0, ROUNDS - 2)).sort(() => Math.random() - 0.5).slice(0, ROUNDS);
      round = 0;
      points = 0;
      marks = [];
      showRound();
    }

    function showRound() {
      answered = false;
      paintDots();
      const v = pool[round];
      stageEl.innerHTML = `
        <div class="game__round">
          <div class="game__context">${esc(v.context)}</div>
          <div class="game__link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg><span>${esc(v.url)}</span></div>
          <div class="game__q">How dangerous is this link? <span class="muted">(keys 1&ndash;4)</span></div>
          <div class="game__answers" role="group" aria-label="Your answer">
            ${ANSWERS.map((a, i) => `<button type="button" class="answer" style="--c:${colorOf(a.badge)}" data-answer="${i}">
              <kbd>${i + 1}</kbd>${Masks.svg('scam')}<span>${a.name}</span><small>${a.hint}</small></button>`).join('')}
          </div>
          <div data-game-reveal></div>
        </div>`;
      $$('[data-answer]', stageEl).forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.answer))));
    }

    function answer(i) {
      if (answered) return;
      answered = true;
      const v = pool[round];
      const truth = truthOf(v);
      const diff = Math.abs(rank(ANSWERS[i].badge) - rank(truth.badge));
      // Calling a dangerous link safe (or a safe link dangerous) is never "close".
      const crossed = (ANSWERS[i].badge === null) !== (truth.badge === null);
      const result = diff === 0 ? 'right' : diff === 1 && !crossed ? 'close' : 'wrong';
      points += { right: 100, close: 50, wrong: 0 }[result];
      marks[round] = result;

      $$('[data-answer]', stageEl).forEach((b, k) => {
        b.disabled = true;
        if (k === i) b.classList.add('is-picked');
        if (rank(ANSWERS[k].badge) === rank(truth.badge)) b.classList.add('is-truth');
      });

      const tk = truth.badge ? v.threats[truth.threat] : null;
      const heading = tk
        ? `${tk.kind ? `<span class="kind-icon" style="--c:${colorOf(truth.badge)}">${Masks.kindIcon(tk.kind)}</span> ${esc(tk.kindLabel)}: ` : ''}${esc(tk.label)} <span class="muted" style="font-size:14px">&middot; ${tk.score}/100</span>`
        : 'Sentinel found nothing wrong';
      const reasons = v.reasons.slice(0, 3);
      const last = round === ROUNDS - 1;
      $('[data-game-reveal]', stageEl).innerHTML = `
        <div class="game__reveal">
          <div class="game__verdict">
            <span class="game__result is-${result}">${{ right: 'Spot on', close: 'Close', wrong: 'Not quite' }[result]}</span>
            <h4>${heading}</h4>
          </div>
          <ul class="game__why">${reasons.length ? reasons.map((r) => `<li>${esc(r.text)}</li>`).join('') : `<li>${v.known ? 'A well-known, trusted site' : 'No red flags across the checklist'}</li>`}</ul>
          <div class="game__next">
            <span>${v.known ? 'Found in threat intelligence' : `${v.checks.total} checks run`}</span>
            <button type="button" class="btn btn--gold btn--sm" data-next>${last ? 'See your score' : 'Next link'} &rarr;</button>
          </div>
        </div>`;
      paintDots();
      const next = $('[data-next]', stageEl);
      next.addEventListener('click', () => { round++; round < ROUNDS ? showRound() : finish(); });
      next.focus({ preventScroll: true });
    }

    function finish() {
      paintDots();
      const right = marks.filter((m) => m === 'right').length;
      const max = ROUNDS * 100;
      const line = points >= max * 0.8
        ? 'Sharp eyes. Sentinel just does this for every link, automatically.'
        : points >= max * 0.5
          ? 'Not bad, but a couple slipped through. Scammers only need one.'
          : 'These are hard to spot by eye. That&rsquo;s exactly why Sentinel exists.';
      // The static export has no /signup; before launch the download page is the honest next step.
      const st = window.SENTINEL_STATIC;
      const getHref = !st ? '/signup' : st.launched ? `${st.origin}/signup` : 'download.html';
      stageEl.innerHTML = `
        <div class="game__end">
          <div class="kicker">You scored</div>
          <div class="big gold-text">${points}<span class="muted" style="font-size:32px"> / ${max}</span></div>
          <p>${right} of ${ROUNDS} exactly right. ${line}</p>
          <div class="hero__cta" style="justify-content:center">
            <button type="button" class="btn btn--lg" data-again>Play again</button>
            <a class="btn btn--gold btn--lg" href="${getHref}">Get Sentinel free</a>
          </div>
        </div>`;
      $('[data-again]', stageEl).addEventListener('click', () => examples.then((d) => {
        if (!d) return;
        start(d);
        $('[data-answer]', stageEl).focus({ preventScroll: true });
      }));
    }

    // Number keys answer while the game is on screen.
    let gameVisible = false;
    new IntersectionObserver((e) => { gameVisible = e[0].isIntersecting; }, { threshold: 0.15 }).observe(game);
    document.addEventListener('keydown', (ev) => {
      if (!gameVisible || answered || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      const n = Number(ev.key);
      if (n >= 1 && n <= 4 && $('[data-answer]', stageEl)) { ev.preventDefault(); answer(n - 1); }
    });

    examples.then((d) => {
      if (d && d.game.length >= ROUNDS) return start(d);
      stageEl.innerHTML = '<div class="game__loading">The game couldn&rsquo;t load right now. Try refreshing in a moment.</div>';
    });
  }

  /* ================================================================ try a link */

  const form = $('[data-try-form]');
  if (form) {
    const out = $('[data-try-out]');
    const input = form.elements.url;
    const button = $('button', form);
    // A copy of the site with no server behind it (scripts/build-static.js) checks the link here, in the browser,
    // with the engine's own checklist (server/lib/scan/offline.js, bundled as assets/js/engine.js). Nothing is sent.
    const here = Boolean(window.SENTINEL_STATIC);
    // Fast, or delicate: the site researched too, while the result area digs in binary (binary.js).
    let tryMode = 'fast';
    const note = $('[data-try-note]');
    const NOTES = here
      ? { fast: 'Sentinel’s address checks, run here in your browser. The link is not sent anywhere.',
        delicate: 'Research into the site runs in the Sentinel app. Here, the link gets the fast check, in your browser.' }
      : { fast: 'Threat lists, the full checklist and known scams, in about a second.',
        delicate: 'Also researches the site: its age, certificate, redirects and page content. Three a day without an account.' };
    if (here) {
      if (note) note.textContent = NOTES.fast;
      // Delicate would run the same fast check here, so the choice is not offered.
      const seg = $('.try__seg');
      if (seg) seg.hidden = true;
      const lede = $('[data-try-lede]');
      if (lede) lede.textContent = 'Paste it here. Sentinel’s address checks run right in your browser, so the link is never sent anywhere. The Sentinel app adds the public threat lists, research into the site and live scanning.';
    }
    $$('[data-try-mode]').forEach((b) => b.addEventListener('click', () => {
      tryMode = b.dataset.tryMode;
      $$('[data-try-mode]').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      if (note) note.textContent = NOTES[tryMode] || NOTES.fast;
    }));

    // Loaded on the first check only: the checklist and its word list are too big to make every visitor wait for.
    let engineLoad = null;
    const localEngine = () => engineLoad || (engineLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'assets/js/engine.js';
      s.onload = () => (window.SentinelEngine ? resolve(window.SentinelEngine) : s.onerror());
      s.onerror = () => { engineLoad = null; s.remove(); reject(new Error('Could not load the checker. Try again in a moment.')); };
      document.head.appendChild(s);
    }));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const url = input.value.trim();
      if (!url) return;
      button.disabled = true;
      button.innerHTML = '<span class="spinner" role="img" aria-label="Checking"></span>';
      out.setAttribute('aria-busy', 'true');
      const dig = !here && tryMode === 'delicate' && window.SentinelBinary ? window.SentinelBinary.dig(out) : null;
      try {
        if (here) {
          const v = await (await localEngine()).scan(url);
          if (!v.ok) throw new Error(v.message);
          renderTry(v);
          return;
        }
        const res = await fetch('/api/v1/demo/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, mode: tryMode })
        });
        const body = await res.json().catch(() => ({}));
        // As in ui.js api(): a server fault never shows its own text, only a plain sentence.
        if (!res.ok) throw new Error((res.status < 500 && body.error && body.error.message) || 'Could not check that link right now.');
        if (dig) await dig.finish();
        renderTry(body.verdict);
      } catch (err) {
        if (dig) dig.stop();
        // A failed connection surfaces as a TypeError whose text is the browser's, not ours.
        out.innerHTML = `<div class="try__empty"><p>${esc(err.name === 'Error' ? err.message : 'Could not check that link right now.')}</p>${here ? '' : '<a class="btn btn--gold btn--sm" href="/signup">Create free account</a>'}</div>`;
      } finally {
        button.disabled = false;
        button.textContent = 'Check';
        out.removeAttribute('aria-busy');
      }
    });

    function renderTry(v) {
      const worst = flagged(v)[0];
      const badge = worst ? v.threats[worst].badge : null;
      // Checked here, nothing was looked up in a threat list: a clean result is not "No threats found", and not green.
      const unlisted = v.local && !badge;
      const title = badge ? esc(v.overall.label) : unlisted ? 'No warning signs in the address' : 'No threats found';
      // What was left out is not counted as checked.
      const ran = v.checks.total - (v.checks.skipped || 0);
      out.innerHTML = `
        <div class="try__result" style="--c:${unlisted ? 'var(--muted)' : colorOf(badge)}">
          <div class="try__head">
            <div class="try__icon">${Masks.svg(worst || 'scam')}</div>
            <div style="min-width:0"><h3>${title}</h3><p>${esc(v.host)}</p></div>
          </div>
          ${unlisted ? '<p class="try__caveat">Threat lists were not checked here. The Sentinel app checks them.</p>' : ''}
          ${v.partial ? '<p class="try__caveat">Some checks did not run: the word list could not load. Check again in a moment for the full result.</p>' : ''}
          <div class="try__threats">
            ${ORDER.map((t) => `<div class="try__threat" style="--c:${unlisted ? 'var(--muted)' : colorOf(v.threats[t].badge)}">${Masks.svg(t)}<b>${esc(v.threats[t].label)}</b><span>${NAMES[t]} &middot; ${v.threats[t].score}/100</span></div>`).join('')}
          </div>
          <ul class="try__why">${v.reasons.length ? v.reasons.map((r) => `<li>${esc(r.text)}</li>`).join('') : `<li>${v.discounted ? 'No record in any threat feed and nothing in the checklist raised a concern' : 'Nothing in the checklist raised a concern'}</li>`}</ul>
          <div class="try__foot">
            <span>${v.known ? 'Known threat' : `${ran} checks &middot; ${v.checks.failed + v.checks.warned} flagged &middot; ${v.local ? 'checked in your browser' : v.delicate ? 'site researched' : 'no research'}`}</span>
            ${v.local
    ? '<a href="download.html">Threat lists and research come with the app &rarr;</a>'
    : `<a href="/signup?next=${encodeURIComponent(`/app/scan?url=${encodeURIComponent(v.url)}`)}">Research it with Sentinel Pro &rarr;</a>`}
          </div>
        </div>`;
    }

    $$('[data-try-example]').forEach((chip) => chip.addEventListener('click', () => {
      input.value = chip.dataset.tryExample;
      form.requestSubmit();
    }));
  }

  /* ========================================================= clickable demo rows */

  $$('.demo-row[data-why]').forEach((row) => {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-expanded', 'false');
    const toggle = () => {
      const open = row.getAttribute('aria-expanded') !== 'true';
      row.setAttribute('aria-expanded', String(open));
      const existing = $('.demo-row__why', row);
      if (!open) { existing && existing.remove(); return; }
      row.insertAdjacentHTML('beforeend', `<div class="demo-row__why">${esc(row.dataset.why)}</div>`);
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
  });

  /* =========================================================== manifesto */

  // One line per colour, chosen by how far through the pinned section the reader has scrolled.
  const manifesto = $('[data-manifesto]');
  if (manifesto) {
    const lines = $$('.manifesto__line', manifesto);
    let queued = false;
    const pick = () => {
      queued = false;
      const r = manifesto.getBoundingClientRect();
      const p = Math.min(0.999, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
      const at = Math.floor(p * lines.length);
      lines.forEach((line, i) => line.classList.toggle('is-on', i === at));
      // The 3D mask (cosmos.js, mask3d.js) turns the colour of the line being read, smoothly, as it watches you.
      if (manifesto.dataset.on !== String(at)) {
        const m3 = window.SentinelMask3D && window.SentinelMask3D.get($('.manifesto__mask', manifesto));
        if (m3) m3.blend(['yellow', 'orange', 'red'][at], 700);
      }
      manifesto.dataset.on = String(at);
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(pick); } }, { passive: true });
    pick();
  }

  /* ============================================== the hero: unmask and dots */

  // Two canvases in the hero's stage. Underneath the mask, a field of gold dots that ripples away from the pointer.
  // Over it, what Sentinel sees: binary, scam marks and warnings, shown only where the pointer brushes a soft, smoky
  // mask that lingers a second and fades. Both draw only while something moves, never offscreen, never while the
  // page scrolls. A finger gets one slow wipe instead of a brush and no dots; reduced motion gets a still split view.
  const heroStage = $('.hero__stage');
  if (heroStage && window.HTMLCanvasElement) {
    const stage = heroStage;
    const hero = stage.closest('.hero');
    const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const now = () => performance.now();
    let seen = false;
    let scrollingUntil = 0;
    let rect = null;
    const measure = () => { rect = stage.getBoundingClientRect(); };
    const canvas = (cls) => {
      const c = document.createElement('canvas');
      c.className = cls;
      c.setAttribute('aria-hidden', 'true');
      return c;
    };
    const loops = [];
    const kick = () => loops.forEach((l) => l.wake());
    new Site.Observer((entries) => { seen = entries[0].isIntersecting; if (seen) kick(); }).observe(stage);
    addEventListener('scroll', () => { scrollingUntil = now() + 180; loops.forEach((l) => l.still && l.still()); }, { passive: true });

    /* -------- the dot field */

    if (fine) {
      const dots = canvas('hero__dots');
      stage.prepend(dots);
      const ctx = dots.getContext('2d');
      const GAP = 24;
      let w = 0;
      let h = 0;
      let dpr = 1;
      let px = -1e4;
      let py = -1e4;
      let tx = px;
      let ty = py;
      let energy = 0;
      let movedAt = 0;
      let raf = 0;
      const gold = getComputedStyle(document.documentElement).getPropertyValue('--gold-rgb').trim().split(/\s+/).join(',') || '210,172,99';
      const draw = (t) => {
        ctx.clearRect(0, 0, w, h);
        const R = 170;
        const s = 1.6 * dpr;
        const base = new Path2D();
        const lit = new Path2D();
        for (let y = GAP / 2; y < h / dpr; y += GAP) {
          for (let x = GAP / 2; x < w / dpr; x += GAP) {
            let dx = x - px;
            let dy = y - py;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            let ox = 0;
            let oy = 0;
            if (energy > 0.01 && d < 420) {
              // Pushed out of the pointer's way, and a ring of ripples travelling outward from it.
              const push = d < R ? (1 - d / R) * (1 - d / R) * 22 : 0;
              const wave = Math.sin(d * 0.06 - t * 0.009) * 5 * Math.exp(-d / 160);
              const k = energy * (push + wave) / d;
              ox = dx * k;
              oy = dy * k;
            }
            (energy > 0.01 && d < R ? lit : base).rect((x + ox) * dpr - s / 2, (y + oy) * dpr - s / 2, s, s);
          }
        }
        ctx.fillStyle = `rgba(${gold},.16)`;
        ctx.fill(base);
        ctx.fillStyle = `rgba(${gold},${(0.16 + 0.5 * energy).toFixed(3)})`;
        ctx.fill(lit);
      };
      const frame = (t) => {
        raf = 0;
        if (!seen || document.hidden) return;
        if (t < scrollingUntil) { energy = 0; draw(t); return; }
        px += (tx - px) * 0.2;
        py += (ty - py) * 0.2;
        // Full while the pointer moves, gone about a second after it stops.
        energy += ((t - movedAt < 120 ? 1 : 0) - energy) * (t - movedAt < 120 ? 0.12 : 0.05);
        draw(t);
        if (energy > 0.01) raf = requestAnimationFrame(frame);
        else { energy = 0; draw(t); }
      };
      const size = () => {
        dpr = Math.min(devicePixelRatio || 1, 2);
        w = dots.width = Math.round(stage.clientWidth * dpr);
        h = dots.height = Math.round(stage.clientHeight * dpr);
        energy = 0;
        draw(0);
      };
      const loop = {
        wake() { if (!raf && seen && energy > 0.01) raf = requestAnimationFrame(frame); },
        point(x, y) {
          if (reduced) return;
          if (px < -1e3) { px = x; py = y; }
          tx = x; ty = y; movedAt = now();
          if (energy < 0.02) energy = 0.02;
          loop.wake();
        }
      };
      loops.push(loop);
      if ('ResizeObserver' in window) new ResizeObserver(size).observe(stage); else size();
    }

    /* -------- what Sentinel sees */

    const view = canvas('hero__unmask');
    stage.appendChild(view);
    const vctx = view.getContext('2d');
    const under = document.createElement('canvas');
    const trail = document.createElement('canvas');
    const tctx = trail.getContext('2d');
    // The trail again, in gold: added over the reveal so its soft edge glows gold instead of greying the hero.
    const haze = document.createElement('canvas');
    const hctx = haze.getContext('2d');
    const TRAIL = 0.5;          // the brush is soft: its mask is kept at half size and drawn scaled up
    let vw = 0;
    let vh = 0;
    let vdpr = 1;
    let ready = false;

    // One puff of smoke, drawn once: a cluster of soft blobs, so each dab has a cloudy, uneven edge.
    const puff = document.createElement('canvas');
    puff.width = puff.height = 128;
    {
      const p = puff.getContext('2d');
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 14; i++) {
        const r = 18 + rnd() * 30;
        const a = rnd() * Math.PI * 2;
        const d = rnd() * 30;
        const x = 64 + Math.cos(a) * d;
        const y = 64 + Math.sin(a) * d;
        const g = p.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(0,0,0,.62)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        p.fillStyle = g;
        p.fillRect(0, 0, 128, 128);
      }
      // A solid core, so the middle of the stroke shows what is underneath in full and only the edge is smoke.
      const core = p.createRadialGradient(64, 64, 0, 64, 64, 50);
      core.addColorStop(0, 'rgba(0,0,0,1)');
      core.addColorStop(0.55, 'rgba(0,0,0,.85)');
      core.addColorStop(1, 'rgba(0,0,0,0)');
      p.fillStyle = core;
      p.fillRect(0, 0, 128, 128);
    }

    // The page underneath: binary in the lacquer, the three masks, and the warnings Sentinel would raise here.
    const C = (Masks && Masks.COLORS) || { yellow: '#f5c542', orange: '#f08a24', red: '#e5484d' };
    const marks = [['scam', C.red], ['virus', C.orange], ['malware', C.yellow]].map(([t, c]) => {
      const img = new Image();
      if (Masks) img.src = `data:image/svg+xml,${encodeURIComponent(Masks.svg(t, `xmlns="http://www.w3.org/2000/svg" width="128" height="128" style="color:${c}"`))}`;
      return { img, c };
    });
    const WARN = [
      ['Confirmed scam', C.red], ['Fake login page', C.red], ['Look-alike domain', C.orange],
      ['Program disguised as a document', C.orange], ['Probably dangerous', C.orange], ['Look closer', C.yellow],
      ['Fake browser update', C.yellow], ['Brand impersonation', C.red]
    ];
    const HOSTS = ['paypa1-secure-login.com', 'Invoice_March.pdf.exe', 'paypal.com.secure-verify-login.xyz', 'coinbase-airdrop-claim.tk'];
    const css = getComputedStyle(document.documentElement);
    const MONO = css.getPropertyValue('--mono').trim() || 'monospace';
    const SERIF = css.getPropertyValue('--display').trim() || 'serif';
    function paintUnder() {
      under.width = vw;
      under.height = vh;
      const u = under.getContext('2d');
      const W = vw / vdpr;
      const H = vh / vdpr;
      u.setTransform(vdpr, 0, 0, vdpr, 0, 0);
      const bg = u.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.7);
      bg.addColorStop(0, '#2c210f');
      bg.addColorStop(0.55, '#140f08');
      bg.addColorStop(1, '#090705');
      u.fillStyle = bg;
      u.fillRect(0, 0, W, H);
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      // Binary, row by row.
      u.font = `12px ${MONO}`;
      u.textBaseline = 'top';
      const cols = Math.ceil(W / 14);
      for (let y = 6, row = 0; y < H; y += 17, row++) {
        let line = '';
        for (let i = 0; i < cols; i++) line += (rnd() < 0.5 ? '0' : '1') + ' ';
        u.fillStyle = `rgba(226,194,127,${row % 3 ? 0.34 : 0.62})`;
        u.fillText(line, (row % 2) * 7, y);
      }
      // Marks and warnings, scattered on a loose grid so they never pile up.
      const gc = W > 900 ? 4 : 2;
      const gr = H > 700 ? 3 : 2;
      let n = 0;
      for (let r = 0; r < gr; r++) {
        for (let c = 0; c < gc; c++, n++) {
          let cx = (c + 0.2 + rnd() * 0.5) * (W / gc);
          const cy = (r + 0.25 + rnd() * 0.5) * (H / gr);
          if (n % 3 === 0) {
            const m = marks[(n / 3) % 3];
            const s = 78 + rnd() * 44;
            u.save();
            u.shadowColor = m.c;
            u.shadowBlur = 36;
            if (m.img.complete && m.img.naturalWidth) u.drawImage(m.img, cx - s / 2, cy - s / 2, s, s);
            u.restore();
          } else {
            const [label, col] = WARN[n % WARN.length];
            u.font = `500 13px ${MONO}`;
            const tw = u.measureText(label.toUpperCase()).width;
            // Kept whole inside the stage, however narrow.
            cx = Math.max(24, Math.min(cx, W - tw - 34));
            u.save();
            u.strokeStyle = col;
            u.fillStyle = 'rgba(11,9,6,.85)';
            u.shadowColor = col;
            u.shadowBlur = 16;
            u.beginPath();
            if (u.roundRect) u.roundRect(cx - 14, cy - 16, tw + 40, 32, 16); else u.rect(cx - 14, cy - 16, tw + 40, 32);
            u.fill();
            u.stroke();
            u.restore();
            u.fillStyle = col;
            u.beginPath();
            u.arc(cx + 2, cy, 4, 0, Math.PI * 2);
            u.fill();
            u.textBaseline = 'middle';
            u.fillText(label.toUpperCase(), cx + 14, cy + 1);
            const host = HOSTS[n % HOSTS.length];
            u.font = `italic 17px ${SERIF}`;
            u.fillStyle = 'rgba(239,230,212,.55)';
            const hw = u.measureText(host).width;
            const hx = Math.max(8, Math.min(cx - 10, W - hw - 10));
            u.fillText(host, hx, cy + 34);
            u.fillStyle = col;
            u.fillRect(hx - 2, cy + 34, hw + 4, 1.5);
            u.textBaseline = 'top';
          }
        }
      }
    }

    // Reduced motion: a still split, the right of the stage seen through, behind a gold seam.
    function paintSplit() {
      vctx.clearRect(0, 0, vw, vh);
      vctx.drawImage(under, 0, 0);
      vctx.globalCompositeOperation = 'destination-in';
      const g = vctx.createLinearGradient(vw * 0.5, 0, vw * 0.62, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.92)');
      vctx.fillStyle = g;
      vctx.fillRect(0, 0, vw, vh);
      vctx.globalCompositeOperation = 'source-over';
      vctx.fillStyle = 'rgba(226,194,127,.7)';
      vctx.fillRect(Math.round(vw * 0.56), 0, Math.max(1, vdpr), vh);
    }

    let last = null;      // the brush's previous point, in stage pixels
    let next = null;      // where the pointer is now
    let lastDab = 0;
    let quiet = 0;        // ms of drawn frames since the last dab (a stalled machine must not skip the linger)
    let vraf = 0;
    let prevT = 0;
    const dab = (x, y) => {
      const s = (200 + Math.random() * 90) * TRAIL;
      tctx.save();
      tctx.translate(x * TRAIL, y * TRAIL);
      tctx.rotate(Math.random() * Math.PI * 2);
      tctx.drawImage(puff, -s / 2, -s / 2, s, s);
      tctx.restore();
    };
    const clearAll = () => {
      tctx.clearRect(0, 0, trail.width, trail.height);
      vctx.clearRect(0, 0, vw, vh);
      last = next = null;
    };
    const vframe = (t) => {
      vraf = 0;
      if (!ready || document.hidden) return;
      if (!seen || t < scrollingUntil) { clearAll(); return; }
      const dt = Math.min(64, prevT ? t - prevT : 16);
      prevT = t;
      // It lingers while the pointer moves and a moment after (a slow half-life), then fades quickly, and is wiped
      // clean once it has gone quiet.
      quiet += dt;
      const half = quiet < 600 ? 1200 : 300;
      tctx.globalCompositeOperation = 'destination-out';
      tctx.fillStyle = `rgba(0,0,0,${(1 - Math.pow(0.5, dt / half)).toFixed(4)})`;
      tctx.fillRect(0, 0, trail.width, trail.height);
      tctx.globalCompositeOperation = 'source-over';
      if (next) {
        const from = last || next;
        const dist = Math.hypot(next.x - from.x, next.y - from.y);
        const steps = Math.max(1, Math.ceil(dist / 22));
        for (let i = 1; i <= steps; i++) dab(from.x + (next.x - from.x) * i / steps, from.y + (next.y - from.y) * i / steps);
        last = next;
        next = null;
        lastDab = t;
        quiet = 0;
      }
      if (quiet > 2000) { clearAll(); prevT = 0; return; }
      vctx.clearRect(0, 0, vw, vh);
      vctx.globalCompositeOperation = 'source-over';
      vctx.drawImage(under, 0, 0);
      vctx.globalCompositeOperation = 'destination-in';
      vctx.drawImage(trail, 0, 0, vw, vh);
      hctx.globalCompositeOperation = 'copy';
      hctx.drawImage(trail, 0, 0);
      hctx.globalCompositeOperation = 'source-in';
      hctx.fillStyle = 'rgba(226,194,127,.26)';
      hctx.fillRect(0, 0, haze.width, haze.height);
      vctx.globalCompositeOperation = 'lighter';
      vctx.drawImage(haze, 0, 0, vw, vh);
      vctx.globalCompositeOperation = 'source-over';
      vraf = requestAnimationFrame(vframe);
    };
    const brush = {
      wake() { if (!vraf && ready && seen && lastDab && now() - lastDab < 2000) vraf = requestAnimationFrame(vframe); },
      still() { if (last || next) { clearAll(); lastDab = 0; } },
      point(x, y) {
        next = { x, y };
        lastDab = now();
        quiet = 0;
        if (!last) prevT = 0;
        if (!vraf && ready && seen) vraf = requestAnimationFrame(vframe);
      }
    };
    loops.push(brush);

    const vsize = () => {
      vdpr = Math.min(devicePixelRatio || 1, 1.5);
      vw = view.width = Math.round(stage.clientWidth * vdpr);
      vh = view.height = Math.round(stage.clientHeight * vdpr);
      trail.width = Math.round(stage.clientWidth * TRAIL);
      trail.height = Math.round(stage.clientHeight * TRAIL);
      haze.width = trail.width;
      haze.height = trail.height;
      if (!vw || !vh) return;
      paintUnder();
      ready = true;
      if (reduced) paintSplit(); else clearAll();
    };
    // Fonts and the three marks first, so the page underneath is drawn once, complete.
    Promise.all([document.fonts ? document.fonts.ready : null, ...marks.map((m) => (m.img.decode ? m.img.decode().catch(() => {}) : null))]).then(() => {
      if ('ResizeObserver' in window) new ResizeObserver(vsize).observe(stage); else vsize();
    });

    // The pointer, read once a frame, in the stage's own pixels.
    if (fine && !reduced) {
      let queued = null;
      hero.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        const first = !queued;
        queued = e;
        if (!first) return;
        requestAnimationFrame(() => {
          const ev = queued;
          queued = null;
          if (now() < scrollingUntil) return;
          measure();
          const x = ev.clientX - rect.left;
          const y = ev.clientY - rect.top;
          loops.forEach((l) => l.point && l.point(x, y));
        });
      }, { passive: true });
    } else if (!fine && !reduced) {
      // A finger: one slow wipe across the stage, the first time it is seen once the page has opened.
      const wipe = () => {
        let t0 = 0;
        const run = (t) => {
          if (!ready) { requestAnimationFrame(run); return; }
          if (!t0) t0 = t;
          const p = Math.min(1, (t - t0) / 2600);
          const W = stage.clientWidth;
          const H = stage.clientHeight;
          const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          brush.point(W * (-0.05 + 1.1 * e), H * (0.5 + 0.28 * Math.sin(e * Math.PI * 2.2)));
          if (p < 1) requestAnimationFrame(run);
        };
        requestAnimationFrame(run);
      };
      const once = new Site.Observer((entries) => {
        if (!entries[0].isIntersecting) return;
        once.disconnect();
        setTimeout(wipe, 900);
      });
      const arm = () => once.observe(stage);
      if (document.documentElement.classList.contains('intro')) document.addEventListener('sentinel:intro-done', arm, { once: true });
      else arm();
    }
  }
})();
