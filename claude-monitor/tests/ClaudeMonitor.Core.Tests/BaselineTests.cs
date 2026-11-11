using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class BaselineTests : IDisposable
{
    readonly string path = Path.Combine(Path.GetTempPath(), "base-" + Guid.NewGuid() + ".jsonl");
    public void Dispose() { if (File.Exists(path)) File.Delete(path); }

    [Fact]
    public void Old_clear_request_present_when_daemon_starts_never_fires()
    {
        File.WriteAllText(path, Fx.User("go") + "\n" + Fx.Assistant("Run /clear now.", "end_turn", "old") + "\n");
        var tail = new SessionTail(path, baselineToEnd: true);
        tail.Poll();
        var d = Detector.Evaluate(tail.Entries, tail.LastWrite.AddMinutes(-5), DateTimeOffset.UtcNow, new DetectorOptions(TimeSpan.FromSeconds(5)));
        Assert.Equal(DetectKind.Skip, d.Kind);
    }

    [Fact]
    public void New_request_appended_after_daemon_start_fires_once_quiet()
    {
        File.WriteAllText(path, Fx.User("go") + "\n");
        var tail = new SessionTail(path, baselineToEnd: true);
        File.AppendAllText(path, Fx.Assistant("Run /clear now.", "end_turn", "new") + "\n");
        tail.Poll();
        var d = Detector.Evaluate(tail.Entries, tail.LastWrite.AddMinutes(-5), DateTimeOffset.UtcNow, new DetectorOptions(TimeSpan.FromSeconds(5)));
        Assert.Equal(DetectKind.Fire, d.Kind);
        Assert.Equal("new", d.MessageUuid);
    }
}
