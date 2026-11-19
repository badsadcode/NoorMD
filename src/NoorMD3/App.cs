using System.Windows;

namespace NoorMD3;

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        ShellApp.SetPendingFiles(args.Where(a => !a.StartsWith('-')));   // "Open with NoorMD", or files on the command line
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        app.Run(new ShellWindow());
    }
}
