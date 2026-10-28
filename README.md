# MDBList → Google Calendar

A free Google Apps Script that turns an [MDBList](https://mdblist.com) list into a calendar feed with release dates. Movies get one event on their release date; shows get one event per season premiere. Titles you add to the list show up in your calendar automatically.

## How it works

The script reads a list from MDBList through its free API, looks up release and season dates, and serves everything as an iCal (`.ics`) feed that Google Calendar, Apple Calendar and Outlook can subscribe to.

```
MDBList list (free) → Apps Script (free) → .ics URL → your calendar
```

Want to use your IMDb watchlist? IMDb has no public API and blocks automated access, so it can't be read directly. Import it into MDBList as an external list instead, and the script reads it from there (whether MDBList accepts a watchlist link is unverified).

## Setup

1. **MDBList:** create a free account at [mdblist.com](https://mdblist.com) and create a list (or add an external list such as a public IMDb list). Note the list path from its URL (`mdblist.com/lists/USERNAME/LISTNAME`). Copy your API key from *Preferences → API Access*.
2. **Script:** go to [script.google.com](https://script.google.com), create a new project, and paste in the contents of `imdb_mdblist_calendar.gs`.
3. **Config:** fill in `MDBLIST_KEY` and `MDBLIST_LIST` at the top of the file.
4. **Test:** run `testLocal()` (authorize when asked) and check *View → Execution log* for your titles and dates.
5. **Auto-refresh:** run `setupTrigger()` once. It refreshes dates every 6 hours.
6. **Deploy:** *Deploy → New deployment → Web app*, set *Execute as: Me* and *Who has access: Anyone*, then copy the web app URL.
7. **Subscribe:** in Google Calendar, *Other calendars → + → From URL*, and paste the URL.

## Options

| Setting | Default | Meaning |
|---|---|---|
| `ONLY_UPCOMING` | `false` | `true` hides dates already in the past |
| `CALENDAR_NAME` | `IMDb Watchlist` | Name shown in your calendar |
| `MAX_LOOKUPS_PER_REQUEST` | `40` | Titles looked up per feed request; the trigger covers the rest |

## Helper functions

- `report()` lists titles from your list that have no date yet
- `clearCache()` wipes saved lookups so everything is fetched again

## Limits

- The free MDBList key allows 1,000 requests a day. Each show costs one request and results are cached for 2 days, so lists of a few hundred titles are fine.
- External lists (IMDb, Trakt, etc.) on MDBList refresh only periodically, so new titles may take hours or days to appear.
- Titles with no exact release date are left out of the calendar.
- Google Calendar refreshes subscribed feeds slowly, often several hours.
- An external IMDb list must be public for MDBList to read it.
- Anyone with your web app URL can see your list's titles and dates, so don't share it publicly. Keep your API key out of public repos.

## License

MIT
