async function loadTexture(device, url) {
    
    return new Promise((resolve) => {
        const res = await fetch(url);
        const blob = await res.blob();
        const source = await createImageBitmap(blob, { colorSpaceConversion: 'none' });    
        const texture = device.createTexture({
            label: url,
            format: 'rgba8unorm',
            size: [source.width, source.height],
            usage: GPUTextureUsage.COPY_DST |
                   GPUTextureUsage.TEXTURE_BINDING |
                   GPUTextureUsage.RENDER_ATTACHMENT,
        });
        device.queue.copyExternalImageToTexture(
            { source, flipY: true },
            { texture },
            { width: source.width, height: source.height },
        );
    });
}

async function initWebGPU() {
    
    let theta = 0.0;  // Camera rotation around the y-axis
    let phi = 0.0;    // Camera rotation around the x-axis
    let fov = 40.0;  // Field of view
    let cameraPosition=[0.0,0.0,5.0];
    
    let isDragging = false;
    let previousMouseX = 0;
    let previousMouseY = 0;
    let moveup=0;
    let movedown=0;
    let moveleft=0;
    let moveright=0;
    let moveforward=0;
    let moveback=0;

    // Adjust these scales to change how sensitive the mouse movement is relative to the FOV
    const mouseSensitivity = 1;//0.005;
    const scrollSensitivity = 0.01;
    
    // Initialize WebGPU
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgpu');
    
    const swapChainFormat = 'rgba8unorm';
    context.configure({
        device,
        format: swapChainFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING |
                       GPUTextureUsage.STORAGE_BINDING |
                       GPUTextureUsage.COPY_DST |
                       GPUTextureUsage.RENDER_ATTACHMENT,
    });
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Sphere data
    const sphereData = new Float32Array([
        // Define sphere positions and radii
        0.0, 0.0, 0.0, 1.0, // Sphere 1: Center (0, 0, 0), Radius 1
        3.0, 0.0, 0.0, 1.0, // Sphere 2
        -2.0, 2.0, 0.0, 0.1, // Sphere 2
        // Add more spheres as needed
    ]);
    
    const skyColor1=[0.5, 0.7, 1.0];
    const skyColor2=[1.0, 0.9, 0.8];
    
    // Dynamically calculate the total buffer size
    const numSpheres = sphereData.length / 4; // Each sphere has 4 components (x, y, z, radius)
    const sphereDataSize = numSpheres * 4 * 4; // Each sphere component is a 32-bit float (4 bytes)
    const sceneDataSize = 112;//Math.ceil((19 * 4) / 16) * 16; // Two RGB colors (3 floats each) * 4 bytes per float // 96;//
    
    // Create a buffer for sphere data
    const sphereBuffer = device.createBuffer({
        size: sphereDataSize,
        usage: GPUBufferUsage.STORAGE   | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    
    const skyboxTexture = await loadTexture(device, 'starmap_2020_4k_print.jpg');
    
    // Fill the sphere buffer with sphere data
    new Float32Array(sphereBuffer.getMappedRange()).set(sphereData);
    sphereBuffer.unmap();
    
    const sceneBuffer = device.createBuffer({
        size: sceneDataSize,
        usage: GPUBufferUsage.UNIFORM  | GPUBufferUsage.COPY_DST,
        mappedAtCreation: false,
    });
    
    // Create shader module
    const shaderModule = device.createShaderModule({
        code: await fetch('path_tracing.wgsl').then((res) => res.text()),
    });
    
    // Define a bind group layout
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'read-only-storage' }, // Sphere buffer
            },
            {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'uniform' }, // Scene buffer
            },
            {
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: {
                    access: 'write-only',
                    format: 'rgba8unorm',
                    viewDimension: '2d',
                },
            },
            {
                binding: 3,
                visibility: GPUShaderStage.COMPUTE,
                texture: {
                    sampleType: 'float',      // Use 'float' for f32 sampled textures
                    access: 'read-only',
                    format: 'rgba8unorm',
                    viewDimension: '2d',
                    multisampled: false,       // Not multisampled
                },
            },
        ],
    });
    
    // Create a pipeline layout using the bind group layout
    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
    });
    
    // Create the compute pipeline
    const computePipeline = device.createComputePipeline({
        layout: pipelineLayout,
        compute: {
            module: shaderModule,
            entryPoint: 'main',
        },
    });
    
    // Create bind groups
    function createBindGroup(currentSceneBuffer,writeTexture) {
        return device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer:sphereBuffer } },
                { binding: 1, resource: { buffer:currentSceneBuffer } },
                { binding: 2, resource: writeTexture.createView() },  // Write to this texture
                { binding: 3, resource: skyboxTexture.createView() },   // Read from this texture
            ],
        });
    }
    
    let forward = [
        Math.cos(phi) * Math.sin(theta),
        Math.sin(phi),
        -Math.cos(phi) * Math.cos(theta)
    ];
    
    let right = [
        Math.sin(theta + Math.PI / 2.0),
        0.0,
        Math.cos(theta + Math.PI / 2.0)
    ];
    
    let up = [
        right[1] * forward[2] - right[2] * forward[1],
        right[2] * forward[0] - right[0] * forward[2],
        right[0] * forward[1] - right[1] * forward[0]
    ];
    
    async function renderFrame() {
        const bindGroup = createBindGroup(sceneBuffer,context.getCurrentTexture());
      
        // Pass updated theta, phi, and fov to the shader
        const rayOrigin = [0.0, 0.0, 5.0];
        
        // Convert FOV to scaling factor
        const fovScale = Math.tan((fov * Math.PI / 180) / 2.0);
        
        // Calculate forward, right, and up vectors using theta and phi
        forward = [
            Math.cos(phi) * Math.sin(theta),
            Math.sin(phi),
            -Math.cos(phi) * Math.cos(theta)
        ];
        
        right = [
            -Math.cos(theta),
            0.0,
            -Math.sin(theta)
        ];
        
        const front = [
            Math.sin(theta),
            0.0,
            -Math.cos(theta)
        ];
        
        up = [
            -Math.sin(phi) * Math.sin(theta),
            Math.cos(phi),
            +Math.sin(phi) * Math.cos(theta)
        ];
        
        for (var i=0;i<3;i+=1){
          cameraPosition[i]+=front[i]*(moveforward+moveback)*.05;
          cameraPosition[i]+=right[i]*(moveright+moveleft)*.05;
        }
        cameraPosition[1]+=1*(moveup+movedown)*.05;
        
        const paddedSceneData = new Float32Array(sceneDataSize / 4);
        const sceneData = new Float32Array([
            // Sky colors (vec3, 2 elements, with padding)
            ...skyColor1, 0.0,  // skyColor1 (vec3 + padding)
            ...skyColor2, 0.0,  // skyColor2 (vec3 + padding)
            
            // Camera parameters (with padding)
            ...cameraPosition, 0.0,    // origin (vec3 + padding)
            ...forward, 0.0,      // forward (vec3 + padding)
            ...up, 0.0,           // up (vec3 + padding)
            ...right, 0.0,        // right (vec3 + padding)
            fovScale              // fovScale (f32)
        ]);
        paddedSceneData.set(sceneData);
        device.queue.writeBuffer(sceneBuffer, 0, paddedSceneData.buffer, 0, sceneDataSize);
        
        // Command encoder and compute pass
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(computePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
        passEncoder.end();
        
        // Submit the commands
        device.queue.submit([commandEncoder.finish()]);
        
        // Request the next frame
        requestAnimationFrame(renderFrame);
    }
    
    document.addEventListener('mousemove', (event) => {
        if (document.pointerLockElement === canvas) {
            const deltaX = event.movementX;
            const deltaY = event.movementY;
            
            // Adjust the angles based on mouse movement and FOV
            theta -= deltaX * mouseSensitivity * fov/180*Math.PI / width;
            phi -= deltaY * mouseSensitivity * fov/180*Math.PI / height;
            
            // Clamp phi to avoid flipping the camera (staying within -90 to 90 degrees)
            phi = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, phi));
            
        }
    });
    
    // Add scroll wheel event listener to adjust FOV
    canvas.addEventListener('wheel', (event) => {
        fov += event.deltaY * scrollSensitivity;
        
        // Clamp FOV between 30 and 150 degrees to avoid extreme distortion
        fov = Math.max(30.0, Math.min(150.0, fov));
        
        event.preventDefault();
    });
    
        canvas.addEventListener('click', () => {
        canvas.requestPointerLock();
    });
    
    document.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') {
        document.exitPointerLock();
      }
      if (event.code === 'KeyD') {
        moveright=1;
      }
      if (event.code === 'KeyA') {
        moveleft=-1;
      }
      if (event.code === 'KeyW') {
        moveforward=1;
      }
      if (event.code === 'KeyS') {
        moveback=-1;
      }
      if (event.code === 'Space') {
        moveup=1;
      }
      if (event.code === 'ControlLeft') {
        movedown=-1;
      }
      if (document.pointerLockElement === canvas) {
        event.preventDefault()
      }
    });
    
    document.addEventListener('keyup', (event) => {
      if (event.code === 'KeyD') {
        moveright=0;
      }
      if (event.code === 'KeyA') {
        moveleft=0;
      }
      if (event.code === 'KeyW') {
        moveforward=0;
      }
      if (event.code === 'KeyS') {
        moveback=0;
      }
      if (event.code === 'Space') {
        moveup=0;
      }
      if (event.code === 'ControlLeft') {
        movedown=0;
      }
    });
    
    // Start rendering loop
    renderFrame();
}

initWebGPU();
