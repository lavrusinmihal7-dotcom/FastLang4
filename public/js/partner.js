/* FastLang partner chat (browser side).
 * Live events arrive over one Server-Sent-Events connection (/api/pchat/stream); everything the user does is a normal POST.
 * All user-written text is inserted with textContent, never as HTML. */
(function () {
  var app = document.getElementById('pc_app');
  if (!app) return;
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    native: $('pc_native'), learning: $('pc_learning'), bio: $('pc_bio'), save: $('pc_save'), match: $('pc_match'), status: $('pc_status'),
    tabs: [].slice.call(document.querySelectorAll('.pc_tabs button')), list: $('pc_list'), onlineN: $('pc_online_n'), unreadN: $('pc_unread_n'),
    empty: $('pc_empty'), conv: $('pc_conv'), back: $('pc_back'), name: $('pc_name'), meta: $('pc_meta'), dot: $('pc_dot'), log: $('pc_log'),
    typing: $('pc_typing'), chips: $('pc_chips'), form: $('pc_form'), input: $('pc_input'), send: $('pc_send')
  };

  var me = null;                 // { id, name, native, learning, bio }
  var online = {};               // id -> profile of users that are online now
  var convs = {};                // id -> { user, unread, last:{text, ts, mine} }
  var cache = {};                // id -> [messages] of conversations opened in this page
  var current = null;            // id of the open conversation
  var tab = 'online';
  var es = null, typingHide = null, lastTypingSent = 0, baseTitle = document.title;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function api(path, method, body) {
    var opt = { method: method || 'GET', credentials: 'same-origin', headers: {} };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401) { window.location.href = 'login.html?next=' + encodeURIComponent('/partner.html'); }
        return { ok: r.ok, status: r.status, d: d };
      });
    });
  }
  function toast(msg, bad) {
    if (window.FL && FL.toast) return FL.toast(msg, bad ? 'bad' : '');
    var t = el('div', 'pc_toast' + (bad ? ' bad' : ''), msg); document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 2800);
  }
  function setStatus(text, cls) { els.status.textContent = text; els.status.className = 'pc_status ' + (cls || ''); }
  function timeOf(ts) { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function langLine(p) {
    var a = [];
    if (p.native) a.push('speaks ' + p.native);
    if (p.learning) a.push('learning ' + p.learning);
    return a.join(' \u00B7 ');
  }
  function userById(id) { return online[id] || (convs[id] && convs[id].user) || null; }

  /* ---------- sidebar ---------- */
  function compat(p) {   // how well another user fits my languages (for sorting)
    var s = 0;
    if (me.learning && p.native === me.learning) s += 2;
    if (me.native && p.learning === me.native) s += 2;
    if (me.learning && p.learning === me.learning) s += 1;
    return s;
  }
  function totalUnread() { var n = 0; Object.keys(convs).forEach(function (k) { n += convs[k].unread || 0; }); return n; }
  function renderList() {
    var ids = Object.keys(online);
    els.onlineN.textContent = ids.length ? ids.length : '';
    var un = totalUnread();
    els.unreadN.textContent = un ? un : '';
    document.title = (un ? '(' + un + ') ' : '') + baseTitle;
    els.list.textContent = '';
    var rows;
    if (tab === 'online') {
      rows = ids.map(function (id) { return { user: online[id], online: true, unread: (convs[id] || {}).unread || 0 }; })
        .sort(function (a, b) { return compat(b.user) - compat(a.user) || a.user.name.localeCompare(b.user.name); });
      if (!rows.length) { els.list.appendChild(el('li', 'pc_none', 'Nobody else is online right now. Open the Chats tab to message someone later, or come back soon.')); return; }
    } else {
      rows = Object.keys(convs).map(function (id) { return { user: convs[id].user, online: !!online[id], unread: convs[id].unread, last: convs[id].last }; })
        .sort(function (a, b) { return ((b.last && b.last.ts) || 0) - ((a.last && a.last.ts) || 0); });
      if (!rows.length) { els.list.appendChild(el('li', 'pc_none', 'No conversations yet. Pick someone from the Online list to say hello.')); return; }
    }
    rows.forEach(function (r) {
      var li = el('li', 'pc_item' + (current === r.user.id ? ' on' : ''));
      var b = el('button'); b.type = 'button';
      var av = el('span', 'pc_av', (r.user.name || '?').charAt(0).toUpperCase());
      av.appendChild(el('i', 'pc_av_dot' + (r.online ? ' on' : '')));
      var txt = el('span', 'pc_item_txt');
      txt.appendChild(el('b', '', r.user.name));
      var sub = tab === 'chats' && r.last ? (r.last.mine ? 'You: ' : '') + r.last.text : (langLine(r.user) || 'No languages set');
      txt.appendChild(el('small', '', sub));
      b.appendChild(av); b.appendChild(txt);
      if (r.unread) b.appendChild(el('span', 'pc_badge', r.unread));
      b.addEventListener('click', function () { openConv(r.user); });
      li.appendChild(b); els.list.appendChild(li);
    });
  }

  /* ---------- conversation ---------- */
  function renderHead() {
    var u = userById(current); if (!u) return;
    els.name.textContent = u.name;
    var isOn = !!online[current];
    els.meta.textContent = (langLine(u) || 'FastLang learner') + (isOn ? '' : ' \u00B7 offline - they will see your messages later');
    els.dot.className = 'pc_dot' + (isOn ? ' on' : ''); els.dot.title = isOn ? 'Online' : 'Offline';
  }
  function renderChips() {
    els.chips.textContent = '';
    var u = userById(current); if (!u) return;
    var list = ['Hi! Nice to meet you \uD83D\uDC4B'];
    if (me.learning && u.native === me.learning) list.push('Could we practise ' + me.learning + ' together?');
    else if (u.native) list.push('Could we chat in ' + u.native + ' for a while?');
    list.push('Could you correct my mistakes, please?');
    list.forEach(function (t) {
      var b = el('button', '', t); b.type = 'button';
      b.addEventListener('click', function () { els.input.value = t; autosize(); els.input.focus(); });
      els.chips.appendChild(b);
    });
  }
  function msgNode(m) {
    var mine = m.from === me.id;
    var d = el('div', 'pc_msg ' + (mine ? 'mine' : 'theirs')); d.setAttribute('data-id', m.id);
    d.appendChild(el('div', 'pc_txt', m.text));
    var meta = el('div', 'pc_time', timeOf(m.ts));
    if (mine) { var tick = el('span', 'pc_tick' + (m.read ? ' read' : ''), m.read ? ' \u2713\u2713' : ' \u2713'); tick.title = m.read ? 'Read' : 'Sent'; meta.appendChild(tick); }
    d.appendChild(meta);
    return d;
  }
  function renderLog() {
    els.log.textContent = '';
    var list = cache[current] || [];
    if (!list.length) els.log.appendChild(el('div', 'pc_log_empty', 'No messages yet - say hello!'));
    list.forEach(function (m) { els.log.appendChild(msgNode(m)); });
    els.log.scrollTop = els.log.scrollHeight;
  }
  function addMessage(other, m) {
    var list = cache[other]; if (!list) return false;            // not opened yet: history will include it
    if (list.some(function (x) { return x.id === m.id; })) return false;
    list.push(m);
    if (current === other) {
      var empty = els.log.querySelector('.pc_log_empty'); if (empty) empty.remove();
      var stick = els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 120 || m.from === me.id;
      els.log.appendChild(msgNode(m));
      if (stick) els.log.scrollTop = els.log.scrollHeight;
    }
    return true;
  }
  function markRead(id) {
    if (!id || document.hidden) return;
    var c = convs[id];
    if (c && c.unread) { c.unread = 0; renderList(); }
    api('/api/pchat/read', 'POST', { 'with': id });
  }
  function openConv(user) {
    current = user.id;
    if (!online[user.id] && !convs[user.id]) convs[user.id] = { user: user, unread: 0, last: null };
    els.empty.hidden = true; els.conv.hidden = false; app.classList.add('pc_open');
    els.typing.hidden = true;
    renderHead(); renderChips(); renderList();
    els.log.textContent = ''; els.log.appendChild(el('div', 'pc_log_empty', 'Loading...'));
    api('/api/pchat/history?with=' + encodeURIComponent(user.id)).then(function (x) {
      if (current !== user.id) return;
      if (!x.ok) { els.log.textContent = ''; els.log.appendChild(el('div', 'pc_log_empty', x.d.error || 'Could not load messages.')); return; }
      cache[user.id] = x.d.messages;
      renderLog(); markRead(user.id);
    });
    els.input.focus();
  }
  function closeConv() { current = null; els.conv.hidden = true; els.empty.hidden = false; app.classList.remove('pc_open'); renderList(); }

  function send(text) {
    text = (text || '').trim(); if (!text || !current) return;
    var to = current; els.send.disabled = true;
    api('/api/pchat/send', 'POST', { to: to, text: text }).then(function (x) {
      els.send.disabled = false;
      if (!x.ok) { toast(x.d.error || 'Message was not sent.', true); return; }
      els.input.value = ''; autosize();
      var m = x.d.msg;
      if (!cache[to]) cache[to] = [];
      addMessage(to, m);
      var u = userById(to) || { id: to, name: 'User', native: '', learning: '' };
      convs[to] = { user: u, unread: 0, last: { text: m.text, ts: m.ts, mine: true } };
      renderList();
      if (!x.d.delivered) setStatus('They are offline - they will see it next time.', '');
      els.input.focus();
    }).catch(function () { els.send.disabled = false; toast('Could not reach the server.', true); });
  }

  /* ---------- live events ---------- */
  function onMessage(d) {
    var m = d.msg, mine = m.from === me.id, other = mine ? m.to : m.from;
    var user = mine ? userById(other) : d.from;
    if (!user) user = { id: other, name: 'User', native: '', learning: '' };
    if (!mine && d.from) { if (online[other]) online[other] = d.from; }
    var open = current === other;
    var c = convs[other] || { user: user, unread: 0, last: null };
    c.user = user; c.last = { text: m.text, ts: m.ts, mine: mine };
    if (!mine && !(open && !document.hidden)) c.unread = (c.unread || 0) + 1;
    convs[other] = c;
    if (cache[other]) addMessage(other, m);
    if (open && !mine) { els.typing.hidden = true; markRead(other); }
    if (!mine && !(open && !document.hidden)) toast('New message from ' + user.name);
    renderList();
  }
  function onTyping(d) {
    if (d.from !== current) return;
    var u = userById(current);
    els.typing.textContent = (u ? u.name : 'They') + ' is typing...'; els.typing.hidden = false;
    clearTimeout(typingHide); typingHide = setTimeout(function () { els.typing.hidden = true; }, 3200);
  }
  function onRead(d) {
    if (d.mine) { if (convs[d.other]) { convs[d.other].unread = 0; renderList(); } return; }
    var list = cache[d.by]; if (!list) return;
    list.forEach(function (m) { if (m.from === me.id) m.read = true; });
    if (current === d.by) renderLog();
  }
  function connect() {
    if (es) es.close();
    es = new EventSource('/api/pchat/stream');
    es.addEventListener('hello', function (e) {
      var d = JSON.parse(e.data); me = d.me; online = {};
      d.online.forEach(function (p) { online[p.id] = p; });
      setStatus('Connected \u2022 you are online', 'ok');
      loadInbox().then(function () {
        if (current) { renderHead(); api('/api/pchat/history?with=' + encodeURIComponent(current)).then(function (x) { if (x.ok) { cache[current] = x.d.messages; renderLog(); markRead(current); } }); }   // catch up after a reconnect
      });
    });
    es.addEventListener('online', function (e) { var p = JSON.parse(e.data); online[p.id] = p; if (convs[p.id]) convs[p.id].user = p; renderList(); if (current === p.id) renderHead(); });
    es.addEventListener('offline', function (e) { var d = JSON.parse(e.data); delete online[d.id]; renderList(); if (current === d.id) renderHead(); });
    es.addEventListener('message', function (e) { onMessage(JSON.parse(e.data)); });
    es.addEventListener('typing', function (e) { onTyping(JSON.parse(e.data)); });
    es.addEventListener('read', function (e) { onRead(JSON.parse(e.data)); });
    es.onerror = function () { setStatus('Connection lost - reconnecting...', 'bad'); };
  }
  function loadInbox() {
    return api('/api/pchat/inbox').then(function (x) {
      if (!x.ok) return;
      var next = {};
      x.d.conversations.forEach(function (c) { next[c.user.id] = { user: c.user, unread: c.unread, last: c.last }; });
      if (current && !next[current] && convs[current]) next[current] = convs[current];
      convs = next; renderList();
    });
  }

  /* ---------- profile, matching, input ---------- */
  function fillSelect(sel, langs, value, none) {
    sel.textContent = '';
    var o = el('option', '', none); o.value = ''; sel.appendChild(o);
    langs.forEach(function (l) { var x = el('option', '', l); x.value = l; sel.appendChild(x); });
    sel.value = value || '';
  }
  els.save.addEventListener('click', function () {
    els.save.disabled = true;
    api('/api/pchat/profile', 'POST', { native: els.native.value, learning: els.learning.value, bio: els.bio.value }).then(function (x) {
      els.save.disabled = false;
      if (!x.ok) return toast(x.d.error || 'Could not save.', true);
      me = x.d.me; toast('Saved'); renderList();
    });
  });
  els.match.addEventListener('click', function () {
    if (!me || (!me.native && !me.learning)) toast('Tip: set the languages you speak and learn, then press Save, for a better match.');
    els.match.disabled = true;
    api('/api/pchat/match', 'POST', {}).then(function (x) {
      els.match.disabled = false;
      if (!x.ok) return toast(x.d.error || 'Could not search.', true);
      if (!x.d.user) return toast('Nobody else is online yet. Try again in a minute or message someone from the Chats tab.');
      online[x.d.user.id] = x.d.user;
      toast(x.d.exact ? 'Found a great match: ' + x.d.user.name : 'No perfect match - here is ' + x.d.user.name);
      openConv(x.d.user);
    });
  });
  els.tabs.forEach(function (b) {
    b.addEventListener('click', function () {
      tab = b.getAttribute('data-tab');
      els.tabs.forEach(function (x) { x.classList.toggle('on', x === b); });
      renderList();
    });
  });
  els.back.addEventListener('click', closeConv);
  els.form.addEventListener('submit', function (e) { e.preventDefault(); send(els.input.value); });
  els.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(els.input.value); } });
  function autosize() { els.input.style.height = 'auto'; els.input.style.height = Math.min(120, els.input.scrollHeight) + 'px'; }
  els.input.addEventListener('input', function () {
    autosize();
    var now = Date.now();
    if (current && els.input.value && now - lastTypingSent > 2500) { lastTypingSent = now; api('/api/pchat/typing', 'POST', { to: current }); }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && current) markRead(current); });
  window.addEventListener('focus', function () { if (current) markRead(current); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && current && window.innerWidth < 768) closeConv(); });

  /* ---------- start ---------- */
  api('/api/pchat/me').then(function (x) {
    if (!x.ok) { setStatus(x.d.error || 'Chat is not available.', 'bad'); return; }
    me = x.d.me;
    fillSelect(els.native, x.d.langs, me.native, 'Choose...');
    fillSelect(els.learning, x.d.langs, me.learning, 'Choose...');
    els.bio.value = me.bio || '';
    if (!window.EventSource) { setStatus('Your browser does not support live chat. Please update it.', 'bad'); return; }
    connect();
  }).catch(function () { setStatus('Could not reach the server.', 'bad'); });
  window.addEventListener('beforeunload', function () { if (es) es.close(); });
})();
