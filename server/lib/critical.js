'use strict';
/**
 * The first view's styles, inside the page: for a page that carries `<!-- @critical -->` (web/app.html), every rule of
 * its stylesheets that can match the page's own markup is put in a <style> there, and the stylesheets themselves are
 * fetched without holding up the first paint (preloaded; the page's script applies them, web/assets/js/app.js).
 *
 * "Can match" is read from the names, never guessed from looks: a rule is kept when every class, id and element its
 * selector needs is in the page's markup or is a class its early scripts put on (boot.js, intro.js). What a rule only
 * excludes (:not), what it may do (:is, :where) and attributes never leave a rule out. Keeping too much costs bytes;
 * leaving out a rule the shell uses would show it unstyled until the stylesheet lands, so the doubt always keeps.
 * At-rules keep their place: @media and @supports with what they hold that is kept, every @font-face and @property,
 * and the @keyframes the kept rules name. Rules stay in their stylesheet's order, the stylesheets in the page's.
 */
const fs = require('fs');
const path = require('path');

const LINK = /<link rel="stylesheet" href="(\/assets\/[^"]+\.css)">/g;
const MARK = '<!-- @critical -->';

/** The stylesheets a page links, as files under `base`. */
function sheets(base, html) {
  return [...html.matchAll(LINK)].map((m) => ({ href: m[1], file: path.join(base, m[1]) }));
}

/** Top-level items of a stylesheet: { at, prelude, body } for blocks, { at, text } for statements, { sel, body } for rules. */
function parse(css) {
  const out = [];
  let i = 0;
  const n = css.length;
  const skipString = (q) => { i++; while (i < n && css[i] !== q) { if (css[i] === '\\') i++; i++; } i++; };
  while (i < n) {
    // Comments and space between items.
    if (css[i] === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (/\s/.test(css[i])) { i++; continue; }
    const start = i;
    let depth = 0;
    let open = -1;
    for (; i < n; i++) {
      const c = css[i];
      if (c === '"' || c === '\'') { skipString(c); i--; continue; }
      if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = (e < 0 ? n : e + 2) - 1; continue; }
      if (c === ';' && depth === 0) { i++; break; }
      if (c === '{') { if (depth === 0) open = i; depth++; }
      if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    const text = css.slice(start, i);
    if (open < 0) { out.push({ at: /^@[\w-]+/.exec(text) ? /^@[\w-]+/.exec(text)[0] : '', text }); continue; }
    const head = css.slice(start, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const body = css.slice(open + 1, i - 1);
    if (head.startsWith('@')) out.push({ at: /^@[\w-]+/.exec(head)[0], prelude: head, body });
    else out.push({ sel: head, body });
  }
  return out;
}

/** Whether one selector of a rule can match markup made of these names. */
function canMatch(selector, names) {
  // What :not() excludes, and what :is()/:where() may match, never leave a rule out; nor do attributes.
  let s = selector;
  for (let k = 0; k < 4; k++) s = s.replace(/:(?:not|is|where)\((?:[^()]|\([^()]*\))*\)/g, '');
  s = s.replace(/\[[^\]]*\]/g, '').replace(/::?[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, (m) => (m.startsWith(':has(') ? m : ''));
  // :has() needs what it names to be there.
  s = s.replace(/:has\(((?:[^()]|\([^()]*\))*)\)/g, ' $1 ');
  for (const m of s.matchAll(/([.#]?)(-?[_a-zA-Z][\w-]*)/g)) {
    const [, kind, name] = m;
    if (kind === '.' && !names.classes.has(name)) return false;
    if (kind === '#' && !names.ids.has(name)) return false;
    if (!kind && !names.tags.has(name.toLowerCase())) return false;
  }
  return true;
}

const headScripts = (base, html) => [...html.slice(0, html.indexOf('</head>')).matchAll(/<script src="(\/assets\/js\/[\w.-]+\.js)"/g)].map((m) => path.join(base, m[1]));
/** Every file the first view's styles are made from: a new version of any is a new page. */
const inputs = (base, html) => [...sheets(base, html).map((s) => s.file), ...headScripts(base, html)];

/** The class, id and element names a page's markup and its early scripts can put on the first view. */
function namesOf(base, html) {
  const names = { classes: new Set(), ids: new Set(), tags: new Set(['html', 'body']) };
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)/g)) names.tags.add(m[1].toLowerCase());
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) m[1].split(/\s+/).filter(Boolean).forEach((c) => names.classes.add(c));
  for (const m of html.matchAll(/\sid="([^"]*)"/g)) names.ids.add(m[1]);
  // Scripts in <head> run before the first paint, or as it happens: the classes they set are part of it.
  for (const file of headScripts(base, html)) {
    if (!fs.existsSync(file)) continue;
    const js = fs.readFileSync(file, 'utf8');
    for (const c of js.matchAll(/classList\.(?:add|toggle)\('([\w-]+)'|className = '([\w\s-]+)'/g)) (c[1] || c[2]).split(/\s+/).forEach((x) => names.classes.add(x));
  }
  return names;
}

function keep(items, names, out) {
  for (const it of items) {
    if (it.sel !== undefined) {
      if (it.sel.split(/,(?![^()]*\))/).some((one) => canMatch(one.trim(), names))) out.push(`${it.sel}{${it.body.trim()}}`);
    } else if (it.at === '@media' || it.at === '@supports') {
      const inner = [];
      keep(parse(it.body), names, inner);
      if (inner.length) out.push(`${it.prelude}{${inner.join('')}}`);
    } else if (it.at === '@font-face' || it.at === '@property') out.push(`${it.prelude}{${it.body.trim()}}`);
    else if (it.at === '@keyframes') out.push({ keyframes: /@keyframes\s+([\w-]+)/.exec(it.prelude)[1], text: `${it.prelude}{${it.body.trim()}}` });
    // @import: the stylesheet it names is linked by the page itself.
  }
}

/** The page with its first view's styles inside it and its stylesheets no longer holding up the first paint. */
function inline(base, html) {
  const names = namesOf(base, html);
  const out = [];
  for (const { file } of sheets(base, html)) {
    if (!fs.existsSync(file)) continue;
    keep(parse(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')), names, out);
  }
  const rules = out.filter((x) => typeof x === 'string');
  const used = new Set();
  for (const r of rules) for (const m of r.matchAll(/animation(?:-name)?:\s*([^;}]+)/g)) m[1].split(/[\s,]+/).forEach((w) => used.add(w));
  const css = out.map((x) => (typeof x === 'string' ? x : used.has(x.keyframes) ? x.text : '')).join('\n').replace(/\n+/g, '\n');
  // Before the first stylesheet, so each one, put in later, comes after these rules as the page orders them.
  const at = html.search(LINK);
  if (at < 0) return html.replace(MARK, '');
  return (html.slice(0, at) + `<style>\n${css}\n</style>\n` + html.slice(at)).replace(MARK, '')
    .replace(LINK, '<link rel="preload" href="$1" as="style" data-late>');
}

module.exports = { MARK, sheets, inputs, inline, canMatch, parse };
