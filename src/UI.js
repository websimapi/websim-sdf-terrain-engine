import GUI from 'lil-gui';
import { SHAPE_TYPES, OPERATIONS } from './SDFEngine.js';
import * as THREE from 'three';

export class EditorUI {
    constructor(engine) {
        this.engine = engine;
        this.gui = new GUI({ title: 'SDF Terrain Editor' });
        this.shapeFolders = {};

        // General settings
        const settings = {
            addSphere: () => this.addRandomShape(SHAPE_TYPES.SPHERE),
            addBox: () => this.addRandomShape(SHAPE_TYPES.BOX),
            addTorus: () => this.addRandomShape(SHAPE_TYPES.TORUS),
        };

        this.gui.add(settings, 'addSphere').name('+ Add Sphere');
        this.gui.add(settings, 'addBox').name('+ Add Box');
        this.gui.add(settings, 'addTorus').name('+ Add Torus');
        
        this.listFolder = this.gui.addFolder('Shapes');
        
        // Debug folder
        const debug = this.gui.addFolder('Debug');
        debug.add(this.engine.mesh, 'visible').name('Toggle SDF Render');
    }

    addRandomShape(type) {
        // Generate a position slightly in front of where camera might be looking or random
        const pos = new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            0.5 + Math.random() * 2,
            (Math.random() - 0.5) * 4
        );
        
        const shape = this.engine.addShape({
            type: type,
            position: pos,
            color: new THREE.Vector3(Math.random(), Math.random(), Math.random())
        });

        if(shape) this.createShapeControl(shape);
    }

    createShapeControl(shape) {
        const folder = this.listFolder.addFolder(`${this.getShapeName(shape.type)}`);
        
        const params = {
            x: shape.position.x,
            y: shape.position.y,
            z: shape.position.z,
            s1: shape.size.x,
            s2: shape.size.y,
            s3: shape.size.z,
            col: { r: shape.color.x, g: shape.color.y, b: shape.color.z },
            blend: shape.blend,
            op: shape.operation,
            delete: () => {
                this.engine.removeShape(shape.id);
                folder.destroy();
                this.engine.updateUniforms();
            }
        };

        // Position
        folder.add(params, 'x', -10, 10).onChange(v => { shape.position.x = v; this.engine.updateUniforms(); });
        folder.add(params, 'y', -2, 10).onChange(v => { shape.position.y = v; this.engine.updateUniforms(); });
        folder.add(params, 'z', -10, 10).onChange(v => { shape.position.z = v; this.engine.updateUniforms(); });

        // Size
        const sizeFolder = folder.addFolder('Size');
        sizeFolder.add(params, 's1', 0.1, 5).name('X / Radius').onChange(v => { shape.size.x = v; this.engine.updateUniforms(); });
        if(shape.type === SHAPE_TYPES.BOX || shape.type === SHAPE_TYPES.TORUS) {
            sizeFolder.add(params, 's2', 0.1, 5).name('Y / Thickness').onChange(v => { shape.size.y = v; this.engine.updateUniforms(); });
        }
        if(shape.type === SHAPE_TYPES.BOX) {
            sizeFolder.add(params, 's3', 0.1, 5).name('Z').onChange(v => { shape.size.z = v; this.engine.updateUniforms(); });
        }

        // Appearance
        folder.addColor(params, 'col').name('Color').onChange(v => { 
            shape.color.set(v.r, v.g, v.b); 
            this.engine.updateUniforms(); 
        });

        folder.add(params, 'blend', 0.0, 2.0).name('Smoothness').onChange(v => { 
            shape.blend = v; 
            this.engine.updateUniforms(); 
        });

        folder.add(params, 'op', { 'Merge (Add)': 0, 'Carve (Sub)': 1, 'Intersect': 2 }).name('Operation').onChange(v => {
            shape.operation = parseInt(v);
            this.engine.updateUniforms();
        });

        folder.add(params, 'delete').name('DELETE SHAPE');
    }

    getShapeName(type) {
        return Object.keys(SHAPE_TYPES).find(key => SHAPE_TYPES[key] === type) || 'Shape';
    }
}