using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace NoorMD.Core.Ink;

/// <summary>
/// NoorInk's SVG files. A picture opened from a file goes into the page's own DOM, so it is made safe first: no
/// scripts, no event attributes, no embedded web pages, sound or video, no links to other files (only to parts of the
/// picture itself, and pictures carried inside it) and no style rules that load files or run code. Everything else is
/// kept as it was, including what Inkscape and Illustrator add in their own namespaces. A DTD is never read, so
/// entities are never expanded (no "billion laughs") and nothing outside the file is fetched.
/// </summary>
public static class InkSvg
{
    public const long MaxBytes = 50L * 1024 * 1024;
    public static readonly XNamespace SvgNs = "http://www.w3.org/2000/svg";

    public const string NoteScripts = "Scripts were taken out.";
    public const string NoteEmbedded = "Web pages and objects embedded in the picture were taken out.";
    public const string NoteMedia = "Sound and video were taken out.";
    public const string NoteAnimations = "Animations that change links or run scripts were taken out.";
    public const string NoteLinks = "Links to other files were taken out.";
    public const string NoteStyles = "Style rules that load other files or run code were taken out.";

    private static readonly HashSet<string> ScriptElements = new(StringComparer.OrdinalIgnoreCase) { "script", "handler", "listener" };
    private static readonly HashSet<string> EmbeddedElements = new(StringComparer.OrdinalIgnoreCase) { "foreignObject", "iframe", "object", "embed", "frame", "frameset", "applet" };
    private static readonly HashSet<string> MediaElements = new(StringComparer.OrdinalIgnoreCase) { "audio", "video", "source", "track" };
    private static readonly HashSet<string> AnimationElements = new(StringComparer.OrdinalIgnoreCase) { "animate", "animateColor", "animateMotion", "animateTransform", "set" };

    private static readonly Regex SafeData = new(@"^data:image/(png|jpeg|gif|webp);base64,", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex ScriptScheme = new(@"^\s*(javascript|vbscript|livescript)\s*:", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    // In CSS that has been unescaped and lower-cased: a url() that isn't to a part of the picture, or anything that runs code or loads a file.
    private static readonly Regex BadCss = new(@"url\s*\(\s*(?!['""]?\s*#)|expression\s*\(|javascript\s*:|vbscript\s*:|@import|behavior\s*:|-moz-binding|image-set\s*\(|src\s*\(", RegexOptions.CultureInvariant);
    private static readonly Regex OuterUrl = new(@"url\s*\(\s*(?!['""]?\s*#)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static XmlReaderSettings ReaderSettings() => new()
    {
        DtdProcessing = DtdProcessing.Ignore,
        XmlResolver = null,
        MaxCharactersInDocument = MaxBytes,
        IgnoreProcessingInstructions = true,
    };

    /// <summary>
    /// The text of an SVG file's bytes: by its byte-order mark, else the encoding its XML declaration names, else UTF-8.
    /// </summary>
    public static string Read(byte[] bytes)
    {
        if (bytes.LongLength > MaxBytes) throw TooLarge();
        Encoding enc = new UTF8Encoding(false);
        var bom = bytes.Length >= 2 && ((bytes[0] == 0xFF && bytes[1] == 0xFE) || (bytes[0] == 0xFE && bytes[1] == 0xFF)) || bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
        if (!bom)
        {
            var head = Encoding.ASCII.GetString(bytes, 0, Math.Min(bytes.Length, 200));
            var m = Regex.Match(head, @"^\s*<\?xml[^>]*encoding\s*=\s*['""]([A-Za-z0-9._-]+)['""]");
            if (m.Success)
                try { enc = Encoding.GetEncoding(m.Groups[1].Value); }
                catch (ArgumentException) { /* unknown: read it as UTF-8 */ }
        }
        using var reader = new StreamReader(new MemoryStream(bytes), enc, detectEncodingFromByteOrderMarks: true);
        return reader.ReadToEnd();
    }

    /// <summary>The SVG made safe for the page's DOM; <paramref name="notes"/> says, in plain words, what was taken out.</summary>
    public static string Sanitize(string svg, out List<string> notes)
    {
        notes = [];
        if (svg.Length > MaxBytes || Encoding.UTF8.GetByteCount(svg) > MaxBytes) throw TooLarge();
        var doc = Load(svg) ?? throw NotSvg();
        var root = doc.Root!;
        if (root.Name.LocalName != "svg" || (root.Name.Namespace != SvgNs && root.Name.Namespace != XNamespace.None)) throw NotSvg();
        // Written without its namespace (as many hand-made files are): it's SVG all the same.
        if (root.Name.Namespace == XNamespace.None)
            foreach (var e in root.DescendantsAndSelf().Where(e => e.Name.Namespace == XNamespace.None).ToList())
                e.Name = SvgNs + e.Name.LocalName;

        var found = new List<string>();
        void Note(string n) { if (!found.Contains(n)) found.Add(n); }

        foreach (var e in root.Descendants().ToList())
        {
            if (e.Ancestors().LastOrDefault() != root) continue; // inside something already taken out
            var local = e.Name.LocalName;
            if (ScriptElements.Contains(local)) { e.Remove(); Note(NoteScripts); continue; }
            if (EmbeddedElements.Contains(local)) { e.Remove(); Note(NoteEmbedded); continue; }
            if (MediaElements.Contains(local)) { e.Remove(); Note(NoteMedia); continue; }
            if (AnimationElements.Contains(local))
            {
                var target = (e.Attribute("attributeName")?.Value ?? "").Trim();
                if (target.Equals("href", StringComparison.OrdinalIgnoreCase) || target.EndsWith(":href", StringComparison.OrdinalIgnoreCase) || target.StartsWith("on", StringComparison.OrdinalIgnoreCase))
                { e.Remove(); Note(NoteAnimations); continue; }
            }
        }

        foreach (var e in root.DescendantsAndSelf())
        {
            foreach (var a in e.Attributes().Where(a => !a.IsNamespaceDeclaration).ToList())
            {
                var name = a.Name.LocalName;
                if (name.StartsWith("on", StringComparison.OrdinalIgnoreCase)) { a.Remove(); Note(NoteScripts); continue; }
                if (name.Equals("href", StringComparison.OrdinalIgnoreCase))
                {
                    var v = a.Value.Trim();
                    if (v.StartsWith('#') || SafeData.IsMatch(v)) continue;
                    a.Remove(); Note(ScriptScheme.IsMatch(v) ? NoteScripts : NoteLinks);
                    continue;
                }
                if (name.Equals("style", StringComparison.OrdinalIgnoreCase))
                {
                    var kept = CleanDeclarations(a.Value, out var dropped);
                    if (!dropped) continue;
                    Note(NoteStyles);
                    if (kept.Length == 0) a.Remove(); else a.Value = kept;
                    continue;
                }
                // fill="url(http://…)" and the like load a file just as a link does; a script: scheme anywhere is a script.
                if (ScriptScheme.IsMatch(a.Value)) { a.Remove(); Note(NoteScripts); continue; }
                if (a.Value.Contains("url", StringComparison.OrdinalIgnoreCase) && OuterUrl.IsMatch(a.Value)) { a.Remove(); Note(NoteLinks); }
            }
            if (e.Name.LocalName.Equals("style", StringComparison.OrdinalIgnoreCase))
            {
                var css = string.Concat(e.Nodes().OfType<XText>().Select(t => t.Value));
                var kept = CleanStyleSheet(css, out var dropped);
                if (e.Elements().Any()) { e.Elements().Remove(); dropped = true; }
                if (!dropped) continue;
                Note(NoteStyles);
                e.ReplaceNodes(new XText(kept));
            }
        }

        notes = found;
        var settings = new XmlWriterSettings { OmitXmlDeclaration = true, Encoding = new UTF8Encoding(false), Indent = false, NewLineHandling = NewLineHandling.None };
        var sb = new StringBuilder(svg.Length);
        using (var w = XmlWriter.Create(sb, settings)) doc.Save(w);
        return sb.ToString();
    }

    /// <summary>The picture's size in CSS pixels, from its width, height and viewBox; 800 × 600 when it doesn't say.</summary>
    public static (double Width, double Height) Size(string svg)
    {
        const double defW = 800, defH = 600;
        var doc = Load(svg);
        var root = doc?.Root;
        if (root == null || root.Name.LocalName != "svg") return (defW, defH);
        var w = Length((string?)root.Attribute("width"));
        var h = Length((string?)root.Attribute("height"));
        double? vw = null, vh = null;
        var vb = ((string?)root.Attribute("viewBox") ?? "").Split([' ', ',', '\t', '\n', '\r'], StringSplitOptions.RemoveEmptyEntries);
        if (vb.Length == 4 && double.TryParse(vb[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var a) && double.TryParse(vb[3], NumberStyles.Float, CultureInfo.InvariantCulture, out var b) && a > 0 && b > 0 && double.IsFinite(a) && double.IsFinite(b))
            (vw, vh) = (a, b);
        if (w == null && h != null && vw != null) w = h * vw / vh;
        if (h == null && w != null && vw != null) h = w * vh / vw;
        return (w ?? vw ?? defW, h ?? vh ?? defH);
    }

    /// <summary>An SVG length in CSS pixels; null for a percentage, "auto" or nonsense.</summary>
    private static double? Length(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var m = Regex.Match(s.Trim(), @"^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|q)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (!m.Success || !double.TryParse(m.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var v)) return null;
        var px = v * (m.Groups[2].Value.ToLowerInvariant() switch
        {
            "pt" => 96.0 / 72, "pc" => 16, "mm" => 96 / 25.4, "cm" => 96 / 2.54, "in" => 96, "q" => 96 / 101.6, _ => 1,
        });
        return px > 0 && double.IsFinite(px) ? px : null;
    }

    private static XDocument? Load(string svg)
    {
        try
        {
            using var reader = XmlReader.Create(new StringReader(svg.TrimStart('\uFEFF')), ReaderSettings());
            return XDocument.Load(reader, LoadOptions.PreserveWhitespace);
        }
        catch (XmlException) { return null; }
    }

    private static InvalidDataException NotSvg() => new("That isn't an SVG picture.");
    private static InvalidDataException TooLarge() => new($"That SVG is too large to open here (it can be up to {MaxBytes / 1024 / 1024} MB).");

    /// <summary>CSS as a browser reads it, for checking: comments gone, escapes (\75 rl, \u) undone, lower case.</summary>
    private static string Plain(string css)
    {
        var s = Regex.Replace(css, @"/\*.*?(\*/|$)", "", RegexOptions.Singleline);
        s = Regex.Replace(s, @"\\([0-9a-fA-F]{1,6})\s?|\\(.)", m =>
        {
            if (!m.Groups[1].Success) return m.Groups[2].Value;
            var code = int.Parse(m.Groups[1].Value, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            return code is > 0 and <= 0x10FFFF and not (>= 0xD800 and <= 0xDFFF) ? char.ConvertFromUtf32(code) : "\uFFFD";
        }, RegexOptions.Singleline);
        return s.Replace("\0", "").ToLowerInvariant();
    }

    private static bool Bad(string css) => BadCss.IsMatch(Plain(css));

    /// <summary>Splits CSS at <paramref name="sep"/> where it isn't inside brackets, quotes or a comment.</summary>
    private static List<string> SplitTop(string css, char sep)
    {
        var parts = new List<string>();
        int depth = 0, start = 0;
        char quote = '\0';
        for (var i = 0; i < css.Length; i++)
        {
            var c = css[i];
            if (c == '\\') { i++; continue; }
            if (quote != '\0') { if (c == quote) quote = '\0'; continue; }
            if (c == '/' && i + 1 < css.Length && css[i + 1] == '*') { var end = css.IndexOf("*/", i + 2, StringComparison.Ordinal); i = end < 0 ? css.Length : end + 1; continue; }
            if (c is '"' or '\'') quote = c;
            else if (c is '(' or '[') depth++;
            else if (c is ')' or ']') depth = Math.Max(0, depth - 1);
            else if (c == sep && depth == 0) { parts.Add(css[start..i]); start = i + 1; }
        }
        parts.Add(css[start..]);
        return parts;
    }

    /// <summary>A style attribute without the declarations that load files or run code.</summary>
    private static string CleanDeclarations(string style, out bool dropped)
    {
        dropped = false;
        if (!Bad(style)) return style;
        var kept = new List<string>();
        foreach (var d in SplitTop(style, ';'))
        {
            if (Bad(d)) { dropped = true; continue; }
            if (!string.IsNullOrWhiteSpace(d)) kept.Add(d.Trim());
        }
        if (!dropped) { dropped = true; return ""; } // bad only when read whole: drop it all
        return string.Join(";", kept);
    }

    /// <summary>A style sheet without the rules (or at-rules, with all they hold) that load files or run code.</summary>
    private static string CleanStyleSheet(string css, out bool dropped)
    {
        dropped = false;
        if (!Bad(css)) return css;
        dropped = true;
        var kept = new StringBuilder();
        int depth = 0, start = 0;
        char quote = '\0';
        void Chunk(int end)
        {
            var rule = css[start..end];
            start = end;
            if (!string.IsNullOrWhiteSpace(rule) && !Bad(rule)) kept.Append(rule);
        }
        for (var i = 0; i < css.Length; i++)
        {
            var c = css[i];
            if (c == '\\') { i++; continue; }
            if (quote != '\0') { if (c == quote) quote = '\0'; continue; }
            if (c == '/' && i + 1 < css.Length && css[i + 1] == '*') { var end = css.IndexOf("*/", i + 2, StringComparison.Ordinal); i = end < 0 ? css.Length : end + 1; continue; }
            if (c is '"' or '\'') quote = c;
            else if (c == '{') depth++;
            else if (c == '}') { depth = Math.Max(0, depth - 1); if (depth == 0) Chunk(i + 1); }
            else if (c == ';' && depth == 0) Chunk(i + 1);
        }
        Chunk(css.Length);
        var result = kept.ToString();
        return Bad(result) ? "" : result;
    }
}
