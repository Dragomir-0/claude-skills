using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class OrchestratorTests : IDisposable
{
    readonly string root = Path.Combine(Path.GetTempPath(), "orch-" + Guid.NewGuid());
    readonly string cwd;
    readonly string logPath;
    readonly List<SessionInfo> sessions = new();
    readonly SessionInfo s1;
    readonly FakeInjector inj;
    long length = 100;
    bool paused;

    sealed class FakeInjector(Func<string, Task> onSend) : IInjector
    {
        public List<string> Sent { get; } = new();
        public bool Result { get; set; } = true;
        public async Task<bool> SendAsync(int pid, string text, bool enter, CancellationToken ct)
        {
            Sent.Add(text);
            await onSend(text);
            return Result;
        }
    }

    public OrchestratorTests()
    {
        cwd = Path.Combine(root, "proj");
        Directory.CreateDirectory(Path.Combine(cwd, ".claude", "handoff"));
        logPath = Path.Combine(root, "decisions.jsonl");
        s1 = new SessionInfo("s1", Path.Combine(root, "t.jsonl"), cwd, "startup", 4242, DateTimeOffset.UtcNow.AddMinutes(-30));
        sessions.Add(s1);
        inj = new FakeInjector(text =>
        {
            if (text == "/clear" && registerClear)
                sessions.Add(new SessionInfo("s2", s1.TranscriptPath, cwd, "clear", 4242, DateTimeOffset.UtcNow));
            return Task.CompletedTask;
        });
    }
    bool registerClear = true;
    public void Dispose() => Directory.Delete(root, true);

    string Handoff()
    {
        var p = Path.Combine(cwd, ".claude", "handoff", "h.md");
        File.WriteAllText(p, "x");
        return p;
    }

    Orchestrator Make(bool dry = false, RateLimiter? limiter = null, ActedStore? acted = null) => new(
        inj,
        limiter ?? new RateLimiter(TimeSpan.Zero, 100, TimeSpan.FromMinutes(10)),
        acted ?? new ActedStore(Path.Combine(root, "acted.txt")),
        new DecisionLog(logPath),
        () => paused,
        () => sessions.ToList(),
        _ => length,
        new OrchestratorOptions(dry, TimeSpan.FromMilliseconds(500), TimeSpan.FromMilliseconds(10), TimeSpan.Zero));

    static Detection Fire(string uuid = "m1", string text = "Run /clear") =>
        new(DetectKind.Fire, "x", uuid, text);

    string Log() => File.Exists(logPath) ? File.ReadAllText(logPath) : "";

    [Fact]
    public async Task Dry_run_logs_and_injects_nothing()
    {
        Handoff();
        await Make(dry: true).HandleAsync(s1, Fire(), 100, default);
        Assert.Empty(inj.Sent);
        Assert.Contains("dry-run", Log());
    }

    [Fact]
    public async Task Live_sends_clear_then_read_after_new_clear_session_registers()
    {
        var h = Handoff();
        await Make().HandleAsync(s1, Fire(text: $"Run /clear and read `{h}`"), 100, default);
        Assert.Equal(new[] { "/clear", $"Read \"{h}\" and follow its instructions." }, inj.Sent);
    }

    [Fact]
    public async Task No_handoff_means_clear_only()
    {
        await Make().HandleAsync(s1, Fire(), 100, default);
        Assert.Equal(new[] { "/clear" }, inj.Sent);
        Assert.Contains("clear only", Log());
    }

    [Fact]
    public async Task Timeout_waiting_for_new_session_sends_no_read_line()
    {
        Handoff();
        registerClear = false;
        await Make().HandleAsync(s1, Fire(), 100, default);
        Assert.Equal(new[] { "/clear" }, inj.Sent);
        Assert.Contains("\"action\":\"error\"", Log());
    }

    [Fact]
    public async Task Clear_inject_failure_is_logged_and_stops()
    {
        Handoff();
        inj.Result = false;
        await Make().HandleAsync(s1, Fire(), 100, default);
        Assert.Equal(new[] { "/clear" }, inj.Sent);
        Assert.Contains("\"action\":\"error\"", Log());
    }

    [Fact]
    public async Task Paused_does_nothing_but_logs()
    {
        paused = true;
        await Make().HandleAsync(s1, Fire(), 100, default);
        Assert.Empty(inj.Sent);
        Assert.Contains("paused", Log());
    }

    [Fact]
    public async Task Changed_transcript_aborts()
    {
        length = 250;
        await Make().HandleAsync(s1, Fire(), 100, default);
        Assert.Empty(inj.Sent);
        Assert.Contains("transcript changed", Log());
    }

    [Fact]
    public async Task Same_message_uuid_is_only_acted_on_once()
    {
        var o = Make();
        await o.HandleAsync(s1, Fire("dup"), 100, default);
        inj.Sent.Clear();
        await o.HandleAsync(s1, Fire("dup"), 100, default);
        Assert.Empty(inj.Sent);
    }

    [Fact]
    public async Task Acted_uuid_survives_restart()
    {
        var path = Path.Combine(root, "acted.txt");
        await Make(acted: new ActedStore(path)).HandleAsync(s1, Fire("p1"), 100, default);
        inj.Sent.Clear();
        await Make(acted: new ActedStore(path)).HandleAsync(s1, Fire("p1"), 100, default);
        Assert.Empty(inj.Sent);
    }

    [Fact]
    public async Task Cooldown_blocks_a_second_message_for_the_same_pid()
    {
        var limiter = new RateLimiter(TimeSpan.FromMinutes(1), 100, TimeSpan.FromMinutes(10));
        var o = Make(limiter: limiter);
        await o.HandleAsync(s1, Fire("a"), 100, default);
        inj.Sent.Clear();
        await o.HandleAsync(s1, Fire("b"), 100, default);
        Assert.Empty(inj.Sent);
        Assert.Contains("cooldown", Log());
    }

    static int Count(string haystack, string needle) =>
        (haystack.Length - haystack.Replace(needle, "").Length) / needle.Length;

    [Fact]
    public async Task Rate_limited_message_is_retried_once_the_limit_clears()
    {
        var limiter = new RateLimiter(TimeSpan.FromMilliseconds(300), 100, TimeSpan.FromMinutes(10));
        Assert.True(limiter.TryAcquire("4242", DateTimeOffset.UtcNow, out _));
        var o = Make(limiter: limiter);

        await o.HandleAsync(s1, Fire("b"), 100, default);
        Assert.Empty(inj.Sent);

        await Task.Delay(400);
        await o.HandleAsync(s1, Fire("b"), 100, default);
        Assert.Equal(new[] { "/clear" }, inj.Sent);
    }

    [Fact]
    public async Task Repeated_skip_for_the_same_message_is_logged_once()
    {
        var limiter = new RateLimiter(TimeSpan.FromMinutes(1), 100, TimeSpan.FromMinutes(10));
        Assert.True(limiter.TryAcquire("4242", DateTimeOffset.UtcNow, out _));
        var o = Make(limiter: limiter);

        for (var i = 0; i < 5; i++) await o.HandleAsync(s1, Fire("b"), 100, default);

        Assert.Empty(inj.Sent);
        Assert.Equal(1, Count(Log(), "cooldown"));
    }

    [Fact]
    public async Task Transcript_change_abort_is_retried_when_it_settles()
    {
        length = 250;
        var o = Make();
        await o.HandleAsync(s1, Fire("m"), 100, default);
        Assert.Empty(inj.Sent);

        length = 100;
        await o.HandleAsync(s1, Fire("m"), 100, default);
        Assert.Equal(new[] { "/clear" }, inj.Sent);
    }

    [Fact]
    public async Task Transcript_change_abort_does_not_use_up_a_rate_limit_slot()
    {
        var limiter = new RateLimiter(TimeSpan.FromMinutes(1), 100, TimeSpan.FromMinutes(10));
        length = 250;
        var o = Make(limiter: limiter);
        await o.HandleAsync(s1, Fire("m"), 100, default);

        Assert.True(limiter.TryAcquire("4242", DateTimeOffset.UtcNow, out _));
    }
}
