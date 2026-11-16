    const q = new URLSearchParams(location.search);
    const badge = q.get('badge') || 'orange';
    document.documentElement.style.setProperty('--c', SentinelCard.tone(['red', 'orange', 'yellow'].includes(badge) ? badge : 'orange'));
    document.getElementById('label').textContent = q.get('label') || 'Sentinel warning';
    document.getElementById('host').textContent = q.get('host') || '';
    document.getElementById('lead').innerHTML = badge === 'red'
      ? '<b>Leave this page.</b> Sentinel has evidence this site is dangerous. Do not enter passwords, codes or card details on it.'
      : '<b>Be careful on this page.</b> Sentinel found warning signs, but no proof. Do not enter any details on it.';
    // The strongest reason (the scanner lists them strongest first) in the heading line, the others below.
    const reasons = (q.get('reasons') || '').split('\n').filter(Boolean).slice(0, 4);
    document.getElementById('why').textContent = reasons.shift() || '';
    const ul = document.getElementById('reasons');
    for (const r of reasons) {
      const li = document.createElement('li');
      li.textContent = r;
      if (ul.children.length) li.dataset.trim = '';
      ul.appendChild(li);
    }
    // The real site (the brand's official address, or one of the person's own sites), never this page's address.
    // One primary button: with a real site to go to, that one, and "Got it" steps back.
    const real = q.get('real');
    if (real) {
      document.getElementById('real').textContent = `Go to the real ${real}`;
      document.getElementById('realRow').hidden = false;
      document.getElementById('close').classList.remove('primary');
      document.getElementById('real').onclick = () => window.sentinelDesktop.warnAction('real');
    }
    const b = q.get('browser');
    document.getElementById('browser').textContent = b ? `Seen in ${b}. Sentinel watched the address of the page in front; it did not read the page.` : '';
    document.getElementById('close').onclick = () => window.sentinelDesktop.warnAction('close');
    document.getElementById('details').onclick = () => window.sentinelDesktop.warnAction('open', q.get('url') || '');
    document.getElementById('recover').onclick = () => window.sentinelDesktop.warnAction('recover', 'password');
    // The keyboard starts on the one primary button once the person clicks into the card (the window never takes it).
    document.getElementById(real ? 'real' : 'close').focus();
  