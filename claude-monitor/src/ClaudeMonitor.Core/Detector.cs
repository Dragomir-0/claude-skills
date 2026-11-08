namespace ClaudeMonitor.Core;

public sealed record DetectorOptions(TimeSpan Quiet, int TailParagraphs = ClearPrompt.WholeMessage);

public enum DetectKind { Skip, Fire }

public sealed record Detection(DetectKind Kind, string Reason, string? MessageUuid = null, string? MessageText = null);

public static class Detector
{
    public static Detection Evaluate(
        IReadOnlyList<TranscriptEntry> entries, DateTimeOffset lastWrite, DateTimeOffset now, DetectorOptions options)
    {
        TranscriptEntry? last = null;
        var lastIndex = -1;
        for (var i = entries.Count - 1; i >= 0; i--)
        {
            if (entries[i].Kind is EntryKind.AssistantThinking or EntryKind.TurnEnd) continue;
            last = entries[i]; lastIndex = i; break;
        }
        if (last is null) return Skip("no entries");
        if (last.Kind != EntryKind.AssistantText || last.StopReason != "end_turn") return Skip("not at end of turn");
        if (!ClearPrompt.Asks(last.Text, options.TailParagraphs)) return Skip("no /clear request");

        var turnStart = 0;
        for (var i = lastIndex; i >= 0; i--)
            if (entries[i].Kind == EntryKind.UserText) { turnStart = i; break; }
        var open = new HashSet<string>();
        for (var i = turnStart; i <= lastIndex; i++)
        {
            foreach (var id in entries[i].ToolUseIds) open.Add(id);
            foreach (var id in entries[i].ToolResultIds) open.Remove(id);
        }
        if (open.Count > 0) return Skip("tool call pending");

        if (now - lastWrite < options.Quiet) return Skip("transcript not quiet yet");
        return new Detection(DetectKind.Fire, "idle end-of-turn /clear request", last.Uuid, last.Text);
    }

    static Detection Skip(string reason) => new(DetectKind.Skip, reason);
}
