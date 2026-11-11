using System.Text.RegularExpressions;

namespace ClaudeMonitor.Core;

public static class ClearPrompt
{
    static readonly Regex Fence = new(@"```.*?```", RegexOptions.Singleline | RegexOptions.Compiled);
    static readonly Regex ParagraphBreak = new(@"\n\s*\n", RegexOptions.Compiled);
    static readonly Regex Positive = new(
        @"\b(run|type|enter|use|execute|please|then|now|should|to)\s+`?/clear\b(?![\w-])",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex Negative = new(
        @"\b(don't|do not|never|not|no need to|without|didn't|already)\b[^.\n`]{0,25}/clear",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Scan every paragraph. Closing messages often end with an unrelated trailing paragraph (e.g. the waiver note).</summary>
    public const int WholeMessage = int.MaxValue;

    public static bool Asks(string text, int tailParagraphs = WholeMessage)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        var t = Fence.Replace(text.Replace("\r\n", "\n"), "");
        t = string.Join("\n", t.Split('\n').Where(l => !l.TrimStart().StartsWith('>')));
        var paragraphs = ParagraphBreak.Split(t).Where(p => !string.IsNullOrWhiteSpace(p)).ToArray();
        var tail = string.Join("\n", paragraphs.TakeLast(Math.Max(1, tailParagraphs)));
        return Positive.IsMatch(tail) && !Negative.IsMatch(tail);
    }
}
