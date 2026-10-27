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
    private static readonly string[] Blocked = ["javascript", "vbscript", "data", "file", "about", "ms-msdt", "search-ms", "search", "ms-officecmd", "shell", "ms-appinstaller", "ms-word", "ms-excel", "ms-powerpoint", "hcp", "its", "mk", "res"];
    /// <summary>Websites, mail and the game/chat launchers people add; any other scheme needs your OK when it is added.</summary>
    private static readonly string[] Known = ["http", "https", "mailto", "steam", "com.epicgames.launcher", "discord", "spotify", "battlenet", "uplay", "origin", "origin2", "goggalaxy", "itch", "obsproject", "twitch", "zoommtg", "msteams", "slack", "tg", "whatsapp"];

    /// <summary>A launcher scheme NoorMD doesn't know: it starts some program, so you are asked before it is added.</summary>
    public static bool NeedsConsent(string url) =>
        Uri.TryCreate(url.Trim(), UriKind.Absolute, out var u) && !Known.Contains(u.Scheme, StringComparer.OrdinalIgnoreCase);

    public const int MaxCategories = 60;

    private readonly string _file;
    private readonly List<HubItem> _items = [];
    private readonly List<string> _categories = [];

    private sealed record HubFile(List<HubItem>? Items, List<string>? Categories, string? View);

    public AppsHub(string folder)
    {
        Folder = folder;
        IconsFolder = Path.Combine(folder, "icons");
        _file = Path.Combine(folder, "apps.json");
        if (File.Exists(_file))
        {
            try
            {
                var text = File.ReadAllText(_file);
                if (text.TrimStart().StartsWith('[')) _items.AddRange(JsonSerializer.Deserialize<List<HubItem>>(text, Json) ?? []); // the first format: just the items
                else if (JsonSerializer.Deserialize<HubFile>(text, Json) is { } f)
                {
                    _items.AddRange(f.Items ?? []);
                    _categories.AddRange((f.Categories ?? []).Select(c => CleanGroup(c)).Distinct(StringComparer.CurrentCultureIgnoreCase).Take(MaxCategories));
                    View = CleanView(f.View);
                }
            }
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

    /// <summary>The categories in your order (also empty ones you made), then any others the shortcuts use.</summary>
    public IReadOnlyList<string> Groups() => _categories.Concat(_items.Select(i => i.Group)).Distinct(StringComparer.CurrentCultureIgnoreCase).ToList();

    /// <summary>What the hub shows: "all", "recent" or "group:Name". Remembered between runs.</summary>
    public string View { get; private set; } = "all";

    public void SetView(string? view) { View = CleanView(view); Save(); }

    public string AddCategory(string? name)
    {
        var n = CleanGroup(name, required: true);
        var existing = Groups().FirstOrDefault(g => string.Equals(g, n, StringComparison.CurrentCultureIgnoreCase));
        if (existing != null) { KeepOrder(); if (!_categories.Contains(existing)) _categories.Add(existing); Save(); return existing; }
        if (Groups().Count >= MaxCategories) throw new InvalidOperationException($"The hub holds up to {MaxCategories} categories.");
        KeepOrder();
        _categories.Add(n);
        Save();
        return n;
    }

    /// <summary>Renames a category and moves its shortcuts along. Renaming to an existing category merges the two.</summary>
    public string RenameCategory(string from, string? to)
    {
        var n = CleanGroup(to, required: true);
        var groups = Groups();
        var old = groups.FirstOrDefault(g => string.Equals(g, from, StringComparison.CurrentCultureIgnoreCase)) ?? throw new ArgumentException("That category is no longer in the hub.");
        var target = groups.FirstOrDefault(g => !string.Equals(g, old, StringComparison.CurrentCultureIgnoreCase) && string.Equals(g, n, StringComparison.CurrentCultureIgnoreCase)) ?? n;
        KeepOrder();
        var at = _categories.FindIndex(g => string.Equals(g, old, StringComparison.CurrentCultureIgnoreCase));
        if (_categories.Any(g => string.Equals(g, target, StringComparison.CurrentCultureIgnoreCase) && !string.Equals(g, old, StringComparison.CurrentCultureIgnoreCase))) _categories.RemoveAt(at);
        else _categories[at] = target;
        for (var i = 0; i < _items.Count; i++)
            if (string.Equals(_items[i].Group, old, StringComparison.CurrentCultureIgnoreCase)) _items[i] = _items[i] with { Group = target };
        if (View == "group:" + old) View = "group:" + target;
        Save();
        return target;
    }

    /// <summary>Removes a category; its shortcuts move to another one (they are never removed with it).</summary>
    public void RemoveCategory(string name, string? moveTo)
    {
        var dest = CleanGroup(moveTo);
        if (string.Equals(dest, name, StringComparison.CurrentCultureIgnoreCase)) throw new ArgumentException("Choose another category for its shortcuts.");
        KeepOrder();
        _categories.RemoveAll(g => string.Equals(g, name, StringComparison.CurrentCultureIgnoreCase));
        for (var i = 0; i < _items.Count; i++)
            if (string.Equals(_items[i].Group, name, StringComparison.CurrentCultureIgnoreCase)) _items[i] = _items[i] with { Group = dest };
        if (!_categories.Contains(dest, StringComparer.CurrentCultureIgnoreCase) && _items.Any(i => i.Group == dest)) _categories.Add(dest);
        if (string.Equals(View, "group:" + name, StringComparison.CurrentCultureIgnoreCase)) View = "all";
        Save();
    }

    /// <summary>Moves a category one place earlier (-1) or later (+1).</summary>
    public void MoveCategory(string name, int by)
    {
        KeepOrder();
        var i = _categories.FindIndex(g => string.Equals(g, name, StringComparison.CurrentCultureIgnoreCase));
        if (i < 0) throw new ArgumentException("That category is no longer in the hub.");
        var j = Math.Clamp(i + Math.Sign(by), 0, _categories.Count - 1);
        if (i == j) return;
        (_categories[i], _categories[j]) = (_categories[j], _categories[i]);
        Save();
    }

    /// <summary>Makes the current order explicit, so a change to one category keeps where the others are.</summary>
    private void KeepOrder()
    {
        var all = Groups();
        _categories.Clear();
        _categories.AddRange(all);
    }

    private string CleanView(string? v) => v switch
    {
        "recent" => "recent",
        { } g when g.StartsWith("group:", StringComparison.Ordinal) && g.Length > 6 => "group:" + CleanGroup(g[6..]),
        _ => "all",
    };

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

    private static string CleanGroup(string? g, bool required = false)
    {
        var t = new string((g ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (t.Length == 0 && required) throw new ArgumentException("Give the category a name.");
        return t.Length == 0 ? "Apps" : t.Length > 40 ? t[..40].TrimEnd() : t;
    }

    private void Save()
    {
        Directory.CreateDirectory(Folder);
        AtomicFile.WriteAllText(_file, JsonSerializer.Serialize(new HubFile(_items, _categories, View), Json));
    }

    private static void TryDelete(string path) { try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
}
