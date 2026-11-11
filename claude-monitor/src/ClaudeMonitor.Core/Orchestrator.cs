namespace ClaudeMonitor.Core;

public interface IInjector
{
    Task<bool> SendAsync(int claudePid, string text, bool enter, CancellationToken ct);
}

public sealed record OrchestratorOptions(bool DryRun, TimeSpan ConfirmTimeout, TimeSpan PollInterval, TimeSpan PostClearDelay);

public sealed class Orchestrator
{
    readonly IInjector injector;
    readonly RateLimiter limiter;
    readonly ActedStore acted;
    readonly DecisionLog log;
    readonly Func<bool> isPaused;
    readonly Func<IReadOnlyList<SessionInfo>> loadSessions;
    readonly Func<string, long> fileLength;
    readonly OrchestratorOptions options;

    public Orchestrator(IInjector injector, RateLimiter limiter, ActedStore acted, DecisionLog log, Func<bool> isPaused,
        Func<IReadOnlyList<SessionInfo>> loadSessions, Func<string, long> fileLength, OrchestratorOptions options)
    {
        this.injector = injector; this.limiter = limiter; this.acted = acted; this.log = log;
        this.isPaused = isPaused; this.loadSessions = loadSessions; this.fileLength = fileLength; this.options = options;
    }

    readonly HashSet<string> loggedSkips = new();

    void LogSkipOnce(string sessionId, string action, string reason, string uuid)
    {
        if (loggedSkips.Add($"{uuid}|{reason}")) log.Write(sessionId, action, reason, uuid);
    }

    public async Task HandleAsync(SessionInfo s, Detection d, long lengthAtDetection, CancellationToken ct)
    {
        var uuid = d.MessageUuid!;
        if (acted.Has(uuid)) return;

        // One action per message, but only once we actually act (or deliberately decline, as when paused).
        // Rate-limit and transcript-changed skips are transient: the caller re-detects the same message on its
        // next poll, so leave it un-acted and it fires as soon as the obstacle clears.
        if (isPaused()) { acted.Add(uuid); log.Write(s.SessionId, "skip", "paused", uuid); return; }
        if (!options.DryRun && fileLength(s.TranscriptPath) != lengthAtDetection)
        { LogSkipOnce(s.SessionId, "abort", "transcript changed", uuid); return; }
        if (!limiter.TryAcquire(s.ClaudePid.ToString(), DateTimeOffset.UtcNow, out var why))
        { LogSkipOnce(s.SessionId, "skip", why, uuid); return; }

        acted.Add(uuid);
        var handoff = HandoffResolver.Resolve(d.MessageText ?? "", s.Cwd, s.StartedAt);
        if (options.DryRun)
        {
            log.Write(s.SessionId, "dry-run", $"would /clear then read: {handoff ?? "(none)"}", uuid);
            return;
        }

        if (!await injector.SendAsync(s.ClaudePid, "/clear", true, ct))
        { log.Write(s.SessionId, "error", "inject /clear failed", uuid); return; }
        log.Write(s.SessionId, "inject", "/clear sent", uuid);

        if (handoff is null) { log.Write(s.SessionId, "done", "clear only (no handoff found)", uuid); return; }

        var deadline = DateTimeOffset.UtcNow + options.ConfirmTimeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            var fresh = loadSessions().FirstOrDefault(x =>
                x.ClaudePid == s.ClaudePid && x.SessionId != s.SessionId && x.Source == "clear");
            if (fresh is not null)
            {
                if (options.PostClearDelay > TimeSpan.Zero) await Task.Delay(options.PostClearDelay, ct);
                var line = $"Read \"{handoff}\" and follow its instructions.";
                if (await injector.SendAsync(s.ClaudePid, line, true, ct))
                    log.Write(fresh.SessionId, "inject", $"read-handoff sent: {handoff}", uuid);
                else
                    log.Write(fresh.SessionId, "error", "inject read-handoff failed", uuid);
                return;
            }
            await Task.Delay(options.PollInterval, ct);
        }
        log.Write(s.SessionId, "error", "timeout waiting for new session after /clear; handoff not sent", uuid);
    }
}
