using System.Text.Json;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public static class Fx
{
    public static string Assistant(string text, string? stop = "end_turn", string uuid = "a1") =>
        JsonSerializer.Serialize(new { type = "assistant", uuid, message = new { role = "assistant", stop_reason = stop, content = new object[] { new { type = "text", text } } } });

    public static string ToolUse(string id, string uuid = "t1") =>
        JsonSerializer.Serialize(new { type = "assistant", uuid, message = new { role = "assistant", stop_reason = "tool_use", content = new object[] { new { type = "tool_use", id, name = "Bash" } } } });

    public static string ToolResult(string id, string uuid = "r1") =>
        JsonSerializer.Serialize(new { type = "user", uuid, message = new { role = "user", content = new object[] { new { type = "tool_result", tool_use_id = id, content = "ok" } } } });

    public static string User(string text, string uuid = "u1") =>
        JsonSerializer.Serialize(new { type = "user", uuid, message = new { role = "user", content = text } });

    public static string TurnEnd(string uuid = "s1") =>
        JsonSerializer.Serialize(new { type = "system", subtype = "turn_duration", uuid, durationMs = 5 });

    public static List<TranscriptEntry> Parse(params string[] lines) =>
        lines.Select(TranscriptParser.Parse).Where(e => e is not null).Select(e => e!).ToList();
}
