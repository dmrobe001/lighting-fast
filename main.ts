
/**
* Create a texture from an image url.
* 
* Fetch an image from ``url`` and copy it to a texture on ``device``.
* 
* @param {GPUDevice} device The GPUDevice onto which the texture will be copied.
* @param {String} url The url from which an image will be fetched.
* 
* @return {Promise} A promise which will resolve to a GPUTexture on device.
*/
async function loadTexture(device: GPUDevice, url: string): Promise<GPUTexture> {
    // Create a bitmap from the image at the url.
    const result = await fetch(url);
    const blob = await result.blob();
    const source = await createImageBitmap(blob);

    return new Promise((resolve) => {
        
        // Create a texture on the device
        const texture = device.createTexture({
            size: [source.width, source.height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                    GPUTextureUsage.RENDER_ATTACHMENT |
                    GPUTextureUsage.COPY_DST,
        });
        
        // Copy image data into the texture
        device.queue.copyExternalImageToTexture(
            { source: source,flipY:true },
            { texture: texture },
            {width:source.width,height:source.height}
        );
        
        resolve(texture);
    });
}

//
const GameState = {
    skyColors:[[0.5, 0.7, 1.0],[1.0, 0.9, 0.8]],
    
    theta : 0.0,  // Camera rotation around the y-axis
    phi : 0.0,    // Camera rotation around the x-axis
    fov : 40.0,  // Field of view
    cameraPosition:[0.0,0.0,5.0],
    
    moveKeys:    0,
    moveup:      0,
    movedown:    0,
    moveleft:    0,
    moveright:   0,
    moveforward: 0,
    moveback:    0,
    moveSpeed: 0.05,

    get fovScale() {
        return Math.tan((this.fov * Math.PI / 180) / 2.0);
    },

    get forward() { return [ Math.cos(this.phi) * Math.sin(this.theta), Math.sin(this.phi), Math.cos(this.phi) *-Math.cos(this.theta)];},
    get right()   { return [                     -Math.cos(this.theta),                0.0,                     -Math.sin(this.theta)];},
    get front()   { return [                      Math.sin(this.theta),                0.0,                     -Math.cos(this.theta)];},
    get up()      { return [-Math.sin(this.phi) * Math.sin(this.theta), Math.cos(this.phi), Math.sin(this.phi) * Math.cos(this.theta)];},
    
    move_camera: function(){
        if (this.moveKeys>0) {
            const dx=[0,0,0];
            for (let i=0;i<3;i+=1){
                dx[i]+=this.front[i]*(this.moveforward+this.moveback);
                dx[i]+=this.right[i]*(this.moveright+this.moveleft);
            }
            dx[1]+=1*(this.moveup+this.movedown);
            const magnitude=Math.sqrt(dx[0]*dx[0]+dx[1]*dx[1]+dx[2]*dx[2]);
            
            if (magnitude > .00001){
                for (let i=0;i<3;i++){
                    this.cameraPosition[i]+=dx[i]/magnitude*this.moveSpeed;
                }   
            }
        }
    },

    get buffer() {
        return new Float32Array([
            // Consecutive vec3s need padding because WGSL requires vec3s
            // to be aligned to 4x the size of their element type.

            // checkered skybox colors
            ...this.skyColors[0]   , 0.0,
            ...this.skyColors[1]   , 0.0,
            
            // Camera parameters
            ...this.cameraPosition , 0.0,
            ...this.forward        , 0.0,
            ...this.up             , 0.0,
            ...this.right,
            this.fovScale
        ]);
    },
    //get buffersize(){
    //    return this.buffer.length / 4;
   // }
}


async function initWebGPU() {

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
                       //GPUTextureUsage.STORAGE_BINDING |
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
    
    

    // Dynamically calculate the total buffer size
    const numSpheres = sphereData.length / 4; // Each sphere has 4 components (x, y, z, radius)
    const sphereDataSize = numSpheres * 4 * 4; // Each sphere component is a 32-bit float (4 bytes)
    //const sceneDataSize = 112;//Math.ceil((19 * 4) / 16) * 16; // Two RGB colors (3 floats each) * 4 bytes per float // 96;//
    
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
        size: GameState.buffer.length*4,
        usage: GPUBufferUsage.UNIFORM  | GPUBufferUsage.COPY_DST,
        mappedAtCreation: false,
    });
    

    const computeTexture=device.createTexture( {
        size: [width, height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Create shader module
    const shaderModule = device.createShaderModule({
        code: await fetch('path_tracing.wgsl').then((res) => res.text()),
    });
    
    // Load shaders for blitting
    const blitVertexShaderModule = device.createShaderModule({
        code: await fetch('vertex_blit.wgsl').then((res) => res.text()),
    });

    const blitFragmentShaderModule = device.createShaderModule({
        code: await fetch('fragment_blit.wgsl').then((res) => res.text()),
    });

    // Define a simple render pipeline for blitting
    const blitPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: blitVertexShaderModule,
            entryPoint: 'main_vertex',
        },
        fragment: {
            module: blitFragmentShaderModule,
            entryPoint: 'main_fragment',
            targets: [
                {
                    format: swapChainFormat,
                },
            ],
        },
        primitive: {
            topology: 'triangle-list',
        },
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
    
    
    
    // Create a sampler for the texture
    const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
    });

    // Add function to blit the texture to the canvas
    function blitTextureToCanvas(texture) {
        const commandEncoder = device.createCommandEncoder();

        const renderPassDescriptor:GPURenderPassDescriptor = {
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                storeOp: 'store',
            }],
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(blitPipeline);
        passEncoder.setBindGroup(0, device.createBindGroup({
            layout: blitPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: texture.createView() },
            ],
        }));
        passEncoder.draw(6, 1, 0, 0);
        passEncoder.end();

        device.queue.submit([commandEncoder.finish()]);
    }
    
    // 
    async function renderFrame() {
        GameState.move_camera();
        const paddedSceneData = GameState.buffer;
        
        device.queue.writeBuffer(sceneBuffer, 0, paddedSceneData.buffer, 0, paddedSceneData.length*4);
        const bindGroup = createBindGroup(sceneBuffer,computeTexture);
        
        // Command encoder and compute pass
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(computePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
        passEncoder.end();
        
        // Submit the commands
        device.queue.submit([commandEncoder.finish()]);

        const textureView = context.getCurrentTexture().createView();
        const renderPassDescriptor:GPURenderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                loadOp: "clear",
                clearValue: {r: 0, g: 0, b: 0, a: 1},
                storeOp: "store",
            }],
        };
    
        const renderEncoder = device.createCommandEncoder();
        const renderPass = renderEncoder.beginRenderPass(renderPassDescriptor);
        renderPass.end();
        device.queue.submit([renderEncoder.finish()]);

        blitTextureToCanvas(computeTexture);
        // Request the next frame
        requestAnimationFrame(renderFrame);
    }
    
    document.addEventListener('mousemove', (event) => {
        if (document.pointerLockElement === canvas) {
            const deltaX = event.movementX;
            const deltaY = event.movementY;
            
            // Adjust the angles based on mouse movement and FOV
            GameState.theta -= deltaX * mouseSensitivity * GameState.fov/180*Math.PI / width;
            GameState.phi -= deltaY * mouseSensitivity * GameState.fov/180*Math.PI / height;
            
            // Clamp phi to avoid flipping the camera (staying within -90 to 90 degrees)
            GameState.phi = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, GameState.phi));
            
        }
    });
    
    let lastTouchX = null;
    let lastTouchY = null;
    let initialPinchDistance = null;
    
    // Touch movement for angle adjustment
    canvas.addEventListener('touchmove', (event) => {
        event.preventDefault();
        
        // Handle pinch zoom if there are two touches
        if (event.touches.length === 2) {
            const touch1 = event.touches[0];
            const touch2 = event.touches[1];
    
            // Calculate the current distance between the two touches
            const currentPinchDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );
    
            // If this is the start of the pinch, store the initial distance
            if (initialPinchDistance === null) {
                initialPinchDistance = currentPinchDistance;
            } else {
                // Calculate the change in distance and adjust FOV
                const pinchDelta = currentPinchDistance / initialPinchDistance;
                GameState.fov /= pinchDelta//* fov / 180 * Math.PI// * scrollSensitivity * 0.1;  // Adjust the scaling factor as needed
    
                // Clamp FOV between 30 and 150 degrees to avoid extreme distortion
                GameState.fov = Math.max(30.0, Math.min(150.0, GameState.fov));
    
                // Update initial pinch distance for smooth continuous zooming
                initialPinchDistance = currentPinchDistance;
            }
        }
        // Single touch for angle adjustment
        else if (event.touches.length === 1) {
            const touch = event.touches[0];
            const touchX = touch.clientX;
            const touchY = touch.clientY;
    
            if (lastTouchX !== null && lastTouchY !== null) {
                const deltaX = lastTouchX - touchX;
                const deltaY = lastTouchY - touchY;
    
                // Adjust angles based on touch movement and FOV
                GameState.theta -= deltaX * mouseSensitivity * GameState.fov / 180 * Math.PI / width;
                GameState.phi -= deltaY * mouseSensitivity * GameState.fov / 180 * Math.PI / height;
    
                // Clamp phi to avoid flipping the camera (staying within -90 to 90 degrees)
                GameState.phi = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, GameState.phi));
            }
    
            // Update last touch positions
            lastTouchX = touchX;
            lastTouchY = touchY;
        }
    });
    
    // Reset variables when touch ends
    canvas.addEventListener('touchend', () => {
        lastTouchX = null;
        lastTouchY = null;
        initialPinchDistance = null;
    });

    // Add scroll wheel event listener to adjust FOV
    canvas.addEventListener('wheel', (event) => {
        GameState.fov += event.deltaY * scrollSensitivity;
        
        // Clamp FOV between 30 and 150 degrees to avoid extreme distortion
        GameState.fov = Math.max(30.0, Math.min(150.0, GameState.fov));
        
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
        GameState.moveright=1;
        GameState.moveKeys++;
      }
      if (event.code === 'KeyA') {
        GameState.moveleft=-1;
        GameState.moveKeys++;
      }
      if (event.code === 'KeyW') {
        GameState.moveforward=1;
        GameState.moveKeys++;
      }
      if (event.code === 'KeyS') {
        GameState.moveback=-1;
        GameState.moveKeys++;
      }
      if (event.code === 'Space') {
        GameState.moveup=1;
        GameState.moveKeys++;
      }
      if (event.code === 'ControlLeft') {
        GameState.movedown=-1;
        GameState.moveKeys++;
      }
      if (document.pointerLockElement === canvas) {
        event.preventDefault()
      }
    });
    
    document.addEventListener('keyup', (event) => {
      if (event.code === 'KeyD') {
        GameState.moveright=0;
        GameState.moveKeys--;
      }
      if (event.code === 'KeyA') {
        GameState.moveleft=0;
        GameState.moveKeys--;
      }
      if (event.code === 'KeyW') {
        GameState.moveforward=0;
        GameState.moveKeys--;
      }
      if (event.code === 'KeyS') {
        GameState.moveback=0;
        GameState.moveKeys--;
      }
      if (event.code === 'Space') {
        GameState.moveup=0;
        GameState.moveKeys--;
      }
      if (event.code === 'ControlLeft') {
        GameState.movedown=0;
        GameState.moveKeys--;
      }
    });
    
    // Start rendering loop
    renderFrame();
}

initWebGPU();