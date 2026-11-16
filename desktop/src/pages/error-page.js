    const q = new URLSearchParams(location.search);
    // A cause written for people is shown as it is. Anything technical (an error code, a file path, a stack) stays in
    // the log, which "Open log" shows.
    const raw = q.get('message') || '';
    if (raw && !/\bE[A-Z]{3,}\b|Error:|\bat \S+ \(|[A-Za-z]:\\|\/[\w.-]+\//.test(raw)) document.getElementById('msg').textContent = raw;
    document.getElementById('log').textContent = 'Log file: ' + (q.get('log') || '');
    const d = window.sentinelDesktop || {};
    let left = Number(q.get('retryIn')) || 0;
    const auto = document.getElementById('auto');
    const tick = () => { auto.textContent = left > 0 ? `Trying again by itself in ${left} s.` : 'Trying again now.'; if (left-- > 0) setTimeout(tick, 1000); };
    if (left) tick();
    document.getElementById('retry').addEventListener('click', () => d.retryServer && d.retryServer());
    document.getElementById('logs').addEventListener('click', () => d.openLogs && d.openLogs());
    document.getElementById('quit').addEventListener('click', () => d.quit && d.quit());
  