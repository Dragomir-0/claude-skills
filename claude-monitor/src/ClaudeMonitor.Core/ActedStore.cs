namespace ClaudeMonitor.Core;

public sealed class ActedStore
{
    readonly string path;
    readonly HashSet<string> seen;

    public ActedStore(string path)
    {
        this.path = path;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        seen = File.Exists(path) ? File.ReadAllLines(path).Where(l => l.Length > 0).ToHashSet() : new HashSet<string>();
    }

    public bool Has(string uuid) => seen.Contains(uuid);

    public void Add(string uuid)
    {
        if (seen.Add(uuid)) File.AppendAllText(path, uuid + "\n");
    }
}
