using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;

namespace NoorMD;

/// <summary>
/// NoorCalendar's reminder pop-up, shown near the clock when NoorMD is minimized or behind other windows: what is
/// coming and when, with Open, Snooze and Dismiss. It never takes focus from what you are doing. Plain WPF, so it
/// shows even while the page is busy.
/// </summary>
public sealed class ReminderWindow : Window
{
    public sealed record Item(string Key, string Title, string When, string Detail);

    private readonly MainWindow _main;
    private readonly StackPanel _list = new();
    private readonly List<Item> _items = [];

    public ReminderWindow(MainWindow main)
    {
        _main = main;
        Title = "Reminders — NoorMD";
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ResizeMode = ResizeMode.NoResize;
        SizeToContent = SizeToContent.Height;
        Width = 360;
        Topmost = true;
        ShowInTaskbar = false;
        ShowActivated = false;
        FontFamily = new FontFamily("Segoe UI");
        var head = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
        var close = Button("✕", (_, _) => DismissAll());
        close.ToolTip = "Dismiss all";
        DockPanel.SetDock(close, Dock.Right);
        head.Children.Add(close);
        head.Children.Add(new TextBlock { Text = "🔔 NoorMD reminder", FontWeight = FontWeights.Bold, FontSize = 13, Foreground = Brushes.White, VerticalAlignment = VerticalAlignment.Center });
        Content = new Border
        {
            Margin = new Thickness(8), Padding = new Thickness(14, 10, 14, 12), CornerRadius = new CornerRadius(12),
            Background = new SolidColorBrush(Color.FromArgb(0xF2, 0x1E, 0x1F, 0x27)), BorderBrush = new SolidColorBrush(Color.FromRgb(0x7C, 0x5C, 0xFF)), BorderThickness = new Thickness(1.5),
            Effect = new System.Windows.Media.Effects.DropShadowEffect { BlurRadius = 14, ShadowDepth = 2, Opacity = 0.5 },
            Child = new StackPanel { Children = { head, _list } },
        };
        Loaded += (_, _) => Place();
        SizeChanged += (_, _) => Place();
    }

    private static Button Button(string text, RoutedEventHandler click) => new Button()
    {
        Content = text, Margin = new Thickness(6, 0, 0, 0), Padding = new Thickness(9, 3, 9, 3), FontSize = 12, Cursor = System.Windows.Input.Cursors.Hand,
        Foreground = Brushes.White, Background = new SolidColorBrush(Color.FromRgb(0x34, 0x36, 0x44)), BorderBrush = new SolidColorBrush(Color.FromRgb(0x55, 0x58, 0x6A)),
    }.With(b => b.Click += click);

    /// <summary>Adds reminders (a key shown once) and shows the window without taking focus.</summary>
    public void Add(IEnumerable<Item> items)
    {
        foreach (var it in items) if (_items.All(x => x.Key != it.Key)) _items.Add(it);
        while (_items.Count > 6) _items.RemoveAt(0);
        Render();
        if (!IsVisible) Show();
        Place();
    }

    /// <summary>Takes away reminders handled elsewhere (in the app).</summary>
    public void Remove(string key)
    {
        _items.RemoveAll(x => x.Key == key);
        Render();
        if (_items.Count == 0) Hide();
    }

    private void Render()
    {
        _list.Children.Clear();
        foreach (var it in _items)
        {
            var key = it.Key;
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 6, 0, 0) };
            buttons.Children.Add(Button("Open", (_, _) => { _main.CalendarOpenFromReminder(key); Remove(key); }));
            buttons.Children.Add(Button("15 min", (_, _) => { _main.CalendarSnooze(key, TimeSpan.FromMinutes(15)); Remove(key); }).With(b => b.ToolTip = "Remind me again in 15 minutes"));
            buttons.Children.Add(Button("1 hour", (_, _) => { _main.CalendarSnooze(key, TimeSpan.FromHours(1)); Remove(key); }).With(b => b.ToolTip = "Remind me again in an hour"));
            buttons.Children.Add(Button("Dismiss", (_, _) => { _main.CalendarDismiss(key); Remove(key); }));
            _list.Children.Add(new Border
            {
                Margin = new Thickness(0, 4, 0, 4), Padding = new Thickness(10, 8, 10, 8), CornerRadius = new CornerRadius(8), Background = new SolidColorBrush(Color.FromRgb(0x2A, 0x2B, 0x36)),
                Child = new StackPanel
                {
                    Children =
                    {
                        new TextBlock { Text = it.Title, FontSize = 14, FontWeight = FontWeights.SemiBold, Foreground = Brushes.White, TextWrapping = TextWrapping.Wrap },
                        new TextBlock { Text = it.When, FontSize = 12, Foreground = new SolidColorBrush(Color.FromRgb(0xB8, 0xA8, 0xFF)), Margin = new Thickness(0, 2, 0, 0) },
                        new TextBlock { Text = it.Detail, FontSize = 11.5, Foreground = new SolidColorBrush(Color.FromRgb(0xB0, 0xB4, 0xC0)), TextWrapping = TextWrapping.Wrap, Visibility = string.IsNullOrEmpty(it.Detail) ? Visibility.Collapsed : Visibility.Visible },
                        buttons,
                    },
                },
            });
        }
    }

    private void DismissAll()
    {
        foreach (var it in _items.ToList()) _main.CalendarDismiss(it.Key);
        _items.Clear();
        Hide();
    }

    /// <summary>Bottom right of the screen NoorMD is on, above the taskbar.</summary>
    private void Place()
    {
        var area = SystemParameters.WorkArea;
        Left = area.Right - ActualWidth - 8;
        Top = area.Bottom - ActualHeight - 8;
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        // A tool window that doesn't steal focus (WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW).
        var hwnd = new WindowInteropHelper(this).Handle;
        var ex = GetWindowLong(hwnd, -20);
        SetWindowLong(hwnd, -20, ex | 0x08000000 | 0x00000080);
    }

    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
}

internal static class FluentExtensions
{
    public static T With<T>(this T item, Action<T> set) { set(item); return item; }
}
