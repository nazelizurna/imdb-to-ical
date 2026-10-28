/**
 * IMDb watchlist -> Google Calendar feed (MDBList only, no other service needed)
 *
 * MDBList holds a synced copy of your IMDb watchlist and also knows release dates:
 *   - movies: release date
 *   - shows:  premiere date of EVERY season (one calendar event per season)
 *
 * SETUP
 * 1. Fill in CONFIG below (MDBList key + list path "username/listname").
 * 2. Run testLocal() once (authorize when asked) and read View > Execution log.
 * 3. Run setupTrigger() once. It refreshes dates every 6 hours in the background.
 * 4. Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
 *    The web app URL is your calendar feed: Google Calendar > Other calendars >
 *    From URL > paste it.
 *
 * After you change the code, use Deploy > Manage deployments > edit > New version.
 */

const CONFIG = {
  MDBLIST_KEY: 'PASTE_MDBLIST_KEY',
  MDBLIST_LIST: 'username/listname',   // from mdblist.com/lists/username/listname
  CALENDAR_NAME: 'IMDb Watchlist',
  ONLY_UPCOMING: false,                // false = also include dates already in the past
  MAX_LOOKUPS_PER_REQUEST: 40,         // new titles looked up per feed request (the trigger does the rest)
};

const DAY_MS = 24 * 60 * 60 * 1000;
const API = 'https://api.mdblist.com';

function doGet() {
  return ContentService.createTextOutput(buildIcs_(getEvents_(CONFIG.MAX_LOOKUPS_PER_REQUEST)))
    .setMimeType(ContentService.MimeType.ICAL);
}

/** Called by the time trigger: looks up every title that needs it. */
function refresh() {
  getEvents_(1000);
}

/** Run once: creates a trigger that runs refresh() every 6 hours. */
function setupTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'refresh').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('refresh').timeBased().everyHours(6).create();
  refresh();
  Logger.log('Trigger created and first refresh done.');
}

/** Run from the editor to test and see what came back. */
function testLocal() {
  const events = getEvents_(1000);
  Logger.log('Calendar events: ' + events.length);
  events.slice(0, 15).forEach(e => Logger.log(e.date + '  ' + e.title));
}

/** Shows which titles from your list have NO date (so are not in the calendar). */
function report() {
  const items = getListItems_();
  const events = getEvents_(1000);
  const have = {};
  events.forEach(e => { have[e.imdb] = true; });
  const missing = items.filter(i => !have[i.imdb]);
  Logger.log('On list: ' + items.length + ' | In calendar: ' + (items.length - missing.length) +
    ' | No date: ' + missing.length);
  if (missing.length) Logger.log('No date: ' + missing.map(i => i.title).join(', '));
}

/** Wipes saved lookups so everything is fetched again. */
function clearCache() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).filter(k => /^(i|d)_/.test(k)).forEach(k => props.deleteProperty(k));
  Logger.log('Cache cleared.');
}

// ---------- MDBList ----------

function getListItems_() {
  const res = UrlFetchApp.fetch(API + '/lists/' + CONFIG.MDBLIST_LIST + '/items?limit=1000&apikey=' +
    encodeURIComponent(CONFIG.MDBLIST_KEY), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('MDBList returned HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
  const data = JSON.parse(res.getContentText());
  const items = [];
  const add = (arr, type) => (arr || []).forEach(it => {
    const imdb = it.imdb_id || (it.ids && it.ids.imdb) || '';
    if (!/^tt\d+$/.test(imdb)) return;
    items.push({
      imdb: imdb,
      type: type,
      title: it.title || imdb,
      year: it.release_year || '',
      date: (it.release_date || '').slice(0, 10),
    });
  });
  add(data.movies, 'movie');
  add(data.shows, 'show');
  return items;
}

/** One request per title: seasons (shows) or release date (movies). */
function fetchInfo_(it) {
  const res = UrlFetchApp.fetch(API + '/imdb/' + it.type + '/' + it.imdb + '?apikey=' +
    encodeURIComponent(CONFIG.MDBLIST_KEY), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    Logger.log('MDBList info error for ' + it.title + ': HTTP ' + res.getResponseCode());
    return null;   // not cached, retried next time
  }
  const j = JSON.parse(res.getContentText());
  const seasons = [];
  (j.seasons || []).forEach(s => {
    const m = /season\s+(\d+)/i.exec(s.name || '');
    const d = String(s.air_date || '').slice(0, 10);
    if (m && d) seasons.push({ n: +m[1], d: d });
  });
  const released = String(j.released || '').slice(0, 10);
  if (it.type === 'show' && !seasons.length && released) seasons.push({ n: 1, d: released });
  return { ts: Date.now(), s: seasons, d: released };
}

// ---------- Build events (cached in script properties) ----------

function getEvents_(maxLookups) {
  const items = getListItems_();
  const props = PropertiesService.getScriptProperties();
  const store = props.getProperties();
  const started = Date.now();
  let lookups = 0;
  const events = [];

  items.forEach(it => {
    const label = it.title + (it.year ? ' (' + it.year + ')' : '');

    // Movies with a date in the list response need no extra request.
    if (it.type === 'movie' && it.date) {
      events.push({ uid: it.imdb, imdb: it.imdb, title: label, date: it.date });
      return;
    }

    const key = 'i_' + it.imdb;
    let c = store[key] ? JSON.parse(store[key]) : null;
    const stale = !c || (Date.now() - c.ts > 2 * DAY_MS);
    if (stale && lookups < maxLookups && Date.now() - started < 4.5 * 60 * 1000) {
      const fresh = fetchInfo_(it);
      lookups++;
      if (fresh) { c = fresh; props.setProperty(key, JSON.stringify(c)); }
    }
    if (!c) return;

    if (it.type === 'show') {
      c.s.forEach(s => events.push({
        uid: it.imdb + '-s' + s.n, imdb: it.imdb, title: it.title + ' – Season ' + s.n, date: s.d,
      }));
    } else if (c.d) {
      events.push({ uid: it.imdb, imdb: it.imdb, title: label, date: c.d });
    }
  });
  return events;
}

// ---------- iCalendar ----------

function buildIcs_(events) {
  const today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  const stamp = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IMDb Watchlist//Apps Script//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc_(CONFIG.CALENDAR_NAME),
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
  ];

  events.forEach(e => {
    if (CONFIG.ONLY_UPCOMING && e.date < today) return;
    const p = e.date.split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return;
    const start = p[0] + ('0' + p[1]).slice(-2) + ('0' + p[2]).slice(-2);
    const end = Utilities.formatDate(new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1)), 'UTC', 'yyyyMMdd');
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + e.uid + '@imdb-watchlist',
      'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + start,
      'DTEND;VALUE=DATE:' + end,
      'SUMMARY:' + esc_(e.title),
      'DESCRIPTION:' + esc_('https://www.imdb.com/title/' + e.imdb + '/'),
      'URL:https://www.imdb.com/title/' + e.imdb + '/',
      'TRANSP:TRANSPARENT',
      'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold_).join('\r\n') + '\r\n';
}

function esc_(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function fold_(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(' ' + line.slice(i, i + 74));
  return parts.join('\r\n');
}
