using System.Text.Json;
using System.Text.Json.Nodes;
using Noor.Contracts;

namespace NoorMD3.Host;

/// <summary>The page's requests, answered: <c>{ id, target: "shell" | "bench:&lt;id&gt;", cmd, args }</c> →
/// <c>{ id, ok, result | error }</c>. The shell's own commands (settings, the bench list) are here; a bench's go to it.</summary>
public sealed class ShellRouter
{
    readonly BenchRegistry _benches;
    readonly Func<string, IBenchHost> _hostFor;
    readonly string _settingsPath;
    public ShellSettings Settings { get; private set; }
    /// <summary>Window commands (minimise, maximise, the buttons' colours, floating windows…), handled by the window the
    /// request came from (passed to <see cref="HandleAsync"/>), or this one when none is.</summary>
    public Func<string, JsonElement, JsonNode?>? Window { get; set; }

    public ShellRouter(BenchRegistry benches, string settingsPath, Func<string, IBenchHost> hostFor)
    {
        _benches = benches; _settingsPath = settingsPath; _hostFor = hostFor;
        Settings = ShellSettings.Load(settingsPath);
    }

    /// <summary>Files the user dropped on a window or opened NoorMD with: each goes to the bench that opens its type
    /// (told through <see cref="Contract.OpenCommand"/>). Returns which bench got which files, and the files no bench
    /// opens.</summary>
    public async Task<(List<(string Bench, string[] Paths)> Opened, List<string> Unknown)> OpenFilesAsync(IEnumerable<string> paths, CancellationToken cancel = default)
    {
        var groups = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var unknown = new List<string>();
        foreach (var raw in paths)
        {
            if (string.IsNullOrWhiteSpace(raw) || !Path.IsPathFullyQualified(raw) || !File.Exists(raw)) continue;
            var ext = Path.GetExtension(raw);
            var bench = _benches.Benches.FirstOrDefault(b => b.Manifest.FileTypes.Contains(ext, StringComparer.OrdinalIgnoreCase));
            if (bench == null) { unknown.Add(Path.GetFileName(raw)); continue; }
            if (!groups.TryGetValue(bench.Manifest.Id, out var list)) groups[bench.Manifest.Id] = list = [];
            list.Add(Path.GetFullPath(raw));
        }
        var opened = new List<(string, string[])>();
        foreach (var (id, list) in groups)
        {
            var bench = _benches.Find(id)!;
            var args = JsonSerializer.SerializeToElement(new { paths = list });
            try { await bench.HandleAsync(Contract.OpenCommand, args, _hostFor(id), cancel); opened.Add((id, list.ToArray())); }
            catch (BenchException) { unknown.AddRange(list.Select(Path.GetFileName)!); }
        }
        return (opened, unknown);
    }

    public async Task<JsonObject> HandleAsync(JsonElement request, Func<string, JsonElement, JsonNode?>? window = null, CancellationToken cancel = default)
    {
        window ??= Window;
        var id = request.TryGetProperty("id", out var i) ? i.Clone() : default;
        var reply = new JsonObject { ["id"] = id.ValueKind == JsonValueKind.Undefined ? null : JsonNode.Parse(id.GetRawText()) };
        try
        {
            var target = request.GetProperty("target").GetString() ?? "";
            var cmd = request.GetProperty("cmd").GetString() ?? "";
            var args = request.TryGetProperty("args", out var a) ? a : default;
            JsonNode? result;
            if (target == "shell") result = Shell(cmd, args);
            else if (target == "window") result = window?.Invoke(cmd, args);
            else if (target.StartsWith("bench:", StringComparison.Ordinal))
            {
                var bench = _benches.Find(target[6..]) ?? throw new BenchException($"There is no bench \"{target[6..]}\".");
                if (cmd.StartsWith("shell.", StringComparison.Ordinal)) throw new BenchException($"\"{cmd}\" is the shell's to send.");
                result = await bench.HandleAsync(cmd, args, _hostFor(bench.Manifest.Id), cancel);
            }
            else throw new BenchException($"Unknown target \"{target}\".");
            reply["ok"] = true; reply["result"] = result;
        }
        catch (BenchException ex) { reply["ok"] = false; reply["error"] = ex.Message; }
        catch (Exception ex) when (ex is KeyNotFoundException or InvalidOperationException or JsonException or FormatException)
        {
            reply["ok"] = false; reply["error"] = "That request wasn't understood: " + ex.Message;
        }
        return reply;
    }

    JsonNode? Shell(string cmd, JsonElement args)
    {
        switch (cmd)
        {
            case "start":
                return new JsonObject
                {
                    ["version"] = typeof(ShellRouter).Assembly.GetName().Version?.ToString(3),
                    ["contract"] = Contract.Version,
                    ["settings"] = JsonNode.Parse(Settings.ToJson().GetRawText()),
                    ["benches"] = JsonSerializer.SerializeToNode(_benches.Benches.Select(b => b.Manifest).OrderBy(m => m.Name), Json),
                    ["problems"] = JsonSerializer.SerializeToNode(_benches.Problems),
                };
            case "settings.get":
                return JsonNode.Parse(Settings.ToJson().GetRawText());
            case "settings.patch":
            {
                // Each window writes its own part: the given keys replace the saved ones, and "layouts" is merged per
                // bench (a bench in a window of its own keeps its layout without the main window overwriting it).
                var now = JsonNode.Parse(Settings.ToJson().GetRawText())!.AsObject();
                foreach (var kv in args.EnumerateObject())
                {
                    if (kv.Name == "layouts" && kv.Value.ValueKind == JsonValueKind.Object)
                    {
                        var layouts = now["layouts"] as JsonObject ?? new JsonObject();
                        foreach (var l in kv.Value.EnumerateObject()) layouts[l.Name] = JsonNode.Parse(l.Value.GetRawText());
                        now["layouts"] = layouts;
                    }
                    else now[kv.Name] = JsonNode.Parse(kv.Value.GetRawText());
                }
                Settings = ShellSettings.FromJson(JsonDocument.Parse(now.ToJsonString()).RootElement);
                Settings.Save(_settingsPath);
                return JsonNode.Parse(Settings.ToJson().GetRawText());
            }
            case "settings.save":
                Settings = ShellSettings.FromJson(args);
                Settings.Save(_settingsPath);
                return JsonNode.Parse(Settings.ToJson().GetRawText());
            default:
                throw new BenchException($"The shell has no command \"{cmd}\".");
        }
    }

    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
}
