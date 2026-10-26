using NoorMD.Core.Documents;

namespace NoorMD.Core.Security;

public enum LinkKind { External, LocalDocument, Blocked }

public sealed record LinkDecision(LinkKind Kind, string Target, string Reason);

/// <summary>
/// Decides what a clicked link in a document may do. Only web/mail links (opened in the default
/// browser after confirmation) and Markdown/text files next to the current document (opened in
/// NoorMD) are allowed. Executables, scripts, file shares and every other scheme are blocked.
/// </summary>
public static class LinkPolicy
{
    private static readonly string[] ExternalSchemes = ["http", "https", "mailto"];

    public static LinkDecision Classify(string? href, string? documentFolder)
    {
        href = (href ?? "").Trim();
        if (href.Length == 0 || href.Length > 4096) return Block("Empty or overlong link.");

        // Links the page resolved against the app origin are really relative document links.
        if (href.StartsWith(AssetResolver.Origin + "/", StringComparison.OrdinalIgnoreCase))
            href = href[(AssetResolver.Origin.Length + 1)..];

        if (Uri.TryCreate(href, UriKind.Absolute, out var abs) && abs.Scheme.Length > 1)
        {
            if (ExternalSchemes.Contains(abs.Scheme, StringComparer.OrdinalIgnoreCase))
                return new LinkDecision(LinkKind.External, abs.AbsoluteUri, "");
            if (abs.IsFile && !abs.IsUnc)
                return LocalDocument(abs.LocalPath, documentFolder, mustBeInsideFolder: false);
            return Block($"Links using \"{abs.Scheme}:\" are not opened by NoorMD.");
        }

        if (href.StartsWith("//") || href.StartsWith(@"\\")) return Block("Network paths are not opened from documents.");
        if (documentFolder == null) return Block("Save the document first to follow relative links.");

        var pathPart = href.Split('#', '?')[0];
        if (pathPart.Length == 0) return Block("Links within the page are not followed.");
        string decoded;
        try { decoded = Uri.UnescapeDataString(pathPart); } catch { return Block("Malformed link."); }
        if (decoded.Contains(':') || decoded.Contains('\0')) return Block("Unsupported link target.");
        string full;
        try { full = Path.GetFullPath(Path.Combine(documentFolder, decoded.Replace('/', Path.DirectorySeparatorChar))); }
        catch { return Block("Malformed link."); }
        return LocalDocument(full, documentFolder, mustBeInsideFolder: false);
    }

    private static LinkDecision LocalDocument(string path, string? folder, bool mustBeInsideFolder)
    {
        if (!DocumentFile.IsOpenable(path))
            return Block("Only Markdown and text files can be opened from links. Other local files (programs, scripts, documents) are blocked for safety.");
        if (path.StartsWith(@"\\")) return Block("Network paths are not opened from documents.");
        if (mustBeInsideFolder && folder != null && !path.StartsWith(Path.GetFullPath(folder), StringComparison.OrdinalIgnoreCase))
            return Block("The linked file is outside the document's folder.");
        if (!File.Exists(path)) return Block($"\"{Path.GetFileName(path)}\" was not found.");
        return new LinkDecision(LinkKind.LocalDocument, path, "");
    }

    private static LinkDecision Block(string reason) => new(LinkKind.Blocked, "", reason);
}
