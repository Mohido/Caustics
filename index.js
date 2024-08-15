import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; 
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; 
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'; 
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Variables
const meta = {
    wmSize: 512,        // Wave maps size (normal and displacement maps)
    oSize: 8,          // Ocean size (threejs units)
    oSegments: 18,      // Ocean segments 
    mWaves : 5,         // Max waves (used to define the shaders)
    waves : [           // Waves parameters.
        {
            length: 5,
            amplitude: 0.3,
            speed: 1,
            angle: 0,
            steepness: 0.6,
        },
        {
            length: 2,
            amplitude: 0.05,
            speed: 2.3,
            angle: 45,
            steepness: 0.2,
        },
        {
            length: 1.5,
            amplitude: 0.05,
            speed: 2.5,
            angle: 315,
            steepness: 0.2,
        },
        {
            length: 6,
            amplitude: 0.1,
            speed: 7.3,
            angle: 70,
            steepness: 0,
        },
    ]
}


// THREEJS
const renderer = new THREE.WebGLRenderer({alpha:true});

if(!renderer.capabilities.isWebGL2){
    console.error("Your browser doesn't support the correct webgl version");
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// renderer.outputEncoding = THREE.sRGBEncoding; // Ensure correct color encoding for final output
renderer.toneMapping = THREE.NoToneMapping;  // Disable tone mapping for simplicity

document.body.appendChild(renderer.domElement);

const renderTarget = new THREE.WebGLRenderTarget(meta.wmSize, meta.wmSize, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    encoding: THREE.LinearEncoding,
    count : 2
});

const gltfloader = new GLTFLoader();
const textloader = new THREE.TextureLoader();

// Often used geometries.
const geometries = {
    ocean: new THREE.PlaneGeometry(meta.oSize, meta.oSize, meta.oSegments, meta.oSegments)
}

function getTime() {
    return performance.now() / 3000;
}

function wavesToUniforms(){
    const PI2 = Math.PI*2;            
    const toDir = (wave) =>  [Math.cos((wave.angle /180) * Math.PI ), Math.sin((wave.angle /180)*Math.PI )]
    
    return {
            wcount :       {value :  meta.waves.length},
            wfrequencies:  {value : (meta.waves.map((wave) => PI2/wave.length))},
            wfrequencies_: {value : (meta.waves.map((wave) => wave.length/PI2))},
            wphases:       {value : (meta.waves.map((wave) => wave.speed * getTime() * PI2/wave.length))} ,
            wamplitudes:   {value : (meta.waves.map((wave) => wave.amplitude) )} ,
            wdirs:         {value : (meta.waves.flatMap(wave => toDir(wave))) } ,     
            wsteepnesses:  {value : (meta.waves.map((wave) => wave.steepness) )} 
        }
}

function getWaveSubShader(mwaves) {
    return `
        uniform float time;
        uniform int wcount;
        uniform float wfrequencies[${mwaves}];
        uniform float wfrequencies_[${mwaves}];
        uniform float wphases[${mwaves}];
        uniform float wamplitudes[${mwaves}];
        uniform float wdirs[${mwaves*2}];
        uniform float wsteepnesses[${mwaves}];

        struct Displacement{
            vec3 position;
            vec3 normal;
        };

        Displacement gerstner(Displacement inputs){
            Displacement displaced;
            displaced.position = vec3(0.);
            displaced.normal = inputs.normal;

            for(int i = 0 ; i < wcount ; i++){
                // Extract data
                float f_ = wfrequencies_[i];
                float f = wfrequencies[i];
                float p = wphases[i];
                float s = wsteepnesses[i];
                float a = wamplitudes[i];

                vec2 dir = normalize(vec2(wdirs[i*2], wdirs[i*2+1]));
                float dp = dot(dir, inputs.position.xy);

                // Gerstner Algorithm
                float wcos = cos(dp*f + p);
                float wsin = sin(dp*f + p);

                displaced.position.x += s * f_ * dir.x * wcos;
                displaced.position.y += s * f_ * dir.y * wcos;
                displaced.position.z += a * wsin;

                displaced.normal.x -= dir.x * f * a * wcos;
                displaced.normal.y -= dir.y * f * a * wcos;
                displaced.normal.z -= (s/float(wcount)) * wsin;
            }
            displaced.normal = normalize(displaced.normal);
            displaced.position.x /= float(wcount);
            displaced.position.y /= float(wcount);
            return displaced;
        }

    `
}


// Uses Gerstner Wave
function causticMaterial(){
    return new THREE.ShaderMaterial({
        glslVersion : THREE.GLSL3,
        uniforms: wavesToUniforms(),
        vertexShader: `
            ${getWaveSubShader(meta.mWaves)}
            varying vec3 oPosition;
            void main(){
                oPosition = vec3(position.x, position.z, 0.0);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            ${getWaveSubShader(meta.mWaves)}
            layout(location = 0) out vec4 tCaustics;
            varying vec3 oPosition;
            void main() {
                Displacement displaced = gerstner(Displacement(oPosition, vec3(0.,0.,1.)));
                
                // Calculate Transmition Ray

                // Closer angle to ground normal, means strong light. 

                tCaustics = vec4(displaced.normal, 1.0); 
            }
        `
    });
}

const passes = [
    // Wave displacement and Normals Generators
    {
        scene: new THREE.Scene(),
        camera : new THREE.OrthographicCamera(meta.oSize / -2, meta.oSize / 2, meta.oSize / 2, meta.oSize / -2, 0.1, 1000),
        ocean : undefined,
        init : function(){
            this.camera.position.z = 5; 
            this.camera.lookAt(new THREE.Vector3(0,0,0));
            this.ocean = new THREE.Mesh(geometries.ocean,
                new THREE.ShaderMaterial({
                    glslVersion : THREE.GLSL3,
                    side: THREE.DoubleSide,
                    uniforms: wavesToUniforms(),
                    vertexShader: `
                        ${getWaveSubShader(meta.mWaves)}
                        varying Displacement displaced;
                        varying vec3 oPosition;
                        void main(){
                            oPosition = position;
                            displaced = gerstner(Displacement(position, normal));   // Generate wave
                            displaced.normal = normal;      // We only need position
                            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                        }
                    `,
                    fragmentShader: `
                        ${getWaveSubShader(meta.mWaves)}
                        layout(location = 0) out vec4 tPosition;
                        layout(location = 1) out vec4 tNormal;

                        varying Displacement displaced;
                        varying vec3 oPosition;

                        void main() {
                            Displacement displaced = gerstner(Displacement(oPosition, displaced.normal));

                            tPosition = vec4(displaced.position, 1.0); 
                            tNormal = vec4(displaced.normal, 1.0); 
                        }
                    `
                })
            );
            this.scene.add(this.ocean);
        },
        resize: function() {
            return;
        },
        render: function() {
            renderer.setRenderTarget(renderTarget);
            renderer.render(this.scene, this.camera);
            renderer.setRenderTarget(null);
        },
        view: function(){
            renderer.render(this.scene, this.camera);
        },
        update : function(){
            this.ocean.material.uniforms.wphases.value = meta.waves.map((wave) => wave.speed * getTime() * Math.PI*2/wave.length);
        }
    },
    // Final Pass
    {
        scene: new THREE.Scene(),
        prescene: new THREE.Scene(),    // Used for Creating the Caustics only
        fsttarget: new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType, // Can use THREE.FloatType if higher precision is needed
            colorSpace: THREE.SRGBColorSpace,
            // encoding: THREE.sRGBEncoding,
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter,
            generateMipmaps: false
        }),
        sndtarget: new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType, // Can use THREE.FloatType if higher precision is needed
            colorSpace: THREE.SRGBColorSpace,
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter,
            generateMipmaps: false,
        }),
        postscene : new THREE.Scene(),
        composer : new EffectComposer(renderer),
        camera: new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 100),
        controls: undefined,
        water : undefined,
        skull: undefined,
        ground : undefined,
        lights: [],
        resize: function() {
            this.camera.aspect = window.innerWidth/window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.controls.update();
        },
        init : function (){
            this.camera.position.z = 5; this.camera.position.x = 0; this.camera.position.y = -1;
            this.controls = new OrbitControls(this.camera, renderer.domElement);
            this.controls.target = new THREE.Vector3(0,-3,0);
            this.controls.update();

            // Add background
            new EXRLoader().load('public/sunflowers_puresky_1k.exr', (texture) => {
                texture.mapping = THREE.EquirectangularReflectionMapping;
                this.scene.background = texture;
                this.scene.environment = texture;
                this.water.material.uniforms["envMap"].value = texture;
                this.water.material.needsUpdate = true;
                texture.dispose();
            })

            // Add skull
            gltfloader.load('public/mat_no_export_skull.glb', (mesh)=>{
                this.skull = mesh.scene;
                mesh.scene.position.y -= 3;
                mesh.scene.rotateX(-Math.PI/5);

                // Prescene 
                const cl = this.skull.clone();
                cl.traverse(child => {
                    if(child instanceof THREE.Mesh)
                        child.material = causticMaterial();
                })
                this.prescene.add(cl);

                textloader.load('public/Textures/diffuse_compressed.jpg', (colorText) => {
                    textloader.load('public/Textures/normals_compressed.jpg', (normalText) => {
                        colorText.colorSpace = THREE.SRGBColorSpace;
                        colorText.flipY = false; normalText.flipY = false;
                        this.scene.add(mesh.scene);
                        mesh.scene.traverse((child) => {
                            if(child instanceof THREE.Mesh){
                                child.material = new THREE.MeshStandardMaterial({
                                    map : colorText,
                                    side: THREE.DoubleSide,
                                    normalMap : normalText,
                                    roughness: 1,
                                    envMap: this.scene.background,
                                    envMapIntensity: 0.05
                                });
                                child.material.needsUpdate = true;
                            }
                        });
                    })
                })
            });

            // Add Ground
            gltfloader.load('public/ground/undersea.gltf', (mesh) => {
                this.ground = mesh.scene.children[0];
                this.ground.material.specularIntensity = 0;
                this.ground.position.y -= 3.55;
                this.scene.fog = new THREE.FogExp2( new THREE.Color(0.0, 0.05, 0.25), 0.06 );
                this.ground.material.side = THREE.FrontSide;
                this.ground.material.envMap = this.scene.background;
                this.ground.material.envMapIntensity = 0.2;
                this.scene.add(this.ground);

                // Prescene 
                const cl = this.ground.clone();
                cl.material = causticMaterial();
                this.prescene.add(cl);
            })

            // Add lights
            let l = new THREE.PointLight(0xffffff, 300);
            l.position.y = 10; l.position.x = 10; l.position.z = 10;
            
            l.lookAt(new THREE.Vector3(0,0,0));
            this.scene.add(l);
            this.lights.push(l);
            const envmap = this.scene.background;
            // Add Water surface
            this.water = new THREE.Mesh(
                geometries.ocean.clone().rotateX(Math.PI/2),
                new THREE.ShaderMaterial({
                    side : THREE.DoubleSide,
                    uniforms: {
                        roughness : {value: 0.05},
                        color : {value : new THREE.Color(0.0, 0.1, 0.23)},
                        tPosition: { value: renderTarget.textures[0] },
                        tNormal: { value: renderTarget.textures[1] },
                        lights: {value: this.lights.flatMap(l => [l.position.x, l.position.y, l.position.z])},
                        lcolors: {value: this.lights.flatMap(l => [l.color.r, l.color.g, l.color.b])},
                        lintinsity: {value: this.lights.map(l => l.intensity)},
                        envMap: {value: undefined},
                    },
                    transparent: true,
                    vertexShader: `
                        uniform sampler2D tPosition;
                        uniform sampler2D tNormal;    
                        varying vec3 wPos; // World position
                        varying vec2 vUv;
                        varying vec3 oNorm;
                        void main() {
                            vec3 nPos = texture(tPosition, uv).xzy + position.xyz; 
                            wPos = (modelMatrix * vec4(nPos, 1.0)).xyz;
                            vUv = uv;
                            oNorm = normal;
                            gl_Position = projectionMatrix * modelViewMatrix * vec4(nPos, 1.0);
                        }
                    `,
                    fragmentShader: `
                        precision highp float;
                        precision highp int;

                        uniform sampler2D envMap;
                        uniform sampler2D tNormal;
                        uniform vec3 color;             // Surface Diffuse color
                        uniform float roughness;        // surface roughness
                        uniform mat4 modelMatrix;

                        uniform float lights[${this.lights.length * 3}];       // Directional Lights
                        uniform float lcolors[${this.lights.length * 3}];       // Lights Colors
                        uniform float lintinsity[${this.lights.length}];       // Lights Colors
                        
                        varying vec3 wPos;
                        varying vec2 vUv;
                        varying vec3 oNorm;

                        vec2 directionToEquirectUV(vec3 dir) {
                            // Normalize the input direction vector
                            dir = normalize(dir);

                            // Calculate the longitude and latitude angles
                            float longitude = atan(dir.z, dir.x);
                            float latitude = asin(dir.y);

                            // Map the angles to UV coordinates
                            vec2 uv;
                            uv.x = (longitude / (2.0 * 3.1415926535)) + 0.5; // Map to [0, 1]
                            uv.y = (latitude / 3.1415926535) + 0.5; // Map to [0, 1]

                            return uv;
                        }


                        void main() {
                            vec3 nNor = texture(tNormal, vUv).xzy;
                            vec3 wNor = normalize(transpose(inverse(mat3(modelMatrix))) * nNor);

                            vec3 I = normalize( cameraPosition - wPos);
                            float IN = dot(wNor, I);
                            vec3 R = normalize(reflect(-I, wNor));
                            vec3 H = normalize(I + R);
                        
                            vec2 uv = directionToEquirectUV(R);

                            vec3 diffuse = vec3(0.);
                            vec3 spec = vec3(0.);
                            float fresnel = 0.; 
                            if(IN > 0.){
                                fresnel = pow(1.0 - max(IN, 0.0), 5.0);
                                }
                            
                            vec3 Lc = texture(envMap, uv).rgb;
                            diffuse += max(dot(wNor, normalize(R)), 0.0);
                            spec += Lc * pow(max(dot(wNor, H), 0.0), 1.0 / roughness);
                            // for(int i = 0; i < ${this.lights.length}; i++){
                            //     vec3 L = vec3(0.);
                            //     L.x = lights[i*3];
                            //     L.y = lights[i*3+1];
                            //     L.z = lights[i*3+2];
                            //     vec3 Lc = vec3(0.);
                            //     Lc.x = lcolors[i*3];
                            //     Lc.y = lcolors[i*3+1];
                            //     Lc.z = lcolors[i*3+2];
                                
                            //     vec3 L_ =  L - wPos;
                            //     vec3 H = normalize(I + L_);
                                
                            //     diffuse += max(dot(wNor, normalize(L_)), 0.0) * lintinsity[i] / pow(length(L_),2.) ;
                            //     spec += Lc * pow(max(dot(wNor, H), 0.0), 1.0 / roughness);
                            // }
                            vec3 L_ = diffuse*color +  spec * fresnel;
                            gl_FragColor = vec4(L_, 0.6);
                        }
                    `
                })
            );
            this.scene.add(this.water);
            
            // Playing with composer
            this.composer.addPass( new RenderPass( this.scene, this.camera ) );
            const effect1 = new ShaderPass( new THREE.ShaderMaterial({
                uniforms: {
                  mask: { value: this.fsttarget.textures[0] },
                  tDiffuse: {value: this.sndtarget.textures[0] },
                  a: { value: 1.0 }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = vec4(position,1.0);
                    }
                `,
                fragmentShader: `
                    precision mediump float;
                    precision mediump int;
                    
                    uniform sampler2D mask;
                    uniform sampler2D tDiffuse;
                    uniform float a;
                    varying vec2 vUv;
                    void main() {
                        vec4 original = texture2D(mask, vUv);
                        vec4 blend = texture(tDiffuse, vUv);
                        gl_FragColor = mix(original, blend, a);
                    }
                `
              }), this.sndtarget.textures[0]);
            this.composer.addPass( effect1 );
            
            const gammaCorrectionPass = new ShaderPass(GammaCorrectionShader);  
            this.composer.addPass(gammaCorrectionPass);
        },
        update: function (){
            this.prescene.traverse(child => {
                if(child.material && child.material.uniforms?.wphases)
                    child.material.uniforms.wphases.value = meta.waves.map((wave) => wave.speed * getTime() * Math.PI*2/wave.length);
            })
            this.controls.update();
        },
        _fstrender:function(){
            renderer.setRenderTarget(this.fsttarget);
            renderer.setClearColor(0x000000, 1.0);
            renderer.render(this.prescene, this.camera);
            renderer.setRenderTarget(null);
        },
        _sndrender: function() {
            renderer.setRenderTarget(this.sndtarget);
            renderer.render(this.scene, this.camera);
            renderer.setRenderTarget(null);
        },
        render : function (){
            this._fstrender();
            this._sndrender();
            this.composer.render(renderer);
        }
    }
]

window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    passes.forEach(pass => pass.resize());
});

// Rendering
passes.forEach(pass => pass.init());
const animate = () => {
    requestAnimationFrame(animate);
    passes.forEach((pass) => {pass.update(); pass.render();});
}

animate();