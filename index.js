import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; 
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; 
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'; 
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Variables
const meta = {
    mWaves : 10,
    waves : [
        {
            length: 2,
            amplitude: 0.2,
            speed: 1,
            angle: 0,
            steepness: 0,
        },
        {
            length: 4,
            amplitude: 0.4,
            speed: 1,
            angle: 90,
            steepness: 1,
        },
        {
            length: 1,
            amplitude: 0.1,
            speed: 0.5,
            angle: 45,
            steepness: 0,
        },
        {
            length: 0.8,
            amplitude: 0.008,
            speed: 0.1,
            angle: 200,
            steepness: 0
        },
        {
            length: 1,
            amplitude: 0.01,
            speed: 0.3,
            angle: 120,
            steepness: 0
        }        
    ]
}

// Initializing the renderer
const renderer = new THREE.WebGLRenderer({antialias: true});
if(!renderer.capabilities.isWebGL2){
    console.error("Your browser doesn't support the correct webgl version");
}
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// init scene and camera
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2( new THREE.Color(0.0, 0.05, 0.15), 0.2 );
const camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 100);
camera.position.z = 3; camera.position.x = 0; camera.position.y = 0.5;

// provide mouse inputs to camera
const controls = new OrbitControls(camera, renderer.domElement);
controls.target = new THREE.Vector3(0,-1,0);
controls.update();

// Define Multipass renderer
const composer = new EffectComposer(renderer);
const crp = new RenderPass(scene, camera);
composer.addPass(crp);

// Add background
const exrLoader = new EXRLoader();
exrLoader.load('public/sunflowers_puresky_1k.exr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
    texture.dispose();
})

// Add meshes and passes
const gltfloader = new GLTFLoader();
gltfloader.load('public/scene.glb', (data) => {
    data.scene.traverse(function (object) {
        object.isMesh && (object.material.side = THREE.FrontSide);  // Don't render both sides.
    });
    scene.add(data.scene);
});

// Helper Functions
function getTime() {
    return performance.now() / 3000;
}

// Transform wave data
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


// Gerstner Wave subshader Shader
function gerstnerWaveSubShader(mwaves) {
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


// Caustics Full Material
const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
function causticMaterial(){
    return new THREE.ShaderMaterial({
        glslVersion : THREE.GLSL3,
        uniforms: {...wavesToUniforms(), tDiffuse: {value: renderTarget.texture}},
        vertexShader: `
            ${gerstnerWaveSubShader(meta.mWaves)}
            varying vec3 oPosition;
            varying vec3 wPosition;
            void main(){
                wPosition = vec4(modelMatrix * vec4(position,1.)).xzy;
                oPosition = position.xzy;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            ${gerstnerWaveSubShader(meta.mWaves)}
            uniform sampler2D tDiffuse;
            layout(location = 0) out vec4 fragColor;

            varying vec3 oPosition;
            varying vec3 wPosition;
            varying vec2 vUv;
            
            float line_plane_intercept(vec3 lineP, vec3 lineN, vec3 planeN, float planeD) {
                return (planeD - dot(planeN, lineP)) / dot(lineN, planeN);
            }

            float snell_caustics(float close, vec3 N, float Ior){
                vec3 E = vec3(0.,0.,1.); // Using Snell's law of refraction
                float EN = dot(E, N);
                vec3 T = N * (Ior * EN + sqrt(1.+Ior*Ior*(EN*EN - 1.))) + Ior * E;      // From Foley et al. transmission ray calculation
                return dot(normalize(T), vec3(0.,0.,1.)) - close;
            }

            float dist_caustics(vec3 N, vec3 P, float l, float h , float depth){
                float dist =  line_plane_intercept( P, -N, vec3(0., 0., 1.), depth);    // Gets the distance from wave normal to the ground point
                return (clamp(dist, l, h) - l) / (h - l);
            }

            void main() {
                Displacement displaced = gerstner(Displacement(oPosition, vec3(0.,0.,1.)));

                // Wave position in world space
                vec3 wpos = wPosition;
                wpos.z = displaced.position.z;
                float depth = abs(wPosition.z) + wpos.z;

                // Use Snell law
                // float sc = snell_caustics(0.95, displaced.normal, 1./1.33);
                // fragColor  = vec4(vec3(sc)*5., 1.0);

                // Or use the distance model
                float dc = 0.2 - dist_caustics(displaced.normal, wpos,  depth, depth + 1., wPosition.z);
                fragColor = vec4(vec3(dc), 1.0);
            }
        `
    });
}
const caustics = causticMaterial();


// Setting Up Composer to Render Scene, blend caustics, correct Gama output
composer.addPass(new ShaderPass(new THREE.ShaderMaterial({
    glslVersion : THREE.GLSL3,
    uniforms: {tDiffuse : {value: null}, tCaustics: {value: renderTarget.texture}},
    vertexShader: `
        varying vec2 vUv;
        void main(){
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tCaustics;
        uniform sampler2D tDiffuse;

        varying vec2 vUv;
        layout(location = 0) out vec4 pc_FragColor;
        void main(){
            pc_FragColor =  texture(tCaustics, vUv) + texture(tDiffuse, vUv);
        }
    `
})));

// Animation loop
composer.addPass(new OutputPass());

function animate() {
    // Updating
    controls.update();
    
    // Rendering caustics to texture
    caustics.uniforms.wphases.value = meta.waves.map((wave) => wave.speed * getTime() * Math.PI*2/wave.length);
    renderer.setRenderTarget(renderTarget);
    scene.overrideMaterial = caustics;
    renderer.render(scene,camera);
    renderer.setRenderTarget(null);
    scene.overrideMaterial = null;

    // Render scene and blend texture
    composer.render();
    requestAnimationFrame(animate);
}

animate();

// Events
window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderTarget.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    controls.update();
    composer.setSize(window.innerWidth, window.innerHeight );
})

