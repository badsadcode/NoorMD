using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Noor.Contracts;

/// <summary>The version of the bench contract. A bench says which one it was built for; the shell loads benches whose
/// version it knows (<see cref="Supported"/>) and reports the others instead of loading them.</summary>
public static class Contract
{
    public const int Version = 1;
    public static readonly IReadOnlySet<int> Supported = new HashSet<int> { 1 };

    /// <summary>The shell hands a bench files the user dropped on the window or opened NoorMD with
    /// (<c>{ "paths": [...] }</c>), matched by the bench's <see cref="BenchManifest.FileTypes"/>. Only the shell sends
    /// commands starting with <c>shell.</c>: a page can't, so a bench can trust these paths as the user's choice.
    /// The bench's page then hears the event <c>shell.open</c> with the same paths.</summary>
    public const string OpenCommand = "shell.open";

    /// <summary>The shell tells every bench that files moved or were renamed (<c>{ "moves": [{ "from", "to" }] }</c>),
    /// so documents open on the old path follow. Only the shell sends it; pages hear the event <c>shell.moved</c>.</summary>
    public const string MovedCommand = "shell.moved";
}

/// <summary>A file (or folder) that moved: its full path before and after.</summary>
public sealed record FileMove(string From, string To);

/// <summary>A bench: its manifest, its web interface (files packed inside its DLL) and its commands (the C# side).</summary>
public interface IBench
{
    BenchManifest Manifest { get; }

    /// <summary>One of the bench's web files (<c>bench.js</c>, a stylesheet, a picture…), or null when there is none by that path.</summary>
    Stream? OpenAsset(string path);

    /// <summary>Runs a command the bench's page (or the shell) asked for. Returns its result (JSON), or throws
    /// <see cref="BenchException"/> with a message the user can read.</summary>
    Task<JsonNode?> HandleAsync(string command, JsonElement args, IBenchHost host, CancellationToken cancel);
}

/// <summary>What the shell offers a bench's C# side.</summary>
public interface IBenchHost
{
    /// <summary>Sends an event to the bench's page (its module gets it through <c>ctx.on(name, …)</c>).</summary>
    void Post(string name, object? payload = null);

    /// <summary>A folder only this bench writes to (its own settings, caches), created on first use.</summary>
    string DataFolder { get; }

    void Log(string message);

    /// <summary>Asks the user to pick files to open (the shell's own dialog, over the shell's window). A bench reads
    /// only files the user picked or named; an empty list means they cancelled.</summary>
    Task<IReadOnlyList<string>> PickFilesAsync(string title, IReadOnlyList<FileFilter> filters, bool multiple = false) =>
        Task.FromResult<IReadOnlyList<string>>([]);

    /// <summary>Saves the bench's window page as a PDF, as it prints: the page shows only what it put in the shell's print
    /// area (<c>ctx.setPrintContent</c>). Asks where to save; returns the path, or null when cancelled.</summary>
    Task<string?> SavePageAsPdfAsync(string suggestedName) => Task.FromResult<string?>(null);

    /// <summary>Asks the user to pick a folder; null means they cancelled.</summary>
    Task<string?> PickFolderAsync(string title) => Task.FromResult<string?>(null);

    /// <summary>Hands files to the benches that open them, as if the user had dropped them on the window (the Vault
    /// opens a note in the Markdown bench this way). Use it only for files the user chose (or that live in a folder
    /// they chose).</summary>
    Task OpenFilesAsync(IReadOnlyList<string> paths) => Task.CompletedTask;

    /// <summary>Tells every bench these files moved or were renamed (see <see cref="Contract.MovedCommand"/>).</summary>
    Task FilesMovedAsync(IReadOnlyList<FileMove> moves) => Task.CompletedTask;

    /// <summary>Asks the user where to save; null means they cancelled.</summary>
    Task<string?> PickSaveFileAsync(string title, string suggestedName, IReadOnlyList<FileFilter> filters) =>
        Task.FromResult<string?>(null);
}

/// <summary>A line in a file dialog's type list: <c>new("Markdown", [".md", ".markdown"])</c>.</summary>
public sealed record FileFilter(string Name, IReadOnlyList<string> Extensions);

/// <summary>A bench that streams media to its own page (the player's audio, artwork): the page asks for
/// /media/&lt;bench id&gt;/&lt;path&gt;, with an HTTP Range header when it seeks. The bench decides what a path means
/// (a library id, never a file path from the page).</summary>
public interface IBenchMedia
{
    BenchMediaReply? ServeMedia(string path, string? range);
}
/// <summary>What a bench answers for a media request: the status, the body (or none), and the headers ("Name: value" lines).</summary>
public sealed record BenchMediaReply(int Status, string Reason, Stream? Body, string Headers);

/// <summary>A failure to show the user as it is ("That file is not a NoorMD note").</summary>
public sealed class BenchException(string message) : Exception(message);

/// <summary>Who a bench is and what it brings: shown in the bench tabs, the menus, Home and Settings.</summary>
public sealed record BenchManifest
{
    /// <summary>Lower case, dotted, unique: <c>noor.markdown</c>.</summary>
    public required string Id { get; init; }
    public required string Name { get; init; }
    /// <summary>A short glyph shown in its tab and on Home (an emoji or a symbol).</summary>
    public string Icon { get; init; } = "◆";
    public string Description { get; init; } = "";
    public string Version { get; init; } = "1.0.0";
    public int ContractVersion { get; init; } = Contract.Version;
    /// <summary><c>roomy</c> (writing, media) or <c>compact</c> (code, pro tools); the user can override it per bench.</summary>
    public string Density { get; init; } = "roomy";
    /// <summary>The bench's web module, a path among its assets.</summary>
    public string Entry { get; init; } = "bench.js";
    /// <summary>The bench's own menus, shown between View and Tools while it's active.</summary>
    public IReadOnlyList<MenuSpec> Menus { get; init; } = [];
    /// <summary>The panels it can show, and where they go by default.</summary>
    public IReadOnlyList<PanelSpec> Panels { get; init; } = [];
    /// <summary>File extensions the bench opens (<c>".md"</c>), when the user drops such a file on the window or opens
    /// NoorMD with it. The first bench that lists a type gets those files.</summary>
    public IReadOnlyList<string> FileTypes { get; init; } = [];
}

public sealed record MenuSpec(string Title, IReadOnlyList<MenuItemSpec> Items);

/// <summary>A menu item runs a command: the bench's page handles it if its module has it, else its C# side.
/// A null <see cref="Command"/> is a separator.</summary>
public sealed record MenuItemSpec(string? Label = null, string? Command = null, string? Keys = null)
{
    public static readonly MenuItemSpec Separator = new();
}

/// <param name="Dock"><c>left</c>, <c>right</c> or <c>bottom</c>.</param>
public sealed record PanelSpec(string Id, string Title, string Icon = "▤", string Dock = "right");

/// <summary>The usual way to write a bench: web files embedded in the DLL under <c>web/</c>
/// (<c>&lt;EmbeddedResource Include="web\**" /&gt;</c>), commands as methods registered in the constructor.</summary>
public abstract class BenchBase : IBench
{
    readonly Dictionary<string, Func<JsonElement, IBenchHost, CancellationToken, Task<JsonNode?>>> _commands = new(StringComparer.Ordinal);
    readonly Assembly _assembly;
    readonly Dictionary<string, string> _assets;   // "bench.js" → manifest resource name

    protected BenchBase()
    {
        _assembly = GetType().Assembly;
        var root = _assembly.GetName().Name + ".web.";
        _assets = new(StringComparer.OrdinalIgnoreCase);
        foreach (var name in _assembly.GetManifestResourceNames())
            if (name.StartsWith(root, StringComparison.Ordinal)) _assets[name[root.Length..]] = name;
    }

    public abstract BenchManifest Manifest { get; }

    /// <summary>Registers a command (its id as the menu items and the page name it).</summary>
    protected void Command(string id, Func<JsonElement, IBenchHost, CancellationToken, Task<JsonNode?>> run) => _commands[id] = run;
    protected void Command(string id, Func<JsonElement, JsonNode?> run) => _commands[id] = (a, _, _) => Task.FromResult(run(a));

    public IReadOnlyCollection<string> Commands => _commands.Keys;

    public virtual Stream? OpenAsset(string path)
    {
        // Embedded resources flatten folders into dots: "web/css/x.css" is "Asm.web.css.x.css".
        var key = path.Replace('\\', '/').TrimStart('/').Replace('/', '.');
        return _assets.TryGetValue(key, out var res) ? _assembly.GetManifestResourceStream(res) : null;
    }

    public virtual Task<JsonNode?> HandleAsync(string command, JsonElement args, IBenchHost host, CancellationToken cancel) =>
        _commands.TryGetValue(command, out var run) ? run(args, host, cancel) : throw new BenchException($"{Manifest.Name} has no command \"{command}\".");
}
