using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class SessionRegistryTests : IDisposable
{
    readonly string dir = Path.Combine(Path.GetTempPath(), "reg-" + Guid.NewGuid());
    public SessionRegistryTests() => Directory.CreateDirectory(dir);
    public void Dispose() => Directory.Delete(dir, true);

    void Write(string id, int pid, string startedAt, string source = "startup", string cwd = "C:\\p") =>
        File.WriteAllText(Path.Combine(dir, id + ".json"),
            $$"""{"session_id":"{{id}}","transcript_path":"C:\\t\\{{id}}.jsonl","cwd":"{{cwd.Replace("\\", "\\\\")}}","source":"{{source}}","claude_pid":{{pid}},"started_at":"{{startedAt}}"}""");

    [Fact]
    public void Loads_records()
    {
        Write("s1", 100, "2026-10-14T10:00:00.000Z");
        var s = Assert.Single(new SessionRegistry(dir).Load(_ => true));
        Assert.Equal("s1", s.SessionId);
        Assert.Equal(100, s.ClaudePid);
        Assert.Equal("startup", s.Source);
        Assert.Equal(new DateTimeOffset(2026, 10, 14, 10, 0, 0, TimeSpan.Zero), s.StartedAt);
    }

    [Fact]
    public void Dead_pids_are_ignored()
    {
        Write("s1", 100, "2026-10-14T10:00:00.000Z");
        Write("s2", 200, "2026-10-14T10:00:00.000Z");
        var s = Assert.Single(new SessionRegistry(dir).Load(pid => pid == 200));
        Assert.Equal("s2", s.SessionId);
    }

    [Fact]
    public void Latest_registration_per_pid_wins()
    {
        Write("old", 100, "2026-10-14T10:00:00.000Z");
        Write("new", 100, "2026-10-14T10:05:00.000Z", "clear");
        var s = Assert.Single(new SessionRegistry(dir).Load(_ => true));
        Assert.Equal("new", s.SessionId);
        Assert.Equal("clear", s.Source);
    }

    [Fact]
    public void Two_sessions_in_same_cwd_with_different_pids_are_both_kept()
    {
        Write("a", 100, "2026-10-14T10:00:00.000Z");
        Write("b", 200, "2026-10-14T10:00:00.000Z");
        Assert.Equal(2, new SessionRegistry(dir).Load(_ => true).Count);
    }

    [Fact]
    public void Malformed_and_partial_files_are_skipped()
    {
        File.WriteAllText(Path.Combine(dir, "bad.json"), "{not json");
        File.WriteAllText(Path.Combine(dir, "half.json"), """{"session_id":"x"}""");
        File.WriteAllText(Path.Combine(dir, "x.json.tmp"), "{}");
        Write("ok", 1, "2026-10-14T10:00:00.000Z");
        Assert.Equal("ok", Assert.Single(new SessionRegistry(dir).Load(_ => true)).SessionId);
    }

    [Fact]
    public void Missing_directory_returns_empty()
    {
        Assert.Empty(new SessionRegistry(Path.Combine(dir, "none")).Load(_ => true));
    }
}
