using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using NoorMD3.Host;

namespace NoorMD3;

/// <summary>What every NoorMD window shares: the benches, the shell's logic, one WebView2 environment, and the list
/// of windows (the main one and the panels floating in windows of their own).</summary>
public static class ShellApp
{
    public static readonly string DataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NoorMD3");
    public static BenchRegistry Registry { get; private set; } = new();
    public static ShellRouter Router { get; private set; } = null!;
    public static ShellAssets Assets { get; private set; } = null!;
    public static ShellWindow? Main { get; set; }
    public static readonly List<ShellWindow> Windows = [];
    static Task<CoreWebView2Environment>? _env;

    /// <summary>Loads the benches and the shell's logic once, the first time a window asks.</summary>
    public static void Start()
    {
        if (Router != null) return;
        // The benches: every *.Bench.dll beside the app (stage 1: built and shipped with it).
        foreach (var dll in Directory.EnumerateFiles(AppContext.BaseDirectory, "*.Bench.dll"))
            try { System.Reflection.Assembly.LoadFrom(dll); } catch (Exception ex) when (ex is BadImageFormatException or FileLoadException) { }
        Registry = BenchRegistry.FromAssemblies(AppDomain.CurrentDomain.GetAssemblies().Where(a => a.GetName().Name?.EndsWith(".Bench", StringComparison.Ordinal) == true));
        Router = new ShellRouter(Registry, Path.Combine(DataRoot, "settings.json"), id => new BenchHost(id));
        Assets = new ShellAssets(Path.Combine(AppContext.BaseDirectory, "wwwroot"), Registry);
    }

    static List<string> _pending = [];
    /// <summary>Files NoorMD was started with, opened once the main page is ready.</summary>
    public static void SetPendingFiles(IEnumerable<string> paths) => _pending = paths.ToList();
    public static List<string> TakePendingFiles() { var p = _pending; _pending = []; return p; }

    /// <summary>Hands files to the benches that open them; each bench's page (in the window they came to) opens them.</summary>
    public static async Task OpenFilesAsync(IReadOnlyCollection<string> paths, ShellWindow window)
    {
        if (paths.Count == 0 || Router == null) return;
        var (opened, unknown) = await Router.OpenFilesAsync(paths);
        var target = Main ?? window;
        foreach (var (bench, files) in opened) target.Post(JsonSerializer.Serialize(new { @event = "open", bench, paths = files }));
        if (unknown.Count > 0) target.Post(JsonSerializer.Serialize(new { @event = "open.none", names = unknown }));
        if (opened.Count > 0 && target.WindowState == WindowState.Minimized) target.WindowState = WindowState.Normal;
        target.Activate();
    }

    /// <summary>One browser process for all windows (they share its storage, and start faster).</summary>
    public static Task<CoreWebView2Environment> Environment_() => _env ??= CoreWebView2Environment.CreateAsync(null, Path.Combine(DataRoot, "WebView2"));

    /// <summary>Sends an event to every window's page except <paramref name="except"/>.</summary>
    public static void Broadcast(object message, ShellWindow? except = null)
    {
        var json = JsonSerializer.Serialize(message);
        foreach (var w in Windows.ToArray()) if (w != except) w.Post(json);
    }

    /// <summary>A bench's way back to its pages (events reach every window, so a floating panel hears them too),
    /// and its own data folder.</summary>
    sealed class BenchHost(string id) : Noor.Contracts.IBenchHost
    {
        public string DataFolder { get { var d = Path.Combine(DataRoot, "benches", id); Directory.CreateDirectory(d); return d; } }
        public void Post(string name, object? payload = null) =>
            Application.Current.Dispatcher.BeginInvoke(() => Broadcast(new { @event = "bench", bench = id, name, payload }));
        public void Log(string message) => System.Diagnostics.Debug.WriteLine($"[{id}] {message}");

        static string FilterText(IReadOnlyList<Noor.Contracts.FileFilter> filters) =>
            string.Join("|", filters.Select(f => $"{f.Name}|{string.Join(";", f.Extensions.Select(e => "*" + e))}"));

        /// <summary>Dialogs belong to the window the user is looking at (a floating one, or the main one).</summary>
        static Window? Owner() => Application.Current.Windows.OfType<Window>().FirstOrDefault(w => w.IsActive) ?? Main;

        public Task<IReadOnlyList<string>> PickFilesAsync(string title, IReadOnlyList<Noor.Contracts.FileFilter> filters, bool multiple = false) =>
            Application.Current.Dispatcher.InvokeAsync<IReadOnlyList<string>>(() =>
            {
                var d = new Microsoft.Win32.OpenFileDialog { Title = title, Filter = FilterText(filters), FilterIndex = filters.Count, Multiselect = multiple, CheckFileExists = true };
                return d.ShowDialog(Owner()) == true ? d.FileNames : [];
            }).Task;

        public Task<string?> PickFolderAsync(string title) =>
            Application.Current.Dispatcher.InvokeAsync<string?>(() =>
            {
                var d = new Microsoft.Win32.OpenFolderDialog { Title = title, Multiselect = false };
                return d.ShowDialog(Owner()) == true ? d.FolderName : null;
            }).Task;

        public Task OpenFilesAsync(IReadOnlyList<string> paths) =>
            Application.Current.Dispatcher.InvokeAsync(() => Main == null ? Task.CompletedTask : ShellApp.OpenFilesAsync(paths.ToList(), Main)).Task.Unwrap();

        public async Task FilesMovedAsync(IReadOnlyList<Noor.Contracts.FileMove> moves)
        {
            await Router.FilesMovedAsync(moves);
            await Application.Current.Dispatcher.InvokeAsync(() => Broadcast(new { @event = "moved", moves = moves.Select(m => new { from = m.From, to = m.To }) }));
        }

        public async Task<string?> SavePageAsPdfAsync(string suggestedName)
        {
            var path = await PickSaveFileAsync("Export PDF", suggestedName, [new("PDF document", [".pdf"])]);
            if (path == null || Main == null) return null;
            return await Application.Current.Dispatcher.InvokeAsync(() => Main.PrintToPdfAsync(path)).Task.Unwrap() ? path : throw new Noor.Contracts.BenchException("WebView2 couldn't make the PDF.");
        }

        public Task<string?> PickSaveFileAsync(string title, string suggestedName, IReadOnlyList<Noor.Contracts.FileFilter> filters) =>
            Application.Current.Dispatcher.InvokeAsync<string?>(() =>
            {
                var d = new Microsoft.Win32.SaveFileDialog { Title = title, Filter = FilterText(filters), FileName = suggestedName, AddExtension = true, DefaultExt = filters.Count > 0 && filters[0].Extensions.Count > 0 ? filters[0].Extensions[0] : "", OverwritePrompt = true };
                return d.ShowDialog(Owner()) == true ? d.FileName : null;
            }).Task;
    }
}
