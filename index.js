import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; 
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; 

// Variables
const meta = {
    wmSize: 512,        // Wave maps size (normal and displacement maps)
    oSize: 10,          // Ocean size (threejs units)
    oSegments: 20,      // Ocean segments 
    mWaves : 5,         // Max waves (used to define the shaders)
    waves : [           // Waves parameters.
        {
            length: 5,
            amplitude: 0.5,
            speed: 1,
            angle: 0,
            steepness: 0.2,
        }
    ]
}


// THREEJS
const renderer = new THREE.WebGLRenderer();
if(!renderer.capabilities.isWebGL2){
    console.error("Your browser doesn't support the correct webgl version");
}
renderer.setSize(window.innerWidth, window.innerHeight);
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
    return performance.now() / 2000;
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
        camera: new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 1000),
        controls: undefined,
        water : undefined,
        skull: undefined,
        lights: [],
        resize: function() {
            this.camera.aspect = window.innerWidth/window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.controls.update();
        },
        init : function (){
            this.camera.position.z = 3; this.camera.position.x = -1; this.camera.position.y = 1;
            this.camera.lookAt(new THREE.Vector3(0,0,0));
            this.controls = new OrbitControls(this.camera, renderer.domElement);
            this.controls.update();

            // Add skull
            gltfloader.load('public/mat_no_export_skull.glb', (mesh)=>{
                this.skull = mesh.scene;
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
                                    roughness: 0,
                                });
                                child.material.needsUpdate = true;
                            }
                        });
                    })
                })
            });

            // Add lights
            let l = new THREE.DirectionalLight(0xff5f5f, 1);
            l.position.y = 5; l.position.x = 5; l.position.z = 5;
            l.lookAt(new THREE.Vector3(0,0,0));
            this.scene.add(l);
            this.lights.push(l);

            l = new THREE.DirectionalLight(0x1f1fff, 1);
            l.position.y = -5; l.position.x = -5; l.position.z = -5;
            l.lookAt(new THREE.Vector3(0,0,0));
            this.scene.add(l);
            this.lights.push(l);

            // Add Water surface
            this.water = new THREE.Mesh(
                geometries.ocean,
                new THREE.ShaderMaterial({
                    side : THREE.DoubleSide,
                    uniforms: {
                        roughness : {value: 0.8},
                        color : {value : new THREE.Color(0.0, 0.35, 0.73)},
                        envMap : {value : passes[1].scene.background},
                        tPosition: { value: renderTarget.textures[0] },  // Ocean Positions
                        tNormal: { value: renderTarget.textures[1] },     // Ocean Normals
                        lights: {value: this.lights.flatMap(l => [l.position.x, l.position.z, l.position.y])},
                        lcolors: {value: this.lights.flatMap(l => [l.color.r, l.color.g, l.color.b])}

                    },
                    vertexShader: `
                        uniform sampler2D tPosition;
                        uniform sampler2D tNormal;    
                        varying vec3 wPos; // World position
                        varying vec2 vUv;

                        void main() {
                            vec3 nPos = texture(tPosition, uv).xyz + position.xyz; 
                            wPos = (modelMatrix * vec4(nPos, 1.0)).xyz;
                            vUv = uv;
                            gl_Position = projectionMatrix * modelViewMatrix * vec4(nPos, 1.0);
                        }
                    `,
                    fragmentShader: `
                        precision highp float;
                        precision highp int;
                        // layout(location = 0) out vec4 pc_FragColor;

                        uniform sampler2D envMap;
                        uniform sampler2D tNormal;
                        uniform vec3 color;             // Surface Diffuse color
                        uniform float roughness;        // surface roughness
                        uniform mat4 modelMatrix;
                        uniform float lights[${this.lights.length * 3}];       // Directional Lights
                        uniform float lcolors[${this.lights.length * 3}];       // Lights Colors
                        
                        varying vec3 wPos;
                        varying vec2 vUv;

                        void main() {
                            vec3 nNor = texture(tNormal, vUv).xyz;
                            vec3 wNor = transpose(inverse(mat3(modelMatrix))) * nNor;

                            vec3 I = normalize(wPos - cameraPosition);
                            vec3 R = reflect(I, normalize(wNor));
                            vec3 H = normalize(I + R);

                            vec3 diff = color;
                            float diffuse = 0.;
                            for(int i = 0; i < ${this.lights.length}; i++){
                                vec3 L = vec3(0.);
                                L.x = lights[i*3];
                                L.y = lights[i*3+1];
                                L.z = lights[i*3+2];

                                vec3 Lc = vec3(0.);
                                Lc.x = lcolors[i*3];
                                Lc.y = lcolors[i*3+1];
                                Lc.z = lcolors[i*3+2];

                                diffuse += max(dot(wNor, wPos - L), 0.0);
                            }                         

                            float spec = pow(max(dot(wNor, H), 0.0), 1.0 / roughness);
                            float fresnel = pow(1.0 - max(dot(wNor, I), 0.0), 5.0);

                            // Combine diffuse and specular components
                            vec3 L_ = diff; //+  spec * fresnel;

                            // vec3 L = color/PI + L_*(1.0 - roughness);
                            gl_FragColor = vec4(vec3(diffuse), 1.0);
                        }
                    `
                    
                })
            );

            this.scene.add(this.water);

        },
        update: function (){
            this.controls.update();
        },
        render : function (){
            renderer.render(this.scene, this.camera);
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