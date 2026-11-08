using System.Text.RegularExpressions;

namespace ClaudeMonitor.Core;

public static class HandoffResolver
{
    static readonly Regex Backticked = new(@"`([^`\r\n]+?\.md)`", RegexOptions.Compiled);
    static readonly Regex Abs = new(@"[A-Za-z]:[\\/][^\s`'""<>|*?]+?\.md", RegexOptions.Compiled);
    static readonly Regex Rel = new(@"\.claude[\\/]handoff[\\/][^\s`'""<>|*?]+?\.md", RegexOptions.Compiled);

    // The injected read line is a user-role instruction, so only files in a `.claude/handoff` folder may be named.
    static bool InHandoffFolder(string fullPath)
    {
        var parts = (Path.GetDirectoryName(fullPath) ?? "").Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        for (var i = 0; i + 1 < parts.Length; i++)
            if (parts[i].Equals(".claude", StringComparison.OrdinalIgnoreCase)
                && parts[i + 1].Equals("handoff", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    public static string? Resolve(string message, string cwd, DateTimeOffset sessionStart)
    {
        var candidates = Backticked.Matches(message).Select(m => m.Groups[1].Value)
            .Concat(Abs.Matches(message).Select(m => m.Value))
            .Concat(Rel.Matches(message).Select(m => m.Value));
        foreach (var c in candidates)
        {
            var p = Path.GetFullPath(Path.IsPathRooted(c) ? c : Path.Combine(cwd, c));
            if (InHandoffFolder(p) && File.Exists(p)) return p;
        }

        var dir = Path.Combine(cwd, ".claude", "handoff");
        if (!Directory.Exists(dir)) return null;
        return Directory.EnumerateFiles(dir, "*.md")
            .Where(f => !Path.GetFileName(f).Equals("LEDGER.md", StringComparison.OrdinalIgnoreCase))
            .Where(f => File.GetLastWriteTimeUtc(f) > sessionStart.UtcDateTime)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();
    }
}
