// Promemo — motori di intelligenza artificiale per l'assistente della Home
'use strict';
const AAPI = process.env.PROMEMO_ANTHROPIC_API || 'https://api.anthropic.com';

const DEFAULTS = {
  anthropic: { model: 'claude-sonnet-5-5', baseUrl: '' },
  ollama: { model: 'llama3.1', baseUrl: 'http://localhost:11434' },
  openai: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
};

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

module.exports = { chat, DEFAULTS };
