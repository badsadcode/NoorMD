using System.Text.Json;
using System.Text.Json.Serialization;
using NoorMD.Core.Documents;

namespace NoorMD.Core.Hub;

public enum HubKind { App, File, Folder, Web }

/// <summary>One shortcut in the Apps Hub: a program, game, file, folder or web address (also launcher links such as steam://).</summary>
public sealed record HubItem
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N")[..12];
    public string Name { get; init; } = "";
    public HubKind Kind { get; init; }
    /// <summary>A full path (App, File, Folder) or an address (Web).</summary>
    public string Target { get; init; } = "";
    public string? Arguments { get; init; }
    public string Group { get; init; } = "Apps";
    /// <summary>File name of the picture in the hub's icons folder (extracted from Windows or chosen by you), or null for a letter tile.</summary>
    public string? Icon { get; init; }
    public string? Color { get; init; }
    public DateTime? LastUsedUtc { get; init; }
    public int Uses { get; init; }
}

/// <summary>
/// The Apps Hub's list of shortcuts, kept as JSON in NoorMD's local data folder (never in a Vault). It only stores
/// what you add; launching happens in the host by id, so a document or web page can never start a program.
/// </summary>
public sealed class AppsHub
{
    public const int MaxItems = 500;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true, Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) } };
    // Address schemes that may never be launched from the hub (they run code or reach into the computer).
    private static readonly string[] Blocked = ["javascript", "vbscript", "data", "file", "about", "ms-msdt", "search-ms", "ms-officecmd", "shell"];

    private readonly string _file;
    private readonly List<HubItem> _items = [];

    public AppsHub(string folder)
    {
        Folder = folder;
        IconsFolder = Path.Combine(folder, "icons");
        _file = Path.Combine(folder, "apps.json");
        if (File.Exists(_file))
        {
            try { _items.AddRange(JsonSerializer.Deserialize<List<HubItem>>(File.ReadAllText(_file), Json) ?? []); }
            catch (JsonException) { File.Copy(_file, _file + ".broken", overwrite: true); }
        }
    }

    public string Folder { get; }
    public string IconsFolder { get; }
    public IReadOnlyList<HubItem> Items => _items;
    public HubItem? Get(string id) => _items.FirstOrDefault(i => i.Id == id);

    /// <summary>Checks a web address: http(s), or a launcher scheme such as steam:// or discord://. Returns a problem or null.</summary>
    public static string? AddressProblem(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return "Enter an address.";
        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var u)) return "That is not a full address (for example https://example.com or steam://rungameid/570).";
        if (Blocked.Contains(u.Scheme, StringComparer.OrdinalIgnoreCase)) return $"“{u.Scheme}:” addresses can't be added to the hub.";
        return null;
    }

    public HubItem Add(HubItem item)
    {
        if (_items.Count >= MaxItems) throw new InvalidOperationException($"The hub holds up to {MaxItems} shortcuts.");
        var name = item.Name.Trim();
        if (name.Length == 0) throw new ArgumentException("Give the shortcut a name.");
        if (item.Kind == HubKind.Web && AddressProblem(item.Target) is { } p) throw new ArgumentException(p);
        if (item.Kind != HubKind.Web && !Path.IsPathFullyQualified(item.Target)) throw new ArgumentException("Choose a program, file or folder.");
        var clean = item with { Name = name.Length > 80 ? name[..80] : name, Target = item.Target.Trim(), Group = CleanGroup(item.Group) };
        _items.Add(clean);
        Save();
        return clean;
    }

    public HubItem Update(string id, string? name, string? group, string? arguments, string? color, string? target = null)
    {
        var i = _items.FindIndex(x => x.Id == id);
        if (i < 0) throw new ArgumentException("That shortcut is no longer in the hub.");
        var old = _items[i];
        if (target != null && old.Kind == HubKind.Web && AddressProblem(target) is { } p) throw new ArgumentException(p);
        var n = old with
        {
            Name = string.IsNullOrWhiteSpace(name) ? old.Name : name.Trim()[..Math.Min(80, name.Trim().Length)],
            Group = group == null ? old.Group : CleanGroup(group),
            Arguments = arguments == null ? old.Arguments : (arguments.Trim().Length == 0 ? null : arguments.Trim()),
            Color = color == null ? old.Color : (System.Text.RegularExpressions.Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$") ? color : null),
            Target = target == null || old.Kind != HubKind.Web ? old.Target : target.Trim(),
        };
        _items[i] = n;
        Save();
        return n;
    }

    public HubItem SetIcon(string id, string? iconFile)
    {
        var i = _items.FindIndex(x => x.Id == id);
        if (i < 0) throw new ArgumentException("That shortcut is no longer in the hub.");
        var old = _items[i].Icon;
        _items[i] = _items[i] with { Icon = iconFile };
        if (old != null && old != iconFile && _items.All(x => x.Icon != old)) TryDelete(Path.Combine(IconsFolder, old));
        Save();
        return _items[i];
    }

    public void Remove(string id)
    {
        var item = Get(id);
        if (item == null) return;
        _items.Remove(item);
        if (item.Icon != null && _items.All(x => x.Icon != item.Icon)) TryDelete(Path.Combine(IconsFolder, item.Icon));
        Save();
    }

    /// <summary>Puts the given ids first, in that order (the rest keep theirs).</summary>
    public void Reorder(IReadOnlyList<string> ids)
    {
        var order = ids.Distinct().Select(Get).Where(x => x != null).Cast<HubItem>().ToList();
        var rest = _items.Where(x => !order.Contains(x)).ToList();
        _items.Clear();
        _items.AddRange(order);
        _items.AddRange(rest);
        Save();
    }

    public HubItem MarkUsed(string id)
    {
        var i = _items.FindIndex(x => x.Id == id);
        if (i < 0) throw new ArgumentException("That shortcut is no longer in the hub.");
        _items[i] = _items[i] with { LastUsedUtc = DateTime.UtcNow, Uses = _items[i].Uses + 1 };
        Save();
        return _items[i];
    }

    public IReadOnlyList<string> Groups() => _items.Select(i => i.Group).Distinct(StringComparer.CurrentCultureIgnoreCase).ToList();

    /// <summary>A sensible kind and name for something chosen or dropped: .exe and .lnk are programs, folders are folders.</summary>
    public static (HubKind Kind, string Name, string Group) Guess(string path)
    {
        if (Directory.Exists(path)) return (HubKind.Folder, Path.GetFileName(Path.TrimEndingDirectorySeparator(path)), "Folders");
        var ext = Path.GetExtension(path).ToLowerInvariant();
        var name = Path.GetFileNameWithoutExtension(path);
        return ext switch
        {
            ".exe" or ".lnk" or ".appref-ms" or ".bat" or ".cmd" => (HubKind.App, name, "Apps"),
            ".url" => (HubKind.App, name, "Games"), // Steam/Epic desktop shortcuts are .url files
            _ => (HubKind.File, name, "Files"),
        };
    }

    private static string CleanGroup(string? g)
    {
        var t = (g ?? "").Trim();
        return t.Length == 0 ? "Apps" : t.Length > 40 ? t[..40] : t;
    }

    private void Save()
    {
        Directory.CreateDirectory(Folder);
        AtomicFile.WriteAllText(_file, JsonSerializer.Serialize(_items, Json));
    }

    private static void TryDelete(string path) { try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
}
