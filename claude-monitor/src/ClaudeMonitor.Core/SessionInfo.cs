namespace ClaudeMonitor.Core;

public sealed record SessionInfo(
    string SessionId, string TranscriptPath, string Cwd, string Source, int ClaudePid, DateTimeOffset StartedAt);
