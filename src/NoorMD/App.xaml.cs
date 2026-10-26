using System.Windows;
using System.Windows.Threading;
using NoorMD.Core;
using NoorMD.Ui;

namespace NoorMD;

public partial class App : Application
{
    internal static AppPaths Paths { get; private set; } = null!;
    internal static bool SessionIsEnding { get; private set; }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        string? file;
        var selfTest = Array.IndexOf(e.Args, "--self-test");
        if (selfTest >= 0 && selfTest + 1 < e.Args.Length)
        {
            // Isolated diagnostic run (see MainWindow.SelfTest.cs): never touches the user's data.
            var dir = System.IO.Path.GetFullPath(e.Args[selfTest + 1]);
            System.IO.Directory.CreateDirectory(dir);
            NoorMD.MainWindow.SelfTestDir = dir;
            Paths = new AppPaths(System.IO.Path.Combine(dir, "roaming"), System.IO.Path.Combine(dir, "local"));
            file = NoorMD.MainWindow.PrepareSelfTestDocument(dir);
        }
        else
        {
            Paths = AppPaths.ForCurrentUser();
            file = e.Args.FirstOrDefault(a => !a.StartsWith('-') && !a.StartsWith('/'));
        }
        Log.Initialize(Paths.Logs);
        Log.Info($"NoorMD {typeof(App).Assembly.GetName().Version} starting");

        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += (_, args) => Log.Error("Unhandled exception", args.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, args) => { Log.Error("Unobserved task exception", args.Exception); args.SetObserved(); };

        var window = new NoorMD.MainWindow(file);
        MainWindow = window;
        window.Show();
    }

    protected override void OnSessionEnding(SessionEndingCancelEventArgs e)
    {
        // Windows is logging off or shutting down: never block it with prompts. Unsaved text stays in the
        // recovery draft (written continuously while editing) and is offered on the next start.
        SessionIsEnding = true;
        base.OnSessionEnding(e);
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        Log.Error("Unhandled UI exception", e.Exception);
        e.Handled = true;
        ThemedDialog.ShowError(Current?.MainWindow, "Something went wrong",
            "NoorMD hit an unexpected error but is still running. Your text is kept in the editor and in the recovery draft.\n\n" + e.Exception.Message);
    }
}
