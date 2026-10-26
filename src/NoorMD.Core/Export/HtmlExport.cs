using System.Net;

namespace NoorMD.Core.Export;

/// <summary>
/// Builds a standalone HTML file. The body is sanitized in the page with DOMPurify before it gets here;
/// as a second line of defence the exported file carries a Content-Security-Policy that forbids all
/// scripts, so even markup that slipped through cannot execute when the file is opened in a browser.
/// </summary>
public static class HtmlExport
{
    public const int MaxBodyChars = 50_000_000;

    public static string Build(string title, string sanitizedBodyHtml)
    {
        if (sanitizedBodyHtml.Length > MaxBodyChars) throw new InvalidDataException("The document is too large to export as HTML.");
        var safeTitle = WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(title) ? "Untitled document" : title.Trim());
        return $$$"""
        <!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data:; style-src 'unsafe-inline'; font-src data:">
        <meta name="generator" content="NoorMD">
        <title>{{{safeTitle}}}</title>
        <style>
        body{font:17px/1.75 "Segoe UI",system-ui,-apple-system,sans-serif;max-width:820px;margin:6vh auto;padding:0 24px;color:#232737;background:#fff}
        h1,h2,h3,h4{line-height:1.25;letter-spacing:-.01em}h1,h2{border-bottom:1px solid #eceef4;padding-bottom:.25em}
        a{color:#5b3fc4}img{max-width:100%}hr{border:0;border-top:1px solid #e3e5ec;margin:2em 0}
        pre,code{font-family:"Cascadia Code",Consolas,ui-monospace,monospace;background:#f3f4f8;border-radius:5px}
        code{padding:.1em .35em;font-size:.92em}pre{padding:16px 18px;overflow:auto}pre code{padding:0;background:none}
        blockquote{border-left:4px solid #917adf;margin-left:0;padding:.2em 0 .2em 18px;color:#555}
        table{border-collapse:collapse;width:100%;margin:1em 0}td,th{border:1px solid #dde0e8;padding:7px 10px;text-align:left}th{background:#f6f7fa}
        li.task-list-item{list-style:none}li.task-list-item::before{content:"☐ ";margin-left:-1.4em}li.task-list-item.checked::before{content:"☑ "}
        @media (prefers-color-scheme:dark){body{background:#12151c;color:#e6e9f0}a{color:#b8a3ff}pre,code{background:#1d2230}th{background:#1d2230}td,th{border-color:#2b3242}blockquote{color:#aab}h1,h2{border-color:#2b3242}}
        </style>
        </head>
        <body>
        <main>
        {{{sanitizedBodyHtml}}}
        </main>
        </body>
        </html>
        """;
    }
}
