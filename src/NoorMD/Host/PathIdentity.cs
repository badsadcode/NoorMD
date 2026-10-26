using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace NoorMD.Host;

/// <summary>
/// "Is this the same file?" for the open-tab check. Windows can name one file many ways: different casing,
/// 8.3 short names (DOCUME~1), "..\" segments, forward slashes, symbolic links or junctions. The final path the
/// file system reports for an open handle is the same for all of them.
/// </summary>
internal static class PathIdentity
{
    public static string Key(string path)
    {
        var full = Path.GetFullPath(path);
        return (TryFinalPath(full) ?? full).ToUpperInvariant();
    }

    public static bool Same(string? a, string? b) => a != null && b != null && string.Equals(a, b, StringComparison.Ordinal);

    private static string? TryFinalPath(string path)
    {
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            // No read access is needed (and none is taken, so a file locked by another program still works).
            using var handle = CreateFileW(path, 0, FileShare.ReadWrite | FileShare.Delete, IntPtr.Zero, FileMode.Open, BackupSemantics, IntPtr.Zero);
            if (handle.IsInvalid) return null;
            var buffer = new StringBuilder(1024);
            var len = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
            if (len == 0 || len >= buffer.Capacity) return null;
            var final = buffer.ToString();
            if (final.StartsWith(@"\\?\UNC\", StringComparison.Ordinal)) return @"\\" + final[8..];
            if (final.StartsWith(@"\\?\", StringComparison.Ordinal)) return final[4..];
            return final;
        }
        catch (Exception) { return null; }
    }

    private const uint BackupSemantics = 0x02000000; // FILE_FLAG_BACKUP_SEMANTICS (also opens folders)

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, FileShare share, IntPtr security, FileMode mode, uint flags, IntPtr template);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder path, uint length, uint flags);
}
