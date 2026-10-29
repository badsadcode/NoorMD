namespace NoorMD.Core.Sprite;

/// <summary>
/// A frame of a sprite composed in the app (for thumbnails and previews): its shown layers bottom first, each cel over
/// what is below with the layer's, the cel's and its groups' opacity — normal blending; reference layers left out.
/// </summary>
public static class SpriteRender
{
    public static byte[] Frame(SpriteDoc doc, int f)
    {
        int w = doc.Width, h = doc.Height;
        var outPx = new byte[w * h * 4];
        var byId = doc.Layers.ToDictionary(l => l.Id);
        foreach (var l in doc.Layers)
        {
            if (l.Kind == "group" || l.Reference) continue;
            // Hidden in a hidden group, or see-through by its groups too.
            var shown = l.Visible; var k = l.Opacity / 255.0; var n = 0;
            for (var p = l.Parent; p != null && n < 64 && byId.TryGetValue(p, out var g); n++, p = g.Parent) { shown &= g.Visible; k *= g.Opacity / 255.0; }
            if (!shown) continue;
            var cel = doc.Cel(l.Id, f);
            if (cel == null) continue;
            k *= cel.Opacity / 255.0;
            if (k <= 0) continue;
            byte[] src; int sx0, sy0, sw, sh;
            if (l.Kind == "tilemap" && cel.Tiles != null) { src = SpriteTilemap.Render(cel, doc.Tilesets[l.Tileset], w, h); sx0 = 0; sy0 = 0; sw = w; sh = h; }
            else { src = cel.Pixels(); sx0 = cel.X; sy0 = cel.Y; sw = cel.Width; sh = cel.Height; }
            for (var y = 0; y < sh; y++)
            {
                var ty = sy0 + y;
                if (ty < 0 || ty >= h) continue;
                for (var x = 0; x < sw; x++)
                {
                    var tx = sx0 + x;
                    if (tx < 0 || tx >= w) continue;
                    int s = (y * sw + x) * 4, t = (ty * w + tx) * 4;
                    var sa = src[s + 3] / 255.0 * k;
                    if (sa <= 0) continue;
                    var ba = outPx[t + 3] / 255.0;
                    var ra = sa + ba * (1 - sa);
                    for (var c = 0; c < 3; c++) outPx[t + c] = (byte)Math.Round((src[s + c] * sa + outPx[t + c] * ba * (1 - sa)) / ra);
                    outPx[t + 3] = (byte)Math.Round(ra * 255);
                }
            }
        }
        return outPx;
    }

    /// <summary>A picture made to fit in a square of `size` (nearest: small sprites grow by whole steps, crisp).</summary>
    public static (int Width, int Height, byte[] Rgba) Fit(int w, int h, byte[] rgba, int size)
    {
        var scale = Math.Min((double)size / w, (double)size / h);
        if (scale >= 1) scale = Math.Max(1, Math.Floor(scale));
        int nw = Math.Max(1, (int)Math.Round(w * scale)), nh = Math.Max(1, (int)Math.Round(h * scale));
        var o = new byte[nw * nh * 4];
        for (var y = 0; y < nh; y++)
            for (var x = 0; x < nw; x++)
            {
                int sx = Math.Min(w - 1, (int)(x / scale)), sy = Math.Min(h - 1, (int)(y / scale));
                Array.Copy(rgba, (sy * w + sx) * 4, o, (y * nw + x) * 4, 4);
            }
        return (nw, nh, o);
    }

    /// <summary>A sprite file's first frame as a PNG fitted in `size` (.noorsprite, .aseprite, .ase), or null.</summary>
    public static byte[]? Thumbnail(string path, int size)
    {
        try
        {
            var doc = path.EndsWith(SpriteFile.Extension, StringComparison.OrdinalIgnoreCase) ? SpriteFile.Load(path)
                : new FileInfo(path).Length <= 256L * 1024 * 1024 ? AsepriteFile.Read(File.ReadAllBytes(path)).Sprite : null;
            if (doc == null) return null;
            var (w, h, px) = Fit(doc.Width, doc.Height, Frame(doc, 0), size);
            return SpritePng.Encode(w, h, px);
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException or System.Text.Json.JsonException) { return null; }
    }
}
