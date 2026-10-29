# NoorCalendar: plan

A calendar and scheduler inside NoorMD: important days, birthdays, reminders, appointments, and stream schedules.
It works on your computer with no account. Like the benches, it is built in stages, and each stage is released and
tried before the next.

## Decisions (from the conversation)

- **Reminders while NoorMD runs.** An in-app reminder card. When the window is minimized or behind other windows,
  there is also a small pop-up near the clock and a taskbar flash. On start, NoorMD shows what was missed while it
  was closed. Reminders while NoorMD is closed (a small helper that starts with Windows) may come later, as an
  option.
- **NoorMD's own calendar**, kept in the local data folder, plus **.ics import and export** (the standard file
  every calendar app reads). It is a file you pick each time, not a sync. Live sync with Google or Outlook is not
  planned (it would need accounts); if it ever comes, it is optional.
- **A general calendar** for whatever matters: birthdays, appointments, deadlines, reminders, plans. Stream
  schedules are one use among many: a stream is an entry with a game and a platform, and it can feed the Stream
  Desk.

## Principles

- **One engine for every view.** Repeats, ages and reminders are worked out in C# (`NoorMD.Core/Calendar`) and
  tested there; the page draws what the engine gives it.
- **Local time, plainly.** Times are kept as wall-clock times ("19:00 every Friday" stays 19:00 across daylight
  saving changes). Birthdays and all-day days have no time at all.
- **Nothing is lost:** saved atomically, with a backup of the previous file; deleting an entry can be undone.

## Stage 1 — the calendar (preview.52, done)

- **Entries:** a title, notes, all-day or a start and end time, several days, a colour and a category (important,
  birthday, appointment, reminder, stream, or your own).
- **Repeats:**
  - daily, weekly on chosen days, every N days, weeks, months or years;
  - monthly on a day of the month, or on "the 2nd Tuesday" or "the last Friday";
  - yearly (a birthday on 29 February falls on 28 February in other years);
  - until a date or for a number of times;
  - skipping single days, and moving a single occurrence.
- **Birthdays and anniversaries:** with the year they started, they show the age ("turns 30", "10 years").
- **Reminders:** any number per entry (at the start, minutes, hours or days before, or "on the day at 9:00"), with
  snooze (5 or 15 minutes, 1 hour, tomorrow) and dismiss.
- **Views:**
  - month;
  - week, with times;
  - agenda (the coming days and weeks);
  - a "today and next" strip;
  - search.
- **Panel:** docks like the other benches (side or middle), Ctrl+Alt+C, a Tools menu entry.
- **.ics:** import and export, with repeats, skipped days and reminders. What cannot be imported exactly is
  imported as near as possible and listed.

## Stage 2 — notes, holidays and streams (done: preview.80)

- **Stream entries:** title, category or game (any kind of stream, not only games), platform, and a short description.
- **Stream Desk:**
  - a "Next stream" and a "This week" overlay for OBS (served on the loopback overlay server like Now Playing,
    live-updating);
  - the schedule copied as text for Discord, X and other social sites;
  - the week's schedule as a picture (PNG) to post.
- **Notes:** link an entry to a note (and open it), "Add to calendar" from a date in a note, and an agenda block
  that can be inserted into a note.
- **Public holidays** for a chosen country, worked out by rules (no download), shown as all-day days.

Done in preview.80: everything above except "Add to calendar" from a date in a note, which is still to come. 18
countries have holidays (Easter-based ones by the Gregorian computus; UK, Irish, Australian and New Zealand
substitute days; US observed days). The Discord text uses Discord's own time stamps, so each reader sees their own
time; the X text stays within 280 characters. The overlays are `next-stream.html` and `schedule.html`.

## Days off — a vacation planner (preview.82)

- Choose days by dragging across the month (or Shift+click, or Shift+click in the week's header), then **🌴 Day off**
  (or O): they become one all-day "Holiday / day off" entry ("Vacation" for several days, "Day off" for one).
- Days off — and public holidays — tint the whole day cell (the month, and the week's header, all-day row and
  column) in the entry's colour.
- On days that are all off the button reads **Not off**: vacations inside the range go, ones across its edges are cut,
  one around it is split in two, and a repeating day off skips those days.
- The bar above the month says how many days and work days are chosen, and how many work days the year's days off
  take (Monday to Friday, public holidays of the chosen country not counted).

## Later (only if use asks)

- Reminders while NoorMD is closed (an optional helper that starts with Windows).
- Several calendars to show and hide, keeping a calendar in a Vault, and a year view.
- Live sync with online calendars (optional, with an account).
