    const q = new URLSearchParams(location.search);
    const badge = q.get('badge') || 'none';
    // Light or dark as the app's look draws it (card.js), so the colours below match the card.
    const light = SentinelLook.scheme(SentinelLook.fromQuery(location.search).mode) === 'light';
    if (badge in SentinelLook.STATUS.dark) SentinelCard.status(document.documentElement, badge);
    else document.documentElement.style.setProperty('--c', badge === 'part' ? (light ? '#7a5818' : '#c9a227') : (light ? '#6b6558' : '#8d8a82'));
    // A file found harmful is a warning: said as one to a screen reader.
    if (badge === 'red' || badge === 'orange') document.body.setAttribute('role', 'alertdialog');
    document.getElementById('label').textContent = q.get('label') || 'Not checked';
    const size = Number(q.get('size')) || 0;
    // An empty or tiny file is not "1 KB".
    const kb = size < 1024 ? `${size} byte${size === 1 ? '' : 's'}` : size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
    document.getElementById('name').textContent = `${q.get('name') || ''} · ${kb}`;
    const why = q.get('why');
    const lead = document.getElementById('lead');
    const where = document.getElementById('where');
    if (q.get('asked') === '1') where.textContent = 'The file stayed on this computer. Only its fingerprint was compared with the list of known threats.';
    else if (why) where.textContent = 'Nothing about the file left this computer.';
    // Signing in compares the file with the list. Signed in already, or with nothing to compare, it cannot help.
    if (q.get('account') === '1' || badge === 'none') { document.getElementById('deeper').hidden = true; document.getElementById('signin').hidden = true; }
    if (why) {
      lead.textContent = why;
    } else if (badge === 'green') {
      lead.textContent = 'Sentinel found nothing harmful in this file.';
    } else {
      lead.innerHTML = badge === 'red'
        ? '<b>Do not open this file.</b> Delete it, unless you are sure where it came from.'
        : '<b>Be careful with this file.</b> Only open it if you know who made it and why you have it.';
    }
    const ul = document.getElementById('found');
    for (const f of (q.get('found') || '').split('\n').filter(Boolean).slice(0, 4)) {
      const li = document.createElement('li');
      li.textContent = f;
      if (ul.children.length) li.dataset.trim = '';
      ul.appendChild(li);
    }
    document.getElementById('close').onclick = () => window.sentinelDesktop.menuResultAction('close');
    document.getElementById('signin').onclick = () => window.sentinelDesktop.menuResultAction('signin');
    document.getElementById('close').focus();
  