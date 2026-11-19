using System.Text.Json;

namespace Markdown.Core;

/// <summary>Unsaved work: one draft per open document, written while it has changes, removed when it's saved or
/// closed without saving. Drafts outlive the app, so closing NoorMD (or a crash) loses nothing: the documents come
/// back next time with their changes.</summary>
public sealed record Draft
{
    public required string Id { get; init; }
    public string? Path { get; init; }
    public string Title { get; init; } = "Untitled document";
    public string Markdown { get; init; } = "";
    public DateTime SavedUtc { get; init; }
    public string EncodingName { get; init; } = "UTF-8";
    public bool Bom { get; init; }
    public string Eol { get; init; } = "LF";
    public bool FinalNewline { get; init; } = true;
    /// <summary>The file as it was on disk when the document was opened or last saved (to notice other programs' changes).</summary>
    public DateTime? StampUtc { get; init; }
    public long? StampLength { get; init; }

    public TextFormat Format => new(EncodingName, Bom, Eol == "CRLF" ? LineEnding.CRLF : LineEnding.LF, FinalNewline);
    public FileStamp? Stamp => StampUtc is { } t && StampLength is { } l ? new FileStamp(t, l) : null;
}

public sealed record DraftSummary(string Id, string? Path, string Title, DateTime SavedUtc, int Words);

public sealed class DraftStore(string folder)
{
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = false };

    public string Folder { get; } = folder;

    /// <summary>Document ids are short lower-case hex strings made by the page.</summary>
    public static bool IsValidId(string? id) => id is { Length: >= 8 and <= 32 } && id.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

    string FileOf(string id) => IsValidId(id) ? System.IO.Path.Combine(Folder, id + ".json") : throw new ArgumentException("That isn't a document id.");

    public void Save(Draft draft)
    {
        Directory.CreateDirectory(Folder);
        AtomicFile.WriteAllText(FileOf(draft.Id), JsonSerializer.Serialize(draft, Json));
    }

    public Draft? Load(string id)
    {
        try { var d = JsonSerializer.Deserialize<Draft>(File.ReadAllText(FileOf(id)), Json); return d is { } && d.Id == id ? d : null; }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { return null; }
    }

    public void Delete(string id)
    {
        try { File.Delete(FileOf(id)); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    public IReadOnlyList<DraftSummary> List()
    {
        if (!Directory.Exists(Folder)) return [];
        var list = new List<DraftSummary>();
        foreach (var f in Directory.EnumerateFiles(Folder, "*.json"))
        {
            var id = System.IO.Path.GetFileNameWithoutExtension(f);
            if (!IsValidId(id) || Load(id) is not { } d) continue;
            list.Add(new DraftSummary(id, d.Path, d.Title, d.SavedUtc, TextFileCodec.CountWords(d.Markdown)));
        }
        return list.OrderByDescending(d => d.SavedUtc).ToList();
    }
}
