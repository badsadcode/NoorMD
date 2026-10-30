using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using NoorMD.Core.Sprite;

namespace NoorMD.Core.Photo;

/// <summary>
/// Photoshop's PSD (8-bit RGB, written from Adobe's "Photoshop File Formats Specification"). Writing keeps layers,
/// groups, masks, blend modes, opacity, clipping, visibility and guides; the merged picture is the photo flattened over
/// white, so programs that only look at that still show it. Reading takes RGB and grayscale at 8 or 16 bits and turns
/// what NoorPhoto can't edit (text, smart objects, fills) into pictures. What was changed on the way is said in notes.
/// </summary>
public static class PsdFile
{
    public const string Extension = ".psd";
    /// <summary>A PSD is read whole into memory, and a byte array can't be larger than this.</summary>
    public const long MaxFileBytes = int.MaxValue;

    private const string Damaged = "That PSD file is damaged or incomplete.";

    private static readonly (string Name, string Key)[] BlendKeys =
    [
        ("normal", "norm"), ("multiply", "mul "), ("screen", "scrn"), ("overlay", "over"), ("darken", "dark"), ("lighten", "lite"),
        ("color-dodge", "div "), ("color-burn", "idiv"), ("hard-light", "hLit"), ("soft-light", "sLit"), ("difference", "diff"),
        ("exclusion", "smud"), ("hue", "hue "), ("saturation", "sat "), ("color", "colr"), ("luminosity", "lum "),
        ("linear-dodge", "lddg"), ("linear-burn", "lbrn"), ("vivid-light", "vLit"), ("linear-light", "lLit"), ("pin-light", "pLit"),
        ("hard-mix", "hMix"), ("subtract", "fsub"), ("divide", "fdiv"), ("darker-color", "dkCl"), ("lighter-color", "lgCl"), ("dissolve", "diss"),
    ];

    // ---------------------------------------------------------------- writing

    /// <summary>One layer record as the PSD has it (a picture, a group's folder, or the divider closing a group from below).</summary>
    private sealed class Rec
    {
        public string Name = "";
        public int Top, Left, Bottom, Right;
        public string Blend = "norm";
        public byte Opacity = 255;
        public bool Clip, Locked;
        public byte Flags;
        public int Section = -1; // lsct: 1 open folder, 2 closed folder, 3 divider
        public PhotoMask? Mask;
        public List<(short Id, byte[] Data)> Channels = [];
    }

    public static byte[] Write(PhotoDoc doc, out List<string> notes)
    {
        doc.Checked();
        var said = new List<string>();
        void Note(string n) { if (!said.Contains(n)) said.Add(n); }

        // The layers as a tree (a group's layers in list order), adjustment layers left out.
        var kept = doc.Layers.Where(l => l.Kind != "adjust").ToList();
        if (kept.Count < doc.Layers.Count) Note("Adjustment layers aren't in the PSD as layers; the flattened picture has them.");
        if (doc.Layers.Any(l => l.Kind == "text")) Note("Text layers are saved as pictures in the PSD.");
        if (doc.Layers.Any(l => l.Kind == "fill")) Note("Fill layers are saved as pictures in the PSD.");
        if (doc.Layers.Any(l => l.Kind == "shape")) Note("Shape layers are saved as pictures in the PSD.");
        if (doc.Layers.Any(l => l.Filters is { ValueKind: System.Text.Json.JsonValueKind.Array } f && f.GetArrayLength() > 0))
            Note("Live filters are saved applied, as part of the layers' pictures.");
        if (doc.Layers.Any(l => l.Styles is { ValueKind: System.Text.Json.JsonValueKind.Object } st && st.EnumerateObject().Any(e => e.Value.ValueKind == System.Text.Json.JsonValueKind.Object && e.Value.TryGetProperty("on", out var o) && o.ValueKind == System.Text.Json.JsonValueKind.True)))
            Note("Layer styles are saved applied, as part of the layers' pictures.");
        var keptIds = kept.Select(l => l.Id).ToHashSet();
        var children = kept.Where(l => l.Parent != null && keptIds.Contains(l.Parent)).GroupBy(l => l.Parent!).ToDictionary(g => g.Key, g => g.ToList());
        var recs = new List<Rec>();
        void Emit(IEnumerable<PhotoLayer> siblings)
        {
            foreach (var l in siblings)
            {
                if (l.Kind != "group") { recs.Add(PictureRec(l)); continue; }
                // Bottom to top, as the records go: the divider, what is in the group, then the group's folder.
                recs.Add(new Rec { Name = "</Layer group>", Flags = 0x18, Section = 3, Channels = EmptyChannels() });
                Emit(children.GetValueOrDefault(l.Id) ?? []);
                var g = Basics(l);
                g.Flags |= 0x10;
                g.Section = l.Collapsed ? 2 : 1;
                g.Channels = EmptyChannels();
                AddMask(g, l);
                recs.Add(g);
            }
        }
        Emit(kept.Where(l => l.Parent == null || !keptIds.Contains(l.Parent)));

        var o = new Out();
        o.Ascii("8BPS"); o.U16(1); o.Zeros(6); o.U16(3); o.U32(doc.Height); o.U32(doc.Width); o.U16(8); o.U16(3);
        o.U32(0); // colour mode data
        // Image resources: the guides (resource 1032), positions in 1/32 pixel.
        var res = o.Start();
        if (doc.Guides is { Count: > 0 } guides)
        {
            o.Ascii("8BIM"); o.U16(1032); o.U16(0);
            o.U32(16 + guides.Count * 5);
            o.U32(1); o.U32(576); o.U32(576); o.U32(guides.Count);
            foreach (var gd in guides) { o.I32((int)Math.Round(gd.At * 32)); o.U8(gd.Axis == "x" ? (byte)0 : (byte)1); }
            if (guides.Count % 2 == 1) o.U8(0);
        }
        o.End(res);

        // Layer and mask information.
        var lm = o.Start();
        if (recs.Count > 0)
        {
            var li = o.Start();
            o.I16((short)recs.Count);
            foreach (var r in recs) WriteRecord(o, r);
            foreach (var r in recs) foreach (var c in r.Channels) o.Bytes(c.Data);
            o.Pad(li, 4);
            o.End(li);
        }
        else o.U32(0);
        o.U32(0); // global layer mask info
        o.End(lm);

        // The merged picture: the photo flattened over white, RLE.
        var rgba = Composite(doc);
        var n = doc.Width * doc.Height;
        for (var i = 0; i < n; i++)
        {
            int a = rgba[i * 4 + 3];
            if (a == 255) continue;
            for (var c = 0; c < 3; c++) rgba[i * 4 + c] = (byte)((rgba[i * 4 + c] * a + 255 * (255 - a) + 127) / 255);
            rgba[i * 4 + 3] = 255;
        }
        o.U16(1);
        var planes = Enumerable.Range(0, 3).Select(c => Rle(rgba, c, doc.Width, doc.Height)).ToList();
        foreach (var (counts, _) in planes) o.Bytes(counts);
        foreach (var (_, data) in planes) o.Bytes(data);
        notes = said;
        return o.ToArray();
    }

    private static Rec Basics(PhotoLayer l) => new()
    {
        Name = l.Name, Blend = BlendKeys.FirstOrDefault(b => b.Name == l.Blend).Key ?? "norm", Opacity = (byte)Math.Round(l.Opacity * 255),
        Clip = l.Clip, Locked = l.Locked, Flags = (byte)(0x08 | (l.Visible ? 0 : 0x02)),
    };

    private static Rec PictureRec(PhotoLayer l)
    {
        var r = Basics(l);
        if (l.Png != null)
        {
            var (w, h, rgba) = SpritePng.Decode(PhotoDoc.PngBytes(l.Png), PhotoDoc.MaxLayerSide);
            if (w != l.Width || h != l.Height) throw new InvalidDataException($"A layer's picture doesn't match its size ({l.Name}).");
            (r.Top, r.Left, r.Bottom, r.Right) = (l.Y, l.X, l.Y + h, l.X + w);
            foreach (var (id, c) in new (short, int)[] { (-1, 3), (0, 0), (1, 1), (2, 2) })
            {
                var (counts, data) = Rle(rgba, c, w, h);
                r.Channels.Add((id, [0, 1, .. counts, .. data]));
            }
        }
        else r.Channels = EmptyChannels();
        AddMask(r, l);
        return r;
    }

    private static void AddMask(Rec r, PhotoLayer l)
    {
        if (l.Mask == null) return;
        r.Mask = l.Mask;
        if (l.Mask.Png == null) { r.Channels.Add((-2, [0, 0])); return; }
        var (w, h, grey) = SpritePng.Decode(PhotoDoc.PngBytes(l.Mask.Png), PhotoDoc.MaxLayerSide);
        if (w != l.Mask.Width || h != l.Mask.Height) throw new InvalidDataException($"A layer mask doesn't match its size ({l.Name}).");
        var (counts, data) = Rle(grey, 0, w, h);
        r.Channels.Add((-2, [0, 1, .. counts, .. data]));
    }

    private static List<(short, byte[])> EmptyChannels() => [(-1, [0, 0]), (0, [0, 0]), (1, [0, 0]), (2, [0, 0])];

    private static void WriteRecord(Out o, Rec r)
    {
        o.I32(r.Top); o.I32(r.Left); o.I32(r.Bottom); o.I32(r.Right);
        o.U16(r.Channels.Count);
        foreach (var (id, data) in r.Channels) { o.I16(id); o.U32(data.Length); }
        o.Ascii("8BIM"); o.Ascii(r.Blend);
        o.U8(r.Opacity); o.U8(r.Clip ? (byte)1 : (byte)0); o.U8(r.Flags); o.U8(0);
        var extra = o.Start();
        if (r.Mask is { } m)
        {
            o.U32(20);
            var (mw, mh) = m.Png == null ? (0, 0) : (m.Width, m.Height); // a mask with no picture is all its background
            o.I32(m.Y); o.I32(m.X); o.I32(m.Y + mh); o.I32(m.X + mw);
            o.U8((byte)m.Background); o.U8(m.Enabled ? (byte)0 : (byte)2); o.U16(0);
        }
        else o.U32(0);
        o.U32(0); // blending ranges
        // The name as a Pascal string (plain ASCII; the real name is in luni), padded to 4.
        var ascii = r.Name.Select(ch => ch is >= ' ' and < (char)127 ? (byte)ch : (byte)'?').Take(255).ToArray();
        o.U8((byte)ascii.Length); o.Bytes(ascii); o.Zeros((4 - (1 + ascii.Length) % 4) % 4);
        var uni = o.Block("luni");
        o.U32(r.Name.Length); o.Bytes(Encoding.BigEndianUnicode.GetBytes(r.Name));
        o.Pad(uni, 4); o.End(uni);
        if (r.Section >= 0)
        {
            var s = o.Block("lsct");
            o.U32(r.Section); o.Ascii("8BIM"); o.Ascii(r.Blend);
            o.End(s);
        }
        if (r.Locked) { var s = o.Block("lspf"); o.U32(0x80000000u); o.End(s); }
        o.End(extra);
    }

    /// <summary>One channel of an interleaved RGBA picture packed with PackBits, row by row: the rows' byte counts, then the rows.</summary>
    private static (byte[] Counts, byte[] Data) Rle(byte[] rgba, int channel, int w, int h)
    {
        var counts = new byte[h * 2];
        var data = new byte[(long)h * (w + (w + 127) / 128)];
        var row = new byte[w];
        var at = 0;
        for (var y = 0; y < h; y++)
        {
            for (int x = 0, i = (y * w) * 4 + channel; x < w; x++, i += 4) row[x] = rgba[i];
            var start = at;
            at = PackRow(row, data, at);
            BinaryPrimitives.WriteUInt16BigEndian(counts.AsSpan(y * 2), (ushort)(at - start));
        }
        Array.Resize(ref data, at);
        return (counts, data);
    }

    private static int PackRow(byte[] row, byte[] dst, int at)
    {
        var n = row.Length;
        for (var i = 0; i < n;)
        {
            var run = 1;
            while (i + run < n && run < 128 && row[i + run] == row[i]) run++;
            if (run >= 3) { dst[at++] = (byte)(1 - run); dst[at++] = row[i]; i += run; continue; }
            var j = i;
            while (j < n && j - i < 128 && !(j + 2 < n && row[j] == row[j + 1] && row[j] == row[j + 2])) j++;
            dst[at++] = (byte)(j - i - 1);
            Array.Copy(row, i, dst, at, j - i);
            at += j - i;
            i = j;
        }
        return at;
    }

    /// <summary>
    /// The flattened picture: the page's composite when it sent one, else a plain flatten (normal blending, opacity,
    /// masks and hidden groups; blend modes and clipping are not worked out here).
    /// </summary>
    private static byte[] Composite(PhotoDoc doc)
    {
        if (doc.Composite != null)
        {
            var (w, h, px) = SpritePng.Decode(PhotoDoc.PngBytes(doc.Composite), PhotoDoc.MaxSide);
            if (w == doc.Width && h == doc.Height) return px;
        }
        var W = doc.Width; var H = doc.Height;
        var acc = new float[W * H * 4]; // premultiplied
        var byId = doc.Layers.ToDictionary(l => l.Id);
        foreach (var l in doc.Layers)
        {
            if (l.Kind is "group" or "adjust" || l.Png == null) continue;
            double op = 1; var shown = true;
            for (var p = l; p != null; p = p.Parent != null ? byId[p.Parent] : null) { op *= p.Opacity; shown &= p.Visible; }
            if (!shown || op <= 0) continue;
            var (lw, lh, px) = SpritePng.Decode(PhotoDoc.PngBytes(l.Png), PhotoDoc.MaxLayerSide);
            byte[]? mask = null; var m = l.Mask is { Enabled: true } mm ? mm : null;
            if (m?.Png != null) mask = SpritePng.Decode(PhotoDoc.PngBytes(m.Png), PhotoDoc.MaxLayerSide).Rgba;
            for (var y = Math.Max(0, l.Y); y < Math.Min(H, l.Y + lh); y++)
                for (var x = Math.Max(0, l.X); x < Math.Min(W, l.X + lw); x++)
                {
                    var s = ((y - l.Y) * lw + (x - l.X)) * 4;
                    var a = px[s + 3] / 255f * (float)op;
                    if (m != null)
                    {
                        int mx = x - m.X, my = y - m.Y;
                        a *= (mask != null && mx >= 0 && my >= 0 && mx < m.Width && my < m.Height ? mask[(my * m.Width + mx) * 4] : m.Background) / 255f;
                    }
                    if (a <= 0) continue;
                    var d = (y * W + x) * 4;
                    for (var c = 0; c < 3; c++) acc[d + c] = px[s + c] * a + acc[d + c] * (1 - a);
                    acc[d + 3] = a + acc[d + 3] * (1 - a);
                }
        }
        var outPx = new byte[W * H * 4];
        for (var i = 0; i < W * H; i++)
        {
            var a = acc[i * 4 + 3];
            if (a <= 0) continue;
            for (var c = 0; c < 3; c++) outPx[i * 4 + c] = (byte)Math.Clamp(MathF.Round(acc[i * 4 + c] / a), 0, 255);
            outPx[i * 4 + 3] = (byte)Math.Clamp(MathF.Round(a * 255), 0, 255);
        }
        return outPx;
    }

    /// <summary>A big-endian writer with lengths filled in afterwards.</summary>
    private sealed class Out
    {
        private readonly MemoryStream s = new();
        public void U8(byte v) => s.WriteByte(v);
        public void U16(int v) { Span<byte> b = stackalloc byte[2]; BinaryPrimitives.WriteUInt16BigEndian(b, (ushort)v); s.Write(b); }
        public void I16(short v) { Span<byte> b = stackalloc byte[2]; BinaryPrimitives.WriteInt16BigEndian(b, v); s.Write(b); }
        public void U32(long v) { Span<byte> b = stackalloc byte[4]; BinaryPrimitives.WriteUInt32BigEndian(b, (uint)v); s.Write(b); }
        public void I32(int v) { Span<byte> b = stackalloc byte[4]; BinaryPrimitives.WriteInt32BigEndian(b, v); s.Write(b); }
        public void Ascii(string v) => s.Write(Encoding.ASCII.GetBytes(v));
        public void Bytes(byte[] v) => s.Write(v);
        public void Zeros(int n) { for (var i = 0; i < n; i++) s.WriteByte(0); }
        /// <summary>A 4-byte length to be filled in by <see cref="End"/>; returns where it is.</summary>
        public long Start() { var at = s.Position; U32(0); return at; }
        public long Block(string key) { Ascii("8BIM"); Ascii(key); return Start(); }
        public void Pad(long start, int to) { while ((s.Position - start - 4) % to != 0) s.WriteByte(0); }
        public void End(long start)
        {
            var len = s.Position - start - 4;
            if (len > uint.MaxValue) throw new InvalidDataException("The photo is too large for a PSD file.");
            BinaryPrimitives.WriteUInt32BigEndian(s.GetBuffer().AsSpan((int)start, 4), (uint)len);
        }
        public byte[] ToArray() => s.ToArray();
    }

    // ---------------------------------------------------------------- reading

    /// <summary>A layer record as read, with where its channels' data is in the file.</summary>
    private sealed class Raw
    {
        public int Top, Left, Bottom, Right;
        public List<(short Id, int At, int Length)> Channels = [];
        public string Blend = "norm";
        public byte Opacity, Clip, Flags;
        public string Name = "";
        public string? Unicode;
        public int Section = -1;
        public bool Locked, Text, Smart, Fill, Adjust, Effects;
        public bool HasMask;
        public int MTop, MLeft, MBottom, MRight;
        public byte MColour, MFlags;
    }

    private static readonly HashSet<string> AdjustKeys =
        ["levl", "curv", "brit", "blnc", "hue2", "hue ", "selc", "mixr", "grdm", "thrs", "nvrt", "post", "phfl", "expA", "vibA", "blwh", "clrL"];

    public static (PhotoDoc Doc, List<string> Notes) Read(byte[] psd)
    {
        var notes = new List<string>();
        void Note(string n) { if (!notes.Contains(n)) notes.Add(n); }
        var r = new In(psd, 0, psd.Length);
        if (psd.Length < 26 || !psd.AsSpan(0, 4).SequenceEqual("8BPS"u8)) throw new InvalidDataException("That isn't a Photoshop (PSD) file.");
        r.Skip(4);
        var version = r.U16();
        if (version == 2) throw new InvalidDataException("Large documents (PSB) can't be opened yet.");
        if (version != 1) throw new InvalidDataException("That isn't a Photoshop (PSD) file.");
        r.Skip(6);
        var channels = r.U16();
        int height = r.I32(), width = r.I32();
        int depth = r.U16(), mode = r.U16();
        if (channels is < 1 or > 56 || width < 1 || height < 1 || width > 300000 || height > 300000) throw new InvalidDataException(Damaged);
        if (mode is not (1 or 3))
            throw new InvalidDataException($"Only RGB and grayscale PSD files can be opened (this one is {mode switch { 0 => "bitmap", 2 => "indexed colour", 4 => "CMYK", 7 => "multichannel", 8 => "duotone", 9 => "Lab", _ => "in an unknown mode" }}).");
        if (depth == 32) throw new InvalidDataException("PSD files with 32 bits per channel can't be opened yet.");
        if (depth != 8 && depth != 16) throw new InvalidDataException(Damaged);
        if (width > PhotoDoc.MaxSide || height > PhotoDoc.MaxSide) throw new InvalidDataException($"That picture is {width} × {height} pixels; NoorPhoto opens pictures up to {PhotoDoc.MaxSide} pixels a side.");
        if (mode == 1 && channels < 1 || mode == 3 && channels < 3) throw new InvalidDataException(Damaged);
        if (depth == 16) Note("The picture had 16 bits per channel; it comes in with 8.");
        if (mode == 1) Note("The grey picture comes in as colour (RGB).");

        r.Skip(r.Len()); // colour mode data
        var guides = new List<PhotoGuide>();
        var resEnd = r.Len() + r.P;
        while (r.P + 12 <= resEnd)
        {
            if (!r.Is("8BIM")) break;
            r.Skip(4);
            var id = r.U16();
            var nameLen = r.U8(); r.Skip(nameLen + (nameLen + 1) % 2);
            var size = r.Len();
            var dataAt = r.P;
            if (dataAt + size > resEnd) throw new InvalidDataException(Damaged);
            if (id == 1032 && size >= 16)
            {
                var g = new In(psd, dataAt, dataAt + size);
                g.Skip(12);
                var count = g.I32();
                for (var i = 0; i < count && g.P + 5 <= g.End; i++) { var at = g.I32(); var dir = g.U8(); guides.Add(new PhotoGuide { Axis = dir == 0 ? "x" : "y", At = at / 32.0 }); }
            }
            r.P = dataAt + size + size % 2;
        }
        r.P = resEnd;

        // Layer and mask information.
        var lmEnd = r.Len() + r.P;
        List<Raw>? raws = null;
        var mergedAlpha = false;
        if (lmEnd > r.P)
        {
            var liLen = r.Len();
            var liEnd = r.P + liLen;
            if (liLen > 0) (raws, mergedAlpha) = LayerInfo(new In(psd, r.P, liEnd));
            r.P = liEnd;
            if (r.P + 4 <= lmEnd)
            {
                var global = r.Len(); // global layer mask info
                if (r.P + global > lmEnd) throw new InvalidDataException(Damaged);
                r.Skip(global);
            }
            // 16-bit files keep their layers in an Lr16 block here instead.
            while (r.P + 12 <= lmEnd && (r.Is("8BIM") || r.Is("8B64")))
            {
                r.Skip(4);
                var key = Encoding.ASCII.GetString(psd, r.P, 4); r.Skip(4);
                var len = r.Len();
                if (r.P + len > lmEnd) throw new InvalidDataException(Damaged);
                if (key is "Lr16" or "Layr" && (raws == null || raws.Count == 0)) (raws, mergedAlpha) = LayerInfo(new In(psd, r.P, r.P + len));
                r.P += len;
                while (r.P < lmEnd && r.P % 2 == 1 && !(r.Is("8BIM") || r.Is("8B64"))) r.P++;
            }
        }
        r.P = lmEnd;

        // The merged picture.
        byte[]? merged = null;
        if (r.P + 2 <= psd.Length) merged = Merged(r, width, height, depth, mode, channels, mergedAlpha);

        var doc = new PhotoDoc { Width = width, Height = height, Guides = guides.Count > 0 ? guides : null };
        if (merged != null) doc.Composite = Convert.ToBase64String(SpritePng.Encode(width, height, merged, CompressionLevel.Fastest));
        var next = 0;
        string NewId() => "l" + ++next;

        if (raws is { Count: > 0 })
        {
            var stack = new List<List<PhotoLayer>> { new() };
            foreach (var raw in raws)
            {
                if (raw.Section == 3) { stack.Add([]); continue; }
                var l = new PhotoLayer
                {
                    Id = NewId(), Name = string.IsNullOrWhiteSpace(raw.Unicode) ? raw.Name : raw.Unicode,
                    Visible = (raw.Flags & 0x02) == 0, Opacity = raw.Opacity / 255.0, Clip = raw.Clip != 0, Locked = raw.Locked,
                };
                var blend = BlendKeys.FirstOrDefault(b => b.Key == raw.Blend).Name;
                if (blend == null && raw.Blend != "pass") Note("Some blend modes aren't available here; those layers use Normal.");
                l.Blend = blend ?? "normal";
                if (raw.Section is 1 or 2)
                {
                    l.Kind = "group"; l.Collapsed = raw.Section == 2;
                    ReadMask(psd, raw, l, depth, Note);
                    var inside = stack.Count > 1 ? stack[^1] : [];
                    if (stack.Count > 1) stack.RemoveAt(stack.Count - 1);
                    foreach (var c in inside) c.Parent ??= l.Id;
                    stack[^1].AddRange(inside);
                    stack[^1].Add(l);
                    continue;
                }
                int w = raw.Right - raw.Left, h = raw.Bottom - raw.Top;
                if (w < 0 || h < 0) throw new InvalidDataException(Damaged);
                if (raw.Adjust && (w == 0 || h == 0)) { Note("Adjustment layers were left out; the flattened picture still has them."); continue; }
                if (raw.Fill && (w == 0 || h == 0)) { Note("Fill layers without pixels were left out; the flattened picture still has them."); continue; }
                if (w > PhotoDoc.MaxLayerSide || h > PhotoDoc.MaxLayerSide) { Note("A layer too large to open was left out."); continue; }
                if (raw.Text) Note("Text layers come in as pictures.");
                else if (raw.Smart) Note("Smart objects come in as pictures.");
                else if (raw.Fill) Note("Fill layers come in as pictures.");
                else if (raw.Adjust) Note("Adjustment layers come in as pictures.");
                if (raw.Effects) Note("Layer styles (shadows, strokes and the like) aren't kept; the flattened picture has them.");
                (l.X, l.Y, l.Width, l.Height) = (raw.Left, raw.Top, w, h);
                if (w > 0 && h > 0)
                {
                    var px = new byte[w * h * 4];
                    var hasAlpha = false;
                    var ok = true;
                    foreach (var (id, at, len) in raw.Channels)
                    {
                        if (id is < -1 or > 2 || mode == 1 && id > 0) continue;
                        var plane = Channel(psd, at, len, w, h, depth);
                        if (plane == null) { ok = false; continue; }
                        if (id == -1) hasAlpha = true;
                        foreach (var c in id == -1 ? [3] : mode == 1 ? [0, 1, 2] : new[] { (int)id })
                            for (int i = 0, o = c; i < plane.Length; i++, o += 4) px[o] = plane[i];
                    }
                    if (!ok) Note("Some layers' pixels are stored in a way that can't be read here; they came in empty.");
                    if (!hasAlpha && ok) for (var i = 3; i < px.Length; i += 4) px[i] = 255;
                    l.Png = Convert.ToBase64String(SpritePng.Encode(w, h, px, CompressionLevel.Fastest));
                }
                ReadMask(psd, raw, l, depth, Note);
                stack[^1].Add(l);
            }
            // A divider without its folder: what was in it stays, outside any group.
            while (stack.Count > 1) { var inside = stack[^1]; stack.RemoveAt(stack.Count - 1); stack[^1].AddRange(inside); }
            doc.Layers = stack[0];
            if (doc.Layers.Count > PhotoDoc.MaxLayers) { doc.Layers = doc.Layers.Take(PhotoDoc.MaxLayers).ToList(); Note($"Only the first {PhotoDoc.MaxLayers} layers came in."); }
        }
        if (doc.Layers.Count == 0)
        {
            if (merged == null) throw new InvalidDataException(Damaged);
            doc.Layers.Add(new PhotoLayer { Id = NewId(), Name = "Background", Width = width, Height = height, Png = doc.Composite });
        }
        return (doc.Checked(), notes);
    }

    private static void ReadMask(byte[] psd, Raw raw, PhotoLayer l, int depth, Action<string> note)
    {
        if (!raw.HasMask) return;
        int w = raw.MRight - raw.MLeft, h = raw.MBottom - raw.MTop;
        if (w < 0 || h < 0) throw new InvalidDataException(Damaged);
        if (w > PhotoDoc.MaxLayerSide || h > PhotoDoc.MaxLayerSide) { note("A layer mask too large to open was left out."); return; }
        var m = new PhotoMask { X = raw.MLeft, Y = raw.MTop, Width = w, Height = h, Background = raw.MColour >= 128 ? 255 : 0, Enabled = (raw.MFlags & 0x02) == 0 };
        var ch = raw.Channels.FirstOrDefault(c => c.Id == -2);
        if (w > 0 && h > 0 && ch.Length > 2)
        {
            var plane = Channel(psd, ch.At, ch.Length, w, h, depth);
            if (plane == null) note("Some layers' pixels are stored in a way that can't be read here; they came in empty.");
            else
            {
                var px = new byte[w * h * 4];
                for (int i = 0, o = 0; i < plane.Length; i++, o += 4) { px[o] = px[o + 1] = px[o + 2] = plane[i]; px[o + 3] = 255; }
                m.Png = Convert.ToBase64String(SpritePng.Encode(w, h, px, CompressionLevel.Fastest));
            }
        }
        else if (w > 0 && h > 0) (m.Width, m.Height) = (0, 0);
        l.Mask = m;
    }

    /// <summary>The layer records and where their pixels are (a negative count: the merged picture has transparency).</summary>
    private static (List<Raw>, bool) LayerInfo(In r)
    {
        var count = r.I16();
        var mergedAlpha = count < 0;
        var n = Math.Abs((int)count);
        if (n * 34L > r.End - r.P) throw new InvalidDataException(Damaged);
        var raws = new List<Raw>(n);
        for (var i = 0; i < n; i++)
        {
            var x = new Raw { Top = r.I32(), Left = r.I32(), Bottom = r.I32(), Right = r.I32() };
            var nc = r.U16();
            if (nc > 56) throw new InvalidDataException(Damaged);
            var lens = new List<(short, int)>();
            for (var c = 0; c < nc; c++) lens.Add(((short)r.I16(), r.Len()));
            if (!r.Is("8BIM") && !r.Is("8B64")) throw new InvalidDataException(Damaged);
            r.Skip(4);
            x.Blend = r.Ascii4();
            x.Opacity = r.U8(); x.Clip = r.U8(); x.Flags = r.U8(); r.U8();
            var extraEnd = r.Len() + r.P;
            if (extraEnd > r.End) throw new InvalidDataException(Damaged);
            var e = new In(r.Data, r.P, extraEnd);
            var maskLen = e.Len();
            var maskAt = e.P;
            if (maskLen >= 18)
            {
                x.HasMask = true;
                x.MTop = e.I32(); x.MLeft = e.I32(); x.MBottom = e.I32(); x.MRight = e.I32(); x.MColour = e.U8(); x.MFlags = e.U8();
            }
            e.P = maskAt; e.Skip(maskLen);
            e.Skip(e.Len()); // blending ranges
            var nameLen = e.U8();
            x.Name = Encoding.Latin1.GetString(e.Take(nameLen));
            e.P = Math.Min(extraEnd, e.P + (4 - (1 + nameLen) % 4) % 4);
            while (e.P + 12 <= extraEnd && (e.Is("8BIM") || e.Is("8B64")))
            {
                e.Skip(4);
                var key = e.Ascii4();
                var len = e.Len();
                if (e.P + len > extraEnd) break;
                var d = new In(r.Data, e.P, e.P + len);
                switch (key)
                {
                    case "luni" when len >= 4:
                        var chars = d.I32();
                        if (chars >= 0 && chars * 2L <= len - 4) x.Unicode = Encoding.BigEndianUnicode.GetString(d.Take(chars * 2)).TrimEnd('\0');
                        break;
                    case "lsct" or "lsdk" when len >= 4: x.Section = d.I32(); if (len >= 12) { d.Skip(4); x.Blend = d.Ascii4(); } break;
                    case "lspf" when len >= 4: x.Locked = (d.I32() & unchecked((int)0x80000006)) != 0; break;
                    case "TySh" or "tySh": x.Text = true; break;
                    case "SoLd" or "PlLd" or "plLd" or "SoLE": x.Smart = true; break;
                    case "SoCo" or "GdFl" or "PtFl": x.Fill = true; break;
                    case "lfx2" or "lrFX" or "lmfx": x.Effects = true; break;
                    default: if (AdjustKeys.Contains(key)) x.Adjust = true; break;
                }
                e.P += len;
                if (e.P < extraEnd && len % 2 == 1 && !(e.Is("8BIM") || e.Is("8B64"))) e.P++;
            }
            if (x.Section is not (1 or 2 or 3)) x.Section = -1;
            r.P = extraEnd;
            x.Channels = lens.Select(t => (t.Item1, 0, t.Item2)).ToList();
            raws.Add(x);
        }
        // The channels' data, in record order.
        foreach (var x in raws)
            for (var c = 0; c < x.Channels.Count; c++)
            {
                var (id, _, len) = x.Channels[c];
                if (r.P + (long)len > r.End) throw new InvalidDataException(Damaged);
                x.Channels[c] = (id, r.P, len);
                r.P += len;
            }
        return (raws, mergedAlpha);
    }

    /// <summary>One layer channel as 8-bit values, or null when it is compressed in a way not read here.</summary>
    private static byte[]? Channel(byte[] psd, int at, int len, int w, int h, int depth)
    {
        if (len < 2) throw new InvalidDataException(Damaged);
        var r = new In(psd, at, at + len);
        var comp = r.U16();
        var plane = new byte[w * h];
        var rowBytes = w * depth / 8;
        var row = new byte[rowBytes];
        switch (comp)
        {
            case 0:
                if ((long)rowBytes * h > len - 2) throw new InvalidDataException(Damaged);
                for (var y = 0; y < h; y++) { r.Take(rowBytes).CopyTo(row); Narrow(row, plane, y * w, w, depth); }
                return plane;
            case 1:
                var data = r.P + h * 2;
                if (data > r.End) throw new InvalidDataException(Damaged);
                for (var y = 0; y < h; y++)
                {
                    var n = BinaryPrimitives.ReadUInt16BigEndian(psd.AsSpan(r.P + y * 2));
                    if (data + n > r.End) throw new InvalidDataException(Damaged);
                    Unpack(psd.AsSpan(data, n), row);
                    data += n;
                    Narrow(row, plane, y * w, w, depth);
                }
                return plane;
            case 2 or 3:
                using (var z = new ZLibStream(new MemoryStream(psd, r.P, r.End - r.P), CompressionMode.Decompress))
                    for (var y = 0; y < h; y++) { Inflate(z, row, comp == 3, depth); Narrow(row, plane, y * w, w, depth); }
                return plane;
            default:
                return null;
        }
    }

    /// <summary>The merged picture as RGBA (opaque unless the file says its first extra channel is the transparency).</summary>
    private static byte[] Merged(In r, int w, int h, int depth, int mode, int channels, bool alpha)
    {
        var comp = r.U16();
        var colours = mode == 1 ? 1 : 3;
        var use = Math.Min(channels, colours + (alpha ? 1 : 0));
        var rowBytes = w * depth / 8;
        var row = new byte[rowBytes];
        var px = new byte[w * h * 4];
        if (use == colours) for (var i = 3; i < px.Length; i += 4) px[i] = 255;
        var plane = new byte[w * h];
        void Place(int c)
        {
            foreach (var t in c == colours ? [3] : mode == 1 ? [0, 1, 2] : new[] { c })
                for (int i = 0, o = t; i < plane.Length; i++, o += 4) px[o] = plane[i];
        }
        switch (comp)
        {
            case 0:
                if ((long)rowBytes * h * use > r.End - r.P) throw new InvalidDataException(Damaged);
                for (var c = 0; c < use; c++)
                {
                    for (var y = 0; y < h; y++) { r.Take(rowBytes).CopyTo(row); Narrow(row, plane, y * w, w, depth); }
                    Place(c);
                }
                break;
            case 1:
                var counts = r.P;
                if (counts + (long)channels * h * 2 > r.End) throw new InvalidDataException(Damaged);
                var data = counts + channels * h * 2;
                for (var c = 0; c < use; c++)
                {
                    for (var y = 0; y < h; y++)
                    {
                        var n = BinaryPrimitives.ReadUInt16BigEndian(r.Data.AsSpan(counts + (c * h + y) * 2));
                        if (data + n > r.End) throw new InvalidDataException(Damaged);
                        Unpack(r.Data.AsSpan(data, n), row);
                        data += n;
                        Narrow(row, plane, y * w, w, depth);
                    }
                    Place(c);
                }
                break;
            case 2 or 3:
                using (var z = new ZLibStream(new MemoryStream(r.Data, r.P, r.End - r.P), CompressionMode.Decompress))
                    for (var c = 0; c < use; c++)
                    {
                        for (var y = 0; y < h; y++) { Inflate(z, row, comp == 3, depth); Narrow(row, plane, y * w, w, depth); }
                        Place(c);
                    }
                break;
            default:
                throw new InvalidDataException(Damaged);
        }
        return px;
    }

    /// <summary>PackBits: a count byte n, then n+1 bytes as they are (n ≥ 0) or one byte 1−n times (n &lt; 0; −128 is nothing).</summary>
    private static void Unpack(ReadOnlySpan<byte> src, byte[] row)
    {
        int i = 0, o = 0;
        while (i < src.Length && o < row.Length)
        {
            var n = (sbyte)src[i++];
            if (n >= 0)
            {
                var k = n + 1;
                if (i + k > src.Length) throw new InvalidDataException(Damaged);
                k = Math.Min(k, row.Length - o);
                src.Slice(i, k).CopyTo(row.AsSpan(o));
                i += n + 1; o += k;
            }
            else if (n != -128)
            {
                if (i >= src.Length) throw new InvalidDataException(Damaged);
                var k = Math.Min(1 - n, row.Length - o);
                row.AsSpan(o, k).Fill(src[i++]);
                o += k;
            }
        }
        if (o < row.Length) row.AsSpan(o).Clear();
    }

    /// <summary>One row of a ZIP-compressed channel, with the row's prediction undone (each value adds the one before).</summary>
    private static void Inflate(System.IO.Stream z, byte[] row, bool predicted, int depth)
    {
        try { z.ReadExactly(row); }
        catch (Exception ex) when (ex is EndOfStreamException or InvalidDataException) { throw new InvalidDataException(Damaged); }
        if (!predicted) return;
        if (depth == 8) { for (var i = 1; i < row.Length; i++) row[i] += row[i - 1]; return; }
        for (var i = 2; i + 1 < row.Length; i += 2)
        {
            var v = (ushort)((row[i] << 8 | row[i + 1]) + (row[i - 2] << 8 | row[i - 1]));
            row[i] = (byte)(v >> 8); row[i + 1] = (byte)v;
        }
    }

    /// <summary>A row into 8-bit values (16-bit ones scaled, rounding).</summary>
    private static void Narrow(byte[] row, byte[] plane, int at, int w, int depth)
    {
        if (depth == 8) { Array.Copy(row, 0, plane, at, w); return; }
        for (var x = 0; x < w; x++) plane[at + x] = (byte)(((row[x * 2] << 8 | row[x * 2 + 1]) * 255 + 32767) / 65535);
    }

    /// <summary>A big-endian reader that refuses to go past its end.</summary>
    private sealed class In(byte[] data, int start, int end)
    {
        public readonly byte[] Data = data;
        public readonly int End = end >= start && end <= data.Length ? end : throw new InvalidDataException(Damaged);
        public int P = start;

        private ReadOnlySpan<byte> Need(int n)
        {
            if (n < 0 || (long)P + n > End) throw new InvalidDataException(Damaged);
            var s = Data.AsSpan(P, n);
            P += n;
            return s;
        }

        public byte U8() => Need(1)[0];
        public int U16() => BinaryPrimitives.ReadUInt16BigEndian(Need(2));
        public short I16() => BinaryPrimitives.ReadInt16BigEndian(Need(2));
        public int I32() => BinaryPrimitives.ReadInt32BigEndian(Need(4));
        /// <summary>A length that must fit in what is left.</summary>
        public int Len()
        {
            var v = BinaryPrimitives.ReadUInt32BigEndian(Need(4));
            if (v > End - P) throw new InvalidDataException(Damaged);
            return (int)v;
        }
        public void Skip(int n) => Need(n);
        public ReadOnlySpan<byte> Take(int n) => Need(n);
        public string Ascii4() => Encoding.ASCII.GetString(Need(4));
        public bool Is(string sig) => P + 4 <= End && Data.AsSpan(P, 4).SequenceEqual(Encoding.ASCII.GetBytes(sig));
    }
}
