// Define the sphere structure
struct Sphere {
    center: vec3<f32>,
    radius: f32,
};

struct Ray {
    origin: vec3<f32>,
    direction: vec3<f32>,
};

struct Scene {
    skyColors : array<vec3<f32>, 2>,
    origin: vec3<f32>,  // 12 bytes for vec3, padded to 16 bytes
    _padding1: f32,     // 4 bytes of padding after vec3
    forward: vec3<f32>, // 12 bytes for vec3, padded to 16 bytes
    _padding2: f32,     // 4 bytes of padding after vec3
    up: vec3<f32>,      // 12 bytes for vec3, padded to 16 bytes
    _padding3: f32,     // 4 bytes of padding after vec3
    right: vec3<f32>,   // 12 bytes for vec3, padded to 16 bytes
    fovScale: f32,      // Single f32 value, aligned to 4 bytes
};

// Sphere data as a flexible array, followed by skybox colors (manually handled)
@group(0) @binding(0) var<storage, read> sphereData : array<Sphere>; // Access dynamically
@group(0) @binding(1) var<uniform> scene : Scene; 
@group(0) @binding(2) var writeTexture : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var skyboxTexture  : texture_2d<f32>;
//@group(0) @binding(4) var skyboxSampler: sampler;

fn checkered_skybox(direction: vec3<f32>) -> vec3<f32> {
    // Convert the direction to texture coordinates (u, v)
    let u = (atan2(direction.z, direction.x) / (2.0 * 3.14159)) + 0.5;
    let v = (asin(direction.y) / 3.14159) + 0.5;

    // Convert the UV coordinates to integer texture coordinates
    let texCoords = vec2<i32>(
        i32(u * f32(textureDimensions(skyboxTexture).x)), 
        i32(v * f32(textureDimensions(skyboxTexture).y))
    );

    // Load texel from texture at calculated coordinates (texCoords) with mip level 0
    let color = textureLoad(skyboxTexture, texCoords, 0);

    return color.xyz; // Return the RGB components of the color
}

// Ray-sphere intersection function
fn intersectSphere(ray: Ray, sphere: Sphere) -> f32 {
    let oc = ray.origin - sphere.center;
    let a = dot(ray.direction, ray.direction);
    let b = 2.0 * dot(oc, ray.direction);
    let c = dot(oc, oc) - sphere.radius * sphere.radius;
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 {
        return -1.0;
    }
    return (-b - sqrt(discriminant)) / (2.0 * a);
}

// Reflect a vector around a normal
fn reflect(inVec: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
    return inVec - 2.0 * dot(inVec, normal) * normal;
}

// Skybox from an image
fn texture_skybox(direction: vec3<f32>) -> vec3<f32> {
   let u = atan2(direction.z, direction.x) / (2.0 * 3.14159) + 0.5;
   let v = asin(direction.y) / 3.14159 + 0.5;

   let checkSize = 10.0;
   let checks = step(0.5, fract(u * checkSize)) == step(0.5, fract(v * checkSize));

   return mix(scene.skyColors[0], scene.skyColors[1], f32(checks));
}

// Compute the color for a single pixel using iterative ray tracing
fn trace(ray: Ray) -> vec3<f32> {
    var currentRay = ray;
    var color = vec3<f32>(0.0, 0.0, 0.0);
    var throughput = vec3<f32>(1.0, 1.0, 1.0);

    // Limit the number of bounces (e.g., 3 iterations)
    for (var bounce = 0; bounce < 6; bounce = bounce + 1) {
        var hitDistance = 1e10;
        var hitSphere:u32 = arrayLength(&sphereData);

        // Intersect ray with all spheres in the scene
        for (var i: u32 = 0; i < arrayLength(&sphereData); i = i + 1) {
            let dist = intersectSphere(currentRay, sphereData[i]);
            if dist > 0.0 && dist < hitDistance {
                hitDistance = dist;
                hitSphere = i;
            }
        }

        // If no sphere was hit, return the skybox color
        if hitSphere == arrayLength(&sphereData) {
            color += throughput * checkered_skybox(currentRay.direction);
            break;
        }

        // Compute reflection
        let hitPoint = currentRay.origin + hitDistance * currentRay.direction;
        let normal = normalize(hitPoint - sphereData[hitSphere].center);
        let reflectedDirection = reflect(currentRay.direction, normal);

        // Update the ray for the next bounce
        currentRay = Ray(hitPoint, reflectedDirection);

        // Attenuate the throughput (e.g., reflectivity factor)
        throughput *= 0.8; // Diminish the contribution with each bounce
    }

    return color;
}

// Main compute shader
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let width = 800u;
    let height = 600u;
    

    if (global_id.x >= width || global_id.y >= height) {
        return;
    }

    // Calculate pixel coordinates
    let x = f32(global_id.x) / f32(width) * 2.0 - 1.0;
    let y = f32(global_id.y) / f32(height) * 2.0 - 1.0;

    // Apply FOV scaling
    let screenX = scene.fovScale * x;
    let screenY = -scene.fovScale * y;
    
    // Compute the ray direction using orientation and the FOV-scaled screen coordinates
    let rayDirection = normalize(scene.forward + screenX * scene.right + screenY * scene.up);

    let ray = Ray(scene.origin, rayDirection);
    let color = trace(ray);//vec3<f32>(1.0-scene.fovScale, 0.0, 0.0);//
    
    // Write the result to the output texture
    textureStore(writeTexture, vec2<i32>(i32(global_id.x), i32(global_id.y)), vec4<f32>(color, 1.0));
}
