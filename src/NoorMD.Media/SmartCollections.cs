using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Media;

/// <summary>One condition of a smart collection, e.g. (genre, contains, "synth") or (lastPlayed, olderThanDays, 30).</summary>
public sealed record SmartRule(string Field, string Op, string? Value = null);

/// <summary>
/// A smart collection: conditions that are all (or any) true, optionally limited to the first N tracks by a sort
/// ("the 50 most played"). Evaluated live, so the collection changes as the library does.
/// </summary>
public sealed record SmartRules(bool MatchAll, IReadOnlyList<SmartRule> Rules, string? LimitSort = null, bool LimitDesc = false, int? Limit = null);

/// <summary>Turns smart rules into a parameterised SQL condition. Fields and operators are whitelisted; values are always parameters.</summary>
public static class SmartSql
{
    private enum Kind { Text, Number, Date, Flag, Triage }

    private static readonly Dictionary<string, (Kind Kind, string Column)> Fields = new(StringComparer.Ordinal)
    {
        ["title"] = (Kind.Text, "COALESCE(t.title, t.sort_name)"), ["artist"] = (Kind.Text, "t.artist"), ["album"] = (Kind.Text, "t.album"),
        ["albumArtist"] = (Kind.Text, "t.album_artist"), ["genre"] = (Kind.Text, "t.genre"), ["comment"] = (Kind.Text, "t.comment"),
        ["fileName"] = (Kind.Text, "t.sort_name"), ["folder"] = (Kind.Text, "t.sort_folder"),
        ["year"] = (Kind.Number, "t.year"), ["plays"] = (Kind.Number, "t.play_count"), ["duration"] = (Kind.Number, "t.duration"),
        ["loudness"] = (Kind.Number, "t.loudness"), ["trackNumber"] = (Kind.Number, "t.track_no"),
        ["added"] = (Kind.Date, "t.added"), ["lastPlayed"] = (Kind.Date, "t.last_played"),
        ["hasArt"] = (Kind.Flag, "t.has_art"), ["missing"] = (Kind.Flag, "t.missing"), ["measured"] = (Kind.Flag, "(t.loudness IS NOT NULL)"),
        ["triage"] = (Kind.Triage, "t.triage"),
    };

    private static readonly Dictionary<string, string> LimitSorts = new()
    {
        ["plays"] = "t.play_count", ["added"] = "t.added", ["lastPlayed"] = "t.last_played", ["title"] = "t.sort_title", ["duration"] = "t.duration",
        ["random"] = "random()", ["year"] = "t.year",
    };

    public const int MaxRules = 20;
    public const int MaxLimit = 10_000;

    public static (string Sql, List<(string, object?)> Args) Build(SmartRules rules, DateTime nowUtc)
    {
        if (rules.Rules.Count > MaxRules) throw new ArgumentException($"A smart collection can have at most {MaxRules} conditions.");
        var parts = new List<string>();
        var args = new List<(string, object?)>();
        var n = 0;
        foreach (var rule in rules.Rules)
        {
            if (!Fields.TryGetValue(rule.Field, out var f)) throw new ArgumentException($"Unknown field \"{rule.Field}\".");
            var p = $"$sm{n++}";
            string Arg(object? v) { args.Add((p, v)); return p; }
            var v = rule.Value?.Trim() ?? "";
            parts.Add((f.Kind, rule.Op) switch
            {
                (Kind.Text, "contains") => $"noor_fold({f.Column}) LIKE {Arg(Like(v))} ESCAPE '\\'",
                (Kind.Text, "notContains") => $"COALESCE(noor_fold({f.Column}), '') NOT LIKE {Arg(Like(v))} ESCAPE '\\'",
                (Kind.Text, "is") => $"noor_fold({f.Column}) = {Arg(TextFold.Fold(v))}",
                (Kind.Text, "isNot") => $"COALESCE(noor_fold({f.Column}), '') <> {Arg(TextFold.Fold(v))}",
                (Kind.Text, "startsWith") => $"noor_fold({f.Column}) LIKE {Arg(Like(v, start: true))} ESCAPE '\\'",
                (Kind.Text, "isEmpty") => $"COALESCE({f.Column}, '') = ''",
                (Kind.Text, "notEmpty") => $"COALESCE({f.Column}, '') <> ''",
                (Kind.Number, "eq") => $"{f.Column} = {Arg(Num(v, rule))}",
                (Kind.Number, "ne") => $"COALESCE({f.Column} <> {Arg(Num(v, rule))}, 1)",
                (Kind.Number, "lt") => $"{f.Column} < {Arg(Num(v, rule))}",
                (Kind.Number, "gt") => $"{f.Column} > {Arg(Num(v, rule))}",
                (Kind.Number, "le") => $"{f.Column} <= {Arg(Num(v, rule))}",
                (Kind.Number, "ge") => $"{f.Column} >= {Arg(Num(v, rule))}",
                (Kind.Number, "isEmpty") => $"{f.Column} IS NULL",
                (Kind.Date, "withinDays") => $"{f.Column} >= {Arg(Days(v, rule, nowUtc))}",
                (Kind.Date, "olderThanDays") => $"({f.Column} IS NULL OR {f.Column} < {Arg(Days(v, rule, nowUtc))})",
                (Kind.Date, "never") => $"{f.Column} IS NULL",
                (Kind.Date, "ever") => $"{f.Column} IS NOT NULL",
                (Kind.Flag, "isTrue") => $"{f.Column} = 1",
                (Kind.Flag, "isFalse") => $"{f.Column} = 0",
                (Kind.Triage, "is") => $"{f.Column} = {Arg(Triage(v))}",
                (Kind.Triage, "isNot") => $"{f.Column} <> {Arg(Triage(v))}",
                _ => throw new ArgumentException($"\"{rule.Op}\" can't be used with {rule.Field}."),
            });
        }
        var where = parts.Count == 0 ? "1 = 1" : "(" + string.Join(rules.MatchAll ? " AND " : " OR ", parts) + ")";
        if (rules.Limit is int limit)
        {
            if (limit is < 1 or > MaxLimit) throw new ArgumentException($"The limit must be between 1 and {MaxLimit:N0}.");
            if (!LimitSorts.TryGetValue(rules.LimitSort ?? "plays", out var order)) throw new ArgumentException($"Unknown sort \"{rules.LimitSort}\".");
            var nulls = order == "random()" ? "" : $"{order} IS NULL, ";
            where = $"t.id IN (SELECT t.id FROM tracks t WHERE {where} ORDER BY {nulls}{order}{(rules.LimitDesc ? " DESC" : "")}, t.id LIMIT {limit})";
        }
        return (where, args);
    }

    private static string Like(string v, bool start = false)
    {
        var e = TextFold.Fold(v).Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
        return (start ? "" : "%") + e + "%";
    }

    private static double Num(string v, SmartRule rule) =>
        double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && double.IsFinite(d) ? d : throw new ArgumentException($"{rule.Field}: \"{v}\" is not a number.");

    private static string Days(string v, SmartRule rule, DateTime nowUtc)
    {
        if (!int.TryParse(v, NumberStyles.None, CultureInfo.InvariantCulture, out var days) || days > 36_500) throw new ArgumentException($"{rule.Field}: \"{v}\" is not a number of days.");
        return nowUtc.AddDays(-days).ToString("O", CultureInfo.InvariantCulture);
    }

    private static int Triage(string v) =>
        int.TryParse(v, NumberStyles.None, CultureInfo.InvariantCulture, out var t) && t is >= 0 and <= 4 ? t : throw new ArgumentException("The mark must be 0–4.");

    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    public static string Serialize(SmartRules rules) => JsonSerializer.Serialize(rules, Options);

    public static SmartRules Parse(string json)
    {
        try
        {
            var r = JsonSerializer.Deserialize<SmartRules>(json, Options) ?? throw new ArgumentException("Empty rules.");
            return r with { Rules = r.Rules ?? [] };
        }
        catch (JsonException ex) { throw new ArgumentException("The smart collection rules are not readable: " + ex.Message); }
    }

    /// <summary>Rules from a bridge payload ({ matchAll, rules: [{ field, op, value }], limit, limitSort, limitDesc }).</summary>
    public static SmartRules FromPayload(JsonElement p)
    {
        if (p.ValueKind != JsonValueKind.Object) return new SmartRules(true, []);
        var list = new List<SmartRule>();
        if (p.TryGetProperty("rules", out var rs) && rs.ValueKind == JsonValueKind.Array)
            foreach (var r in rs.EnumerateArray().Take(MaxRules + 1))
                list.Add(new SmartRule(NoorMD.Core.Bridge.Json.OptString(r, "field", 40) ?? "", NoorMD.Core.Bridge.Json.OptString(r, "op", 40) ?? "",
                    r.TryGetProperty("value", out var v) ? (v.ValueKind == JsonValueKind.Number ? v.GetRawText() : NoorMD.Core.Bridge.Json.OptString(r, "value", 500)) : null));
        return new SmartRules(!p.TryGetProperty("matchAll", out var m) || m.ValueKind != JsonValueKind.False, list,
            NoorMD.Core.Bridge.Json.OptString(p, "limitSort", 20), NoorMD.Core.Bridge.Json.IsTrue(p, "limitDesc"), NoorMD.Core.Bridge.Json.OptInt(p, "limit"));
    }
}
