using System.Text.Json;
using NoorMD.Core.Bridge;

namespace NoorMD.Media;

/// <summary>Parses Music Bench bridge payloads. Tolerates nulls/missing fields (unit-tested).</summary>
public static class MusicRequests
{
    public static long RequireId(JsonElement p, string name = "id") =>
        Json.OptLong(p, name) ?? throw new ArgumentException($"Missing or invalid \"{name}\".");

    public static List<long> Ids(JsonElement p, string name = "ids")
    {
        if (p.ValueKind != JsonValueKind.Object || !p.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Array) return [];
        var list = new List<long>();
        foreach (var x in v.EnumerateArray())
        {
            if (Json.TryLong(x, out var id)) list.Add(id);
            if (list.Count >= 50_000) break;
        }
        return list;
    }

    public static LibraryQuery Query(JsonElement p)
    {
        var tri = Json.OptInt(p, "triage") is int t && t is >= 0 and <= 4 ? (Triage?)t : null;
        return new LibraryQuery(
            Search: Json.OptString(p, "search", 200),
            Triage: tri,
            MissingOnly: Json.IsTrue(p, "missingOnly"),
            PlaylistId: Json.OptLong(p, "playlistId"),
            Sort: Json.OptString(p, "sort", 20) ?? "title",
            Descending: Json.IsTrue(p, "desc"),
            Offset: Math.Max(0, Json.OptInt(p, "offset") ?? 0),
            Limit: Math.Clamp(Json.OptInt(p, "limit") ?? 200, 1, 2000));
    }

    /// <summary>Tag edit from the dialog: only fields present are changed; "" clears; null/absent leaves unchanged.</summary>
    public static TagEdit? Tags(JsonElement p)
    {
        if (!Json.IsTrue(p, "updateTags") || p.ValueKind != JsonValueKind.Object || !p.TryGetProperty("tags", out var t) || t.ValueKind != JsonValueKind.Object) return null;
        string? S(string n) => Json.OptString(t, n, 2000);
        uint? N(string n)
        {
            if (!t.TryGetProperty(n, out var v)) return null;
            if (Json.TryUInt(v, out var x)) return x;
            return v.ValueKind == JsonValueKind.String && v.GetString() == "" ? 0u : null;
        }
        var edit = new TagEdit { Title = S("title"), Artist = S("artist"), Album = S("album"), AlbumArtist = S("albumArtist"), Genre = S("genre"), Year = N("year"), TrackNumber = N("trackNumber"), Comment = S("comment") };
        return edit.IsEmpty ? null : edit;
    }
}
