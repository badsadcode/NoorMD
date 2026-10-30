using NoorMD.Core.Ink;
using Xunit;

namespace NoorMD.Core.Tests.Ink;

/// <summary>NoorInk's text as outlines: the path data written, arcs as cubic curves, and the font-family list read.</summary>
public class InkPathDataTests
{
    [Theory]
    [InlineData(0, "0")]
    [InlineData(1.5, "1.5")]
    [InlineData(-2.25, "-2.25")]
    [InlineData(1.23456, "1.235")]
    [InlineData(0.0005, "0.001")]
    [InlineData(-0.0004, "0")]
    [InlineData(-0.0, "0")]
    [InlineData(12345.6789, "12345.679")]
    [InlineData(100, "100")]
    [InlineData(double.NaN, "0")]
    [InlineData(double.PositiveInfinity, "0")]
    public void NumbersHaveAtMostThreeDecimals(double v, string expected) => Assert.Equal(expected, SvgPathWriter.Num(v));

    [Fact]
    public void NumbersIgnoreTheCulture()
    {
        var was = Thread.CurrentThread.CurrentCulture;
        try
        {
            Thread.CurrentThread.CurrentCulture = new System.Globalization.CultureInfo("pl-PL");
            Assert.Equal("1234.5", SvgPathWriter.Num(1234.5));
        }
        finally { Thread.CurrentThread.CurrentCulture = was; }
    }

    [Fact]
    public void CommandsAreAbsoluteAndCompact()
    {
        var w = new SvgPathWriter();
        Assert.True(w.IsEmpty);
        w.MoveTo(0, 0);
        w.LineTo(10, 0);
        w.QuadTo(15, 5, 10, 10);
        w.CubicTo(8, 12, 2, 12, 0, 10);
        w.Close();
        Assert.Equal("M0 0L10 0Q15 5 10 10C8 12 2 12 0 10Z", w.ToString());
    }

    [Fact]
    public void PointsGoThroughTheMatrix()
    {
        var w = new SvgPathWriter();
        w.SetMatrix(2, 0, 0, 2, 5, -1);
        w.MoveTo(1, 1);
        w.LineTo(3, 0.5);
        Assert.Equal("M7 1L11 0", w.ToString());
    }

    private static (double X, double Y) Bezier(SvgPathWriter.Cubic c, double x0, double y0, double t)
    {
        var u = 1 - t;
        return (u * u * u * x0 + 3 * u * u * t * c.X1 + 3 * u * t * t * c.X2 + t * t * t * c.X,
                u * u * u * y0 + 3 * u * u * t * c.Y1 + 3 * u * t * t * c.Y2 + t * t * t * c.Y);
    }

    [Fact]
    public void AQuarterCircleIsOneCubic()
    {
        var curves = SvgPathWriter.ArcToCubics(1, 0, 1, 1, 0, false, true, 0, 1)!;
        var c = Assert.Single(curves);
        const double k = 0.5522847498;
        Assert.Equal(1, c.X1, 6); Assert.Equal(k, c.Y1, 6);
        Assert.Equal(k, c.X2, 6); Assert.Equal(1, c.Y2, 6);
        Assert.Equal(0, c.X, 9); Assert.Equal(1, c.Y, 9);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public void ArcCurvesStayOnTheEllipse(bool large, bool sweep)
    {
        // An ellipse (rx 20, ry 10) turned 30°, from one point on it to another.
        var (cx, cy, rx, ry, phi) = (50.0, 40.0, 20.0, 10.0, Math.PI / 6);
        (double, double) On(double a) => (cx + rx * Math.Cos(a) * Math.Cos(phi) - ry * Math.Sin(a) * Math.Sin(phi), cy + rx * Math.Cos(a) * Math.Sin(phi) + ry * Math.Sin(a) * Math.Cos(phi));
        var (x0, y0) = On(0.3);
        var (x1, y1) = On(2.0);
        var curves = SvgPathWriter.ArcToCubics(x0, y0, rx, ry, 30, large, sweep, x1, y1)!;
        Assert.Equal(x1, curves[^1].X, 9);
        Assert.Equal(y1, curves[^1].Y, 9);
        // Two of the four flag pairs go round the other ellipse through both points: its centre mirrored across the chord's middle.
        double R(double x, double y, double ox, double oy)
        {
            // Back to the ellipse's own frame: (x/rx)² + (y/ry)² is 1 for any point that is on it.
            var (dx, dy) = (x - ox, y - oy);
            var (ux, uy) = (dx * Math.Cos(phi) + dy * Math.Sin(phi), -dx * Math.Sin(phi) + dy * Math.Cos(phi));
            return Math.Sqrt(ux * ux / (rx * rx) + uy * uy / (ry * ry));
        }
        var mid = Bezier(curves[0], x0, y0, 0.5);
        var (ocx, ocy) = Math.Abs(R(mid.X, mid.Y, cx, cy) - 1) < 0.01 ? (cx, cy) : (x0 + x1 - cx, y0 + y1 - cy);
        var (px, py) = (x0, y0);
        foreach (var c in curves)
        {
            for (var t = 0.0; t <= 1; t += 0.125)
            {
                var (bx, by) = Bezier(c, px, py, t);
                Assert.InRange(R(bx, by, ocx, ocy), 0.999, 1.001);
            }
            (px, py) = (c.X, c.Y);
        }
        // The small arc turns 1.7 rad (two quarter-turn curves at most), the large one the other 4.58 rad (three).
        Assert.Equal(large ? 3 : 2, curves.Count);
    }

    [Fact]
    public void TheLargeArcFlagChoosesTheLongWayRound()
    {
        var small = SvgPathWriter.ArcToCubics(0, 0, 10, 10, 0, false, true, 10, 10)!;
        var large = SvgPathWriter.ArcToCubics(0, 0, 10, 10, 0, true, true, 10, 10)!;
        Assert.Single(small);
        Assert.Equal(3, large.Count);
    }

    [Fact]
    public void RadiiTooSmallAreScaledUp()
    {
        // Radius 1 can't reach from (0,0) to (10,0): it becomes a half circle of radius 5, through (5,5) or (5,-5).
        var curves = SvgPathWriter.ArcToCubics(0, 0, 1, 1, 0, false, true, 10, 0)!;
        Assert.Equal(2, curves.Count);
        Assert.Equal(5, curves[0].X, 6);
        Assert.Equal(5, Math.Abs(curves[0].Y), 6);
    }

    [Fact]
    public void DegenerateArcs()
    {
        Assert.Null(SvgPathWriter.ArcToCubics(0, 0, 0, 5, 0, false, true, 10, 0));
        Assert.Empty(SvgPathWriter.ArcToCubics(3, 3, 5, 5, 0, false, true, 3, 3)!);
        var w = new SvgPathWriter();
        w.MoveTo(0, 0);
        w.ArcTo(0, 0, 0, false, true, 10, 0);
        w.ArcTo(10, 10, 0, false, true, 20, 10);
        w.Close();
        Assert.Equal("M0 0L10 0C15.523 0 20 4.477 20 10Z", w.ToString());
    }

    [Fact]
    public void FontNamesReadACssList()
    {
        Assert.Equal(["Segoe UI", "Arial"], InkText.FontNames("'Segoe UI', sans-serif"));
        Assert.Equal(["Noto Sans Arabic", "Times New Roman", "Consolas"], InkText.FontNames(" \"Noto Sans Arabic\" ,serif, monospace"));
        Assert.Equal(["Georgia"], InkText.FontNames("C:\\Windows\\Fonts\\x.ttf#Evil, ./a#b, Georgia, ,"));
        Assert.Empty(InkText.FontNames(null));
        Assert.Empty(InkText.FontNames(""));
    }

    [Fact]
    public void LinesAndAlignment()
    {
        Assert.Equal(["a", "", "b", "c", ""], InkText.Lines("a\r\n\rb\nc\n"));
        Assert.Equal(["only"], InkText.Lines("only"));
        Assert.Equal(0, InkText.LineX("left", 40));
        Assert.Equal(-20, InkText.LineX("center", 40));
        Assert.Equal(-40, InkText.LineX("right", 40));
    }
}
