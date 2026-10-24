// Promemo — motori di intelligenza artificiale per l'assistente della Home
'use strict';
const AAPI = process.env.PROMEMO_ANTHROPIC_API || 'https://api.anthropic.com';

const DEFAULTS = {
  anthropic: { model: 'claude-sonnet-5-5', baseUrl: '' },
  ollama: { model: 'llama3.1', baseUrl: 'http://localhost:11434' },
  openai: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  local: { model: '', baseUrl: 'http://localhost:1234/v1' },
};

// server di modelli installati sul computer: tutti parlano l'interfaccia /v1 di OpenAI
const LOCAL_SERVERS = [
  ['Ollama', 'http://localhost:11434'], ['LM Studio', 'http://localhost:1234'], ['Jan', 'http://localhost:1337'],
  ['llama.cpp / LocalAI', 'http://localhost:8080'], ['vLLM', 'http://localhost:8000'], ['text-generation-webui', 'http://localhost:5000'],
  ['KoboldCpp', 'http://localhost:5001'], ['GPT4All', 'http://localhost:4891'], ['LocalAI (Docker)', 'http://localhost:8081'],
];
async function scanLocal(extra = []) {
  const quick = async (url) => { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1200); try { const r = await fetch(url, { signal: ctl.signal }); return r.ok ? await r.json() : null; } catch { return null; } finally { clearTimeout(t); } };
  const list = LOCAL_SERVERS.concat(extra.filter(Boolean).map(u => ['Indirizzo personalizzato', String(u).replace(/\/v1\/?$/, '').replace(/\/+$/, '')]));
  const found = await Promise.all(list.map(async ([name, base]) => {
    const j = await quick(base + '/v1/models');
    let models = j && Array.isArray(j.data) ? j.data.map(m => m.id).filter(Boolean) : [];
    if (name === 'Ollama' && !models.length) { const t = await quick(base + '/api/tags'); if (t && Array.isArray(t.models)) models = t.models.map(m => m.name); }
    return models.length || j ? { name, baseUrl: base + '/v1', models: [...new Set(models)].filter(m => !/embed/i.test(m)) } : null;
  }));
  const seen = new Set();
  return found.filter(x => x && !seen.has(x.baseUrl) && seen.add(x.baseUrl));
}

async function call(url, opts, timeoutMs = 90000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    const txt = await res.text();
    let j = null; try { j = JSON.parse(txt); } catch { /* testo semplice */ }
    if (!res.ok) {
      const msg = j?.error?.message || j?.error || txt.slice(0, 200) || res.status;
      if (res.status === 401 || res.status === 403) throw new Error('Chiave non valida o senza permessi: controllala nelle impostazioni dell\'assistente.');
      if (res.status === 429) throw new Error('Troppe richieste o credito esaurito: riprova tra poco.');
      throw new Error(`Errore del servizio (${res.status}): ${msg}`);
    }
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Il modello non ha risposto in tempo.');
    if (e.cause) throw new Error(`Servizio non raggiungibile (${e.cause.code || e.message}).`);
    throw e;
  } finally { clearTimeout(t); }
}

/**
 * cfg: { provider, model, baseUrl }, key: stringa (se serve)
 * system: istruzioni, messages: [{ role: 'user'|'assistant', content }]
 * restituisce il testo della risposta
 */
async function chat(cfg, key, system, messages, opts = {}) {
  const p = cfg.provider;
  const d = DEFAULTS[p] || {};
  const model = (cfg.model || d.model || '').trim();
  const base = (cfg.baseUrl || d.baseUrl || '').replace(/\/+$/, '');
  if (p === 'anthropic') {
    if (!key) throw new Error('Inserisci la chiave API di Anthropic nelle impostazioni.');
    const j = await call(`${AAPI}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: opts.maxTokens || 2500, system, messages }),
    });
    return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  }
  if (p === 'ollama') {
    const j = await call(`${base}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0.4 }, messages: [{ role: 'system', content: system }, ...messages] }),
    }, 300000);
    return j?.message?.content || '';
  }
  if (p === 'local') {
    if (!model) throw new Error('Scegli un modello: nelle impostazioni dell’assistente premi “Cerca sul computer”.');
    const j = await call(`${base}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.4, stream: false, ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}), messages: [{ role: 'system', content: system }, ...messages] }),
    }, 600000);
    return j?.choices?.[0]?.message?.content || '';
  }
  if (p === 'openai') {
    const j = await call(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, temperature: 0.4, ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}), messages: [{ role: 'system', content: system }, ...messages] }),
    }, opts.maxTokens > 3000 ? 240000 : 90000);
    return j?.choices?.[0]?.message?.content || '';
  }
  throw new Error('Nessun motore configurato.');
}

module.exports = { chat, DEFAULTS, scanLocal, LOCAL_SERVERS };
