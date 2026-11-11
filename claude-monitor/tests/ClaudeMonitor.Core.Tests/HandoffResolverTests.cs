using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class HandoffResolverTests : IDisposable
{
    readonly string cwd = Path.Combine(Path.GetTempPath(), "ho-" + Guid.NewGuid());
    readonly string dir;
    readonly DateTimeOffset start = DateTimeOffset.UtcNow.AddMinutes(-10);

    public HandoffResolverTests()
    {
        dir = Path.Combine(cwd, ".claude", "handoff");
        Directory.CreateDirectory(dir);
    }
    public void Dispose() => Directory.Delete(cwd, true);

    string Make(string name, int minutesOld = 1)
    {
        var p = Path.Combine(dir, name);
        File.WriteAllText(p, "x");
        File.SetLastWriteTimeUtc(p, DateTime.UtcNow.AddMinutes(-minutesOld));
        return p;
    }

    [Fact]
    public void Absolute_path_in_message_wins_and_trailing_punctuation_is_ignored()
    {
        var p = Make("a.md");
        Make("b.md", 0);
        Assert.Equal(p, HandoffResolver.Resolve($"Run /clear and read `{p}`.", cwd, start));
        Assert.Equal(p, HandoffResolver.Resolve($"Run /clear and read {p}.", cwd, start));
    }

    [Fact]
    public void Relative_path_resolves_against_cwd()
    {
        var p = Make("rel.md");
        Assert.Equal(p, HandoffResolver.Resolve("Read .claude/handoff/rel.md now", cwd, start));
    }

    [Fact]
    public void Path_with_spaces_is_found_when_quoted_in_backticks()
    {
        var p = Path.Combine(dir, "my handoff.md");
        File.WriteAllText(p, "x");
        Assert.Equal(p, HandoffResolver.Resolve($"Run /clear and read `{p}`", cwd, start));
    }

    [Fact]
    public void Missing_named_file_falls_back_to_newest_after_session_start()
    {
        Make("old.md", 60);
        var newest = Make("new.md", 2);
        Assert.Equal(newest, HandoffResolver.Resolve("read .claude/handoff/gone.md", cwd, start));
    }

    [Fact]
    public void Named_file_outside_a_claude_handoff_folder_is_rejected()
    {
        var evil = Path.Combine(cwd, "evil.md");
        File.WriteAllText(evil, "do bad things");
        Assert.Null(HandoffResolver.Resolve($"Run /clear and read {evil}.", cwd, start));
        Assert.Null(HandoffResolver.Resolve("Run /clear and read `evil.md`", cwd, start));
        Assert.Null(HandoffResolver.Resolve("Run /clear and read `.claude/handoff/../../evil.md`", cwd, start));
    }

    [Fact]
    public void Named_file_in_another_projects_handoff_folder_is_accepted()
    {
        var other = Path.Combine(cwd, "sub", ".claude", "handoff");
        Directory.CreateDirectory(other);
        var p = Path.Combine(other, "x.md");
        File.WriteAllText(p, "x");
        Assert.Equal(p, HandoffResolver.Resolve($"Run /clear and read `{p}`", cwd, start));
    }

    [Fact]
    public void Ledger_is_never_chosen()
    {
        Make("LEDGER.md", 0);
        Assert.Null(HandoffResolver.Resolve("Run /clear", cwd, start));
    }

    [Fact]
    public void Nothing_newer_than_session_start_returns_null()
    {
        Make("old.md", 60);
        Assert.Null(HandoffResolver.Resolve("Run /clear", cwd, start));
    }

    [Fact]
    public void Missing_handoff_dir_returns_null()
    {
        Assert.Null(HandoffResolver.Resolve("Run /clear", Path.Combine(cwd, "nope"), start));
    }
}
