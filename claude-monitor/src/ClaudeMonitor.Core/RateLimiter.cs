namespace ClaudeMonitor.Core;

public sealed class RateLimiter
{
    readonly TimeSpan cooldown, window;
    readonly int max;
    readonly Dictionary<string, DateTimeOffset> last = new();
    readonly Queue<DateTimeOffset> recent = new();

    public RateLimiter(TimeSpan cooldown, int maxPerWindow, TimeSpan window)
    {
        this.cooldown = cooldown; max = maxPerWindow; this.window = window;
    }

    public bool TryAcquire(string key, DateTimeOffset now, out string reason)
    {
        reason = "";
        if (last.TryGetValue(key, out var t) && now - t < cooldown) { reason = "cooldown"; return false; }
        while (recent.Count > 0 && now - recent.Peek() >= window) recent.Dequeue();
        if (recent.Count >= max) { reason = "rate limit"; return false; }
        last[key] = now;
        recent.Enqueue(now);
        return true;
    }
}
