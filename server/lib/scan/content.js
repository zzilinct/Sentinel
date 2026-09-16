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
 * @param {string} html
 * @param {string} pageUrl final URL after redirects
 */
function parse(html, pageUrl) {
  const source = String(html).slice(0, MAX_SCAN);
  const lower = source.toLowerCase();
  const page = analyze(pageUrl);
  const pageReg = page ? page.registrable : '';

  const title = decodeEntities(((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(source) || [])[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 300);

  // Visible-ish text: drop scripts, styles and tags.
  const text = decodeEntities(
    source
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim().toLowerCase();

  const forms = [];
  const formRx = /<form\b[^>]*>([\s\S]*?)(<\/form>|$)/gi;
  let fm;
  while ((fm = formRx.exec(source)) && forms.length < 20) {
    const a = attrs(fm[0].slice(0, fm[0].indexOf('>') + 1));
    const inner = fm[1];
    const inputs = [...inner.matchAll(/<(input|textarea|select)\b[^>]*>/gi)].map((m) => attrs(m[0]));
    const action = a.action || '';
    const actionHost = action ? hostOf(action, pageUrl) : null;
    forms.push({
      action,
      method: (a.method || 'get').toLowerCase(),
      actionHost,
      external: Boolean(actionHost && page && analyze(`http://${actionHost}`)?.registrable !== pageReg),
      inputs: inputs.map((i) => ({ type: (i.type || 'text').toLowerCase(), name: (i.name || i.id || '').toLowerCase(), placeholder: (i.placeholder || '').toLowerCase(), autocomplete: (i.autocomplete || '').toLowerCase() }))
    });
  }
  // Inputs outside <form> tags (common in JS-driven kits).
  const looseInputs = [...source.matchAll(/<input\b[^>]*>/gi)].map((m) => attrs(m[0]));

  const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => {
    const a = attrs(`<script ${m[1]}>`);
    return { src: a.src || '', host: a.src ? hostOf(a.src, pageUrl) : null, inline: m[2] || '' };
  });
  const inlineJs = scripts.map((s) => s.inline).join('\n');

  const iframes = [...source.matchAll(/<iframe\b[^>]*>/gi)].map((m) => {
    const a = attrs(m[0]);
    const style = (a.style || '').replace(/\s/g, '').toLowerCase();
    return {
      src: a.src || '',
      hidden: a.width === '0' || a.height === '0' || a.width === '1' || a.height === '1'
        || /display:none|visibility:hidden|width:0|height:0|opacity:0/.test(style) || 'hidden' in a
    };
  });

  const links = [...source.matchAll(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)]
    .slice(0, 400)
    .map((m) => (m[2] ?? m[3] ?? m[4] ?? '').trim());

  const resources = [...source.matchAll(/<(img|link)\b[^>]*(src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .slice(0, 300)
    .map((m) => hostOf(m[3], pageUrl))
    .filter(Boolean);

  const metaRefresh = (/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']([^"']+)["']/i.exec(source) || [])[1] || '';
  const robots = (/<meta[^>]+name\s*=\s*["']robots["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(source) || [])[1] || '';

  return {
    title,
    titleLower: title.toLowerCase(),
    text: text.slice(0, 200000),
    htmlLower: lower,
    words: text ? text.split(' ').length : 0,
    forms,
    inputs: [...forms.flatMap((f) => f.inputs), ...looseInputs.map((i) => ({ type: (i.type || 'text').toLowerCase(), name: (i.name || i.id || '').toLowerCase(), placeholder: (i.placeholder || '').toLowerCase(), autocomplete: (i.autocomplete || '').toLowerCase() }))],
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
