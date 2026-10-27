using NoorMD.Core.Hub;
using Xunit;

namespace NoorMD.Core.Tests;

public class AppsHubTests
{
    private static string Temp() { var d = Path.Combine(Path.GetTempPath(), "noormd-hub-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(d); return d; }

    [Fact]
    public void Shortcuts_Are_Added_Saved_Reordered_And_Removed()
    {
        var dir = Temp();
        try
        {
            var hub = new AppsHub(dir);
            var a = hub.Add(new HubItem { Name = "  OBS Studio ", Kind = HubKind.App, Target = Path.Combine(Path.GetTempPath(), "obs-studio", "obs64.exe") });
            var b = hub.Add(new HubItem { Name = "Dota 2", Kind = HubKind.Web, Target = "steam://rungameid/570", Group = "Games" });
            var c = hub.Add(new HubItem { Name = "YouTube Studio", Kind = HubKind.Web, Target = "https://studio.youtube.com", Group = " " });
            Assert.Equal("OBS Studio", a.Name);
            Assert.Equal("Apps", c.Group);
            hub.Reorder([c.Id, b.Id]);
            hub.MarkUsed(b.Id);
            var again = new AppsHub(dir);
            Assert.Equal(["YouTube Studio", "Dota 2", "OBS Studio"], again.Items.Select(i => i.Name));
            Assert.Equal(1, again.Get(b.Id)!.Uses);
            Assert.Equal(HubKind.Web, again.Get(b.Id)!.Kind);
            Assert.Equal(["Apps", "Games"], again.Groups());
            again.Update(a.Id, "OBS", "Streaming", "--minimize-to-tray", "#ff5500");
            Assert.Equal("--minimize-to-tray", new AppsHub(dir).Get(a.Id)!.Arguments);
            again.Remove(a.Id);
            Assert.Null(new AppsHub(dir).Get(a.Id));
        }
        finally { Directory.Delete(dir, true); }
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("file:///C:/Windows/System32/cmd.exe")]
    [InlineData("ms-msdt:/id PCWDiagnostic")]
    [InlineData("search-ms:query=x")]
    [InlineData("not a url")]
    [InlineData("")]
    public void Dangerous_Or_Broken_Addresses_Are_Refused(string url)
    {
        Assert.NotNull(AppsHub.AddressProblem(url));
        var dir = Temp();
        try { Assert.ThrowsAny<ArgumentException>(() => new AppsHub(dir).Add(new HubItem { Name = "x", Kind = HubKind.Web, Target = url })); }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void Kinds_Are_Guessed_And_Relative_Paths_Refused()
    {
        Assert.Equal(HubKind.App, AppsHub.Guess(@"C:\Games\Game.exe").Kind);
        Assert.Equal(HubKind.App, AppsHub.Guess(@"C:\Users\me\Desktop\Steam game.url").Kind);
        Assert.Equal(HubKind.File, AppsHub.Guess(@"C:\notes\plan.pdf").Kind);
        Assert.Null(AppsHub.AddressProblem("https://example.com"));
        Assert.Null(AppsHub.AddressProblem("discord://-/channels/@me"));
        var dir = Temp();
        try
        {
            Assert.ThrowsAny<ArgumentException>(() => new AppsHub(dir).Add(new HubItem { Name = "x", Kind = HubKind.App, Target = @"..\evil.exe" }));
            Assert.ThrowsAny<ArgumentException>(() => new AppsHub(dir).Add(new HubItem { Name = " ", Kind = HubKind.Web, Target = "https://x.y" }));
            File.WriteAllText(Path.Combine(dir, "apps.json"), "{ broken");
            Assert.Empty(new AppsHub(dir).Items); // a damaged file is kept aside as apps.json.broken
            Assert.True(File.Exists(Path.Combine(dir, "apps.json.broken")));
        }
        finally { Directory.Delete(dir, true); }
    }
}
