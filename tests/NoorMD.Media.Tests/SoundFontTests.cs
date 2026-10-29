using System.Text;
using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>SoundFont 2 instruments (as LMMS's SF2 player): reading the font, its zones, and playing its presets.</summary>
public class SoundFontTests
{
    private const int Sr = 22050;

    /// <summary>
    /// A small SoundFont: a 440 Hz sine (root A4, looped) as preset 0 "Soft sine" (bank 0, program 5), and a
    /// one-shot "Click" for keys 36–40 with scale tuning 0 (every key the same pitch) as preset 1 (bank 128).
    /// </summary>
    public static byte[] MakeFont()
    {
        const int rate = 22050;
        var sine = Enumerable.Range(0, rate / 2).Select(i => (short)(Math.Sin(2 * Math.PI * 440 * i / rate) * 12000)).ToArray();
        var click = Enumerable.Range(0, 2000).Select(i => (short)(Math.Sin(2 * Math.PI * 1000 * i / rate) * 12000 * Math.Exp(-i / 300.0))).ToArray();
        var pool = new List<short>(); pool.AddRange(sine); pool.AddRange(new short[46]); var clickAt = pool.Count; pool.AddRange(click); pool.AddRange(new short[46]);
        var smpl = new byte[pool.Count * 2]; Buffer.BlockCopy(pool.ToArray(), 0, smpl, 0, smpl.Length);
        static byte[] Name(string s) { var b = new byte[20]; Encoding.ASCII.GetBytes(s).CopyTo(b, 0); return b; }
        static byte[] U16(int v) => [(byte)v, (byte)(v >> 8)];
        static byte[] U32(int v) => [(byte)v, (byte)(v >> 8), (byte)(v >> 16), (byte)(v >> 24)];
        static byte[] Gen(int oper, int amount) => [.. U16(oper), .. U16(amount)];
        static byte[] Range(int oper, int lo, int hi) => [.. U16(oper), (byte)lo, (byte)hi];
        static byte[] Chunk(string id, byte[] body) => [.. Encoding.ASCII.GetBytes(id), .. U32(body.Length), .. body, .. (body.Length % 2 == 1 ? new byte[1] : [])];
        static byte[] List(string type, params byte[][] chunks) { var body = Encoding.ASCII.GetBytes(type).Concat(chunks.SelectMany(c => c)).ToArray(); return Chunk("LIST", body); }
        // Samples: the sine and the click, then the terminal record.
        // The loop: from the tenth cycle to the last whole one.
        int loopStart = (int)(rate / 440.0 * 10), loopEnd = (int)(Math.Floor(sine.Length * 440.0 / rate) * rate / 440.0);
        var shdr = new List<byte>();
        shdr.AddRange([.. Name("sine"), .. U32(0), .. U32(sine.Length), .. U32(loopStart), .. U32(loopEnd), .. U32(rate), 69, 0, .. U16(0), .. U16(1)]);
        shdr.AddRange([.. Name("click"), .. U32(clickAt), .. U32(clickAt + click.Length), .. U32(clickAt), .. U32(clickAt + click.Length - 1), .. U32(rate), 60, 0, .. U16(0), .. U16(1)]);
        shdr.AddRange([.. Name("EOS"), .. new byte[26]]);
        // Instruments: 0 "SineInst" (zone: sample 0, loop), 1 "ClickInst" (global zone: scale tuning 0; zone: keys 36–40, sample 1).
        var igen = new List<byte>(); var ibag = new List<byte>(); var inst = new List<byte>();
        void IBag() => ibag.AddRange([.. U16(igen.Count / 4), .. U16(0)]);
        inst.AddRange([.. Name("SineInst"), .. U16(0)]);
        IBag(); igen.AddRange([.. Gen(34, -6000 & 0xFFFF), .. Gen(38, -3000 & 0xFFFF), .. Gen(54, 1), .. Gen(53, 0)]);
        inst.AddRange([.. Name("ClickInst"), .. U16(1)]);
        IBag(); igen.AddRange(Gen(56, 0));
        IBag(); igen.AddRange([.. Range(43, 36, 40), .. Gen(53, 1)]);
        inst.AddRange([.. Name("EOI"), .. U16(3)]);
        IBag(); igen.AddRange(Gen(0, 0));
        // Presets: 0 "Soft sine" → instrument 0; 1 "Click kit" (bank 128) → instrument 1.
        var pgen = new List<byte>(); var pbag = new List<byte>(); var phdr = new List<byte>();
        void PBag() => pbag.AddRange([.. U16(pgen.Count / 4), .. U16(0)]);
        phdr.AddRange([.. Name("Soft sine"), .. U16(5), .. U16(0), .. U16(0), .. new byte[12]]);
        PBag(); pgen.AddRange(Gen(41, 0));
        phdr.AddRange([.. Name("Click kit"), .. U16(0), .. U16(128), .. U16(1), .. new byte[12]]);
        PBag(); pgen.AddRange(Gen(41, 1));
        phdr.AddRange([.. Name("EOP"), .. U16(0), .. U16(0), .. U16(2), .. new byte[12]]);
        PBag(); pgen.AddRange(Gen(0, 0));
        var body = Encoding.ASCII.GetBytes("sfbk")
            .Concat(List("INFO", Chunk("ifil", [.. U16(2), .. U16(1)]), Chunk("INAM", Encoding.ASCII.GetBytes("Test font\0"))))
            .Concat(List("sdta", Chunk("smpl", smpl)))
            .Concat(List("pdta", Chunk("phdr", [.. phdr]), Chunk("pbag", [.. pbag]), Chunk("pmod", new byte[10]), Chunk("pgen", [.. pgen]),
                Chunk("inst", [.. inst]), Chunk("ibag", [.. ibag]), Chunk("imod", new byte[10]), Chunk("igen", [.. igen]), Chunk("shdr", [.. shdr])))
            .ToArray();
        return [.. Encoding.ASCII.GetBytes("RIFF"), .. U32(body.Length), .. body];
    }

    private static double Hz(float[] x, double t0, double t1)
    {
        int a = (int)(t0 * Sr), b = (int)(t1 * Sr), first = -1, last = -1, n = 0;
        for (var i = a + 1; i < b; i++) if (x[i - 1] <= 0 && x[i] > 0) { if (first < 0) first = i; else n++; last = i; }
        return n == 0 ? 0 : n * Sr / (double)(last - first);
    }

    private static double Rms(float[] x, double t0, double t1)
    {
        int a = (int)(t0 * Sr), b = Math.Min(x.Length, (int)(t1 * Sr));
        double s = 0; for (var i = a; i < b; i++) s += x[i] * x[i];
        return Math.Sqrt(s / Math.Max(1, b - a));
    }

    private static SongRecipe Song(int preset, int pitch, int length) => new SongRecipe
    {
        Tempo = 120, Bars = 2, LoopEnd = 2,
        Tracks = [new SongTrack { Name = "Font", Kind = "sf2", Gain = 0, Instrument = new SongInstrument { Path = "test.sf2", FontPreset = preset, FontProgram = 5 },
            Patterns = [new SongPattern { Notes = [new SongNote { Step = 0, Length = length, Pitch = pitch, Velocity = 1 }] }], Sequence = [1, 0] }],
    }.Clamped();

    private static readonly SoundFont Font = SoundFont.Read(MakeFont());
    private static SampleAudio? Load(string path) => path == "test.sf2" ? new SampleAudio { Left = [], Right = [], Rate = 1, Font = Font } : null;

    [Fact]
    public void A_soundfont_lists_its_presets_and_zones()
    {
        Assert.Equal("Test font", Font.Name);
        Assert.Equal([("Soft sine", 0, 5), ("Click kit", 128, 0)], Font.Presets.Select(p => (p.Name, p.Bank, p.Program)));
        Assert.Single(Font.ZonesFor(0, 60, 100));
        Assert.Single(Font.ZonesFor(1, 38, 100));
        Assert.Empty(Font.ZonesFor(1, 60, 100));
        Assert.Throws<InvalidDataException>(() => SoundFont.Read(Encoding.ASCII.GetBytes("RIFF\0\0\0\0WAVEfmt ")));
    }

    [Fact]
    public void A_preset_plays_at_the_notes_pitch_and_holds_on_its_loop()
    {
        var a4 = SequencerEngine.Render(Song(0, 69, 16), Sr, samples: Load);
        Assert.InRange(Hz(a4.Left, 0.1, 0.4), 435, 445);
        var a5 = SequencerEngine.Render(Song(0, 81, 16), Sr, samples: Load);
        Assert.InRange(Hz(a5.Left, 0.1, 0.4), 870, 890);
        // The sample is half a second long; held for two seconds it loops, then fades with its release.
        Assert.True(Rms(a4.Left, 1.6, 1.9) > 0.3 * Rms(a4.Left, 0.2, 0.4));
        Assert.True(Rms(a4.Left, 2.9, 3.2) < 0.05 * Rms(a4.Left, 0.2, 0.4));
    }

    [Fact]
    public void Scale_tuning_zero_keeps_every_key_at_one_pitch_and_one_shots_end()
    {
        var k36 = SequencerEngine.Render(Song(1, 36, 4), Sr, samples: Load);
        var k40 = SequencerEngine.Render(Song(1, 40, 4), Sr, samples: Load);
        Assert.InRange(Hz(k36.Left, 0.0, 0.05), 950, 1050);
        Assert.InRange(Hz(k40.Left, 0.0, 0.05), 950, 1050);
        Assert.True(Rms(k36.Left, 0.3, 0.5) < 1e-4);
    }

    [Fact]
    public void A_missing_font_is_reported_and_midi_uses_the_presets_program()
    {
        var r = SequencerEngine.Render(Song(0, 60, 4), Sr, samples: _ => null);
        Assert.Contains(r.Warnings, w => w.Contains("SoundFont"));
        Assert.Contains("test.sf2", Song(0, 60, 4).Files());
        var midi = SequencerEngine.ToMidi(Song(0, 60, 4));
        Assert.Contains(Enumerable.Range(0, midi.Length - 1), i => (midi[i] & 0xF0) == 0xC0 && midi[i + 1] == 5);
    }
}
