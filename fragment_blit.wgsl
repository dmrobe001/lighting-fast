@group(0) @binding(0) var textureSampler: sampler;
@group(0) @binding(1) var texture: texture_2d<f32>;

@fragment
fn main_fragment(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
    return textureSample(texture, textureSampler, fragUV);
}