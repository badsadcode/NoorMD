using System.IO;
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
                var name = Path.GetFileName(path);
                try
                {
                    if (path.EndsWith(SpriteFile.Extension, StringComparison.OrdinalIgnoreCase))
                        return new { sprite = SpriteWire(await Task.Run(() => SpriteFile.Load(path))), path, name, notes = Array.Empty<string>() };
                    if (path.EndsWith(".aseprite", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".ase", StringComparison.OrdinalIgnoreCase))
                    {
                        if (new FileInfo(path).Length > SpriteFile.MaxFileBytes) throw new BridgeError("That file is too large.");
                        var (doc, notes) = await Task.Run(() => AsepriteFile.Read(File.ReadAllBytes(path)));
                        return new { sprite = SpriteWire(doc), path, name, notes };
                    }
                    var (w, h, rgba) = await Task.Run(() => SpritePicture(path));
                    if (w > SpriteDoc.MaxSide || h > SpriteDoc.MaxSide) throw new BridgeError($"A sprite is at most {SpriteDoc.MaxSide} pixels a side; that picture is {w} × {h}.");
                    return new { image = new { width = w, height = h, data = Convert.ToBase64String(rgba) }, name };
                }
                catch (InvalidDataException ex) { throw new BridgeError(ex.Message); }
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
                        case "godot":
                        {
                            // The sheet (packed unless a layout was chosen), the SpriteFrames, and a scene to drop in.
                            var (gs, placed) = SpriteExport.Pack(frames, layout == "row" ? "packed" : layout, spacing);
                            var png = Path.Combine(dir, baseName + ".png");
                            NoorMD.Core.Documents.AtomicFile.WriteAllBytes(png, SpritePng.EncodeBest(gs.Width, gs.Height, gs.Rgba, indexedPalette));
                            File.WriteAllText(target, GodotSprite.SpriteFrames(baseName + ".png", placed, tags));
                            var scene = Path.Combine(dir, baseName + ".tscn");
                            File.WriteAllText(scene, GodotSprite.Scene(baseName, Path.GetFileName(target), GodotSprite.Animations(frames.Count, tags)[0].Name));
                            files.Add(png); files.Add(target); files.Add(scene);
                            break;
                        }
                        default:
                            var (sheet, json) = SpriteExport.Sheet(frames, layout, spacing, baseName, tags, layers, scale, slices.Select(x => x).ToList(), form);
                            NoorMD.Core.Documents.AtomicFile.WriteAllBytes(target, SpritePng.EncodeBest(sheet.Width, sheet.Height, sheet.Rgba, indexedPalette));
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
