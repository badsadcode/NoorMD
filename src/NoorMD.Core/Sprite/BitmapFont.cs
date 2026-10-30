using System.Globalization;
using System.Text;

namespace NoorMD.Core.Sprite;

/// <summary>
/// A sprite drawn as a font (glyphs in a grid of cells, in the font's character order) written as a BMFont text file
/// (.fnt) with its page picture: what Godot, Unity's and many engines' bitmap-font readers take. Proportional glyphs
/// are as wide as they are drawn (an empty one — a space — keeps half a cell).
/// </summary>
public static class BitmapFont
{
    public sealed record Glyph(int Code, int X, int Y, int Width, int Height, int Advance);

    public static List<Glyph> Glyphs(int width, int height, byte[] rgba, SpriteFont font)
    {
        int cw = Math.Max(1, font.CellWidth), ch = Math.Max(1, font.CellHeight), cols = Math.Max(1, width / cw);
        var list = new List<Glyph>();
        var i = 0;
        foreach (var rune in font.Characters.EnumerateRunes())
        {
            int cx = i % cols * cw, cy = i / cols * ch;
            i++;
            if (cy + ch > height) break;
            int left = cw, right = -1;
            for (var y = 0; y < ch; y++)
                for (var x = 0; x < cw; x++)
                    if (rgba[((cy + y) * width + cx + x) * 4 + 3] > 0) { left = Math.Min(left, x); right = Math.Max(right, x); }
            if (!font.Proportional || right < 0)
            {
                var w = font.Proportional ? Math.Max(1, cw / 2) : cw;
                list.Add(new Glyph(rune.Value, cx, cy, w, ch, w + (font.Proportional ? font.Spacing : 0)));
                continue;
            }
            list.Add(new Glyph(rune.Value, cx + left, cy, right - left + 1, ch, right - left + 1 + font.Spacing));
        }
        return list;
    }

    public static string Fnt(string face, string pageFile, int width, int height, IReadOnlyList<Glyph> glyphs, SpriteFont font)
    {
        string I(int v) => v.ToString(CultureInfo.InvariantCulture);
        var name = face.Replace("\"", "'");
        var sb = new StringBuilder();
        sb.Append($"info face=\"{name}\" size={I(font.CellHeight)} bold=0 italic=0 charset=\"\" unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=0,0\n");
        var baseLine = font.Baseline > 0 ? font.Baseline : font.CellHeight;
        sb.Append($"common lineHeight={I(font.CellHeight + 1)} base={I(baseLine)} scaleW={I(width)} scaleH={I(height)} pages=1 packed=0\n");
        sb.Append($"page id=0 file=\"{pageFile.Replace("\"", "'")}\"\n");
        sb.Append($"chars count={I(glyphs.Count)}\n");
        foreach (var g in glyphs)
            sb.Append($"char id={I(g.Code)} x={I(g.X)} y={I(g.Y)} width={I(g.Width)} height={I(g.Height)} xoffset=0 yoffset=0 xadvance={I(g.Advance)} page=0 chnl=15\n");
        return sb.ToString();
    }
}
