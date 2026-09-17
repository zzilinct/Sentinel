'use strict';
/**
 * The AI workspace behind the Sentinel dashboard: ChatGPT, Claude, Gemini and
 * DeepSeek as four tabs.
 *
 * Each tab connects through that provider's official API using a key the user
 * pastes from their own account. Sentinel never asks for, shows, or handles a
 * provider password - a login form for someone else's service rendered inside
 * our product would be indistinguishable from phishing, which is precisely what
 * this product exists to stop.
 */
const { sendJson, HttpError, readJson } = require('../lib/http');
const { rateLimit } = require('../lib/security');
const A = require('../lib/auth');
const { db, now } = require('../lib/db');

const PROVIDERS = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    vendor: 'OpenAI',
    accent: '#10a37f',
    model: 'gpt-4o-mini',
    keyPrefix: 'sk-',
    keyUrl: 'https://platform.openai.com/api-keys',
    consoleUrl: 'https://chatgpt.com',
    verify: (key) => ({ url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${key}` } }),
    chat(key, messages, model) {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: { model: model || this.model, messages, max_tokens: 1024 },
        pick: (d) => d.choices?.[0]?.message?.content || ''
      };
    }
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    vendor: 'Anthropic',
    accent: '#d97757',
    model: 'claude-sonnet-5',
    keyPrefix: 'sk-ant-',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    consoleUrl: 'https://claude.ai',
    verify: (key) => ({ url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }),
    chat(key, messages, model) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') || undefined;
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: { model: model || this.model, max_tokens: 1024, system, messages: messages.filter((m) => m.role !== 'system') },
        pick: (d) => (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
      };
    }
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    vendor: 'Google',
    accent: '#4285f4',
    model: 'gemini-2.5-flash',
    keyPrefix: '',
    keyUrl: 'https://aistudio.google.com/apikey',
    consoleUrl: 'https://gemini.google.com',
    verify: (key) => ({ url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, headers: {} }),
    chat(key, messages, model) {
      const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model || this.model}:generateContent?key=${encodeURIComponent(key)}`,
        headers: { 'Content-Type': 'application/json' },
        body: {
          ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
          contents: messages.filter((m) => m.role !== 'system').map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }))
        },
        pick: (d) => (d.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('')
      };
    }
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    vendor: 'DeepSeek',
    accent: '#4d6bfe',
    model: 'deepseek-chat',
    keyPrefix: 'sk-',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    consoleUrl: 'https://chat.deepseek.com',
    verify: (key) => ({ url: 'https://api.deepseek.com/models', headers: { Authorization: `Bearer ${key}` } }),
    chat(key, messages, model) {
      return {
        url: 'https://api.deepseek.com/chat/completions',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: { model: model || this.model, messages, max_tokens: 1024 },
        pick: (d) => d.choices?.[0]?.message?.content || ''
      };
    }
  }
};

const q = {
  get: db.prepare('SELECT * FROM ai_connections WHERE user_id = ? AND provider = ?'),
  all: db.prepare('SELECT provider, label, created_at FROM ai_connections WHERE user_id = ?'),
  upsert: db.prepare(`INSERT INTO ai_connections (user_id, provider, key_cipher, label, created_at) VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT(user_id, provider) DO UPDATE SET key_cipher = excluded.key_cipher, label = excluded.label, created_at = excluded.created_at`),
  del: db.prepare('DELETE FROM ai_connections WHERE user_id = ? AND provider = ?')
};

function publicProvider(p, connection) {
  return {
    id: p.id, name: p.name, vendor: p.vendor, accent: p.accent, model: p.model,
    keyUrl: p.keyUrl, consoleUrl: p.consoleUrl,
    connected: Boolean(connection),
    label: connection ? connection.label : null,
    connectedAt: connection ? connection.created_at : null
  };
}

function pick(providerId) {
  const p = Object.prototype.hasOwnProperty.call(PROVIDERS, providerId) ? PROVIDERS[providerId] : null;
  if (!p) throw new HttpError(404, 'unknown_provider', 'Unknown AI provider');
  return p;
}

/** Mask a key for display: sk-ant-...4f21 */
function maskKey(key) {
  if (key.length <= 10) return '****';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

async function callUpstream(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  return { ok: res.ok, status: res.status, data, text };
}

function upstreamError(provider, result) {
  const msg = result.data?.error?.message || result.data?.message || result.text?.slice(0, 200) || 'Upstream error';
  if (result.status === 401 || result.status === 403) {
    return new HttpError(401, 'provider_unauthorized', `${provider.name} rejected the API key. Check it and reconnect.`);
  }
  if (result.status === 429) return new HttpError(429, 'provider_rate_limited', `${provider.name} is rate limiting this key. Try again shortly.`);
  return new HttpError(502, 'provider_error', `${provider.name}: ${msg}`);
}

function register(router) {
  router.get('/api/v1/ai/providers', (req, res) => {
    const user = A.requireUser(req);
    const connections = new Map(q.all.all(user.id).map((c) => [c.provider, c]));
    sendJson(res, 200, { providers: Object.values(PROVIDERS).map((p) => publicProvider(p, connections.get(p.id))) });
  });

  router.post('/api/v1/ai/connect', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    const provider = pick(body.provider);
    const key = String(body.apiKey || '').trim();

    if (!key) throw new HttpError(400, 'missing_key', `Paste your ${provider.vendor} API key`);
    if (key.length > 300) throw new HttpError(400, 'bad_key_format', 'That key is too long');
    if (provider.keyPrefix && !key.startsWith(provider.keyPrefix)) {
      throw new HttpError(400, 'bad_key_format', `${provider.vendor} keys start with "${provider.keyPrefix}"`);
    }
    if (/\s/.test(key)) throw new HttpError(400, 'bad_key_format', 'That key contains spaces - copy it again');

    rateLimit(`ai_connect:${user.id}`, 20, 10 * 60 * 1000);

    const check = provider.verify(key);
    const result = await callUpstream(check.url, { headers: check.headers });
    if (!result.ok) throw upstreamError(provider, result);

    q.upsert.run(user.id, provider.id, A.encryptSecret(key), maskKey(key), now());
    sendJson(res, 200, { ok: true, provider: publicProvider(provider, q.get.get(user.id, provider.id)) });
  });

  router.post('/api/v1/ai/disconnect', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    const provider = pick(body.provider);
    q.del.run(user.id, provider.id);
    sendJson(res, 200, { ok: true, provider: publicProvider(provider, null) });
  });

  router.post('/api/v1/ai/chat', async (req, res) => {
    const user = A.requireUser(req);
    const body = await readJson(req);
    const provider = pick(body.provider);

    const connection = q.get.get(user.id, provider.id);
    if (!connection) throw new HttpError(412, 'not_connected', `Connect your ${provider.vendor} account first`);

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const clean = messages
      .filter((m) => m && typeof m.content === 'string' && ['user', 'assistant', 'system'].includes(m.role))
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    if (!clean.length) throw new HttpError(400, 'empty_conversation', 'Send at least one message');

    rateLimit(`ai_chat:${user.id}`, 60, 60 * 1000);

    const key = A.decryptSecret(connection.key_cipher);
    const model = typeof body.model === 'string' && /^[a-z0-9][a-z0-9.:-]{0,59}$/i.test(body.model) ? body.model : undefined;
    const spec = provider.chat(key, clean, model);
    const result = await callUpstream(spec.url, { method: 'POST', headers: spec.headers, body: spec.body });
    if (!result.ok) throw upstreamError(provider, result);

    const reply = spec.pick(result.data) || '(empty response)';
    sendJson(res, 200, { provider: provider.id, model: model || provider.model, reply });
  });
}

module.exports = { register };
