using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace NoorMD.Core.Sprite;

/// <summary>
/// A sheet's frames for Unity: the sheet's .png.meta slicing it into sprites (point filtered, no compression, a pivot
/// and a 9-slice border from the sprite's slices) and an AnimationClip (.anim) per tag that swaps the sprites with each
/// frame's duration. Written from the formats Unity keeps in its project files.
/// </summary>
public static class UnitySprite
{
    private static string F(double v) => v.ToString("0.#####", CultureInfo.InvariantCulture);

    /// <summary>A stable id from a name: the same sheet gets the same ids when exported again.</summary>
    public static string Guid(string name) => Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes("noorsprite:" + name))).ToLowerInvariant();

    public static long InternalId(string sheet, int frame) => BitConverter.ToInt64(SHA256.HashData(Encoding.UTF8.GetBytes($"noorsprite:{sheet}:{frame}")), 0) & 0x3fffffffffffffff | 0x2100000000000000;

    /// <summary>Where the sprite's origin is in a frame (0–1, from the bottom left, as Unity has it).</summary>
    public static (double X, double Y) Pivot(SpriteExport.SheetFrame f, SpriteSlice? pivot)
    {
        if (pivot is not { HasPivot: true }) return (0.5, 0.5);
        double px = pivot.X + pivot.PivotX - f.OffX, py = pivot.Y + pivot.PivotY - f.OffY;
        return (px / f.W, 1 - py / f.H);
    }

    /// <summary>A 9-slice's border in a frame: left, bottom, right, top (pixels; nothing when there's none).</summary>
    public static (int L, int B, int R, int T) Border(SpriteExport.SheetFrame f, SpriteSlice? nine)
    {
        if (nine is not { Nine: true }) return (0, 0, 0, 0);
        int l = nine.X + nine.CenterX - f.OffX, t = nine.Y + nine.CenterY - f.OffY;
        int r = f.W - (l + nine.CenterWidth), b = f.H - (t + nine.CenterHeight);
        return (Math.Max(0, l), Math.Max(0, b), Math.Max(0, r), Math.Max(0, t));
    }

    public static string Meta(string sheetName, SpriteImage sheet, IReadOnlyList<SpriteExport.SheetFrame> frames, IReadOnlyList<SpriteSlice> slices, int pixelsPerUnit)
    {
        var pivot = slices.FirstOrDefault(s => s.HasPivot);
        var nine = slices.FirstOrDefault(s => s.Nine);
        var sb = new StringBuilder();
        sb.Append("fileFormatVersion: 2\n");
        sb.Append($"guid: {Guid(sheetName)}\n");
        sb.Append("TextureImporter:\n  internalIDToNameTable: []\n  externalObjects: {}\n  serializedVersion: 12\n");
        sb.Append("  mipmaps:\n    mipMapMode: 0\n    enableMipMap: 0\n    sRGBTexture: 1\n");
        sb.Append("  isReadable: 0\n  textureFormat: 1\n  maxTextureSize: 2048\n");
        sb.Append("  textureSettings:\n    serializedVersion: 2\n    filterMode: 0\n    aniso: 1\n    mipBias: 0\n    wrapU: 1\n    wrapV: 1\n    wrapW: 1\n");
        sb.Append("  nPOTScale: 0\n  lightmap: 0\n  compressionQuality: 50\n");
        sb.Append("  spriteMode: 2\n  spriteExtrude: 1\n  spriteMeshType: 0\n  alignment: 0\n  spritePivot: {x: 0.5, y: 0.5}\n");
        sb.Append($"  spritePixelsToUnits: {Math.Clamp(pixelsPerUnit, 1, 4096)}\n");
        sb.Append("  spriteBorder: {x: 0, y: 0, z: 0, w: 0}\n  spriteGenerateFallbackPhysicsShape: 1\n  alphaUsage: 1\n  alphaIsTransparency: 1\n");
        sb.Append("  textureType: 8\n  textureShape: 1\n");
        sb.Append("  platformSettings:\n  - serializedVersion: 3\n    buildTarget: DefaultTexturePlatform\n    maxTextureSize: 2048\n    resizeAlgorithm: 0\n    textureFormat: -1\n    textureCompression: 0\n    compressionQuality: 50\n    crunchedCompression: 0\n");
        sb.Append("  spriteSheet:\n    serializedVersion: 2\n    sprites:\n");
        for (var i = 0; i < frames.Count; i++)
        {
            var f = frames[i];
            var (px, py) = Pivot(f, pivot);
            var (bl, bb, br, bt) = Border(f, nine);
            sb.Append("    - serializedVersion: 2\n");
            sb.Append($"      name: {sheetName}_{i}\n");
            // Unity measures rectangles from the sheet's bottom.
            sb.Append($"      rect:\n        serializedVersion: 2\n        x: {f.X}\n        y: {sheet.Height - f.Y - f.H}\n        width: {f.W}\n        height: {f.H}\n");
            sb.Append($"      alignment: {(pivot != null ? 9 : 0)}\n      pivot: {{x: {F(px)}, y: {F(py)}}}\n");
            sb.Append($"      border: {{x: {bl}, y: {bb}, z: {br}, w: {bt}}}\n");
            sb.Append("      outline: []\n      physicsShape: []\n      tessellationDetail: 0\n      bones: []\n");
            sb.Append($"      spriteID: {Guid(sheetName + ":" + i)}\n      internalID: {InternalId(sheetName, i)}\n");
            sb.Append("      vertices: []\n      indices: \n      edges: []\n      weights: []\n");
        }
        sb.Append("    outline: []\n    physicsShape: []\n    bones: []\n    spriteID: \n    internalID: 0\n    vertices: []\n    indices: \n    edges: []\n    weights: []\n    secondaryTextures: []\n");
        sb.Append("  spritePackingTag: \n  pSDRemoveMatte: 0\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n");
        return sb.ToString();
    }

    /// <summary>An AnimationClip swapping the sheet's sprites (a SpriteRenderer's m_Sprite), each for its frame's time.</summary>
    public static string Anim(string clipName, string sheetName, IReadOnlyList<int> order, IReadOnlyList<SpriteExport.SheetFrame> frames, bool loop)
    {
        var guid = Guid(sheetName);
        var sb = new StringBuilder();
        sb.Append("%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!74 &7400000\nAnimationClip:\n");
        sb.Append("  m_ObjectHideFlags: 0\n  m_CorrespondingSourceObject: {fileID: 0}\n  m_PrefabInstance: {fileID: 0}\n  m_PrefabAsset: {fileID: 0}\n");
        sb.Append($"  m_Name: {clipName}\n  serializedVersion: 7\n  m_Legacy: 0\n  m_Compressed: 0\n  m_UseHighQualityCurve: 1\n");
        sb.Append("  m_RotationCurves: []\n  m_CompressedRotationCurves: []\n  m_EulerCurves: []\n  m_PositionCurves: []\n  m_ScaleCurves: []\n  m_FloatCurves: []\n");
        sb.Append("  m_PPtrCurves:\n  - curve:\n");
        var t = 0.0;
        foreach (var i in order)
        {
            sb.Append($"    - time: {F(t)}\n      value: {{fileID: {InternalId(sheetName, i)}, guid: {guid}, type: 3}}\n");
            t += frames[i].Duration / 1000.0;
        }
        // The last picture held for its time.
        sb.Append($"    - time: {F(t)}\n      value: {{fileID: {InternalId(sheetName, order[^1])}, guid: {guid}, type: 3}}\n");
        sb.Append("    attribute: m_Sprite\n    path: \n    classID: 212\n    script: {fileID: 0}\n");
        sb.Append("  m_SampleRate: 60\n  m_WrapMode: 0\n  m_Bounds:\n    m_Center: {x: 0, y: 0, z: 0}\n    m_Extent: {x: 0, y: 0, z: 0}\n");
        sb.Append("  m_ClipBindingConstant:\n    genericBindings:\n    - serializedVersion: 2\n      path: 0\n      attribute: 0\n      script: {fileID: 0}\n      typeID: 212\n      customType: 23\n      isPPtrCurve: 1\n      isIntCurve: 0\n      isSerializeReferenceCurve: 0\n");
        sb.Append("    pptrCurveMapping:\n");
        foreach (var i in order) sb.Append($"    - {{fileID: {InternalId(sheetName, i)}, guid: {guid}, type: 3}}\n");
        sb.Append($"    - {{fileID: {InternalId(sheetName, order[^1])}, guid: {guid}, type: 3}}\n");
        sb.Append("  m_AnimationClipSettings:\n    serializedVersion: 2\n    m_AdditiveReferencePoseClip: {fileID: 0}\n    m_AdditiveReferencePoseTime: 0\n");
        sb.Append($"    m_StartTime: 0\n    m_StopTime: {F(t)}\n    m_OrientationOffsetY: 0\n    m_Level: 0\n    m_CycleOffset: 0\n    m_HasAdditiveReferencePose: 0\n");
        sb.Append($"    m_LoopTime: {(loop ? 1 : 0)}\n    m_LoopBlend: 0\n    m_LoopBlendOrientation: 0\n    m_LoopBlendPositionY: 0\n    m_LoopBlendPositionXZ: 0\n");
        sb.Append("    m_KeepOriginalOrientation: 0\n    m_KeepOriginalPositionY: 1\n    m_KeepOriginalPositionXZ: 0\n    m_HeightFromFeet: 0\n    m_Mirror: 0\n");
        sb.Append("  m_EditorCurves: []\n  m_EulerEditorCurves: []\n  m_HasGenericRootTransform: 0\n  m_HasMotionFloatCurves: 0\n  m_Events: []\n");
        return sb.ToString();
    }
}

/// <summary>
/// A sheet's JSON in the form Unreal's Paper2D sprite-sheet import reads (TexturePacker's "Paper2D" form): frames by
/// file name with where each sits, trimmed or not, and a pivot (0–1 from the top left).
/// </summary>
public static class Paper2D
{
    public static string Json(string sheetName, string imageFile, SpriteImage sheet, IReadOnlyList<SpriteExport.SheetFrame> frames, IReadOnlyList<SpriteSlice> slices)
    {
        var pivot = slices.FirstOrDefault(s => s.HasPivot);
        var list = new JsonObject();
        for (var i = 0; i < frames.Count; i++)
        {
            var f = frames[i];
            double px = 0.5, py = 0.5;
            if (pivot != null) { px = (double)(pivot.X + pivot.PivotX) / f.SrcW; py = (double)(pivot.Y + pivot.PivotY) / f.SrcH; }
            list[$"{sheetName}_{i}.png"] = new JsonObject
            {
                ["frame"] = new JsonObject { ["x"] = f.X, ["y"] = f.Y, ["w"] = f.W, ["h"] = f.H },
                ["rotated"] = false,
                ["trimmed"] = f.Trimmed,
                ["spriteSourceSize"] = new JsonObject { ["x"] = f.OffX, ["y"] = f.OffY, ["w"] = f.W, ["h"] = f.H },
                ["sourceSize"] = new JsonObject { ["w"] = f.SrcW, ["h"] = f.SrcH },
                ["pivot"] = new JsonObject { ["x"] = Math.Round(px, 5), ["y"] = Math.Round(py, 5) },
            };
        }
        var root = new JsonObject
        {
            ["frames"] = list,
            ["meta"] = new JsonObject
            {
                ["app"] = "NoorSprite", ["version"] = "1.0", ["target"] = "paper2d", ["image"] = imageFile, ["format"] = "RGBA8888",
                ["size"] = new JsonObject { ["w"] = sheet.Width, ["h"] = sheet.Height }, ["scale"] = "1",
            },
        };
        return root.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
    }
}
