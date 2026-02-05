export const vertexShader = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        // Use standard clip space quad logic.
        // We assume the geometry is a plane from -1 to 1 in XY
        gl_Position = vec4(position.xy, 1.0, 1.0); // Z=1.0 puts it at the far plane
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
    #define MAX_SHAPES 16
    struct Shape {
        int type;       // 0: Sphere, 1: Box, 2: Torus
        vec3 position;
        vec3 size;      // x=radius/width, y=height, z=depth
        vec3 color;
        float blend;    // Smoothness factor
        int operation;  // 0: Union, 1: Subtract, 2: Intersect
        int active;     // Changed to int for robustness
    };

    uniform Shape uShapes[MAX_SHAPES];
    uniform int uShapeCount;

    // --- Noise & Terrain Functions ---

    // 2D Random
    float random (in vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    // 2D Value Noise
    float noise (in vec2 st) {
        vec2 i = floor(st);
        vec2 f = fract(st);

        // Cubic Hermite Curve
        f = f*f*(3.0-2.0*f);

        float a = random(i);
        float b = random(i + vec2(1.0, 0.0));
        float c = random(i + vec2(0.0, 1.0));
        float d = random(i + vec2(1.0, 1.0));

        return mix(a, b, f.x) +
                (c - a)* f.y * (1.0 - f.x) +
                (d - b) * f.x * f.y;
    }

    // FBM for terrain detail
    float fbm(vec2 p) {
        float f = 0.0;
        float w = 0.5;
        for (int i = 0; i < 4; i++) { 
            f += w * noise(p);
            p *= 2.0;
            w *= 0.5;
        }
        return f;
    }

    float getTerrainHeight(vec2 p) {
        // More subtle terrain
        float h = noise(p * 0.1) * 2.0;
        h += fbm(p * 0.5) * 0.5;
        return h - 3.0; // Lower terrain to y = -3 to ensure it's below shapes
    }

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

    // --- Boolean Operations ---

    vec4 opSmoothUnion(vec4 d1, vec4 d2, float k) {
        float h = clamp(0.5 + 0.5 * (d2.x - d1.x) / k, 0.0, 1.0);
        float dist = mix(d2.x, d1.x, h) - k * h * (1.0 - h);
        vec3 color = mix(d2.yzw, d1.yzw, h);
        return vec4(dist, color);
    }

    vec4 opSmoothSubtraction(vec4 d1, vec4 d2, float k) {
        float h = clamp(0.5 - 0.5 * (d2.x + d1.x) / k, 0.0, 1.0);
        float dist = mix(d2.x, -d1.x, h) + k * h * (1.0 - h);
        vec3 color = mix(d2.yzw, d1.yzw, h);
        return vec4(dist, color);
    }
    
    vec4 opUnion(vec4 d1, vec4 d2) {
        return (d1.x < d2.x) ? d1 : d2;
    }

    // --- Map (Scene Definition) ---

    vec4 map(vec3 p) {
        // 1. Base Terrain
        float h = getTerrainHeight(p.xz);
        float dTerrain = p.y - h;
        
        // Procedural Grid Texture on Terrain
        vec2 gridUV = p.xz;
        float gridSize = 4.0; 
        vec2 grid = abs(fract(gridUV / gridSize) - 0.5);
        float gridLine = 1.0 - smoothstep(0.48, 0.5, max(grid.x, grid.y));
        
        // Terrain Color
        vec3 colTerrain = mix(
            vec3(0.2, 0.25, 0.2), 
            vec3(0.4, 0.4, 0.35),   
            noise(p.xz * 0.1)
        );
        colTerrain = mix(colTerrain, vec3(0.5, 0.6, 0.6), gridLine * 0.3);

        vec4 res = vec4(dTerrain, colTerrain);

        // 2. Combine with Shapes
        for(int i = 0; i < MAX_SHAPES; i++) {
            if(i >= uShapeCount) break;
            if(uShapes[i].active == 0) continue;

            vec3 localP = p - uShapes[i].position;
            float d = 0.0;

            if(uShapes[i].type == 0) d = sdSphere(localP, uShapes[i].size.x);
            else if (uShapes[i].type == 1) d = sdBox(localP, uShapes[i].size);
            else if (uShapes[i].type == 2) d = sdTorus(localP, uShapes[i].size.xy);

            vec4 shapeRes = vec4(d, uShapes[i].color);
            float k = uShapes[i].blend;

            if(uShapes[i].operation == 0) res = opSmoothUnion(res, shapeRes, k);
            else if(uShapes[i].operation == 1) res = opSmoothSubtraction(shapeRes, res, k);
            else res = opUnion(res, shapeRes);
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

    float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
        float res = 1.0;
        float t = mint;
        for(int i = 0; i < 32; i++) { 
            float h = map(ro + rd * t).x;
            if( h < 0.001 ) return 0.0;
            res = min(res, k * h / t);
            t += h;
            if(t > maxt) break;
        }
        return res;
    }

    void main() {
        vec2 screenPos = (vUv - 0.5) * 2.0;
        screenPos.x *= uResolution.x / uResolution.y;

        vec3 ro = uCamPos;
        vec3 forward = normalize(uCamDir - uCamPos);
        vec3 right = normalize(cross(forward, uCamUp));
        vec3 up = cross(right, forward);
        
        float fovScale = tan(uFov * 0.5 * 3.14159 / 180.0);
        vec3 rd = normalize(forward + (screenPos.x * right + screenPos.y * up) * fovScale);

        float t = 0.0;
        float maxDist = 300.0;
        vec4 res = vec4(-1.0);
        int steps = 0;
        
        // Raymarch
        for(int i = 0; i < 256; i++) {
            steps = i;
            vec3 p = ro + rd * t;
            res = map(p);
            // Hit condition
            if(res.x < 0.002 || t > maxDist) break;
            
            // Lipschitz limit adjustment for heightfields
            // Terrain can have steep slopes, standard SDF marching overshoots.
            t += res.x * 0.5; 
        }

        vec3 col = vec3(0.0);
        
        // Sky Gradient
        vec3 skyCol = mix(vec3(0.5, 0.6, 0.7), vec3(0.1, 0.15, 0.25), rd.y * 0.5 + 0.5);

        if(t < maxDist) {
            vec3 p = ro + rd * t;
            vec3 n = calcNormal(p);
            vec3 mate = res.yzw;

            vec3 sunDir = normalize(vec3(0.6, 0.6, 0.4));
            float sunDif = clamp(dot(n, sunDir), 0.0, 1.0);
            float sunSha = softShadow(p + n * 0.02, sunDir, 0.05, 10.0, 8.0);
            
            vec3 skyDir = vec3(0.0, 1.0, 0.0);
            float skyDif = clamp(0.5 + 0.5 * dot(n, skyDir), 0.0, 1.0);
            
            vec3 lin = vec3(0.0);
            lin += 1.8 * sunDif * vec3(1.0, 0.9, 0.8) * sunSha;
            lin += 0.6 * skyDif * vec3(0.5, 0.6, 0.8);
            
            col = mate * lin;
            
            // Fog
            float fogDensity = 0.01;
            float fogFactor = 1.0 - exp(-fogDensity * t);
            col = mix(col, skyCol, fogFactor);
        } else {
            col = skyCol;
            
            // Debug: If no hit, visualize ray direction faintly
            col += vec3(0.05) * step(0.0, sin(rd.x * 50.0) + sin(rd.y * 50.0)); 
        }

        // Gamma correction
        col = pow(col, vec3(0.4545));
        
        gl_FragColor = vec4(col, 1.0);
    }
`;