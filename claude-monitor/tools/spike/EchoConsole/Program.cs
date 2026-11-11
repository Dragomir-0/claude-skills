var log = args.Length > 0 ? args[0] : Path.Combine(Path.GetTempPath(), "echo.log");
File.WriteAllText(log, $"ready pid={Environment.ProcessId}\n");
Console.WriteLine($"echo ready pid={Environment.ProcessId} log={log}; press Q to quit");
while (true)
{
    var k = Console.ReadKey(true);
    File.AppendAllText(log, $"key={k.Key} char={(int)k.KeyChar} mods={k.Modifiers}\n");
    if (k.Key == ConsoleKey.Q) break;
}
