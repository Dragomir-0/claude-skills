using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class SessionTailTests : IDisposable
{
    readonly string path = Path.Combine(Path.GetTempPath(), "tail-" + Guid.NewGuid() + ".jsonl");
    public void Dispose() { if (File.Exists(path)) File.Delete(path); }

    [Fact]
    public void Reads_from_start_when_not_baselined()
    {
        File.WriteAllText(path, Fx.User("hi") + "\n" + Fx.Assistant("yo") + "\n");
        var t = new SessionTail(path, baselineToEnd: false);
        Assert.True(t.Poll() || t.Entries.Count == 2);
        Assert.Equal(2, t.Entries.Count);
    }

    [Fact]
    public void Baseline_ignores_existing_content_but_sees_new_lines()
    {
        File.WriteAllText(path, Fx.Assistant("old /clear request") + "\n");
        var t = new SessionTail(path, baselineToEnd: true);
        Assert.False(t.Poll());
        Assert.Empty(t.Entries);
        File.AppendAllText(path, Fx.Assistant("new", "end_turn", "n1") + "\n");
        Assert.True(t.Poll());
        Assert.Equal("n1", Assert.Single(t.Entries).Uuid);
    }

    [Fact]
    public void Partial_trailing_line_waits_for_newline()
    {
        var line = Fx.Assistant("half");
        File.WriteAllText(path, line[..20]);
        var t = new SessionTail(path, false);
        Assert.Empty(t.Entries);
        File.AppendAllText(path, line[20..] + "\n");
        Assert.True(t.Poll());
        Assert.Single(t.Entries);
    }

    [Fact]
    public void Missing_file_is_not_an_error_and_reports_length_and_mtime()
    {
        var t = new SessionTail(path, false);
        Assert.False(t.Poll());
        File.WriteAllText(path, Fx.User("x") + "\n");
        Assert.True(t.Poll());
        Assert.Equal(new FileInfo(path).Length, t.Length);
        Assert.True((DateTimeOffset.UtcNow - t.LastWrite).TotalSeconds < 30);
    }

    [Fact]
    public void Unicode_survives_multibyte_boundaries()
    {
        File.WriteAllText(path, Fx.Assistant("héllo → ✓") + "\n");
        var t = new SessionTail(path, false);
        Assert.Equal("héllo → ✓", Assert.Single(t.Entries).Text);
    }
}
