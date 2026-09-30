'use strict';
/**
 * Turns a fetched HTML document into plain facts the checklist can test.
 * Deliberately regex-based: it never executes page scripts and never builds a DOM,
 * so hostile markup cannot do anything but be read.
 */
const { analyze } = require('./url');

const MAX_SCAN = 600 * 1024;

function attrs(tag) {
  const out = {};
  const rx = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  const body = tag.replace(/^<\s*[a-zA-Z0-9-]+/, '').replace(/\/?>$/, '');
  while ((m = rx.exec(body))) out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  return out;
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) % 65536))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16) % 65536));
}

function hostOf(href, base) {
  try { return new URL(href, base).hostname.toLowerCase(); } catch { return null; }
}

/**
 * Every tag in the page, in one pass. The pattern cannot backtrack (a tag is a "<", anything but "<" and ">", then
 * ">"), so a page built to be slow to read costs the same as any other. The earlier per-tag patterns with lazy or
 * overlapping parts took seconds to minutes on crafted markup, and the whole server waited for them.
 */
function tagsOf(source) {
  const out = [];
  const rx = /<([a-zA-Z][a-zA-Z0-9-]*)[^<>]*>/g;
  let m;
  while ((m = rx.exec(source)) && out.length < 20000) out.push({ name: m[1].toLowerCase(), at: m.index, end: m.index + m[0].length, raw: m[0] });
  return out;
}

/** Where the element opened by `tag` ends: its closing tag, or the end of the page. */
function closeOf(lower, tag) {
  const i = lower.indexOf(`</${tag.name}`, tag.end);
  return i < 0 ? lower.length : i;
}

/**
 * @param {string} html
 * @param {string} pageUrl final URL after redirects
 */
function parse(html, pageUrl) {
  const source = String(html).slice(0, MAX_SCAN);
  const lower = source.toLowerCase();
  const page = analyze(pageUrl);
  const pageReg = page ? page.registrable : '';
  const tags = tagsOf(source);
  const named = (...names) => tags.filter((t) => names.includes(t.name));

  const titleTag = named('title')[0];
  const title = titleTag ? decodeEntities(source.slice(titleTag.end, closeOf(lower, titleTag)).replace(/\s+/g, ' ').trim()).slice(0, 300) : '';

  // Visible-ish text: drop scripts, styles and tags.
  let visible = '';
  let from = 0;
  for (const t of named('script', 'style', 'noscript')) {
    if (t.at < from) continue;
    visible += source.slice(from, t.at) + ' ';
    const close = closeOf(lower, t);
    const after = lower.indexOf('>', close);
    from = after < 0 ? source.length : after + 1;
  }
  visible += source.slice(from);
  const text = decodeEntities(visible.replace(/<[^<>]*>/g, ' ')).replace(/\s+/g, ' ').trim().toLowerCase();

  const fields = (t) => attrs(t.raw);
  const inputInfo = (i) => ({ type: (i.type || 'text').toLowerCase(), name: (i.name || i.id || '').toLowerCase(), placeholder: (i.placeholder || '').toLowerCase(), autocomplete: (i.autocomplete || '').toLowerCase() });
  const inputTags = named('input', 'textarea', 'select');

  const forms = named('form').slice(0, 20).map((t) => {
    const a = fields(t);
    const close = closeOf(lower, t);
    const inputs = inputTags.filter((i) => i.at >= t.end && i.at < close).map(fields);
    const action = a.action || '';
    const actionHost = action ? hostOf(action, pageUrl) : null;
    return {
      action,
      method: (a.method || 'get').toLowerCase(),
      actionHost,
      external: Boolean(actionHost && page && analyze(`http://${actionHost}`)?.registrable !== pageReg),
      inputs: inputs.map(inputInfo)
    };
  });
  // Inputs outside <form> tags (common in JS-driven kits).
  const looseInputs = named('input').map(fields);

  const scripts = named('script').map((t) => {
    const a = fields(t);
    const close = lower.indexOf('</script', t.end);
    return { src: a.src || '', host: a.src ? hostOf(a.src, pageUrl) : null, inline: close < 0 ? '' : source.slice(t.end, close) };
  });
  const inlineJs = scripts.map((s) => s.inline).join('\n');

  const iframes = named('iframe').map((t) => {
    const a = fields(t);
    const style = (a.style || '').replace(/\s/g, '').toLowerCase();
    return {
      src: a.src || '',
      hidden: a.width === '0' || a.height === '0' || a.width === '1' || a.height === '1'
        || /display:none|visibility:hidden|width:0|height:0|opacity:0/.test(style) || 'hidden' in a
    };
  });

  const links = named('a').map(fields).filter((a) => 'href' in a).slice(0, 400).map((a) => a.href);

  const resources = named('img', 'link')
    .map((t) => { const a = fields(t); return t.name === 'img' ? a.src : a.href; })
    .filter(Boolean)
    .slice(0, 300)
    .map((u) => hostOf(u, pageUrl))
    .filter(Boolean);

  const metas = named('meta').map(fields);
  const metaRefresh = (metas.find((a) => (a['http-equiv'] || '').toLowerCase() === 'refresh' && a.content) || {}).content || '';
  const robots = (metas.find((a) => (a.name || '').toLowerCase() === 'robots' && a.content) || {}).content || '';

  return {
    title,
    titleLower: title.toLowerCase(),
    text: text.slice(0, 200000),
    htmlLower: lower,
    words: text ? text.split(' ').length : 0,
    forms,
    inputs: [...forms.flatMap((f) => f.inputs), ...looseInputs.map(inputInfo)],
    scripts: scripts.map(({ src, host }) => ({ src, host })),
    inlineJs,
    inlineJsBytes: inlineJs.length,
    iframes,
    links,
    resourceHosts: resources,
    metaRefresh,
    robots: robots.toLowerCase(),
    pageRegistrable: pageReg
  };
}

module.exports = { parse };
