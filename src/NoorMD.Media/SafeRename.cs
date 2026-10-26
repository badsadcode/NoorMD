namespace NoorMD.Media;

public sealed record RenamePlan(bool Ok, string SourcePath, string TargetPath, IReadOnlyList<string> Problems)
{
    public bool IsNoOp => Ok && string.Equals(SourcePath, TargetPath, StringComparison.Ordinal);
}

/// <summary>
/// Validates and performs file renames without ever overwriting another file. Everything is checked
/// before anything on disk is touched; the extension is kept (changing it would change the format).
/// </summary>
public static class SafeRename
{
    public const int MaxNameLength = 240;
    public const int MaxPathLength = 32_000;
    private static readonly string[] Reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"];
    private static readonly char[] Invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

    /// <param name="newBaseName">The new file name, with or without the original extension.</param>
    public static RenamePlan Plan(string sourcePath, string newBaseName)
    {
        var problems = new List<string>();
        var source = Path.GetFullPath(sourcePath);
        var ext = Path.GetExtension(source);
        var name = (newBaseName ?? "").Trim();
        if (name.EndsWith(ext, StringComparison.OrdinalIgnoreCase)) name = name[..^ext.Length].TrimEnd();

        if (name.Length == 0) problems.Add("The file name is empty.");
        if (name.IndexOfAny(Invalid) >= 0 || name.Any(char.IsControl))
            problems.Add("The name contains characters Windows doesn't allow in file names: < > : \" / \\ | ? *");
        if (name.EndsWith('.') || name.StartsWith(' ')) problems.Add("Windows file names can't end with a dot or start with a space.");
        if (Reserved.Contains(name.Split('.')[0], StringComparer.OrdinalIgnoreCase)) problems.Add($"\"{name}\" is a reserved name on Windows.");
        if (name.Length + ext.Length > MaxNameLength) problems.Add($"The name is too long ({name.Length + ext.Length} characters; at most {MaxNameLength}).");

        var dir = Path.GetDirectoryName(source)!;
        var target = problems.Count == 0 ? Path.Combine(dir, name + ext) : source;
        if (target.Length > MaxPathLength) problems.Add("The full path would be too long.");
        if (!File.Exists(source)) problems.Add($"\"{Path.GetFileName(source)}\" no longer exists.");

        if (problems.Count == 0 && !string.Equals(source, target, StringComparison.Ordinal))
        {
            var caseOnly = string.Equals(source, target, StringComparison.OrdinalIgnoreCase);
            if (!caseOnly && (File.Exists(target) || Directory.Exists(target)))
                problems.Add($"A file named \"{Path.GetFileName(target)}\" already exists in this folder. Nothing was renamed.");
        }
        return new RenamePlan(problems.Count == 0, source, target, problems);
    }

    /// <summary>Executes a validated plan. Case-only renames go through a temporary name.</summary>
    public static string Execute(RenamePlan plan)
    {
        if (!plan.Ok) throw new InvalidOperationException(string.Join(" ", plan.Problems));
        if (plan.IsNoOp) return plan.TargetPath;
        if (string.Equals(plan.SourcePath, plan.TargetPath, StringComparison.OrdinalIgnoreCase))
        {
            var tmp = Path.Combine(Path.GetDirectoryName(plan.SourcePath)!, $".noormd-rename-{Guid.NewGuid():N}{Path.GetExtension(plan.SourcePath)}");
            File.Move(plan.SourcePath, tmp, overwrite: false);
            try { File.Move(tmp, plan.TargetPath, overwrite: false); }
            catch { File.Move(tmp, plan.SourcePath, overwrite: false); throw; }
        }
        else
        {
            File.Move(plan.SourcePath, plan.TargetPath, overwrite: false); // never overwrites: throws if the target appeared meanwhile
        }
        return plan.TargetPath;
    }

    /// <summary>Suggests a file name from tags ("Artist - Title"), cleaned for Windows. Never applied automatically.</summary>
    public static string SuggestName(string? title, string? artist)
    {
        var raw = string.IsNullOrWhiteSpace(artist) ? (title ?? "") : $"{artist} - {title}";
        var cleaned = new string(raw.Select(c => Invalid.Contains(c) || char.IsControl(c) ? '-' : c).ToArray());
        cleaned = string.Join(' ', cleaned.Split(' ', StringSplitOptions.RemoveEmptyEntries)).Trim(' ', '.');
        return cleaned.Length > 180 ? cleaned[..180].TrimEnd(' ', '.') : cleaned;
    }
}
