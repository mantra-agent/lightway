import * as THREE from 'three';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage = document.querySelector('.neural-stage');
const arrival = document.querySelector('.white-arrival');
const scrollCue = document.querySelector('.scroll-cue');

const CONFIG = Object.freeze({
  nodeCount: window.innerWidth < 700 ? 84 : 164,
  maxLinks: window.innerWidth < 700 ? 138 : 292,
  linkSegments: 24,
  pulseCount: window.innerWidth < 700 ? 92 : 190,
  depthNear: 6,
  depthFar: 88,
});

const state = {
  targetProgress: 0,
  progress: reducedMotion ? 0.16 : 0,
  pointerX: 0,
  pointerY: 0,
  elapsed: 0,
  lastFrame: performance.now(),
  running: true,
};

function smoothstep(edge0, edge1, value) {
  const x = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function createRenderer() {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
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
scene.fog = new THREE.FogExp2(0x000000, 0.021);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 140);
camera.position.set(0, 0, 7.2);

const nodeVertexShader = `
  attribute float aScale;
  attribute float aPhase;
  attribute float aVisibility;
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying float vPhase;
  varying float vVisibility;
  uniform float uTime;
  uniform float uProgress;

  void main() {
    float breathing = 1.0 + sin(uTime * 1.7 + aPhase) * (0.035 + uProgress * 0.025);
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position * aScale * breathing, 1.0);
    vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vViewDirection = normalize(cameraPosition - worldPosition.xyz);
    vPhase = aPhase;
    vVisibility = aVisibility;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const nodeFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  varying float vPhase;
  varying float vVisibility;
  uniform float uTime;
  uniform float uProgress;

  void main() {
    float facing = max(dot(normalize(vNormal), normalize(vViewDirection)), 0.0);
    float fresnel = pow(1.0 - facing, 2.0);
    float rim = smoothstep(0.18, 0.92, fresnel);
    float pulse = 0.5 + 0.5 * sin(uTime * (1.9 + uProgress * 2.2) + vPhase);
    vec3 pearl = vec3(0.78, 0.88, 0.94);
    vec3 cyan = vec3(0.22, 0.68, 0.9);
    vec3 color = mix(pearl, cyan, 0.18 + pulse * 0.16 + uProgress * 0.12);
    float interior = 0.006 + pulse * 0.008;
    float alpha = (interior + rim * (0.5 + pulse * 0.28)) * vVisibility;
    gl_FragColor = vec4(color * (0.18 + rim * 1.9 + pulse * 0.1), alpha);
  }
`;

class NeuralField {
  constructor() {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.nodes = Array.from({ length: CONFIG.nodeCount }, (_, index) => this.createNode(index));
    this.nodeMatrices = new Float32Array(CONFIG.nodeCount * 16);
    this.nodeScales = new Float32Array(CONFIG.nodeCount);
    this.nodePhases = new Float32Array(CONFIG.nodeCount);
    this.nodeVisibility = new Float32Array(CONFIG.nodeCount);
    this.nodePositions = this.nodes.map(() => new THREE.Vector3());
    this.previousPositions = this.nodes.map(() => new THREE.Vector3());

    this.createNodeMeshes();
    this.links = this.createLinks();
    this.createLinkMesh();
    this.createTrailMesh();
    this.createPulses();
    this.update(0, 0, 0.016);
  }

  createNode(index) {
    const cluster = index % 11;
    const ring = Math.floor(index / 11);
    const angle = cluster * (Math.PI * 2 / 11) + ring * 0.37 + Math.random() * 0.26;
    const radius = 1.3 + (ring % 4) * 1.15 + Math.random() * 1.8;
    return {
      baseX: Math.cos(angle) * radius + (Math.random() - 0.5) * 1.2,
      baseY: Math.sin(angle) * radius * 0.68 + (Math.random() - 0.5) * 1.1,
      z: -(Math.random() * (CONFIG.depthFar - CONFIG.depthNear) + CONFIG.depthNear),
      speed: 0.72 + Math.random() * 0.72,
      size: 0.1 + Math.pow(Math.random(), 2) * 0.28,
      phase: Math.random() * Math.PI * 2,
      drift: 0.14 + Math.random() * 0.34,
      visibilityRank: index / CONFIG.nodeCount,
    };
  }

  createNodeMeshes() {
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(this.nodeScales, 1));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(this.nodePhases, 1));
    geometry.setAttribute('aVisibility', new THREE.InstancedBufferAttribute(this.nodeVisibility, 1));

    this.nodeMaterial = new THREE.ShaderMaterial({
      vertexShader: nodeVertexShader,
      fragmentShader: nodeFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.nodeMesh = new THREE.InstancedMesh(geometry, this.nodeMaterial, CONFIG.nodeCount);
    this.nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nodeMesh.frustumCulled = false;
    this.group.add(this.nodeMesh);
  }

  createLinks() {
    const links = [];
    const used = new Set();
    const addLink = (from, to, bridge) => {
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      if (from === to || used.has(key) || links.length >= CONFIG.maxLinks) return;
      used.add(key);
      links.push({
        from,
        to,
        bridge,
        phase: Math.random() * Math.PI * 2,
        rank: Math.random(),
        arcSign: Math.random() < 0.5 ? -1 : 1,
        arc: 0.42 + Math.random() * 1.18,
        speed: 0.22 + Math.random() * 0.48,
      });
    };

    for (let index = 0; index < CONFIG.nodeCount; index += 1) {
      addLink(index, (index + 1 + Math.floor(Math.random() * 3)) % CONFIG.nodeCount, false);
      if (index % 2 === 0) addLink(index, (index + 9 + Math.floor(Math.random() * 7)) % CONFIG.nodeCount, false);
      if (index % 3 === 0) addLink(index, (index + 28 + Math.floor(Math.random() * 19)) % CONFIG.nodeCount, true);
    }

    while (links.length < CONFIG.maxLinks) {
      const from = Math.floor(Math.random() * CONFIG.nodeCount);
      const distance = Math.random() < 0.54 ? 1 + Math.floor(Math.random() * 14) : 18 + Math.floor(Math.random() * 42);
      addLink(from, (from + distance) % CONFIG.nodeCount, distance > 17);
    }
    return links;
  }

  createLinkMesh() {
    const vertexCount = CONFIG.maxLinks * CONFIG.linkSegments * 2;
    this.linkPositions = new Float32Array(vertexCount * 3);
    this.linkColors = new Float32Array(vertexCount * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.linkPositions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.linkColors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.linkGeometry = geometry;
    this.linkMesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.linkMesh.frustumCulled = false;
    this.group.add(this.linkMesh);
  }

  createTrailMesh() {
    this.trailPositions = new Float32Array(CONFIG.nodeCount * 2 * 3);
    this.trailColors = new Float32Array(CONFIG.nodeCount * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeometry = geometry;
    this.trailMesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.trailMesh.frustumCulled = false;
    this.group.add(this.trailMesh);
  }

  createPulses() {
    const geometry = new THREE.SphereGeometry(0.055, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: 0xcdefff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.pulseMesh = new THREE.InstancedMesh(geometry, material, CONFIG.pulseCount);
    this.pulseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pulseMesh.frustumCulled = false;
    this.pulseData = Array.from({ length: CONFIG.pulseCount }, (_, index) => ({
      linkIndex: index % this.links.length,
      offset: Math.random(),
      speed: 0.11 + Math.random() * 0.22,
      rank: index / CONFIG.pulseCount,
      scale: 0.55 + Math.random() * 1.3,
    }));
    this.group.add(this.pulseMesh);
  }

  updateNodePositions(progress, elapsed, delta) {
    const visibleThreshold = 0.25 + progress * 0.86;
    const velocity = 0.42 + Math.pow(progress, 2.25) * 15.5;
    const breathingRate = 0.62 + progress * 0.95;
    const matrix = new THREE.Matrix4();

    this.nodes.forEach((node, index) => {
      const previous = this.nodePositions[index];
      this.previousPositions[index].copy(previous);
      node.z += velocity * node.speed * delta;
      if (node.z > 7) node.z -= CONFIG.depthFar + 10;

      const depthFactor = THREE.MathUtils.clamp((node.z + CONFIG.depthFar) / CONFIG.depthFar, 0, 1);
      const drift = node.drift * (0.32 + depthFactor * 0.68);
      const x = node.baseX + Math.sin(elapsed * breathingRate + node.phase) * drift;
      const y = node.baseY + Math.cos(elapsed * breathingRate * 0.78 + node.phase * 1.3) * drift * 0.62;
      previous.set(x, y, node.z);

      const visibility = smoothstep(node.visibilityRank - 0.08, node.visibilityRank + 0.12, visibleThreshold);
      const nearScale = 0.75 + depthFactor * 0.85;
      matrix.makeTranslation(x, y, node.z);
      this.nodeMesh.setMatrixAt(index, matrix);
      this.nodeScales[index] = node.size * nearScale;
      this.nodePhases[index] = node.phase;
      this.nodeVisibility[index] = visibility;
    });

    this.nodeMesh.instanceMatrix.needsUpdate = true;
    this.nodeMesh.geometry.attributes.aScale.needsUpdate = true;
    this.nodeMesh.geometry.attributes.aPhase.needsUpdate = true;
    this.nodeMesh.geometry.attributes.aVisibility.needsUpdate = true;
    this.nodeMaterial.uniforms.uTime.value = elapsed;
    this.nodeMaterial.uniforms.uProgress.value = progress;
  }

  curvePoint(link, t, target = new THREE.Vector3()) {
    const start = this.nodePositions[link.from];
    const end = this.nodePositions[link.to];
    const control = new THREE.Vector3().lerpVectors(start, end, 0.5);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const horizontalLength = Math.max(0.1, Math.hypot(dx, dy));
    control.x += (-dy / horizontalLength) * link.arc * link.arcSign;
    control.y += (dx / horizontalLength) * link.arc * link.arcSign;
    control.z -= link.bridge ? 0.7 : 0.22;
    const inverse = 1 - t;
    target.set(
      inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
      inverse * inverse * start.z + 2 * inverse * t * control.z + t * t * end.z,
    );
    return target;
  }

  updateLinks(progress, elapsed) {
    const localThreshold = 0.23 + progress * 0.58;
    const bridgeThreshold = Math.max(0, (progress - 0.24) / 0.76);
    const warm = new THREE.Color(0.34, 0.66, 0.78);
    const bright = new THREE.Color(0.82, 0.95, 1);
    let vertexOffset = 0;
    const pointA = new THREE.Vector3();
    const pointB = new THREE.Vector3();

    this.links.forEach((link) => {
      const threshold = link.bridge ? bridgeThreshold : localThreshold;
      if (link.rank > threshold) return;
      const fire = 0.3 + 0.7 * smoothstep(0.52, 1, Math.sin(elapsed * (0.8 + progress * 2.6) + link.phase) * 0.5 + 0.5);
      const color = warm.clone().lerp(bright, fire * (0.35 + progress * 0.45));
      for (let segment = 0; segment < CONFIG.linkSegments; segment += 1) {
        const t0 = segment / CONFIG.linkSegments;
        const t1 = (segment + 1) / CONFIG.linkSegments;
        this.curvePoint(link, t0, pointA);
        this.curvePoint(link, t1, pointB);
        const edgeFade = Math.sin(t0 * Math.PI) * 0.64 + 0.18;
        const intensity = edgeFade * (link.bridge ? 0.52 + progress * 0.36 : 0.74);
        for (const point of [pointA, pointB]) {
          this.linkPositions[vertexOffset * 3] = point.x;
          this.linkPositions[vertexOffset * 3 + 1] = point.y;
          this.linkPositions[vertexOffset * 3 + 2] = point.z;
          this.linkColors[vertexOffset * 3] = color.r * intensity;
          this.linkColors[vertexOffset * 3 + 1] = color.g * intensity;
          this.linkColors[vertexOffset * 3 + 2] = color.b * intensity;
          vertexOffset += 1;
        }
      }
    });

    this.linkGeometry.setDrawRange(0, vertexOffset);
    this.linkGeometry.attributes.position.needsUpdate = true;
    this.linkGeometry.attributes.color.needsUpdate = true;
  }

  updateTrails(progress) {
    const trailLength = smoothstep(0.24, 0.94, progress) * (0.25 + progress * 3.9);
    const visibleThreshold = 0.25 + progress * 0.86;
    this.nodes.forEach((node, index) => {
      const position = this.nodePositions[index];
      const base = index * 6;
      const visibility = smoothstep(node.visibilityRank - 0.08, node.visibilityRank + 0.12, visibleThreshold);
      this.trailPositions[base] = position.x;
      this.trailPositions[base + 1] = position.y;
      this.trailPositions[base + 2] = position.z - trailLength * node.speed;
      this.trailPositions[base + 3] = position.x;
      this.trailPositions[base + 4] = position.y;
      this.trailPositions[base + 5] = position.z;
      this.trailColors[base] = 0.04 * visibility;
      this.trailColors[base + 1] = 0.14 * visibility;
      this.trailColors[base + 2] = 0.2 * visibility;
      this.trailColors[base + 3] = (0.36 + progress * 0.38) * visibility;
      this.trailColors[base + 4] = (0.7 + progress * 0.24) * visibility;
      this.trailColors[base + 5] = 1 * visibility;
    });
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.trailGeometry.attributes.color.needsUpdate = true;
    this.trailMesh.material.opacity = smoothstep(0.2, 0.8, progress) * 0.74;
  }

  updatePulses(progress, elapsed) {
    const visibleCount = Math.floor(CONFIG.pulseCount * (0.16 + progress * 0.84));
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    this.pulseData.forEach((pulse, index) => {
      const link = this.links[pulse.linkIndex];
      const pulseProgress = (elapsed * pulse.speed * (1 + progress * 2.8) + pulse.offset) % 1;
      this.curvePoint(link, pulseProgress, position);
      const visibility = index < visibleCount ? 1 : 0;
      const scale = pulse.scale * visibility * (0.65 + progress * 0.55);
      matrix.compose(position, new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      this.pulseMesh.setMatrixAt(index, matrix);
    });
    this.pulseMesh.instanceMatrix.needsUpdate = true;
  }

  update(progress, elapsed, delta) {
    this.updateNodePositions(progress, elapsed, delta);
    this.updateLinks(progress, elapsed);
    this.updateTrails(progress);
    this.updatePulses(progress, elapsed);
    this.group.rotation.z = Math.sin(elapsed * 0.08) * 0.018;
    this.group.scale.setScalar(1.12);
  }
}

const field = new NeuralField();

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
}

function updateScrollProgress() {
  const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  state.targetProgress = reducedMotion ? 0.16 : THREE.MathUtils.clamp(window.scrollY / range, 0, 1);
}

function updatePointer(event) {
  state.pointerX = event.clientX / window.innerWidth * 2 - 1;
  state.pointerY = event.clientY / window.innerHeight * 2 - 1;
}

function render(now) {
  if (!state.running) return;
  const delta = Math.min(0.05, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  state.elapsed += delta;
  state.progress += (state.targetProgress - state.progress) * (1 - Math.exp(-delta * 6.8));

  field.update(state.progress, state.elapsed, reducedMotion ? 0 : delta);

  camera.position.x += ((state.pointerX * 0.22) - camera.position.x) * (1 - Math.exp(-delta * 2.3));
  camera.position.y += ((-state.pointerY * 0.14) - camera.position.y) * (1 - Math.exp(-delta * 2.3));
  camera.rotation.z = Math.sin(state.elapsed * 0.13) * 0.006;
  scene.fog.density = 0.021 - state.progress * 0.009;
  renderer.toneMappingExposure = 1.04 + state.progress * 0.72;

  const whiteProgress = smoothstep(0.74, 1, state.progress);
  arrival.style.opacity = String(Math.pow(whiteProgress, 1.38) * 0.96);
  scrollCue.style.opacity = String(1 - smoothstep(0.02, 0.14, state.progress));

  renderer.render(scene, camera);
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
