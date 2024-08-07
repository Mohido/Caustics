import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; 
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; 


const renderer = new THREE.WebGLRenderer();
if(!renderer.capabilities.isWebGL2){
    console.error("Your browser doesn't support the correct webgl version");
}
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);


const gltfloader = new GLTFLoader();
const textloader = new THREE.TextureLoader();

const passes = [
    {
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 1000),
        controls: undefined,
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

            let l = new THREE.DirectionalLight(0xff5f5f, 1);
            l.position.y = 5; l.position.x = 5; l.position.z = 5;
            l.lookAt(new THREE.Vector3(0,0,0));
            this.scene.add(l);

            l = new THREE.DirectionalLight(0x1f1fff, 1);
            l.position.y = -5; l.position.x = -5; l.position.z = -5;
            l.lookAt(new THREE.Vector3(0,0,0));
            this.scene.add(l);
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