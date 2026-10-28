namespace NoorMD.Media.Assets3D;

/// <summary>
/// Ready-made wind shaders for the trees' wind data (TEXCOORD_1 = branch bend, leaf flutter; TEXCOORD_2 = phase,
/// trunk sway), written beside an export: a Godot 4 spatial shader, and an HLSL function for a Unity Shader Graph
/// Custom Function node or an Unreal Custom node. Same motion as the Asset Bench preview.
/// </summary>
public static class WindShaders
{
    public const string GodotFile = "NoorTreeWind.gdshader";
    public const string HlslFile = "NoorTreeWind.hlsl";

    public const string Godot = """
        // NoorMD Asset Bench: tree wind for Godot 4. Put it on the tree's materials (bark and leaves); set the leaves'
        // material to use the alpha cutoff. Godot reads TEXCOORD_1 as UV2: x = branch bend, y = leaf flutter.
        // The trunk sway comes from the height (set tree_height); the phase from where the tree stands, so neighbours
        // don't move in step. COLOR is the painted shading from the export.
        shader_type spatial;
        render_mode cull_back, depth_draw_opaque;

        uniform sampler2D albedo_texture : source_color, filter_linear_mipmap, repeat_enable;
        uniform vec4 albedo_tint : source_color = vec4(1.0);
        uniform bool use_alpha_cutoff = false;
        uniform float alpha_cutoff : hint_range(0.0, 1.0) = 0.5;
        uniform float roughness : hint_range(0.0, 1.0) = 0.85;
        uniform vec3 wind_direction = vec3(1.0, 0.0, 0.3);
        uniform float wind_strength : hint_range(0.0, 3.0) = 1.0;
        uniform float wind_speed : hint_range(0.0, 5.0) = 1.0;
        uniform float tree_height = 8.0;
        uniform float sway_amount = 0.025;
        uniform float bend_amount = 0.18;
        uniform float flutter_amount = 0.05;

        void vertex() {
        	float t = TIME * wind_speed;
        	vec3 origin = NODE_POSITION_WORLD;
        	float phase = fract(sin(dot(origin.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
        	float sway = pow(clamp(VERTEX.y / max(tree_height, 0.01), 0.0, 1.0), 2.0);
        	float gust = 0.65 + 0.35 * sin(t * 0.37 + phase) * sin(t * 0.23 + 1.3);
        	vec3 dir = normalize(wind_direction);
        	vec3 offset = dir * sway * tree_height * sway_amount * (1.0 + 0.35 * sin(t * 0.9 + phase));
        	offset += (dir * 0.8 + vec3(0.0, -0.25, 0.0)) * UV2.x * bend_amount * sin(t * 1.9 + phase + UV2.x * 2.0);
        	offset += NORMAL * UV2.y * flutter_amount * sin(t * 9.0 + phase * 7.0 + dot(VERTEX, vec3(3.1, 1.7, 2.3)));
        	VERTEX += (inverse(MODEL_MATRIX) * vec4(offset * wind_strength * gust, 0.0)).xyz;
        }

        void fragment() {
        	vec4 tex = texture(albedo_texture, UV) * albedo_tint;
        	if (use_alpha_cutoff && tex.a < alpha_cutoff) {
        		discard;
        	}
        	ALBEDO = tex.rgb * COLOR.rgb;
        	ROUGHNESS = roughness;
        }

        """;

    public const string Hlsl = """
        // NoorMD Asset Bench: tree wind as one HLSL function.
        //
        // Unity (URP/HDRP Shader Graph): a Custom Function node, Type File, this file, Name NoorTreeWind. Inputs:
        //   PositionOS (Position, Object), NormalOS (Normal, Object), Wind1 (UV1: x branch bend, y leaf flutter),
        //   Wind2 (UV2: x phase, y trunk sway), WindDirOS (your wind direction in object space), TimeSec (Time),
        //   Strength, TreeHeight. Add Offset to the position and feed it to the Vertex Position of the master stack.
        // Unreal: a Custom node with the function body; Wind1 = TexCoord[1], Wind2 = TexCoord[2]; plug Offset into World
        //   Position Offset (convert to world space and to centimetres: × 100).
        void NoorTreeWind_float(float3 PositionOS, float3 NormalOS, float2 Wind1, float2 Wind2, float3 WindDirOS,
            float TimeSec, float Strength, float TreeHeight, out float3 Offset)
        {
            float bend = Wind1.x, flutter = Wind1.y, phase = Wind2.x * 6.2832, sway = Wind2.y;
            float gust = 0.65 + 0.35 * sin(TimeSec * 0.37) * sin(TimeSec * 0.23 + 1.3);
            float3 dir = normalize(WindDirOS);
            Offset = dir * sway * TreeHeight * 0.025 * (1.0 + 0.35 * sin(TimeSec * 0.9));
            Offset += (dir * 0.8 + float3(0.0, -0.25, 0.0)) * bend * 0.18 * sin(TimeSec * 1.9 + phase);
            Offset += NormalOS * flutter * 0.05 * sin(TimeSec * 9.0 + phase * 7.0 + dot(PositionOS, float3(3.1, 1.7, 2.3)));
            Offset *= Strength * gust;
        }

        void NoorTreeWind_half(half3 PositionOS, half3 NormalOS, half2 Wind1, half2 Wind2, half3 WindDirOS,
            half TimeSec, half Strength, half TreeHeight, out half3 Offset)
        {
            float3 o;
            NoorTreeWind_float(PositionOS, NormalOS, Wind1, Wind2, WindDirOS, TimeSec, Strength, TreeHeight, o);
            Offset = (half3)o;
        }

        """;
}
