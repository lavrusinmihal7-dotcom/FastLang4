'use strict';
/*
 * FastLang partner chat: live one-to-one chat between two logged-in users. Zero dependencies.
 *
 * How it works
 *  - every open page keeps one Server-Sent-Events connection (GET /api/pchat/stream) that the server pushes to
 *    (messages, typing, read receipts, who is online). SSE reconnects by itself and works behind proxies like Railway.
 *  - the browser sends with normal POST requests (/api/pchat/send, /typing, /read, ...).
 *  - messages are stored (MongoDB if configured, else DATA_DIR/messages.json), so a conversation can continue
 *    later and a user who was offline sees unread messages on the next login.
 *  - only the user's public id and display name are ever sent to other users, never the email.
 *
 * Endpoints (all need a login cookie)
 *  GET  /api/pchat/stream            live events
 *  GET  /api/pchat/me                my id, name, language profile
 *  POST /api/pchat/profile           { native, learning, bio }
 *  GET  /api/pchat/online            users online now
 *  POST /api/pchat/match             find the best online partner for my languages
 *  GET  /api/pchat/inbox             my conversations with unread counts
 *  GET  /api/pchat/history?with=ID   messages with one user
 *  POST /api/pchat/send              { to, text }
 *  POST /api/pchat/typing            { to }
 *  POST /api/pchat/read              { with }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LANGS = ['English', 'Japanese', 'Italian', 'Russian', 'Kazakh', 'Ukrainian', 'Lithuanian', 'Swedish', 'French', 'German', 'Spanish', 'Chinese', 'Korean', 'Turkish'];
const MAX_TEXT = 1000;
const MAX_CONNS_PER_USER = 5;
const MAX_PER_CONV = 1000;      // messages kept per conversation
const MAX_ONLINE_LIST = 200;

const convId = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
const cleanText = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim();

/* ---------- message storage ---------- */
function fileMessages(dir) {
  const file = path.join(dir, 'messages.json');
  fs.mkdirSync(dir, { recursive: true });
  const byConv = new Map();
  try {
    JSON.parse(fs.readFileSync(file, 'utf8')).forEach(m => {
      if (!byConv.has(m.conv)) byConv.set(m.conv, []);
      byConv.get(m.conv).push(m);
    });
  } catch (e) { /* first start */ }
  let timer = null;
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    const all = [];
    byConv.forEach(list => list.forEach(m => all.push(m)));
    const tmp = file + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(all)); fs.renameSync(tmp, file); }
    catch (e) { console.error('Could not save messages:', e.message); }
  }
  const persist = () => { if (!timer) timer = setTimeout(flush, 500); };
  ['SIGTERM', 'SIGINT'].forEach(sig => process.once(sig, () => { flush(); process.exit(0); }));
  return {
    name: 'JSON file (' + file + ')',
    async add(m) {
      let list = byConv.get(m.conv);
      if (!list) { list = []; byConv.set(m.conv, list); }
      list.push(m);
      if (list.length > MAX_PER_CONV) list.splice(0, list.length - MAX_PER_CONV);
      persist();
    },
    async history(conv, limit) { return (byConv.get(conv) || []).slice(-limit); },
    async markRead(conv, reader) {
      let n = 0;
      (byConv.get(conv) || []).forEach(m => { if (m.to === reader && !m.read) { m.read = true; n++; } });
      if (n) persist();
      return n;
    },
    async inbox(user) {
      const out = [];
      byConv.forEach((list, conv) => {
        if (!list.length) return;
        const last = list[list.length - 1];
        if (last.from !== user && last.to !== user) return;
        out.push({ other: last.from === user ? last.to : last.from, last, unread: list.filter(m => m.to === user && !m.read).length });
      });
      return out.sort((a, b) => b.last.ts - a.last.ts).slice(0, 100);
    }
  };
}

function mongoMessages(col) {
  let ready = null;
  const init = () => ready || (ready = col.createIndex({ conv: 1, ts: 1 }).then(() => col.createIndex({ to: 1, read: 1 })));
  return {
    name: 'MongoDB (messages)',
    async add(m) { await init(); await col.insertOne({ ...m }); },
    async history(conv, limit) {
      await init();
      const rows = await col.find({ conv }, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(limit).toArray();
      return rows.reverse();
    },
    async markRead(conv, reader) {
      await init();
      const r = await col.updateMany({ conv, to: reader, read: false }, { $set: { read: true } });
      return r.modifiedCount;
    },
    async inbox(user) {
      await init();
      const rows = await col.find({ $or: [{ from: user }, { to: user }] }, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(600).toArray();
      const seen = new Map();
      rows.forEach(m => {
        const other = m.from === user ? m.to : m.from;
        let c = seen.get(other);
        if (!c) { c = { other, last: m, unread: 0 }; seen.set(other, c); }
        if (m.to === user && !m.read) c.unread++;
      });
      return [...seen.values()].slice(0, 100);
    }
  };
}

/* ---------- the module ---------- */
module.exports = function create(opts) {
  const { store, sendJson, readJson, allow, dataDir } = opts;

  let msgStore = null;
  const msgs = () => msgStore || (msgStore = store.messagesCollection ? mongoMessages(store.messagesCollection()) : fileMessages(dataDir));

  const clients = new Map();   // user id -> Set of SSE responses (one per open tab)
  const profiles = new Map();  // user id -> { id, name, native, learning, bio }

  function profileOf(u) {
    const p = u.profile || {};
    const info = { id: u.id, name: u.name, native: LANGS.includes(p.native) ? p.native : '', learning: LANGS.includes(p.learning) ? p.learning : '', bio: typeof p.bio === 'string' ? p.bio.slice(0, 140) : '' };
    profiles.set(u.id, info);
    return info;
  }
  const isOnline = id => clients.has(id);
  function onlineList(exceptId) {
    const out = [];
    for (const id of clients.keys()) {
      if (id === exceptId) continue;
      const p = profiles.get(id);
      if (p) out.push(p);
      if (out.length >= MAX_ONLINE_LIST) break;
    }
    return out;
  }

  function sse(res, event, data) {
    try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* connection already gone */ }
  }
  function pushTo(userId, event, data) {
    const set = clients.get(userId);
    if (set) set.forEach(res => sse(res, event, data));
  }
  function broadcast(event, data, exceptId) {
    clients.forEach((set, id) => { if (id !== exceptId) set.forEach(res => sse(res, event, data)); });
  }

  function openStream(req, res, u) {
    const me = profileOf(u);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.write('retry: 3000\n\n');

    let set = clients.get(me.id);
    const firstTab = !set;
    if (!set) { set = new Set(); clients.set(me.id, set); }
    if (set.size >= MAX_CONNS_PER_USER) { const oldest = set.values().next().value; set.delete(oldest); try { oldest.end(); } catch (e) {} }
    set.add(res);

    sse(res, 'hello', { me, online: onlineList(me.id) });
    if (firstTab) broadcast('online', me, me.id);

    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 20000);
    const gone = () => {
      clearInterval(beat);
      set.delete(res);
      if (!set.size && clients.get(me.id) === set) { clients.delete(me.id); broadcast('offline', { id: me.id }, me.id); }
    };
    req.on('close', gone);
    res.on('error', gone);
  }

  /* best online partner: they speak what I learn, and learn what I speak */
  function findMatch(me) {
    let best = [], bestScore = -1;
    for (const id of clients.keys()) {
      if (id === me.id) continue;
      const p = profiles.get(id); if (!p) continue;
      let score = 0;
      if (me.learning && p.native === me.learning) score += 2;
      if (me.native && p.learning === me.native) score += 2;
      if (me.learning && p.learning === me.learning) score += 1;
      if (score > bestScore) { best = [p]; bestScore = score; } else if (score === bestScore) best.push(p);
    }
    if (!best.length) return { user: null };
    return { user: best[Math.floor(Math.random() * best.length)], exact: bestScore >= 4, score: bestScore };
  }

  async function handle(req, res, pathname, u) {
    const url = new URL(req.url, 'http://localhost');
    if (!u.id) return sendJson(res, 400, { error: 'Your account needs to be re-created to use chat.' });
    const me = profileOf(u);

    if (pathname === '/api/pchat/stream' && req.method === 'GET') return openStream(req, res, u);

    if (pathname === '/api/pchat/me' && req.method === 'GET') return sendJson(res, 200, { me: profileOf(u), langs: LANGS });

    if (pathname === '/api/pchat/online' && req.method === 'GET') return sendJson(res, 200, { online: onlineList(me.id) });

    if (pathname === '/api/pchat/profile' && req.method === 'POST') {
      if (!allow('pc_prof:' + u.id, 20, 10 * 60 * 1000)) return sendJson(res, 429, { error: 'Slow down a little.' });
      const b = await readJson(req);
      const native = typeof b.native === 'string' ? b.native : '';
      const learning = typeof b.learning === 'string' ? b.learning : '';
      if ((native && !LANGS.includes(native)) || (learning && !LANGS.includes(learning))) return sendJson(res, 400, { error: 'Please choose a language from the list.' });
      const bio = typeof b.bio === 'string' ? cleanText(b.bio).slice(0, 140) : '';
      const profile = { native, learning, bio };
      await store.saveProfile(u.email, profile);
      u.profile = profile;
      const info = profileOf(u);
      if (isOnline(info.id)) broadcast('online', info, info.id);   // "online" doubles as "profile updated"
      return sendJson(res, 200, { me: info });
    }

    if (pathname === '/api/pchat/match' && req.method === 'POST') {
      if (!allow('pc_match:' + u.id, 20, 10 * 60 * 1000)) return sendJson(res, 429, { error: 'Slow down a little.' });
      return sendJson(res, 200, findMatch(me));
    }

    if (pathname === '/api/pchat/inbox' && req.method === 'GET') {
      const rows = await msgs().inbox(u.id);
      const out = [];
      for (const r of rows) {
        let p = profiles.get(r.other);
        if (!p) { const o = await store.findById(r.other); if (o) p = { id: o.id, name: o.name, native: (o.profile && o.profile.native) || '', learning: (o.profile && o.profile.learning) || '', bio: '' }; }
        if (!p) continue;
        out.push({ user: p, online: isOnline(r.other), unread: r.unread, last: { text: r.last.text.slice(0, 80), ts: r.last.ts, mine: r.last.from === u.id } });
      }
      return sendJson(res, 200, { conversations: out });
    }

    if (pathname === '/api/pchat/history' && req.method === 'GET') {
      const other = url.searchParams.get('with') || '';
      if (!other || other === u.id) return sendJson(res, 400, { error: 'Choose someone to chat with.' });
      const list = await msgs().history(convId(u.id, other), 100);
      return sendJson(res, 200, { messages: list.map(m => ({ id: m.id, from: m.from, to: m.to, text: m.text, ts: m.ts, read: !!m.read })) });
    }

    if (pathname === '/api/pchat/send' && req.method === 'POST') {
      if (!allow('pc_send:' + u.id, 40, 60 * 1000)) return sendJson(res, 429, { error: 'You are sending very fast. Wait a moment.' });
      const b = await readJson(req);
      const to = typeof b.to === 'string' ? b.to : '';
      const text = typeof b.text === 'string' ? cleanText(b.text) : '';
      if (!to || to === u.id) return sendJson(res, 400, { error: 'Choose someone to chat with.' });
      if (!text) return sendJson(res, 400, { error: 'Type a message first.' });
      if (text.length > MAX_TEXT) return sendJson(res, 400, { error: 'Message is too long (max ' + MAX_TEXT + ' characters).' });
      const target = await store.findById(to);
      if (!target) return sendJson(res, 404, { error: 'That user does not exist.' });
      const m = { id: crypto.randomBytes(9).toString('hex'), conv: convId(u.id, to), from: u.id, to, text, ts: Date.now(), read: false };
      await msgs().add(m);
      const pub = { id: m.id, from: m.from, to: m.to, text: m.text, ts: m.ts, read: false };
      const fromInfo = profiles.get(u.id) || profileOf(u);
      pushTo(to, 'message', { msg: pub, from: fromInfo });
      pushTo(u.id, 'message', { msg: pub, from: fromInfo });   // other tabs of the sender
      return sendJson(res, 201, { msg: pub, delivered: isOnline(to) });
    }

    if (pathname === '/api/pchat/typing' && req.method === 'POST') {
      if (!allow('pc_typ:' + u.id, 90, 60 * 1000)) return sendJson(res, 429, { error: 'Slow down.' });
      const b = await readJson(req);
      if (typeof b.to === 'string' && b.to !== u.id) pushTo(b.to, 'typing', { from: u.id });
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/pchat/read' && req.method === 'POST') {
      if (!allow('pc_read:' + u.id, 120, 60 * 1000)) return sendJson(res, 429, { error: 'Slow down.' });
      const b = await readJson(req);
      const other = typeof b.with === 'string' ? b.with : '';
      if (!other || other === u.id) return sendJson(res, 400, { error: 'Choose someone.' });
      const conv = convId(u.id, other);
      const n = await msgs().markRead(conv, u.id);
      if (n) { pushTo(other, 'read', { by: u.id }); pushTo(u.id, 'read', { by: u.id, mine: true, other }); }
      return sendJson(res, 200, { ok: true, marked: n });
    }

    return sendJson(res, 404, { error: 'Not found' });
  }

  return { handle, LANGS };
};
