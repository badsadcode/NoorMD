using System.Reflection;
using Noor.Contracts;

namespace NoorMD3.Host;

/// <summary>The benches the shell found, checked; and the ones it couldn't load, with why.</summary>
public sealed class BenchRegistry
{
    readonly Dictionary<string, IBench> _benches = new(StringComparer.Ordinal);
    readonly List<string> _problems = [];

    public IReadOnlyCollection<IBench> Benches => _benches.Values;
    public IReadOnlyList<string> Problems => _problems;
    public IBench? Find(string id) => _benches.GetValueOrDefault(id);

    /// <summary>Every public, non-abstract <see cref="IBench"/> with a parameterless constructor in these assemblies.</summary>
    public static BenchRegistry FromAssemblies(IEnumerable<Assembly> assemblies)
    {
        var r = new BenchRegistry();
        foreach (var asm in assemblies)
        {
            Type[] types;
            try { types = asm.GetTypes(); }
            catch (ReflectionTypeLoadException ex) { r._problems.Add($"{asm.GetName().Name}: some of its types couldn't be loaded ({ex.LoaderExceptions.FirstOrDefault()?.Message})."); continue; }
            foreach (var t in types.Where(t => t is { IsPublic: true, IsAbstract: false, IsInterface: false } && typeof(IBench).IsAssignableFrom(t) && t.GetConstructor(Type.EmptyTypes) != null))
            {
                try { r.Add((IBench)Activator.CreateInstance(t)!); }
                catch (Exception ex) { r._problems.Add($"{t.FullName}: couldn't start ({(ex.InnerException ?? ex).Message})."); }
            }
        }
        return r;
    }

    /// <summary>Adds a bench if its manifest holds up; otherwise notes why and leaves it out.</summary>
    public bool Add(IBench bench)
    {
        var m = bench.Manifest;
        string? why = null;
        if (!BenchIds.IsValid(m.Id)) why = $"its id \"{m.Id}\" isn't valid (lower case letters, digits and dots)";
        else if (m.Id == "home" || m.Id.StartsWith("shell", StringComparison.Ordinal)) why = $"\"{m.Id}\" is a name the shell keeps for itself";
        else if (_benches.ContainsKey(m.Id)) why = $"another bench already uses the id \"{m.Id}\"";
        else if (!Contract.Supported.Contains(m.ContractVersion)) why = $"it was made for contract version {m.ContractVersion}; this NoorMD knows {string.Join(", ", Contract.Supported)}";
        else if (string.IsNullOrWhiteSpace(m.Name)) why = "it has no name";
        else if (m.Density is not ("roomy" or "compact")) why = $"its density \"{m.Density}\" isn't roomy or compact";
        else if (m.Panels.Any(p => p.Dock is not ("left" or "right" or "bottom" or "none"))) why = "a panel docks somewhere other than left, right, bottom or none";
        else if (m.Panels.GroupBy(p => p.Id).Any(g => g.Count() > 1)) why = "two of its panels share an id";
        else
        {
            using var entry = bench.OpenAsset(m.Entry);
            if (entry == null) why = $"its web module \"{m.Entry}\" is missing";
        }
        if (why != null) { _problems.Add($"{(string.IsNullOrWhiteSpace(m.Name) ? m.Id : m.Name)}: not loaded, because {why}."); return false; }
        _benches[m.Id] = bench;
        return true;
    }
}
