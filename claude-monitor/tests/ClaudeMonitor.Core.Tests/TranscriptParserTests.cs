using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class TranscriptParserTests
{
    [Fact]
    public void Assistant_text_with_end_turn()
    {
        var e = TranscriptParser.Parse(Fx.Assistant("hello", "end_turn", "x"))!;
        Assert.Equal(EntryKind.AssistantText, e.Kind);
        Assert.Equal("hello", e.Text);
        Assert.Equal("end_turn", e.StopReason);
        Assert.Equal("x", e.Uuid);
    }

    [Fact]
    public void Assistant_tool_use_collects_ids()
    {
        var e = TranscriptParser.Parse(Fx.ToolUse("toolu_1"))!;
        Assert.Equal(EntryKind.AssistantToolUse, e.Kind);
        Assert.Equal(new[] { "toolu_1" }, e.ToolUseIds);
    }

    [Fact]
    public void User_tool_result_collects_ids()
    {
        var e = TranscriptParser.Parse(Fx.ToolResult("toolu_1"))!;
        Assert.Equal(EntryKind.UserToolResult, e.Kind);
        Assert.Equal(new[] { "toolu_1" }, e.ToolResultIds);
    }

    [Fact]
    public void User_string_content_is_user_text()
    {
        var e = TranscriptParser.Parse(Fx.User("go"))!;
        Assert.Equal(EntryKind.UserText, e.Kind);
        Assert.Equal("go", e.Text);
    }

    [Fact]
    public void Turn_duration_is_turn_end()
    {
        Assert.Equal(EntryKind.TurnEnd, TranscriptParser.Parse(Fx.TurnEnd())!.Kind);
    }

    [Fact]
    public void Thinking_only_is_thinking()
    {
        var line = """{"type":"assistant","uuid":"q","message":{"role":"assistant","stop_reason":null,"content":[{"type":"thinking","thinking":""}]}}""";
        var e = TranscriptParser.Parse(line)!;
        Assert.Equal(EntryKind.AssistantThinking, e.Kind);
        Assert.Null(e.StopReason);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("""{"type":"mode","mode":"normal"}""")]
    [InlineData("""{"type":"attachment","uuid":"z"}""")]
    [InlineData("""{"type":"system","subtype":"other","uuid":"z"}""")]
    public void Irrelevant_or_malformed_lines_return_null(string line)
    {
        Assert.Null(TranscriptParser.Parse(line));
    }
}
