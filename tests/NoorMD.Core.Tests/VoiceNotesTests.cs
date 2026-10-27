using NoorMD.Core.Media;
using Xunit;

namespace NoorMD.Core.Tests;

public class VoiceNotesTests
{
    [Fact]
    public void A_Recording_Arrives_In_Pieces_And_Is_Written_Once_Complete()
    {
        var dir = Path.Combine(Path.GetTempPath(), "noormd-voice-" + Guid.NewGuid().ToString("N"), "Voice notes");
        try
        {
            var v = new VoiceNotes(dir);
            var when = new DateTime(2026, 10, 27, 15, 12, 0);
            var t = v.Begin(null, "webm");
            v.Append(t, new byte[30]);
            Assert.False(Directory.Exists(dir)); // nothing on disk until it is complete
            v.Append(t, new byte[30]);
            var path = v.Finish(t, when);
            Assert.Equal(Path.Combine(dir, "Voice note 2026-10-27 15-12.webm"), path);
            Assert.Equal(60, new FileInfo(path).Length);
            // Same minute again: a unique name, never an overwrite.
            var t2 = v.Begin("", ".webm"); v.Append(t2, new byte[50]);
            Assert.EndsWith("Voice note 2026-10-27 15-12 (2).webm", v.Finish(t2, when));
            var t3 = v.Begin("Idea: boss/fight?", ".wav"); v.Append(t3, new byte[50]);
            Assert.EndsWith("Idea- boss-fight-.wav", v.Finish(t3, when));
            Assert.Equal(3, v.List().Count);
            Assert.Throws<ArgumentException>(() => v.Finish(t, when)); // already finished
        }
        finally { var root = Path.GetDirectoryName(dir)!; if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public void Wrong_Formats_Empty_Recordings_And_Cancel_Are_Handled()
    {
        var v = new VoiceNotes(Path.Combine(Path.GetTempPath(), "noormd-voice-" + Guid.NewGuid().ToString("N")));
        Assert.Throws<ArgumentException>(() => v.Begin(null, ".exe"));
        var t = v.Begin(null, ".webm");
        v.Append(t, new byte[10]);
        Assert.Throws<ArgumentException>(() => v.Finish(t, DateTime.Now));
        var c = v.Begin(null, ".webm");
        v.Cancel(c);
        Assert.Throws<ArgumentException>(() => v.Append(c, new byte[1]));
        Assert.False(Directory.Exists(v.Folder));
    }

    [Fact]
    public void Links_Are_Relative_To_The_Document_When_Possible()
    {
        var root = Path.Combine(Path.GetTempPath(), "vault");
        var rec = Path.Combine(root, "attachments", "Voice notes", "Voice note 1.webm");
        Assert.Equal("[🎙 Voice note 1 (1:05)](<attachments/Voice notes/Voice note 1.webm>)", VoiceNotes.LinkFor(rec, Path.Combine(root, "Home.md"), 65.4));
        Assert.Equal("[🎙 Voice note 1](<../attachments/Voice notes/Voice note 1.webm>)", VoiceNotes.LinkFor(rec, Path.Combine(root, "World", "Rivers.md"), 0));
        Assert.Contains("](<" + rec.Replace('\\', '/') + ">)", VoiceNotes.LinkFor(rec, null, 3));
    }

    [Fact]
    public void The_Microphone_Is_Only_Allowed_Right_After_Record_For_The_App_Page()
    {
        var now = new DateTime(2026, 10, 27, 15, 0, 0, DateTimeKind.Utc);
        var armed = now + MicrophoneGate.Window;
        Assert.True(MicrophoneGate.Allow(true, true, now.AddSeconds(5), armed));
        Assert.False(MicrophoneGate.Allow(true, true, now, DateTime.MinValue));      // never pressed
        Assert.False(MicrophoneGate.Allow(true, true, armed.AddSeconds(1), armed)); // too late
        Assert.False(MicrophoneGate.Allow(true, false, now, armed));                // another page (a pop-out, an overlay)
        Assert.False(MicrophoneGate.Allow(false, true, now, armed));                // camera, location… never
    }
}
