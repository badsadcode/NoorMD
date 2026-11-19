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
    }
}
