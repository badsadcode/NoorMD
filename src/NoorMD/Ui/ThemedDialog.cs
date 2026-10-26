using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace NoorMD.Ui;

internal sealed record DialogButton(string Label, string Value, bool Primary = false, bool Cancel = false);

/// <summary>Native, theme-matched message dialog (replaces MessageBox and browser confirm()).</summary>
internal sealed class ThemedDialog : Window
{
    private string _result;

    private ThemedDialog(string title, string heading, string message, IReadOnlyList<DialogButton> buttons, string? detail)
    {
        _result = buttons.FirstOrDefault(b => b.Cancel)?.Value ?? buttons[^1].Value;
        Title = title;
        WindowStyle = WindowStyle.SingleBorderWindow;
        ResizeMode = ResizeMode.NoResize;
        SizeToContent = SizeToContent.WidthAndHeight;
        ShowInTaskbar = false;
        MinWidth = 380;
        MaxWidth = 560;
        UseLayoutRounding = true;
        SetResourceReference(BackgroundProperty, "PanelBrush");
        FontFamily = (FontFamily)Application.Current.Resources["UiFont"];

        var stack = new StackPanel { Margin = new Thickness(26, 22, 26, 20) };
        var h = new TextBlock { Text = heading, FontSize = 17, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 10) };
        h.SetResourceReference(TextBlock.ForegroundProperty, "TextBrush");
        stack.Children.Add(h);
        var m = new TextBlock { Text = message, FontSize = 13.5, TextWrapping = TextWrapping.Wrap, LineHeight = 20 };
        m.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
        stack.Children.Add(m);
        if (!string.IsNullOrEmpty(detail))
        {
            var d = new TextBox
            {
                Text = detail, IsReadOnly = true, TextWrapping = TextWrapping.Wrap, BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 6, 8, 6), Margin = new Thickness(0, 12, 0, 0), FontFamily = new FontFamily("Cascadia Mono, Consolas"), FontSize = 12,
            };
            d.SetResourceReference(BackgroundProperty, "SurfaceBrush");
            d.SetResourceReference(ForegroundProperty, "TextBrush");
            d.SetResourceReference(BorderBrushProperty, "LineBrush");
            stack.Children.Add(d);
        }

        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 22, 0, 0) };
        foreach (var b in buttons)
        {
            var btn = new Button
            {
                Content = b.Label, IsDefault = b.Primary, IsCancel = b.Cancel,
                Style = (Style)Application.Current.Resources[b.Primary ? "DialogPrimaryButton" : "DialogButton"],
            };
            btn.Click += (_, _) => { _result = b.Value; DialogResult = true; };
            row.Children.Add(btn);
            if (b.Primary) Loaded += (_, _) => btn.Focus();
        }
        stack.Children.Add(row);
        Content = stack;
        SourceInitialized += (_, _) => ThemeManager.ApplyChrome(this);
    }

    public static string Show(Window? owner, string heading, string message, IReadOnlyList<DialogButton> buttons, string? detail = null)
    {
        var dlg = new ThemedDialog("NoorMD", heading, message, buttons, detail);
        if (owner is { IsLoaded: true })
        {
            dlg.Owner = owner;
            dlg.WindowStartupLocation = WindowStartupLocation.CenterOwner;
        }
        else dlg.WindowStartupLocation = WindowStartupLocation.CenterScreen;
        dlg.ShowDialog();
        return dlg._result;
    }

    public static bool Confirm(Window? owner, string heading, string message, string okLabel, string? detail = null) =>
        Show(owner, heading, message, [new DialogButton("Cancel", "cancel", Cancel: true), new DialogButton(okLabel, "ok", Primary: true)], detail) == "ok";

    public static void ShowError(Window? owner, string heading, string message, string? detail = null) =>
        Show(owner, heading, message, [new DialogButton("OK", "ok", Primary: true, Cancel: true)], detail);
}
