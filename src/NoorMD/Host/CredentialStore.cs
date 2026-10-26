using System.Runtime.InteropServices;
using System.Text;

namespace NoorMD.Host;

/// <summary>
/// Secrets (the OBS WebSocket password) live in the Windows Credential Manager, protected by your Windows sign-in.
/// They are never written to NoorMD's settings, a Vault, a ZIP or a log. Visible in Control Panel › Credential Manager
/// › Windows Credentials as "NoorMD/…".
/// </summary>
public static class CredentialStore
{
    private const int CredTypeGeneric = 1;
    private const int CredPersistLocalMachine = 2;

    public static void Write(string target, string secret)
    {
        var blob = Encoding.Unicode.GetBytes(secret);
        var ptr = Marshal.AllocHGlobal(blob.Length);
        try
        {
            Marshal.Copy(blob, 0, ptr, blob.Length);
            var cred = new Credential
            {
                Type = CredTypeGeneric, TargetName = target, CredentialBlobSize = blob.Length, CredentialBlob = ptr,
                Persist = CredPersistLocalMachine, UserName = Environment.UserName,
            };
            if (!CredWrite(ref cred, 0)) throw new InvalidOperationException($"Windows could not store the secret (error {Marshal.GetLastWin32Error()}).");
        }
        finally
        {
            for (var i = 0; i < blob.Length; i++) Marshal.WriteByte(ptr, i, 0);
            Marshal.FreeHGlobal(ptr);
            Array.Clear(blob);
        }
    }

    public static string? Read(string target)
    {
        if (!CredRead(target, CredTypeGeneric, 0, out var p)) return null;
        try
        {
            var cred = Marshal.PtrToStructure<Credential>(p);
            return cred.CredentialBlobSize == 0 ? "" : Marshal.PtrToStringUni(cred.CredentialBlob, cred.CredentialBlobSize / 2);
        }
        finally { CredFree(p); }
    }

    public static bool Exists(string target)
    {
        if (!CredRead(target, CredTypeGeneric, 0, out var p)) return false;
        CredFree(p);
        return true;
    }

    public static void Delete(string target) => CredDelete(target, CredTypeGeneric, 0);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public int Flags;
        public int Type;
        public string TargetName;
        public string? Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, int flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, int type, int flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);
}
