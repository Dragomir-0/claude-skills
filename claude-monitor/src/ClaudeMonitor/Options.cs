namespace ClaudeMonitor;

public sealed record Options(string DataDir, bool Live, TimeSpan Quiet, TimeSpan ConfirmTimeout, string InjectPath)
{
    public static Options Parse(string[] args)
    {
        string Arg(string name, string fallback)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : fallback;
        }
        var data = Arg("--data", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClaudeMonitor"));
        return new Options(
            data,
            args.Contains("--live"),
            TimeSpan.FromSeconds(double.Parse(Arg("--quiet", "5"))),
            TimeSpan.FromSeconds(double.Parse(Arg("--confirm-timeout", "20"))),
            Arg("--inject", Path.Combine(AppContext.BaseDirectory, "inject.exe")));
    }
}
