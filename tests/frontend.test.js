/**
 * Drives the real index.html + app.js (served by the real server) inside jsdom,
 * with a real WebSocket connection, to prove the UI works end to end.
 * (jsdom does not enforce CSP; that is covered separately in security.test.js.)
 */
const { JSDOM, ResourceLoader } = require('jsdom');
const h = require('./helpers/harness');
h.setEnv({ VERIFICATION_THRESHOLD: '1' });

let srv;
let dom;
let doc;
const $ = (sel) => doc.querySelector(sel);
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await h.sleep(30); }
  throw new Error(`condition not met: ${fn}`);
};
const type = (el, value) => { el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
const submit = (form) => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

beforeAll(async () => {
  srv = await h.startServer();
  dom = await JSDOM.fromURL(`${srv.base}/`, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
  doc = dom.window.document;
  // jsdom ships no fetch(); real browsers do. Bridge it to Node's, resolving relative URLs.
  dom.window.fetch = (url, opts) => fetch(new URL(url, srv.base), opts);
  await until(() => dom.window.io && !$('#auth-view').hidden);
});
afterAll(async () => { dom.window.close(); await srv.stop(); });

test('signed-out visitors see the sign-in screen, not the app', () => {
  expect($('#auth-view').hidden).toBe(false);
  expect($('#app-view').hidden).toBe(true);
});

test('registering signs the member in and loads live state', async () => {
  $('#tab-register').click();
  const f = $('#register-form');
  type(f.elements.fullname, 'Ada <b>Builder</b>');
  type(f.elements.username, 'ada_ui');
  type(f.elements.trade, 'carpenters');
  type(f.elements.password, 'correct-horse-battery');
  submit(f);

  await until(() => !$('#app-view').hidden);
  await until(() => $('#conn').dataset.state === 'online');
  // User text is rendered as text, never parsed as markup.
  expect($('#me-name').textContent).toBe('Ada <b>Builder</b>');
  expect($('#me-name').querySelector('b')).toBeNull();
  expect($('#me-guild').textContent).toBe('carpenters');
  expect($('#nation-balance').textContent).toBe('0');
});

test('a logged contribution appears as pending and a second member can endorse it', async () => {
  const f = $('#contrib-form');
  type(f.elements.amount, '60');
  type(f.elements.description, '<img src=x onerror=alert(1)> Fixed the roof');
  submit(f);

  const entry = await until(() => $('#ledger-list .entry.pending'));
  expect(entry.textContent).toContain('Fixed the roof');
  expect(entry.querySelector('img')).toBeNull(); // injected markup is inert
  expect(entry.textContent).toContain('0 of 1 endorsements');
  expect(entry.querySelector('button')).toBeNull(); // can't endorse your own entry

  // A second member endorses over a raw socket; the UI should flip to verified and update the total.
  const bob = await h.register(srv.base, 'bob_ui', 'masons');
  const sb = await srv.connect(bob.token);
  const { ledger } = await h.call(sb, 'sync');
  await h.call(sb, 'endorse_contribution', { entryId: ledger[0].id });

  await until(() => $('#ledger-list .entry.verified'));
  await until(() => $('#nation-balance').textContent === '60');
  await until(() => /Your balance: 60/.test($('#me-balance').textContent));
  expect($('#guild-bars').textContent).toContain('carpenters');
});

test('creating a proposal lists it with vote buttons; voting updates the tally live', async () => {
  const f = $('#poll-form');
  type(f.elements.title, 'Paint the hall?');
  type(f.elements.options, 'Yes\nNo\n  \nMaybe');
  submit(f);

  const poll = await until(() => $('#polls-list .poll'));
  expect(poll.querySelector('h3').textContent).toBe('Paint the hall?');
  expect(poll.querySelectorAll('.opt')).toHaveLength(3); // blank line ignored

  poll.querySelector('.opt button').click(); // vote "Yes"
  await until(() => $('#polls-list .poll .opt-label.mine'));
  expect($('#polls-list .poll').textContent).toContain('1 vote (100%)');
  expect($('#polls-list .poll .opt button')).toBeNull(); // can't vote twice
});

test('chat: sending shows the message; another guild member\'s guild message arrives live', async () => {
  const f = $('#chat-form');
  type(f.elements.text, 'hello <i>guild</i>');
  submit(f);
  const msg = await until(() => $('#chat-log .msg.mine'));
  expect(msg.textContent).toContain('hello <i>guild</i>');
  expect(msg.querySelector('i')).toBeNull();

  const carl = await h.register(srv.base, 'carl_ui', 'carpenters');
  const sc = await srv.connect(carl.token);
  await h.call(sc, 'send_message', { channel: 'guild', text: 'from carl' });
  await until(() => [...doc.querySelectorAll('#chat-log .msg')].some((m) => m.textContent.includes('from carl')));
});

test('signing out returns to the sign-in screen and drops the session', async () => {
  $('#logout').click();
  await until(() => $('#app-view').hidden && !$('#auth-view').hidden);
  expect(dom.window.sessionStorage.getItem('hub_token')).toBeNull();
});
