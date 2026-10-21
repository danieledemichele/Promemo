// Promemo — accesso ai database Notion (gestione tabelle e viaggi)
'use strict';
const NAPI = process.env.PROMEMO_NOTION_API || 'https://api.notion.com';
const NVER = '2022-06-28';

function createNotionDb(ctx) {
  // ctx: data(), secret(id)
  function tokenFor(accId) {
    const accs = (ctx.data().accounts || []).filter(a => a.provider === 'notion');
    const acc = accId ? accs.find(a => a.id === accId) : accs[0];
    if (!acc) throw new Error('Collega prima un account Notion in “Account collegati”.');
    const t = ctx.secret(acc.id)?.token;
    if (!t) throw new Error('Token Notion mancante: ricollega l’account.');
    return t;
  }
  async function call(accId, path, opts = {}) {
    const res = await fetch(NAPI + path, { ...opts, headers: { Authorization: `Bearer ${tokenFor(accId)}`, 'Notion-Version': NVER, 'Content-Type': 'application/json' } });
    const txt = await res.text();
    let j = null; try { j = JSON.parse(txt); } catch { /* */ }
    if (res.status === 401) throw new Error('Token Notion non valido.');
    if (res.status === 404) throw new Error('Non trovato: hai condiviso la pagina o il database con l’integrazione?');
    if (res.status === 429) throw new Error('Notion: troppe richieste, riprova tra poco.');
    if (!res.ok) throw new Error(`Notion: ${j?.message || res.status}`);
    return j;
  }
  const plain = (arr) => (arr || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');

  // valore leggibile di una proprietà
  function readProp(p) {
    if (!p) return null;
    switch (p.type) {
      case 'title': return plain(p.title);
      case 'rich_text': return plain(p.rich_text);
      case 'number': return p.number;
      case 'select': return p.select ? { name: p.select.name, color: p.select.color } : null;
      case 'status': return p.status ? { name: p.status.name, color: p.status.color } : null;
      case 'multi_select': return (p.multi_select || []).map(o => ({ name: o.name, color: o.color }));
      case 'date': return p.date ? { start: p.date.start, end: p.date.end } : null;
      case 'checkbox': return !!p.checkbox;
      case 'url': return p.url; case 'email': return p.email; case 'phone_number': return p.phone_number;
      case 'place': { const x = p.place || {}; return (x.name || x.address || x.lat != null || x.latitude != null) ? { name: x.name || '', address: x.address || '', lat: x.lat ?? x.latitude ?? null, lon: x.lon ?? x.longitude ?? null } : null; }
      case 'people': return (p.people || []).map(u => u.name || u.id).join(', ');
      case 'relation': return (p.relation || []).length;
      case 'formula': { const f = p.formula || {}; return f[f.type] ?? null; }
      case 'rollup': { const r = p.rollup || {}; return r.type === 'number' ? r.number : r.type === 'array' ? (r.array || []).length : null; }
      case 'created_time': return p.created_time; case 'last_edited_time': return p.last_edited_time;
      case 'files': return (p.files || []).map(f => f.name).join(', ');
      default: return null;
    }
  }
  const simplify = (page) => ({ id: page.id, url: page.url, archived: page.archived || page.in_trash, edited: page.last_edited_time, icon: page.icon?.emoji || '', props: Object.fromEntries(Object.entries(page.properties || {}).map(([k, v]) => [k, { type: v.type, value: readProp(v) }])) });

  async function listDatabases(accId) {
    const out = []; let cursor;
    for (let i = 0; i < 5; i++) {
      const body = { filter: { property: 'object', value: 'database' }, page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const j = await call(accId, '/v1/search', { method: 'POST', body: JSON.stringify(body) });
      for (const d of j.results || []) out.push({ id: d.id, title: plain(d.title) || 'Senza titolo', icon: d.icon?.emoji || '', url: d.url, edited: d.last_edited_time, parent: d.parent?.type });
      if (!j.has_more) break; cursor = j.next_cursor;
    }
    return out.sort((a, b) => (b.edited || '').localeCompare(a.edited || ''));
  }

  async function schema(accId, dbId) {
    const d = await call(accId, `/v1/databases/${dbId}`);
    return { id: d.id, title: plain(d.title) || 'Senza titolo', icon: d.icon?.emoji || '', url: d.url, props: Object.entries(d.properties).map(([name, p]) => ({ name, type: p.type, options: (p[p.type]?.options || []).map(o => ({ name: o.name, color: o.color })), format: p.number?.format || null })) };
  }

  async function query(accId, dbId, { cursor, sorts, max = 100 } = {}) {
    const body = { page_size: Math.min(100, max) };
    if (cursor) body.start_cursor = cursor;
    if (sorts) body.sorts = sorts;
    const j = await call(accId, `/v1/databases/${dbId}/query`, { method: 'POST', body: JSON.stringify(body) });
    return { rows: (j.results || []).map(simplify), next: j.has_more ? j.next_cursor : null };
  }
  async function queryAll(accId, dbId, sorts) {
    const rows = []; let cursor = null;
    for (let i = 0; i < 20; i++) { const r = await query(accId, dbId, { cursor, sorts }); rows.push(...r.rows); if (!r.next) break; cursor = r.next; }
    return rows;
  }

  async function update(accId, pageId, properties) { return simplify(await call(accId, `/v1/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties }) })); }
  async function create(accId, dbId, properties) { return simplify(await call(accId, '/v1/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: dbId }, properties }) })); }
  async function archive(accId, pageId) { await call(accId, `/v1/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }); return true; }

  // cerca i database contenuti in una pagina (anche dentro colonne, toggle e callout)
  async function childDatabases(accId, pageId, depth = 0) {
    const found = []; let cursor;
    for (let i = 0; i < 5; i++) {
      const j = await call(accId, `/v1/blocks/${pageId}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`);
      for (const b of j.results || []) {
        if (b.type === 'child_database') found.push({ id: b.id, title: b.child_database?.title || '' });
        else if (b.has_children && depth < 3 && ['column_list', 'column', 'toggle', 'callout', 'synced_block', 'heading_1', 'heading_2', 'heading_3', 'quote'].includes(b.type)) found.push(...await childDatabases(accId, b.id, depth + 1));
      }
      if (!j.has_more) break; cursor = j.next_cursor;
    }
    return found;
  }

  return { listDatabases, schema, query, queryAll, update, create, archive, childDatabases, simplify };
}

module.exports = { createNotionDb };
