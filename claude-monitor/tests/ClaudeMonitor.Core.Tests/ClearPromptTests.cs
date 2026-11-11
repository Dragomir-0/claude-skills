using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class ClearPromptTests
{
    [Theory]
    [InlineData("Done. Run `/clear` and read .claude/handoff/x.md.")]
    [InlineData("Context is large, please /clear before continuing.")]
    [InlineData("When the run is finished, tell the user to `/clear` before the next task.")]
    [InlineData("Handoff written.\n\nNext step: type /clear, then read the handoff.")]
    [InlineData("RUN /CLEAR now")]
    public void Real_prompts_match(string text) => Assert.True(ClearPrompt.Asks(text));

    [Theory]
    [InlineData("`/clear` is a built-in command, so a hook can't run it.")]
    [InlineData("Don't run /clear yet.")]
    [InlineData("There is no need to /clear here.")]
    [InlineData("I will never run /clear myself.")]
    [InlineData("Does section 1 look right, and should I carry on?")]
    [InlineData("Use the clear button.")]
    [InlineData("See C:\\tools\\clear for details.")]
    public void Discussion_and_negations_do_not_match(string text) => Assert.False(ClearPrompt.Asks(text));

    [Fact]
    public void Fenced_code_is_ignored()
    {
        Assert.False(ClearPrompt.Asks("Example:\n```\nrun /clear\n```"));
    }

    [Fact]
    public void Block_quotes_are_ignored()
    {
        Assert.False(ClearPrompt.Asks("> run /clear\n"));
    }

    [Fact]
    public void Request_followed_by_waiver_paragraph_still_matches()
    {
        // Real closing message from a session the monitor silently skipped (2026-10-15 09:12):
        // the context hook makes Claude append the waiver sentence as its own last paragraph.
        var text = "## What Claude did\n- Wrote the handoff.\n\n## Next steps\nRun `/clear`. Your next message will resume from the handoff.\n\n" +
                   "To keep going without clearing, include the exact phrase \"i waive the context clear\" in your next message.";
        Assert.True(ClearPrompt.Asks(text));
    }

    [Fact]
    public void Last_paragraph_only_when_tail_count_is_one()
    {
        var text = "1. Type `/clear` and press Enter.\n\nDoes this look right?";
        Assert.False(ClearPrompt.Asks(text, 1));
        Assert.True(ClearPrompt.Asks("Does this look right?\n\nRun /clear when ready.", 1));
    }

    [Fact]
    public void Tail_paragraph_count_is_configurable()
    {
        var text = "Run /clear first.\n\nThen carry on.";
        Assert.False(ClearPrompt.Asks(text, 1));
        Assert.True(ClearPrompt.Asks(text, 2));
    }

    [Fact]
    public void Handles_crlf_and_empty()
    {
        Assert.True(ClearPrompt.Asks("Intro\r\n\r\nRun /clear now."));
        Assert.False(ClearPrompt.Asks(""));
    }
}
