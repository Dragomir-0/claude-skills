using Xunit;
using ClaudeMonitor.Core;

namespace ClaudeMonitor.Core.Tests;

public class SingleInstanceTests
{
    [Fact]
    public void Second_acquire_for_the_same_key_fails_until_the_first_is_released()
    {
        var key = Path.Combine(Path.GetTempPath(), "si-" + Guid.NewGuid());
        var first = SingleInstance.TryAcquire(key);
        Assert.NotNull(first);
        Assert.Null(SingleInstance.TryAcquire(key));
        first!.Dispose();
        using var again = SingleInstance.TryAcquire(key);
        Assert.NotNull(again);
    }

    [Fact]
    public void Different_keys_do_not_block_each_other()
    {
        using var a = SingleInstance.TryAcquire(Path.Combine(Path.GetTempPath(), "si-" + Guid.NewGuid()));
        using var b = SingleInstance.TryAcquire(Path.Combine(Path.GetTempPath(), "si-" + Guid.NewGuid()));
        Assert.NotNull(a);
        Assert.NotNull(b);
    }

    [Fact]
    public void Key_is_case_and_slash_insensitive()
    {
        var key = Path.Combine(Path.GetTempPath(), "SI-" + Guid.NewGuid());
        using var first = SingleInstance.TryAcquire(key);
        Assert.NotNull(first);
        Assert.Null(SingleInstance.TryAcquire(key.ToLowerInvariant().Replace('\\', '/')));
    }
}
