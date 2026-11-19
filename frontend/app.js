/* Community Hub client. Every piece of user-supplied text is inserted with
 * textContent (via the h() helper below), never innerHTML, so it cannot inject markup. */
(() => {
  'use strict';

  const TRADES = ['doctors', 'labors', 'carpenters', 'technicians', 'teachers', 'developers', 'masons'];
  const $ = (id) => document.getElementById(id);
  const num = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

  /** Tiny element builder: h('div', {class:'x', onclick}, 'text', childEl) */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  // ------------------------------------------------------------------ state
  const state = {
    token: sessionStorage.getItem('hub_token'),
    me: null,
    socket: null,
    stats: { nationBalance: 0, byTrade: [], leaderboard: [], pendingCount: 0, verificationThreshold: 2 },
    entries: [],
    polls: new Map(),
    chat: { guild: [], community: [] },
    filter: 'all',
    channel: 'guild',
    presence: { online: 0, byTrade: {} }
  };

  // ---------------------------------------------------------------- helpers
  function toast(message, type) {
    const el = h('div', { class: `toast ${type || ''}` }, message);
    $('toasts').append(el);
    setTimeout(() => el.remove(), 5000);
  }

  function ago(iso) {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString();
  }

  function untilText(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (ms <= 0) return 'closing now';
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `closes in ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return `closes in ${hrs} h ${mins % 60} min`;
    return `closes in ${Math.round(hrs / 24)} days`;
  }

  async function api(path, options) {
    const base = (window.COMMUNITY_CONFIG && window.COMMUNITY_CONFIG.API_BASE_URL || '').replace(/\/$/, '');
    const res = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
      }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // ------------------------------------------------------------------ views
  function showAuth(message) {
    $('app-view').hidden = true;
    $('auth-view').hidden = false;
    $('auth-error').textContent = message || '';
  }
  function showApp() {
    $('auth-view').hidden = true;
    $('app-view').hidden = false;
  }

  function setConn(stateName, label) {
    const el = $('conn');
    el.dataset.state = stateName;
    el.textContent = label;
  }

  // -------------------------------------------------------------- rendering
  function renderMe() {
    if (!state.me) return;
    $('me-name').textContent = state.me.fullname || state.me.username;
    $('me-guild').textContent = state.me.trade;
    $('me-balance').textContent = `Your balance: ${num.format(state.me.personal_balance || 0)}`;
    const target = $('poll-target');
    target.replaceChildren(
      h('option', { value: 'all' }, 'Everyone'),
      h('option', { value: state.me.trade }, `My guild (${cap(state.me.trade)})`)
    );
    $('chat-tab-guild').textContent = cap(state.me.trade);
  }

  function renderPresence() {
    const { online, byTrade } = state.presence;
    const mine = state.me ? byTrade[state.me.trade] || 0 : 0;
    $('presence').textContent = `${online} online, ${mine} in your guild`;
  }

  function renderStats() {
    const { nationBalance, byTrade, leaderboard, pendingCount, verificationThreshold } = state.stats;
    $('nation-balance').textContent = num.format(nationBalance);
    $('balance-note').textContent = pendingCount
      ? `${pendingCount} contribution${pendingCount === 1 ? '' : 's'} waiting for endorsement, not counted yet.`
      : 'Every logged contribution is verified.';
    $('verify-hint').textContent =
      verificationThreshold > 0
        ? `A contribution counts once ${verificationThreshold} other member${verificationThreshold === 1 ? '' : 's'} endorse it.`
        : 'Contributions count immediately.';

    const bars = $('guild-bars');
    if (!byTrade.length) {
      bars.replaceChildren(h('p', { class: 'empty' }, 'No verified contributions yet.'));
    } else {
      const max = Math.max(...byTrade.map((r) => r.total), 1);
      bars.replaceChildren(
        ...byTrade.map((r) => {
          const fill = h('div', { class: 'fill' });
          fill.style.width = `${Math.max(2, (r.total / max) * 100)}%`;
          return h('div', { class: 'guild-row' }, h('span', { class: 'name' }, r.trade), h('div', { class: 'track' }, fill), h('span', { class: 'val' }, num.format(r.total)));
        })
      );
    }

    const board = $('leaderboard');
    const ranked = leaderboard.filter((m) => m.personal_balance > 0);
    board.replaceChildren(
      ...(ranked.length
        ? ranked.map((m) =>
            h('li', null, h('div', { class: 'line' }, h('span', null, m.fullname, ' ', h('span', { class: 'muted' }, `(${m.trade})`)), h('span', { class: 'val' }, num.format(m.personal_balance))))
          )
        : [h('li', { class: 'empty' }, 'Nobody has a verified balance yet.')])
    );
  }

  function renderLedger() {
    const list = $('ledger-list');
    const rows = state.entries.filter((e) => state.filter === 'all' || e.status === 'pending');
    if (!rows.length) {
      list.replaceChildren(h('li', { class: 'empty' }, state.filter === 'pending' ? 'Nothing is waiting for endorsement.' : 'No contributions yet. Log the first one.'));
      return;
    }
    list.replaceChildren(
      ...rows.map((e) => {
        const mine = e.userId === state.me.id;
        const endorsed = (e.endorserIds || []).includes(state.me.id);
        const pending = e.status === 'pending';
        const foot = pending
          ? [
              h('span', { class: 'state-pending' }, `${e.endorsementCount} of ${e.endorsementsNeeded} endorsements`),
              mine
                ? h('span', null, 'Waiting for others to endorse')
                : endorsed
                ? h('span', null, 'You endorsed this')
                : h('button', { onclick: () => emit('endorse_contribution', { entryId: e.id }) }, 'Endorse')
            ]
          : [h('span', { class: 'state-verified' }, 'Verified'), h('span', null, ago(e.verifiedAt || e.timestamp))];
        return h(
          'li',
          { class: `entry ${pending ? 'pending' : 'verified'}` },
          h('div', { class: 'entry-top' }, h('span', { class: 'desc' }, e.description), h('span', { class: 'amt' }, `+${num.format(e.amount)}`)),
          h('div', { class: 'muted small' }, `${mine ? 'You' : e.contributorName || 'A member'} (${e.trade}), ${ago(e.timestamp)}`),
          h('div', { class: 'entry-foot' }, foot)
        );
      })
    );
  }

  const pollIsOpen = (p) => p.isOpen && (!p.closesAt || Date.parse(p.closesAt) > Date.now());

  function renderPolls() {
    const list = $('polls-list');
    const polls = [...state.polls.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (!polls.length) {
      list.replaceChildren(h('p', { class: 'empty' }, 'No proposals yet. Start one above.'));
      return;
    }
    list.replaceChildren(
      ...polls.map((p) => {
        const open = pollIsOpen(p);
        const eligible = p.targetTrade === 'all' || p.targetTrade === state.me.trade;
        const canVote = open && eligible && p.myVote === null;
        const top = Math.max(...p.options.map((o) => o.votes));
        const isOwner = p.createdBy === state.me.username;

        const options = p.options.map((o, i) => {
          const pct = p.totalVotes ? (o.votes / p.totalVotes) * 100 : 0;
          const bar = h('span');
          bar.style.width = `${pct}%`;
          const winner = !open && top > 0 && o.votes === top;
          return h(
            'div',
            { class: `opt ${winner ? 'winner' : ''}` },
            h(
              'div',
              { class: 'opt-line' },
              h('span', { class: `opt-label ${p.myVote === i ? 'mine' : ''}` }, o.option, winner ? ' (leading)' : ''),
              h('span', { class: 'small muted' }, `${o.votes} vote${o.votes === 1 ? '' : 's'} (${Math.round(pct)}%)`),
              canVote ? h('button', { onclick: () => emit('cast_vote', { pollId: p.pollId, optionIndex: i }) }, 'Vote') : null
            ),
            h('div', { class: 'opt-bar' }, bar)
          );
        });

        return h(
          'article',
          { class: `poll ${open ? '' : 'closed'}` },
          h('h3', null, p.title),
          h(
            'div',
            { class: 'poll-meta' },
            h('span', null, p.targetTrade === 'all' ? 'Open to everyone' : `${cap(p.targetTrade)} guild only`),
            h('span', null, `by ${p.createdBy}`),
            h('span', null, open ? (p.closesAt ? untilText(p.closesAt) : 'open until closed') : 'closed'),
            h('span', null, `${p.totalVotes} vote${p.totalVotes === 1 ? '' : 's'}`)
          ),
          ...options,
          !eligible && open ? h('p', { class: 'small muted' }, 'Only members of this guild can vote.') : null,
          open && isOwner ? h('div', null, h('button', { onclick: () => emit('close_poll', { pollId: p.pollId }) }, 'Close voting now')) : null
        );
      })
    );
  }

  function renderChat() {
    const log = $('chat-log');
    const msgs = state.chat[state.channel];
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.replaceChildren(
      ...(msgs.length
        ? msgs.map((m) =>
            h('li', { class: `msg ${m.username === state.me.username ? 'mine' : ''}` }, h('div', { class: 'who-line' }, `${m.username}, ${ago(m.timestamp)}`), h('div', null, m.text))
          )
        : [h('li', { class: 'empty' }, 'No messages yet. Say hello.')])
    );
    if (atBottom || msgs.length <= 1) log.scrollTop = log.scrollHeight;
  }

  function renderAll() {
    renderMe();
    renderPresence();
    renderStats();
    renderLedger();
    renderPolls();
    renderChat();
  }

  // ---------------------------------------------------------------- sockets
  /** Sends an event; failures arrive via the server's `error_message` event as toasts. */
  function emit(event, payload, onOk) {
    if (!state.socket || !state.socket.connected) return toast('You are offline. Reconnecting…', 'error');
    state.socket.emit(event, payload, (res) => {
      if (res && res.ok && onOk) onOk(res);
    });
  }

  async function refreshMe() {
    try {
      const { member } = await api('/api/dashboard/me');
      state.me = { ...state.me, ...member };
      renderMe();
      loadAdminConsole();
    } catch (err) {
      if (err.status === 401 || err.status === 403) logout('Your session has expired. Please sign in again.');
    }
  }

  function upsertEntry(entry) {
    const i = state.entries.findIndex((e) => e.id === entry.id);
    if (i >= 0) state.entries[i] = entry;
    else state.entries.unshift(entry);
    state.entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    state.entries = state.entries.slice(0, 100);
  }

  function connect() {
    if (state.socket) state.socket.disconnect();
    const socket = io(window.COMMUNITY_CONFIG.REALTIME_URL, { auth: { token: state.token }, transports: ['websocket', 'polling'] });
    state.socket = socket;

    socket.on('connect', () => {
      setConn('online', 'Live');
      // Pull everything once per (re)connection, so a dropped connection never leaves stale data.
      socket.emit('sync', null, (res) => {
        if (!res || !res.ok) return;
        state.stats = res.stats;
        state.entries = res.ledger;
        state.polls = new Map(res.polls.map((p) => [p.pollId, p]));
        state.chat = res.chat;
        state.presence = res.presence;
        renderAll();
      });
    });
    socket.on('disconnect', () => setConn('offline', 'Offline, retrying'));
    socket.on('connect_error', (err) => {
      if (/authentication/i.test(err.message)) {
        socket.disconnect();
        logout('Your session is no longer valid. Please sign in again.');
      } else {
        setConn('offline', 'Offline, retrying');
      }
    });

    socket.on('error_message', (msg) => toast(msg, 'error'));
    socket.on('presence_updated', (p) => { state.presence = p; renderPresence(); });

    socket.on('contribution_updated', ({ entry }) => { upsertEntry(entry); renderLedger(); });
    socket.on('nation_balance_updated', (d) => {
      state.stats = { ...state.stats, nationBalance: d.totalNationBalance, byTrade: d.byTrade, leaderboard: d.leaderboard, pendingCount: d.pendingCount };
      renderStats();
      refreshMe();
    });

    socket.on('new_poll_available', (poll) => { state.polls.set(poll.pollId, poll); renderPolls(); });
    socket.on('poll_results_updated', ({ pollId, options, totalVotes }) => {
      const p = state.polls.get(pollId);
      if (p) { p.options = options; p.totalVotes = totalVotes; renderPolls(); }
    });
    socket.on('vote_recorded', ({ pollId, optionIndex }) => {
      const p = state.polls.get(pollId);
      if (p) { p.myVote = optionIndex; renderPolls(); }
    });
    socket.on('poll_closed', (poll) => {
      const old = state.polls.get(poll.pollId);
      state.polls.set(poll.pollId, { ...poll, myVote: old ? old.myVote : null });
      renderPolls();
    });

    socket.on('chat_message', (m) => {
      const list = state.chat[m.channel];
      list.push(m);
      if (list.length > 200) list.shift();
      if (m.channel === state.channel) renderChat();
    });
  }

  // ------------------------------------------------------------------- auth
  async function startSession(token, user, categories = []) {
    state.token = token;
    sessionStorage.setItem('hub_token', token);
    state.me = { ...user, personal_balance: 0 };
    sessionStorage.setItem('hub_user', JSON.stringify(state.me));
    if (!user.onboardingComplete) {
      $('google-signin').hidden = true;
      $('category-onboarding').hidden = false;
      $('onboarding-category').replaceChildren(
        h('option', { value: '' }, 'Choose your category'),
        ...categories.map((c) => h('option', { value: c._id || c.id }, c.name))
      );
      return;
    }
    await enterDashboard();
  }

  async function enterDashboard() {
    $('category-onboarding').hidden = true;
    $('google-signin').hidden = false;
    showApp();
    renderMe();
    connect();
    refreshMe();
  }

  async function googleSignIn() {
    try {
      const cfg = window.COMMUNITY_CONFIG && window.COMMUNITY_CONFIG.FIREBASE;
      if (!cfg || !cfg.apiKey || cfg.apiKey.startsWith('YOUR_')) throw new Error('Firebase web configuration is missing. Update frontend/config.js.');
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await firebase.auth().signInWithPopup(provider);
      const idToken = await result.user.getIdToken(true);
      const body = await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) });
      await startSession(body.token, body.user, body.categories || []);
    } catch (err) { $('auth-error').textContent = err.message || 'Google sign-in failed.'; }
  }

  async function loadAdminConsole() {
    if (!state.me || !['admin', 'super_admin'].includes(state.me.role)) return;
    $('admin-console').hidden = false;
    try {
      const [overview, categories, members] = await Promise.all([
        api('/api/community/admin/overview'), api('/api/community/categories'), api('/api/community/admin/members')
      ]);
      $('admin-summary').textContent = `${overview.members} members · ${overview.active} active · ${overview.suspended} suspended · ${overview.categories} categories`;
      $('admin-category-list').replaceChildren(...categories.categories.map((c) => {
        const toggle = h('button', { class: 'ghost', type: 'button' }, c.enabled ? 'Disable' : 'Enable');
        toggle.addEventListener('click', async () => { await api(`/api/community/admin/categories/${c._id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !c.enabled }) }); loadAdminConsole(); });
        const edit = h('button', { class: 'ghost', type: 'button' }, 'Rename');
        edit.addEventListener('click', async () => { const name = prompt('New category name:', c.name); if (name && name.trim()) { try { await api(`/api/community/admin/categories/${c._id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) }); loadAdminConsole(); } catch (e) { toast(e.message, 'error'); } } });
        const remove = h('button', { class: 'ghost', type: 'button' }, 'Archive');
        remove.addEventListener('click', async () => { if (confirm(`Archive ${c.name}?`)) { try { await api(`/api/community/admin/categories/${c._id}`, { method: 'DELETE' }); loadAdminConsole(); } catch (e) { toast(e.message, 'error'); } } });
        return h('li', null, h('strong', null, c.name), ' ', h('span', { class: 'muted' }, c.slug), ' ', toggle, ' ', edit, ' ', remove);
      }));
      $('admin-member-list').replaceChildren(...members.members.map((m) => {
        const row = h('li', null, h('strong', null, m.fullname || 'Member'), ` · ${m.email} · ${m.role} · ${m.status}`);
        if (state.me.role === 'super_admin' && m.role !== 'super_admin') {
          const role = h('button', { class: 'ghost', type: 'button' }, m.role === 'admin' ? 'Remove admin' : 'Make admin');
          role.addEventListener('click', async () => { try { await api(`/api/community/admin/members/${m._id}`, { method: 'PATCH', body: JSON.stringify({ role: m.role === 'admin' ? 'member' : 'admin' }) }); loadAdminConsole(); } catch (e) { toast(e.message, 'error'); } });
          const status = h('button', { class: 'ghost', type: 'button' }, m.status === 'active' ? 'Suspend' : 'Restore');
          status.addEventListener('click', async () => { try { await api(`/api/community/admin/members/${m._id}`, { method: 'PATCH', body: JSON.stringify({ status: m.status === 'active' ? 'suspended' : 'active' }) }); loadAdminConsole(); } catch (e) { toast(e.message, 'error'); } });
          row.append(' ', role, ' ', status);
        }
        return row;
      }));
    } catch (err) { toast(`Admin dashboard: ${err.message}`, 'error'); }
  }

  function logout(message) {
    if (state.socket) state.socket.disconnect();
    state.socket = null;
    state.token = null;
    state.me = null;
    $('admin-console').hidden = true;
    $('category-onboarding').hidden = true;
    $('google-signin').hidden = false;
    sessionStorage.removeItem('hub_token');
    sessionStorage.removeItem('hub_user');
    showAuth(message);
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function submitAuth(form, path) {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    $('auth-error').textContent = '';
    try {
      const body = await api(path, { method: 'POST', body: JSON.stringify(formData(form)) });
      form.reset();
      await startSession(body.token, body.user);
    } catch (err) {
      $('auth-error').textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  function selectAuthTab(which) {
    const login = which === 'login';
    $('tab-login').setAttribute('aria-selected', String(login));
    $('tab-register').setAttribute('aria-selected', String(!login));
    $('login-form').hidden = !login;
    $('register-form').hidden = login;
    $('auth-error').textContent = '';
  }

  // ---------------------------------------------------------------- wiring
  function init() {
    $('google-signin').addEventListener('click', googleSignIn);
    $('save-category').addEventListener('click', async () => {
      const categoryId = $('onboarding-category').value;
      if (!categoryId) { $('auth-error').textContent = 'Please select a category.'; return; }
      try {
        const result = await api('/api/community/onboarding/category', { method: 'POST', body: JSON.stringify({ categoryId }) });
        state.me.trade = result.category.slug; state.me.onboardingComplete = true;
        sessionStorage.setItem('hub_user', JSON.stringify(state.me));
        await enterDashboard();
      } catch (err) { $('auth-error').textContent = err.message; }
    });
    $('category-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const data = formData(e.target);
      try { await api('/api/community/admin/categories', { method: 'POST', body: JSON.stringify(data) }); e.target.reset(); loadAdminConsole(); } catch (err) { toast(err.message, 'error'); }
    });
    $('logout').addEventListener('click', () => { if (window.firebase && firebase.apps.length) firebase.auth().signOut(); logout(); });

    $('contrib-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const { amount, description } = formData(e.target);
      emit('submit_contribution', { amount: parseFloat(amount), description }, () => e.target.reset());
    });

    $('poll-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const options = f.options.split('\n').map((s) => s.trim()).filter(Boolean);
      const payload = { title: f.title, options, targetTrade: f.targetTrade };
      if (f.durationHours) payload.durationHours = parseFloat(f.durationHours);
      emit('create_poll', payload, () => {
        e.target.reset();
        e.target.closest('details').open = false;
      });
    });

    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const { text } = formData(e.target);
      emit('send_message', { channel: state.channel, text }, () => e.target.reset());
    });

    document.querySelectorAll('[data-filter]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.filter = btn.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        renderLedger();
      })
    );
    document.querySelectorAll('[data-channel]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.channel = btn.dataset.channel;
        document.querySelectorAll('[data-channel]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        renderChat();
      })
    );

    // Countdowns and "x min ago" labels stay fresh without any server traffic.
    setInterval(() => { if (state.me) { renderPolls(); renderLedger(); } }, 30000);

    if (state.token) {
      // Restore the verified session and its onboarding/role metadata.
      let savedUser = null;
      try { savedUser = JSON.parse(sessionStorage.getItem('hub_user') || 'null'); } catch (_) {}
      api('/api/dashboard/me').then(async ({ member }) => {
        if (!savedUser) return logout();
        state.me = { ...savedUser, ...member };
        if (state.me.onboardingComplete) await enterDashboard();
        else {
          const data = await api('/api/community/categories');
          $('google-signin').hidden = true; $('category-onboarding').hidden = false;
          $('onboarding-category').replaceChildren(h('option', { value: '' }, 'Choose your category'), ...data.categories.map((c) => h('option', { value: c._id }, c.name)));
        }
      }).catch(() => logout());
    } else {
      showAuth();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
