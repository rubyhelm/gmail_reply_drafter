/**
 * Reply Drafter - Gmail add-on
 * Open an email -> press "Draft reply" -> Groq writes a reply draft,
 * using free time slots from your master calendar.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const FALLBACK_MODEL = 'llama-3.1-8b-instant'; // used if the main model is rate limited
const DEFAULTS = {
  startHour: '9', endHour: '17', buffer: '15', meetingLen: '30',
  days: '10', slots: '4', perDay: '2', weekends: '0', minNoticeH: '24',
  calendarIds: '', model: 'gpt-5.6-luna', fallbackModel: '',
  apiUrl: 'https://api.openai.com/v1/chat/completions'
};

/* ---------- small helpers ---------- */
const UP = () => PropertiesService.getUserProperties();
const pad = n => ('0' + n).slice(-2);
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

function getSettings() {
  const r = UP().getProperty('settings');
  return Object.assign({}, DEFAULTS, r ? JSON.parse(r) : {});
}
function getKeys() { return JSON.parse(UP().getProperty('keys') || '[]'); }
function getProfile() { return UP().getProperty('profile') || ''; }

function inp(e, name, fallback) {
  const f = e.commonEventObject && e.commonEventObject.formInputs && e.commonEventObject.formInputs[name];
  if (f && f.stringInputs && f.stringInputs.value && f.stringInputs.value.length) return f.stringInputs.value[0];
  return fallback;
}
function dd(name, title, items, selected) {
  const w = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN).setFieldName(name).setTitle(title);
  items.forEach(it => w.addItem(it[1], String(it[0]), String(it[0]) === String(selected)));
  return w;
}
function sw(name, label, on) {
  return CardService.newSelectionInput().setType(CardService.SelectionInputType.SWITCH)
    .setFieldName(name).addItem(label, '1', !!on);
}
const hours = (a, b) => { const r = []; for (let h = a; h <= b; h++) r.push([h, pad(h) + ':00']); return r; };
const nums = (arr, suffix) => arr.map(x => [x, x + suffix]);
const btn = (text, fn, params) => CardService.newTextButton().setText(text)
  .setOnClickAction(CardService.newAction().setFunctionName(fn).setParameters(params || {}));
const nav = {
  push: c => CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().pushCard(c)).build(),
  pop: msg => CardService.newActionResponseBuilder().setNotification(CardService.newNotification().setText(msg))
    .setNavigation(CardService.newNavigation().popCard()).build(),
  update: (c, msg) => CardService.newActionResponseBuilder().setNotification(CardService.newNotification().setText(msg))
    .setNavigation(CardService.newNavigation().updateCard(c)).build(),
  note: msg => CardService.newActionResponseBuilder().setNotification(CardService.newNotification().setText(msg)).build()
};
function footer() {
  return CardService.newFixedFooter().setPrimaryButton(btn('Settings', 'openSettings'));
}

/* ---------- cards ---------- */
function onHomepage() {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Reply Drafter'))
    .addSection(CardService.newCardSection().addWidget(
      CardService.newTextParagraph().setText('Open an email, then press "Draft reply".')))
    .setFixedFooter(footer()).build();
}

function onGmailMessageOpen(e) {
  const s = getSettings();
  const sec = CardService.newCardSection()
    .addWidget(CardService.newTextInput().setFieldName('hint').setTitle('Hint (optional)')
      .setHint('e.g. "decline politely" or "ask for interview times"'))
    .addWidget(sw('useCal', 'Include my availability', true))
    .addWidget(dd('startHour', 'Start time', hours(5, 20), s.startHour))
    .addWidget(dd('endHour', 'End time', hours(8, 23), s.endHour))
    .addWidget(dd('buffer', 'Buffer around meetings', nums([0, 15, 30, 60], ' min'), s.buffer))
    .addWidget(dd('meetingLen', 'Meeting length', nums([15, 30, 45, 60, 90], ' min'), s.meetingLen))
    .addWidget(CardService.newButtonSet().addButton(
      CardService.newTextButton().setText('Draft reply')
        .setComposeAction(
          CardService.newAction().setFunctionName('draftReply').setParameters({ messageId: e.gmail.messageId }),
          CardService.ComposedEmailType.REPLY_AS_DRAFT)
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)));
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Draft a reply'))
    .addSection(sec).setFixedFooter(footer()).build();
}

function openSettings() { return nav.push(settingsCard()); }

function settingsCard() {
  const s = getSettings();
  const sec = CardService.newCardSection().setHeader('Availability rules')
    .addWidget(dd('startHour', 'Start time', hours(5, 20), s.startHour))
    .addWidget(dd('endHour', 'End time', hours(8, 23), s.endHour))
    .addWidget(dd('buffer', 'Buffer around meetings', nums([0, 15, 30, 60], ' min'), s.buffer))
    .addWidget(dd('meetingLen', 'Meeting length', nums([15, 30, 45, 60, 90], ' min'), s.meetingLen))
    .addWidget(dd('days', 'Days ahead', nums([3, 5, 7, 10, 14, 21], ' days'), s.days))
    .addWidget(dd('slots', 'Max time options (total)', nums([1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30], ''), s.slots))
    .addWidget(dd('perDay', 'Max options per day', nums([1, 2, 3, 4, 5, 6], ''), s.perDay))
    .addWidget(dd('minNoticeH', 'Minimum notice', nums([0, 12, 24, 48], ' h'), s.minNoticeH))
    .addWidget(sw('weekends', 'Include weekends', s.weekends === '1'))
    .addWidget(CardService.newTextInput().setFieldName('calendarIds').setTitle('Calendar IDs (comma separated)')
      .setHint('Type all, or list IDs separated by commas').setValue(s.calendarIds));
  const sec2 = CardService.newCardSection().setHeader('AI')
    .addWidget(CardService.newTextInput().setFieldName('model').setTitle('Model').setValue(s.model))
    .addWidget(CardService.newTextInput().setFieldName('fallbackModel').setTitle('Fallback model (optional)')
      .setValue(s.fallbackModel))
    .addWidget(CardService.newTextInput().setFieldName('apiUrl').setTitle('API URL')
      .setHint('OpenAI: https://api.openai.com/v1/chat/completions').setValue(s.apiUrl))
    .addWidget(CardService.newTextInput().setFieldName('profile').setTitle('About me / style / CV summary')
      .setMultiline(true).setValue(getProfile())
      .setHint('Your name, job target, tone, short CV summary (max ~8000 chars)'))
    .addWidget(CardService.newButtonSet()
      .addButton(btn('Save', 'saveSettings').setTextButtonStyle(CardService.TextButtonStyle.FILLED))
      .addButton(btn('API keys', 'openKeys')));
  return CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle('Settings'))
    .addSection(sec).addSection(sec2).build();
}

function saveSettings(e) {
  const s = {};
  Object.keys(DEFAULTS).forEach(k => { s[k] = String(inp(e, k, DEFAULTS[k])).trim(); });
  s.weekends = inp(e, 'weekends', '0') === '1' ? '1' : '0';
  UP().setProperty('settings', JSON.stringify(s));
  UP().setProperty('profile', String(inp(e, 'profile', '')).slice(0, 8000));
  return nav.pop('Settings saved');
}

function openKeys() { return nav.push(keysCard()); }

function keysCard() {
  const keys = getKeys();
  const sec = CardService.newCardSection().setHeader('API keys (' + keys.length + ')');
  if (!keys.length) sec.addWidget(CardService.newTextParagraph().setText('No keys yet.'));
  keys.forEach((k, i) => {
    sec.addWidget(CardService.newDecoratedText().setText('Key ' + (i + 1) + ': ...' + k.slice(-4))
      .setButton(btn('Remove', 'removeKey', { idx: String(i) })));
  });
  sec.addWidget(CardService.newTextInput().setFieldName('newKey').setTitle('Paste new key'))
    .addWidget(CardService.newButtonSet().addButton(btn('Add key', 'addKey')));
  return CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle('API keys'))
    .addSection(sec).build();
}

function addKey(e) {
  const k = String(inp(e, 'newKey', '')).trim();
  if (!k) return nav.note('Paste a key first');
  const keys = getKeys();
  if (keys.indexOf(k) === -1) keys.push(k);
  UP().setProperty('keys', JSON.stringify(keys));
  return nav.update(keysCard(), 'Key added');
}

function removeKey(e) {
  const keys = getKeys();
  keys.splice(Number(e.parameters.idx), 1);
  UP().setProperty('keys', JSON.stringify(keys));
  return nav.update(keysCard(), 'Key removed');
}

/* ---------- main action ---------- */
function draftReply(e) {
  try {
    const s = getSettings();
    ['startHour', 'endHour', 'buffer', 'meetingLen'].forEach(k => { s[k] = inp(e, k, s[k]); });
    if (Number(s.endHour) <= Number(s.startHour)) return nav.note('End time must be after start time');
    const useCal = inp(e, 'useCal', '') === '1';
    const hint = String(inp(e, 'hint', '')).trim();

    GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
    const opened = GmailApp.getMessageById(e.parameters.messageId || e.gmail.messageId);
    const msg = pickLatest(opened);

    let slots = [], calWarning = '';
    const calIds = s.calendarIds.split(',').map(x => x.trim()).filter(Boolean);
    if (useCal && calIds.length) {
      try { slots = freeWindows(s, calIds.some(x => x.toLowerCase() === 'all') ? allCalendarIds() : calIds); }
      catch (err) { calWarning = 'Calendar problem: ' + err.message + '. Draft written without availability.'; }
    }

    const text = callGroq(buildMessages(msg, slots, hint), s);
    // If the calendar check failed, say so at the top of the draft (delete that line before sending)
    const body = calWarning ? '[NOTE: ' + calWarning + ' Delete this line.]\n\n' + text : text;
    const draft = msg.createDraftReply(body, { htmlBody: esc(body) }); // HTML body so Mailsuite can track
    // Opens the new draft straight in the compose window
    return CardService.newComposeActionResponseBuilder().setGmailDraft(draft).build();
  } catch (err) {
    throw new Error(err.message); // Gmail shows this as the add-on error
  
  //   msg.createDraftReply(text, { htmlBody: esc(text) }); // HTML body so Mailsuite can track

  //   const sec = CardService.newCardSection()
  //     .addWidget(CardService.newTextParagraph().setText(
  //       '<b>Replying to:</b> ' + esc(msg.getFrom()) + '<br>' + esc(msg.getDate().toString().slice(0, 21))))
  //     .addWidget(CardService.newTextParagraph().setText(esc(text)))
  //     .addWidget(CardService.newTextParagraph().setText(
  //       slots.length ? '<b>Slots offered to the AI:</b><br>' + esc(slots.join('\n')) : 'No availability used.'));
  //   if (calWarning) sec.addWidget(CardService.newTextParagraph().setText('<b>' + esc(calWarning) + '</b>'));
  //   sec.addWidget(CardService.newButtonSet().addButton(
  //     CardService.newTextButton().setText('Open drafts')
  //       .setOpenLink(CardService.newOpenLink().setUrl('https://mail.google.com/mail/u/0/#drafts'))));
  //   return nav.push(CardService.newCardBuilder()
  //     .setHeader(CardService.newCardHeader().setTitle('Draft saved')).addSection(sec).build());
  // } catch (err) {
  //   return nav.note('Error: ' + err.message);
  }
}

// Newest message in the thread that is not a draft and not sent by me
function pickLatest(opened) {
  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  const all = opened.getThread().getMessages().filter(m => !m.isDraft());
  const incoming = all.filter(m => m.getFrom().toLowerCase().indexOf(me) === -1);
  const list = incoming.length ? incoming : all;
  return list.length ? list[list.length - 1] : opened;
}

/* ---------- prompt ---------- */
function cleanBody(t) {
  t = (t || '').replace(/\r/g, '');
  const m = t.search(/\nOn .{5,120} wrote:|\n-{2,}\s*Original Message|\n>/i);
  if (m > 0) t = t.slice(0, m);
  return t.slice(0, 4000).trim();
}

function buildMessages(msg, slots, hint) {
  const tz = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'z'); // e.g. CDT
  const system = [
    'You write email reply drafts for a job applicant who is replying to recruiters and hiring managers.',
    'Write ONLY the email body (greeting to sign-off). No subject line, no explanations.',
    'Reply in English',
    'Always be polite and professional. Keep it short and natural.',
    'Never invent facts about the person. Use only the profile below.',
    slots.length
      ? 'If the email asks for a call/interview time, offer the available times below EXACTLY as written (do not change dates or times; keep one line per day with all of that day\'s times together, and keep the am/pm format, never convert to 24-hour time) and keep the time zone abbreviation shown after each time (like CDT or CST). Never write a long time zone name such as America/Chicago. If the email does not ask about scheduling, do not mention availability.'
      : 'Do not propose specific dates or times.',
    '',
    'PROFILE AND STYLE:',
    getProfile() || '(none provided)'
  ].join('\n');
  const user = [
    'From: ' + msg.getFrom(),
    'Subject: ' + msg.getSubject(),
    '',
    cleanBody(msg.getPlainBody()),
    '',
    slots.length ? 'AVAILABLE TIMES (' + tz + '):\n' + slots.join('\n') : '',
    hint ? '\nMy instruction for this reply: ' + hint : ''
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/* ---------- calendar ---------- */
function getBusy(calIds, from, to) {
  const res = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: calIds.map(id => ({ id: id })) })
  });
  const j = JSON.parse(res.getContentText());
  if (j.error) throw new Error(j.error.message);
  let busy = [];
  Object.keys(j.calendars || {}).forEach(id => {
    const c = j.calendars[id];
    if (c.errors && c.errors.length) throw new Error('no access to calendar "' + id + '" (check sharing)');
    busy = busy.concat((c.busy || []).map(b => [new Date(b.start).getTime(), new Date(b.end).getTime()]));
  });
  return busy;
}

// Every calendar in this account's calendar list (ticked or not), except holidays and birthdays
function allCalendarIds() {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=freeBusyReader', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
    });
  const j = JSON.parse(res.getContentText());
  if (j.error) throw new Error(j.error.message);
  return (j.items || [])
    .filter(c => !/#(holiday|contacts)@group\.v\.calendar\.google\.com$/.test(c.id))
    .map(c => c.id);
}

function freeWindows(s, calIds) {
  const tz = Session.getScriptTimeZone();
  const now = Date.now(), days = Number(s.days);
  const minStart = now + Number(s.minNoticeH) * 3600e3;
  const buf = Number(s.buffer) * 60e3, len = Number(s.meetingLen) * 60e3, Q = 15 * 60e3;
  const busy = getBusy(calIds, new Date(now), new Date(now + (days + 1) * 86400e3))
    .map(b => [b[0] - buf, b[1] + buf]).sort((a, b) => a[0] - b[0]);
  const fmt = (t, f) => Utilities.formatDate(new Date(t), tz, f);
  const all = [], seen = {};
  for (let i = 0; i <= days; i++) {
    const d = now + i * 86400e3, ds = fmt(d, 'yyyy-MM-dd');
    if (seen[ds]) continue; seen[ds] = 1;
    if (s.weekends !== '1' && Number(fmt(d, 'u')) > 5) continue;
    const from = Utilities.parseDate(ds + ' ' + pad(s.startHour) + ':00', tz, 'yyyy-MM-dd HH:mm').getTime();
    const to = Utilities.parseDate(ds + ' ' + pad(s.endHour) + ':00', tz, 'yyyy-MM-dd HH:mm').getTime();
    let cur = Math.ceil(Math.max(from, minStart) / Q) * Q;
    const day = [];
    for (const b of busy) {
      if (b[1] <= cur) continue;
      if (b[0] >= to) break;
      if (b[0] - cur >= len) day.push([cur, b[0]]);
      cur = Math.ceil(Math.max(cur, b[1]) / Q) * Q;
    }
    if (to - cur >= len) day.push([cur, to]);
    day.slice(0, Number(s.perDay) || 2).forEach(w => all.push(w)); // max windows per day
  }
  const chosen = all.slice(0, Number(s.slots));
  const byDay = {}, order = [];
  chosen.forEach(w => {
    const k = fmt(w[0], 'yyyy-MM-dd');
    if (!byDay[k]) { byDay[k] = []; order.push(k); }
    byDay[k].push(w);
  });
  const t12 = t => fmt(t, 'h:mm') + fmt(t, 'a').toLowerCase(); // e.g. 1:45pm
  return order.map(k => {
    const ws = byDay[k];
    return fmt(ws[0][0], 'EEE d MMM') + ': ' + ws.map(w => t12(w[0]) + '-' + t12(w[1])).join(', ') +
      ' ' + fmt(ws[0][0], 'z');
  });
}

/* ---------- Groq with key rotation, retry and fallback model ---------- */
function groqOnce(key, model, messages, url) {
  const isOpenAI = /api\.openai\.com/.test(url);
  const body = { model: model, messages: messages };
  if (isOpenAI) { body.max_completion_tokens = 2500; body.reasoning_effort = 'low'; }
  else { body.temperature = 0.5; body.max_tokens = 1500; if (/gpt-oss/.test(model)) body.reasoning_effort = 'low'; }
  const send = () => UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + key }, payload: JSON.stringify(body)
  });
  let r = send();
  if (r.getResponseCode() === 400 && body.reasoning_effort && /reasoning/i.test(r.getContentText())) {
    delete body.reasoning_effort; r = send(); // model rejected the option, retry without it
  }
  const code = r.getResponseCode(), txt = r.getContentText();
  if (code === 200) {
    const out = (JSON.parse(txt).choices[0].message.content || '').trim();
    return out ? { ok: true, text: out } : { ok: false, code: 0, msg: 'empty answer' };
  }
  let msg = txt.slice(0, 200);
  try { msg = JSON.parse(txt).error.message; } catch (x) { }
  return { ok: false, code: code, msg: msg };
}

function callGroq(messages, s) {
  const keys = getKeys();
  if (!keys.length) throw new Error('Add an API key in Settings > API keys');
  const start = Number(UP().getProperty('keyIdx') || 0) % keys.length;
  let lastErr = '';
  for (const model of [s.model, s.fallbackModel].filter(Boolean)) {
    for (let round = 0; round < 2; round++) {
      let limited = false;
      for (let k = 0; k < keys.length; k++) {
        const idx = (start + k) % keys.length;
        const r = groqOnce(keys[idx], model, messages, s.apiUrl);
        if (r.ok) { UP().setProperty('keyIdx', String(idx)); return r.text; }
        lastErr = r.code + ' ' + r.msg;
        if (r.code === 429) limited = true;
        else if (r.code !== 401 && r.code !== 403) break; // other error: try next model
      }
      if (!limited) break;
      if (round === 0) Utilities.sleep(4000); // wait, then retry once
    }
  }
  throw new Error('AI request failed (' + lastErr + ')');
}