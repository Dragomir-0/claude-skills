using System.Text;
using System.Text.Json;

namespace ClaudeMonitor.Core;

public static class TranscriptParser
{
    static readonly string[] None = [];

    public static TranscriptEntry? Parse(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return null;
        JsonDocument doc;
        try { doc = JsonDocument.Parse(line); }
        catch (JsonException) { return null; }

        using (doc)
        {
            var root = doc.RootElement;
            var type = Str(root, "type");
            var uuid = Str(root, "uuid") ?? "";

            if (type == "system")
                return Str(root, "subtype") == "turn_duration"
                    ? new TranscriptEntry(EntryKind.TurnEnd, uuid, "", null, None, None)
                    : null;

            if (type is not ("assistant" or "user")) return null;
            if (!root.TryGetProperty("message", out var msg) || msg.ValueKind != JsonValueKind.Object) return null;

            var text = new StringBuilder();
            var uses = new List<string>();
            var results = new List<string>();
            if (msg.TryGetProperty("content", out var content))
            {
                if (content.ValueKind == JsonValueKind.String) text.Append(content.GetString());
                else if (content.ValueKind == JsonValueKind.Array)
                    foreach (var b in content.EnumerateArray())
                        switch (Str(b, "type"))
                        {
                            case "text": text.Append(Str(b, "text")); break;
                            case "tool_use": uses.Add(Str(b, "id") ?? ""); break;
                            case "tool_result": results.Add(Str(b, "tool_use_id") ?? ""); break;
                        }
            }

            var stop = msg.TryGetProperty("stop_reason", out var sr) && sr.ValueKind == JsonValueKind.String ? sr.GetString() : null;
            EntryKind kind = type == "user"
                ? (results.Count > 0 ? EntryKind.UserToolResult : EntryKind.UserText)
                : uses.Count > 0 ? EntryKind.AssistantToolUse
                : text.Length > 0 ? EntryKind.AssistantText
                : EntryKind.AssistantThinking;
            return new TranscriptEntry(kind, uuid, text.ToString(), stop, uses, results);
        }
    }

    static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() : null;
}
