using System.Security.Cryptography;
using System.Text;

namespace ClaudeMonitor.Core;

/// <summary>Per-key process guard: a named semaphore that exists only while its first holder is alive.</summary>
public sealed class SingleInstance : IDisposable
{
    readonly Semaphore handle;
    SingleInstance(Semaphore handle) => this.handle = handle;

    public static SingleInstance? TryAcquire(string key)
    {
        var normalized = Path.GetFullPath(key).Replace('/', '\\').TrimEnd('\\').ToLowerInvariant();
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)))[..16];
        var sem = new Semaphore(1, 1, @"Local\ClaudeMonitor-" + hash, out var createdNew);
        if (createdNew) return new SingleInstance(sem);
        sem.Dispose();
        return null;
    }

    public void Dispose() => handle.Dispose();
}
