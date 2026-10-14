import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

const $ = (id) => document.getElementById(id);
const data = await fetch('/api/portfolio').then((r) => r.json()).catch(() => ({ clients: [] }));
const clients = data.clients;

// ---------- renderer / scene ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07070a);
scene.fog = new THREE.FogExp2(0x07070a, 0.045);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

// ---------- floor: real planar reflection + dark glossy tint ----------
const floorSize = 80;
const mirror = new Reflector(new THREE.PlaneGeometry(floorSize, floorSize), {
  textureWidth: innerWidth * Math.min(devicePixelRatio, 1.5), textureHeight: innerHeight * Math.min(devicePixelRatio, 1.5), color: 0x2a2a30, clipBias: 0.003,
});
mirror.rotation.x = -Math.PI / 2;
scene.add(mirror);
const tint = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.35, metalness: 0.6, transparent: true, opacity: 0.72 }));
tint.rotation.x = -Math.PI / 2; tint.position.y = 0.002; tint.receiveShadow = true;
scene.add(tint);

// back wall with subtle vertical ribs
const wallMat = new THREE.MeshStandardMaterial({ color: 0x15151b, roughness: 0.85, metalness: 0.05 });
const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 16), wallMat);
wall.position.set(0, 8, -9); wall.receiveShadow = true; scene.add(wall);
const ribGeo = new RoundedBoxGeometry(0.18, 12, 0.3, 3, 0.05);
const ribMat = new THREE.MeshStandardMaterial({ color: 0x1d1d25, roughness: 0.5, metalness: 0.4 });
for (let i = -14; i <= 14; i++) { const r = new THREE.Mesh(ribGeo, ribMat); r.position.set(i * 1.9, 6, -8.8); r.castShadow = r.receiveShadow = true; scene.add(r); }

// lights
scene.add(new THREE.HemisphereLight(0x8890b0, 0x0a0a0c, 0.25));
const key = new THREE.SpotLight(0xfff1d6, 120, 40, 0.5, 0.6, 1.4);
key.position.set(0, 11, 6); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.radius = 5;
scene.add(key, key.target);

// ---------- screens ----------
const SPACING = 4.6, W = 2.4, H = 4.27; // 9:16 portrait screens
const screens = [];
const videoEls = [];

function placeholderTexture(c) {
  const cv = document.createElement('canvas'); cv.width = 576; cv.height = 1024;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 576, 1024); grad.addColorStop(0, '#16161d'); grad.addColorStop(1, c.accent);
  g.fillStyle = grad; g.fillRect(0, 0, 576, 1024);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.direction = 'rtl'; g.font = '700 64px system-ui, Tahoma, sans-serif';
  g.fillText(c.name.slice(0, 18), 288, 512);
  g.font = '28px system-ui'; g.globalAlpha = 0.7; g.fillText(c.videos.length ? '' : 'قريباً', 288, 570);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

clients.forEach((c, i) => {
  const group = new THREE.Group();
  const frame = new THREE.Mesh(
    new RoundedBoxGeometry(W + 0.22, H + 0.22, 0.22, 4, 0.06),
    new THREE.MeshPhysicalMaterial({ color: 0x0b0b0e, metalness: 0.9, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 }),
  );
  frame.castShadow = true; frame.receiveShadow = true;
  const accent = new THREE.Mesh(new THREE.BoxGeometry(W + 0.26, 0.035, 0.24), new THREE.MeshStandardMaterial({ color: c.accent, emissive: c.accent, emissiveIntensity: 0.7, roughness: 0.4 }));
  accent.position.y = -(H + 0.22) / 2 - 0.02;

  let tex = placeholderTexture(c);
  if (c.videos[0]) {
    const v = document.createElement('video');
    Object.assign(v, { src: c.videos[0].url, muted: true, loop: true, playsInline: true, crossOrigin: 'anonymous', preload: 'auto' });
    v.setAttribute('muted', ''); v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none'; document.body.append(v); videoEls.push(v); v.play().catch(() => {});
    const vt = new THREE.VideoTexture(v); vt.colorSpace = THREE.SRGBColorSpace;
    v.addEventListener('loadeddata', () => { tex = vt; face.material.map = vt; face.material.emissiveMap = vt; face.material.needsUpdate = true; v.play().catch(() => {}); });
  }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.6, metalness: 0 }));
  face.position.z = 0.115;
  const glow = new THREE.PointLight(c.accent, 3, 9, 2); glow.position.set(0, -H / 2, 3.5);
  group.add(frame, accent, face, glow);
  group.position.set(i * SPACING, H / 2 + 0.55, -2.2);
  scene.add(group);
  screens.push({ group, face, c });
});

// empty state: a single marker so the scene is never blank
if (!clients.length) {
  const m = new THREE.Mesh(new THREE.TorusKnotGeometry(0.8, 0.26, 200, 32), new THREE.MeshPhysicalMaterial({ color: 0xc8a45c, metalness: 1, roughness: 0.18, clearcoat: 1 }));
  m.position.set(0, 2.2, -2); m.castShadow = true; scene.add(m);
  screens.push({ group: m, c: { name: 'S5Y', description: 'المعرض قيد التجهيز', videos: [], accent: '#c8a45c' }, spin: true });
}

// ---------- navigation ----------
let index = 0, target = 0, pos = 0;
const mouse = new THREE.Vector2();
const n = screens.length;
$('dots').innerHTML = n > 1 ? screens.map((_, i) => `<i data-i="${i}"></i>`).join('') : '';
$('dots').onclick = (e) => e.target.dataset.i && go(+e.target.dataset.i);
const go = (i) => { index = Math.max(0, Math.min(n - 1, i)); target = index; updateCaption(); };
$('next').onclick = () => go(index + 1);
$('prev').onclick = () => go(index - 1);
$('next').hidden = $('prev').hidden = n < 2;

function updateCaption() {
  const c = screens[index].c;
  $('cname').textContent = c.name; $('cdesc').textContent = c.description || '';
  $('open').hidden = !c.videos.length;
  [...$('dots').children].forEach((d, i) => d.classList.toggle('on', i === index));
}

addEventListener('keydown', (e) => {
  if (!$('sheet').hidden) return e.key === 'Escape' && closeSheet();
  if (e.key === 'ArrowLeft') go(index + 1); if (e.key === 'ArrowRight') go(index - 1);
  if (e.key === 'Enter' && !$('open').hidden) openSheet();
});
let wheelLock = 0;
addEventListener('wheel', (e) => { if (!$('sheet').hidden || Date.now() < wheelLock) return; wheelLock = Date.now() + 450; go(index + Math.sign(e.deltaY || e.deltaX)); }, { passive: true });
let sx = null;
canvas.addEventListener('pointerdown', (e) => { sx = e.clientX; });
canvas.addEventListener('pointerup', (e) => { if (sx === null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1)); else pick(e); });
addEventListener('pointermove', (e) => { mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1); });

const ray = new THREE.Raycaster();
function pick(e) {
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects(screens.map((s) => s.group), true)[0];
  if (!hit) return;
  const i = screens.findIndex((s) => s.group === hit.object || s.group.children.includes(hit.object));
  if (i === index) { if (screens[i].c.videos.length) openSheet(); } else if (i >= 0) go(i);
}

// ---------- video sheet (DOM) ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function openSheet() {
  const c = screens[index].c;
  $('sname').textContent = c.name; $('sdesc').textContent = c.description || '';
  $('grid').innerHTML = c.videos.map((v) => `<figure><video src="${esc(v.url)}" controls playsinline preload="metadata"></video><figcaption>${esc(v.title)}</figcaption></figure>`).join('') || '<p class="empty">لا توجد فيديوهات بعد.</p>';
  $('sheet').hidden = false; videoEls.forEach((v) => v.pause());
}
function closeSheet() {
  $('sheet').hidden = true; $('grid').innerHTML = '';
  videoEls.forEach((v) => v.play().catch(() => {}));
}
$('open').onclick = openSheet; $('close').onclick = closeSheet;

// ---------- loop ----------
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 0.8 ? 62 : 45;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  pos += (target - pos) * 0.07;
  const cx = pos * SPACING;
  camera.position.set(cx + mouse.x * 0.9, 3.4 - mouse.y * 0.4, 10.5);
  camera.lookAt(cx + mouse.x * 0.3, 1.9, -2.2);
  key.position.x = cx; key.target.position.set(cx, 2.5, -2.2);
  screens.forEach((s, i) => {
    const d = Math.abs(i - pos);
    s.group.position.y = (s.spin ? 2.2 : H / 2 + 0.55) + Math.sin(t * 0.8 + i) * 0.04;
    s.group.rotation.y = s.spin ? t * 0.6 : (i - pos) * -0.12;
    s.group.scale.setScalar(1 - Math.min(d, 2) * 0.06);
  });
  renderer.render(scene, camera);
});

updateCaption();
// leave the loader up until the first frames have drawn
requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => $('loader').classList.add('off'), 300)));
