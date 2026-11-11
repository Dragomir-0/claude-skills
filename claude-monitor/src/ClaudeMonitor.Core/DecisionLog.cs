using System.Text.Json;

namespace ClaudeMonitor.Core;

public sealed class DecisionLog
{
    readonly string path;
    readonly object gate = new();

    public DecisionLog(string path)
    {
        this.path = path;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
    }

    public void Write(string sessionId, string action, string reason, string? uuid = null)
    {
        var line = JsonSerializer.Serialize(new { ts = DateTimeOffset.Now, session = sessionId, action, reason, uuid });
        lock (gate) File.AppendAllText(path, line + "\n");
    }
}
