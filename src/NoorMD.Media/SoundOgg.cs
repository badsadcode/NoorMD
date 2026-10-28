using OggVorbisEncoder;

namespace NoorMD.Media;

/// <summary>
/// OGG Vorbis files from a render (smaller than WAV, what most game engines stream music from). The stream's serial
/// number comes from the sound itself, so the same render always makes the same file. A loop is tagged with
/// LOOPSTART/LOOPLENGTH (in samples), which several engines and players read to loop without a gap.
/// </summary>
public static class SoundOgg
{
    /// <param name="quality">Vorbis quality, 0.1 (small) … 0.9 (best; above it the encoder changes block size and its first half-block shifts); 0.5 is about 160 kbit/s for stereo.</param>
    public static byte[] Encode(SoundRender render, double quality = 0.5, string? title = null, bool loop = false)
    {
        var n = render.Left.Length;
        var samples = n;
        var info = VorbisInfo.InitVariableBitRate(2, render.SampleRate, (float)Math.Clamp(quality, 0.1, 0.9));
        var serial = unchecked((int)(0x4E6F6F72u ^ (uint)n ^ (uint)(n > 0 ? BitConverter.SingleToInt32Bits(render.Left[n / 2]) : 0)));
        var ogg = new OggStream(serial);
        var comments = new Comments();
        comments.AddTag("ENCODER", "NoorMD");
        if (!string.IsNullOrWhiteSpace(title)) comments.AddTag("TITLE", title);
        if (loop) { comments.AddTag("LOOPSTART", "0"); comments.AddTag("LOOPLENGTH", samples.ToString(System.Globalization.CultureInfo.InvariantCulture)); }
        ogg.PacketIn(HeaderPacketBuilder.BuildInfoPacket(info));
        ogg.PacketIn(HeaderPacketBuilder.BuildCommentsPacket(comments));
        ogg.PacketIn(HeaderPacketBuilder.BuildBooksPacket(info));
        using var output = new MemoryStream();
        void Flush(bool force)
        {
            while (ogg.PageOut(out var page, force)) { output.Write(page.Header, 0, page.Header.Length); output.Write(page.Body, 0, page.Body.Length); }
        }
        Flush(true);
        var state = ProcessingState.Create(info);
        const int block = 1024;
        // The encoder's first half-block (1024 samples) is not counted in the stream's positions, so a decoder drops
        // it: the sound is preceded by that much silence, and what plays is the render exactly, sample for sample.
        const int prime = 1024;
        float[] Primed(float[] x) { var y = new float[x.Length + prime]; Array.Copy(x, 0, y, prime, x.Length); return y; }
        var pcm = new[] { Primed(render.Left), Primed(render.Right) };
        n += prime;
        void Drain() { while (!ogg.Finished && state.PacketOut(out var packet)) { ogg.PacketIn(packet); Flush(false); } }
        for (var at = 0; at < n; at += block) { state.WriteData(pcm, Math.Min(block, n - at), at); Drain(); }
        state.WriteEndOfStream();
        Drain();
        Flush(true);
        return output.ToArray();
    }
}
