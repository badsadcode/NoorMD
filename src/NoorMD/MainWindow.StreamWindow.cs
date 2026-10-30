using System.Text.Json.Nodes;
using System.Windows;
using NoorMD.Core.Bridge;
using NoorMD.Media;

namespace NoorMD;

/// <summary>NoorStream's own window: opening it, the requests it may make, and what the app tells it.</summary>
public partial class MainWindow
{
    private StreamWindow? _streamWindow;

    private Rect? StreamWindowPlacement =>
        StreamCfg["window"] is JsonObject w && w["x"] is JsonValue x && w["y"] is JsonValue y && w["w"] is JsonValue ww && w["h"] is JsonValue hh
            ? new Rect(x.GetValue<double>(), y.GetValue<double>(), ww.GetValue<double>(), hh.GetValue<double>()) : null;

    /// <summary>Opens NoorStream window on a tab (or brings it forward), or closes it.</summary>
    internal object OpenStreamWindow(string? tab, bool toggle, bool close)
    {
        _ = toggle; // Ctrl+Alt+B always brings the window forward: from the editor it is usually behind, not unwanted
        if (close)
        {
            _streamWindow?.Close();
            return new { open = false };
        }
        if (_streamWindow == null)
        {
            _streamWindow = new StreamWindow(this, StreamWindowPlacement);
            _streamWindow.Show();
        }
        _streamWindow.ShowTab(tab);
        return new { open = true };
    }

    internal void StreamWindowClosed(Rect placement)
    {
        _streamWindow = null;
        if (placement.Width > 0 && double.IsFinite(placement.Left))
        {
            StreamCfg["window"] = new JsonObject { ["x"] = Math.Round(placement.Left), ["y"] = Math.Round(placement.Top), ["w"] = Math.Round(placement.Width), ["h"] = Math.Round(placement.Height) };
            SaveStreamCfg();
        }
        if (_webReady) PushEvent("stream.window", new { open = false });
    }

    /// <summary>A request from NoorStream window (already limited to stream., mic. and a few others).</summary>
    internal async Task<object?> RequestFromStreamWindowAsync(BridgeRequest req)
    {
        var result = await DispatchAsync(req);
        if (req.Type == "vault.openFile") { if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal; Activate(); }
        return result;
    }

    /// <summary>Embedded artwork (or cover.jpg) for NoorStream's Now Playing preview.</summary>
    internal (byte[] Data, string Mime)? ArtFor(long id)
    {
        if (_music?.Get(id) is not { } t) return null;
        return (TagIO.ReadArtwork(t.Path) ?? FolderArt.Read(t.Folder)) is { } a ? (a.Data, a.MimeType) : null;
    }

    private void SendTrackToStreamWindow()
    {
        if (_streamWindow == null) return;
        var t = _nowPlaying?.DeepClone() as JsonObject;
        if (t != null && t["hasArt"] is JsonValue h && h.TryGetValue<bool>(out var has) && has && t["id"] is JsonValue iv) t["art"] = $"/_art/{iv.GetValue<long>()}";
        _streamWindow.PostEvent("stream.track", new { track = t });
    }
}
