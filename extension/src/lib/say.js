/**
 * What the companion says, in one place: the block page, the popup and the settings page all ask here, so a change of
 * wording or of a rule reaches all three at once. A verdict becomes one picture, one title, one calm sentence, at most
 * one reason, and one action. Nothing here decides what is dangerous: that is the scanner's verdict.
 *
 *   SentinelSay.page(verdict, how)   how: { stopped: before it loaded, closed: after it loaded, paused, off }
 *   SentinelSay.protection(state)    the worker's 'state' answer: is this browser being looked after, in words
 */
(() => {
  'use strict';
  const TITLES = {
    scam: ['This site looks like a scam', 'This is a confirmed scam site'],
    virus: ['This download may contain a virus', 'This download contains a virus'],
    malware: ['This site may try to infect your device', 'This site spreads malware']
  };

  function worst(v) {
    const rank = { yellow: 1, orange: 2, red: 3 };
    const threats = v.threats || {};
    return ['malware', 'virus', 'scam']
      .filter((t) => threats[t] && threats[t].badge)
      .sort((a, b) => rank[threats[b].badge] - rank[threats[a].badge])[0] || null;
  }

  const reasonOf = (v) => { const r = (v.reasons || [])[0]; return r && r.text ? String(r.text) : ''; };
  const hostLabel = (v) => (v.realSite && v.realSite.host ? String(v.realSite.host) : '');

  function page(v, how = {}) {
    const badge = v && v.overall ? v.overall.badge : undefined;
    if (!v || !v.overall) {
      return { tone: 'none', mask: 'onyx', title: 'Not checked yet', line: how.off ? 'Live scanning is off, so Sentinel has not looked at this page.'
        : how.paused ? 'Live scanning is paused, so Sentinel has not looked at this page.' : 'Sentinel has not looked at this page.', reason: '', action: { kind: 'check', text: 'Check this page' } };
    }
    if (!badge) {
      return { tone: 'clear', mask: 'onyx', title: 'No warning signs', line: 'Live scanning found no warning signs on this page.', reason: '', action: { kind: 'check', text: 'Check again' } };
    }
    const threat = worst(v);
    const severe = badge === 'red' || badge === 'orange';
    const mask = `${threat || 'scam'}-${badge}`;
    const earlier = v.overall.level === 'earlier';
    const title = earlier ? 'Sentinel flagged this page earlier'
      : threat ? TITLES[threat][badge === 'red' ? 1 : 0] : String(v.overall.label || 'Sentinel flagged this page');
    const action = hostLabel(v) ? { kind: 'real', text: `Go to the real ${hostLabel(v)}` } : severe ? { kind: 'back', text: 'Take me back to safety' } : { kind: 'check', text: 'Check again' };
    let line = 'Sentinel flagged this page. Do not enter passwords, card numbers or wallet phrases here.';
    if (how.stopped) line = earlier ? 'Sentinel stopped it before it opened, and cannot check it again right now.' : 'Sentinel stopped it before it opened. Nothing from it reached this browser.';
    else if (how.closed) line = 'Sentinel closed it when the check finished. If you typed anything there, the recovery guide shows what to do first.';
    else if (!severe) line = 'Sentinel found warning signs on this page. Take care before you type or pay.';
    return { tone: badge === 'red' ? 'danger' : badge === 'orange' ? 'warn' : 'caution', mask, threat: threat || 'scam', title, line, reason: reasonOf(v), action };
  }

  /** "Mon": the day an allowance comes back. */
  const dayOf = (at) => new Date(at).toLocaleDateString(undefined, { weekday: 'long' });

  function protection(state) {
    if (!state || !state.ok || !state.account || !state.account.signedIn) return { tone: 'off', word: 'Off', title: 'Sentinel is not signed in', line: 'Sign in to check pages in this browser and stop dangerous ones.' };
    if (state.siteAccess === false) return { tone: 'off', word: 'Off', title: 'Sentinel cannot see your pages yet', line: 'Firefox asks first. Open the Sentinel button in the toolbar and allow it on all websites.' };
    const settings = state.settings || {};
    if (!settings.enabled) return { tone: 'off', word: 'Off', title: 'Live scanning is off', line: 'Sentinel is not checking pages in this browser.' };
    if (state.locked === 'hours') return { tone: 'paused', word: 'Paused', title: 'Live checks are paused', line: `This week's live time is used up. It comes back on ${dayOf(state.live.resetsAt)}. Sites on Sentinel's confirmed list are still stopped.` };
    if (state.account.plan && state.account.plan.modelLocked) return { tone: 'paused', word: 'Paused', title: 'Live checks are paused', line: 'The model Sentinel uses is one of the five newest, which come with Pro, Max and Ultimate. Choose another model in the Sentinel app to turn live checks back on.' };
    if (!settings.warnOnNavigate) return { tone: 'on', word: 'On', title: 'Sentinel is watching, but will not stop pages', line: 'Stop dangerous pages is off, so a flagged page stays open.' };
    return { tone: 'on', word: 'On', title: 'Sentinel is on in this browser', line: 'Pages are checked as they open. Sites on the confirmed list are stopped before they load.' };
  }

  const api = { page, protection };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.SentinelSay = Object.freeze(api);
})();
