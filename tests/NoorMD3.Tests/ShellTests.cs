using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Noor.Contracts;
using NoorMD3.Host;
using Sandbox.Bench;
using Xunit;

namespace NoorMD3.Tests;

public sealed class ShellTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "noormd3-tests-" + Guid.NewGuid().ToString("N"));
    public ShellTests() => Directory.CreateDirectory(_dir);
    public void Dispose() { try { Directory.Delete(_dir, true); } catch (IOException) { } }

    sealed class Host : IBenchHost
    {
        public readonly List<(string, object?)> Posted = [];
        public void Post(string name, object? payload = null) => Posted.Add((name, payload));
        public string DataFolder => Path.GetTempPath();
        public void Log(string message) { }
    }

    /// <summary>A bench made to fail one check at a time.</summary>
    sealed class OddBench(BenchManifest m, bool hasEntry = true) : IBench
    {
        public BenchManifest Manifest => m;
        public Stream? OpenAsset(string path) => hasEntry && path == m.Entry ? new MemoryStream("export default {}"u8.ToArray()) : null;
        public Task<JsonNode?> HandleAsync(string command, JsonElement args, IBenchHost host, CancellationToken cancel) => Task.FromResult<JsonNode?>(null);
    }

    static JsonElement J(string json) => JsonDocument.Parse(json).RootElement.Clone();

    [Fact]
    public void The_sandbox_is_found_and_its_web_module_comes_out_of_its_dll()
    {
        var reg = BenchRegistry.FromAssemblies([typeof(SandboxBench).Assembly]);
        Assert.Equal(2, BenchRegistry.FromAssemblies([typeof(SandboxBench).Assembly, typeof(Clock.Bench.ClockBench).Assembly]).Benches.Count);
        var bench = Assert.Single(reg.Benches);
        Assert.Equal("noor.sandbox", bench.Manifest.Id);
        Assert.Empty(reg.Problems);
        using var s = bench.OpenAsset("bench.js");
        Assert.NotNull(s);
        Assert.Contains("export default", new StreamReader(s!).ReadToEnd());
        Assert.NotNull(bench.OpenAsset("bench.css"));
        Assert.Null(bench.OpenAsset("nope.js"));
    }

    [Fact]
    public void Benches_that_dont_hold_up_are_left_out_and_say_why()
    {
        var reg = new BenchRegistry();
        Assert.True(reg.Add(new OddBench(new BenchManifest { Id = "noor.good", Name = "Good" })));
        Assert.False(reg.Add(new OddBench(new BenchManifest { Id = "noor.good", Name = "Twin" })));
        Assert.False(reg.Add(new OddBench(new BenchManifest { Id = "Bad Id", Name = "Bad" })));
        Assert.False(reg.Add(new OddBench(new BenchManifest { Id = "home", Name = "Home" })));
        Assert.False(reg.Add(new OddBench(new BenchManifest { Id = "noor.future", Name = "Future", ContractVersion = 99 })));
        Assert.False(reg.Add(new OddBench(new BenchManifest { Id = "noor.dense", Name = "Dense", Density = "squashed" })));
        Assert.False(reg.Add(new OddBench(new BenchManifest { Id = "noor.panel", Name = "Panel", Panels = [new PanelSpec("x", "X", Dock: "top")] })));
        Assert.False(reg.Add(new OddBench(new BenchManifest { Id = "noor.noentry", Name = "No entry" }, hasEntry: false)));
        Assert.Single(reg.Benches);
        Assert.Equal(7, reg.Problems.Count);
        Assert.Contains(reg.Problems, p => p.Contains("another bench already uses"));
        Assert.Contains(reg.Problems, p => p.Contains("contract version 99"));
        Assert.Contains(reg.Problems, p => p.Contains("web module"));
    }

    [Fact]
    public void Settings_are_kept_put_right_and_survive_a_broken_file()
    {
        var path = Path.Combine(_dir, "settings.json");
        var s = new ShellSettings { Theme = "ember", MenuPosition = "row", OpenBenches = ["noor.sandbox", "noor.sandbox", "Not Valid"], ActiveBench = "noor.sandbox" };
        s.Density["noor.sandbox"] = "compact"; s.Density["noor.x"] = "huge";
        s.Checked().Save(path);
        var back = ShellSettings.Load(path);
        Assert.Equal("ember", back.Theme);
        Assert.Equal("row", back.MenuPosition);
        Assert.Equal(["noor.sandbox"], back.OpenBenches);
        Assert.Equal("compact", back.Density["noor.sandbox"]);
        Assert.False(back.Density.ContainsKey("noor.x"));

        File.WriteAllText(path, "{ this is not json");
        var fresh = ShellSettings.Load(path);
        Assert.Equal("dark", fresh.Theme);
        Assert.True(File.Exists(path + ".broken"));   // set aside, not lost

        Assert.Equal("dark", ShellSettings.FromJson(J("""{"theme":"neon","menuPosition":"sideways"}""")).Theme);
        Assert.Equal("title", ShellSettings.FromJson(J("""{"theme":"neon","menuPosition":"sideways"}""")).MenuPosition);
    }

    [Fact]
    public async Task The_router_answers_the_shell_and_passes_bench_commands_to_the_bench()
    {
        var reg = BenchRegistry.FromAssemblies([typeof(SandboxBench).Assembly]);
        var host = new Host();
        var router = new ShellRouter(reg, Path.Combine(_dir, "s.json"), _ => host);
        var start = await router.HandleAsync(J("""{"id":1,"target":"shell","cmd":"start"}"""));
        Assert.True((bool)start["ok"]!);
        Assert.Equal(1, (int)start["id"]!);
        Assert.Equal("noor.sandbox", (string)start["result"]!["benches"]![0]!["id"]!);
        Assert.Equal("Sandbox", (string)start["result"]!["benches"]![0]!["menus"]![0]!["title"]!);

        var count = await router.HandleAsync(J("""{"id":2,"target":"bench:noor.sandbox","cmd":"sandbox.count","args":{"text":"One two three. Four!"}}"""));
        Assert.Equal(4, (int)count["result"]!["words"]!);
        Assert.Equal(2, (int)count["result"]!["sentences"]!);

        var hello = await router.HandleAsync(J("""{"id":3,"target":"bench:noor.sandbox","cmd":"sandbox.hello"}"""));
        Assert.StartsWith("Hello from C#", (string)hello["result"]!["message"]!);
        Assert.Equal("hello", Assert.Single(host.Posted).Item1);   // the event back to the page

        var unknown = await router.HandleAsync(J("""{"id":4,"target":"bench:noor.sandbox","cmd":"sandbox.fly"}"""));
        Assert.False((bool)unknown["ok"]!);
        Assert.Contains("no command", (string)unknown["error"]!);
        var nobench = await router.HandleAsync(J("""{"id":5,"target":"bench:noor.ghost","cmd":"x"}"""));
        Assert.Contains("There is no bench", (string)nobench["error"]!);
        var garbled = await router.HandleAsync(J("""{"id":6}"""));
        Assert.False((bool)garbled["ok"]!);

        var saved = await router.HandleAsync(J("""{"id":7,"target":"shell","cmd":"settings.save","args":{"theme":"glacier","openBenches":["noor.sandbox"],"activeBench":"home"}}"""));
        Assert.Equal("glacier", (string)saved["result"]!["theme"]!);
        Assert.Equal("glacier", ShellSettings.Load(Path.Combine(_dir, "s.json")).Theme);
        Assert.Equal("home", ShellSettings.Load(Path.Combine(_dir, "s.json")).ActiveBench);
    }

    [Fact]
    public void Files_are_served_from_the_shell_folder_and_the_benches_and_nowhere_else()
    {
        var root = Path.Combine(_dir, "www");
        Directory.CreateDirectory(Path.Combine(root, "ui", "css"));
        File.WriteAllText(Path.Combine(root, "index.html"), "<html>");
        File.WriteAllText(Path.Combine(root, "ui", "css", "noor.css"), "body{}");
        File.WriteAllText(Path.Combine(_dir, "secret.txt"), "no");
        var assets = new ShellAssets(root, BenchRegistry.FromAssemblies([typeof(SandboxBench).Assembly]));
        Assert.Equal("text/html; charset=utf-8", assets.Open("/")!.Value.ContentType);
        Assert.Equal("text/css; charset=utf-8", assets.Open("/ui/css/noor.css")!.Value.ContentType);
        Assert.Equal("text/javascript; charset=utf-8", assets.Open("/benches/noor.sandbox/bench.js")!.Value.ContentType);
        Assert.Null(assets.Open("/../secret.txt"));
        Assert.Null(assets.Open("/%2e%2e/secret.txt"));
        Assert.Null(assets.Open("/ui/../../secret.txt"));
        Assert.Null(assets.Open("/C:/Windows/win.ini"));
        Assert.Null(assets.Open("/benches/noor.ghost/bench.js"));
        Assert.Null(assets.Open("/benches/noor.sandbox/../bench.js"));
        Assert.Null(assets.Open("/missing.html"));
    }

    [Fact]
    public void Clock_lists_time_zones_by_their_iana_names()
    {
        var zones = Clock.Bench.ClockBench.Zones().AsArray();
        Assert.NotEmpty(zones);
        Assert.All(zones, z => Assert.Contains("/", (string)z!["id"]! + "/"));
        Assert.Contains(zones, z => (string)z!["id"]! is "Europe/Warsaw" or "Europe/Berlin" or "Etc/UTC" or "UTC");
    }

    [Fact]
    public void Sandbox_counts_words_sentences_and_reading_time()
    {
        var r = SandboxBench.Count("NoorMD 3.0 is one home. Benches talk!");
        Assert.Equal(7, (int)r["words"]!);
        Assert.Equal(2, (int)r["sentences"]!);
        Assert.Equal(1, (int)r["minutes"]!);
        Assert.Equal(0, (int)SandboxBench.Count("")["minutes"]!);
        Assert.Equal(460, (int)SandboxBench.Count(string.Join(' ', Enumerable.Repeat("word", 460)))["words"]!);
        Assert.Equal(2, (int)SandboxBench.Count(string.Join(' ', Enumerable.Repeat("word", 460)))["minutes"]!);
    }
}

public sealed class FixtureTests
{
    /// <summary>The browser tests (tests/web3) use the benches' manifests as the shell would send them; this keeps those copies true.
    /// Run with NOORMD3_WRITE_FIXTURES=1 to write them again after changing a manifest.</summary>
    [Theory]
    [InlineData("sandbox")]
    [InlineData("clock")]
    public void The_web_tests_copies_of_the_manifests_are_current(string name)
    {
        IBench bench = name == "sandbox" ? new SandboxBench() : new Clock.Bench.ClockBench();
        var json = System.Text.Json.JsonSerializer.Serialize(bench.Manifest, new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase, WriteIndented = true });
        var dir = AppContext.BaseDirectory;
        while (dir != null && !File.Exists(Path.Combine(dir, "NoorMD.sln"))) dir = Path.GetDirectoryName(dir);
        Assert.NotNull(dir);
        var path = Path.Combine(dir!, "tests", "web3", "fixtures", name + ".manifest.json");
        if (Environment.GetEnvironmentVariable("NOORMD3_WRITE_FIXTURES") == "1") File.WriteAllText(path, json + "\n");
        Assert.Equal(json.Trim(), File.ReadAllText(path).Trim());
    }
}
