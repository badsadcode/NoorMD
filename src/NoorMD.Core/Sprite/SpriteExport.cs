using System.Text.Json;
using System.Text.Json.Nodes;

namespace NoorMD.Core.Sprite;

/// <summary>A sprite's frame as composed (all its visible layers), RGBA, and how long it shows.</summary>
public sealed record SpriteImage(int Width, int Height, byte[] Rgba, int Duration);

/// <summary>Exports of composed frames: scaled up by whole numbers, sprite sheets (with an Aseprite-style JSON), GIF.</summary>
public static class SpriteExport
{

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

    public static readonly string[] Layouts = ["row", "column", "grid", "packed"];

    /// <summary>Where a frame went on a sheet: its rectangle, and (trimmed) where that sits in the full frame.</summary>
    public sealed record SheetFrame(int X, int Y, int W, int H, int OffX, int OffY, int SrcW, int SrcH, int Duration, bool Trimmed);

    /// <summary>
    /// Frames laid out in one picture: a row, a column, a grid nearly square — or packed: each frame trimmed to what
    /// it shows, frames that are the same stored once, packed in rows (smallest sheet, for engines that read the JSON).
    /// </summary>
    public static (SpriteImage Sheet, List<SheetFrame> Frames) Pack(IReadOnlyList<SpriteImage> frames, string layout, int spacing)
    {
        if (frames.Count == 0) throw new ArgumentException("No frames.");
        int fw = frames[0].Width, fh = frames[0].Height, n = frames.Count;
        spacing = Math.Clamp(spacing, 0, 64);
        if (layout != "packed")
        {
            var columns = layout switch { "column" => 1, "grid" => (int)Math.Ceiling(Math.Sqrt(n)), _ => n };
            var rows = (n + columns - 1) / columns;
            int w = columns * fw + (columns - 1) * spacing, h = rows * fh + (rows - 1) * spacing;
            if ((long)w * h > 16384L * 16384) throw new InvalidOperationException("That sheet would be too large: try a grid, or a smaller scale.");
            var px = new byte[w * h * 4];
            var placed = new List<SheetFrame>();
            for (var i = 0; i < n; i++)
            {
                int cx = i % columns * (fw + spacing), cy = i / columns * (fh + spacing);
                for (var y = 0; y < fh; y++) Array.Copy(frames[i].Rgba, y * fw * 4, px, ((cy + y) * w + cx) * 4, fw * 4);
                placed.Add(new SheetFrame(cx, cy, fw, fh, 0, 0, fw, fh, frames[i].Duration, false));
            }
            return (new SpriteImage(w, h, px, 0), placed);
        }
        // Packed: trim, find the same pictures, place the different ones tallest first in rows.
        var trims = frames.Select(f => Trim(f)).ToList();
        var unique = new List<int>();          // index of the first frame of each different picture
        var sameAs = new int[n];
        var seen = new Dictionary<string, int>();
        for (var i = 0; i < n; i++)
        {
            var t = trims[i];
            var keyText = $"{t.W}x{t.H}:{Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(t.Px))}";
            if (seen.TryGetValue(keyText, out var first)) { sameAs[i] = first; continue; }
            seen[keyText] = i; sameAs[i] = i; unique.Add(i);
        }
        var area = unique.Sum(i => (long)(trims[i].W + spacing) * (trims[i].H + spacing));
        var width = Math.Max(unique.Max(i => trims[i].W), (int)Math.Ceiling(Math.Sqrt(area) * 1.1));
        var spots = new Dictionary<int, (int X, int Y)>();
        int x0 = 0, y0 = 0, rowH = 0, usedW = 0;
        foreach (var i in unique.OrderByDescending(i => trims[i].H).ThenByDescending(i => trims[i].W))
        {
            var t = trims[i];
            if (x0 > 0 && x0 + t.W > width) { x0 = 0; y0 += rowH + spacing; rowH = 0; }
            spots[i] = (x0, y0);
            x0 += t.W + spacing; rowH = Math.Max(rowH, t.H); usedW = Math.Max(usedW, x0 - spacing);
        }
        int sw = Math.Max(1, usedW), sh = Math.Max(1, y0 + rowH);
        var sheet = new byte[sw * sh * 4];
        foreach (var i in unique)
        {
            var t = trims[i]; var (sx, sy) = spots[i];
            for (var y = 0; y < t.H; y++) Array.Copy(t.Px, y * t.W * 4, sheet, ((sy + y) * sw + sx) * 4, t.W * 4);
        }
        var result = new List<SheetFrame>();
        for (var i = 0; i < n; i++)
        {
            var t = trims[sameAs[i]]; var (sx, sy) = spots[sameAs[i]];
            result.Add(new SheetFrame(sx, sy, t.W, t.H, t.X, t.Y, fw, fh, frames[i].Duration, t.W != fw || t.H != fh));
        }
        return (new SpriteImage(sw, sh, sheet, 0), result);
    }

    /// <summary>A frame cut down to its visible pixels (an empty frame: one clear pixel).</summary>
    private static (int X, int Y, int W, int H, byte[] Px) Trim(SpriteImage f)
    {
        int x0 = f.Width, y0 = f.Height, x1 = -1, y1 = -1;
        for (var y = 0; y < f.Height; y++) for (var x = 0; x < f.Width; x++) if (f.Rgba[(y * f.Width + x) * 4 + 3] != 0) { x0 = Math.Min(x0, x); x1 = Math.Max(x1, x); y0 = Math.Min(y0, y); y1 = Math.Max(y1, y); }
        if (x1 < 0) return (0, 0, 1, 1, new byte[4]);
        int w = x1 - x0 + 1, h = y1 - y0 + 1;
        var px = new byte[w * h * 4];
        for (var y = 0; y < h; y++) Array.Copy(f.Rgba, ((y0 + y) * f.Width + x0) * 4, px, y * w * 4, w * 4);
        return (x0, y0, w, h, px);
    }

    /// <summary>
    /// The sheet's JSON as Aseprite writes it (engines and libraries read it): "hash" (frames by name) or "array" (a
    /// list), each frame's place, trimming and duration; the tags, layers and slices.
    /// </summary>
    public static string Json(string name, SpriteImage sheet, IReadOnlyList<SheetFrame> frames, IReadOnlyList<SpriteTag> tags, IReadOnlyList<SpriteLayer> layers, IReadOnlyList<SpriteSlice> slices, int scale, string form = "hash")
    {
        JsonObject Frame(SheetFrame f) => new()
        {
            ["frame"] = new JsonObject { ["x"] = f.X, ["y"] = f.Y, ["w"] = f.W, ["h"] = f.H },
            ["rotated"] = false, ["trimmed"] = f.Trimmed,
            ["spriteSourceSize"] = new JsonObject { ["x"] = f.OffX, ["y"] = f.OffY, ["w"] = f.W, ["h"] = f.H },
            ["sourceSize"] = new JsonObject { ["w"] = f.SrcW, ["h"] = f.SrcH },
            ["duration"] = f.Duration,
        };
        var json = new JsonObject();
        if (form == "array")
            json["frames"] = new JsonArray(frames.Select((f, i) => { var o = Frame(f); o.Insert(0, "filename", $"{name} {i}.png"); return (JsonNode)o; }).ToArray());
        else
        {
            var jframes = new JsonObject();
            for (var i = 0; i < frames.Count; i++) jframes[$"{name} {i}.png"] = Frame(frames[i]);
            json["frames"] = jframes;
        }
        json["meta"] = new JsonObject
        {
            ["app"] = "NoorMD NoorSprite", ["version"] = "1", ["image"] = $"{name}.png", ["format"] = "RGBA8888",
            ["size"] = new JsonObject { ["w"] = sheet.Width, ["h"] = sheet.Height }, ["scale"] = scale.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["frameTags"] = new JsonArray(tags.Select(t => (JsonNode)new JsonObject { ["name"] = t.Name, ["from"] = t.From, ["to"] = t.To, ["direction"] = t.Direction, ["color"] = t.Color }).ToArray()),
            ["layers"] = new JsonArray(layers.Where(l => !l.Reference).Select(l => (JsonNode)Layer(l, layers)).ToArray()),
            ["slices"] = new JsonArray(slices.Select(sl =>
            {
                JsonNode Key(int frame, int x, int y, int w, int h)
                {
                    var key = new JsonObject { ["frame"] = frame, ["bounds"] = new JsonObject { ["x"] = x * scale, ["y"] = y * scale, ["w"] = w * scale, ["h"] = h * scale } };
                    if (sl.Nine) key["center"] = new JsonObject { ["x"] = sl.CenterX * scale, ["y"] = sl.CenterY * scale, ["w"] = sl.CenterWidth * scale, ["h"] = sl.CenterHeight * scale };
                    if (sl.HasPivot) key["pivot"] = new JsonObject { ["x"] = sl.PivotX * scale, ["y"] = sl.PivotY * scale };
                    return key;
                }
                // A slice that moves has a key for each frame it moves on (Aseprite's form).
                var keys = new List<JsonNode> { Key(0, sl.X, sl.Y, sl.Width, sl.Height) };
                foreach (var k in sl.Keys.Where(k => k.Frame > 0)) keys.Add(Key(k.Frame, k.X, k.Y, k.Width, k.Height));
                return (JsonNode)new JsonObject { ["name"] = sl.Name, ["color"] = sl.Color, ["keys"] = new JsonArray(keys.ToArray()) };
            }).ToArray()),
        };
        return json.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }

    /// <summary>A layer as Aseprite's JSON has it: a group with no blend, a layer in a group naming it.</summary>
    private static JsonNode Layer(SpriteLayer l, IReadOnlyList<SpriteLayer> all)
    {
        var o = new JsonObject { ["name"] = l.Name };
        if (l.Parent != null && all.FirstOrDefault(g => g.Id == l.Parent) is { } g) o["group"] = g.Name;
        if (l.Kind != "group") { o["opacity"] = l.Opacity; o["blendMode"] = l.Blend; }
        return o;
    }

    /// <summary>A sheet and its JSON in one go (the hash form; tags and layers).</summary>
    public static (SpriteImage Sheet, string Json) Sheet(IReadOnlyList<SpriteImage> frames, string layout, int spacing, string name, IReadOnlyList<SpriteTag> tags, IReadOnlyList<SpriteLayer> layers, int scale = 1, IReadOnlyList<SpriteSlice>? slices = null, string form = "hash")
    {
        var (sheet, placed) = Pack(frames, layout, spacing);
        return (sheet, Json(name, sheet, placed, tags, layers, slices ?? [], scale, form));
    }
}

/// <summary>
/// Godot 4 files for a sprite: SpriteFrames (.tres) with an animation per tag (or one of every frame), each frame an
/// AtlasTexture of the sheet beside it (trimmed frames put back in place by its margin), each frame's own duration; and
/// an AnimatedSprite2D scene (.tscn) using them, drawn with sharp pixels, playing the first animation.
/// </summary>
public static class GodotSprite
{
    private static string Q(string v) => "\"" + v.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    private static string F(double v) => v.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>The frames each animation plays, in order (reverse turned round, ping-pong there and back).</summary>
    public static List<(string Name, List<int> Frames)> Animations(int frameCount, IReadOnlyList<SpriteTag> tags)
    {
        if (tags.Count == 0) return [("default", Enumerable.Range(0, frameCount).ToList())];
        var names = new HashSet<string>();
        return tags.Select(t =>
        {
            var run = Enumerable.Range(t.From, t.To - t.From + 1).ToList();
            if (t.Direction == "reverse") run.Reverse();
            else if (t.Direction == "pingpong" && run.Count > 2) run.AddRange(run.Skip(1).Take(run.Count - 2).Reverse());
            var name = t.Name; var k = 2;
            while (!names.Add(name)) name = $"{t.Name} {k++}";
            return (name, run);
        }).ToList();
    }

    /// <summary>SpriteFrames using the sheet (its file name beside the .tres), each frame's duration kept (at 10 fps, × its length).</summary>
    public static string SpriteFrames(string sheetFile, IReadOnlyList<SpriteExport.SheetFrame> frames, IReadOnlyList<SpriteTag> tags)
    {
        var anims = Animations(frames.Count, tags);
        var sb = new System.Text.StringBuilder();
        sb.Append($"[gd_resource type=\"SpriteFrames\" load_steps={frames.Count + 2} format=3]\n\n");
        sb.Append($"[ext_resource type=\"Texture2D\" path={Q(sheetFile)} id=\"1_sheet\"]\n\n");
        for (var i = 0; i < frames.Count; i++)
        {
            var f = frames[i];
            sb.Append($"[sub_resource type=\"AtlasTexture\" id=\"AtlasTexture_{i}\"]\n");
            sb.Append("atlas = ExtResource(\"1_sheet\")\n");
            sb.Append($"region = Rect2({f.X}, {f.Y}, {f.W}, {f.H})\n");
            if (f.Trimmed) sb.Append($"margin = Rect2({f.OffX}, {f.OffY}, {f.SrcW - f.W}, {f.SrcH - f.H})\n");
            sb.Append('\n');
        }
        sb.Append("[resource]\nanimations = [");
        sb.Append(string.Join(", ", anims.Select(a =>
            "{\n\"frames\": [" + string.Join(", ", a.Frames.Select(fi => $"{{\n\"duration\": {F(frames[fi].Duration / 100.0)},\n\"texture\": SubResource(\"AtlasTexture_{fi}\")\n}}")) + "],\n" +
            $"\"loop\": true,\n\"name\": &{Q(a.Name)},\n\"speed\": 10.0\n}}")));
        sb.Append("]\n");
        return sb.ToString();
    }

    /// <summary>
    /// A scene with an AnimatedSprite2D, an Area2D with a CollisionShape2D for each slice (a hitbox), and an
    /// AnimationPlayer playing each tag: it turns the sprite's frames with their durations and moves and sizes the
    /// hitboxes that move with the frames, so pictures and hitboxes stay together. Sizes are in the export's pixels.
    /// </summary>
    public static string HitboxScene(string nodeName, string framesFile, IReadOnlyList<int> durations, IReadOnlyList<SpriteTag> tags, IReadOnlyList<SpriteSlice> slices, int width, int height,
        IReadOnlyDictionary<int, string>? sounds = null)
    {
        // Sounds: a frame's sound file (beside the scene), played by an AudioStreamPlayer2D when the frame comes.
        sounds ??= new Dictionary<int, string>();
        var soundFiles = sounds.Values.Distinct().ToList();
        var anims = Animations(durations.Count, tags);
        var names = new List<string>();
        foreach (var sl in slices)
        {
            var n = new string(sl.Name.Where(c => char.IsLetterOrDigit(c) || c is '_' or ' ' or '-').ToArray()).Trim();
            if (n.Length == 0) n = "Hitbox";
            var u = n; var k = 2;
            while (names.Contains(u)) u = $"{n} {k++}";
            names.Add(u);
        }
        string Pos(SpriteSlice sl, int f) { var (x, y, w, h) = sl.At(f); return $"Vector2({F(x + w / 2.0 - width / 2.0)}, {F(y + h / 2.0 - height / 2.0)})"; }
        string Size(SpriteSlice sl, int f) { var (_, _, w, h) = sl.At(f); return $"Vector2({w}, {h})"; }
        var sb = new System.Text.StringBuilder();
        sb.Append($"[gd_scene load_steps={2 + soundFiles.Count + slices.Count + anims.Count + 1} format=3]\n\n");
        sb.Append($"[ext_resource type=\"SpriteFrames\" path={Q(framesFile)} id=\"1_frames\"]\n");
        for (var i = 0; i < soundFiles.Count; i++) sb.Append($"[ext_resource type=\"AudioStream\" path={Q(soundFiles[i])} id=\"{i + 2}_sound\"]\n");
        sb.Append('\n');
        for (var i = 0; i < slices.Count; i++) sb.Append($"[sub_resource type=\"RectangleShape2D\" id=\"Shape_{i}\"]\nsize = {Size(slices[i], 0)}\n\n");
        for (var a = 0; a < anims.Count; a++)
        {
            var (name, order) = anims[a];
            var times = new List<double>(); var t = 0.0;
            foreach (var fi in order) { times.Add(t); t += durations[fi] / 1000.0; }
            var T = string.Join(", ", times.Select(F));
            var ones = string.Join(", ", times.Select(_ => "1"));
            var tracks = new List<(string Path, string Times, string Trans, string Values)>
            {
                (".:animation", "0", "1", $"&{Q(name)}"),
                (".:frame", T, ones, string.Join(", ", Enumerable.Range(0, order.Count))),
            };
            for (var i = 0; i < slices.Count; i++)
            {
                if (slices[i].Keys.Count == 0) continue;
                tracks.Add(($"{names[i]}/CollisionShape2D:position", T, ones, string.Join(", ", order.Select(fi => Pos(slices[i], fi)))));
                tracks.Add(($"{names[i]}/CollisionShape2D:shape:size", T, ones, string.Join(", ", order.Select(fi => Size(slices[i], fi)))));
            }
            sb.Append($"[sub_resource type=\"Animation\" id=\"Animation_{a}\"]\nresource_name = {Q(name)}\nlength = {F(Math.Max(0.001, t))}\nloop_mode = 1\nstep = 0.001\n");
            for (var k = 0; k < tracks.Count; k++)
            {
                var (path, times2, trans, values) = tracks[k];
                sb.Append($"tracks/{k}/type = \"value\"\ntracks/{k}/imported = false\ntracks/{k}/enabled = true\ntracks/{k}/path = NodePath({Q(path)})\ntracks/{k}/interp = 0\ntracks/{k}/loop_wrap = true\n");
                sb.Append($"tracks/{k}/keys = {{\n\"times\": PackedFloat32Array({times2}),\n\"transitions\": PackedFloat32Array({trans}),\n\"update\": 1,\n\"values\": [{values}]\n}}\n");
            }
            var heard = order.Select((fi, j) => (fi, j)).Where(x => sounds.ContainsKey(x.fi)).ToList();
            if (heard.Count > 0)
            {
                var k = tracks.Count;
                sb.Append($"tracks/{k}/type = \"audio\"\ntracks/{k}/imported = false\ntracks/{k}/enabled = true\ntracks/{k}/path = NodePath(\"Sound\")\n");
                sb.Append($"tracks/{k}/keys = {{\n\"clips\": [");
                sb.Append(string.Join(", ", heard.Select(x => $"{{\n\"end_offset\": 0.0,\n\"start_offset\": 0.0,\n\"stream\": ExtResource(\"{soundFiles.IndexOf(sounds[x.fi]) + 2}_sound\")\n}}")));
                sb.Append($"],\n\"times\": PackedFloat32Array({string.Join(", ", heard.Select(x => F(times[x.j])))})\n}}\ntracks/{k}/use_blend = true\n");
            }
            sb.Append('\n');
        }
        sb.Append("[sub_resource type=\"AnimationLibrary\" id=\"AnimationLibrary_1\"]\n_data = {\n");
        sb.Append(string.Join(",\n", anims.Select((a, i) => $"&{Q(a.Name)}: SubResource(\"Animation_{i}\")")));
        sb.Append("\n}\n\n");
        var node = new string(nodeName.Where(c => char.IsLetterOrDigit(c) || c is '_' or ' ' or '-').ToArray()).Trim();
        sb.Append($"[node name={Q(node.Length > 0 ? node : "Sprite")} type=\"AnimatedSprite2D\"]\ntexture_filter = 1\nsprite_frames = ExtResource(\"1_frames\")\nanimation = &{Q(anims[0].Name)}\n\n");
        for (var i = 0; i < slices.Count; i++)
        {
            sb.Append($"[node name={Q(names[i])} type=\"Area2D\" parent=\".\"]\n\n");
            sb.Append($"[node name=\"CollisionShape2D\" type=\"CollisionShape2D\" parent={Q(names[i])}]\nposition = {Pos(slices[i], 0)}\nshape = SubResource(\"Shape_{i}\")\n\n");
        }
        if (soundFiles.Count > 0) sb.Append("[node name=\"Sound\" type=\"AudioStreamPlayer2D\" parent=\".\"]\n\n");
        sb.Append($"[node name=\"AnimationPlayer\" type=\"AnimationPlayer\" parent=\".\"]\nlibraries = {{\n&\"\": SubResource(\"AnimationLibrary_1\")\n}}\nautoplay = {Q(anims[0].Name)}\n");
        return sb.ToString();
    }

    /// <summary>A scene with an AnimatedSprite2D of the SpriteFrames, sharp pixels, the first animation playing.</summary>
    public static string Scene(string nodeName, string framesFile, string firstAnimation)
    {
        var node = new string(nodeName.Where(c => char.IsLetterOrDigit(c) || c is '_' or ' ' or '-').ToArray()).Trim();
        return "[gd_scene load_steps=2 format=3]\n\n" +
            $"[ext_resource type=\"SpriteFrames\" path={Q(framesFile)} id=\"1_frames\"]\n\n" +
            $"[node name={Q(node.Length > 0 ? node : "Sprite")} type=\"AnimatedSprite2D\"]\n" +
            "texture_filter = 1\n" +
            "sprite_frames = ExtResource(\"1_frames\")\n" +
            $"animation = &{Q(firstAnimation)}\n" +
            $"autoplay = {Q(firstAnimation)}\n";
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

/// <summary>
/// Godot 4 files for a tilemap: the tileset's tiles in one picture (a grid), a TileSet (.tres) with an atlas of them,
/// and a scene with a TileMap (format 2) placing them as the tilemap layer does — sharp pixels.
/// </summary>
public static class GodotTiles
{
    private static string Q(string v) => "\"" + v.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

    /// <summary>How many tiles a row of the tileset's picture holds.</summary>
    public static int Columns(SpriteTileset ts) => Math.Max(1, (int)Math.Ceiling(Math.Sqrt(Math.Max(1, ts.Count))));

    /// <summary>Tiles 1…Count in a grid, row by row (tile n at column (n−1) % columns, row (n−1) / columns).</summary>
    public static SpriteImage Atlas(SpriteTileset ts)
    {
        var cols = Columns(ts);
        var rows = Math.Max(1, (ts.Count + cols - 1) / cols);
        int w = cols * ts.TileWidth, h = rows * ts.TileHeight;
        var px = new byte[w * h * 4];
        for (var n = 1; n <= ts.Count; n++)
        {
            var tile = ts.Tile(n);
            int ox = (n - 1) % cols * ts.TileWidth, oy = (n - 1) / cols * ts.TileHeight;
            for (var y = 0; y < ts.TileHeight; y++) Array.Copy(tile, y * ts.TileWidth * 4, px, ((oy + y) * w + ox) * 4, ts.TileWidth * 4);
        }
        return new SpriteImage(w, h, px, 0);
    }

    public static string TileSet(string imageFile, SpriteTileset ts)
    {
        var cols = Columns(ts);
        var sb = new System.Text.StringBuilder();
        sb.Append("[gd_resource type=\"TileSet\" load_steps=3 format=3]\n\n");
        sb.Append($"[ext_resource type=\"Texture2D\" path={Q(imageFile)} id=\"1_tiles\"]\n\n");
        sb.Append("[sub_resource type=\"TileSetAtlasSource\" id=\"TileSetAtlasSource_1\"]\n");
        sb.Append("texture = ExtResource(\"1_tiles\")\n");
        sb.Append($"texture_region_size = Vector2i({ts.TileWidth}, {ts.TileHeight})\n");
        for (var n = 1; n <= ts.Count; n++)
        {
            var at = $"{(n - 1) % cols}:{(n - 1) / cols}/0";
            sb.Append($"{at} = 0\n");
            // A tile in a terrain: which terrain, and the sides it joins on (Godot's match-sides peering bits).
            for (var t = 0; t < ts.Terrains.Count; t++)
            {
                var mask = Array.IndexOf(ts.Terrains[t].Tiles, n);
                if (mask < 0) continue;
                sb.Append($"{at}/terrain_set = 0\n{at}/terrain = {t}\n");
                foreach (var (bit, side) in new[] { (SpriteTerrain.Right, "right_side"), (SpriteTerrain.Down, "bottom_side"), (SpriteTerrain.Left, "left_side"), (SpriteTerrain.Up, "top_side") })
                    if ((mask & bit) != 0) sb.Append($"{at}/terrains_peering_bit/{side} = {t}\n");
                break;
            }
        }
        sb.Append("\n[resource]\n");
        sb.Append($"tile_size = Vector2i({ts.TileWidth}, {ts.TileHeight})\n");
        if (ts.Terrains.Count > 0)
        {
            sb.Append("terrain_set_0/mode = 2\n"); // match sides
            for (var t = 0; t < ts.Terrains.Count; t++)
            {
                var c = ts.Terrains[t].Color;
                double r = Convert.ToByte(c[1..3], 16) / 255.0, g = Convert.ToByte(c[3..5], 16) / 255.0, b = Convert.ToByte(c[5..7], 16) / 255.0;
                sb.Append($"terrain_set_0/terrain_{t}/name = {Q(ts.Terrains[t].Name)}\n");
                sb.Append(System.FormattableString.Invariant($"terrain_set_0/terrain_{t}/color = Color({r:0.###}, {g:0.###}, {b:0.###}, 1)\n"));
            }
        }
        sb.Append("sources/0 = SubResource(\"TileSetAtlasSource_1\")\n");
        return sb.ToString();
    }

    /// <summary>The cells of a TileMap (format 2) placing the cel's tiles: three numbers a cell.</summary>
    public static List<int> TileData(SpriteCel cel, SpriteTileset ts)
    {
        var cols = Columns(ts);
        var data = new List<int>();
        for (var y = 0; y < cel.Height; y++)
            for (var x = 0; x < cel.Width; x++)
            {
                var v = cel.Tiles![y * cel.Width + x];
                var n = v & SpriteTilemap.TileId;
                if (n == 0) continue;
                int ax = (n - 1) % cols, ay = (n - 1) / cols;
                // Godot's turning flags ride in the alternative: flip across 4096, down 8192, transposed 16384.
                var alt = ((v & SpriteTilemap.FlipX) != 0 ? 4096 : 0) | ((v & SpriteTilemap.FlipY) != 0 ? 8192 : 0) | ((v & SpriteTilemap.FlipD) != 0 ? 16384 : 0);
                data.Add((x & 0xFFFF) | ((y & 0xFFFF) << 16));   // the cell
                data.Add(0 | ((ax & 0xFFFF) << 16));              // source 0, atlas x
                data.Add((ay & 0xFFFF) | (alt << 16));            // atlas y, the alternative (turning)
            }
        return data;
    }

    private static string NodeName(string name, string fallback)
    {
        var node = new string(name.Where(c => char.IsLetterOrDigit(c) || c is '_' or ' ' or '-').ToArray()).Trim();
        return node.Length > 0 ? node : fallback;
    }

    /// <summary>A scene with a TileMap placing the cel's tiles (where a tile is 0, no cell).</summary>
    public static string Scene(string nodeName, string tileSetFile, SpriteCel cel, SpriteTileset ts) =>
        "[gd_scene load_steps=2 format=3]\n\n" +
        $"[ext_resource type=\"TileSet\" path={Q(tileSetFile)} id=\"1_tileset\"]\n\n" +
        $"[node name={Q(NodeName(nodeName, "TileMap"))} type=\"TileMap\"]\n" +
        "texture_filter = 1\n" +
        "tile_set = ExtResource(\"1_tileset\")\n" +
        "format = 2\n" +
        $"layer_0/tile_data = PackedInt32Array({string.Join(", ", TileData(cel, ts))})\n";

    /// <summary>One map layer for <see cref="Level"/>: its name, its TileSet file, its tiles, shown or not, opacity.</summary>
    public sealed record MapLayer(string Name, string TileSetFile, SpriteCel Cel, SpriteTileset Tileset, bool Visible, int Opacity);

    /// <summary>
    /// Every tilemap layer in one scene: a Node2D holding a TileMap per layer, bottom first (drawn in that order), each
    /// with its own TileSet, hidden or see-through as the layer is.
    /// </summary>
    public static string Level(string rootName, IReadOnlyList<MapLayer> layers)
    {
        var files = layers.Select(l => l.TileSetFile).Distinct().ToList();
        var sb = new System.Text.StringBuilder();
        sb.Append($"[gd_scene load_steps={files.Count + 1} format=3]\n\n");
        for (var i = 0; i < files.Count; i++) sb.Append($"[ext_resource type=\"TileSet\" path={Q(files[i])} id=\"{i + 1}_tileset\"]\n");
        sb.Append($"\n[node name={Q(NodeName(rootName, "Level"))} type=\"Node2D\"]\n");
        var used = new HashSet<string>();
        foreach (var l in layers)
        {
            var name = NodeName(l.Name, "Layer"); var k = 2;
            while (!used.Add(name)) name = $"{NodeName(l.Name, "Layer")} {k++}";
            sb.Append($"\n[node name={Q(name)} type=\"TileMap\" parent=\".\"]\n");
            if (!l.Visible) sb.Append("visible = false\n");
            if (l.Opacity < 255) sb.Append(System.FormattableString.Invariant($"modulate = Color(1, 1, 1, {l.Opacity / 255.0:0.###})\n"));
            sb.Append("texture_filter = 1\n");
            sb.Append($"tile_set = ExtResource(\"{files.IndexOf(l.TileSetFile) + 1}_tileset\")\n");
            sb.Append("format = 2\n");
            sb.Append($"layer_0/tile_data = PackedInt32Array({string.Join(", ", TileData(l.Cel, l.Tileset))})\n");
        }
        return sb.ToString();
    }
}
