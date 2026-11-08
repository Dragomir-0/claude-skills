using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class SafetyTests : IDisposable
{
    readonly string dir = Path.Combine(Path.GetTempPath(), "safe-" + Guid.NewGuid());
    static readonly DateTimeOffset T = new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);
    public SafetyTests() => Directory.CreateDirectory(dir);
    public void Dispose() => Directory.Delete(dir, true);

    [Fact]
    public void Cooldown_blocks_same_key_then_releases()
    {
        var r = new RateLimiter(TimeSpan.FromSeconds(60), 10, TimeSpan.FromMinutes(10));
        Assert.True(r.TryAcquire("pid1", T, out _));
        Assert.False(r.TryAcquire("pid1", T.AddSeconds(30), out var why));
        Assert.Equal("cooldown", why);
        Assert.True(r.TryAcquire("pid1", T.AddSeconds(61), out _));
    }

    [Fact]
    public void Different_keys_do_not_share_cooldown()
    {
        var r = new RateLimiter(TimeSpan.FromSeconds(60), 10, TimeSpan.FromMinutes(10));
        Assert.True(r.TryAcquire("pid1", T, out _));
        Assert.True(r.TryAcquire("pid2", T, out _));
    }

    [Fact]
    public void Window_cap_applies_across_keys()
    {
        var r = new RateLimiter(TimeSpan.Zero, 3, TimeSpan.FromMinutes(10));
        Assert.True(r.TryAcquire("a", T, out _));
        Assert.True(r.TryAcquire("b", T.AddSeconds(1), out _));
        Assert.True(r.TryAcquire("c", T.AddSeconds(2), out _));
        Assert.False(r.TryAcquire("d", T.AddSeconds(3), out var why));
        Assert.Equal("rate limit", why);
        Assert.True(r.TryAcquire("d", T.AddMinutes(11), out _));
    }

    [Fact]
    public void ActedStore_persists_across_instances()
    {
        var p = Path.Combine(dir, "acted.txt");
        var a = new ActedStore(p);
        Assert.False(a.Has("u1"));
        a.Add("u1");
        a.Add("u1");
        Assert.True(a.Has("u1"));
        Assert.True(new ActedStore(p).Has("u1"));
        Assert.Single(File.ReadAllLines(p));
    }

    [Fact]
    public void DecisionLog_appends_json_lines_and_creates_directory()
    {
        var p = Path.Combine(dir, "sub", "decisions.jsonl");
        var log = new DecisionLog(p);
        log.Write("s1", "skip", "paused", "u1");
        log.Write("s1", "inject", "/clear sent");
        var lines = File.ReadAllLines(p);
        Assert.Equal(2, lines.Length);
        Assert.Contains("\"action\":\"skip\"", lines[0]);
        Assert.Contains("\"uuid\":\"u1\"", lines[0]);
    }
}
