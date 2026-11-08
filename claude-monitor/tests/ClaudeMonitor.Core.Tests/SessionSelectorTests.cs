using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class SessionSelectorTests
{
    static SessionInfo S(string id, int pid, int minute, string source = "startup") =>
        new(id, "C:\\t\\" + id + ".jsonl", "C:\\p", source, pid, new DateTimeOffset(2026, 10, 14, 10, minute, 0, TimeSpan.Zero));

    [Fact]
    public void Empty_registry_selects_nothing() => Assert.Null(SessionSelector.Newest([]));

    [Fact]
    public void Picks_the_most_recently_started_session()
    {
        var pick = SessionSelector.Newest([S("a", 1, 5), S("b", 2, 30), S("c", 3, 10)]);
        Assert.Equal("b", pick!.SessionId);
    }

    [Fact]
    public void A_clear_in_an_older_process_makes_its_new_session_the_newest()
    {
        var pick = SessionSelector.Newest([S("a2", 1, 40, "clear"), S("b", 2, 30)]);
        Assert.Equal("a2", pick!.SessionId);
    }

    [Fact]
    public void Ties_break_on_the_higher_pid_so_the_choice_is_stable()
    {
        var pick = SessionSelector.Newest([S("a", 1, 5), S("b", 9, 5)]);
        Assert.Equal("b", pick!.SessionId);
    }
}
