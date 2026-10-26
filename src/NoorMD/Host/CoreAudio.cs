using System.Runtime.InteropServices;

namespace NoorMD.Host;

public sealed record CaptureDevice(string Id, string Name, bool IsDefault);

/// <summary>
/// Windows microphone mute through Core Audio (IAudioEndpointVolume). Muting the endpoint mutes the microphone for
/// every program at once (OBS, Discord, games), and Windows tells us when anything else changes it, so the state we
/// show is read back, never assumed.
/// </summary>
public sealed class CaptureEndpoint : IDisposable
{
    private readonly IAudioEndpointVolume _volume;
    private readonly VolumeCallback _callback;
    private static Guid _ourContext = Guid.NewGuid();

    public string Id { get; }
    public string Name { get; }
    /// <summary>Raised on a Core Audio thread whenever the mute state (or volume) changes, from any program.</summary>
    public event Action<bool>? MuteChanged;

    private CaptureEndpoint(string id, string name, IAudioEndpointVolume volume)
    {
        Id = id; Name = name; _volume = volume;
        _callback = new VolumeCallback(this);
        Marshal.ThrowExceptionForHR(_volume.RegisterControlChangeNotify(_callback));
    }

    public bool Muted
    {
        get { Marshal.ThrowExceptionForHR(_volume.GetMute(out var m)); return m; }
        set { Marshal.ThrowExceptionForHR(_volume.SetMute(value, ref _ourContext)); }
    }

    /// <summary>All active microphones, the default one first.</summary>
    public static IReadOnlyList<CaptureDevice> List()
    {
        var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        try
        {
            string? defaultId = null;
            if (en.GetDefaultAudioEndpoint(EDataFlow.Capture, ERole.Console, out var def) == 0) { def.GetId(out defaultId); Marshal.ReleaseComObject(def); }
            Marshal.ThrowExceptionForHR(en.EnumAudioEndpoints(EDataFlow.Capture, DeviceStateActive, out var col));
            col.GetCount(out var n);
            var list = new List<CaptureDevice>();
            for (uint i = 0; i < n; i++)
            {
                if (col.Item(i, out var dev) != 0) continue;
                dev.GetId(out var id);
                list.Add(new CaptureDevice(id, FriendlyName(dev) ?? id, id == defaultId));
                Marshal.ReleaseComObject(dev);
            }
            Marshal.ReleaseComObject(col);
            return list.OrderByDescending(d => d.IsDefault).ThenBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        }
        finally { Marshal.ReleaseComObject(en); }
    }

    /// <summary>Opens a microphone by id, or the default microphone when id is null. Null when there is none.</summary>
    public static CaptureEndpoint? Open(string? id)
    {
        var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        try
        {
            IMMDevice dev;
            var hr = string.IsNullOrEmpty(id) ? en.GetDefaultAudioEndpoint(EDataFlow.Capture, ERole.Console, out dev) : en.GetDevice(id, out dev);
            if (hr != 0) return null;
            try
            {
                dev.GetState(out var state);
                if (state != DeviceStateActive) return null;
                dev.GetId(out var realId);
                var iid = typeof(IAudioEndpointVolume).GUID;
                Marshal.ThrowExceptionForHR(dev.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out var o));
                return new CaptureEndpoint(realId, FriendlyName(dev) ?? realId, (IAudioEndpointVolume)o);
            }
            finally { Marshal.ReleaseComObject(dev); }
        }
        finally { Marshal.ReleaseComObject(en); }
    }

    /// <summary>The id of the current default microphone (it changes when a headset is plugged in).</summary>
    public static string? DefaultId()
    {
        var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        try
        {
            if (en.GetDefaultAudioEndpoint(EDataFlow.Capture, ERole.Console, out var def) != 0) return null;
            def.GetId(out var id);
            Marshal.ReleaseComObject(def);
            return id;
        }
        finally { Marshal.ReleaseComObject(en); }
    }

    private static string? FriendlyName(IMMDevice dev)
    {
        if (dev.OpenPropertyStore(0 /* STGM_READ */, out var store) != 0) return null;
        try
        {
            var key = new PropertyKey { Fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), Pid = 14 };
            if (store.GetValue(ref key, out var pv) != 0) return null;
            try { return pv.Vt == 31 /* VT_LPWSTR */ ? Marshal.PtrToStringUni(pv.Pointer) : null; }
            finally { PropVariantClear(ref pv); }
        }
        finally { Marshal.ReleaseComObject(store); }
    }

    public void Dispose()
    {
        try { _volume.UnregisterControlChangeNotify(_callback); } catch (COMException) { /* device gone */ }
        Marshal.ReleaseComObject(_volume);
    }

    private const int DeviceStateActive = 1;
    private const int ClsCtxAll = 23;

    [ComVisible(true)]
    internal sealed class VolumeCallback(CaptureEndpoint owner) : IAudioEndpointVolumeCallback
    {
        public int OnNotify(IntPtr data)
        {
            // AUDIO_VOLUME_NOTIFICATION_DATA: GUID guidEventContext; BOOL bMuted; ...
            var muted = Marshal.ReadInt32(data, 16) != 0;
            try { owner.MuteChanged?.Invoke(muted); } catch { /* never throw into Core Audio */ }
            return 0;
        }
    }

    private enum EDataFlow { Render, Capture, All }
    private enum ERole { Console, Multimedia, Communications }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid Fmtid; public int Pid; }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariant { public ushort Vt; public ushort R1, R2, R3; public IntPtr Pointer; public IntPtr Extra; }

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant pv);

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow flow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow flow, ERole role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [ComImport, Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioEndpointVolumeCallback
    {
        [PreserveSig] int OnNotify(IntPtr data);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IAudioEndpointVolumeCallback notify);
        [PreserveSig] int UnregisterControlChangeNotify(IAudioEndpointVolumeCallback notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }
}
