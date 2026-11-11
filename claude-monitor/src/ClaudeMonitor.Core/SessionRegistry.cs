using System.Globalization;
using System.Text.Json;

namespace ClaudeMonitor.Core;

public sealed class SessionRegistry
{
    readonly string dir;
    public SessionRegistry(string dir) => this.dir = dir;

    public IReadOnlyList<SessionInfo> Load(Func<int, bool> isAlive)
    {
        if (!Directory.Exists(dir)) return [];
        var all = new List<SessionInfo>();
        foreach (var file in Directory.EnumerateFiles(dir, "*.json"))
        {
            var info = TryRead(file);
            if (info is not null && isAlive(info.ClaudePid)) all.Add(info);
        }
        return all.GroupBy(s => s.ClaudePid).Select(g => g.OrderByDescending(s => s.StartedAt).First()).ToList();
    }

    static SessionInfo? TryRead(string file)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            var r = doc.RootElement;
            return new SessionInfo(
                r.GetProperty("session_id").GetString()!,
                r.GetProperty("transcript_path").GetString()!,
                r.GetProperty("cwd").GetString()!,
                r.GetProperty("source").GetString()!,
                r.GetProperty("claude_pid").GetInt32(),
                DateTimeOffset.Parse(r.GetProperty("started_at").GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal));
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or IOException or FormatException)
        {
            return null;
        }
    }
}
