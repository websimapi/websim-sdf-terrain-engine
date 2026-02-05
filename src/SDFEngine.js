import * as THREE from 'three';
import { vertexShader, fragmentShader } from './shaders.js';

const MAX_SHAPES = 16;

export const SHAPE_TYPES = {
    SPHERE: 0,
    BOX: 1,
    TORUS: 2
};

export const OPERATIONS = {
    UNION: 0,
    SUBTRACT: 1,
    INTERSECT: 2 // Or simple union without blend
};

export class SDFEngine {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.shapes = [];

        // Uniforms structure
        this.uniforms = {
            uTime: { value: 0 },
            uResolution: { value: new THREE.Vector2() },
            uCamPos: { value: new THREE.Vector3() },
            uCamDir: { value: new THREE.Vector3() },
            uCamUp: { value: new THREE.Vector3(0, 1, 0) },
            uFov: { value: 45 },
            uShapeCount: { value: 0 },
            uShapes: { value: this._createEmptyShapesArray() }
        };

        // Create the screen quad
        // Using PlaneGeometry(2,2) with a vertex shader that forces it to fill screen
        const geometry = new THREE.PlaneGeometry(2, 2);
        this.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: this.uniforms,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide // Ensure it renders regardless of winding
        });

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.frustumCulled = false; 
        this.mesh.renderOrder = -999; // Ensure it's drawn behind everything else (like Gizmos)
        this.scene.add(this.mesh);

        // Debug Helper: Axes only (Removed GridHelper as it conflicts with SDF terrain visuals)
        const axes = new THREE.AxesHelper(5);
        this.scene.add(axes);

        // Initial Setup
        this.resize();
    }

    _createEmptyShapesArray() {
        const arr = [];
        for (let i = 0; i < MAX_SHAPES; i++) {
            arr.push({
                type: 0,
                position: new THREE.Vector3(),
                size: new THREE.Vector3(1, 1, 1),
                color: new THREE.Vector3(1, 1, 1),
                blend: 0.2,
                operation: 0,
                active: 0
            });
        }
        return arr;
    }

    addShape(config = {}) {
        if (this.shapes.length >= MAX_SHAPES) {
            console.warn("Max shapes reached");
            return null;
        }

        const shape = {
            id: Math.random().toString(36).substr(2, 9),
            type: config.type ?? SHAPE_TYPES.SPHERE,
            position: config.position ? config.position.clone() : new THREE.Vector3(0, 0, 0),
            size: config.size ? config.size.clone() : new THREE.Vector3(1, 1, 1),
            color: config.color ? config.color.clone() : new THREE.Vector3(1, 0, 0.5),
            blend: config.blend ?? 0.5,
            operation: config.operation ?? OPERATIONS.UNION,
            active: 1,
            // Physics Props
            physics: false,
            velocity: new THREE.Vector3(0, 0, 0),
            mass: 1.0,
            restitution: 0.6 // Bounciness
        };

        this.shapes.push(shape);
        this.updateUniforms();
        return shape;
    }

    removeShape(id) {
        this.shapes = this.shapes.filter(s => s.id !== id);
        this.updateUniforms();
    }

    updateUniforms() {
        // Map JS shapes to Uniform structure
        this.uniforms.uShapeCount.value = this.shapes.length;
        
        for (let i = 0; i < MAX_SHAPES; i++) {
            const uniformShape = this.uniforms.uShapes.value[i];
            
            if (i < this.shapes.length) {
                const s = this.shapes[i];
                uniformShape.type = s.type;
                uniformShape.position.copy(s.position);
                uniformShape.size.copy(s.size);
                uniformShape.color.copy(s.color);
                uniformShape.blend = s.blend;
                uniformShape.operation = s.operation;
                uniformShape.active = 1;
            } else {
                uniformShape.active = 0;
            }
        }
    }

    update(time, deltaTime) {
        this.uniforms.uTime.value = time;
        
        // Physics Loop
        const gravity = -9.8;
        const floorY = -2.0;

        for (const shape of this.shapes) {
            if (shape.physics) {
                // Gravity
                shape.velocity.y += gravity * deltaTime;
                
                // Integrate Position
                shape.position.x += shape.velocity.x * deltaTime;
                shape.position.y += shape.velocity.y * deltaTime;
                shape.position.z += shape.velocity.z * deltaTime;

                // Simple Floor Collision (based on our flat workspace terrain)
                // Approximate size collision (sphere radius or box half-height)
                let bottomOffset = 0;
                if(shape.type === SHAPE_TYPES.SPHERE) bottomOffset = shape.size.x;
                else if(shape.type === SHAPE_TYPES.BOX) bottomOffset = shape.size.y;
                else if(shape.type === SHAPE_TYPES.TORUS) bottomOffset = shape.size.y; // torus tube radius

                if (shape.position.y - bottomOffset < floorY) {
                    shape.position.y = floorY + bottomOffset;
                    shape.velocity.y *= -shape.restitution;
                    
                    // Friction
                    shape.velocity.x *= 0.95;
                    shape.velocity.z *= 0.95;
                }
            }
        }
        
        // Only update uniforms if physics ran or something changed
        // For simplicity, we update every frame if physics is active on any shape
        if (this.shapes.some(s => s.physics)) {
            this.updateUniforms();
        }

        // Sync camera for raymarching
        this.uniforms.uCamPos.value.copy(this.camera.position);
        
        // Get camera direction
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        this.uniforms.uCamDir.value.copy(this.camera.position).add(dir);
        
        this.uniforms.uFov.value = this.camera.fov;
    }

    resize() {
        this.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    }
}