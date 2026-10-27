using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace NoorMD.Host;

/// <summary>
/// The picture Windows shows for a program, shortcut, game link (.url), folder or file, at a large size, as PNG with
/// transparency. Uses the shell's image factory (the same source as Explorer), read straight from the bitmap's pixels
/// because the usual conversion drops the alpha channel and gives icons black corners.
/// </summary>
public static class ShellIcons
{
    public static byte[]? Png(string path, int size = 96, bool iconOnly = true) => Render(path, size, 0x1 /* BIGGERSIZEOK */ | (iconOnly ? 0x4 /* ICONONLY */ : 0));

    /// <summary>
    /// The picture Windows shows for a file in Explorer (its thumbnail handler: Affinity, Photoshop, HEIC…), as PNG, or null
    /// when no program provides one. Runs on its own STA thread: some thumbnail handlers need that.
    /// </summary>
    public static byte[]? Thumbnail(string path, int size)
    {
        byte[]? result = null;
        var t = new Thread(() => { try { result = Render(path, size, 0x1 /* BIGGERSIZEOK */ | 0x8 /* THUMBNAILONLY */); } catch (Exception) { result = null; } }) { IsBackground = true };
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        return t.Join(TimeSpan.FromSeconds(20)) ? result : null;
    }

    private static byte[]? Render(string path, int size, int flags)
    {
        if (SHCreateItemFromParsingName(path, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out var item) != 0 || item == null) return null;
        IntPtr hbmp = IntPtr.Zero;
        try
        {
            if (item.GetImage(new NativeSize { Cx = size, Cy = size }, flags, out hbmp) != 0 || hbmp == IntPtr.Zero) return null;
            if (GetObject(hbmp, Marshal.SizeOf<Bitmap>(), out Bitmap bm) == 0 || bm.Width <= 0 || bm.Height == 0) return null;
            var height = Math.Abs(bm.Height);
            var stride = bm.Width * 4;
            // Let GDI hand the pixels over top-down (negative height) as 32-bit BGRA: it knows whether the bitmap is stored
            // bottom-up (icons, most thumbnails) or top-down (some handlers, such as Affinity's), so nothing is guessed here.
            var info = new BitmapInfoHeader { Size = (uint)Marshal.SizeOf<BitmapInfoHeader>(), Width = bm.Width, Height = -height, Planes = 1, BitCount = 32 };
            var pixels = new byte[stride * height];
            var dc = CreateCompatibleDC(IntPtr.Zero);
            try { if (GetDIBits(dc, hbmp, 0, (uint)height, pixels, ref info, 0) != height) return null; }
            finally { DeleteDC(dc); }
            var hasAlpha = false;
            for (var i = 3; i < pixels.Length && !hasAlpha; i += 4) hasAlpha = pixels[i] != 0;
            if (!hasAlpha) for (var i = 3; i < pixels.Length; i += 4) pixels[i] = 255; // old icons without alpha: opaque
            var source = BitmapSource.Create(bm.Width, height, 96, 96, PixelFormats.Pbgra32, null, pixels, stride);
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(source));
            using var ms = new MemoryStream();
            enc.Save(ms);
            return ms.ToArray();
        }
        catch (COMException) { return null; }
        finally
        {
            if (hbmp != IntPtr.Zero) DeleteObject(hbmp);
            Marshal.ReleaseComObject(item);
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct NativeSize { public int Cx; public int Cy; }

    [StructLayout(LayoutKind.Sequential)]
    private struct Bitmap { public int Type; public int Width; public int Height; public int WidthBytes; public ushort Planes; public ushort BitsPixel; public IntPtr Bits; }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig] int GetImage(NativeSize size, int flags, out IntPtr hbitmap);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(string path, IntPtr bindCtx, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory? item);

    [DllImport("gdi32.dll")] private static extern int GetObject(IntPtr h, int size, out Bitmap bm);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr hdc, IntPtr hbmp, uint start, uint lines, [Out] byte[] bits, ref BitmapInfoHeader info, uint usage);

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfoHeader { public uint Size; public int Width; public int Height; public ushort Planes; public ushort BitCount; public uint Compression; public uint SizeImage; public int XPelsPerMeter; public int YPelsPerMeter; public uint ClrUsed; public uint ClrImportant; }

    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr h);
}
