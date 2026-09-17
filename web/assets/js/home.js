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
        $('.bar__fill', bar).style.width = `${Math.max(threat.score, 2)}%`;
        $('b', bar).textContent = threat.score;
        bar.title = threat.label;
      }
      const reasons = result.reasons.slice(0, 3);
      v.why.innerHTML = reasons.length
        ? reasons.map((r) => `<li>${esc(r.text)}</li>`).join('')
        : `<li>${result.discounted ? 'No record of this site in any threat feed, so scores were lowered' : 'Nothing in the checklist raised a concern'}</li>`;
      v.checks.textContent = `${result.checks.total} checks · ${result.checks.failed + result.checks.warned} flagged`;
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

      await Promise.all(rows.map(async (row, i) => {
        await wait(280 + (row.offsetTop / serp.offsetHeight) * 2300);
        if (id !== run) return;
        const result = set.results[i];
        const slot = $('.masks', row);
        const threats = flagged(result);
        threats.forEach((t, k) => {
          const m = document.createElement('span');
          m.className = `m m--${result.threats[t].badge}`;
          m.title = result.threats[t].label;
          m.innerHTML = Masks.svg(t);
          slot.appendChild(m);
          setTimeout(() => m.classList.add('is-on'), reduced ? 0 : k * 110);
        });
        if (threats.length && result.threats[threats[0]].badge === 'red') row.classList.add('is-danger');
      }));
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
      chip.addEventListener('click', () => play(chip.dataset.query));
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
            $('.masks', row).insertAdjacentHTML('beforeend', `<span class="m m--${color} is-on">${Masks.svg(threat)}</span>`);
          }));
          verdictFloat.classList.add('is-on');
          $$('.bar__fill', stage).forEach((b) => { b.style.width = `${b.dataset.w}%`; });
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

    const choose = async (b, focus) => {
      buttons.forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b));
        x.tabIndex = x === b ? 0 : -1;
      });
      if (focus) b.focus();
      const sev = b.dataset.sev;
      card.style.setProperty('--c', COLOR[sev]);
      card.classList.remove('is-switching');
      void card.offsetWidth;
      card.classList.add('is-switching');

      const d = await examples;
      const ex = d && d.masks[threat] && d.masks[threat][sev];
      if (!ex || b.getAttribute('aria-pressed') !== 'true') return;
      const t = ex.threats[threat];
      const reasons = ex.reasons.filter((r) => r.threat === threat).concat(ex.reasons.filter((r) => r.threat !== threat)).slice(0, 3);
      slot.hidden = false;
      slot.innerHTML = `
        <div class="example__context">${esc(ex.context)}</div>
        <div class="example__url">${esc(ex.url)}</div>
        <div class="example__meter"><div class="bar__track"><div class="bar__fill" style="width:0"></div></div><b>${t.score}/100</b></div>
        <ul class="example__why">${reasons.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul>
        <span class="example__tag">${t.kind ? `${Masks.kindIcon(t.kind)} ${esc(t.kindShort)} · ` : ''}${esc(t.label)} · ${ex.known ? 'known threat' : `${ex.checks.failed + ex.checks.warned} of ${ex.checks.total} checks flagged`}</span>`;
      // Restart the entrance animation for each switch.
      slot.style.animation = 'none';
      void slot.offsetWidth;
      slot.style.animation = '';
      requestAnimationFrame(() => { $('.bar__fill', slot).style.width = `${Math.max(t.score, 2)}%`; });
    };

    // Each card walks its own severities so all three can be read at a glance;
    // any interaction stops it, and the button below puts the reader in charge.
    const cycle = document.createElement('button');
    cycle.type = 'button';
    cycle.className = 'severity-cycle';
    const name = $('h3', card).textContent;
    let timer = null;

    const stop = () => {
      clearInterval(timer);
      timer = null;
      card.dataset.cycling = 'false';
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
        const at = buttons.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
        choose(buttons[(at + 1) % buttons.length]);
      }, 3200);
    };
    cycle.addEventListener('click', () => (timer ? stop() : start()));
    card.appendChild(cycle);
    stop();

    buttons.forEach((b, i) => {
      b.tabIndex = b.getAttribute('aria-pressed') === 'true' ? 0 : -1;
      b.addEventListener('click', () => { stop(); choose(b); });
      b.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        ev.preventDefault();
        stop();
        choose(buttons[(i + (ev.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length], true);
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
      stageEl.innerHTML = `
        <div class="game__end">
          <div class="kicker">You scored</div>
          <div class="big gold-text">${points}<span class="muted" style="font-size:32px"> / ${max}</span></div>
          <p>${right} of ${ROUNDS} exactly right. ${line}</p>
          <div class="hero__cta" style="justify-content:center">
            <button type="button" class="btn btn--lg" data-again>Play again</button>
            <a class="btn btn--gold btn--lg" href="/signup">Get Sentinel free</a>
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

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const url = input.value.trim();
      if (!url) return;
      if (window.SENTINEL_STATIC) {
        const site = window.SENTINEL_STATIC.origin;
        out.innerHTML = `<div class="try__empty"><p>This preview can&rsquo;t reach the scanner. Check this link on the live site. No account needed.</p>`
          + `<a class="btn btn--gold btn--sm" href="${site}/#try">Open ${esc(site.replace(/^https?:\/\//, ''))}</a></div>`;
        return;
      }
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span>';
      out.setAttribute('aria-busy', 'true');
      try {
        const res = await fetch('/api/v1/demo/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body.error && body.error.message) || 'Couldn’t check that link right now.');
        renderTry(body.verdict);
      } catch (err) {
        out.innerHTML = `<div class="try__empty"><p>${esc(err.message)}</p><a class="btn btn--gold btn--sm" href="/signup">Create free account</a></div>`;
      } finally {
        button.disabled = false;
        button.textContent = 'Check';
        out.removeAttribute('aria-busy');
      }
    });

    function renderTry(v) {
      const worst = flagged(v)[0];
      const badge = worst ? v.threats[worst].badge : null;
      out.innerHTML = `
        <div class="try__result" style="--c:${colorOf(badge)}">
          <div class="try__head">
            <div class="try__icon">${Masks.svg(worst || 'scam')}</div>
            <div style="min-width:0"><h3>${badge ? esc(v.overall.label) : 'No threats found'}</h3><p>${esc(v.host)}</p></div>
          </div>
          <div class="try__threats">
            ${ORDER.map((t) => `<div class="try__threat" style="--c:${colorOf(v.threats[t].badge)}">${Masks.svg(t)}<b>${esc(v.threats[t].label)}</b><span>${NAMES[t]} &middot; ${v.threats[t].score}/100</span></div>`).join('')}
          </div>
          <ul class="try__why">${v.reasons.length ? v.reasons.map((r) => `<li>${esc(r.text)}</li>`).join('') : `<li>${v.discounted ? 'No record in any threat feed and nothing in the checklist raised a concern' : 'Nothing in the checklist raised a concern'}</li>`}</ul>
          <div class="try__foot">
            <span>${v.known ? 'Known threat' : `${v.checks.total} checks &middot; ${v.checks.failed + v.checks.warned} flagged &middot; no research`}</span>
            <a href="/signup?next=${encodeURIComponent(`/app/scan?url=${encodeURIComponent(v.url)}`)}">Research it with a free account &rarr;</a>
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
})();
