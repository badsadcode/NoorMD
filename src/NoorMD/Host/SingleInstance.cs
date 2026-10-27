using System.IO;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using NoorMD.Core;

namespace NoorMD.Host;

/// <summary>
/// One NoorMD per Windows user: opening a file from Explorer while NoorMD runs sends the path to the running window
/// (a named pipe only this user can open) instead of starting a second copy that would restore the whole session
/// again and save its settings over the first one's. "New window" still starts a separate, session-less window.
/// </summary>
internal static class SingleInstance
{
    private static Mutex? _mutex;
    private static readonly string Id = (WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName).Replace('\\', '-');
    private static string PipeName => "NoorMD-open-" + Id;

    /// <summary>True when this is the first NoorMD of this user (it then owns the name until it exits).</summary>
    public static bool TryClaim()
    {
        _mutex = new Mutex(true, @"Local\NoorMD-main-" + Id, out var created);
        if (!created) { _mutex.Dispose(); _mutex = null; }
        return created;
    }

    /// <summary>Hands a file (or nothing: just "come to the front") to the running NoorMD. False if it didn't answer.</summary>
    public static bool Forward(string? file)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out, PipeOptions.CurrentUserOnly);
            client.Connect(2000);
            var bytes = Encoding.UTF8.GetBytes((file == null ? "" : Path.GetFullPath(file)) + "\n");
            client.Write(bytes);
            client.Flush();
            return true;
        }
        catch (Exception ex) when (ex is IOException or TimeoutException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            Log.Error("Could not reach the running NoorMD", ex);
            return false;
        }
    }

    /// <summary>Listens for files from later starts; <paramref name="open"/> runs on the UI thread with the path (or null).</summary>
    public static void Listen(System.Windows.Threading.Dispatcher ui, Action<string?> open)
    {
        var thread = new Thread(() =>
        {
            while (true)
            {
                try
                {
                    using var server = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.CurrentUserOnly);
                    server.WaitForConnection();
                    var buffer = new byte[8192];
                    var sb = new StringBuilder();
                    int n;
                    while (sb.Length < 8192 && (n = server.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        sb.Append(Encoding.UTF8.GetString(buffer, 0, n));
                        if (sb.ToString().Contains('\n')) break;
                    }
                    var line = sb.ToString().Split('\n')[0].Trim();
                    ui.BeginInvoke(() => open(line.Length == 0 ? null : line));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ObjectDisposedException)
                {
                    Log.Error("Open-file pipe failed", ex);
                    Thread.Sleep(1000);
                }
            }
        }) { IsBackground = true, Name = "NoorMD open-file pipe" };
        thread.Start();
    }
}
