import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage = document.querySelector('.neural-stage');
const arrival = document.querySelector('.white-arrival');
const scrollCue = document.querySelector('.scroll-cue');
const isMobile = window.innerWidth < 700;

const CONFIG = Object.freeze({
  clusterCount: isMobile ? 8 : 11,
  satellitesPerCluster: isMobile ? 7 : 10,
  microCount: isMobile ? 760 : 1500,
  streakCount: isMobile ? 260 : 560,
  pulseCount: isMobile ? 64 : 120,
  localSegments: 12,
  highwaySegments: 34,
  depthFar: 96,
  depthNear: 4,
});

const state = {
  targetProgress: 0,
  progress: reducedMotion ? 0.16 : 0,
  pointerX: 0,
  pointerY: 0,
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
scene.fog = new THREE.FogExp2(0x000000, 0.018);

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
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying float vPhase;
  varying float vVisibility;
  varying float vDepthFade;
  uniform float uTime;
  uniform float uProgress;

  void main() {
    float breathing = 1.0 + sin(uTime * (1.35 + uProgress) + aPhase) * (0.025 + uProgress * 0.018);
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position * aScale * breathing, 1.0);
    vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vViewDirection = normalize(cameraPosition - worldPosition.xyz);
    vPhase = aPhase;
    vVisibility = aVisibility;
    vDepthFade = 1.0 - smoothstep(56.0, 106.0, distance(cameraPosition, worldPosition.xyz));
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const shellFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying float vPhase;
  varying float vVisibility;
  varying float vDepthFade;
  uniform float uTime;
  uniform float uProgress;
  uniform float uBackface;
  uniform float uIntensity;

  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vViewDirection)));
    float fresnel = pow(1.0 - facing, 1.7);
    float rim = smoothstep(0.12, 0.92, fresnel);
    float pulse = 0.5 + 0.5 * sin(uTime * (1.75 + uProgress * 2.1) + vPhase);
    vec3 pearl = vec3(0.74, 0.88, 0.96);
    vec3 cyan = vec3(0.12, 0.58, 0.92);
    vec3 color = mix(pearl, cyan, 0.18 + pulse * 0.16 + uProgress * 0.12);
    float shell = mix(rim, 0.18 + rim * 0.54, uBackface);
    float interior = mix(0.008 + pulse * 0.008, 0.018 + pulse * 0.016, uBackface);
    float alpha = (interior + shell * mix(0.82, 0.24, uBackface)) * vVisibility * vDepthFade;
    vec3 radiance = color * (0.12 + shell * uIntensity + pulse * 0.13);
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

  void main() {
    vec3 p = position;
    p.z = mod(p.z + uTravel + 96.0, 100.0) - 96.0;
    p.x += sin(uTime * 0.16 + aPhase) * 0.08;
    p.y += cos(uTime * 0.13 + aPhase * 1.3) * 0.06;
    float threshold = 0.22 + uProgress * 0.84;
    float visible = 1.0 - smoothstep(threshold, threshold + 0.08, aRank);
    float depthFade = 1.0 - smoothstep(60.0, 98.0, -p.z);
    vPulse = 0.48 + 0.52 * sin(uTime * (0.7 + uProgress * 2.4) + aPhase);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    float screenRadius = length(viewPosition.xy / max(1.0, -viewPosition.z));
    float convergenceDropout = 1.0;
    if (uProgress > 0.62) {
      float centerExclusion = smoothstep(0.16, 0.34, screenRadius);
      float deterministicKeep = step(0.38 + uProgress * 0.24, fract(sin(aPhase * 91.7 + aRank * 413.1) * 43758.5453));
      convergenceDropout = mix(1.0, centerExclusion * deterministicKeep, smoothstep(0.62, 0.84, uProgress));
    }
    vAlpha = visible * depthFade * convergenceDropout * (0.32 + vPulse * 0.5);
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
    vec3 color = mix(vec3(0.24, 0.62, 0.82), vec3(0.84, 0.96, 1.0), vPulse);
    gl_FragColor = vec4(color * (core * 1.5 + halo * 0.35), vAlpha * (core + halo * 0.32));
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
    blending: THREE.AdditiveBlending,
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
    this.group.scale.set(isMobile ? 0.46 : 1, isMobile ? 0.94 : 1, 1);
    this.group.position.y = isMobile ? -0.9 : 0;
    scene.add(this.group);

    this.clusters = this.createClusters();
    this.satellites = this.createSatellites();
    this.hubPositions = this.clusters.map(() => new THREE.Vector3());
    this.satellitePositions = this.satellites.map(() => new THREE.Vector3());
    this.highways = this.createHighways();

    this.createHubMeshes();
    this.createSatelliteMeshes();
    this.createMicroField();
    this.createLocalLinks();
    this.createHighwayLinks();
    this.createPulses();
    this.createVelocityStreaks();
    this.createDestination();
    this.update(0, 0, 0.016, 0);
  }

  createClusters() {
    const positions = isMobile ? [
      [-1.7, 4.4, -2.4, 0.62],
      [1.55, 3.0, -8.5, 0.6],
      [-0.75, 1.55, -16.5, 0.56],
      [1.35, 0.15, -25.0, 0.6],
      [-1.45, -1.25, -35.0, 0.56],
      [0.85, -2.65, -47.0, 0.58],
      [-1.0, -4.0, -61.0, 0.54],
      [1.25, -5.1, -77.0, 0.58],
    ] : [
      [-4.0, 1.15, -1.8, 0.82],
      [2.9, -1.45, -6.5, 0.88],
      [-0.4, 2.3, -14.0, 0.72],
      [4.4, 0.8, -22.5, 0.98],
      [-3.0, -2.0, -31.0, 0.76],
      [0.7, 0.25, -39.5, 0.66],
      [-4.6, 1.8, -48.0, 0.92],
      [3.5, -1.3, -57.0, 0.78],
      [-0.8, 2.5, -66.0, 0.7],
      [4.7, 1.5, -76.0, 0.96],
      [-3.5, -1.5, -87.0, 0.82],
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
        const radius = 0.78 + (index % 4) * 0.29 + random() * 0.35;
        satellites.push({
          clusterIndex,
          offsetX: Math.cos(angle) * radius,
          offsetY: Math.sin(angle) * radius * 0.7,
          offsetZ: (index % 3 - 1) * 0.52 + (random() - 0.5) * 0.34,
          size: 0.105 + random() * 0.13,
          phase: cluster.phase + index * 0.62,
          rank: random(),
        });
      }
    });
    return satellites;
  }

  createHighways() {
    const pairs = [];
    for (let index = 0; index < CONFIG.clusterCount; index += 1) {
      pairs.push([index, (index + 1) % CONFIG.clusterCount]);
      if (index % 2 === 0) pairs.push([index, (index + 2) % CONFIG.clusterCount]);
      if (index % 3 === 0) pairs.push([index, (index + 4) % CONFIG.clusterCount]);
    }
    return pairs.map(([from, to], index) => ({
      from,
      to,
      arc: 1.7 + (index % 5) * 0.58,
      sign: index % 2 === 0 ? 1 : -1,
      rank: index / pairs.length,
      phase: index * 1.17,
    }));
  }

  createHubMeshes() {
    const count = this.clusters.length;
    const geometry = new THREE.IcosahedronGeometry(1, 4);
    this.hubScale = new Float32Array(count);
    this.hubPhase = new Float32Array(count);
    this.hubVisibility = new Float32Array(count);
    geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(this.hubScale, 1));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(this.hubPhase, 1));
    geometry.setAttribute('aVisibility', new THREE.InstancedBufferAttribute(this.hubVisibility, 1));

    this.hubFrontMaterial = createShellMaterial(THREE.FrontSide, isMobile ? 1.32 : 2.45);
    this.hubBackMaterial = createShellMaterial(THREE.BackSide, isMobile ? 0.5 : 1.1);
    this.hubBackMesh = new THREE.InstancedMesh(geometry, this.hubBackMaterial, count);
    this.hubFrontMesh = new THREE.InstancedMesh(geometry, this.hubFrontMaterial, count);
    for (const mesh of [this.hubBackMesh, this.hubFrontMesh]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }

    const coreGeometry = new THREE.SphereGeometry(1, 12, 12);
    this.hubCoreMaterial = new THREE.MeshBasicMaterial({
      color: 0xa7e5ff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.hubCoreMesh = new THREE.InstancedMesh(coreGeometry, this.hubCoreMaterial, count);
    this.hubCoreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.hubCoreMesh.frustumCulled = false;
    this.group.add(this.hubCoreMesh);
  }

  createSatelliteMeshes() {
    const count = this.satellites.length;
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    this.satelliteScale = new Float32Array(count);
    this.satellitePhase = new Float32Array(count);
    this.satelliteVisibility = new Float32Array(count);
    geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(this.satelliteScale, 1));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(this.satellitePhase, 1));
    geometry.setAttribute('aVisibility', new THREE.InstancedBufferAttribute(this.satelliteVisibility, 1));
    this.satelliteMaterial = createShellMaterial(THREE.DoubleSide, isMobile ? 0.92 : 1.65);
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
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.microField = new THREE.Points(geometry, this.microMaterial);
    this.microField.frustumCulled = false;
    this.group.add(this.microField);
  }

  createLineSystem(maxLinks, segments, opacity) {
    const vertexCount = maxLinks * segments * 2;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { positions, colors, geometry, material, mesh, segments };
  }

  createLocalLinks() {
    const linkCount = this.satellites.length * 2;
    this.localLineSystem = this.createLineSystem(linkCount, CONFIG.localSegments, 0.54);
  }

  createHighwayLinks() {
    this.highwayLineSystem = this.createLineSystem(this.highways.length, CONFIG.highwaySegments, 0.94);
  }

  createPulses() {
    const geometry = new THREE.SphereGeometry(0.082, 8, 8);
    this.pulseMaterial = new THREE.MeshBasicMaterial({
      color: 0xd9f5ff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.pulseMesh = new THREE.InstancedMesh(geometry, this.pulseMaterial, CONFIG.pulseCount * 3);
    this.pulseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pulseMesh.frustumCulled = false;
    this.pulses = Array.from({ length: CONFIG.pulseCount }, (_, index) => ({
      highwayIndex: index % this.highways.length,
      offset: random(),
      speed: 0.055 + random() * 0.11,
      rank: index / CONFIG.pulseCount,
      scale: 0.72 + random() * 1.25,
    }));
    this.group.add(this.pulseMesh);
  }

  createVelocityStreaks() {
    this.streakData = Array.from({ length: CONFIG.streakCount }, () => {
      const angle = random() * Math.PI * 2;
      const minimumRadius = isMobile ? 4.1 : 2.4;
      const radius = minimumRadius + Math.pow(random(), 0.62) * (isMobile ? 7.1 : 8.8);
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
    const threshold = 0.28 + progress * 0.84;
    return 1 - smoothstep(threshold, threshold + 0.12, cluster.rank);
  }

  updatePositions(progress, elapsed, travel) {
    const hubMatrix = new THREE.Matrix4();
    const coreMatrix = new THREE.Matrix4();
    const satelliteMatrix = new THREE.Matrix4();
    const unitQuaternion = new THREE.Quaternion();

    this.clusters.forEach((cluster, index) => {
      const z = wrapDepth(cluster.z + travel * cluster.speed);
      const drift = 0.12 + progress * 0.06;
      const x = cluster.x + Math.sin(elapsed * 0.19 + cluster.phase) * drift;
      const y = cluster.y + Math.cos(elapsed * 0.16 + cluster.phase * 1.2) * drift * 0.72;
      const position = this.hubPositions[index].set(x, y, z);
      const mobileVelocityFade = isMobile ? 1 - smoothstep(0.54, 0.82, progress) * 0.98 : 1;
      const visibility = this.clusterVisibility(cluster, progress) * mobileVelocityFade;
      const nearFactor = smoothstep(-34, 4, z);
      const scale = cluster.size * (0.86 + nearFactor * 0.44) * (isMobile ? 0.68 : 1);
      hubMatrix.compose(position, unitQuaternion, new THREE.Vector3(1, 1, 1));
      this.hubFrontMesh.setMatrixAt(index, hubMatrix);
      this.hubBackMesh.setMatrixAt(index, hubMatrix);
      this.hubScale[index] = scale;
      this.hubPhase[index] = cluster.phase;
      this.hubVisibility[index] = visibility;
      const coreScale = scale * (0.12 + Math.sin(elapsed * 2.2 + cluster.phase) * 0.025 + progress * 0.05) * visibility;
      coreMatrix.compose(position, unitQuaternion, new THREE.Vector3(coreScale, coreScale, coreScale));
      this.hubCoreMesh.setMatrixAt(index, coreMatrix);
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
      const mobileShellFade = isMobile ? 1 - smoothstep(0.54, 0.82, progress) * 0.98 : 1;
      const satelliteVisible = (1 - smoothstep(0.42 + progress * 0.58, 0.56 + progress * 0.58, satellite.rank)) * mobileShellFade;
      satelliteMatrix.compose(position, unitQuaternion, new THREE.Vector3(1, 1, 1));
      this.satelliteMesh.setMatrixAt(index, satelliteMatrix);
      this.satelliteScale[index] = satellite.size * (0.9 + smoothstep(-30, 4, z) * 0.32) * (isMobile ? 0.74 : 1);
      this.satellitePhase[index] = satellite.phase;
      this.satelliteVisibility[index] = clusterVisible * satelliteVisible;
    });

    for (const mesh of [this.hubFrontMesh, this.hubBackMesh, this.hubCoreMesh, this.satelliteMesh]) {
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

  quadraticPoint(start, end, arc, sign, t, target) {
    const control = new THREE.Vector3().lerpVectors(start, end, 0.5);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(0.1, Math.hypot(dx, dy));
    control.x += (-dy / length) * arc * sign;
    control.y += (dx / length) * arc * sign + arc * 0.28;
    control.z -= arc * 0.34;
    const inverse = 1 - t;
    return target.set(
      inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
      inverse * inverse * start.z + 2 * inverse * t * control.z + t * t * end.z,
    );
  }

  writeCurve(system, start, end, arc, sign, intensity, color, vertexOffset) {
    const pointA = new THREE.Vector3();
    const pointB = new THREE.Vector3();
    for (let segment = 0; segment < system.segments; segment += 1) {
      const t0 = segment / system.segments;
      const t1 = (segment + 1) / system.segments;
      this.quadraticPoint(start, end, arc, sign, t0, pointA);
      this.quadraticPoint(start, end, arc, sign, t1, pointB);
      const fade = (0.18 + Math.sin((t0 + t1) * 0.5 * Math.PI) * 0.82) * intensity;
      for (const point of [pointA, pointB]) {
        system.positions[vertexOffset * 3] = point.x;
        system.positions[vertexOffset * 3 + 1] = point.y;
        system.positions[vertexOffset * 3 + 2] = point.z;
        system.colors[vertexOffset * 3] = color.r * fade;
        system.colors[vertexOffset * 3 + 1] = color.g * fade;
        system.colors[vertexOffset * 3 + 2] = color.b * fade;
        vertexOffset += 1;
      }
    }
    return vertexOffset;
  }

  updateLocalLinks(progress, elapsed) {
    const system = this.localLineSystem;
    const color = new THREE.Color(0.22, 0.55, 0.75);
    let vertexOffset = 0;
    this.satellites.forEach((satellite, index) => {
      const cluster = this.clusters[satellite.clusterIndex];
      const visibility = this.clusterVisibility(cluster, progress);
      if (visibility < 0.02 || satellite.rank > 0.38 + progress * 0.58) return;
      const start = this.hubPositions[satellite.clusterIndex];
      const end = this.satellitePositions[index];
      const fire = 0.62 + 0.38 * Math.sin(elapsed * 0.9 + satellite.phase);
      if (index % 3 === 0) {
        vertexOffset = this.writeCurve(system, start, end, 0.34, index % 2 ? 1 : -1, visibility * (0.3 + fire * 0.24), color, vertexOffset);
      }
      const localIndex = index % CONFIG.satellitesPerCluster;
      const siblingIndex = satellite.clusterIndex * CONFIG.satellitesPerCluster + (localIndex + 1) % CONFIG.satellitesPerCluster;
      const sibling = this.satellitePositions[siblingIndex];
      if (sibling) vertexOffset = this.writeCurve(system, end, sibling, 0.3, index % 2 ? -1 : 1, visibility * (0.38 + fire * 0.16), color, vertexOffset);
    });
    system.geometry.setDrawRange(0, vertexOffset);
    system.geometry.attributes.position.needsUpdate = true;
    system.geometry.attributes.color.needsUpdate = true;
    system.material.opacity = isMobile ? 0.54 * (1 - smoothstep(0.62, 0.9, progress) * 0.78) : 0.54;
  }

  highwayVisible(highway, progress) {
    const start = this.hubPositions[highway.from];
    const end = this.hubPositions[highway.to];
    const separation = Math.abs(start.z - end.z);
    const threshold = 0.18 + progress * 0.98;
    return separation < 33 && highway.rank <= threshold;
  }

  updateHighways(progress, elapsed) {
    const system = this.highwayLineSystem;
    let vertexOffset = 0;
    this.highways.forEach((highway) => {
      if (!this.highwayVisible(highway, progress)) return;
      const start = this.hubPositions[highway.from];
      const end = this.hubPositions[highway.to];
      const fire = smoothstep(0.42, 1, Math.sin(elapsed * (0.55 + progress * 1.6) + highway.phase) * 0.5 + 0.5);
      const color = new THREE.Color(0.42, 0.74, 0.94).lerp(new THREE.Color(0.9, 0.98, 1), fire * 0.72);
      const mobileHighwayEnergy = isMobile ? 0.68 * (1 - smoothstep(0.62, 0.92, progress) * 0.64) : 1;
      const intensity = (0.82 + progress * 0.68 + fire * 0.3) * mobileHighwayEnergy;
      vertexOffset = this.writeCurve(system, start, end, highway.arc, highway.sign, intensity, color, vertexOffset);
    });
    system.geometry.setDrawRange(0, vertexOffset);
    system.geometry.attributes.position.needsUpdate = true;
    system.geometry.attributes.color.needsUpdate = true;
    system.material.opacity = isMobile ? 0.94 * (1 - smoothstep(0.58, 0.84, progress) * 0.96) : 0.94;
  }

  updatePulses(progress, elapsed) {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    let instanceIndex = 0;
    for (const pulse of this.pulses) {
      const highway = this.highways[pulse.highwayIndex];
      const visible = this.highwayVisible(highway, progress) && pulse.rank <= 0.2 + progress * 0.88;
      const speed = pulse.speed * (1 + progress * 4.2);
      const t = (elapsed * speed + pulse.offset) % 1;
      for (let ghost = 0; ghost < 3; ghost += 1) {
        const ghostT = Math.max(0, t - ghost * (0.018 + progress * 0.012));
        if (visible) {
          this.quadraticPoint(
            this.hubPositions[highway.from],
            this.hubPositions[highway.to],
            highway.arc,
            highway.sign,
            ghostT,
            position,
          );
        } else position.set(0, 0, -120);
        const mobilePulseFade = isMobile ? 1 - smoothstep(0.56, 0.8, progress) : 1;
      const scale = visible ? pulse.scale * (1 - ghost * 0.27) * (0.82 + progress * 0.7) * (isMobile ? 0.42 : 1) * mobilePulseFade : 0;
        matrix.compose(position, quaternion, new THREE.Vector3(scale, scale, scale));
        this.pulseMesh.setMatrixAt(instanceIndex, matrix);
        instanceIndex += 1;
      }
    }
    this.pulseMesh.instanceMatrix.needsUpdate = true;
    this.pulseMaterial.opacity = isMobile ? 0.36 + progress * 0.08 : 0.78 + progress * 0.22;
  }

  updateStreaks(progress, travel) {
    const active = smoothstep(0.2, 0.9, progress);
    const length = 0.22 + Math.pow(progress, 2.15) * (isMobile ? 6.8 : 9.4);
    this.streakData.forEach((streak, index) => {
      const z = wrapDepth(streak.z + travel * streak.speed);
      const visible = streak.rank < 0.14 + progress * 0.9 ? active : 0;
      const base = index * 6;
      const directional = isMobile ? smoothstep(0.56, 0.84, progress) : 0;
      const radialStartX = streak.x;
      const radialStartY = streak.y;
      const radialStartZ = z - length * streak.speed;
      const sweptStartX = streak.x + (streak.rank - 0.5) * length * 0.32;
      const sweptStartY = streak.y + length * (0.42 + streak.rank * 0.16);
      const sweptStartZ = z;
      this.streakPositions[base] = lerp(radialStartX, sweptStartX, directional);
      this.streakPositions[base + 1] = lerp(radialStartY, sweptStartY, directional);
      this.streakPositions[base + 2] = lerp(radialStartZ, sweptStartZ, directional);
      this.streakPositions[base + 3] = streak.x;
      this.streakPositions[base + 4] = streak.y;
      this.streakPositions[base + 5] = z;
      this.streakColors[base] = 0.04 * visible;
      this.streakColors[base + 1] = 0.13 * visible;
      this.streakColors[base + 2] = 0.22 * visible;
      this.streakColors[base + 3] = (0.48 + progress * 0.34) * visible;
      this.streakColors[base + 4] = (0.74 + progress * 0.24) * visible;
      this.streakColors[base + 5] = visible;
    });
    this.streakGeometry.attributes.position.needsUpdate = true;
    this.streakGeometry.attributes.color.needsUpdate = true;
    this.streakMaterial.opacity = active * (isMobile ? 0.32 + progress * 0.28 : 0.48 + progress * 0.42);
  }

  updateMaterials(progress, elapsed, travel) {
    for (const material of [this.hubFrontMaterial, this.hubBackMaterial, this.satelliteMaterial]) {
      material.uniforms.uTime.value = elapsed;
      material.uniforms.uProgress.value = progress;
    }
    this.microMaterial.uniforms.uTime.value = elapsed;
    this.microMaterial.uniforms.uTravel.value = travel;
    this.microMaterial.uniforms.uProgress.value = progress;
    this.hubCoreMaterial.opacity = isMobile
      ? (0.025 + progress * 0.025) * (1 - smoothstep(0.62, 0.9, progress))
      : 0.12 + progress * 0.18;
    const destinationProgress = isMobile ? smoothstep(0.955, 1, progress) : smoothstep(0.62, 0.98, progress);
    const destinationStrength = isMobile ? 0.08 : 0.48;
    this.destinationMaterial.opacity = destinationProgress * (0.015 + progress * destinationStrength);
  }

  update(progress, elapsed, delta, travel) {
    this.updatePositions(progress, elapsed, travel);
    this.updateLocalLinks(progress, elapsed);
    this.updateHighways(progress, elapsed);
    this.updatePulses(progress, elapsed);
    this.updateStreaks(progress, travel);
    this.updateMaterials(progress, elapsed, travel);
    this.group.rotation.z = Math.sin(elapsed * 0.07) * 0.012;
    if (isMobile) this.group.position.y = lerp(-0.9, 0.75, smoothstep(0.08, 0.82, progress));
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
  const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  state.targetProgress = reducedMotion ? 0.16 : clamp(window.scrollY / range, 0, 1);
}

function updatePointer(event) {
  state.pointerX = event.clientX / window.innerWidth * 2 - 1;
  state.pointerY = event.clientY / window.innerHeight * 2 - 1;
}

function updateCamera(progress, elapsed, delta) {
  const mobileScale = isMobile ? 0.54 : 1;
  const targetX = lerp(-0.35, 0.75, smoothstep(0.12, 0.84, progress)) * mobileScale + state.pointerX * (isMobile ? 0.06 : 0.16);
  const targetY = lerp(0.15, -0.3, smoothstep(0.18, 0.9, progress)) * mobileScale - state.pointerY * (isMobile ? 0.04 : 0.1);
  const targetZ = lerp(isMobile ? 8.2 : 7.2, isMobile ? 6.7 : 5.15, smoothstep(0.08, 0.88, progress));
  const ease = 1 - Math.exp(-delta * 2.5);
  camera.position.x += (targetX - camera.position.x) * ease;
  camera.position.y += (targetY - camera.position.y) * ease;
  camera.position.z += (targetZ - camera.position.z) * ease;
  camera.fov = isMobile
    ? lerp(62, 72, smoothstep(0.24, 0.94, progress))
    : lerp(56, 67, smoothstep(0.24, 0.94, progress));
  camera.updateProjectionMatrix();
  camera.rotation.x = lerp(0, -0.025, progress) + Math.sin(elapsed * 0.11) * 0.003;
  camera.rotation.y = lerp(0, 0.045, progress) + state.pointerX * 0.004;
  camera.rotation.z = Math.sin(elapsed * 0.13) * 0.005;
}

function render(now) {
  if (!state.running) return;
  const delta = Math.min(0.05, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  state.elapsed += delta;
  state.progress += (state.targetProgress - state.progress) * (1 - Math.exp(-delta * 6.6));
  const velocity = reducedMotion ? 0 : 0.34 + Math.pow(state.progress, 2.25) * 17.8;
  state.travel += velocity * delta;

  world.update(state.progress, state.elapsed, reducedMotion ? 0 : delta, state.travel);
  updateCamera(state.progress, state.elapsed, delta);

  scene.fog.density = lerp(0.018, 0.0075, smoothstep(0.25, 0.96, state.progress));
  renderer.toneMappingExposure = isMobile
    ? lerp(0.94, 1.06, smoothstep(0.3, 1, state.progress))
    : lerp(1.02, 1.62, smoothstep(0.3, 1, state.progress));
  bloomPass.strength = isMobile
    ? lerp(0.1, 0.16, smoothstep(0.2, 1, state.progress))
    : lerp(0.45, 1.38, smoothstep(0.2, 1, state.progress));
  bloomPass.radius = isMobile ? lerp(0.3, 0.42, state.progress) : lerp(0.62, 0.88, state.progress);
  bloomPass.threshold = isMobile ? lerp(0.95, 0.9, state.progress) : lerp(0.74, 0.48, state.progress);

  const finalWhite = smoothstep(isMobile ? 0.91 : 0.965, isMobile ? 0.985 : 1, state.progress);
  arrival.style.opacity = String(Math.pow(finalWhite, isMobile ? 1.15 : 1.7) * (isMobile ? 1 : 0.93));
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
window.addEventListener('pointermove', updatePointer, { passive: true });
document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume());

resize();
updateScrollProgress();
requestAnimationFrame(render);
