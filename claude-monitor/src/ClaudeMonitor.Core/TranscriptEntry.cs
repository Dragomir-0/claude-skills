namespace ClaudeMonitor.Core;

public enum EntryKind { UserText, UserToolResult, AssistantText, AssistantToolUse, AssistantThinking, TurnEnd }

public sealed record TranscriptEntry(
    EntryKind Kind,
    string Uuid,
    string Text,
    string? StopReason,
    IReadOnlyList<string> ToolUseIds,
    IReadOnlyList<string> ToolResultIds);
