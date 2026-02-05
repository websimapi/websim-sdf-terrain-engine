export const vertexShader = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
    }
`;

export const fragmentShader = /* glsl */`
    precision highp float;

    uniform vec2 uResolution;
    uniform float uTime;
    
    // Camera
    uniform vec3 uCamPos;
    uniform vec3 uCamDir;
    uniform vec3 uCamUp;
    uniform float uFov;

    // SDF Data
    #define MAX_SHAPES 32
    struct Shape {
        int type;       // 0: Sphere, 1: Box, 2: Torus, 3: Plane
        vec3 position;
        vec3 size;      // x=radius/width, y=height, z=depth (context dependent)
        vec3 color;
        float blend;    // Smoothness factor
        int operation;  // 0: Union, 1: Subtract, 2: Intersect
        bool active;
    };

    uniform Shape uShapes[MAX_SHAPES];
    uniform int uShapeCount;

    // --- SDF Primitives ---

    float sdSphere(vec3 p, float s) {
        return length(p) - s;
    }

    float sdBox(vec3 p, vec3 b) {
        vec3 q = abs(p) - b;
        return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
    }

    float sdTorus(vec3 p, vec2 t) {
        vec2 q = vec2(length(p.xz) - t.x, p.y);
        return length(q) - t.y;
    }

    float sdPlane(vec3 p, vec3 n, float h) {
        // n must be normalized
        return dot(p, n) + h;
    }

    // --- Boolean Operations with Material Mixing ---

    // Returns vec4(dist, color.r, color.g, color.b)
    vec4 opSmoothUnion(vec4 d1, vec4 d2, float k) {
        float h = clamp(0.5 + 0.5 * (d2.x - d1.x) / k, 0.0, 1.0);
        float dist = mix(d2.x, d1.x, h) - k * h * (1.0 - h);
        vec3 color = mix(d2.yzw, d1.yzw, h);
        return vec4(dist, color);
    }

    vec4 opSmoothSubtraction(vec4 d1, vec4 d2, float k) {
        // Subtract d1 from d2
        float h = clamp(0.5 - 0.5 * (d2.x + d1.x) / k, 0.0, 1.0);
        float dist = mix(d2.x, -d1.x, h) + k * h * (1.0 - h);
        // During subtraction, we usually keep the color of the object being cut into (d2)
        // creating a "core" color effect slightly at the boundary
        vec3 color = mix(d2.yzw, d1.yzw, h); 
        return vec4(dist, color);
    }
    
    vec4 opUnion(vec4 d1, vec4 d2) {
        return (d1.x < d2.x) ? d1 : d2;
    }

    // --- The Map (Scene Definition) ---

    vec4 map(vec3 p) {
        // Initialize with a far distance
        vec4 res = vec4(1000.0, 0.0, 0.0, 0.0); // dist, r, g, b
        
        // Add a base floor plane
        float dPlane = p.y + 1.0; 
        
        // Grid pattern for floor
        vec3 floorCol = (mod(floor(p.x) + floor(p.z), 2.0) == 0.0) 
            ? vec3(0.15) 
            : vec3(0.1);
        
        res = vec4(dPlane, floorCol);

        for(int i = 0; i < MAX_SHAPES; i++) {
            if(i >= uShapeCount) break;
            if(!uShapes[i].active) continue;

            vec3 localP = p - uShapes[i].position;
            float d = 0.0;

            if(uShapes[i].type == 0) {
                d = sdSphere(localP, uShapes[i].size.x);
            } else if (uShapes[i].type == 1) {
                d = sdBox(localP, uShapes[i].size);
            } else if (uShapes[i].type == 2) {
                d = sdTorus(localP, uShapes[i].size.xy);
            }

            vec4 shapeRes = vec4(d, uShapes[i].color);
            float k = uShapes[i].blend;

            if(uShapes[i].operation == 0) {
                 res = opSmoothUnion(res, shapeRes, k);
            } else if(uShapes[i].operation == 1) {
                // Subtract this shape FROM the scene
                res = opSmoothSubtraction(shapeRes, res, k);
            } else {
                res = opUnion(res, shapeRes);
            }
        }

        return res;
    }

    // --- Raymarching ---

    vec3 calcNormal(vec3 p) {
        const float h = 0.001;
        const vec2 k = vec2(1, -1);
        return normalize(
            k.xyy * map(p + k.xyy * h).x +
            k.yyx * map(p + k.yyx * h).x +
            k.yxy * map(p + k.yxy * h).x +
            k.xxx * map(p + k.xxx * h).x
        );
    }

    // Soft shadows
    float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
        float res = 1.0;
        float t = mint;
        for(int i = 0; i < 32; i++) { // Fewer steps for shadow for perf
            float h = map(ro + rd * t).x;
            if( h < 0.001 ) return 0.0;
            res = min(res, k * h / t);
            t += h;
            if(t > maxt) break;
        }
        return res;
    }

    void main() {
        // Setup ray for full screen quad
        vec2 screenPos = (vUv - 0.5) * 2.0;
        screenPos.x *= uResolution.x / uResolution.y;

        vec3 ro = uCamPos;
        vec3 forward = normalize(uCamDir - uCamPos);
        vec3 right = normalize(cross(forward, uCamUp));
        vec3 up = cross(right, forward);
        
        // Ray direction based on FOV
        float fovScale = tan(uFov * 0.5 * 3.14159 / 180.0);
        vec3 rd = normalize(forward + (screenPos.x * right + screenPos.y * up) * fovScale);

        // March
        float t = 0.0;
        float maxDist = 100.0;
        vec4 res = vec4(-1.0);
        
        int steps = 0;
        for(int i = 0; i < 128; i++) {
            vec3 p = ro + rd * t;
            res = map(p);
            if(abs(res.x) < 0.001 || t > maxDist) break;
            t += res.x;
            steps++;
        }

        vec3 col = vec3(0.05, 0.08, 0.1); // Background / Fog

        if(t < maxDist) {
            vec3 p = ro + rd * t;
            vec3 n = calcNormal(p);
            vec3 mate = res.yzw; // Material color

            // Lighting
            vec3 sunDir = normalize(vec3(0.8, 0.4, 0.2));
            float sunDif = clamp(dot(n, sunDir), 0.0, 1.0);
            float sunSha = softShadow(p + n * 0.01, sunDir, 0.02, 5.0, 16.0);
            
            vec3 skyDir = vec3(0.0, 1.0, 0.0);
            float skyDif = clamp(0.5 + 0.5 * dot(n, skyDir), 0.0, 1.0);
            
            vec3 lin = vec3(0.0);
            lin += 1.2 * sunDif * vec3(1.0, 0.9, 0.7) * sunSha;
            lin += 0.3 * skyDif * vec3(0.5, 0.7, 1.0);
            
            col = mate * lin;
            
            // Fog
            col = mix(col, vec3(0.05, 0.08, 0.1), 1.0 - exp(-0.02 * t));
        }

        // Gamma correction
        col = pow(col, vec3(0.4545));

        gl_FragColor = vec4(col, 1.0);
    }
`;