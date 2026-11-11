using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class DetectorTests
{
    static readonly DateTimeOffset Now = new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);
    static readonly DetectorOptions Opts = new(TimeSpan.FromSeconds(5));
    const string Ask = "Handoff written. Run /clear and read .claude/handoff/x.md.";

    static Detection Eval(string[] lines, double quietSecondsAgo = 10) =>
        Detector.Evaluate(Fx.Parse(lines), Now.AddSeconds(-quietSecondsAgo), Now, Opts);

    [Fact]
    public void Fires_on_idle_end_turn_with_request()
    {
        var d = Eval([Fx.User("go"), Fx.Assistant(Ask, "end_turn", "m1"), Fx.TurnEnd()]);
        Assert.Equal(DetectKind.Fire, d.Kind);
        Assert.Equal("m1", d.MessageUuid);
        Assert.Equal(Ask, d.MessageText);
    }

    [Fact]
    public void Skips_when_not_quiet_yet()
    {
        var d = Eval([Fx.User("go"), Fx.Assistant(Ask)], quietSecondsAgo: 1);
        Assert.Equal(DetectKind.Skip, d.Kind);
        Assert.Contains("quiet", d.Reason);
    }

    [Fact]
    public void Skips_when_stop_reason_is_not_end_turn()
    {
        Assert.Equal(DetectKind.Skip, Eval([Fx.User("go"), Fx.Assistant(Ask, "tool_use")]).Kind);
    }

    [Fact]
    public void Skips_when_a_later_user_message_follows()
    {
        Assert.Equal(DetectKind.Skip, Eval([Fx.Assistant(Ask), Fx.User("ok wait")]).Kind);
    }

    [Fact]
    public void Skips_when_text_has_no_clear_request()
    {
        Assert.Equal(DetectKind.Skip, Eval([Fx.User("go"), Fx.Assistant("All done.")]).Kind);
    }

    [Fact]
    public void Skips_when_a_tool_call_in_this_turn_has_no_result()
    {
        var d = Eval([Fx.User("go"), Fx.ToolUse("t1"), Fx.Assistant(Ask)]);
        Assert.Equal(DetectKind.Skip, d.Kind);
        Assert.Contains("tool", d.Reason);
    }

    [Fact]
    public void Resolved_tool_calls_do_not_block()
    {
        var d = Eval([Fx.User("go"), Fx.ToolUse("t1"), Fx.ToolResult("t1"), Fx.Assistant(Ask)]);
        Assert.Equal(DetectKind.Fire, d.Kind);
    }

    [Fact]
    public void Orphan_tool_call_from_an_earlier_turn_does_not_block()
    {
        var d = Eval([Fx.User("first"), Fx.ToolUse("old"), Fx.User("second"), Fx.Assistant(Ask)]);
        Assert.Equal(DetectKind.Fire, d.Kind);
    }

    [Fact]
    public void Skips_empty()
    {
        Assert.Equal(DetectKind.Skip, Eval([]).Kind);
    }
}
