using System.Text.Json;
using System.Text.Json.Nodes;
using NoorMD.Core.Settings;

namespace NoorMD.Core.Bridge;

/// <summary>A validated request from the web UI. See docs/BRIDGE.md.</summary>
public sealed record BridgeRequest(long? Id, string Type, JsonElement Payload)
{
    public string? GetString(string name, int maxLength = 100_000_000)
    {
        if (Payload.ValueKind != JsonValueKind.Object || !Payload.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String) return null;
        var s = v.GetString();
        return s != null && s.Length <= maxLength ? s : null;
    }
}

/// <summary>Parses and builds bridge messages (protocol v1). Unknown or malformed messages are rejected.</summary>
public static class BridgeProtocol
{
    public const int Version = 1;
    private const int MaxTypeLength = 64;

    public static bool TryParse(string json, out BridgeRequest? request, out string? error)
    {
        request = null;
        error = null;
        try
        {
            using var doc = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 32 });
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) { error = "Message must be an object."; return false; }
            if (!root.TryGetProperty("v", out var v) || !Json.TryInt(v, out var ver) || ver != Version) { error = "Unsupported protocol version."; return false; }
            if (!root.TryGetProperty("type", out var t) || t.ValueKind != JsonValueKind.String) { error = "Missing type."; return false; }
            var type = t.GetString()!;
            if (type.Length is 0 or > MaxTypeLength || !type.All(c => char.IsAsciiLetterOrDigit(c) || c == '.')) { error = "Invalid type."; return false; }
            long? id = null;
            if (root.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.Number && idEl.TryGetInt64(out var idVal)) id = idVal;
            var payload = root.TryGetProperty("payload", out var p) && p.ValueKind == JsonValueKind.Object ? p.Clone() : JsonDocument.Parse("{}").RootElement.Clone();
            request = new BridgeRequest(id, type, payload);
            return true;
        }
        catch (JsonException ex)
        {
            error = "Malformed JSON: " + ex.Message;
            return false;
        }
    }

    public static string Reply(long id, object? result) =>
        new JsonObject { ["v"] = Version, ["replyTo"] = id, ["ok"] = true, ["result"] = ToNode(result) }.ToJsonString();

    public static string ReplyError(long id, string message) =>
        new JsonObject { ["v"] = Version, ["replyTo"] = id, ["ok"] = false, ["error"] = message }.ToJsonString();

    public static string Event(string name, object? payload) =>
        new JsonObject { ["v"] = Version, ["event"] = name, ["payload"] = ToNode(payload) ?? new JsonObject() }.ToJsonString();

    private static JsonNode? ToNode(object? value) =>
        value == null ? null : JsonSerializer.SerializeToNode(value, value.GetType(), SettingsStore.Json);
}
