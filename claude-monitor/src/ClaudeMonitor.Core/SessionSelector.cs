namespace ClaudeMonitor.Core;

public static class SessionSelector
{
    /// <summary>The single session to watch: the most recently registered one (a /clear re-registers its process).</summary>
    public static SessionInfo? Newest(IReadOnlyList<SessionInfo> sessions) =>
        sessions.OrderByDescending(s => s.StartedAt).ThenByDescending(s => s.ClaudePid).FirstOrDefault();
}
