using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Noor.Contracts;

namespace Sandbox.Bench;

/// <summary>A scratchpad: type, and its C# side counts the words, sentences and reading time. It's here to prove the
/// bench contract end to end (manifest, web module from the DLL, menus, a panel, a C# command, an event back).</summary>
public sealed partial class SandboxBench : BenchBase
{
    public override BenchManifest Manifest { get; } = new()
    {
        Id = "noor.sandbox",
        Name = "Sandbox",
        Icon = "✦",
        Description = "A scratchpad that proves the bench contract: type, and its C# side counts.",
        Version = "3.0.1",
        Density = "roomy",
        Menus = [new MenuSpec("Sandbox", [
            new MenuItemSpec("Count the words (C#)", "sandbox.count", "Ctrl+Shift+C"),
            new MenuItemSpec("Say hello from C#", "sandbox.hello"),
            MenuItemSpec.Separator,
            new MenuItemSpec("Clear the page", "sandbox.clear"),
            new MenuItemSpec("Insert sample text", "sandbox.sample"),
        ])],
        Panels = [new PanelSpec("stats", "Statistics", "∑", "right"), new PanelSpec("about", "About", "ⓘ", "left")],
    };

    public SandboxBench()
    {
        Command("sandbox.count", a => Count(a.TryGetProperty("text", out var t) ? t.GetString() ?? "" : ""));
        Command("sandbox.hello", (a, host, _) =>
        {
            host.Post("hello", new { at = DateTime.Now.ToString("HH:mm:ss") });
            return Task.FromResult<JsonNode?>(new JsonObject { ["message"] = $"Hello from C# ({Environment.Version}, {Environment.ProcessorCount} cores)." });
        });
    }

    public static JsonNode Count(string text)
    {
        var words = WordRx().Matches(text).Count;
        // A sentence ends at . ! or ? followed by a space or the end ("3.0" doesn't end one); words after the last end count as one more.
        var ends = SentenceEndRx().Matches(text);
        var sentences = ends.Count + (WordRx().IsMatch(ends.Count == 0 ? text : text[(ends[^1].Index + ends[^1].Length)..]) ? 1 : 0);
        return new JsonObject
        {
            ["words"] = words,
            ["characters"] = text.Length,
            ["sentences"] = sentences,
            ["minutes"] = Math.Max(words == 0 ? 0 : 1, (int)Math.Round(words / 230.0)),
        };
    }

    [GeneratedRegex(@"[\p{L}\p{N}](?:[\p{L}\p{N}'’\-]|\.(?=\p{N}))*")] private static partial Regex WordRx();
    [GeneratedRegex(@"(?<=[\p{L}\p{N})""'’])[.!?]+(?=\s|$)")] private static partial Regex SentenceEndRx();
}
