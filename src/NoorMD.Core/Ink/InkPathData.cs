using System.Globalization;
using System.Text;

namespace NoorMD.Core.Ink;

/// <summary>
/// SVG path data written from outlines (NoorInk's text turned into outlines): absolute M, L, C, Q and Z only, numbers
/// in invariant culture with at most 3 decimals. Arcs become cubic curves. Every point goes through a matrix first
/// (WPF's order: x' = x·m11 + y·m21 + dx, y' = x·m12 + y·m22 + dy), so an arc is turned into curves before it is moved,
/// and stays right under any matrix.
/// </summary>
public sealed class SvgPathWriter
{
    private readonly StringBuilder _sb = new();
    private double _m11 = 1, _m12, _m21, _m22 = 1, _dx, _dy;
    // The current point and the figure's start, before the matrix (arcs need them).
    private double _x, _y, _sx, _sy;

    public bool IsEmpty => _sb.Length == 0;

    /// <summary>The matrix the next points go through.</summary>
    public void SetMatrix(double m11, double m12, double m21, double m22, double dx, double dy) =>
        (_m11, _m12, _m21, _m22, _dx, _dy) = (m11, m12, m21, m22, dx, dy);

    public void MoveTo(double x, double y)
    {
        Command('M', x, y);
        (_x, _y, _sx, _sy) = (x, y, x, y);
    }

    public void LineTo(double x, double y)
    {
        Command('L', x, y);
        (_x, _y) = (x, y);
    }

    public void CubicTo(double x1, double y1, double x2, double y2, double x, double y)
    {
        Command('C', x1, y1, x2, y2, x, y);
        (_x, _y) = (x, y);
    }

    public void QuadTo(double x1, double y1, double x, double y)
    {
        Command('Q', x1, y1, x, y);
        (_x, _y) = (x, y);
    }

    /// <summary>An elliptical arc from the current point, as SVG's A command means it (sweep true = clockwise on screen).</summary>
    public void ArcTo(double rx, double ry, double rotationDegrees, bool largeArc, bool sweep, double x, double y)
    {
        var curves = ArcToCubics(_x, _y, rx, ry, rotationDegrees, largeArc, sweep, x, y);
        if (curves == null) { LineTo(x, y); return; }
        foreach (var c in curves) CubicTo(c.X1, c.Y1, c.X2, c.Y2, c.X, c.Y);
        (_x, _y) = (x, y);
    }

    public void Close()
    {
        _sb.Append('Z');
        (_x, _y) = (_sx, _sy);
    }

    public override string ToString() => _sb.ToString();

    private void Command(char c, params ReadOnlySpan<double> xy)
    {
        _sb.Append(c);
        for (var i = 0; i < xy.Length; i += 2)
        {
            if (i > 0) _sb.Append(' ');
            var (x, y) = (xy[i], xy[i + 1]);
            _sb.Append(Num(x * _m11 + y * _m21 + _dx)).Append(' ').Append(Num(x * _m12 + y * _m22 + _dy));
        }
    }

    /// <summary>A number as path data writes it: invariant culture, at most 3 decimals, no "-0", 0 for NaN and infinity.</summary>
    public static string Num(double v)
    {
        if (!double.IsFinite(v)) return "0";
        var s = Math.Round(v, 3, MidpointRounding.AwayFromZero).ToString("0.###", CultureInfo.InvariantCulture);
        return s == "-0" ? "0" : s;
    }

    /// <summary>One cubic curve: two control points and where it ends.</summary>
    public readonly record struct Cubic(double X1, double Y1, double X2, double Y2, double X, double Y);

    /// <summary>
    /// An SVG arc as cubic curves, each spanning at most a quarter turn (SVG 1.1, appendix F.6: radii too small to
    /// reach are scaled up). Null when a radius is 0 (the arc is a straight line); empty when it starts where it ends.
    /// </summary>
    public static List<Cubic>? ArcToCubics(double x0, double y0, double rx, double ry, double rotationDegrees, bool largeArc, bool sweep, double x, double y)
    {
        if (x0 == x && y0 == y) return [];
        rx = Math.Abs(rx);
        ry = Math.Abs(ry);
        if (rx == 0 || ry == 0 || !double.IsFinite(rx) || !double.IsFinite(ry)) return null;

        var phi = rotationDegrees * Math.PI / 180;
        var (cos, sin) = (Math.Cos(phi), Math.Sin(phi));
        var (hx, hy) = ((x0 - x) / 2, (y0 - y) / 2);
        var x1p = cos * hx + sin * hy;
        var y1p = -sin * hx + cos * hy;

        var lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
        if (lambda > 1) { var k = Math.Sqrt(lambda); rx *= k; ry *= k; }

        var num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
        var den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
        var coef = Math.Sqrt(Math.Max(0, num / den)) * (largeArc == sweep ? -1 : 1);
        var cxp = coef * rx * y1p / ry;
        var cyp = -coef * ry * x1p / rx;
        var cx = cos * cxp - sin * cyp + (x0 + x) / 2;
        var cy = sin * cxp + cos * cyp + (y0 + y) / 2;

        var theta1 = Math.Atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
        var theta2 = Math.Atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx);
        var dtheta = theta2 - theta1;
        if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
        else if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;

        var n = Math.Max(1, (int)Math.Ceiling(Math.Abs(dtheta) / (Math.PI / 2) - 1e-9));
        var delta = dtheta / n;
        var t = 4.0 / 3 * Math.Tan(delta / 4);
        (double X, double Y) At(double a) => (cx + rx * Math.Cos(a) * cos - ry * Math.Sin(a) * sin, cy + rx * Math.Cos(a) * sin + ry * Math.Sin(a) * cos);
        (double X, double Y) Tangent(double a) => (-rx * Math.Sin(a) * cos - ry * Math.Cos(a) * sin, -rx * Math.Sin(a) * sin + ry * Math.Cos(a) * cos);

        var list = new List<Cubic>(n);
        for (var i = 0; i < n; i++)
        {
            var (a1, a2) = (theta1 + i * delta, theta1 + (i + 1) * delta);
            var (p1, d1, p2, d2) = (At(a1), Tangent(a1), At(a2), Tangent(a2));
            // The last curve ends exactly where the arc was asked to end.
            if (i == n - 1) p2 = (x, y);
            list.Add(new Cubic(p1.X + t * d1.X, p1.Y + t * d1.Y, p2.X - t * d2.X, p2.Y - t * d2.Y, p2.X, p2.Y));
        }
        return list;
    }
}

/// <summary>NoorInk's text as the page draws it: one SVG tspan per line, the font-family as CSS writes it.</summary>
public static class InkText
{
    public const int MaxChars = 20_000;
    public const double MinSize = 0.5, MaxSize = 5000;

    // What Chromium uses on Windows for CSS's generic families.
    private static readonly Dictionary<string, string> Generic = new(StringComparer.OrdinalIgnoreCase)
    {
        ["serif"] = "Times New Roman",
        ["sans-serif"] = "Arial",
        ["monospace"] = "Consolas",
        ["cursive"] = "Comic Sans MS",
        ["fantasy"] = "Impact",
        ["system-ui"] = "Segoe UI",
        ["ui-sans-serif"] = "Segoe UI",
        ["ui-serif"] = "Times New Roman",
        ["ui-monospace"] = "Consolas",
    };

    /// <summary>The text's lines (split at CR LF, CR or LF), as the page makes one tspan of each.</summary>
    public static string[] Lines(string text) => text.Split(["\r\n", "\r", "\n"], StringSplitOptions.None);

    /// <summary>
    /// The families a CSS font-family list names, in order: quotes taken off, generic families as Chromium on Windows
    /// has them. Names with '#', '/' or '\' are left out (to WPF they would be font files, not families).
    /// </summary>
    public static List<string> FontNames(string? font)
    {
        var list = new List<string>();
        foreach (var part in (font ?? "").Split(','))
        {
            var name = part.Trim();
            if (name.Length >= 2 && (name[0] == '"' || name[0] == '\'') && name[^1] == name[0]) name = name[1..^1].Trim();
            if (name.Length == 0 || name.IndexOfAny(['#', '/', '\\']) >= 0) continue;
            list.Add(Generic.TryGetValue(name, out var g) ? g : name);
        }
        return list;
    }

    /// <summary>Where a line starts so that it ends up where text-anchor puts it: start at 0, middle centred on 0, end at 0.</summary>
    public static double LineX(string align, double advance) => align switch
    {
        "center" => -advance / 2,
        "right" => -advance,
        _ => 0,
    };
}
