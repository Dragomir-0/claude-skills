using System.Diagnostics;
using ClaudeMonitor.Core;

namespace ClaudeMonitor;

public sealed class ProcessInjector(string injectPath) : IInjector
{
    public async Task<bool> SendAsync(int claudePid, string text, bool enter, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(injectPath)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardError = true, RedirectStandardOutput = true,
        };
        psi.ArgumentList.Add(claudePid.ToString());
        psi.ArgumentList.Add(text);
        if (enter) psi.ArgumentList.Add("--enter");

        using var p = Process.Start(psi) ?? throw new InvalidOperationException("could not start inject.exe");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        try
        {
            await p.WaitForExitAsync(timeout.Token);
            return p.ExitCode == 0;
        }
        catch (OperationCanceledException)
        {
            try { p.Kill(true); } catch { /* already gone */ }
            return false;
        }
    }
}
