using System.Diagnostics;
using ClaudeMonitor;
using ClaudeMonitor.Core;

var opt = Options.Parse(args);
Directory.CreateDirectory(opt.DataDir);
using var instance = SingleInstance.TryAcquire(opt.DataDir);
if (instance is null)
{
    Console.Error.WriteLine($"ClaudeMonitor is already running for data dir {opt.DataDir}. Exiting.");
    return 1;
}
var startedAt = DateTimeOffset.UtcNow;
var log = new DecisionLog(Path.Combine(opt.DataDir, "decisions.jsonl"));
var acted = new ActedStore(Path.Combine(opt.DataDir, "acted.txt"));
var registry = new SessionRegistry(Path.Combine(opt.DataDir, "sessions"));
var pausePath = Path.Combine(opt.DataDir, "PAUSE");

static bool IsAlive(int pid)
{
    try { using var p = Process.GetProcessById(pid); return !p.HasExited; }
    catch { return false; }
}

var orchestrator = new Orchestrator(
    new ProcessInjector(opt.InjectPath),
    new RateLimiter(TimeSpan.FromSeconds(60), 3, TimeSpan.FromMinutes(10)),
    acted, log,
    () => File.Exists(pausePath),
    () => registry.Load(IsAlive),
    path => File.Exists(path) ? new FileInfo(path).Length : 0,
    new OrchestratorOptions(!opt.Live, opt.ConfirmTimeout, TimeSpan.FromMilliseconds(500), TimeSpan.FromSeconds(1)));

var detectorOptions = new DetectorOptions(opt.Quiet);
var tails = new Dictionary<string, SessionTail>();
using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

Console.WriteLine($"ClaudeMonitor started. mode={(opt.Live ? "LIVE" : "DRY-RUN")} data={opt.DataDir} quiet={opt.Quiet.TotalSeconds}s");
log.Write("-", "start", $"mode={(opt.Live ? "live" : "dry-run")}");

while (!cts.IsCancellationRequested)
{
    try
    {
        var sessions = registry.Load(IsAlive);
        foreach (var gone in tails.Keys.Where(id => sessions.All(s => s.SessionId != id)).ToList()) tails.Remove(gone);

        foreach (var s in sessions)
        {
            if (!tails.TryGetValue(s.SessionId, out var tail))
                tails[s.SessionId] = tail = new SessionTail(s.TranscriptPath, baselineToEnd: s.StartedAt < startedAt);
            tail.Poll();
            var d = Detector.Evaluate(tail.Entries, tail.LastWrite, DateTimeOffset.UtcNow, detectorOptions);
            if (d.Kind == DetectKind.Fire && !acted.Has(d.MessageUuid!))
                await orchestrator.HandleAsync(s, d, tail.Length, cts.Token);
        }
    }
    catch (OperationCanceledException) { break; }
    catch (Exception e)
    {
        log.Write("-", "error", e.GetType().Name + ": " + e.Message);
    }
    try { await Task.Delay(500, cts.Token); } catch (OperationCanceledException) { break; }
}
log.Write("-", "stop", "shutdown");
return 0;
