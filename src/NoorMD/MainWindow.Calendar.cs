using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Calendar;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// NoorCalendar: the calendar kept in the local data folder (see <see cref="CalendarStore"/>), its occurrences worked
/// out here for the page to draw, .ics import and export, and reminders: looked at every half minute while NoorMD runs,
/// shown in the app, and near the clock (with a taskbar flash) when NoorMD is minimized or behind other windows. On
/// start, what came due while NoorMD was closed (up to a week) is shown.
/// </summary>
public partial class MainWindow
{
    private CalendarStore? _calendar;
    private CalendarStore Calendar => _calendar ??= new CalendarStore(Path.Combine(App.Paths.Local, "Calendar"));
    private DispatcherTimer? _calendarTimer;
    private ReminderWindow? _reminderWindow;

    private void StartCalendarReminders()
    {
        _calendarTimer ??= new DispatcherTimer(TimeSpan.FromSeconds(30), DispatcherPriority.Background, (_, _) => CheckReminders(), Dispatcher);
        _calendarTimer.Start();
        // A moment after start, so the page is ready to show what was missed.
        var first = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        first.Tick += (_, _) => { first.Stop(); CheckReminders(); };
        first.Start();
    }

    private static object OccurrenceForPage(CalendarOccurrence o) => new
    {
        entryId = o.EntryId, date = o.Date, start = CalendarTime.Time(o.Start), end = CalendarTime.Time(o.End), allDay = o.AllDay, age = o.Age, moved = o.Moved,
    };

    private static object ReminderForPage(CalendarReminder r, CalendarEntry? e) => new
    {
        key = r.Key, entryId = r.EntryId, minutes = r.Minutes, at = CalendarTime.Time(r.At), occurrence = OccurrenceForPage(r.Occurrence),
        title = e?.Title ?? "", category = e?.Category ?? "other", age = r.Occurrence.Age,
    };

    /// <summary>"Today 19:00", "Tomorrow", "Fri 6 Nov 19:00" — for the pop-up near the clock.</summary>
    private static string WhenText(CalendarOccurrence o)
    {
        var today = DateTime.Today;
        var day = o.Start.Date == today ? "Today" : o.Start.Date == today.AddDays(1) ? "Tomorrow" : o.Start.Date == today.AddDays(-1) ? "Yesterday"
            : o.Start.ToString("ddd d MMM", System.Globalization.CultureInfo.CurrentCulture);
        return o.AllDay ? day : $"{day} {o.Start.ToString("t", System.Globalization.CultureInfo.CurrentCulture)}";
    }

    private void CheckReminders()
    {
        List<CalendarReminder> due;
        try { due = Calendar.TakeDue(DateTime.Now); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { Log.Error("Calendar reminders", ex); return; }
        if (due.Count == 0) return;
        var entries = Calendar.Entries.ToDictionary(e => e.Id);
        PushEvent("cal.reminders", new { reminders = due.Select(r => ReminderForPage(r, entries.GetValueOrDefault(r.EntryId))) });
        // Not in front: near the clock too, and the taskbar button flashes.
        if (WindowState == WindowState.Minimized || !IsActive)
        {
            _reminderWindow ??= new ReminderWindow(this);
            _reminderWindow.Add(due.Select(r =>
            {
                var e = entries.GetValueOrDefault(r.EntryId);
                var title = e == null ? "Reminder" : e.Category == "birthday" && r.Occurrence.Age is int age ? $"{e.Title} ({age})" : e.Title;
                return new ReminderWindow.Item(r.Key, title, WhenText(r.Occurrence), e?.Notes is { Length: > 0 } n ? (n.Length > 120 ? n[..120] + "…" : n) : "");
            }));
            Flash();
        }
    }

    private void Flash()
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;
        var info = new FLASHWINFO { cbSize = (uint)Marshal.SizeOf<FLASHWINFO>(), hwnd = hwnd, dwFlags = 0x3 | 0xC /* all, until in front */, uCount = 5, dwTimeout = 0 };
        FlashWindowEx(ref info);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }
    [DllImport("user32.dll")] private static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    /// <summary>From the pop-up: NoorMD comes to the front with the calendar at that entry.</summary>
    internal void CalendarOpenFromReminder(string key)
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        var parts = key.Split('|');
        PushEvent("cal.open", new { entryId = parts[0], date = parts.Length > 1 ? parts[1] : null, dismiss = key });
    }

    internal void CalendarSnooze(string key, TimeSpan delay)
    {
        Calendar.Snooze(key, DateTime.Now + delay);
        PushEvent("cal.handled", new { key });
    }

    internal void CalendarDismiss(string key) => PushEvent("cal.handled", new { key });

    private static CalendarEntry EntryFrom(JsonElement p)
    {
        if (!p.TryGetProperty("entry", out var e) || e.ValueKind != JsonValueKind.Object) throw new BridgeError("Missing the entry.");
        var raw = e.GetRawText();
        if (raw.Length > 100_000) throw new BridgeError("That entry is too big.");
        try { return CalendarFile.EntryFromJson(raw); }
        catch (JsonException ex) { throw new BridgeError("The entry can't be read: " + ex.Message); }
    }

    private static DateTime DayFrom(BridgeRequest req, string key)
    {
        var s = req.GetString(key, 20);
        return CalendarTime.TryTime(s, out var t) ? t : throw new BridgeError($"Missing or unreadable {key}.");
    }

    private async Task<object?> DispatchCalendarAsync(BridgeRequest req)
    {
        var p = req.Payload;
        switch (req.Type)
        {
            case "cal.entries":
                return new { entries = Calendar.Entries, problem = Calendar.LoadProblem, now = CalendarTime.Time(DateTime.Now), categories = CalendarEntry.Categories };
            case "cal.range":
            {
                var from = DayFrom(req, "from");
                var to = DayFrom(req, "to");
                if (to <= from || (to - from).TotalDays > 800) throw new BridgeError("That range of days is too long.");
                var occ = await Task.Run(() => CalendarEngine.Occurrences(Calendar.Entries, from, to));
                return new { occurrences = occ.Take(20_000).Select(OccurrenceForPage) };
            }
            case "cal.save":
                try { return new { entry = Calendar.Upsert(EntryFrom(p)) }; }
                catch (InvalidOperationException ex) { throw new BridgeError(ex.Message); }
            case "cal.delete":
                return new { entry = Calendar.Delete(req.GetString("id", 40) ?? "") };
            case "cal.snooze":
            {
                var key = req.GetString("key", 120) ?? throw new BridgeError("Missing the reminder.");
                var minutes = Math.Clamp(Json.OptDouble(p, "minutes") ?? 15, 1, 60 * 24 * 7);
                Calendar.Snooze(key, DateTime.Now.AddMinutes(minutes));
                _reminderWindow?.Remove(key);
                return null;
            }
            case "cal.dismiss":
                _reminderWindow?.Remove(req.GetString("key", 120) ?? "");
                return null;
            case "cal.import":
            {
                var dlg = new OpenFileDialog { Title = "Import a calendar (.ics)", Filter = "Calendar files (*.ics)|*.ics|All files (*.*)|*.*", CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                if (new FileInfo(dlg.FileName).Length > 20 * 1024 * 1024) throw new BridgeError("That file is too big for a calendar (over 20 MB).");
                var text = await File.ReadAllTextAsync(dlg.FileName);
                if (!text.Contains("BEGIN:VCALENDAR", StringComparison.OrdinalIgnoreCase)) throw new BridgeError("That isn't a calendar file (.ics).");
                var result = await Task.Run(() => Ics.Import(text));
                if (result.Entries.Count == 0) return new { added = 0, notes = result.Notes, file = Path.GetFileName(dlg.FileName) };
                var choice = ThemedDialog.Show(this, $"Import {result.Entries.Count} entr{(result.Entries.Count == 1 ? "y" : "ies")}?",
                    $"From {Path.GetFileName(dlg.FileName)}. They are added to your calendar (nothing in it is changed or removed).",
                    [new DialogButton("Cancel", "cancel", Cancel: true), new DialogButton("Import", "import", Primary: true)]);
                if (choice != "import") return new { cancelled = true };
                var added = Calendar.AddMany(result.Entries);
                Log.Info($"Calendar: imported {added} entries from an .ics file");
                return new { added, notes = result.Notes, file = Path.GetFileName(dlg.FileName), entries = Calendar.Entries };
            }
            case "cal.export":
            {
                // All entries, or the ones given (e.g. one category).
                var ids = p.TryGetProperty("ids", out var idsEl) && idsEl.ValueKind == JsonValueKind.Array
                    ? idsEl.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToHashSet(StringComparer.Ordinal) : null;
                var list = Calendar.Entries.Where(e => ids == null || ids.Contains(e.Id)).ToList();
                if (list.Count == 0) throw new BridgeError("There is nothing to export.");
                var name = req.GetString("name", 80) is { Length: > 0 } n ? n : "NoorMD calendar";
                var dlg = new SaveFileDialog { Title = "Export the calendar (.ics)", Filter = "Calendar file (*.ics)|*.ics", DefaultExt = ".ics", FileName = NoorMD.Core.Documents.DocumentFile.SafeFileName(name, ".ics"), OverwritePrompt = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                await File.WriteAllTextAsync(dlg.FileName, Ics.Export(list, name), new UTF8Encoding(false));
                return new { path = dlg.FileName, count = list.Count };
            }
            default: throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }
}
