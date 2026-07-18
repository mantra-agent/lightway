import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage = document.querySelector('.neural-stage');
const arrival = document.querySelector('.white-arrival');
const scrollCue = document.querySelector('.scroll-cue');
const narrativeSections = Array.from(document.querySelectorAll('[data-scene-progress]'));
const isMobile = window.innerWidth < 700;

const CONFIG = Object.freeze({
  clusterCount: 8,
  satellitesPerCluster: 7,
  microCount: 1200,
  streakCount: 260,
  pulseCount: 64,
  cascadeCount: 48,
  hubFogParticleCount: 47,
  interstitialFogParticleCount: 11,
  localSegments: 12,
  highwaySegments: 34,
  localRadialSegments: 4,
  highwayRadialSegments: 5,
  dendriteSegments: 8,
  dendriteRadialSegments: 4,
  depthFar: 96,
  depthNear: 4,
});

const state = {
  targetProgress: 0,
  progress: reducedMotion ? 0.16 : 0,
  elapsed: 0,
  travel: 0,
  lastFrame: performance.now(),
  running: true,
};

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
let randomSeed = 0x6d616e74;

function random() {
  randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
  return randomSeed / 4294967296;
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function wrapDepth(value, near = CONFIG.depthNear, far = CONFIG.depthFar) {
  const span = far + near;
  return ((((value - near) % span) + span) % span) - far;
}

function createRenderer() {
  try {
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    stage.prepend(renderer.domElement);
    return renderer;
  } catch (error) {
    document.body.classList.add('webgl-unavailable');
    return null;
  }
}

const renderer = createRenderer();
if (!renderer) throw new Error('WebGL unavailable');

const scene = new THREE.Scene();
scene.fog = null;

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 150);
camera.position.set(-0.35, 0.15, 7.2);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.48, 0.72, 0.7);
composer.addPass(bloomPass);

const shellVertexShader = `
  attribute float aScale;
  attribute float aPhase;
  attribute float aVisibility;
  attribute float aImpact;
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying float vPhase;
  varying float vVisibility;
  varying float vImpact;
  varying float vDepthFade;
  uniform float uTime;
  uniform float uProgress;

  void main() {
    float breathing = 1.0 + sin(uTime * (1.1 + uProgress) + aPhase) * (0.007 + uProgress * 0.028);
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position * aScale * breathing, 1.0);
    vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vViewDirection = normalize(cameraPosition - worldPosition.xyz);
    vPhase = aPhase;
    vVisibility = aVisibility;
    vImpact = aImpact;
    vDepthFade = 1.0 - smoothstep(8.0, 68.0, distance(cameraPosition, worldPosition.xyz)) * 0.84;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const shellFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying float vPhase;
  varying float vVisibility;
  varying float vImpact;
  varying float vDepthFade;
  uniform float uTime;
  uniform float uProgress;
  uniform float uBackface;
  uniform float uIntensity;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDirection = normalize(vViewDirection);
    float facing = abs(dot(normal, viewDirection));
    float fresnel = clamp(1.0 - facing, 0.0, 1.0);
    float volumeFalloff = pow(fresnel, 0.52);
    float broadRim = smoothstep(0.0, 0.98, volumeFalloff);
    float glassRim = smoothstep(0.18, 0.98, volumeFalloff);
    float innerEdge = smoothstep(0.015, 0.48, volumeFalloff) * (1.0 - smoothstep(0.78, 0.99, volumeFalloff));
    float highlight = pow(max(dot(normal, normalize(vec3(-0.42, 0.66, 0.61))), 0.0), 18.0);
    float heartbeat = pow(0.5 + 0.5 * sin(uTime * (1.28 + uProgress * 1.4) + vPhase), 5.0);
    float signal = 0.5 + 0.5 * sin(uTime * 0.42 + vPhase * 1.7);

    vec3 deepGlass = vec3(0.002, 0.014, 0.028);
    vec3 deepBlue = vec3(0.008, 0.105, 0.18);
    vec3 ctaBlue = vec3(0.026, 0.34, 0.52);
    vec3 rimColor = mix(deepBlue, ctaBlue, glassRim * 0.56 + highlight * 0.18);

    float frontAlpha = glassRim * 0.52 + innerEdge * 0.09 + broadRim * 0.2 + highlight * 0.16 + heartbeat * 0.01;
    float backAlpha = 0.022 + broadRim * 0.12 + signal * 0.012;
    vec3 frontRadiance = rimColor * (glassRim * uIntensity * 0.78 + innerEdge * 0.18 + broadRim * 0.34 + highlight * 0.72)
      + ctaBlue * heartbeat * 0.028;
    vec3 backRadiance = deepGlass + deepBlue * (broadRim * 0.16 + signal * 0.018);

    float midShellAttenuation = 1.0 - smoothstep(0.24, 0.55, uProgress) * 0.34;
    float alpha = mix(frontAlpha, backAlpha, uBackface) * vVisibility * vDepthFade * midShellAttenuation;
    vec3 radiance = mix(frontRadiance, backRadiance, uBackface) * midShellAttenuation;
    vec3 impactWhite = vec3(0.94, 0.99, 1.0) * (1.35 + glassRim * 1.2);
    radiance = mix(radiance, impactWhite, vImpact);
    alpha = mix(alpha, max(alpha, 0.88), vImpact);
    gl_FragColor = vec4(radiance, alpha);
  }
`;

const microVertexShader = `
  attribute float aPhase;
  attribute float aRank;
  attribute float aSize;
  varying float vAlpha;
  varying float vPulse;
  uniform float uTime;
  uniform float uTravel;
  uniform float uProgress;
  uniform float uFieldOpacity;

  void main() {
    vec3 p = position;
    p.z = mod(p.z + uTravel + 96.0, 100.0) - 96.0;
    p.x += sin(uTime * 0.16 + aPhase) * 0.08;
    p.y += cos(uTime * 0.13 + aPhase * 1.3) * 0.06;
    float threshold = 0.04 + smoothstep(0.0, 0.48, uProgress) * 0.72 + smoothstep(0.48, 1.0, uProgress) * 0.24;
    float visible = 1.0 - smoothstep(threshold, threshold + 0.08, aRank);
    float depthFade = 1.0 - smoothstep(10.0, 74.0, -p.z) * 0.88;
    vPulse = 0.48 + 0.52 * sin(uTime * (0.7 + uProgress * 2.4) + aPhase);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    float screenRadius = length(viewPosition.xy / max(1.0, -viewPosition.z));
    float convergenceDropout = 1.0;
    if (uProgress > 0.62) {
      float centerExclusion = smoothstep(0.16, 0.34, screenRadius);
      float deterministicKeep = step(0.38 + uProgress * 0.24, fract(sin(aPhase * 91.7 + aRank * 413.1) * 43758.5453));
      convergenceDropout = mix(1.0, centerExclusion * deterministicKeep, smoothstep(0.62, 0.84, uProgress));
    }
    vAlpha = visible * depthFade * convergenceDropout * (0.32 + vPulse * 0.5) * uFieldOpacity;
    gl_PointSize = clamp(aSize * (112.0 / max(1.0, -viewPosition.z)) * (0.86 + uProgress * 0.75), 1.0, 6.5);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const microFragmentShader = `
  varying float vAlpha;
  varying float vPulse;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distanceFromCenter = length(centered);
    float core = 1.0 - smoothstep(0.0, 0.48, distanceFromCenter);
    float halo = 1.0 - smoothstep(0.12, 0.5, distanceFromCenter);
    vec3 color = mix(vec3(0.004, 0.105, 0.18), vec3(0.026, 0.34, 0.52), vPulse);
    gl_FragColor = vec4(color * (core * 1.5 + halo * 0.35), vAlpha * (core + halo * 0.32));
  }
`;


const fogParticleVertexShader = `
  attribute vec3 aOffset;
  attribute float aScale;
  attribute float aRotation;
  attribute float aPhase;
  attribute float aDensity;
  attribute float aOpacity;
  attribute float aShape;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vDensity;
  varying float vOpacity;
  varying float vShape;
  uniform float uTime;
  uniform float uWorldTravel;
  uniform float uCycleDistance;
  uniform float uProgress;

  void main() {
    vec3 center = aOffset;
    center.z += mod(uWorldTravel, uCycleDistance);
    center.x += sin(uTime * 0.075 + aPhase) * 0.16;
    center.y += cos(uTime * 0.061 + aPhase * 1.27) * 0.13;
    center.z += sin(uTime * 0.043 + aPhase * 0.73) * 0.18;

    vec4 viewCenter = modelViewMatrix * vec4(center, 1.0);
    float rotation = aRotation + sin(uTime * 0.018 + aPhase) * 0.12;
    float cosine = cos(rotation);
    float sine = sin(rotation);
    vec2 billboard = vec2(
      position.x * cosine - position.y * sine,
      position.x * sine + position.y * cosine
    ) * aScale;
    viewCenter.xy += billboard;

    float distanceFade = 1.0 - smoothstep(46.0, 98.0, -viewCenter.z);
    float scrollFade = 1.0 - smoothstep(0.72, 0.98, uProgress) * 0.72;
    vUv = uv;
    vDensity = aDensity;
    vOpacity = aOpacity;
    vShape = aShape;
    vAlpha = distanceFade * scrollFade;
    gl_Position = projectionMatrix * viewCenter;
  }
`;

const fogParticleFragmentShader = `
  varying vec2 vUv;
  varying float vAlpha;
  varying float vDensity;
  varying float vOpacity;
  varying float vShape;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise2(vec2 p) {
    vec2 cell = floor(p);
    vec2 local = fract(p);
    local = local * local * (3.0 - 2.0 * local);
    return mix(
      mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), local.x),
      mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0, 1.0)), local.x),
      local.y
    );
  }

  float fbm2(vec2 p) {
    float value = 0.0;
    float amplitude = 0.58;
    for (int octave = 0; octave < 4; octave++) {
      value += noise2(p) * amplitude;
      p = p * 2.07 + vec2(4.3, 7.1);
      amplitude *= 0.46;
    }
    return value;
  }

  void main() {
    vec2 centered = vUv - 0.5;
    float angle = atan(centered.y, centered.x);
    float lobes = sin(angle * 3.0 + vShape * 6.283) * 0.055
      + sin(angle * 5.0 - vShape * 4.7) * 0.035
      + sin(angle * 7.0 + vShape * 9.1) * 0.018;
    float fieldNoise = fbm2(centered * mix(5.0, 8.5, vShape) + vec2(vShape * 11.7, vShape * 5.3));
    float boundary = 0.43 + lobes + (fieldNoise - 0.5) * 0.115;
    float distanceFromCenter = length(centered);
    float silhouette = 1.0 - smoothstep(boundary - 0.16, boundary, distanceFromCenter);
    float internalNoise = smoothstep(0.24, 0.82, fieldNoise);
    float wisps = mix(0.28, 1.0, internalNoise);
    float alpha = silhouette * wisps * vOpacity * vAlpha;
    vec3 darkBlue = vec3(0.003, 0.038, 0.065);
    vec3 ctaBlue = vec3(0.012, 0.16, 0.25);
    vec3 color = mix(darkBlue, ctaBlue, vDensity * 0.72 + internalNoise * 0.16);
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

function createShellMaterial(side, intensity) {
  return new THREE.ShaderMaterial({
    vertexShader: shellVertexShader,
    fragmentShader: shellFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uBackface: { value: side === THREE.BackSide ? 1 : 0 },
      uIntensity: { value: intensity },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: side === THREE.BackSide ? THREE.NormalBlending : THREE.AdditiveBlending,
    side,
  });
}

function createRadialTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.16, 'rgba(230,248,255,0.92)');
  gradient.addColorStop(0.42, 'rgba(111,204,244,0.38)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

class NeuralWorld {
  constructor() {
    this.group = new THREE.Group();
    this.group.scale.setScalar(isMobile ? 0.68 : 1);
    this.group.position.y = isMobile ? -0.3 : 0;
    scene.add(this.group);

    this.clusters = this.createClusters();
    this.worldMinDepth = Math.min(...this.clusters.map((cluster) => cluster.z));
    this.worldExitPadding = isMobile ? 4.2 : 5.2;
    this.worldCycleDistance = camera.position.z - this.worldMinDepth + this.worldExitPadding;
    this.satellites = this.createSatellites();
    this.hubPositions = this.clusters.map(() => new THREE.Vector3());
    this.satellitePositions = this.satellites.map(() => new THREE.Vector3());
    this.highways = this.createHighways();
    this.freeDendrites = this.createFreeDendrites();

    this.createHubMeshes();
    this.createSatelliteMeshes();
    this.createMicroField();
    this.createAtmosphere();
    this.createLocalLinks();
    this.createFreeDendritesSystem();
    this.createHighwayLinks();
    this.createPulses();
    this.createVelocityStreaks();
    this.createDestination();
    this.update(0, 0, 0.016, 0);
  }

  createClusters() {
    const positions = isMobile ? [
      [-2.35, -0.75, -7.4, 0.38],
      [5.15, 6.35, -13.0, 0.32],
      [-5.7, -7.1, -18.0, 0.34],
      [2.6, -1.1, -30.0, 0.32],
      [-2.1, 4.7, -42.0, 0.3],
      [1.0, -5.7, -55.0, 0.32],
      [-1.6, 1.1, -69.0, 0.29],
      [1.85, 5.8, -85.0, 0.3],
    ] : [
      [-5.35, -1.0, -7.0, 0.44],
      [4.8, 4.9, -12.5, 0.35],
      [10.5, -4.25, -17.5, 0.37],
      [-6.2, 3.6, -29.0, 0.34],
      [0.25, -4.4, -37.0, 0.33],
      [6.1, 1.5, -46.0, 0.35],
      [-4.7, -2.9, -56.0, 0.31],
      [2.5, 4.2, -67.0, 0.33],
      [-1.25, 0.6, -78.0, 0.3],
      [5.4, -3.6, -89.0, 0.34],
      [-5.5, 1.4, -97.0, 0.31],
    ];
    return positions.slice(0, CONFIG.clusterCount).map(([x, y, z, size], index) => ({
      x,
      y,
      z,
      size,
      phase: index * 0.83 + random() * 0.4,
      rank: index / CONFIG.clusterCount,
      speed: 0.9 + (index % 3) * 0.055,
    }));
  }

  createSatellites() {
    const satellites = [];
    this.clusters.forEach((cluster, clusterIndex) => {
      for (let index = 0; index < CONFIG.satellitesPerCluster; index += 1) {
        const angle = index / CONFIG.satellitesPerCluster * Math.PI * 2 + clusterIndex * 0.49;
        const radius = 0.92 + (index % 4) * 0.34 + random() * 0.44;
        satellites.push({
          clusterIndex,
          offsetX: Math.cos(angle) * radius,
          offsetY: Math.sin(angle) * radius * 0.7,
          offsetZ: (index % 3 - 1) * 0.52 + (random() - 0.5) * 0.34,
          size: 0.082 + random() * 0.105,
          phase: cluster.phase + index * 0.62,
          rank: [0.02, 0.08, 0.34, 0.13, 0.52, 0.24, 0.05, 0.44, 0.18, 0.68][index % 10],
        });
      }
    });
    return satellites;
  }

  createHighways() {
    const pairs = [[0, 1], [0, 2], [1, 2]];
    const used = new Set(pairs.map(([from, to]) => `${Math.min(from, to)}:${Math.max(from, to)}`));
    const addPair = (from, to) => {
      const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
      if (from === to || used.has(key)) return;
      used.add(key);
      pairs.push([from, to]);
    };
    for (let index = 0; index < CONFIG.clusterCount; index += 1) {
      addPair(index, (index + 1) % CONFIG.clusterCount);
      if (index % 2 === 0) addPair(index, (index + 2) % CONFIG.clusterCount);
      if (index % 3 === 0) addPair(index, (index + 4) % CONFIG.clusterCount);
    }
    return pairs.map(([from, to], index) => ({
      from,
      to,
      arc: index < 3 ? 1.45 + index * 0.34 : 1.9 + (index % 5) * 0.58,
      sign: index % 2 === 0 ? 1 : -1,
      rank: index / pairs.length,
      phase: index * 1.17,
    }));
  }

  createFreeDendrites() {
    const branches = [];
    this.clusters.forEach((cluster, clusterIndex) => {
      for (let branchIndex = 0; branchIndex < 2; branchIndex += 1) {
        const angle = cluster.phase + branchIndex * 2.35 + 0.7;
        branches.push({
          sourceType: 'hub',
          sourceIndex: clusterIndex,
          direction: new THREE.Vector3(Math.cos(angle), Math.sin(angle) * 0.72, -0.18 - branchIndex * 0.08).normalize(),
          length: (1.0 + branchIndex * 0.55 + random() * 0.5) * 4.5,
          arc: 0.34 + random() * 0.34,
          sign: branchIndex % 2 === 0 ? 1 : -1,
          phase: cluster.phase + branchIndex,
        });
      }
    });
    this.satellites.forEach((satellite, satelliteIndex) => {
      if (satelliteIndex % 4 !== 0) return;
      const angle = satellite.phase * 1.31;
      branches.push({
        sourceType: 'satellite',
        sourceIndex: satelliteIndex,
        direction: new THREE.Vector3(Math.cos(angle), Math.sin(angle), -0.12).normalize(),
        length: (0.48 + random() * 0.52) * 4.5,
        arc: 0.18 + random() * 0.24,
        sign: satelliteIndex % 2 === 0 ? 1 : -1,
        phase: satellite.phase,
      });
    });
    return branches;
  }

  createHubMeshes() {
    const count = this.clusters.length;
    const geometry = new THREE.IcosahedronGeometry(1, 4);
    this.hubScale = new Float32Array(count);
    this.hubPhase = new Float32Array(count);
    this.hubVisibility = new Float32Array(count);
    this.hubDepthFade = new Float32Array(count).fill(1);
    this.hubImpact = new Float32Array(count);
    geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(this.hubScale, 1));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(this.hubPhase, 1));
    geometry.setAttribute('aVisibility', new THREE.InstancedBufferAttribute(this.hubVisibility, 1));
    geometry.setAttribute('aImpact', new THREE.InstancedBufferAttribute(this.hubImpact, 1));

    this.hubFrontMaterial = createShellMaterial(THREE.FrontSide, 2.35);
    this.hubBackMaterial = createShellMaterial(THREE.BackSide, 0.86);
    this.hubBackMesh = new THREE.InstancedMesh(geometry, this.hubBackMaterial, count);
    this.hubFrontMesh = new THREE.InstancedMesh(geometry, this.hubFrontMaterial, count);
    for (const mesh of [this.hubBackMesh, this.hubFrontMesh]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }


  }

  createSatelliteMeshes() {
    const count = this.satellites.length;
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    this.satelliteScale = new Float32Array(count);
    this.satellitePhase = new Float32Array(count);
    this.satelliteVisibility = new Float32Array(count);
    this.satelliteImpact = new Float32Array(count);
    geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(this.satelliteScale, 1));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(this.satellitePhase, 1));
    geometry.setAttribute('aVisibility', new THREE.InstancedBufferAttribute(this.satelliteVisibility, 1));
    geometry.setAttribute('aImpact', new THREE.InstancedBufferAttribute(this.satelliteImpact, 1));
    this.satelliteMaterial = createShellMaterial(THREE.FrontSide, 1.46);
    this.satelliteMesh = new THREE.InstancedMesh(geometry, this.satelliteMaterial, count);
    this.satelliteMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.satelliteMesh.frustumCulled = false;
    this.group.add(this.satelliteMesh);
  }

  createMicroField() {
    const positions = new Float32Array(CONFIG.microCount * 3);
    const phases = new Float32Array(CONFIG.microCount);
    const ranks = new Float32Array(CONFIG.microCount);
    const sizes = new Float32Array(CONFIG.microCount);
    for (let index = 0; index < CONFIG.microCount; index += 1) {
      const clustered = index / CONFIG.microCount < 0.72;
      const cluster = this.clusters[index % this.clusters.length];
      const angle = random() * Math.PI * 2;
      const radius = clustered ? Math.pow(random(), 0.72) * 2.8 : Math.pow(random(), 0.58) * 9.4;
      positions[index * 3] = clustered ? cluster.x + Math.cos(angle) * radius : Math.cos(angle) * radius;
      positions[index * 3 + 1] = clustered ? cluster.y + Math.sin(angle) * radius * 0.68 : Math.sin(angle) * radius * 0.62;
      positions[index * 3 + 2] = clustered
        ? wrapDepth(cluster.z + (random() - 0.5) * 7.5)
        : -(random() * 94 + 2);
      phases[index] = random() * Math.PI * 2;
      ranks[index] = random();
      sizes[index] = 0.55 + Math.pow(random(), 2) * 2.5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.microMaterial = new THREE.ShaderMaterial({
      vertexShader: microVertexShader,
      fragmentShader: microFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uTravel: { value: 0 },
        uProgress: { value: 0 },
        uFieldOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.microField = new THREE.Points(geometry, this.microMaterial);
    this.microField.frustumCulled = false;
    this.group.add(this.microField);
  }

  createAtmosphere() {
    const hubParticleCount = CONFIG.hubFogParticleCount;
    const interstitialCount = CONFIG.interstitialFogParticleCount;
    const totalCount = hubParticleCount + interstitialCount;
    const offsets = new Float32Array(totalCount * 3);
    const scales = new Float32Array(totalCount);
    const rotations = new Float32Array(totalCount);
    const phases = new Float32Array(totalCount);
    const densities = new Float32Array(totalCount);
    const opacities = new Float32Array(totalCount);
    const shapes = new Float32Array(totalCount);

    for (let index = 0; index < hubParticleCount; index += 1) {
      const cluster = this.clusters[index % this.clusters.length];
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const radius = Math.pow(random(), 0.58);
      const horizontalRadius = isMobile ? 2.6 : 3.4;
      const verticalRadius = isMobile ? 3.5 : 2.5;
      const depthRadius = 4.2;
      offsets[index * 3] = cluster.x + Math.sin(phi) * Math.cos(theta) * horizontalRadius * radius;
      offsets[index * 3 + 1] = cluster.y + Math.cos(phi) * verticalRadius * radius;
      offsets[index * 3 + 2] = cluster.z + Math.sin(phi) * Math.sin(theta) * depthRadius * radius;
      scales[index] = 1.4 + Math.pow(random(), 1.85) * 8.8;
      rotations[index] = random() * Math.PI * 2;
      phases[index] = random() * Math.PI * 2;
      densities[index] = 0.3 + random() * 0.62;
      opacities[index] = 0.018 + Math.pow(random(), 2.4) * 0.17;
      shapes[index] = random();
    }

    for (let index = 0; index < interstitialCount; index += 1) {
      const writeIndex = hubParticleCount + index;
      const from = this.clusters[index % this.clusters.length];
      const to = this.clusters[(index + 1 + (index % 3)) % this.clusters.length];
      const t = random();
      offsets[writeIndex * 3] = lerp(from.x, to.x, t) + (random() - 0.5) * (isMobile ? 2.2 : 3.2);
      offsets[writeIndex * 3 + 1] = lerp(from.y, to.y, t) + (random() - 0.5) * (isMobile ? 3.0 : 2.4);
      offsets[writeIndex * 3 + 2] = lerp(from.z, to.z, t) + (random() - 0.5) * 4.8;
      scales[writeIndex] = 0.9 + Math.pow(random(), 1.9) * 5.6;
      rotations[writeIndex] = random() * Math.PI * 2;
      phases[writeIndex] = random() * Math.PI * 2;
      densities[writeIndex] = 0.12 + random() * 0.38;
      opacities[writeIndex] = 0.012 + Math.pow(random(), 2.6) * 0.11;
      shapes[writeIndex] = random();
    }

    const baseGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = baseGeometry.index;
    geometry.setAttribute('position', baseGeometry.attributes.position);
    geometry.setAttribute('uv', baseGeometry.attributes.uv);
    geometry.instanceCount = totalCount;
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 1));
    geometry.setAttribute('aRotation', new THREE.InstancedBufferAttribute(rotations, 1));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    geometry.setAttribute('aDensity', new THREE.InstancedBufferAttribute(densities, 1));
    geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(opacities, 1));
    geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapes, 1));
    baseGeometry.dispose();

    this.fogParticleMaterial = new THREE.ShaderMaterial({
      vertexShader: fogParticleVertexShader,
      fragmentShader: fogParticleFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWorldTravel: { value: 0 },
        uCycleDistance: { value: this.worldCycleDistance },
        uProgress: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.fogParticles = new THREE.Mesh(geometry, this.fogParticleMaterial);
    this.fogParticles.frustumCulled = false;
    this.group.add(this.fogParticles);
  }

  createTendrilSystem(maxTendrils, segments, radialSegments, opacity) {
    const vertexCount = maxTendrils * segments * radialSegments * 6;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { positions, colors, geometry, material, mesh, segments, radialSegments };
  }

  createLocalLinks() {
    this.localTendrilSystem = this.createTendrilSystem(
      this.satellites.length * 2,
      CONFIG.localSegments,
      CONFIG.localRadialSegments,
      0.62,
    );
  }

  createHighwayLinks() {
    this.highwayTendrilSystem = this.createTendrilSystem(
      this.highways.length,
      CONFIG.highwaySegments,
      CONFIG.highwayRadialSegments,
      0.78,
    );
  }

  createFreeDendritesSystem() {
    this.freeDendriteSystem = this.createTendrilSystem(
      this.freeDendrites.length,
      CONFIG.dendriteSegments,
      CONFIG.dendriteRadialSegments,
      0.5,
    );
  }

  createPulses() {
    const geometry = new THREE.SphereGeometry(0.082, 10, 10);
    this.pulseMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.pulseMesh = new THREE.InstancedMesh(geometry, this.pulseMaterial, CONFIG.pulseCount * 5);
    this.pulseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pulseMesh.frustumCulled = false;
    this.pulses = Array.from({ length: CONFIG.pulseCount }, (_, index) => ({
      highwayIndex: index % this.highways.length,
      phase: random(),
      speed: 0.055 + random() * 0.11,
      rank: index / CONFIG.pulseCount,
      scale: 1.2 + random() * 0.95,
      reverse: random() > 0.5,
    }));
    this.group.add(this.pulseMesh);

    // Cascade pulse mesh (hub → satellite)
    const cascadeGeometry = new THREE.SphereGeometry(0.048, 8, 8);
    this.cascadeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.cascadeMesh = new THREE.InstancedMesh(cascadeGeometry, this.cascadeMaterial, CONFIG.cascadeCount * 3);
    this.cascadeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cascadeMesh.frustumCulled = false;
    this.cascades = [];
    this.cascadePool = Array.from({ length: CONFIG.cascadeCount }, () => ({
      active: false,
      hubIndex: 0,
      satelliteIndex: 0,
      phase: 0,
      speed: 0,
      scale: 0,
      curve: null,
    }));
    this.group.add(this.cascadeMesh);
  }

  createVelocityStreaks() {
    this.streakData = Array.from({ length: CONFIG.streakCount }, () => {
      const angle = random() * Math.PI * 2;
      const minimumRadius = isMobile ? 4.1 : 3.5;
      const radius = minimumRadius + Math.pow(random(), 0.62) * (isMobile ? 7.1 : 7.7);
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * (isMobile ? 0.78 : 0.62),
        z: -(random() * 94 + 2),
        rank: random(),
        speed: 0.78 + random() * 0.54,
      };
    });
    this.streakPositions = new Float32Array(CONFIG.streakCount * 6);
    this.streakColors = new Float32Array(CONFIG.streakCount * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.streakPositions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.streakColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.streakGeometry = geometry;
    this.streakMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.streakMesh = new THREE.LineSegments(geometry, this.streakMaterial);
    this.streakMesh.frustumCulled = false;
    this.group.add(this.streakMesh);
  }

  createDestination() {
    this.destinationMaterial = new THREE.SpriteMaterial({
      map: createRadialTexture(),
      color: 0xe4f7ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.destination = new THREE.Sprite(this.destinationMaterial);
    this.destination.position.set(0.2, 0.6, -62);
    this.destination.scale.set(158, 108, 1);
    scene.add(this.destination);
  }

  clusterVisibility(cluster, progress) {
    const threshold = 0.2 + smoothstep(0.0, 0.5, progress) * 0.72 + smoothstep(0.5, 1, progress) * 0.08;
    return 1 - smoothstep(threshold, threshold + 0.12, cluster.rank);
  }

  updatePositions(progress, elapsed, travel) {
    const hubMatrix = new THREE.Matrix4();
    const satelliteMatrix = new THREE.Matrix4();
    const unitQuaternion = new THREE.Quaternion();

    const connectedWorldTravel = reducedMotion ? 0 : travel;
    this.clusters.forEach((cluster, index) => {
      const z = wrapDepth(cluster.z + connectedWorldTravel);
      const drift = 0.028 + smoothstep(0.08, 0.5, progress) * 0.11;
      const x = cluster.x + Math.sin(elapsed * 0.19 + cluster.phase) * drift;
      const y = cluster.y + Math.cos(elapsed * 0.16 + cluster.phase * 1.2) * drift * 0.72;
      const position = this.hubPositions[index].set(x, y, z);
      const shellVelocityFade = 1 - smoothstep(0.92, 0.98, progress);
      const nearClipFade = 1 - smoothstep(CONFIG.depthNear - 2, CONFIG.depthNear, z);
      const farClipFade = smoothstep(-CONFIG.depthFar, -CONFIG.depthFar + 6, z);
      const depthFade = nearClipFade * farClipFade;
      const visibility = this.clusterVisibility(cluster, progress) * shellVelocityFade * depthFade;
      const nearFactor = smoothstep(-34, 4, z);
      const mobileMidEmphasis = isMobile ? lerp(0.94, 1.05, smoothstep(0.1, 0.55, progress)) : 1;
      const scale = cluster.size * (0.86 + nearFactor * 0.44) * mobileMidEmphasis;
      hubMatrix.compose(position, unitQuaternion, new THREE.Vector3(1, 1, 1));
      this.hubFrontMesh.setMatrixAt(index, hubMatrix);
      this.hubBackMesh.setMatrixAt(index, hubMatrix);
      this.hubScale[index] = scale;
      this.hubPhase[index] = cluster.phase;
      this.hubVisibility[index] = visibility;
      this.hubDepthFade[index] = depthFade;
    });

    this.satellites.forEach((satellite, index) => {
      const hub = this.hubPositions[satellite.clusterIndex];
      const orbit = elapsed * 0.055 + satellite.phase;
      const x = hub.x + satellite.offsetX + Math.sin(orbit) * 0.07;
      const y = hub.y + satellite.offsetY + Math.cos(orbit * 0.87) * 0.06;
      const z = hub.z + satellite.offsetZ;
      const position = this.satellitePositions[index].set(x, y, z);
      const cluster = this.clusters[satellite.clusterIndex];
      const clusterVisible = this.clusterVisibility(cluster, progress);
      const shellVelocityFade = 1 - smoothstep(0.92, 0.98, progress);
      const satelliteReveal = 0.07 + smoothstep(0.0, 0.5, progress) * 0.72 + smoothstep(0.5, 1, progress) * 0.21;
      const satNearClipFade = 1 - smoothstep(CONFIG.depthNear - 2, CONFIG.depthNear, z);
      const satFarClipFade = smoothstep(-CONFIG.depthFar, -CONFIG.depthFar + 6, z);
      const satelliteVisible = (1 - smoothstep(satelliteReveal, satelliteReveal + 0.08, satellite.rank)) * shellVelocityFade * satNearClipFade * satFarClipFade;
      satelliteMatrix.compose(position, unitQuaternion, new THREE.Vector3(1, 1, 1));
      this.satelliteMesh.setMatrixAt(index, satelliteMatrix);
      const mobileSatelliteEmphasis = isMobile ? lerp(0.9, 1.06, smoothstep(0.1, 0.55, progress)) : 1;
      this.satelliteScale[index] = satellite.size * (0.9 + smoothstep(-30, 4, z) * 0.32) * mobileSatelliteEmphasis;
      this.satellitePhase[index] = satellite.phase;
      this.satelliteVisibility[index] = clusterVisible * satelliteVisible;
    });

    for (const mesh of [this.hubFrontMesh, this.hubBackMesh, this.satelliteMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const attribute of [
      this.hubFrontMesh.geometry.attributes.aScale,
      this.hubFrontMesh.geometry.attributes.aPhase,
      this.hubFrontMesh.geometry.attributes.aVisibility,
      this.satelliteMesh.geometry.attributes.aScale,
      this.satelliteMesh.geometry.attributes.aPhase,
      this.satelliteMesh.geometry.attributes.aVisibility,
    ]) attribute.needsUpdate = true;
  }

  quadraticControl(start, end, arc, sign, target = new THREE.Vector3()) {
    target.lerpVectors(start, end, 0.5);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(0.1, Math.hypot(dx, dy));
    target.x += (-dy / length) * arc * sign;
    target.y += (dx / length) * arc * sign + arc * 0.28;
    target.z -= arc * 0.34;
    return target;
  }

  surfaceCurve(startCenter, endCenter, startRadius, endRadius, arc, sign) {
    const centerControl = this.quadraticControl(startCenter, endCenter, arc, sign);
    const startDirection = centerControl.clone().sub(startCenter).normalize();
    const endDirection = endCenter.clone().sub(centerControl).normalize();
    const startOverlap = Math.max(isMobile ? 0.018 : 0.014, startRadius * 0.08);
    const endOverlap = Math.max(isMobile ? 0.018 : 0.014, endRadius * 0.08);
    const start = startCenter.clone().addScaledVector(startDirection, Math.max(0, startRadius - startOverlap));
    const end = endCenter.clone().addScaledVector(endDirection, -Math.max(0, endRadius - endOverlap));
    const control = this.quadraticControl(start, end, arc, sign);
    return { start, control, end };
  }

  curvePoint(curve, t, target = new THREE.Vector3()) {
    const inverse = 1 - t;
    return target.set(
      inverse * inverse * curve.start.x + 2 * inverse * t * curve.control.x + t * t * curve.end.x,
      inverse * inverse * curve.start.y + 2 * inverse * t * curve.control.y + t * t * curve.end.y,
      inverse * inverse * curve.start.z + 2 * inverse * t * curve.control.z + t * t * curve.end.z,
    );
  }

  curveTangent(curve, t, target = new THREE.Vector3()) {
    return target.set(
      2 * (1 - t) * (curve.control.x - curve.start.x) + 2 * t * (curve.end.x - curve.control.x),
      2 * (1 - t) * (curve.control.y - curve.start.y) + 2 * t * (curve.end.y - curve.control.y),
      2 * (1 - t) * (curve.control.z - curve.start.z) + 2 * t * (curve.end.z - curve.control.z),
    ).normalize();
  }

  writeTendril(system, curve, startWidth, endWidth, intensity, color, vertexOffset) {
    const point0 = new THREE.Vector3();
    const point1 = new THREE.Vector3();
    const tangent0 = new THREE.Vector3();
    const tangent1 = new THREE.Vector3();
    const normal0 = new THREE.Vector3();
    const normal1 = new THREE.Vector3();
    const binormal0 = new THREE.Vector3();
    const binormal1 = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3(1, 0, 0);
    const corners = Array.from({ length: 4 }, () => new THREE.Vector3());

    const buildFrame = (tangent, normal, binormal) => {
      const reference = Math.abs(tangent.dot(up)) > 0.88 ? side : up;
      normal.crossVectors(tangent, reference).normalize();
      binormal.crossVectors(tangent, normal).normalize();
    };

    for (let segment = 0; segment < system.segments; segment += 1) {
      const t0 = segment / system.segments;
      const t1 = (segment + 1) / system.segments;
      this.curvePoint(curve, t0, point0);
      this.curvePoint(curve, t1, point1);
      this.curveTangent(curve, t0, tangent0);
      this.curveTangent(curve, t1, tangent1);
      buildFrame(tangent0, normal0, binormal0);
      buildFrame(tangent1, normal1, binormal1);

      const tendrilRadius = (t) => {
        const membraneRadius = lerp(startWidth, endWidth, t);
        const distanceFromMiddle = Math.abs(t * 2 - 1);
        const membraneWeight = smoothstep(0, 1, Math.pow(distanceFromMiddle, 1.35));
        const middleRadius = Math.min(startWidth, endWidth) * 0.2;
        return lerp(middleRadius, membraneRadius, membraneWeight);
      };
      const radius0 = tendrilRadius(t0);
      const radius1 = tendrilRadius(t1);
      const longitudinalGlow = 0.5 + Math.pow(Math.abs((t0 + t1) - 1), 0.7) * 0.5;
      const segmentIntensity = intensity * longitudinalGlow;

      for (let radial = 0; radial < system.radialSegments; radial += 1) {
        const angle0 = radial / system.radialSegments * Math.PI * 2;
        const angle1 = (radial + 1) / system.radialSegments * Math.PI * 2;
        corners[0].copy(point0).addScaledVector(normal0, Math.cos(angle0) * radius0).addScaledVector(binormal0, Math.sin(angle0) * radius0);
        corners[1].copy(point1).addScaledVector(normal1, Math.cos(angle0) * radius1).addScaledVector(binormal1, Math.sin(angle0) * radius1);
        corners[2].copy(point1).addScaledVector(normal1, Math.cos(angle1) * radius1).addScaledVector(binormal1, Math.sin(angle1) * radius1);
        corners[3].copy(point0).addScaledVector(normal0, Math.cos(angle1) * radius0).addScaledVector(binormal0, Math.sin(angle1) * radius0);

        for (const cornerIndex of [0, 1, 2, 0, 2, 3]) {
          const point = corners[cornerIndex];
          system.positions[vertexOffset * 3] = point.x;
          system.positions[vertexOffset * 3 + 1] = point.y;
          system.positions[vertexOffset * 3 + 2] = point.z;
          system.colors[vertexOffset * 3] = color.r * segmentIntensity;
          system.colors[vertexOffset * 3 + 1] = color.g * segmentIntensity;
          system.colors[vertexOffset * 3 + 2] = color.b * segmentIntensity;
          vertexOffset += 1;
        }
      }
    }
    return vertexOffset;
  }

  freeDendriteCurve(branch) {
    const isHub = branch.sourceType === 'hub';
    const center = isHub ? this.hubPositions[branch.sourceIndex] : this.satellitePositions[branch.sourceIndex];
    const radius = isHub ? this.hubScale[branch.sourceIndex] : this.satelliteScale[branch.sourceIndex];
    const overlap = Math.max(isMobile ? 0.018 : 0.014, radius * 0.08);
    const start = center.clone().addScaledVector(branch.direction, Math.max(0, radius - overlap));
    const end = start.clone().addScaledVector(branch.direction, branch.length);
    const control = start.clone().lerp(end, 0.5);
    control.x += branch.sign * branch.arc * 0.35;
    control.y += branch.arc;
    control.z -= branch.arc * 0.28;
    return { start, control, end };
  }

  updateFreeDendrites(progress, elapsed) {
    const system = this.freeDendriteSystem;
    const color = new THREE.Color(0.006, 0.12, 0.2);
    let vertexOffset = 0;
    for (const branch of this.freeDendrites) {
      const visibility = branch.sourceType === 'hub'
        ? this.hubVisibility[branch.sourceIndex]
        : this.satelliteVisibility[branch.sourceIndex];
      if (visibility < 0.08) continue;
      const breathing = 0.72 + Math.sin(elapsed * 0.5 + branch.phase) * 0.12;
      vertexOffset = this.writeTendril(
        system,
        this.freeDendriteCurve(branch),
        branch.sourceType === 'hub' ? 0.052 : 0.028,
        0,
        visibility * breathing,
        color,
        vertexOffset,
      );
    }
    system.geometry.setDrawRange(0, vertexOffset);
    system.geometry.attributes.position.needsUpdate = true;
    system.geometry.attributes.color.needsUpdate = true;
    system.material.opacity = isMobile ? 0.65 : 0.6;
  }

  updateLocalLinks(progress, elapsed) {
    const system = this.localTendrilSystem;
    const color = new THREE.Color(0.006, 0.14, 0.23);
    let vertexOffset = 0;
    this.satellites.forEach((satellite, index) => {
      const cluster = this.clusters[satellite.clusterIndex];
      const visibility = this.clusterVisibility(cluster, progress) * this.hubDepthFade[satellite.clusterIndex];
      if (visibility < 0.02 || satellite.rank > 0.38 + progress * 0.58) return;
      const start = this.hubPositions[satellite.clusterIndex];
      const end = this.satellitePositions[index];
      const fire = 0.58 + 0.42 * Math.sin(elapsed * 0.78 + satellite.phase);
      const localIndex = index % CONFIG.satellitesPerCluster;
      if (localIndex % 3 === 0) {
        const sign = localIndex % 2 ? 1 : -1;
        const curve = this.surfaceCurve(
          start,
          end,
          this.hubScale[satellite.clusterIndex],
          this.satelliteScale[index],
          0.72,
          sign,
        );
        vertexOffset = this.writeTendril(
          system,
          curve,
          0.114,
          0.018 + smoothstep(0.1, 0.5, progress) * 0.024,
          visibility * (0.38 + fire * 0.22),
          color,
          vertexOffset,
        );
      }
      if (localIndex === 1 || localIndex === 6) {
        const siblingIndex = satellite.clusterIndex * CONFIG.satellitesPerCluster + (localIndex + 2) % CONFIG.satellitesPerCluster;
        const sibling = this.satellitePositions[siblingIndex];
        if (sibling) {
          const sign = localIndex === 1 ? 1 : -1;
          const curve = this.surfaceCurve(
            end,
            sibling,
            this.satelliteScale[index],
            this.satelliteScale[siblingIndex],
            0.8,
            sign,
          );
          vertexOffset = this.writeTendril(
            system,
            curve,
            0.072,
            0.012 + smoothstep(0.1, 0.5, progress) * 0.015,
            visibility * (0.28 + fire * 0.12),
            color,
            vertexOffset,
          );
        }
      }
    });
    system.geometry.setDrawRange(0, vertexOffset);
    system.geometry.attributes.position.needsUpdate = true;
    system.geometry.attributes.color.needsUpdate = true;
    system.material.opacity = isMobile ? 0.58 : 0.52;
  }

  highwayVisible(highway, progress) {
    const start = this.hubPositions[highway.from];
    const end = this.hubPositions[highway.to];
    const separation = Math.abs(start.z - end.z);
    const threshold = 0.074 + smoothstep(0.0, 0.5, progress) * 0.716 + smoothstep(0.5, 1, progress) * 0.21;
    return separation < 33 && highway.rank <= threshold;
  }

  highwayCurve(highway) {
    return this.surfaceCurve(
      this.hubPositions[highway.from],
      this.hubPositions[highway.to],
      this.hubScale[highway.from],
      this.hubScale[highway.to],
      highway.arc,
      highway.sign,
    );
  }

  updateHighways(progress, elapsed) {
    const system = this.highwayTendrilSystem;
    let vertexOffset = 0;
    this.highways.forEach((highway) => {
      if (!this.highwayVisible(highway, progress)) return;
      const fire = smoothstep(0.42, 1, Math.sin(elapsed * (0.55 + progress * 1.6) + highway.phase) * 0.5 + 0.5);
      const color = new THREE.Color(0.006, 0.15, 0.24).lerp(new THREE.Color(0.026, 0.34, 0.52), fire * 0.44);
      const intensity = 0.62 + progress * 0.68 + fire * 0.3;
      const curve = this.highwayCurve(highway);
      vertexOffset = this.writeTendril(
        system,
        curve,
        (0.052 + progress * 0.012) * 3.0,
        (0.007 + smoothstep(0.1, 0.5, progress) * 0.009) * 3.0,
        intensity,
        color,
        vertexOffset,
      );
    });
    system.geometry.setDrawRange(0, vertexOffset);
    system.geometry.attributes.position.needsUpdate = true;
    system.geometry.attributes.color.needsUpdate = true;
    system.material.opacity = 0.74;
  }

  updatePulses(progress, elapsed, delta) {
    const impactDecay = Math.exp(-delta * 5.5);
    for (let index = 0; index < this.hubImpact.length; index += 1) {
      this.hubImpact[index] *= impactDecay;
    }
    const satelliteImpactDecay = Math.exp(-delta * 7);
    for (let index = 0; index < this.satelliteImpact.length; index += 1) {
      this.satelliteImpact[index] *= satelliteImpactDecay;
    }
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    let instanceIndex = 0;
    for (const pulse of this.pulses) {
      const highway = this.highways[pulse.highwayIndex];
      const visible = this.highwayVisible(highway, progress) && pulse.rank <= 0.34 + smoothstep(0.0, 0.5, progress) * 0.46 + smoothstep(0.5, 1, progress) * 0.2;
      const speed = pulse.speed * (1 + progress * 4.2);
      const nextPhase = pulse.phase + delta * speed;
      const collidedWithDestination = nextPhase >= 1;
      const t = nextPhase % 1;
      pulse.phase = t;
      if (visible && collidedWithDestination) {
        const destHub = pulse.reverse ? highway.from : highway.to;
        this.hubImpact[destHub] = 1;
        this.spawnCascades(destHub, progress);
        pulse.reverse = random() > 0.5;
      }
      for (let ghost = 0; ghost < 5; ghost += 1) {
        const ghostT = Math.max(0, t - ghost * (0.006 + progress * 0.004));
        if (visible) {
          const curveT = pulse.reverse ? 1 - ghostT : ghostT;
          this.curvePoint(this.highwayCurve(highway), curveT, position);
        } else position.set(0, 0, -120);
        const endpointEnvelope = smoothstep(0, 0.045, ghostT) * (1 - smoothstep(0.992, 1, ghostT));
        const scale = visible
          ? pulse.scale * (1 - ghost * 0.14) * (1.12 + progress * 0.34) * (isMobile ? 0.5 : 1) * endpointEnvelope
          : 0;
        matrix.compose(position, quaternion, new THREE.Vector3(scale, scale, scale));
        this.pulseMesh.setMatrixAt(instanceIndex, matrix);
        instanceIndex += 1;
      }
    }
    this.pulseMesh.instanceMatrix.needsUpdate = true;
    this.hubFrontMesh.geometry.attributes.aImpact.needsUpdate = true;
    this.pulseMaterial.opacity = 1;

    // Update cascade pulses (hub → satellite)
    let cascadeIndex = 0;
    const cascadeMatrix = new THREE.Matrix4();
    const cascadePosition = new THREE.Vector3();
    for (const cascade of this.cascadePool) {
      if (cascade.active) {
        const nextPhase = cascade.phase + delta * cascade.speed;
        const hub = this.hubPositions[cascade.hubIndex];
        const sat = this.satellitePositions[cascade.satelliteIndex];
        if (nextPhase >= 1) {
          cascade.active = false;
          this.satelliteImpact[cascade.satelliteIndex] = 1;
        } else {
          cascade.phase = nextPhase;
        }
        for (let ghost = 0; ghost < 3; ghost += 1) {
          if (cascadeIndex >= CONFIG.cascadeCount * 3) break;
          const ghostT = Math.max(0, (cascade.active ? cascade.phase : 1) - ghost * 0.04);
          if (cascade.active || ghost === 0) {
            this.curvePoint(cascade.curve, ghostT, cascadePosition);
          } else {
            cascadePosition.set(0, 0, -120);
          }
          const endpointEnvelope = smoothstep(0, 0.08, ghostT) * (1 - smoothstep(0.92, 1, ghostT));
          const scale = cascade.active
            ? cascade.scale * (1 - ghost * 0.2) * endpointEnvelope * (isMobile ? 0.6 : 1)
            : 0;
          cascadeMatrix.compose(cascadePosition, quaternion, new THREE.Vector3(scale, scale, scale));
          this.cascadeMesh.setMatrixAt(cascadeIndex, cascadeMatrix);
          cascadeIndex += 1;
        }
      } else {
        for (let ghost = 0; ghost < 3; ghost += 1) {
          if (cascadeIndex >= CONFIG.cascadeCount * 3) break;
          cascadePosition.set(0, 0, -120);
          cascadeMatrix.compose(cascadePosition, quaternion, new THREE.Vector3(0, 0, 0));
          this.cascadeMesh.setMatrixAt(cascadeIndex, cascadeMatrix);
          cascadeIndex += 1;
        }
      }
    }
    this.cascadeMesh.instanceMatrix.needsUpdate = true;
    this.satelliteMesh.geometry.attributes.aImpact.needsUpdate = true;
    this.cascadeMaterial.opacity = 1;
  }

  spawnCascades(hubIndex, progress) {
    const baseIndex = hubIndex * CONFIG.satellitesPerCluster;
    const maxCascades = Math.min(CONFIG.satellitesPerCluster, 3 + Math.floor(progress * 4));
    const offsets = Array.from({ length: CONFIG.satellitesPerCluster }, (_, i) => i);
    for (let i = offsets.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
    }
    let spawned = 0;
    for (const offset of offsets) {
      if (spawned >= maxCascades) break;
      const satIndex = baseIndex + offset;
      if (satIndex >= this.satellites.length) break;
      if (this.satelliteVisibility[satIndex] < 0.05) continue;
      const pool = this.cascadePool.find((c) => !c.active);
      if (!pool) break;
      const sign = offset % 2 ? 1 : -1;
      pool.curve = this.surfaceCurve(
        this.hubPositions[hubIndex], this.satellitePositions[satIndex],
        this.hubScale[hubIndex], this.satelliteScale[satIndex],
        0.44, sign,
      );
      pool.active = true;
      pool.hubIndex = hubIndex;
      pool.satelliteIndex = satIndex;
      pool.phase = 0;
      pool.speed = 1.4 + Math.random() * 1.2;
      pool.scale = 0.7 + Math.random() * 0.5;
      spawned += 1;
    }
  }

  updateStreaks(progress, travel) {
    const active = smoothstep(0.5, 0.9, progress);
    const length = 0.22 + Math.pow(progress, 2.15) * 9.4;
    this.streakData.forEach((streak, index) => {
      const z = wrapDepth(streak.z + travel * streak.speed);
      const visible = streak.rank < 0.14 + progress * 0.9 ? active : 0;
      const base = index * 6;
      this.streakPositions[base] = streak.x;
      this.streakPositions[base + 1] = streak.y;
      this.streakPositions[base + 2] = z - length * streak.speed;
      this.streakPositions[base + 3] = streak.x;
      this.streakPositions[base + 4] = streak.y;
      this.streakPositions[base + 5] = z;
      this.streakColors[base] = 0.008 * visible;
      this.streakColors[base + 1] = 0.12 * visible;
      this.streakColors[base + 2] = 0.2 * visible;
      this.streakColors[base + 3] = 0.102 * visible;
      this.streakColors[base + 4] = (0.5 + progress * 0.108) * visible;
      this.streakColors[base + 5] = (0.72 + progress * 0.139) * visible;
    });
    this.streakGeometry.attributes.position.needsUpdate = true;
    this.streakGeometry.attributes.color.needsUpdate = true;
    this.streakMaterial.opacity = active * (0.48 + progress * 0.42);
  }

  updateMaterials(progress, elapsed, travel) {
    for (const material of [this.hubFrontMaterial, this.hubBackMaterial, this.satelliteMaterial]) {
      material.uniforms.uTime.value = elapsed;
      material.uniforms.uProgress.value = progress;
    }
    this.microMaterial.uniforms.uTime.value = elapsed;
    this.microMaterial.uniforms.uTravel.value = travel;
    this.microMaterial.uniforms.uProgress.value = progress;
    this.fogParticleMaterial.uniforms.uTime.value = elapsed;
    this.fogParticleMaterial.uniforms.uWorldTravel.value = travel;
    this.fogParticleMaterial.uniforms.uProgress.value = progress;
    const desktopMidpointClear = isMobile
      ? 0
      : smoothstep(0.4, 0.5, progress) * (1 - smoothstep(0.5, 0.62, progress));
    this.microMaterial.uniforms.uFieldOpacity.value = 1 - desktopMidpointClear * 0.68;
    const destinationProgress = isMobile ? smoothstep(0.955, 1, progress) : smoothstep(0.62, 0.98, progress);
    const destinationStrength = isMobile ? 0.08 : 0.48;
    this.destinationMaterial.opacity = destinationProgress * (0.015 + progress * destinationStrength);
  }

  update(progress, elapsed, delta, travel) {
    this.updatePositions(progress, elapsed, travel);
    this.updateLocalLinks(progress, elapsed);
    this.updateFreeDendrites(progress, elapsed);
    this.updateHighways(progress, elapsed);
    this.updatePulses(progress, elapsed, delta);
    this.updateStreaks(progress, travel);
    this.updateMaterials(progress, elapsed, travel);
    this.group.rotation.z = Math.sin(elapsed * 0.07) * 0.012;
    if (isMobile) {
      const portraitReveal = smoothstep(0.08, 0.5, progress);
      this.group.position.y = lerp(0.55, 0.95, portraitReveal);
      const portraitScale = 0.68 * lerp(1, 1.1, portraitReveal);
      this.group.scale.set(portraitScale, portraitScale * lerp(1, 1.26, portraitReveal), portraitScale);
    }
  }
}

const world = new NeuralWorld();

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  composer.setSize(width, height);
  bloomPass.setSize(width, height);
}

function updateScrollProgress() {
  if (reducedMotion) {
    state.targetProgress = 0.16;
    narrativeSections.forEach((section, index) => section.classList.toggle('is-active', index === 0));
    return;
  }

  const viewportCenter = window.scrollY + window.innerHeight * 0.5;
  const anchors = narrativeSections.map((section) => ({
    section,
    center: section.offsetTop + section.offsetHeight * 0.5,
    progress: Number(section.dataset.sceneProgress),
  }));
  let activeIndex = 0;
  let closestDistance = Infinity;
  for (let index = 0; index < anchors.length; index += 1) {
    const distance = Math.abs(viewportCenter - anchors[index].center);
    if (distance < closestDistance) {
      closestDistance = distance;
      activeIndex = index;
    }
  }
  narrativeSections.forEach((section, index) => section.classList.toggle('is-active', index === activeIndex));

  if (viewportCenter <= anchors[0].center) {
    state.targetProgress = anchors[0].progress;
    return;
  }
  const lastAnchor = anchors[anchors.length - 1];
  if (viewportCenter >= lastAnchor.center) {
    state.targetProgress = lastAnchor.progress;
    return;
  }
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const current = anchors[index];
    const next = anchors[index + 1];
    if (viewportCenter >= current.center && viewportCenter <= next.center) {
      const localProgress = clamp((viewportCenter - current.center) / (next.center - current.center), 0, 1);
      state.targetProgress = lerp(current.progress, next.progress, localProgress);
      return;
    }
  }
}

function updateCamera(progress, elapsed, delta) {
  const mobileScale = isMobile ? 0.54 : 1;
  const targetX = lerp(-0.35, 0.75, smoothstep(0.12, 0.84, progress)) * mobileScale;
  const targetY = lerp(0.15, -0.3, smoothstep(0.18, 0.9, progress)) * mobileScale;
  const targetZ = lerp(isMobile ? 8.2 : 7.2, isMobile ? 6.7 : 5.15, smoothstep(0.08, 0.88, progress));
  const ease = 1 - Math.exp(-delta * 2.5);
  camera.position.x += (targetX - camera.position.x) * ease;
  camera.position.y += (targetY - camera.position.y) * ease;
  camera.position.z += (targetZ - camera.position.z) * ease;
  camera.fov = isMobile
    ? lerp(74, 81, smoothstep(0.24, 0.94, progress))
    : lerp(56, 67, smoothstep(0.24, 0.94, progress));
  camera.updateProjectionMatrix();
  camera.rotation.x = lerp(0, -0.025, progress);
  camera.rotation.y = lerp(0, 0.045, progress);
  camera.rotation.z = 0;
}

function render(now) {
  if (!state.running) return;
  const delta = Math.min(0.05, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  state.elapsed += delta;
  state.progress += (state.targetProgress - state.progress) * (1 - Math.exp(-delta * 6.6));
  const velocity = reducedMotion ? 0 : 0.5 + smoothstep(0.02, 0.15, state.progress) * 2.5 + Math.pow(state.progress, 1.6) * 34.9;
  state.travel += velocity * delta;

  world.update(state.progress, state.elapsed, reducedMotion ? 0 : delta, state.travel);
  updateCamera(state.progress, state.elapsed, delta);

  renderer.toneMappingExposure = lerp(0.98, 1.36, smoothstep(0.3, 1, state.progress));
  bloomPass.strength = lerp(0.24, 0.92, smoothstep(0.12, 1, state.progress)) * (1 - smoothstep(0.82, 1, state.progress) * 0.26);
  bloomPass.radius = lerp(0.34, 0.7, state.progress);
  bloomPass.threshold = lerp(0.86, 0.68, state.progress);

  const finalWhite = smoothstep(0.94, 1, state.progress);
  arrival.style.opacity = String(Math.pow(finalWhite, 1.35) * 0.97);
  scrollCue.style.opacity = String(1 - smoothstep(0.02, 0.14, state.progress));

  composer.render();
  requestAnimationFrame(render);
}

function pause() {
  state.running = false;
}

function resume() {
  if (state.running) return;
  state.running = true;
  state.lastFrame = performance.now();
  requestAnimationFrame(render);
}

renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  pause();
  document.body.classList.add('webgl-unavailable');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  document.body.classList.remove('webgl-unavailable');
  resume();
});
window.addEventListener('resize', resize, { passive: true });
window.addEventListener('scroll', updateScrollProgress, { passive: true });
document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume());

resize();
updateScrollProgress();
requestAnimationFrame(render);
