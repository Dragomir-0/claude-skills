using System.Text;

namespace ClaudeMonitor.Core;

public sealed class SessionTail
{
    readonly string path;
    long offset;

    public List<TranscriptEntry> Entries { get; } = new();
    public long Length { get; private set; }
    public DateTimeOffset LastWrite { get; private set; }

    public SessionTail(string path, bool baselineToEnd)
    {
        this.path = path;
        if (baselineToEnd && File.Exists(path)) offset = new FileInfo(path).Length;
        Poll();
    }

    /// <summary>Reads any newly completed lines. Returns true if bytes were consumed.</summary>
    public bool Poll()
    {
        if (!File.Exists(path)) return false;
        var info = new FileInfo(path);
        Length = info.Length;
        LastWrite = new DateTimeOffset(info.LastWriteTimeUtc, TimeSpan.Zero);
        if (info.Length <= offset) return false;

        var buf = new byte[info.Length - offset];
        var total = 0;
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            fs.Seek(offset, SeekOrigin.Begin);
            while (total < buf.Length)
            {
                var n = fs.Read(buf, total, buf.Length - total);
                if (n == 0) break;
                total += n;
            }
        }
        if (total == 0) return false;
        var end = Array.LastIndexOf(buf, (byte)'\n', total - 1);
        if (end < 0) return false;

        foreach (var line in Encoding.UTF8.GetString(buf, 0, end + 1).Split('\n'))
        {
            var e = TranscriptParser.Parse(line);
            if (e is not null) Entries.Add(e);
        }
        offset += end + 1;
        return true;
    }
}
