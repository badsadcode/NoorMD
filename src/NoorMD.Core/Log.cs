namespace NoorMD.Core;

/// <summary>Minimal local diagnostics log (no telemetry — it never leaves the machine).</summary>
public static class Log
{
    private static readonly object Gate = new();
    private static string? _file;

    public static void Initialize(string directory)
    {
        _file = Path.Combine(directory, "noormd.log");
        try
        {
            var info = new FileInfo(_file);
            if (info.Exists && info.Length > 1_000_000) File.Move(_file, _file + ".1", overwrite: true);
        }
        catch { }
    }

    public static void Info(string message) => Write("INFO", message);
    public static void Error(string message, Exception? ex = null) => Write("ERROR", ex == null ? message : $"{message}: {ex}");

    private static void Write(string level, string message)
    {
        if (_file == null) return;
        try
        {
            lock (Gate) File.AppendAllText(_file, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{level}] {message}{Environment.NewLine}");
        }
        catch { }
    }
}
