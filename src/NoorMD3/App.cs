using System.IO;
using System.IO.Pipes;
using System.Text.Json;
using System.Windows;

namespace NoorMD3;

public static class Program
{
    // Per user: another person signed in on the same PC runs their own NoorMD. (A stable hash: string.GetHashCode differs per run.)
    static readonly string Name = "NoorMD3-" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Environment.UserDomainName + "\\" + Environment.UserName)))[..16];

    [STAThread]
    public static void Main(string[] args)
    {
        var files = args.Where(a => !a.StartsWith('-')).Select(a => Path.GetFullPath(a)).ToList();
        using var single = new Mutex(true, Name, out var first);
        // NoorMD is running already: it gets the files (a file dropped on the icon, "Open with"), and this copy ends.
        if (!first && HandOver(files)) return;
        ShellApp.SetPendingFiles(files);   // "Open with NoorMD", or files on the command line
        if (first) ListenForHandOvers();
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        app.Run(new ShellWindow());
    }

    /// <summary>Gives the running NoorMD these files (or just brings it to the front). False when it doesn't answer.</summary>
    static bool HandOver(List<string> files)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", Name, PipeDirection.Out, PipeOptions.CurrentUserOnly);
            pipe.Connect(3000);
            using var w = new StreamWriter(pipe);
            w.Write(JsonSerializer.Serialize(files));
            w.Flush();
            return true;
        }
        catch (Exception ex) when (ex is IOException or TimeoutException or UnauthorizedAccessException) { return false; }
    }

    /// <summary>The first NoorMD listens (only to its own user) for later starts handing over files.</summary>
    static void ListenForHandOvers() => Task.Run(async () =>
    {
        while (true)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(Name, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync();
                using var r = new StreamReader(pipe);
                var text = await r.ReadToEndAsync();
                if (text.Length > 1_000_000) continue;
                var paths = JsonSerializer.Deserialize<List<string>>(text) ?? [];
                await Application.Current.Dispatcher.InvokeAsync(async () =>
                {
                    var main = ShellApp.Main;
                    if (main == null) return;
                    if (main.WindowState == WindowState.Minimized) main.WindowState = WindowState.Normal;
                    main.Activate();
                    await ShellApp.OpenFilesAsync(paths, main);
                }).Task.Unwrap();
            }
            catch (Exception ex) when (ex is IOException or JsonException or InvalidOperationException or TaskCanceledException) { await Task.Delay(500); }
        }
    });
}
