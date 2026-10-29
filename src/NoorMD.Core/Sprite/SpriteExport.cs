using System.Text.Json;
using System.Text.Json.Nodes;

namespace NoorMD.Core.Sprite;

/// <summary>A sprite's frame as composed (all its visible layers), RGBA, and how long it shows.</summary>
public sealed record SpriteImage(int Width, int Height, byte[] Rgba, int Duration);

/// <summary>Exports of composed frames: scaled up by whole numbers, sprite sheets (with an Aseprite-style JSON), GIF.</summary>
public static class SpriteExport
{
    public static readonly string[] Layouts = ["row", "column", "grid"];

    /// <summary>Each pixel made a square of scale × scale (nearest neighbour: pixel art stays crisp).</summary>
    public static SpriteImage Scale(SpriteImage im, int scale)
    {
        if (scale <= 1) return im;
        int w = im.Width * scale, h = im.Height * scale;
        var o = new byte[w * h * 4];
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
                Array.Copy(im.Rgba, ((y / scale) * im.Width + x / scale) * 4, o, (y * w + x) * 4, 4);
        return im with { Width = w, Height = h, Rgba = o };
    }

    /// <summary>
    /// Frames laid out in one picture (a row, a column, or a grid nearly square), with spacing between them, and a
    /// JSON engines and libraries read as they read Aseprite's ("hash" form): each frame's place and duration, the tags.
    /// </summary>
    public static (SpriteImage Sheet, string Json) Sheet(IReadOnlyList<SpriteImage> frames, string layout, int spacing, string name, IReadOnlyList<SpriteTag> tags, IReadOnlyList<SpriteLayer> layers, int scale = 1)
    {
        if (frames.Count == 0) throw new ArgumentException("No frames.");
        int fw = frames[0].Width, fh = frames[0].Height, n = frames.Count;
        spacing = Math.Clamp(spacing, 0, 64);
        var columns = layout switch { "column" => 1, "grid" => (int)Math.Ceiling(Math.Sqrt(n)), _ => n };
        var rows = (n + columns - 1) / columns;
        int w = columns * fw + (columns - 1) * spacing, h = rows * fh + (rows - 1) * spacing;
        if ((long)w * h > 16384L * 16384) throw new InvalidOperationException("That sheet would be too large: try a grid, or a smaller scale.");
        var px = new byte[w * h * 4];
        var json = new JsonObject();
        var jframes = new JsonObject();
        for (var i = 0; i < n; i++)
        {
            int cx = i % columns * (fw + spacing), cy = i / columns * (fh + spacing);
            for (var y = 0; y < fh; y++) Array.Copy(frames[i].Rgba, y * fw * 4, px, ((cy + y) * w + cx) * 4, fw * 4);
            jframes[$"{name} {i}.png"] = new JsonObject
            {
                ["frame"] = new JsonObject { ["x"] = cx, ["y"] = cy, ["w"] = fw, ["h"] = fh },
                ["rotated"] = false, ["trimmed"] = false,
                ["spriteSourceSize"] = new JsonObject { ["x"] = 0, ["y"] = 0, ["w"] = fw, ["h"] = fh },
                ["sourceSize"] = new JsonObject { ["w"] = fw, ["h"] = fh },
                ["duration"] = frames[i].Duration,
            };
        }
        json["frames"] = jframes;
        json["meta"] = new JsonObject
        {
            ["app"] = "NoorMD NoorSprite", ["version"] = "1", ["image"] = $"{name}.png", ["format"] = "RGBA8888",
            ["size"] = new JsonObject { ["w"] = w, ["h"] = h }, ["scale"] = scale.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["frameTags"] = new JsonArray(tags.Select(t => (JsonNode)new JsonObject { ["name"] = t.Name, ["from"] = t.From, ["to"] = t.To, ["direction"] = t.Direction, ["color"] = t.Color }).ToArray()),
            ["layers"] = new JsonArray(layers.Select(l => (JsonNode)new JsonObject { ["name"] = l.Name, ["opacity"] = l.Opacity, ["blendMode"] = l.Blend }).ToArray()),
            ["slices"] = new JsonArray(),
        };
        return (new SpriteImage(w, h, px, 0), json.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }
}

/// <summary>
/// Animated GIF (GIF89a): each frame with its own colour table (exact when it has 255 colours or fewer, else reduced
/// by median cut), transparency where alpha is under half, each frame's delay, looping for ever.
/// </summary>
public static class GifWriter
{
    public static byte[] Write(IReadOnlyList<SpriteImage> frames, bool loop = true)
    {
        if (frames.Count == 0) throw new ArgumentException("No frames.");
        int w = frames[0].Width, h = frames[0].Height;
        if (w > 65535 || h > 65535) throw new ArgumentException("Too large for a GIF.");
        using var ms = new MemoryStream();
        ms.Write("GIF89a"u8);
        Word(ms, w); Word(ms, h);
        ms.WriteByte(0); ms.WriteByte(0); ms.WriteByte(0); // no global colour table
        if (loop) { ms.Write([0x21, 0xFF, 0x0B]); ms.Write("NETSCAPE2.0"u8); ms.Write([3, 1, 0, 0, 0]); }
        foreach (var f in frames)
        {
            var (palette, indices, transparent) = Quantize(f.Rgba, w * h);
            var bits = 1;
            while ((1 << bits) < palette.Count) bits++;
            // Graphic control: restore to the background (transparent frames don't pile up), the delay in 1/100 s.
            var delay = Math.Max(2, (int)Math.Round(f.Duration / 10.0));
            ms.Write([0x21, 0xF9, 4, (byte)((2 << 2) | (transparent >= 0 ? 1 : 0))]);
            Word(ms, delay);
            ms.WriteByte((byte)Math.Max(0, transparent)); ms.WriteByte(0);
            ms.WriteByte(0x2C); Word(ms, 0); Word(ms, 0); Word(ms, w); Word(ms, h);
            ms.WriteByte((byte)(0x80 | (bits - 1))); // a local colour table of 2^bits entries
            for (var i = 0; i < 1 << bits; i++)
            {
                var c = i < palette.Count ? palette[i] : 0;
                ms.WriteByte((byte)(c >> 16)); ms.WriteByte((byte)(c >> 8)); ms.WriteByte((byte)c);
            }
            Lzw(ms, indices, Math.Max(2, bits));
        }
        ms.WriteByte(0x3B);
        return ms.ToArray();
    }

    /// <summary>A frame's colours (RGB) as indices; the transparent index, or −1 when every pixel is opaque.</summary>
    internal static (List<int> Palette, byte[] Indices, int Transparent) Quantize(byte[] rgba, int n)
    {
        var colours = new Dictionary<int, int>();
        var anyClear = false;
        for (var i = 0; i < n; i++)
        {
            if (rgba[i * 4 + 3] < 128) { anyClear = true; continue; }
            var c = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
            colours[c] = colours.GetValueOrDefault(c) + 1;
        }
        var room = anyClear ? 255 : 256;
        var palette = colours.Count <= room ? colours.Keys.ToList() : MedianCut(colours, room);
        var transparent = anyClear ? palette.Count : -1;
        if (anyClear) palette.Add(0);
        if (palette.Count < 2) palette.Add(0);
        var lookup = new Dictionary<int, byte>();
        for (var i = 0; i < palette.Count && i < 256; i++) lookup.TryAdd(palette[i], (byte)i);
        var indices = new byte[n];
        for (var i = 0; i < n; i++)
        {
            if (rgba[i * 4 + 3] < 128) { indices[i] = (byte)transparent; continue; }
            var c = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
            if (!lookup.TryGetValue(c, out var k)) { k = Nearest(palette, c, transparent); lookup[c] = k; }
            indices[i] = k;
        }
        return (palette, indices, transparent);
    }

    private static byte Nearest(List<int> palette, int c, int skip)
    {
        int best = 0, bestD = int.MaxValue;
        for (var i = 0; i < palette.Count; i++)
        {
            if (i == skip) continue;
            int dr = ((palette[i] >> 16) & 255) - ((c >> 16) & 255), dg = ((palette[i] >> 8) & 255) - ((c >> 8) & 255), db = (palette[i] & 255) - (c & 255);
            var d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
            if (d < bestD) { bestD = d; best = i; }
        }
        return (byte)best;
    }

    private static List<int> MedianCut(Dictionary<int, int> colours, int count)
    {
        var boxes = new List<List<(int C, int N)>> { colours.Select(kv => (kv.Key, kv.Value)).ToList() };
        while (boxes.Count < count)
        {
            // Split the box with the widest channel range at its weighted median.
            var (bi, ch, range) = (-1, 0, -1);
            for (var b = 0; b < boxes.Count; b++)
            {
                if (boxes[b].Count < 2) continue;
                for (var k = 0; k < 3; k++)
                {
                    var sh = 16 - k * 8;
                    var r = boxes[b].Max(e => (e.C >> sh) & 255) - boxes[b].Min(e => (e.C >> sh) & 255);
                    if (r > range) (bi, ch, range) = (b, sh, r);
                }
            }
            if (bi < 0) break;
            var box = boxes[bi].OrderBy(e => (e.C >> ch) & 255).ToList();
            long total = box.Sum(e => (long)e.N), acc = 0;
            var cut = 1;
            for (var i = 0; i < box.Count - 1; i++) { acc += box[i].N; if (acc * 2 >= total) { cut = i + 1; break; } }
            boxes[bi] = box[..cut]; boxes.Add(box[cut..]);
        }
        return boxes.Select(b =>
        {
            long n = b.Sum(e => (long)e.N), r = 0, g = 0, bl = 0;
            foreach (var (c, k) in b) { r += ((c >> 16) & 255) * (long)k; g += ((c >> 8) & 255) * (long)k; bl += (c & 255) * (long)k; }
            return (int)(((r / n) << 16) | ((g / n) << 8) | (bl / n));
        }).Distinct().ToList();
    }

    /// <summary>GIF's LZW: variable-width codes from minCode + 1 bits, clear and end codes, packed in 255-byte blocks.</summary>
    private static void Lzw(System.IO.Stream s, byte[] indices, int minCode)
    {
        s.WriteByte((byte)minCode);
        int clear = 1 << minCode, end = clear + 1, next = end + 1, width = minCode + 1;
        var table = new Dictionary<int, int>();
        var block = new List<byte>(256);
        int acc = 0, accBits = 0;
        void Emit(int code)
        {
            acc |= code << accBits; accBits += width;
            while (accBits >= 8)
            {
                block.Add((byte)acc); acc >>= 8; accBits -= 8;
                if (block.Count == 255) { s.WriteByte(255); s.Write(block.ToArray()); block.Clear(); }
            }
        }
        Emit(clear);
        var prefix = indices.Length > 0 ? indices[0] : 0;
        for (var i = 1; i < indices.Length; i++)
        {
            var key = (prefix << 8) | indices[i];
            if (table.TryGetValue(key, out var code)) { prefix = code; continue; }
            Emit(prefix);
            if (next < 4096)
            {
                table[key] = next++;
                if (next > (1 << width) && width < 12) width++;
            }
            else { Emit(clear); table.Clear(); next = end + 1; width = minCode + 1; }
            prefix = indices[i];
        }
        Emit(prefix);
        Emit(end);
        if (accBits > 0) block.Add((byte)acc);
        if (block.Count > 0) { s.WriteByte((byte)block.Count); s.Write(block.ToArray()); }
        s.WriteByte(0);
    }

    private static void Word(System.IO.Stream s, int v) { s.WriteByte((byte)v); s.WriteByte((byte)(v >> 8)); }
}
