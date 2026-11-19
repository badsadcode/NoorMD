using System.Windows;

namespace NoorMD3;

public static class Program
{
    [STAThread]
    public static void Main()
    {
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        app.Run(new ShellWindow());
    }
}
