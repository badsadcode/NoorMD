using System.Text;

namespace NoorMD.Core.Documents;

public enum LineEnding { LF, CRLF }

/// <summary>How a text file was stored on disk, so saving writes it back the same way.</summary>
public sealed record TextFormat(string EncodingName, bool Bom, LineEnding Eol, bool FinalNewline)
{
    /// <summary>Format for brand-new documents: UTF-8 without BOM, LF, trailing newline.</summary>
    public static TextFormat Default { get; } = new("UTF-8", false, LineEnding.LF, true);

    public string Describe() => $"{EncodingName}{(Bom ? " BOM" : "")} · {Eol}";
}

public sealed record DecodedText(string Text, TextFormat Format, string? Warning);

/// <summary>
/// Decodes and encodes Markdown/text files. The editor always works with '\n' line endings;
/// the original encoding, BOM, line endings and final newline are restored on save.
/// </summary>
public static class TextFileCodec
{
    public const long MaxFileBytes = 25L * 1024 * 1024;

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    static TextFileCodec()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    public static DecodedText Decode(byte[] bytes)
    {
        string text;
        string name;
        bool bom = false;
        string? warning = null;

        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
        {
            text = DecodeStrictOrWarn(bytes.AsSpan(3), ref warning);
            name = "UTF-8"; bom = true;
        }
        else if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
        {
            text = Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2);
            name = "UTF-16 LE"; bom = true;
        }
        else if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF)
        {
            text = Encoding.BigEndianUnicode.GetString(bytes, 2, bytes.Length - 2);
            name = "UTF-16 BE"; bom = true;
        }
        else
        {
            try
            {
                text = StrictUtf8.GetString(bytes);
                name = "UTF-8";
            }
            catch (DecoderFallbackException)
            {
                // Not valid UTF-8: most likely a legacy Windows ("ANSI") file. Read it as Windows-1252 and
                // tell the user it will be saved as UTF-8 — never silently replace characters with '?'.
                text = Encoding.GetEncoding(1252).GetString(bytes);
                name = "UTF-8";
                warning = "This file was not valid UTF-8 and was read as Windows-1252 (Western European). It will be saved as UTF-8.";
            }
        }

        if (text.IndexOf('\0') >= 0)
            throw new InvalidDataException("This looks like a binary file, not Markdown or plain text.");

        int crlf = 0, lf = 0;
        for (int i = 0; i < text.Length; i++)
        {
            if (text[i] != '\n') continue;
            if (i > 0 && text[i - 1] == '\r') crlf++; else lf++;
        }
        var eol = crlf > 0 && crlf >= lf ? LineEnding.CRLF : LineEnding.LF;
        var normalized = NormalizeNewlines(text);
        bool finalNewline = normalized.Length == 0 || normalized.EndsWith('\n');
        return new DecodedText(normalized, new TextFormat(name, bom, eol, finalNewline), warning);
    }

    private static string DecodeStrictOrWarn(ReadOnlySpan<byte> bytes, ref string? warning)
    {
        try { return StrictUtf8.GetString(bytes); }
        catch (DecoderFallbackException)
        {
            warning = "This file contains bytes that are not valid UTF-8; they were replaced with �.";
            return Encoding.UTF8.GetString(bytes);
        }
    }

    public static string NormalizeNewlines(string text) => text.Replace("\r\n", "\n").Replace('\r', '\n');

    public static byte[] Encode(string text, TextFormat format)
    {
        var body = NormalizeNewlines(text);
        if (format.FinalNewline && body.Length > 0 && !body.EndsWith('\n')) body += "\n";
        if (format.Eol == LineEnding.CRLF) body = body.Replace("\n", "\r\n");

        Encoding enc = format.EncodingName switch
        {
            "UTF-16 LE" => new UnicodeEncoding(bigEndian: false, byteOrderMark: format.Bom),
            "UTF-16 BE" => new UnicodeEncoding(bigEndian: true, byteOrderMark: format.Bom),
            _ => new UTF8Encoding(encoderShouldEmitUTF8Identifier: format.Bom),
        };
        var preamble = enc.GetPreamble();
        var payload = enc.GetBytes(body);
        if (preamble.Length == 0) return payload;
        var result = new byte[preamble.Length + payload.Length];
        preamble.CopyTo(result, 0);
        payload.CopyTo(result, preamble.Length);
        return result;
    }

    public static int CountWords(string markdown)
    {
        int words = 0;
        bool inWord = false;
        foreach (var c in markdown)
        {
            bool ws = char.IsWhiteSpace(c);
            if (!ws && !inWord) words++;
            inWord = !ws;
        }
        return words;
    }
}
