using System.IO;
using System.Runtime.InteropServices;

namespace NoorMD.Host;

/// <summary>Deletes files and folders by moving them to the Windows Recycle Bin, so a mistake can be undone there.</summary>
internal static class RecycleBin
{
    /// <summary>
    /// Whether every path is on a drive with a Recycle Bin. Network shares and some USB drives have none: Windows would
    /// delete from them for good, so the caller asks first and then passes <c>permanently: true</c>.
    /// </summary>
    public static bool CanRecycle(IEnumerable<string> paths)
    {
        foreach (var root in paths.Select(p => Path.GetPathRoot(Path.GetFullPath(p))).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (string.IsNullOrEmpty(root) || root.StartsWith(@"\\")) return false;
            var info = new SHQUERYRBINFO { cbSize = Marshal.SizeOf<SHQUERYRBINFO>() };
            if (SHQueryRecycleBinW(root, ref info) != 0) return false;
        }
        return true;
    }

    public static void Send(IReadOnlyList<string> paths, bool permanently = false)
    {
        if (paths.Count == 0) return;
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        var op = new SHFILEOPSTRUCT
        {
            wFunc = FO_DELETE,
            pFrom = string.Join('\0', paths.Select(Path.GetFullPath)) + "\0\0",
            // FOF_WANTNUKEWARNING: if something can't go to the Recycle Bin after all (too big for it), Windows asks.
            fFlags = (ushort)((permanently ? 0 : FOF_ALLOWUNDO | FOF_WANTNUKEWARNING) | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT),
        };
        var result = SHFileOperationW(ref op);
        if (result != 0) throw new IOException($"Windows could not move the item to the Recycle Bin (code {result}). It may be open in another program.");
        if (op.fAnyOperationsAborted) throw new IOException("Moving to the Recycle Bin was cancelled.");
    }

    private const uint FO_DELETE = 3;
    private const ushort FOF_SILENT = 0x0004, FOF_NOCONFIRMATION = 0x0010, FOF_ALLOWUNDO = 0x0040, FOF_NOERRORUI = 0x0400, FOF_WANTNUKEWARNING = 0x4000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEOPSTRUCT
    {
        public IntPtr hwnd;
        public uint wFunc;
        [MarshalAs(UnmanagedType.LPWStr)] public string pFrom;
        [MarshalAs(UnmanagedType.LPWStr)] public string? pTo;
        public ushort fFlags;
        [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted;
        public IntPtr hNameMappings;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpszProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHFileOperationW(ref SHFILEOPSTRUCT op);

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct SHQUERYRBINFO { public int cbSize; public long i64Size; public long i64NumItems; }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHQueryRecycleBinW(string pszRootPath, ref SHQUERYRBINFO info);
}
