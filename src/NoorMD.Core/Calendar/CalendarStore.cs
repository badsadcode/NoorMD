using System.Text;
using System.Text.Json;
using NoorMD.Core.Documents;

namespace NoorMD.Core.Calendar;

/// <summary>
/// The calendar on disk: calendar.json (saved crash-safely, with the previous version kept as calendar.json.bak) and
/// reminders.json (when reminders were last looked at, and which are snoozed until when). A damaged file is set aside
/// and the backup is used, so a bad write never loses the calendar.
/// </summary>
public sealed class CalendarStore
{
    private readonly string _folder;
    private readonly object _gate = new();
    private List<CalendarEntry> _entries = [];
    private ReminderState _state = new();

    public sealed class ReminderState
    {
        /// <summary>Reminders up to this moment have been shown (local time, yyyy-MM-ddTHH:mm:ss).</summary>
        public string? LastCheck { get; set; }
        /// <summary>Reminder key → when to show it again (local time).</summary>
        public Dictionary<string, string> Snoozed { get; set; } = [];
    }

    public CalendarStore(string folder)
    {
        _folder = folder;
        Directory.CreateDirectory(folder);
        Load();
    }

    public string FilePath => Path.Combine(_folder, "calendar.json");
    private string BackupPath => FilePath + ".bak";
    private string StatePath => Path.Combine(_folder, "reminders.json");
    /// <summary>Set when the file couldn't be read at start (and what was done about it), to tell the user once.</summary>
    public string? LoadProblem { get; private set; }

    public IReadOnlyList<CalendarEntry> Entries { get { lock (_gate) return [.. _entries]; } }

    private void Load()
    {
        lock (_gate)
        {
            _entries = Read(FilePath, out var problem) ?? [];
            if (problem != null)
            {
                // Keep the damaged file aside and fall back to the last good one.
                try { File.Copy(FilePath, FilePath + $".damaged-{DateTime.Now:yyyyMMdd-HHmmss}", overwrite: false); } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
                var backup = Read(BackupPath, out var backupProblem);
                _entries = backup ?? [];
                LoadProblem = backup != null ? "The calendar file was damaged; its previous version was used (the damaged one was kept beside it)."
                    : "The calendar file was damaged and no backup could be read; it was kept beside the new calendar.";
            }
            try
            {
                _state = File.Exists(StatePath) ? JsonSerializer.Deserialize<ReminderState>(File.ReadAllText(StatePath), new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }) ?? new() : new();
            }
            catch (Exception ex) when (ex is JsonException or IOException) { _state = new(); }
        }
    }

    private static List<CalendarEntry>? Read(string path, out string? problem)
    {
        problem = null;
        if (!File.Exists(path)) return null;
        try
        {
            var file = CalendarFile.FromJson(File.ReadAllText(path));
            return file.Entries.Where(e => e != null).Take(CalendarCheck.MaxEntries).Select(CalendarCheck.Clamped).GroupBy(e => e.Id).Select(g => g.First()).ToList();
        }
        catch (Exception ex) when (ex is JsonException or IOException or NotSupportedException) { problem = ex.Message; return null; }
    }

    private void Save()
    {
        var json = new CalendarFile { Entries = _entries }.ToJson();
        AtomicFile.WriteAllBytes(FilePath, new UTF8Encoding(false).GetBytes(json), BackupPath);
    }

    /// <summary>Adds or replaces an entry (by id); returns it as kept.</summary>
    public CalendarEntry Upsert(CalendarEntry entry)
    {
        lock (_gate)
        {
            var e = CalendarCheck.Clamped(entry);
            e.Updated = CalendarTime.Time(DateTime.Now);
            var at = _entries.FindIndex(x => x.Id == e.Id);
            if (at >= 0) _entries[at] = e;
            else
            {
                if (_entries.Count >= CalendarCheck.MaxEntries) throw new InvalidOperationException("The calendar is full (20,000 entries).");
                _entries.Add(e);
            }
            Save();
            return e;
        }
    }

    /// <summary>Removes an entry; returns it (to undo), or null.</summary>
    public CalendarEntry? Delete(string id)
    {
        lock (_gate)
        {
            var at = _entries.FindIndex(x => x.Id == id);
            if (at < 0) return null;
            var e = _entries[at];
            _entries.RemoveAt(at);
            Save();
            return e;
        }
    }

    /// <summary>Adds imported entries (each with a new id); returns how many.</summary>
    public int AddMany(IEnumerable<CalendarEntry> entries)
    {
        lock (_gate)
        {
            var n = 0;
            foreach (var entry in entries)
            {
                if (_entries.Count >= CalendarCheck.MaxEntries) break;
                var e = CalendarCheck.Clamped(entry);
                while (_entries.Any(x => x.Id == e.Id)) e.Id = CalendarCheck.NewId();
                e.Updated = CalendarTime.Time(DateTime.Now);
                _entries.Add(e);
                n++;
            }
            if (n > 0) Save();
            return n;
        }
    }

    // ------------------------------------------------------------------ reminders

    /// <summary>
    /// The reminders due now: those since the last look (at most a week back, so a long absence doesn't bury you), and
    /// snoozed ones whose time has come. Marks them as shown.
    /// </summary>
    public List<CalendarReminder> TakeDue(DateTime now)
    {
        lock (_gate)
        {
            var since = DateTime.TryParse(_state.LastCheck, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var last) ? last : now.AddMinutes(-1);
            if (since > now) since = now.AddMinutes(-1);
            if (since < now.AddDays(-7)) since = now.AddDays(-7);
            var due = CalendarEngine.Due(_entries, since, now);
            // Snoozed: back when their time comes; meanwhile not shown (even if their window passes again).
            var back = new List<CalendarReminder>();
            foreach (var (key, until) in _state.Snoozed.ToList())
            {
                if (!DateTime.TryParse(until, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var u)) { _state.Snoozed.Remove(key); continue; }
                if (u > now) { due.RemoveAll(d => d.Key == key); continue; }
                _state.Snoozed.Remove(key);
                if (due.Any(d => d.Key == key)) continue;
                var parts = key.Split('|');
                var e = _entries.FirstOrDefault(x => x.Id == parts[0]);
                if (e == null || parts.Length != 3 || !CalendarTime.TryDay(parts[1], out var day) || !int.TryParse(parts[2], out var m)) continue;
                var occ = CalendarEngine.Occurrences(e, day.AddDays(-1), day.AddDays(2)).FirstOrDefault(o => o.Date == parts[1]);
                if (occ != null) back.Add(new CalendarReminder(key, e.Id, occ, m, u));
            }
            _state.LastCheck = now.ToString("yyyy-MM-dd'T'HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture);
            SaveState();
            return [.. due.Concat(back).OrderBy(d => d.At)];
        }
    }

    public void Snooze(string key, DateTime until)
    {
        lock (_gate)
        {
            _state.Snoozed[key] = until.ToString("yyyy-MM-dd'T'HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture);
            // Old snoozes are forgotten.
            foreach (var k in _state.Snoozed.Where(kv => DateTime.TryParse(kv.Value, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var t) && t < DateTime.Now.AddDays(-30)).Select(kv => kv.Key).ToList())
                _state.Snoozed.Remove(k);
            SaveState();
        }
    }

    /// <summary>The next moment a reminder (or a snooze) is due, to know when to look again.</summary>
    public DateTime? Next(DateTime now)
    {
        lock (_gate)
        {
            var next = CalendarEngine.NextReminder(_entries, now, TimeSpan.FromDays(8));
            foreach (var v in _state.Snoozed.Values)
                if (DateTime.TryParse(v, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var t) && t > now && (next == null || t < next)) next = t;
            return next;
        }
    }

    private void SaveState()
    {
        try { AtomicFile.WriteAllText(StatePath, JsonSerializer.Serialize(_state, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* reminders may repeat once; nothing is lost */ }
    }
}
