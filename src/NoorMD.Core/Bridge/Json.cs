using System.Text.Json;

namespace NoorMD.Core.Bridge;

/// <summary>
/// Null-safe readers for values coming from the page. JsonElement.TryGetInt32 and friends *throw* when the value
/// is null, a string or an object, and the page legitimately sends nulls ("no filter"), so every numeric read
/// from a bridge payload must go through these.
/// </summary>
public static class Json
{
    public static bool TryInt(JsonElement v, out int value)
    {
        value = 0;
        return v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out value);
    }

    public static bool TryLong(JsonElement v, out long value)
    {
        value = 0;
        return v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out value);
    }

    public static bool TryDouble(JsonElement v, out double value)
    {
        value = 0;
        return v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out value);
    }

    public static bool TryUInt(JsonElement v, out uint value)
    {
        value = 0;
        return v.ValueKind == JsonValueKind.Number && v.TryGetUInt32(out value);
    }

    public static bool IsTrue(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    public static long? OptLong(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && TryLong(v, out var l) ? l : null;

    public static int? OptInt(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && TryInt(v, out var i) ? i : null;

    public static string? OptString(JsonElement obj, string name, int maxLength)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String) return null;
        var s = v.GetString();
        return s == null ? null : s.Length <= maxLength ? s : s[..maxLength];
    }
}
