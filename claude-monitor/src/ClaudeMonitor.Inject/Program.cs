using System.Runtime.InteropServices;

if (args.Length < 2 || !uint.TryParse(args[0], out var pid))
{
    Console.Error.WriteLine("usage: inject <pid> <text> [--enter]");
    return 2;
}
var text = args[1];
var enter = args.Contains("--enter");
var charDelayMs = 0;
var enterDelayMs = 200;

NativeMethods.FreeConsole();
if (!NativeMethods.AttachConsole(pid))
{
    Console.Error.WriteLine($"AttachConsole({pid}) failed: {Marshal.GetLastWin32Error()}");
    return 3;
}
var h = NativeMethods.CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
if (h == new IntPtr(-1))
{
    Console.Error.WriteLine($"open CONIN$ failed: {Marshal.GetLastWin32Error()}");
    return 4;
}

var records = new List<NativeMethods.INPUT_RECORD>();
foreach (var c in text)
{
    records.Add(NativeMethods.Key(true, 0, 0, c));
    records.Add(NativeMethods.Key(false, 0, 0, c));
    if (charDelayMs > 0) { Flush(); Thread.Sleep(charDelayMs); }
}
Flush();
if (enter)
{
    Thread.Sleep(enterDelayMs);
    records.Add(NativeMethods.Key(true, 0x0D, 0x1C, '\r'));
    records.Add(NativeMethods.Key(false, 0x0D, 0x1C, '\r'));
    Flush();
}
return 0;

void Flush()
{
    if (records.Count == 0) return;
    var arr = records.ToArray();
    if (!NativeMethods.WriteConsoleInputW(h, arr, (uint)arr.Length, out var written) || written != arr.Length)
    {
        Console.Error.WriteLine($"WriteConsoleInput wrote {written}/{arr.Length}: {Marshal.GetLastWin32Error()}");
        Environment.Exit(5);
    }
    records.Clear();
}

static class NativeMethods
{
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteConsoleInputW(IntPtr h, INPUT_RECORD[] buf, uint len, out uint written);

    [StructLayout(LayoutKind.Explicit, Size = 20)]
    public struct INPUT_RECORD
    {
        [FieldOffset(0)] public ushort EventType; // 1 = KEY_EVENT
        [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
    }

    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode, Size = 16)]
    public struct KEY_EVENT_RECORD
    {
        [FieldOffset(0)] public int bKeyDown;
        [FieldOffset(4)] public ushort wRepeatCount;
        [FieldOffset(6)] public ushort wVirtualKeyCode;
        [FieldOffset(8)] public ushort wVirtualScanCode;
        [FieldOffset(10)] public char UnicodeChar;
        [FieldOffset(12)] public uint dwControlKeyState;
    }

    public static INPUT_RECORD Key(bool down, ushort vk, ushort scan, char c) => new()
    {
        EventType = 1,
        KeyEvent = new KEY_EVENT_RECORD
        {
            bKeyDown = down ? 1 : 0, wRepeatCount = 1, wVirtualKeyCode = vk,
            wVirtualScanCode = scan, UnicodeChar = c, dwControlKeyState = 0
        }
    };
}
