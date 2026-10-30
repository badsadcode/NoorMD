using System.Text;
using System.Xml.Linq;
using NoorMD.Core.Ink;
using Xunit;

namespace NoorMD.Core.Tests.Ink;

/// <summary>NoorInk's SVG files: what is taken out before a picture goes into the page, and the picture's size.</summary>
public class InkSvgTests
{
    private const string Ns = "http://www.w3.org/2000/svg";

    private static XDocument Clean(string svg, out List<string> notes) => XDocument.Parse(InkSvg.Sanitize(svg, out notes));

    [Fact]
    public void ScriptsAndEventAttributesAreTakenOut()
    {
        var svg = $"""
            <svg xmlns="{Ns}" onload="alert(1)" width="10" height="10">
              <script>alert(2)</script>
              <SCRIPT>alert(3)</SCRIPT>
              <g ONCLICK="alert(4)"><rect width="5" height="5" onMouseOver="alert(5)" fill="red"/></g>
            </svg>
            """;
        var doc = Clean(svg, out var notes);
        var all = doc.Root!.DescendantsAndSelf().ToList();
        Assert.DoesNotContain(all, e => e.Name.LocalName.Equals("script", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(all.SelectMany(e => e.Attributes()), a => a.Name.LocalName.StartsWith("on", StringComparison.OrdinalIgnoreCase));
        Assert.Equal("red", (string?)doc.Descendants(XName.Get("rect", Ns)).Single().Attribute("fill"));
        Assert.Equal([InkSvg.NoteScripts], notes);
    }

    [Fact]
    public void HrefsKeepOnlyFragmentsAndCarriedPictures()
    {
        const string png = "data:image/png;base64,iVBORw0KGgo=";
        var svg = $"""
            <svg xmlns="{Ns}" xmlns:xlink="http://www.w3.org/1999/xlink">
              <a id="js" href="javascript:alert(1)"><text>x</text></a>
              <a id="js2" xlink:href=" JavaScript:alert(1)"><text>y</text></a>
              <use id="frag" href="#shape"/>
              <use id="frag2" xlink:href="#shape"/>
              <image id="data" href="{png}" width="1" height="1"/>
              <image id="far" href="https://example.com/a.png" width="1" height="1"/>
              <image id="svgdata" href="data:image/svg+xml;base64,PHN2Zz4=" width="1" height="1"/>
            </svg>
            """;
        var doc = Clean(svg, out var notes);
        string? Href(string id) => doc.Descendants().Single(e => (string?)e.Attribute("id") == id).Attributes().FirstOrDefault(a => a.Name.LocalName == "href")?.Value;
        Assert.Null(Href("js"));
        Assert.Null(Href("js2"));
        Assert.Equal("#shape", Href("frag"));
        Assert.Equal("#shape", Href("frag2"));
        Assert.Equal(png, Href("data"));
        Assert.Null(Href("far"));
        Assert.Null(Href("svgdata"));
        Assert.Contains(InkSvg.NoteScripts, notes);
        Assert.Contains(InkSvg.NoteLinks, notes);
    }

    [Fact]
    public void EmbeddedContentMediaAndLinkAnimationsAreTakenOut()
    {
        var svg = $"""
            <svg xmlns="{Ns}">
              <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></div></foreignObject>
              <iframe src="https://example.com"/>
              <video src="a.mp4"/>
              <a href="#x"><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="onclick" to="alert(1)"/><text>t</text></a>
              <rect width="1" height="1"><animate attributeName="x" from="0" to="10" dur="1s"/></rect>
            </svg>
            """;
        var doc = Clean(svg, out var notes);
        var names = doc.Descendants().Select(e => e.Name.LocalName).ToList();
        Assert.DoesNotContain("foreignObject", names);
        Assert.DoesNotContain("iframe", names);
        Assert.DoesNotContain("video", names);
        Assert.DoesNotContain("set", names);
        Assert.Single(doc.Descendants(XName.Get("animate", Ns)));
        Assert.Equal([InkSvg.NoteEmbedded, InkSvg.NoteMedia, InkSvg.NoteAnimations], notes);
    }

    [Fact]
    public void DoctypeEntitiesAreNeverExpanded()
    {
        var laughs = new StringBuilder("<?xml version=\"1.0\"?><!DOCTYPE svg [<!ENTITY lol \"lol\">");
        laughs.Append("<!ENTITY lol1 \"&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;\">");
        for (var i = 2; i <= 9; i++) laughs.Append($"<!ENTITY lol{i} \"" + string.Concat(Enumerable.Repeat($"&lol{i - 1};", 10)) + "\">");
        laughs.Append($"]><svg xmlns=\"{Ns}\"><text>&lol9;</text></svg>");
        try
        {
            var result = InkSvg.Sanitize(laughs.ToString(), out _);
            Assert.DoesNotContain("lollol", result);
            Assert.True(result.Length < 10_000);
        }
        catch (InvalidDataException) { /* refused: just as good */ }

        // An external entity is never fetched or read.
        var external = $"<?xml version=\"1.0\"?><!DOCTYPE svg [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><svg xmlns=\"{Ns}\"><text>&x;</text></svg>";
        try { Assert.DoesNotContain("root:", InkSvg.Sanitize(external, out _)); }
        catch (InvalidDataException) { }

        // A DOCTYPE with nothing used from it is simply left out.
        var plain = $"<?xml version=\"1.0\"?><!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\"><svg xmlns=\"{Ns}\"><rect width=\"1\" height=\"1\"/></svg>";
        var cleaned = InkSvg.Sanitize(plain, out var notes);
        Assert.DoesNotContain("DOCTYPE", cleaned);
        Assert.Empty(notes);
    }

    [Fact]
    public void StylesLoseFileLinksButKeepFragments()
    {
        var svg = $"""
            <svg xmlns="{Ns}">
              <style>@import url(https://example.com/a.css); .a {"{"} fill: url(#grad); {"}"} .b {"{"} background: url(http://example.com/x.png); {"}"} .c {"{"} stroke: blue; {"}"}</style>
              <rect id="r1" style="fill:url(http://example.com/p.png);stroke:red" width="1" height="1"/>
              <rect id="r2" style="fill: url(#grad)" width="1" height="1"/>
              <rect id="r3" style="width: expression(alert(1))" width="1" height="1"/>
              <rect id="r4" style="fill: u\72l(http://example.com/p.png)" width="1" height="1"/>
              <rect id="r5" fill="url(https://example.com/p.svg#g)" stroke="url(#grad)" width="1" height="1"/>
            </svg>
            """;
        var doc = Clean(svg, out var notes);
        string? Attr(string id, string name) => (string?)doc.Descendants().Single(e => (string?)e.Attribute("id") == id).Attribute(name);
        var css = doc.Descendants(XName.Get("style", Ns)).Single().Value;
        Assert.DoesNotContain("@import", css);
        Assert.DoesNotContain("example.com", css);
        Assert.Contains("url(#grad)", css);
        Assert.Contains("stroke: blue", css);
        Assert.Equal("stroke:red", Attr("r1", "style"));
        Assert.Equal("fill: url(#grad)", Attr("r2", "style"));
        Assert.Null(Attr("r3", "style"));
        Assert.Null(Attr("r4", "style"));
        Assert.Null(Attr("r5", "fill"));
        Assert.Equal("url(#grad)", Attr("r5", "stroke"));
        Assert.Contains(InkSvg.NoteStyles, notes);
    }

    [Fact]
    public void InkscapeAttributesAndANormalDrawingAreKept()
    {
        var svg = """
            <?xml version="1.0" encoding="UTF-8" standalone="no"?>
            <!-- Created with Inkscape -->
            <svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
                 xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:xlink="http://www.w3.org/1999/xlink"
                 width="210mm" height="297mm" viewBox="0 0 210 297" sodipodi:docname="drawing.svg" inkscape:version="1.3">
              <sodipodi:namedview id="nv" inkscape:zoom="0.7" pagecolor="#ffffff"/>
              <defs><linearGradient id="grad"><stop offset="0" style="stop-color:#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>
              <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1">
                <rect x="10" y="10" width="50" height="30" style="fill:url(#grad);stroke:#000;stroke-width:0.5"/>
                <path d="M 10,80 C 40,60 80,100 110,80" fill="none" stroke="#333" sodipodi:nodetypes="cc"/>
                <use xlink:href="#layer1" x="5"/>
                <text x="10" y="150" xml:space="preserve">Hello  <tspan font-weight="bold">world</tspan></text>
              </g>
            </svg>
            """;
        var before = XDocument.Parse(svg);
        var result = InkSvg.Sanitize(svg, out var notes);
        var after = XDocument.Parse(result);
        Assert.Empty(notes);
        Assert.Equal(before.Descendants().Count(), after.Descendants().Count());
        XNamespace ink = "http://www.inkscape.org/namespaces/inkscape";
        Assert.Equal("Layer 1", (string?)after.Descendants().Single(e => (string?)e.Attribute("id") == "layer1").Attribute(ink + "label"));
        Assert.Equal("0.7", (string?)after.Descendants().Single(e => e.Name.LocalName == "namedview").Attribute(ink + "zoom"));
        Assert.Contains("Hello  ", result);
        Assert.DoesNotContain("<?xml", result);
        Assert.False(result.StartsWith('﻿'));
    }

    [Fact]
    public void ASvgWithoutItsNamespaceGetsIt()
    {
        var doc = Clean("<svg width=\"4\" height=\"4\"><rect width=\"1\" height=\"1\"/></svg>", out _);
        Assert.Equal(XName.Get("svg", Ns), doc.Root!.Name);
        Assert.Equal(XName.Get("rect", Ns), doc.Root.Elements().Single().Name);
    }

    [Theory]
    [InlineData("<html><body/></html>")]
    [InlineData("<svg xmlns=\"http://example.com/other\"/>")]
    [InlineData("not xml at all")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\"><rect></svg>")]
    [InlineData("")]
    public void ThingsThatArentSvgAreRefused(string text)
    {
        var ex = Assert.Throws<InvalidDataException>(() => InkSvg.Sanitize(text, out _));
        Assert.Equal("That isn't an SVG picture.", ex.Message);
    }

    [Fact]
    public void ReadUsesTheDeclaredEncoding()
    {
        var latin = Encoding.Latin1.GetBytes($"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><svg xmlns=\"{Ns}\"><text>café</text></svg>");
        Assert.Contains("café", InkSvg.Read(latin));
        var utf8Bom = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes($"<svg xmlns=\"{Ns}\"><text>ü</text></svg>")).ToArray();
        Assert.Contains("ü", InkSvg.Sanitize(InkSvg.Read(utf8Bom), out _));
    }

    [Fact]
    public void SizeReadsUnitsAndTheViewBox()
    {
        var (w, h) = InkSvg.Size($"<svg xmlns=\"{Ns}\" width=\"210mm\" height=\"297mm\"/>");
        Assert.Equal(793.70, w, 2);
        Assert.Equal(1122.52, h, 2);

        (w, h) = InkSvg.Size($"<svg xmlns=\"{Ns}\" width=\"100pt\" height=\"50pt\"/>");
        Assert.Equal(133.33, w, 2);
        Assert.Equal(66.67, h, 2);

        Assert.Equal((300.0, 150.0), InkSvg.Size($"<svg xmlns=\"{Ns}\" viewBox=\"0 0 300 150\"/>"));
        Assert.Equal((300.0, 150.0), InkSvg.Size($"<svg xmlns=\"{Ns}\" width=\"100%\" height=\"100%\" viewBox=\"0,0,300,150\"/>"));
        Assert.Equal((600.0, 300.0), InkSvg.Size($"<svg xmlns=\"{Ns}\" width=\"600\" viewBox=\"0 0 300 150\"/>"));
        Assert.Equal((800.0, 600.0), InkSvg.Size($"<svg xmlns=\"{Ns}\"/>"));
        Assert.Equal((800.0, 600.0), InkSvg.Size("garbage"));
    }
}
