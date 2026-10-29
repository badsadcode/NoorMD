using System.Numerics;
using System.Text;
using NoorMD.Media;
using NoorMD.Media.Assets3D;
using NoorMD.Media.Forge;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorForge, the start: models read (GLB, OBJ), UVs to paint on (their own or unwrapped), the mesh maps.</summary>
public class ForgeModelTests
{
    /// <summary>A 1 m cube on a 4 m floor, as an OBJ without UVs or normals (two parts, two materials).</summary>
    public static string CubeOnFloor()
    {
        var sb = new StringBuilder("o Floor\nusemtl Ground\nv -2 0 -2\nv 2 0 -2\nv 2 0 2\nv -2 0 2\nf 1 3 2\nf 1 4 3\no Cube\nusemtl Stone\n");
        foreach (var (x, y, z) in new[] { (-0.5, 0, -0.5), (0.5, 0, -0.5), (0.5, 1, -0.5), (-0.5, 1, -0.5), (-0.5, 0, 0.5), (0.5, 0, 0.5), (0.5, 1, 0.5), (-0.5, 1, 0.5) })
            sb.Append(FormattableString.Invariant($"v {x} {y} {z}\n"));
        // Faces wound outwards (vertices 5–12).
        foreach (var f in new[] { "5 8 7 6", "9 10 11 12", "5 6 10 9", "8 12 11 7", "5 9 12 8", "6 7 11 10" }) sb.Append("f ").Append(f).Append('\n');
        return sb.ToString();
    }

    [Fact]
    public void An_obj_without_uvs_is_read_by_material_and_unwrapped()
    {
        var m = ForgeModel.ReadObj(CubeOnFloor(), "Test");
        Assert.Equal(["Ground", "Stone"], m.Sets.Select(s => s.Name));
        Assert.Equal(["Floor", "Cube"], m.PartNames);
        Assert.Equal(12, m.Sets[1].TriangleCount);
        Assert.True(m.Sets[1].Unwrapped);
        Assert.True(UvAtlas.Usable(m.Sets[1]));
        Assert.All(m.Sets[1].Uvs, uv => { Assert.InRange(uv.X, 0, 1); Assert.InRange(uv.Y, 0, 1); });
        // Normals were made: the cube's top faces up.
        var top = Enumerable.Range(0, 36).Where(i => m.Sets[1].Positions[i].Y > 0.99f).Select(i => m.Sets[1].Normals[i]).ToList();
        Assert.All(top, n => Assert.True(n.Y > 0.4f));
    }

    [Fact]
    public void Overlapping_uvs_are_replaced_and_good_ones_kept()
    {
        var s = new ForgeSet();
        // Two triangles on the same place in the square: stacked.
        foreach (var dz in new[] { 0f, 1f })
        {
            s.Positions.AddRange([new Vector3(0, 0, dz), new Vector3(1, 0, dz), new Vector3(0, 1, dz)]);
            s.Normals.AddRange([Vector3.UnitZ, Vector3.UnitZ, Vector3.UnitZ]);
            s.Uvs.AddRange([new Vector2(0.1f, 0.1f), new Vector2(0.9f, 0.1f), new Vector2(0.1f, 0.9f)]);
            s.Parts.Add(0);
        }
        Assert.False(UvAtlas.Usable(s));
        UvAtlas.Unwrap(s);
        Assert.True(UvAtlas.Usable(s));
    }

    [Fact]
    public void A_glb_is_read_in_world_space_with_its_uvs()
    {
        var mesh = new Mesh3D { Name = "Quad" };
        var sub = mesh.Sub(0);
        foreach (var (p, uv) in new[] { (new Vector3(0, 0, 0), new Vector2(0, 0)), (new Vector3(1, 0, 0), new Vector2(1, 0)), (new Vector3(1, 1, 0), new Vector2(1, 1)), (new Vector3(0, 1, 0), new Vector2(0, 1)) })
            mesh.AddVertex(p, Vector3.UnitZ, uv);
        sub.Indices.AddRange([0, 1, 2, 0, 2, 3]);
        var asset = new Asset3D { Name = "Q" };
        asset.Materials.Add(new Material3D { Name = "Paint" });
        asset.Root.Children.Add(new Node3D { Name = "Sign", Translation = new Vector3(0, 2, 0), Mesh = mesh });
        var m = ForgeModel.ReadGlb(GlbWriter.Write(asset), "Q");
        var set = Assert.Single(m.Sets);
        Assert.Equal("Paint", set.Name);
        Assert.Equal(2, set.TriangleCount);
        Assert.False(set.Unwrapped);
        Assert.Contains(new Vector3(1, 3, 0), set.Positions); // moved up by its node
        Assert.Contains("Sign", m.PartNames);
        Assert.Throws<InvalidDataException>(() => ForgeModel.ReadGlb(Encoding.ASCII.GetBytes("not a model at all")));
    }

    [Fact]
    public void The_bake_finds_edges_creases_and_shadowed_corners()
    {
        var m = ForgeModel.ReadObj(CubeOnFloor(), "Test");
        var cube = ForgeBake.Bake(m, 1, 128, new ForgeBake.Settings(AoRays: 16));
        var floor = ForgeBake.Bake(m, 0, 128, new ForgeBake.Settings(AoRays: 32));
        Assert.True(cube.Covered.Count(c => c == 1) > 128 * 128 * 0.3);
        // On the cube: texels by its top edges are convex; the middle of the top is flat.
        var idx = Enumerable.Range(0, 128 * 128).Where(i => cube.Covered[i] == 1).ToList();
        var edge = idx.Where(i => cube.Position[i].Y > 0.95f && (MathF.Abs(cube.Position[i].X) > 0.45f || MathF.Abs(cube.Position[i].Z) > 0.45f)).Average(i => cube.Curvature[i]);
        var middle = idx.Where(i => cube.Normal[i].Y > 0.9f && MathF.Abs(cube.Position[i].X) < 0.1f && MathF.Abs(cube.Position[i].Z) < 0.1f).Average(i => cube.Curvature[i]);
        Assert.True(edge > middle + 0.1, $"edge {edge}, middle {middle}");
        // On the floor: next to the cube darker than far from it.
        var fidx = Enumerable.Range(0, 128 * 128).Where(i => floor.Covered[i] == 1).ToList();
        var near = fidx.Where(i => { var p = floor.Position[i]; return MathF.Abs(p.X) < 0.75f && MathF.Abs(p.Z) < 0.75f && (MathF.Abs(p.X) > 0.5f || MathF.Abs(p.Z) > 0.5f); }).Average(i => floor.Ao[i]);
        var far = fidx.Where(i => MathF.Abs(floor.Position[i].X) > 1.6f || MathF.Abs(floor.Position[i].Z) > 1.6f).Average(i => floor.Ao[i]);
        Assert.True(near < far - 0.1, $"near {near}, far {far}");
        // The tangent frame is at right angles to the normal.
        Assert.All(idx.Take(200), i => Assert.True(MathF.Abs(Vector3.Dot(cube.Tangent[i], cube.Normal[i])) < 0.01f));
    }
}
