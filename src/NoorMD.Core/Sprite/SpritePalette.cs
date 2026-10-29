using System.Globalization;
using System.Text;

namespace NoorMD.Core.Sprite;

/// <summary>
/// Palette files: GIMP (.gpl), JASC / Paint Shop Pro (.pal), plain hex (.hex, one colour a line, as Lospec gives them)
/// and Microsoft RIFF .pal. Colours come and go as #rrggbbaa (alpha is kept only where the format has it).
/// </summary>
public static class SpritePalette
{
    public const int MaxColours = 256;

    public static List<string> Read(byte[] file, string extension)
    {
        var ext = extension.ToLowerInvariant();
        if (file.Length > 4 * 1024 * 1024) throw new InvalidDataException("That palette file is too large.");
        // A RIFF palette (binary) is told by its header, whatever the name says.
        if (file.Length >= 24 && Encoding.ASCII.GetString(file, 0, 4) == "RIFF" && Encoding.ASCII.GetString(file, 8, 4) == "PAL ") return Riff(file);
        var text = Encoding.UTF8.GetString(file).Replace("\r", "");
        var lines = text.Split('\n').Select(l => l.Trim()).ToList();
        var colours = new List<string>();
        if (lines.Count > 0 && lines[0].StartsWith("GIMP Palette", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var l in lines.Skip(1))
            {
                if (l.Length == 0 || l[0] == '#' || l.StartsWith("Name:", StringComparison.OrdinalIgnoreCase) || l.StartsWith("Columns:", StringComparison.OrdinalIgnoreCase)) continue;
                var parts = l.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 3 && Byte(parts[0], out var r) && Byte(parts[1], out var g) && Byte(parts[2], out var b)) colours.Add(Hex(r, g, b, 255));
            }
        }
        else if (lines.Count > 2 && lines[0] == "JASC-PAL")
        {
            foreach (var l in lines.Skip(3))
            {
                var parts = l.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 3 && Byte(parts[0], out var r) && Byte(parts[1], out var g) && Byte(parts[2], out var b))
                    colours.Add(Hex(r, g, b, parts.Length >= 4 && Byte(parts[3], out var a) ? a : (byte)255));
            }
        }
        else if (ext is ".hex" or ".txt" || lines.All(l => l.Length == 0 || IsHexLine(l)))
        {
            foreach (var l in lines)
            {
                var h = l.TrimStart('#');
                if (h.Length is 6 or 8 && h.All(Uri.IsHexDigit)) colours.Add("#" + h.ToLowerInvariant() + (h.Length == 6 ? "ff" : ""));
            }
        }
        else throw new InvalidDataException("That is not a palette NoorSprite knows (GIMP .gpl, JASC .pal, .hex).");
        if (colours.Count == 0) throw new InvalidDataException("That palette has no colours.");
        return colours.Take(MaxColours).ToList();
    }

    public static byte[] Write(IReadOnlyList<string> palette, string extension, string name = "NoorSprite")
    {
        var cs = palette.Where(SpriteDoc.IsColour).Take(MaxColours).Select(c => (R: Convert.ToByte(c[1..3], 16), G: Convert.ToByte(c[3..5], 16), B: Convert.ToByte(c[5..7], 16), A: Convert.ToByte(c[7..9], 16))).ToList();
        var sb = new StringBuilder();
        switch (extension.ToLowerInvariant())
        {
            case ".gpl":
                sb.Append("GIMP Palette\n").Append("Name: ").Append(name.Replace('\n', ' ')).Append('\n').Append("Columns: 8\n#\n");
                foreach (var c in cs) sb.Append(CultureInfo.InvariantCulture, $"{c.R,3} {c.G,3} {c.B,3}\t#{c.R:x2}{c.G:x2}{c.B:x2}\n");
                break;
            case ".pal":
                sb.Append("JASC-PAL\r\n0100\r\n").Append(cs.Count).Append("\r\n");
                foreach (var c in cs) sb.Append(CultureInfo.InvariantCulture, $"{c.R} {c.G} {c.B}\r\n");
                break;
            default:
                foreach (var c in cs) sb.Append($"{c.R:x2}{c.G:x2}{c.B:x2}\n");
                break;
        }
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    private static List<string> Riff(byte[] f)
    {
        // RIFF "PAL " → "data" chunk: version (2), count (2), then R, G, B, flags for each.
        for (var p = 12; p + 8 <= f.Length;)
        {
            var id = Encoding.ASCII.GetString(f, p, 4);
            var size = BitConverter.ToInt32(f, p + 4);
            if (size < 0 || p + 8 + size > f.Length) break;
            if (id == "data" && size >= 4)
            {
                var count = BitConverter.ToUInt16(f, p + 10);
                var colours = new List<string>();
                for (var i = 0; i < count && p + 12 + i * 4 + 3 <= p + 8 + size; i++) colours.Add(Hex(f[p + 12 + i * 4], f[p + 13 + i * 4], f[p + 14 + i * 4], 255));
                if (colours.Count == 0) break;
                return colours.Take(MaxColours).ToList();
            }
            p += 8 + size + (size & 1);
        }
        throw new InvalidDataException("A RIFF palette with no colours.");
    }

    private static bool IsHexLine(string l) { var h = l.TrimStart('#'); return h.Length is 6 or 8 && h.All(Uri.IsHexDigit); }
    private static bool Byte(string s, out byte b) => byte.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out b);
    private static string Hex(byte r, byte g, byte b, byte a) => $"#{r:x2}{g:x2}{b:x2}{a:x2}";
}
