/**
 * "ClickFix": a fake "I am not a robot" or "fix this error" page puts a command on the clipboard and tells the person
 * to press Windows + R, paste and press Enter. This recognises such a command in copied text, on the device, so the
 * desktop app (clipwatch.js) and the companion (content/clipguard.js) can stop it before it is pasted.
 *
 * One file for both: the server keeps the original, the desktop app gets a copy in desktop/shared and the companion
 * one in extension/src/content (scripts/build-extension.js); tests/clickfix.test.js checks the copies are the same.
 *
 * classify(text) answers null for anything that is not a command, or { level, reason }:
 *   strong  only ever written to trick someone: a hidden or encoded PowerShell, mshta or rundll32 on a web address,
 *           a "verification" comment after the command. Stopped wherever it was copied.
 *   medium  downloads something and runs it. Real installers do this too (irm https://get.scoop.sh | iex), so it is
 *           only stopped when the page it came from is not clear; otherwise the person is told.
 */
(function (root) {
  'use strict';

  const MAX = 4000;   // a ClickFix command is one line; a whole page of copied text is not one

  // Something that starts a program, as the first word of the text (the Run box runs exactly that).
  const LAUNCHER = /^\s*["']?(?:[a-z]:\\[^"'\n]*\\)?(powershell|pwsh|cmd|mshta|rundll32|regsvr32|certutil|bitsadmin|conhost|wscript|cscript|curl|msiexec|explorer|start)(\.exe)?["']?(\s|$)/i;

  const STRONG = [
    [/\b(powershell|pwsh)(\.exe)?\b[^\n]{0,200}\s[-/](w|wi|win|window|windowstyle)\s+(h|hi|hid|hidden|1)\b/i, 'Starts PowerShell in a hidden window'],
    [/\b(powershell|pwsh)(\.exe)?\b[^\n]{0,200}\s[-/](e|ec|en|enc|encodedcommand)\s+[a-z0-9+/=]{16,}/i, 'Runs an encoded PowerShell command'],
    [/\bmshta(\.exe)?\s+["']?(https?:|\\\\)/i, 'Runs a program from a web address with mshta'],
    [/\brundll32(\.exe)?\s+["']?(https?:|\\\\)/i, 'Runs a program from a web address with rundll32'],
    [/\bregsvr32(\.exe)?\b[^\n]{0,80}\/i:\s*["']?https?:/i, 'Runs a program from a web address with regsvr32'],
    [/\bconhost(\.exe)?\s+[^\n]{0,40}--headless\b/i, 'Runs a command with its window hidden'],
    [/frombase64string[\s\S]{0,400}\b(iex|invoke-expression)\b|\b(iex|invoke-expression)\b[\s\S]{0,400}frombase64string/i, 'Decodes a hidden command and runs it'],
    // The trick that shows in the Run box: the real command scrolls out of sight and a reassuring comment is left.
    // Only the words of a fake check: "# human-readable" or "# then verify the checksum" in a developer's snippet is not.
    [/(#|\brem\b|::)[^\n]{0,120}(\b(robot|captcha|recaptcha|cloudflare|ray id|i am (a )?human|human verification)\b|\bverif(y|ication)\s+(id|code)\b|\bverify (that )?you are (a )?human\b)/i, 'Hides the command behind a "verification" comment'],
    [/\S {30,}\S/, 'Hides the start of the command behind a run of spaces']
  ];

  const MEDIUM = [
    [/\b(irm|iwr|invoke-restmethod|invoke-webrequest|curl|wget|downloadstring|net\.webclient)\b[\s\S]{0,300}\|\s*(iex|invoke-expression)\b|\b(iex|invoke-expression)\b[\s\S]{0,40}\(\s*(irm|iwr|invoke-restmethod|invoke-webrequest|new-object\s+net\.webclient)/i, 'Downloads a command from the internet and runs it'],
    [/\bcertutil(\.exe)?\b[^\n]{0,80}-urlcache\b/i, 'Downloads a file with certutil'],
    [/\bbitsadmin(\.exe)?\b[^\n]{0,80}\/transfer\b/i, 'Downloads a file with bitsadmin'],
    [/\bcurl(\.exe)?\b[^\n]{0,300}(&&|&|\|)\s*(start|cmd|powershell|\.\\|%temp%|\$env:temp)/i, 'Downloads a file and starts it'],
    [/\bmsiexec(\.exe)?\b[^\n]{0,40}\/i\s+["']?https?:/i, 'Installs a program straight from a web address']
  ];

  // The Run box runs the text from its first word, so a command starts with a program (or a PowerShell expression).
  // A sentence about such a command, copied from an article, does not.
  const isCommand = (t) => LAUNCHER.test(t) || /^\s*(iex|invoke-expression|irm|iwr|\$|&\s|\.\s)/i.test(t);

  // The Run box takes one line, and a fake check page copies one. A snippet of several lines, copied from
  // documentation, is judged by its first line only, and a "$ " shell prompt in front of it is not part of it.
  const firstLine = (text) => (String(text || '').split(/\r?\n/).find((l) => l.trim()) || '').replace(/^\s*\$\s+/, '');

  function classify(text) {
    const t = firstLine(text);
    if (!t.trim() || t.length > MAX || !isCommand(t)) return null;
    for (const [re, reason] of STRONG) if (re.test(t)) return { level: 'strong', reason };
    for (const [re, reason] of MEDIUM) if (re.test(t)) return { level: 'medium', reason };
    return null;
  }

  /**
   * What to do with it, given what the page in front was judged (badge: null when clear, 'yellow', 'orange', 'red',
   * or undefined when Sentinel does not know). 'stop' takes it off the clipboard (with a way to put it back),
   * 'tell' only warns, null does nothing.
   */
  function decide(found, badge) {
    if (!found) return null;
    if (found.level === 'strong') return 'stop';
    return badge ? 'stop' : 'tell';
  }

  const api = { classify, decide };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SentinelClickFix = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
