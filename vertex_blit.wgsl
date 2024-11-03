struct VertexOut {
    @builtin(position) position : vec4<f32>,
    @location(0) fragUV : vec2<f32>,
};

@vertex
fn main_vertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
    var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0)
    );

    var uv = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0)
    );

    var output: VertexOut;
    output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
    output.fragUV = uv[vertexIndex];
    return output;
}