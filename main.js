import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SDFEngine, SHAPE_TYPES, OPERATIONS } from './src/SDFEngine.js';
import { EditorUI } from './src/UI.js';

// --- Scene Setup ---
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0)); // Limit pixel ratio for perf

const scene = new THREE.Scene();

// We use a dummy camera for controls, but the shader calculates the real rays
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 4, 8);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 1, 0);

// --- SDF Engine Init ---
const sdfEngine = new SDFEngine(renderer, scene, camera);

// --- UI Init ---
const ui = new EditorUI(sdfEngine);

// --- Initial Scene Content ---
// Create a nice starter scene with merged geometry
sdfEngine.addShape({
    type: SHAPE_TYPES.SPHERE,
    position: new THREE.Vector3(0, 1, 0),
    size: new THREE.Vector3(1, 0, 0),
    color: new THREE.Vector3(0.2, 0.8, 1.0),
    blend: 0.6
});

sdfEngine.addShape({
    type: SHAPE_TYPES.BOX,
    position: new THREE.Vector3(1.5, 0.5, 0),
    size: new THREE.Vector3(0.8, 0.8, 0.8),
    color: new THREE.Vector3(1.0, 0.4, 0.2),
    blend: 0.8
});

// A subtraction example (Carving)
sdfEngine.addShape({
    type: SHAPE_TYPES.SPHERE,
    position: new THREE.Vector3(1.8, 1.2, 0.5),
    size: new THREE.Vector3(0.6, 0, 0),
    color: new THREE.Vector3(1, 1, 1),
    blend: 0.2,
    operation: OPERATIONS.SUBTRACT
});

// Manually init UI for these shapes (a bit hacky but works for init)
sdfEngine.shapes.forEach(s => ui.createShapeControl(s));

// --- Resize Handler ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    sdfEngine.resize();
});

// --- Loop ---
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    
    const time = clock.getElapsedTime();
    controls.update();
    
    sdfEngine.update(time);
    
    // We don't use standard render(scene, camera) because we are drawing a fullscreen quad
    // The quad is in the scene, so we render the scene, but the logic is all in the fragment shader
    renderer.render(scene, camera);
}

animate();