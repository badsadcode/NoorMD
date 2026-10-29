using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using NoorMD.Core.Bridge;
using NoorMD.Core.Sprite;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// NoorSprite (docs/NOORSPRITE_PLAN.md): the page edits the sprite; the app opens and saves files (.noorsprite,
/// .aseprite), reads pictures you pick, and writes the exports the page composes (PNG, frames, sheets with JSON, GIF).
/// </summary>
public partial class MainWindow
{
    private const long SpriteMaxPicture = 64L * 1024 * 1024;
    private static string SpriteDraftFolder => Path.Combine(App.Paths.Local, "Sprite");

    private static object SpriteWire(SpriteDoc doc) => JsonDocument.Parse(doc.ToJson()).RootElement.Clone();

    /// <summary>A sprite (.noorsprite, .aseprite) or a picture, as NoorSprite opens it: the file the user chose.</summary>
    private static object SpriteOpenPath(string path)
    {
        var name = Path.GetFileName(path);
        try
        {
            if (path.EndsWith(SpriteFile.Extension, StringComparison.OrdinalIgnoreCase))
                return new { sprite = SpriteWire(SpriteFile.Load(path)), path, name, notes = Array.Empty<string>() };
            if (path.EndsWith(".aseprite", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".ase", StringComparison.OrdinalIgnoreCase))
            {
                if (new FileInfo(path).Length > SpriteFile.MaxFileBytes) throw new BridgeError("That file is too large.");
                var (doc, notes) = AsepriteFile.Read(File.ReadAllBytes(path));
                return new { sprite = SpriteWire(doc), path, name, notes };
            }
            var (w, h, rgba) = SpritePicture(path);
            if (w > SpriteDoc.MaxSide || h > SpriteDoc.MaxSide) throw new BridgeError($"A sprite is at most {SpriteDoc.MaxSide} pixels a side; that picture is {w} × {h}.");
            return new { image = new { width = w, height = h, data = Convert.ToBase64String(rgba) }, name };
        }
        catch (InvalidDataException ex) { throw new BridgeError(ex.Message); }
    }

    /// <summary>Slices measured at an export's scale (their keys too).</summary>
    private static List<SpriteSlice> ScaledSlices(List<SpriteSlice> slices, int scale) => slices.Select(x => new SpriteSlice
    {
        Name = x.Name, Color = x.Color, X = x.X * scale, Y = x.Y * scale, Width = x.Width * scale, Height = x.Height * scale, Nine = x.Nine,
        CenterX = x.CenterX * scale, CenterY = x.CenterY * scale, CenterWidth = x.CenterWidth * scale, CenterHeight = x.CenterHeight * scale,
        HasPivot = x.HasPivot, PivotX = x.PivotX * scale, PivotY = x.PivotY * scale,
        Keys = x.Keys.Select(k => new SpriteSliceKey { Frame = k.Frame, X = k.X * scale, Y = k.Y * scale, Width = k.Width * scale, Height = k.Height * scale }).ToList(),
    }).ToList();

    /// <summary>Whether a layer is inside a group (at any depth).</summary>
    private static bool IsInside(SpriteDoc doc, SpriteLayer l, string groupId)
    {
        var n = 0;
        for (var p = l.Parent; p != null && n < 64; n++) { if (p == groupId) return true; p = doc.Layers.FirstOrDefault(x => x.Id == p)?.Parent; }
        return false;
    }

    private static SpriteDoc SpriteFrom(System.Text.Json.JsonElement p)
    {
        if (!p.TryGetProperty("sprite", out var s) || s.ValueKind != JsonValueKind.Object) throw new BridgeError("Missing the sprite.");
        try { return SpriteDoc.FromJson(s.GetRawText()); }
        catch (Exception ex) when (ex is JsonException or InvalidDataException or FormatException) { throw new BridgeError("The sprite can't be saved: " + ex.Message); }
    }

    /// <summary>A picture file as RGBA (PNG read exactly; other kinds through Windows), at most 2048 × 2048 × 4.</summary>
    private static (int Width, int Height, byte[] Rgba) SpritePicture(string path)
    {
        if (new FileInfo(path).Length > SpriteMaxPicture) throw new BridgeError("That picture is too large.");
        var bytes = File.ReadAllBytes(path);
        try { if (path.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) return SpritePng.Decode(bytes); }
        catch (InvalidDataException) { /* a PNG of another kind: Windows reads it */ }
        try
        {
            var frame = BitmapDecoder.Create(new MemoryStream(bytes), BitmapCreateOptions.PreservePixelFormat | BitmapCreateOptions.IgnoreColorProfile, BitmapCacheOption.OnLoad).Frames[0];
            var conv = new FormatConvertedBitmap(frame, PixelFormats.Bgra32, null, 0);
            int w = conv.PixelWidth, h = conv.PixelHeight;
            if (w > 8192 || h > 8192) throw new BridgeError("That picture is too large (over 8192 pixels a side).");
            var px = new byte[w * h * 4];
            conv.CopyPixels(px, w * 4, 0);
            for (var i = 0; i < w * h; i++) (px[i * 4], px[i * 4 + 2]) = (px[i * 4 + 2], px[i * 4]);
            return (w, h, px);
        }
        catch (Exception ex) when (ex is NotSupportedException or FileFormatException or ArgumentException) { throw new BridgeError("That picture can't be read."); }
    }

    private async Task<object?> DispatchSpriteAsync(BridgeRequest req)
    {
        var p = req.Payload;
        switch (req.Type)
        {
            case "sprite.open":
            {
                var dlg = new OpenFileDialog
                {
                    Title = "Open a sprite or a picture",
                    Filter = "Sprites and pictures (*.noorsprite;*.aseprite;*.ase;*.png;*.gif;*.bmp;*.jpg)|*.noorsprite;*.aseprite;*.ase;*.png;*.gif;*.bmp;*.jpg|NoorSprite (*.noorsprite)|*.noorsprite|Aseprite (*.aseprite;*.ase)|*.aseprite;*.ase|Pictures (*.png;*.gif;*.bmp;*.jpg)|*.png;*.gif;*.bmp;*.jpg",
                    CheckFileExists = true,
                };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var path = dlg.FileName;
                return await Task.Run(() => SpriteOpenPath(path));
            }
            case "sprite.toTexture":
            {
                // A frame or a tileset for the Texture Bench: written as a PNG of the app's own and allowed for it.
                int w = p.GetProperty("width").GetInt32(), h = p.GetProperty("height").GetInt32();
                var data = Convert.FromBase64String(p.GetProperty("data").GetString() ?? "");
                if (w < 1 || h < 1 || w > 4096 || h > 4096 || data.Length != w * h * 4) throw new BridgeError("The picture doesn't match its size.");
                var name = NoorMD.Core.Documents.DocumentFile.SafeFileName(req.GetString("name", 120) is { Length: > 0 } n ? n : "sprite", "");
                var folder = Path.Combine(App.Paths.Local, "Sprite", "ToTexture");
                Directory.CreateDirectory(folder);
                var file = Path.Combine(folder, $"{name}-{DateTime.UtcNow:yyyyMMddHHmmssfff}.png");
                await Task.Run(() => NoorMD.Core.Documents.AtomicFile.WriteAllBytes(file, SpritePng.Encode(w, h, data)));
                _textureImageFiles.Add(Path.GetFullPath(file));
                return new { path = Path.GetFullPath(file), name = name + ".png", width = w, height = h };
            }
            case "sprite.sound.pick":
            {
                var dlg = new OpenFileDialog { Title = "A sound for this frame (a footstep, a swing…)", Filter = "Sounds (*.wav;*.ogg;*.mp3)|*.wav;*.ogg;*.mp3", CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                return new { path = dlg.FileName, name = Path.GetFileName(dlg.FileName) };
            }
            case "sprite.picture.pick":
            {
                var dlg = new OpenFileDialog { Title = "A picture to bring in", Filter = "Pictures (*.png;*.gif;*.bmp;*.jpg;*.jpeg;*.webp)|*.png;*.gif;*.bmp;*.jpg;*.jpeg;*.webp", CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var (w, h, rgba) = await Task.Run(() => SpritePicture(dlg.FileName));
                return new { image = new { width = w, height = h, data = Convert.ToBase64String(rgba) }, name = Path.GetFileNameWithoutExtension(dlg.FileName) };
            }
            case "sprite.save":
            {
                var doc = SpriteFrom(p);
                var path = req.GetString("path", 2000);
                if (string.IsNullOrEmpty(path))
                {
                    var stem = Path.GetFileNameWithoutExtension(req.GetString("name", 200) ?? "sprite");
                    var dlg = new SaveFileDialog { Title = "Save the sprite", FileName = string.IsNullOrWhiteSpace(stem) ? "sprite" : stem, Filter = "NoorSprite (*.noorsprite)|*.noorsprite|Aseprite (*.aseprite)|*.aseprite", AddExtension = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    path = dlg.FileName;
                }
                var aseprite = path.EndsWith(".aseprite", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".ase", StringComparison.OrdinalIgnoreCase);
                await Task.Run(() =>
                {
                    if (aseprite) NoorMD.Core.Documents.AtomicFile.WriteAllBytes(path, AsepriteFile.Write(doc));
                    else SpriteFile.Save(path, doc);
                });
                return new { path, name = Path.GetFileName(path) };
            }
            case "sprite.export":
            {
                var kind = req.GetString("kind", 20) ?? "sheet";
                var scale = p.TryGetProperty("scale", out var sc) && sc.TryGetInt32(out var sci) ? Math.Clamp(sci, 1, 10) : 1;
                var spacing = p.TryGetProperty("spacing", out var sp) && sp.TryGetInt32(out var spi) ? Math.Clamp(spi, 0, 64) : 0;
                var layout = req.GetString("layout", 20) is { } lay && SpriteExport.Layouts.Contains(lay) ? lay : "row";
                var stem = NoorMD.Core.Documents.DocumentFile.SafeFileName(req.GetString("name", 200) is { Length: > 0 } n ? n : "sprite", "");
                if (!p.TryGetProperty("frames", out var fr) || fr.ValueKind != JsonValueKind.Array || fr.GetArrayLength() == 0) throw new BridgeError("No frames to export.");
                var frames = new List<SpriteImage>();
                foreach (var f in fr.EnumerateArray())
                {
                    int w = f.GetProperty("width").GetInt32(), h = f.GetProperty("height").GetInt32();
                    var data = Convert.FromBase64String(f.GetProperty("data").GetString() ?? "");
                    if (w < 1 || h < 1 || w > SpriteDoc.MaxSide || h > SpriteDoc.MaxSide || data.Length != w * h * 4) throw new BridgeError("A frame doesn't match its size.");
                    frames.Add(SpriteExport.Scale(new SpriteImage(w, h, data, f.TryGetProperty("duration", out var d) ? Math.Clamp(d.GetInt32(), 1, 65535) : 100), scale));
                }
                // Normal maps of the frames (the page makes them), scaled as the frames are.
                List<SpriteImage>? normals = null;
                if (p.TryGetProperty("normals", out var nmEl) && nmEl.ValueKind == JsonValueKind.Array && nmEl.GetArrayLength() == frames.Count)
                {
                    normals = [];
                    var k = 0;
                    foreach (var nm in nmEl.EnumerateArray())
                    {
                        var d = Convert.FromBase64String(nm.GetString() ?? "");
                        var src = fr[k++];
                        int nw = src.GetProperty("width").GetInt32(), nh = src.GetProperty("height").GetInt32();
                        if (d.Length != nw * nh * 4) throw new BridgeError("A normal map doesn't match its frame.");
                        normals.Add(SpriteExport.Scale(new SpriteImage(nw, nh, d, 0), scale));
                    }
                }
                var tags = p.TryGetProperty("tags", out var tg) && tg.ValueKind == JsonValueKind.Array ? JsonSerializer.Deserialize<List<SpriteTag>>(tg.GetRawText(), SpriteDoc.Json) ?? [] : [];
                var slices = p.TryGetProperty("slices", out var sl) && sl.ValueKind == JsonValueKind.Array ? (JsonSerializer.Deserialize<List<SpriteSlice>>(sl.GetRawText(), SpriteDoc.Json) ?? []).Select(x => x.Checked(SpriteDoc.MaxSide, SpriteDoc.MaxSide)).ToList() : [];
                var form = req.GetString("form", 10) == "array" ? "array" : "hash";
                // An indexed sprite's pictures go as palette PNGs when every pixel is a palette colour.
                var indexedPalette = p.TryGetProperty("palette", out var ip) && ip.ValueKind == JsonValueKind.Array
                    ? ip.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length == 9 && x[0] == '#').Take(256).ToList() : null;
                var layers = p.TryGetProperty("layers", out var ly) && ly.ValueKind == JsonValueKind.Array ? JsonSerializer.Deserialize<List<SpriteLayer>>(ly.GetRawText(), SpriteDoc.Json) ?? [] : [];
                var (ext, filter, title) = kind switch
                {
                    "gif" => (".gif", "GIF (*.gif)|*.gif", "Export an animated GIF"),
                    "godot" => (".tres", "Godot SpriteFrames (*.tres)|*.tres", "Export for Godot (the sheet, SpriteFrames and a scene go side by side)"),
                    "unity" => (".png", "PNG (*.png)|*.png", "Export for Unity (the sheet, its .meta slicing it, an animation per tag)"),
                    "paper2d" => (".png", "PNG (*.png)|*.png", "Export for Unreal Paper2D (the sheet and its JSON)"),
                    "frames" => (".png", "PNG (*.png)|*.png", "Export every frame (named …_0.png, …_1.png …)"),
                    "frame" => (".png", "PNG (*.png)|*.png", "Export the frame"),
                    _ => (".png", "PNG (*.png)|*.png", "Export a sprite sheet (its JSON goes beside it)"),
                };
                var save = new SaveFileDialog { Title = title, FileName = stem + ext, Filter = filter, AddExtension = true };
                NativeCursor.Restore();
                if (save.ShowDialog(this) != true) return new { cancelled = true };
                var target = save.FileName;
                var dir = Path.GetDirectoryName(target)!;
                var baseName = Path.GetFileNameWithoutExtension(target);
                var written = await Task.Run(() =>
                {
                    var files = new List<string>();
                    switch (kind)
                    {
                        case "gif":
                            NoorMD.Core.Documents.AtomicFile.WriteAllBytes(target, GifWriter.Write(frames));
                            files.Add(target);
                            break;
                        case "frame":
                            NoorMD.Core.Documents.AtomicFile.WriteAllBytes(target, SpritePng.EncodeBest(frames[0].Width, frames[0].Height, frames[0].Rgba, indexedPalette));
                            files.Add(target);
                            break;
                        case "frames":
                            for (var i = 0; i < frames.Count; i++)
                            {
                                var file = Path.Combine(dir, $"{baseName}_{i}.png");
                                NoorMD.Core.Documents.AtomicFile.WriteAllBytes(file, SpritePng.EncodeBest(frames[i].Width, frames[i].Height, frames[i].Rgba, indexedPalette));
                                files.Add(file);
                            }
                            break;
                        case "unity":
                        case "paper2d":
                        {
                            // The slices measured at the export's scale (for pivots and 9-slice borders).
                            var scaled = ScaledSlices(slices, scale);
                            var (us, placed) = SpriteExport.Pack(frames, layout, spacing);
                            NoorMD.Core.Documents.AtomicFile.WriteAllBytes(target, SpritePng.EncodeBest(us.Width, us.Height, us.Rgba, indexedPalette));
                            files.Add(target);
                            if (kind == "paper2d")
                            {
                                var paperJson = Path.Combine(dir, baseName + ".json");
                                File.WriteAllText(paperJson, Paper2D.Json(baseName, Path.GetFileName(target), us, placed, scaled));
                                files.Add(paperJson);
                                break;
                            }
                            var ppu = p.TryGetProperty("pixelsPerUnit", out var pu) && pu.TryGetInt32(out var pui) ? Math.Clamp(pui, 1, 4096) : 16;
                            string? unityNormal = null;
                            if (normals != null)
                            {
                                var nsheet = SpriteExport.PlaceLike(us, placed, normals);
                                var npath = Path.Combine(dir, baseName + "_n.png");
                                NoorMD.Core.Documents.AtomicFile.WriteAllBytes(npath, SpritePng.Encode(nsheet.Width, nsheet.Height, nsheet.Rgba));
                                unityNormal = baseName + "_n";
                                File.WriteAllText(npath + ".meta", UnitySprite.PlainMeta(unityNormal));
                                files.Add(npath); files.Add(npath + ".meta");
                            }
                            File.WriteAllText(target + ".meta", UnitySprite.Meta(baseName, us, placed, scaled, ppu * scale, unityNormal));
                            files.Add(target + ".meta");
                            foreach (var (animName, order) in GodotSprite.Animations(frames.Count, tags))
                            {
                                var anim = Path.Combine(dir, $"{baseName}_{NoorMD.Core.Documents.DocumentFile.SafeFileName(animName, "")}.anim");
                                File.WriteAllText(anim, UnitySprite.Anim(animName, baseName, order, placed, true));
                                files.Add(anim);
                            }
                            break;
                        }
                        case "godot":
                        {
                            // The sheet (packed unless a layout was chosen), the SpriteFrames, and a scene to drop in.
                            var (gs, placed) = SpriteExport.Pack(frames, layout == "row" ? "packed" : layout, spacing);
                            var png = Path.Combine(dir, baseName + ".png");
                            NoorMD.Core.Documents.AtomicFile.WriteAllBytes(png, SpritePng.EncodeBest(gs.Width, gs.Height, gs.Rgba, indexedPalette));
                            string? godotNormal = null;
                            if (normals != null)
                            {
                                var nsheet = SpriteExport.PlaceLike(gs, placed, normals);
                                godotNormal = baseName + "_n.png";
                                NoorMD.Core.Documents.AtomicFile.WriteAllBytes(Path.Combine(dir, godotNormal), SpritePng.Encode(nsheet.Width, nsheet.Height, nsheet.Rgba));
                                files.Add(Path.Combine(dir, godotNormal));
                            }
                            File.WriteAllText(target, GodotSprite.SpriteFrames(baseName + ".png", placed, tags, godotNormal));
                            var scene = Path.Combine(dir, baseName + ".tscn");
                            // With hitboxes: an Area2D per slice and an AnimationPlayer keeping them with the frames.
                            // Frames' sounds: the files the sprite names, copied beside the scene.
                            var sounds = new Dictionary<int, string>();
                            if (p.TryGetProperty("sounds", out var se) && se.ValueKind == JsonValueKind.Array)
                                foreach (var s in se.EnumerateArray())
                                {
                                    var fi = s.TryGetProperty("frame", out var fe2) && fe2.TryGetInt32(out var fv) ? fv : -1;
                                    var from = s.TryGetProperty("path", out var pe) ? pe.GetString() : null;
                                    if (fi < 0 || fi >= frames.Count || string.IsNullOrEmpty(from) || !File.Exists(from) || new FileInfo(from).Length > 64L * 1024 * 1024) continue;
                                    if (Path.GetExtension(from).ToLowerInvariant() is not (".wav" or ".ogg" or ".mp3")) continue;
                                    var to = Path.Combine(dir, Path.GetFileName(from));
                                    if (!string.Equals(Path.GetFullPath(from), Path.GetFullPath(to), StringComparison.OrdinalIgnoreCase)) { File.Copy(from, to, true); files.Add(to); }
                                    sounds[fi] = Path.GetFileName(from);
                                }
                            var withHitboxes = p.TryGetProperty("hitboxes", out var hb) && hb.ValueKind == JsonValueKind.True && slices.Count > 0;
                            if (withHitboxes || sounds.Count > 0)
                                File.WriteAllText(scene, GodotSprite.HitboxScene(baseName, Path.GetFileName(target), frames.Select(f => f.Duration).ToList(), tags, withHitboxes ? ScaledSlices(slices, scale) : [], frames[0].Width, frames[0].Height, sounds));
                            else
                                File.WriteAllText(scene, GodotSprite.Scene(baseName, Path.GetFileName(target), GodotSprite.Animations(frames.Count, tags)[0].Name));
                            files.Add(png); files.Add(target); files.Add(scene);
                            break;
                        }
                        default:
                            var (sheet, json) = SpriteExport.Sheet(frames, layout, spacing, baseName, tags, layers, scale, slices.Select(x => x).ToList(), form);
                            NoorMD.Core.Documents.AtomicFile.WriteAllBytes(target, SpritePng.EncodeBest(sheet.Width, sheet.Height, sheet.Rgba, indexedPalette));
                            if (normals != null)
                            {
                                var nsheet = SpriteExport.PlaceLike(sheet, SpriteExport.Pack(frames, layout, spacing).Frames, normals);
                                var npath = Path.Combine(dir, baseName + "_n.png");
                                NoorMD.Core.Documents.AtomicFile.WriteAllBytes(npath, SpritePng.Encode(nsheet.Width, nsheet.Height, nsheet.Rgba));
                                files.Add(npath);
                            }
                            var jsonPath = Path.Combine(dir, baseName + ".json");
                            File.WriteAllText(jsonPath, json);
                            files.Add(target); files.Add(jsonPath);
                            break;
                    }
                    return files;
                });
                return new { files = written.Select(Path.GetFileName) };
            }
            case "sprite.tiles.export":
            {
                // A tilemap layer for Godot: its tileset as a picture, a TileSet (.tres) and a scene with a TileMap.
                var doc = SpriteFrom(p);
                var layerId = req.GetString("layer", 64);
                var layer = doc.Layers.FirstOrDefault(l => l.Id == layerId) ?? throw new BridgeError("No such layer.");
                if (layer.Kind != "tilemap") throw new BridgeError("That layer isn't a tilemap.");
                var ts = doc.Tilesets[layer.Tileset];
                var at = p.TryGetProperty("frame", out var fe) && fe.TryGetInt32(out var fi) ? Math.Clamp(fi, 0, doc.Frames.Count - 1) : 0;
                var cel = doc.Cels.FirstOrDefault(c => c.Layer == layer.Id && c.Frame == at)
                    ?? new SpriteCel { Layer = layer.Id, Frame = at, Width = 1, Height = 1, Tiles = [0] };
                var stem = NoorMD.Core.Documents.DocumentFile.SafeFileName(req.GetString("name", 200) is { Length: > 0 } n ? n : "tiles", "");
                if (p.TryGetProperty("all", out var allEl) && allEl.ValueKind == JsonValueKind.True)
                {
                    // Every tilemap layer in one scene: each tileset once (its picture and TileSet), a TileMap per layer.
                    var lvl = new SaveFileDialog { Title = "Export every map layer for Godot (one scene; the tilesets go beside it)", FileName = stem + ".tscn", Filter = "Godot scene (*.tscn)|*.tscn", AddExtension = true };
                    NativeCursor.Restore();
                    if (lvl.ShowDialog(this) != true) return new { cancelled = true };
                    var scenePath = lvl.FileName;
                    var lvlDir = Path.GetDirectoryName(scenePath)!;
                    var lvlBase = Path.GetFileNameWithoutExtension(scenePath);
                    var outFiles = await Task.Run(() =>
                    {
                        var written = new List<string>();
                        var tresFor = new Dictionary<int, string>();
                        var maps = new List<GodotTiles.MapLayer>();
                        foreach (var ml in doc.Layers.Where(l => l.Kind == "tilemap"))
                        {
                            var mts = doc.Tilesets[ml.Tileset];
                            if (!tresFor.TryGetValue(ml.Tileset, out var tres))
                            {
                                var tsName = $"{lvlBase}_tiles{ml.Tileset + 1}";
                                var atlasImg = GodotTiles.Atlas(mts);
                                var png = Path.Combine(lvlDir, tsName + ".png");
                                NoorMD.Core.Documents.AtomicFile.WriteAllBytes(png, SpritePng.Encode(atlasImg.Width, atlasImg.Height, atlasImg.Rgba));
                                tres = tsName + ".tres";
                                File.WriteAllText(Path.Combine(lvlDir, tres), GodotTiles.TileSet(tsName + ".png", mts));
                                written.Add(png); written.Add(Path.Combine(lvlDir, tres));
                                tresFor[ml.Tileset] = tres;
                            }
                            var mc = doc.Cels.FirstOrDefault(c => c.Layer == ml.Id && c.Frame == at) ?? new SpriteCel { Layer = ml.Id, Frame = at, Width = 1, Height = 1, Tiles = [0] };
                            var hidden = !ml.Visible || doc.Layers.Any(g => g.Kind == "group" && !g.Visible && IsInside(doc, ml, g.Id));
                            maps.Add(new GodotTiles.MapLayer(ml.Name, tres, mc, mts, !hidden, ml.Opacity));
                        }
                        File.WriteAllText(scenePath, GodotTiles.Level(lvlBase, maps));
                        written.Add(scenePath);
                        return written;
                    });
                    return new { files = outFiles.Select(Path.GetFileName) };
                }
                var save = new SaveFileDialog { Title = "Export the tilemap for Godot (the tiles, a TileSet and a scene go side by side)", FileName = stem + ".tres", Filter = "Godot TileSet (*.tres)|*.tres", AddExtension = true };
                NativeCursor.Restore();
                if (save.ShowDialog(this) != true) return new { cancelled = true };
                var target = save.FileName;
                var dir = Path.GetDirectoryName(target)!;
                var baseName = Path.GetFileNameWithoutExtension(target);
                var written = await Task.Run(() =>
                {
                    var atlas = GodotTiles.Atlas(ts);
                    var png = Path.Combine(dir, baseName + ".png");
                    NoorMD.Core.Documents.AtomicFile.WriteAllBytes(png, SpritePng.Encode(atlas.Width, atlas.Height, atlas.Rgba));
                    File.WriteAllText(target, GodotTiles.TileSet(baseName + ".png", ts));
                    var scene = Path.Combine(dir, baseName + "_map.tscn");
                    File.WriteAllText(scene, GodotTiles.Scene(layer.Name, Path.GetFileName(target), cel, ts));
                    return new List<string> { png, target, scene };
                });
                return new { files = written.Select(Path.GetFileName) };
            }
            case "sprite.palette.lospec":
            {
                // A palette from Lospec's public list, by its name there: fetched only now, as asked.
                var slug = (req.GetString("slug", 80) ?? "").Trim().ToLowerInvariant();
                if (slug.Length == 0 || !slug.All(c => c is >= 'a' and <= 'z' or >= '0' and <= '9' or '-')) throw new BridgeError("A Lospec palette's name is letters, digits and dashes (like endesga-32).");
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
                http.DefaultRequestHeaders.UserAgent.ParseAdd("NoorMD");
                byte[] bytes;
                try
                {
                    using var resp = await http.GetAsync($"https://lospec.com/palette-list/{slug}.hex");
                    if (resp.StatusCode == System.Net.HttpStatusCode.NotFound) throw new BridgeError($"Lospec has no palette called “{slug}”.");
                    resp.EnsureSuccessStatusCode();
                    bytes = await resp.Content.ReadAsByteArrayAsync();
                    if (bytes.Length > 64 * 1024) throw new BridgeError("That isn't a palette (too large).");
                }
                catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { throw new BridgeError("Lospec couldn't be reached: " + ex.Message); }
                var colours = SpritePalette.Read(bytes, ".hex");
                if (colours.Count == 0) throw new BridgeError("That palette has no colours.");
                return new { palette = colours, name = slug };
            }
            case "sprite.palette.open":
            {
                var dlg = new OpenFileDialog { Title = "Open a palette", Filter = "Palettes (*.gpl;*.pal;*.hex;*.txt)|*.gpl;*.pal;*.hex;*.txt", CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                try { return new { palette = SpritePalette.Read(await File.ReadAllBytesAsync(dlg.FileName), Path.GetExtension(dlg.FileName)), name = Path.GetFileNameWithoutExtension(dlg.FileName) }; }
                catch (InvalidDataException ex) { throw new BridgeError(ex.Message); }
            }
            case "sprite.palette.save":
            {
                if (!p.TryGetProperty("palette", out var pal) || pal.ValueKind != JsonValueKind.Array) throw new BridgeError("No palette.");
                var colours = pal.EnumerateArray().Select(c => c.GetString() ?? "").ToList();
                var dlg = new SaveFileDialog { Title = "Save the palette", FileName = "palette", Filter = "GIMP palette (*.gpl)|*.gpl|JASC palette (*.pal)|*.pal|Hex list (*.hex)|*.hex", AddExtension = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                await File.WriteAllBytesAsync(dlg.FileName, SpritePalette.Write(colours, Path.GetExtension(dlg.FileName), Path.GetFileNameWithoutExtension(dlg.FileName)));
                return new { name = Path.GetFileName(dlg.FileName) };
            }
            case "sprite.draft.save":
            {
                // An unsaved sprite kept in the app's own folder now and then, to bring back after a crash.
                var doc = SpriteFrom(p);
                Directory.CreateDirectory(SpriteDraftFolder);
                await Task.Run(() => SpriteFile.Save(Path.Combine(SpriteDraftFolder, "draft.noorsprite"), doc));
                await File.WriteAllTextAsync(Path.Combine(SpriteDraftFolder, "draft.json"), JsonSerializer.Serialize(new { name = req.GetString("name", 200) ?? "", path = req.GetString("path", 2000) ?? "", savedUtc = DateTime.UtcNow }));
                return new { ok = true };
            }
            case "sprite.draft.load":
            {
                var file = Path.Combine(SpriteDraftFolder, "draft.noorsprite");
                if (!File.Exists(file)) return new { none = true };
                try
                {
                    var info = File.Exists(Path.Combine(SpriteDraftFolder, "draft.json")) ? JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(SpriteDraftFolder, "draft.json"))).RootElement.Clone() : default;
                    return new { sprite = SpriteWire(await Task.Run(() => SpriteFile.Load(file))), name = info.ValueKind == JsonValueKind.Object && info.TryGetProperty("name", out var n) ? n.GetString() : "", path = info.ValueKind == JsonValueKind.Object && info.TryGetProperty("path", out var pp) ? pp.GetString() : "", savedUtc = File.GetLastWriteTimeUtc(file) };
                }
                catch (Exception ex) when (ex is InvalidDataException or JsonException or IOException) { return new { none = true, broken = ex.Message }; }
            }
            case "sprite.draft.clear":
            {
                foreach (var f in new[] { "draft.noorsprite", "draft.json" }) { var path = Path.Combine(SpriteDraftFolder, f); if (File.Exists(path)) File.Delete(path); }
                return new { ok = true };
            }
            default:
                throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }
}
