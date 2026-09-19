// public/js/game.js — moteur de jeu 3D (Three.js) côté client.
// Version 0.9.2 : corrections focus clavier, pointer-events, drag-look.

(function () {
  // [FIX] Same-origin : le serveur Node sert tout au même endroit
  window.BACKEND = '';

  let session = null, token = null, joinIntent = null;

  if (location.hash.length > 1) {
    try {
      const payload = JSON.parse(decodeURIComponent(location.hash.slice(1)));
      session = payload.user || null;
      token = payload.token || null;
      joinIntent = payload.join || null;
    } catch(e) {}
  }

  if (!token) {
    try { token = localStorage.getItem('sod_token'); } catch(e) {}
  }
  if (!session) {
    try { session = JSON.parse(localStorage.getItem('sod_user') || 'null'); } catch(e) {}
  }
  if (!joinIntent) {
    try { joinIntent = JSON.parse(sessionStorage.getItem('sod_join') || 'null'); } catch(e) {}
  }

  if (!session || !token || !joinIntent) { location.href = 'index.html'; return; }

  const socket = io('', {
    path: '/socket.io/',
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10
  });
  let mySocketId = null;
  let room = null;
  let myUsername = session.username;

  // ===== [FIX] Force le focus clavier sur la fenêtre =====
  function forceWindowFocus() {
    try { window.focus(); } catch(e) {}
    const ae = document.activeElement;
    if (ae && typeof ae.blur === 'function' && ae !== document.body) {
      try { ae.blur(); } catch(e) {}
    }
  }
  window.addEventListener('load', forceWindowFocus);
  window.addEventListener('focus', forceWindowFocus);
  setTimeout(forceWindowFocus, 200);
  setTimeout(forceWindowFocus, 1200);

  // ---------------- THREE.JS SETUP ----------------
  const holder = document.getElementById('canvasHolder');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 600);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  holder.appendChild(renderer.domElement);

  const rig = new THREE.Object3D();
  rig.add(camera);
  camera.position.set(0, 1.7, 0);
  scene.add(rig);

  const tiltGroup = new THREE.Object3D();
  camera.add(tiltGroup);

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ---------------- ÉCLAIRAGE ----------------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(40, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);

  // ---------------- TEXTURES PROCÉDURALES ----------------
  function makeCanvasTexture(draw, size = 256) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    draw(ctx, size);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  const BIOME_STYLES = {
    jungle: { base: '#2a5a28', spot: '#3f7a3f', spot2: '#1e3e1c', fog: 0x1a3a1a, sky: 0x5a9e5e, skyTop: 0x2a6e3a, accent: '#5a8a3a' },
    arctic: { base: '#d0eaf5', spot: '#b8d8e8', spot2: '#e8f5fb', fog: 0xc0d8e8, sky: 0xc0e0f0, skyTop: 0x6090b0, accent: '#8acce0' },
    desert: { base: '#c89050', spot: '#b07838', spot2: '#d8a868', fog: 0xd8b070, sky: 0xf0d090, skyTop: 0xc08050, accent: '#d8a050' }
  };

  function groundTextureFor(biome) {
    const style = BIOME_STYLES[biome] || BIOME_STYLES.jungle;
    return makeCanvasTexture((ctx, size) => {
      ctx.fillStyle = style.base;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 1200; i++) {
        const colors = [style.spot, style.spot2, style.base];
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.globalAlpha = 0.1 + Math.random() * 0.3;
        const r = 2 + Math.random() * 6;
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 300; i++) {
        ctx.globalAlpha = 0.15 + Math.random() * 0.2;
        ctx.fillStyle = Math.random() < 0.5 ? style.spot : style.spot2;
        const x = Math.random() * size, y = Math.random() * size;
        ctx.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 2);
      }
      ctx.globalAlpha = 1;
    }, 512);
  }

  function skinTextureFor(color, pattern) {
    return makeCanvasTexture((ctx, size) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      ctx.globalAlpha = 0.35;
      if (pattern === 'stripes') {
        ctx.fillStyle = '#000000';
        for (let x = 0; x < size; x += 24) ctx.fillRect(x, 0, 10, size);
      } else if (pattern === 'camo') {
        ctx.fillStyle = '#00000055';
        for (let i = 0; i < 40; i++) {
          ctx.beginPath();
          ctx.ellipse(Math.random() * size, Math.random() * size, 20 + Math.random() * 20, 12 + Math.random() * 14, Math.random() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (pattern === 'scales') {
        ctx.fillStyle = '#ffffff33';
        for (let y = 0; y < size; y += 18) {
          for (let x = 0; x < size; x += 18) {
            ctx.beginPath();
            ctx.arc(x + (y / 18 % 2 ? 9 : 0), y, 8, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }, 128);
  }

  // ---------------- DÉCOR PROCÉDURAL ----------------
  const decorGroup = new THREE.Group();
  scene.add(decorGroup);

  function makeTree(biome) {
    const g = new THREE.Group();
    if (biome === 'arctic') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 2, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 }));
      trunk.position.y = 1;
      trunk.castShadow = true;
      g.add(trunk);
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(2 - i * 0.5, 1.8, 7), new THREE.MeshStandardMaterial({ color: 0xe0f0f5, roughness: 0.8 }));
        cone.position.y = 2 + i * 1.3;
        cone.castShadow = true;
        g.add(cone);
      }
    } else if (biome === 'desert') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 3.5, 8), new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.8 }));
      trunk.position.y = 1.75;
      trunk.castShadow = true;
      g.add(trunk);
      for (let i = 0; i < 2; i++) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.8 }));
        arm.position.set(i === 0 ? 0.5 : -0.5, 2 + Math.random() * 0.5, 0);
        arm.rotation.z = i === 0 ? -0.8 : 0.8;
        arm.castShadow = true;
        g.add(arm);
      }
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: 0xb08050, roughness: 0.95 }));
      rock.position.y = 0.3;
      rock.castShadow = true;
      g.add(rock);
    } else {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 3, 7), new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.9 }));
      trunk.position.y = 1.5;
      trunk.castShadow = true;
      g.add(trunk);
      for (let i = 0; i < 4; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 + Math.random() * 0.4, 0), new THREE.MeshStandardMaterial({ color: 0x3a6a28, roughness: 0.85 }));
        leaf.position.set((Math.random() - 0.5) * 1.5, 3.5 + Math.random() * 1, (Math.random() - 0.5) * 1.5);
        leaf.castShadow = true;
        g.add(leaf);
      }
    }
    return g;
  }

  function makeRock(biome) {
    const g = new THREE.Group();
    const rockColors = { jungle: 0x5a5a4a, arctic: 0x9aaab5, desert: 0xa07848 };
    const rockColor = rockColors[biome] || 0x5a5a4a;
    const main = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + Math.random() * 0.8, 0), new THREE.MeshStandardMaterial({ color: rockColor, roughness: 0.95 }));
    main.position.y = 0.5;
    main.castShadow = true;
    main.receiveShadow = true;
    g.add(main);
    if (Math.random() < 0.5) {
      const small = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + Math.random() * 0.3, 0), new THREE.MeshStandardMaterial({ color: rockColor, roughness: 0.95 }));
      small.position.set(0.8 + Math.random() * 0.5, 0.3, (Math.random() - 0.5) * 0.8);
      small.castShadow = true;
      g.add(small);
    }
    return g;
  }

  function makeStructure(biome) {
    const g = new THREE.Group();
    const stoneColors = { jungle: 0x6a6a5a, arctic: 0x8a9aa5, desert: 0xb09868 };
    const stoneColor = stoneColors[biome] || 0x6a6a5a;
    const mat = new THREE.MeshStandardMaterial({ color: stoneColor, roughness: 0.9 });
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3, 0.8), mat);
    pillar.position.y = 1.5;
    pillar.castShadow = true;
    g.add(pillar);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 2), mat);
    top.position.y = 3.2;
    top.rotation.z = (Math.random() - 0.5) * 0.3;
    top.castShadow = true;
    g.add(top);
    if (Math.random() < 0.7) {
      const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.7), mat);
      p2.position.set(1.8, 0.75, 0);
      p2.castShadow = true;
      g.add(p2);
    }
    if (Math.random() < 0.5) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.8), mat);
      block.position.set(-1.5, 0.3, 0.5);
      block.rotation.z = 0.4;
      block.castShadow = true;
      g.add(block);
    }
    if (Math.random() < 0.4) {
      for (let i = 0; i < 3; i++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.3), mat);
        step.position.set(0, 0.1 + i * 0.2, -1 - i * 0.3);
        step.castShadow = true;
        g.add(step);
      }
    }
    return g;
  }

  function makeCrystal(biome) {
    const g = new THREE.Group();
    const crystalColors = { jungle: 0x44ff88, arctic: 0x88ddff, desert: 0xffaa44 };
    const c = crystalColors[biome] || 0x44ff88;
    const crystalMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85 });
    const main = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.2, 6), crystalMat);
    main.position.y = 0.6;
    main.castShadow = true;
    g.add(main);
    for (let i = 0; i < 3; i++) {
      const small = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6 + Math.random() * 0.3, 5), crystalMat);
      const ang = (i / 3) * Math.PI * 2;
      small.position.set(Math.cos(ang) * 0.3, 0.3 + Math.random() * 0.2, Math.sin(ang) * 0.3);
      small.rotation.z = (Math.random() - 0.5) * 0.4;
      small.castShadow = true;
      g.add(small);
    }
    const light = new THREE.PointLight(c, 0.6, 3);
    light.position.y = 0.8;
    g.add(light);
    g.userData = { isCrystal: true };
    return g;
  }

  function makeTotem(biome) {
    const g = new THREE.Group();
    const totemColors = { jungle: 0x4a7a3a, arctic: 0x6a8a9a, desert: 0x8a6a3a };
    const c = totemColors[biome] || 0x4a7a3a;
    const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 8), mat);
    base.position.y = 0.15;
    base.castShadow = true;
    g.add(base);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 1.5, 8), mat);
    trunk.position.y = 1.05;
    trunk.castShadow = true;
    g.add(trunk);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
    head.position.y = 2.05;
    head.castShadow = true;
    g.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat);
    eyeL.position.set(-0.12, 2.1, 0.26);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat);
    eyeR.position.set(0.12, 2.1, 0.26);
    g.add(eyeL, eyeR);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), mat);
    armL.position.set(-0.35, 1.3, 0);
    armL.rotation.z = 0.5;
    armL.castShadow = true;
    g.add(armL);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), mat);
    armR.position.set(0.35, 1.3, 0);
    armR.rotation.z = -0.5;
    armR.castShadow = true;
    g.add(armR);
    const light = new THREE.PointLight(c, 0.4, 4);
    light.position.y = 2;
    g.add(light);
    return g;
  }

  function makeHill(biome) {
    const g = new THREE.Group();
    const hillColors = { jungle: 0x4a7a3a, arctic: 0xc0d0d8, desert: 0xc0a060 };
    const c = hillColors[biome] || 0x4a7a3a;
    const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 });
    const radius = 2 + Math.random() * 2;
    const height = 0.5 + Math.random() * 1.5;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 8), mat);
    hill.position.y = height / 2;
    hill.castShadow = true;
    hill.receiveShadow = true;
    g.add(hill);
    return g;
  }

  function makeLootBarrel(biome) {
    const g = new THREE.Group();
    const barrelColors = { jungle: 0x3a5a8a, arctic: 0x5a5a6a, desert: 0x8a5a3a };
    const c = barrelColors[biome] || 0x3a5a8a;
    const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 10), mat);
    barrel.position.y = 0.4;
    barrel.castShadow = true;
    g.add(barrel);
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.5 });
    const band1 = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.08, 10), bandMat);
    band1.position.y = 0.6;
    g.add(band1);
    const band2 = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.08, 10), bandMat);
    band2.position.y = 0.2;
    g.add(band2);
    return g;
  }

  function makeBush(biome) {
    const g = new THREE.Group();
    const bushColors = { jungle: 0x2a5a28, arctic: 0xb8d8e8, desert: 0x6a8a3a };
    const c = bushColors[biome] || 0x2a5a28;
    for (let i = 0; i < 3; i++) {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + Math.random() * 0.3, 0), new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
      bush.position.set((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.2, (Math.random() - 0.5) * 0.8);
      bush.castShadow = true;
      g.add(bush);
    }
    return g;
  }

  // ---------------- MONDE ----------------
  let groundMesh = null;
  let worldDecor = [];

  function buildWorld(biome) {
    const style = BIOME_STYLES[biome] || BIOME_STYLES.jungle;

    const skyGeo = new THREE.SphereGeometry(300, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(style.skyTop) },
        bottomColor: { value: new THREE.Color(style.sky) },
        offset: { value: 30 },
        exponent: { value: 0.6 }
      },
      vertexShader: `varying vec3 vWorldPosition; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPosition = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition; void main() { float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y; float t = max(pow(max(h, 0.0), exponent), 0.0); gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0); }`,
      side: THREE.BackSide
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    scene.fog = new THREE.Fog(style.fog, 40, 160);

    while (decorGroup.children.length) decorGroup.remove(decorGroup.children[0]);
    worldDecor = [];

    if (groundMesh) scene.remove(groundMesh);
    const groundGeo = new THREE.CircleGeometry(65, 64);
    const groundMat = new THREE.MeshStandardMaterial({ map: groundTextureFor(biome), roughness: 1 });
    groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    const ringGeo = new THREE.RingGeometry(58, 65, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: style.accent, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    decorGroup.add(ring);

    const innerRing = new THREE.Mesh(new THREE.RingGeometry(57.5, 58.5, 64), new THREE.MeshBasicMaterial({ color: style.accent, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.06;
    decorGroup.add(innerRing);

    const decorTypes = ['tree', 'tree', 'tree', 'rock', 'rock', 'bush', 'bush', 'structure', 'crystal', 'totem', 'hill', 'barrel'];
    const placed = [];
    for (let i = 0; i < 110; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 48;
      const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
      let tooClose = false;
      for (const p of placed) {
        if (Math.hypot(x - p.x, z - p.z) < 4) { tooClose = true; break; }
      }
      if (tooClose) continue;
      placed.push({ x, z });

      const type = decorTypes[Math.floor(Math.random() * decorTypes.length)];
      let deco;
      if (type === 'tree') deco = makeTree(biome);
      else if (type === 'rock') deco = makeRock(biome);
      else if (type === 'bush') deco = makeBush(biome);
      else if (type === 'crystal') deco = makeCrystal(biome);
      else if (type === 'totem') deco = makeTotem(biome);
      else if (type === 'hill') deco = makeHill(biome);
      else if (type === 'barrel') deco = makeLootBarrel(biome);
      else deco = makeStructure(biome);

      deco.position.set(x, 0, z);
      deco.rotation.y = Math.random() * Math.PI * 2;
      const s = 0.8 + Math.random() * 0.5;
      deco.scale.set(s, s, s);
      decorGroup.add(deco);
      worldDecor.push(deco);
    }

    if (!window.SOD_SETTINGS || !window.SOD_SETTINGS.get().reducedFx) {
      createAmbientParticles(biome);
    }
  }

  let particleSystem = null;
  function createAmbientParticles(biome) {
    if (particleSystem) { scene.remove(particleSystem); }
    const count = 200;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 120;
      positions[i * 3 + 1] = Math.random() * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 120;
      velocities[i * 2] = (Math.random() - 0.5) * 0.02;
      velocities[i * 2 + 1] = -(0.01 + Math.random() * 0.03);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const colors = { jungle: 0x9acb6a, arctic: 0xffffff, desert: 0xf0d090 };
    const mat = new THREE.PointsMaterial({ color: colors[biome] || 0x9acb6a, size: 0.15, transparent: true, opacity: 0.6, depthWrite: false });
    particleSystem = new THREE.Points(geo, mat);
    particleSystem.userData.velocities = velocities;
    scene.add(particleSystem);
  }

  function updateParticles(dt) {
    if (!particleSystem) return;
    const pos = particleSystem.geometry.attributes.position.array;
    const vel = particleSystem.userData.velocities;
    for (let i = 0; i < pos.length / 3; i++) {
      pos[i * 3] += vel[i * 2];
      pos[i * 3 + 1] += vel[i * 2 + 1];
      if (pos[i * 3 + 1] < 0) {
        pos[i * 3 + 1] = 30;
        pos[i * 3] = (Math.random() - 0.5) * 120;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
      }
    }
    particleSystem.geometry.attributes.position.needsUpdate = true;
  }

  // ---------------- ENTITÉS ----------------
  const bodyMeshes = new Map();
  const chestMeshes = new Map();
  const resourceMeshes = new Map();
  const trapMeshes = new Map();
  const bodyTargets = new Map();

  function bodyColorFor(bodyId) {
    const sid = room.controllerOf[bodyId];
    const meta = room.meta[sid];
    return {
      color: meta?.skin || '#4da3ff', pattern: meta?.pattern || 'plain',
      username: meta?.username || '???', customSkin: meta?.customSkin || null
    };
  }

  const customTextureCache = new Map();
  function customTextureFor(dataUrl) {
    if (customTextureCache.has(dataUrl)) return customTextureCache.get(dataUrl);
    const loader = new THREE.TextureLoader();
    const tex = loader.load(dataUrl);
    customTextureCache.set(dataUrl, tex);
    return tex;
  }

  function makeBodyGroup(body) {
    const group = new THREE.Group();
    const { color, pattern, customSkin } = bodyColorFor(body.id);
    const tex = skinTextureFor(color, pattern);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    const headMat = new THREE.MeshStandardMaterial({ map: customSkin ? customTextureFor(customSkin) : tex, roughness: 0.7 });

    const torso = new THREE.Mesh(typeof THREE.CapsuleGeometry === 'function' ? new THREE.CapsuleGeometry(0.35, 0.7, 4, 8) : new THREE.CylinderGeometry(0.35, 0.35, 1.1, 10), mat);
    torso.position.y = 1.1;
    torso.castShadow = true;
    group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), headMat);
    head.position.y = 1.8;
    head.castShadow = true;
    group.add(head);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeGeo = new THREE.SphereGeometry(0.05, 6, 6);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.1, 1.85, 0.27);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.1, 1.85, 0.27);
    group.add(eyeL, eyeR);

    const armGeo = typeof THREE.CapsuleGeometry === 'function' ? new THREE.CapsuleGeometry(0.1, 0.5, 3, 6) : new THREE.CylinderGeometry(0.1, 0.1, 0.6, 6);
    const armL = new THREE.Mesh(armGeo, mat);
    armL.position.set(-0.45, 1.2, 0);
    armL.castShadow = true;
    const armR = new THREE.Mesh(armGeo, mat);
    armR.position.set(0.45, 1.2, 0);
    armR.castShadow = true;
    group.add(armL, armR);

    const legGeo = typeof THREE.CapsuleGeometry === 'function' ? new THREE.CapsuleGeometry(0.13, 0.6, 3, 6) : new THREE.CylinderGeometry(0.13, 0.13, 0.7, 6);
    const legL = new THREE.Mesh(legGeo, mat);
    legL.position.set(-0.18, 0.4, 0);
    legL.castShadow = true;
    const legR = new THREE.Mesh(legGeo, mat);
    legR.position.set(0.18, 0.4, 0);
    legR.castShadow = true;
    group.add(legL, legR);

    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.4, 0.2), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 }));
    backpack.position.set(0, 1.2, -0.3);
    backpack.castShadow = true;
    group.add(backpack);

    const emoteSprite = makeEmoteSprite();
    emoteSprite.position.y = 2.3;
    emoteSprite.visible = false;
    group.add(emoteSprite);

    const hpBarBg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.08), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthTest: false }));
    hpBarBg.position.y = 2.15;
    hpBarBg.visible = false;
    group.add(hpBarBg);
    const hpBarFill = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.05), new THREE.MeshBasicMaterial({ color: 0x4dff5b, depthTest: false }));
    hpBarFill.position.set(0, 2.15, 0.01);
    hpBarFill.visible = false;
    group.add(hpBarFill);

    scene.add(group);
    return { group, mat, headMat, head, torso, armL, armR, legL, legR, backpack, emoteSprite, hpBarBg, hpBarFill, currentCustomSkin: customSkin, currentColor: color, currentPattern: pattern, walkPhase: 0, isMoving: false };
  }

  // ===================== FIRST PERSON WEAPON MODEL =====================
  const weaponGroup = new THREE.Group();
  weaponGroup.position.set(0.35, -0.3, -0.6);
  camera.add(weaponGroup);
  scene.add(camera);

  let currentWeaponMesh = null;
  let weaponSwingTime = 0;
  let weaponSwingDuration = 0.35;

  function buildWeaponMesh(weapon) {
    const g = new THREE.Group();
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffd4a0, roughness: 0.5 });
    if (weapon === 'épée' || weapon === 'epee') {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.02), new THREE.MeshStandardMaterial({ color: 0xccccdd, metalness: 0.6, roughness: 0.2 }));
      blade.position.y = 0.25;
      g.add(blade);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.04), new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.4, roughness: 0.3 }));
      guard.position.y = 0;
      g.add(guard);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.15, 8), new THREE.MeshStandardMaterial({ color: 0x4a2a1a, roughness: 0.7 }));
      handle.position.y = -0.1;
      g.add(handle);
    } else if (weapon === 'hache de guerre' || weapon === 'hache') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.7 }));
      handle.position.y = 0.15;
      g.add(handle);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.03), new THREE.MeshStandardMaterial({ color: 0xaaaabb, metalness: 0.6, roughness: 0.2 }));
      blade.position.set(0.12, 0.38, 0);
      g.add(blade);
    } else if (weapon === 'arc' || weapon === 'arc renforcé') {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.015, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.5 }));
      bow.rotation.z = Math.PI / 2;
      g.add(bow);
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.35, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      string.position.x = -0.18;
      g.add(string);
    } else {
      const fist = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.12), skinMat);
      fist.position.set(0, 0, 0);
      g.add(fist);
    }
    return g;
  }

  function updateWeaponMesh(weapon) {
    if (currentWeaponMesh) { weaponGroup.remove(currentWeaponMesh); }
    currentWeaponMesh = buildWeaponMesh(weapon);
    weaponGroup.add(currentWeaponMesh);
  }
  updateWeaponMesh('poings');

  function swingWeapon() {
    weaponSwingTime = weaponSwingDuration;
  }

  function updateWeaponAnim(dt) {
    if (weaponSwingTime > 0) {
      weaponSwingTime -= dt;
      const t = 1 - (weaponSwingTime / weaponSwingDuration);
      const swing = Math.sin(t * Math.PI);
      weaponGroup.rotation.x = -swing * 1.2;
      weaponGroup.position.z = -0.6 - swing * 0.1;
    } else {
      weaponGroup.rotation.x = THREE.MathUtils.lerp(weaponGroup.rotation.x, 0, dt * 10);
      weaponGroup.position.z = THREE.MathUtils.lerp(weaponGroup.position.z, -0.6, dt * 10);
    }
  }

  // ===================== HIT PARTICLES & DAMAGE NUMBERS =====================
  const hitParticles = [];
  const floatingTexts = [];

  function spawnHitParticles(x, y, z, color) {
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.SphereGeometry(0.06, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: color || 0xff4444, transparent: true });
      const p = new THREE.Mesh(geo, mat);
      p.position.set(x, y, z);
      p.userData = {
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 3,
        vz: (Math.random() - 0.5) * 4,
        life: 0.6,
        maxLife: 0.6
      };
      scene.add(p);
      hitParticles.push(p);
    }
  }

  function spawnLandingDust(x, y, z) {
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.SphereGeometry(0.08, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: 0xccccaa, transparent: true, opacity: 0.6 });
      const p = new THREE.Mesh(geo, mat);
      p.position.set(x, y + 0.1, z);
      const ang = (i / 6) * Math.PI * 2;
      p.userData = {
        vx: Math.cos(ang) * 2,
        vy: 0.5 + Math.random(),
        vz: Math.sin(ang) * 2,
        life: 0.5,
        maxLife: 0.5
      };
      scene.add(p);
      hitParticles.push(p);
    }
  }

  function updateHitParticles(dt) {
    for (let i = hitParticles.length - 1; i >= 0; i--) {
      const p = hitParticles[i];
      p.userData.life -= dt;
      if (p.userData.life <= 0) {
        scene.remove(p);
        hitParticles.splice(i, 1);
        continue;
      }
      p.position.x += p.userData.vx * dt;
      p.position.y += p.userData.vy * dt;
      p.position.z += p.userData.vz * dt;
      p.userData.vy -= 12 * dt;
      const alpha = p.userData.life / p.userData.maxLife;
      p.material.opacity = alpha;
      p.scale.setScalar(alpha);
    }
  }

  function spawnDamageNumber(x, y, z, damage) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 36px Arial';
    ctx.fillStyle = '#ff5555';
    ctx.textAlign = 'center';
    ctx.fillText('-' + damage, 32, 42);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.position.set(x, y + 2, z);
    sprite.scale.set(0.8, 0.8, 0.8);
    sprite.userData = { life: 1.2, maxLife: 1.2, vy: 1.5 };
    scene.add(sprite);
    floatingTexts.push(sprite);
  }

  function updateFloatingTexts(dt) {
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const s = floatingTexts[i];
      s.userData.life -= dt;
      if (s.userData.life <= 0) {
        scene.remove(s);
        floatingTexts.splice(i, 1);
        continue;
      }
      s.position.y += s.userData.vy * dt;
      const alpha = Math.min(1, s.userData.life / 0.4);
      s.material.opacity = alpha;
    }
  }

  function makeEmoteSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const spriteMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.9, 0.9, 0.9);
    return sprite;
  }

  function showEmoteOnBody(bodyId, emoji) {
    const entry = bodyMeshes.get(bodyId);
    if (!entry) return;
    const canvas = entry.emoteSprite.material.map.image;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.font = '46px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(emoji, 32, 46);
    entry.emoteSprite.material.map.needsUpdate = true;
    entry.emoteSprite.visible = true;
    clearTimeout(entry._emoteTimeout);
    entry._emoteTimeout = setTimeout(() => { entry.emoteSprite.visible = false; }, 2200);
  }

  function syncBodies() {
    const seen = new Set();
    for (const body of room.bodies) {
      seen.add(body.id);
      let entry = bodyMeshes.get(body.id);
      if (!entry) {
        entry = makeBodyGroup(body);
        bodyMeshes.set(body.id, entry);
        bodyTargets.set(body.id, { x: body.x, y: body.y, z: body.z, ry: body.ry });
      }
      const { color, pattern, customSkin } = bodyColorFor(body.id);
      if (entry.currentColor !== color || entry.currentPattern !== pattern) {
        const newTex = skinTextureFor(color, pattern);
        entry.mat.map = newTex;
        entry.mat.needsUpdate = true;
        entry.currentColor = color; entry.currentPattern = pattern;
        if (!customSkin) { entry.headMat.map = newTex; entry.headMat.needsUpdate = true; }
      }
      if (entry.currentCustomSkin !== customSkin) {
        entry.headMat.map = customSkin ? customTextureFor(customSkin) : entry.mat.map;
        entry.headMat.needsUpdate = true;
        entry.currentCustomSkin = customSkin;
      }
      const isMine = room.controllerOf[body.id] === mySocketId;
      entry.group.visible = !isMine && body.alive !== false;

      if (!isMine && body.alive !== false) {
        entry.hpBarBg.visible = true;
        entry.hpBarFill.visible = true;
        const hpPct = Math.max(0, body.hp / body.maxHp);
        entry.hpBarFill.scale.x = Math.max(0.01, hpPct);
        entry.hpBarFill.position.x = -(0.76 * (1 - hpPct)) / 2;
        const hpColor = hpPct > 0.5 ? 0x4dff5b : hpPct > 0.25 ? 0xffcc4d : 0xff5b5b;
        entry.hpBarFill.material.color.setHex(hpColor);
        entry.hpBarBg.lookAt(camera.position);
        entry.hpBarFill.lookAt(camera.position);
      } else {
        entry.hpBarBg.visible = false;
        entry.hpBarFill.visible = false;
      }

      if (isMine) {
        myBodyId = body.id;
        if (!isDragOwner) syncHUDFromBody(body);
      } else {
        const t = bodyTargets.get(body.id);
        if (t) { t.x = body.x; t.y = body.y; t.z = body.z; t.ry = body.ry; }
        else bodyTargets.set(body.id, { x: body.x, y: body.y, z: body.z, ry: body.ry });
      }
    }
    for (const [id, entry] of bodyMeshes) {
      if (!seen.has(id)) {
        scene.remove(entry.group);
        bodyMeshes.delete(id);
        bodyTargets.delete(id);
      }
    }
  }

  function makeChestMesh() {
    const g = new THREE.Group();
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd24d, roughness: 0.4, metalness: 0.6 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), boxMat);
    base.position.y = 0.25;
    base.castShadow = true;
    g.add(base);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.2, 0.52), boxMat);
    lid.position.y = 0.6;
    lid.castShadow = true;
    g.add(lid);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.05, 0.54), goldMat);
    trim.position.y = 0.5;
    g.add(trim);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), goldMat);
    lock.position.set(0, 0.5, 0.27);
    g.add(lock);
    const glow = new THREE.PointLight(0xffd24d, 0.8, 4);
    glow.position.y = 0.5;
    g.add(glow);
    const beaconGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffd24d, transparent: true, opacity: 0.15, depthWrite: false });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.y = 3;
    g.add(beacon);
    g.userData = { glow, beacon, time: 0 };
    return g;
  }

  function makeResourceMesh(type) {
    const g = new THREE.Group();
    if (type === 'bois') {
      const logMat = new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.9 });
      for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 6), logMat);
        log.rotation.z = Math.PI / 2;
        log.position.set(0, 0.1 + i * 0.15, (i - 1) * 0.15);
        log.castShadow = true;
        g.add(log);
      }
    } else {
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8a99, roughness: 0.95 });
      for (let i = 0; i < 4; i++) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 + Math.random() * 0.1, 0), rockMat);
        rock.position.set((Math.random() - 0.5) * 0.4, 0.1 + Math.random() * 0.2, (Math.random() - 0.5) * 0.4);
        rock.castShadow = true;
        g.add(rock);
      }
    }
    const glow = new THREE.PointLight(type === 'bois' ? 0xffaa44 : 0x88aaff, 0.3, 2);
    glow.position.y = 0.3;
    g.add(glow);
    return g;
  }

  function makeTrapMesh() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xff5b6a, transparent: true, opacity: 0.6, roughness: 0.6 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 12), mat);
    base.position.y = 0.04;
    g.add(base);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0xff5b6a, roughness: 0.5 }));
    spike.position.y = 0.25;
    g.add(spike);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 16), new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.5 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    g.add(ring);
    return g;
  }

  function syncStatics() {
    const seenChest = new Set();
    for (const chest of room.chests) {
      seenChest.add(chest.id);
      let m = chestMeshes.get(chest.id);
      if (!m) {
        m = makeChestMesh();
        m.position.set(chest.x, 0, chest.z);
        scene.add(m);
        chestMeshes.set(chest.id, m);
      }
      m.visible = !chest.opened;
    }
    for (const [id, m] of chestMeshes) if (!seenChest.has(id)) { scene.remove(m); chestMeshes.delete(id); }

    const seenRes = new Set();
    for (const node of room.resources) {
      seenRes.add(node.id);
      let m = resourceMeshes.get(node.id);
      if (!m) {
        m = makeResourceMesh(node.type);
        m.position.set(node.x, 0, node.z);
        scene.add(m);
        resourceMeshes.set(node.id, m);
      }
      m.visible = node.available;
    }
    for (const [id, m] of resourceMeshes) if (!seenRes.has(id)) { scene.remove(m); resourceMeshes.delete(id); }

    const seenTrap = new Set();
    for (const trap of room.traps) {
      seenTrap.add(trap.id);
      let m = trapMeshes.get(trap.id);
      if (!m) {
        m = makeTrapMesh();
        m.position.set(trap.x, 0, trap.z);
        scene.add(m);
        trapMeshes.set(trap.id, m);
      }
    }
    for (const [id, m] of trapMeshes) if (!seenTrap.has(id)) { scene.remove(m); trapMeshes.delete(id); }
  }

  // ---------------- ETAT LOCAL / CONTROLES ----------------
  let myBodyId = null;
  let isDragOwner = false;
  const keys = {};
  let yaw = 0, pitch = 0;
  const moveSpeed = 6;
  let sprintStamina = 100;
  let isSprinting = false;
  let bobTime = 0;
  let jumpVelocity = 0;
  let isGrounded = true;
  const GRAVITY = 22;
  const JUMP_FORCE = 9;

  // ===== [FIX] Détection des champs de saisie =====
  function isTypingInField() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  // ===== [FIX] Écoute clavier sur window avec capture =====
  window.addEventListener('keydown', (e) => {
    if (keys['__chatting'] || isTypingInField()) {
      if (e.code === 'Tab') e.preventDefault();
      return;
    }
    keys[e.code] = true;
    if (e.code === 'Tab') { e.preventDefault(); showLeaderboard(true); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') isSprinting = true;
    if (e.code === 'Space') { e.preventDefault(); if (isGrounded) { jumpVelocity = JUMP_FORCE; isGrounded = false; } }
    if (e.code === 'KeyQ') { e.preventDefault(); tryAttack(); }
    onActionKey(e.code);
  }, { capture: true });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Tab') showLeaderboard(false);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') isSprinting = false;
  }, { capture: true });

  // Relâche toutes les touches si la fenêtre perd le focus
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    isSprinting = false;
  });

  // ===== [FIX] Gestion clic / pointer lock / drag-look =====
  let leftDragging = false;
  let rightDragging = false;
  let lastMouseX = 0, lastMouseY = 0;

  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  renderer.domElement.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement === renderer.domElement) {
      if (e.button === 0) tryAttack();
      return;
    }

    if (e.button === 0) {
      try {
        const p = renderer.domElement.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch(err) {}
      // Drag-look de secours si le pointer lock n'est pas actif
      leftDragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }

    if (e.button === 2 || e.button === 1) {
      rightDragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      e.preventDefault();
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) leftDragging = false;
    if (e.button === 2 || e.button === 1) rightDragging = false;
  });

  // Curseur visuel selon le mode
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === renderer.domElement;
    renderer.domElement.style.cursor = locked ? 'none' : 'crosshair';
  });
  renderer.domElement.style.cursor = 'crosshair';

  // --- Mouse look avec pointer lock (mode FPS standard) ---
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    const sens = (window.SOD_SETTINGS ? window.SOD_SETTINGS.get().sensitivity : 1) * 0.0022;
    yaw -= e.movementX * sens;
    pitch -= e.movementY * sens;
    pitch = Math.max(-1.2, Math.min(1.2, pitch));
    rig.rotation.y = yaw;
    camera.rotation.x = pitch;
  });

  // --- Mouse look avec drag (clic gauche OU droit maintenu, sans pointer lock) ---
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === renderer.domElement) return;
    if (!leftDragging && !rightDragging) return;
    const sens = (window.SOD_SETTINGS ? window.SOD_SETTINGS.get().sensitivity : 1) * 0.004;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    yaw -= dx * sens;
    pitch -= dy * sens;
    pitch = Math.max(-1.2, Math.min(1.2, pitch));
    rig.rotation.y = yaw;
    camera.rotation.x = pitch;
  });

  function updateCameraKeys(dt) {
    const camSpeed = 2.5 * dt;
    if (keys['ArrowLeft']) { yaw += camSpeed; rig.rotation.y = yaw; }
    if (keys['ArrowRight']) { yaw -= camSpeed; rig.rotation.y = yaw; }
    if (keys['ArrowUp']) { pitch = Math.min(1.2, pitch + camSpeed); camera.rotation.x = pitch; }
    if (keys['ArrowDown']) { pitch = Math.max(-1.2, pitch - camSpeed); camera.rotation.x = pitch; }
  }

  // --- Touch controls ---
  let touchLookId = null;
  let touchLookLastX = 0, touchLookLastY = 0;
  let touchMoveId = null;
  let touchMoveStartX = 0, touchMoveStartY = 0;
  let touchMoveActive = { up: false, down: false, left: false, right: false };

  renderer.domElement.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth / 2) {
        if (touchMoveId === null) {
          touchMoveId = t.identifier;
          touchMoveStartX = t.clientX;
          touchMoveStartY = t.clientY;
        }
      } else {
        if (touchLookId === null) {
          touchLookId = t.identifier;
          touchLookLastX = t.clientX;
          touchLookLastY = t.clientY;
        }
      }
    }
  }, { passive: false });

  renderer.domElement.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === touchLookId) {
        const dx = t.clientX - touchLookLastX;
        const dy = t.clientY - touchLookLastY;
        touchLookLastX = t.clientX;
        touchLookLastY = t.clientY;
        const sens = (window.SOD_SETTINGS ? window.SOD_SETTINGS.get().sensitivity : 1) * 0.005;
        yaw -= dx * sens;
        pitch -= dy * sens;
        pitch = Math.max(-1.2, Math.min(1.2, pitch));
        rig.rotation.y = yaw;
        camera.rotation.x = pitch;
      }
      if (t.identifier === touchMoveId) {
        const dx = t.clientX - touchMoveStartX;
        const dy = t.clientY - touchMoveStartY;
        const threshold = 20;
        touchMoveActive.up = dy < -threshold;
        touchMoveActive.down = dy > threshold;
        touchMoveActive.left = dx < -threshold;
        touchMoveActive.right = dx > threshold;
      }
    }
  }, { passive: false });

  renderer.domElement.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchLookId) touchLookId = null;
      if (t.identifier === touchMoveId) {
        touchMoveId = null;
        touchMoveActive = { up: false, down: false, left: false, right: false };
      }
    }
  });

  function getTouchMove() {
    return touchMoveActive;
  }

  function myBody() {
    if (!room) return null;
    return room.bodies.find(b => room.controllerOf[b.id] === mySocketId) || null;
  }

  function onActionKey(code) {
    const b = myBody();
    if (!b || room.phase !== 'playing') return;
    if (code === 'KeyE') {
      const chest = room.chests.find(c => !c.opened && dist(b, c) < 2.5);
      if (chest) { socket.emit('openChest', chest.id); return; }
      const node = room.resources.find(n => n.available && dist(b, n) < 2.5);
      if (node) { socket.emit('gatherResource', node.id); return; }
    }
    if (code === 'KeyT') {
      socket.emit('placeTrap', { x: b.x, z: b.z }, (res) => {
        if (res && res.error) pushNotif('bad', res.error);
      });
    }
    if (code === 'KeyC') toggleCraftMenu();
    if (code === 'KeyG') socket.emit('emote', 'wave');
    if (code === 'KeyF') socket.emit('emote', 'dance');
  }

  // ---------------- CRAFT ----------------
  let RECIPES_CACHE = {};
  fetch((window.BACKEND || '') + '/api/recipes').then(r => r.json()).then(d => { RECIPES_CACHE = d.recipes || {}; renderRecipeList(); });

  function renderRecipeList() {
    const list = document.getElementById('recipeList');
    list.innerHTML = '';
    Object.entries(RECIPES_CACHE).forEach(([id, r]) => {
      const row = document.createElement('div');
      row.className = 'recipe';
      row.innerHTML = `<div><b>${r.label}</b><div class="cost">🪵 ${r.cost.bois} · 🪨 ${r.cost.pierre}</div></div>
        <button class="btn small primary" data-craft="${id}">Fabriquer</button>`;
      row.querySelector('[data-craft]').addEventListener('click', () => {
        socket.emit('craftItem', id, (res) => {
          if (res && res.error) pushNotif('bad', res.error);
          else if (res && res.ok) { pushNotif('good', '🛠️ ' + res.crafted); SFX.craft(); }
        });
      });
      list.appendChild(row);
    });
  }

  function toggleCraftMenu() {
    const menu = document.getElementById('craftMenu');
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden') && document.pointerLockElement) document.exitPointerLock();
  }

  function showLeaderboard(show) {
    if (!room) return;
    document.getElementById('leaderboard').classList.toggle('hidden', !show);
    if (!show) return;
    const rows = Object.values(room.meta).sort((a, b) => (b.kills || 0) - (a.kills || 0));
    const body = document.getElementById('leaderboardBody');
    body.innerHTML = rows.map(m => `<tr><td>${escapeHtml(m.username)}</td><td>${m.kills || 0}</td><td>${m.deaths || 0}</td></tr>`).join('');
  }

  socket.on('speedBoost', ({ durationMs, factor }) => {
    window.__speedFactor = factor;
    pushNotif('good', `⚡ Vitesse x${factor} pendant ${Math.round(durationMs / 1000)}s !`);
    setTimeout(() => { window.__speedFactor = 1; }, durationMs);
  });

  socket.on('playerEmote', ({ bodyId, emoteId }) => {
    const emojiMap = { wave: '👋', dance: '💃' };
    showEmoteOnBody(bodyId, emojiMap[emoteId] || '❔');
  });

  function dist(a, c) { return Math.hypot(a.x - c.x, a.z - c.z); }

  // [FIX] Retrait du paramètre "damage" inutile (le serveur est autoritaire)
  function tryAttack() {
    const b = myBody();
    if (!b || room.phase !== 'playing') return;
    swingWeapon();
    let best = null, bestScore = -Infinity;
    for (const body of room.bodies) {
      if (body.id === b.id || !body.alive) continue;
      const d = dist(b, body);
      if (d > 4.5) continue;
      const dx = body.x - b.x, dz = body.z - b.z;
      const angleToTarget = Math.atan2(dx, dz);
      const facing = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      let diff = Math.abs(angleToTarget - facing);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      const score = -d - diff * 2;
      if (diff < 1.0 && score > bestScore) { bestScore = score; best = body; }
    }
    if (best) {
      socket.emit('attack', { targetBodyId: best.id });
      SFX.hit();
      spawnHitParticles(best.x, 1.2, best.z, 0xff4444);
      spawnDamageNumber(best.x, 1.2, best.z, weaponDamage(b.weapon));
    } else {
      const fx = b.x + Math.sin(yaw) * 2;
      const fz = b.z + Math.cos(yaw) * 2;
      spawnHitParticles(fx, 1.0, fz, 0xaaaaaa);
    }
  }

  function weaponDamage(weapon) {
    return { poings: 12, 'épée': 22, arc: 18, 'hache de guerre': 28, 'arc renforcé': 25 }[weapon] || 12;
  }

  let lastSent = 0;
  function updateMovement(dt) {
    const b = myBody();
    if (!b || room.phase !== 'playing') return;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.sin(yaw + Math.PI / 2), 0, Math.cos(yaw + Math.PI / 2));
    let move = new THREE.Vector3();
    if (keys['KeyW'] || touchMoveActive.up) move.add(forward);
    if (keys['KeyS'] || touchMoveActive.down) move.sub(forward);
    if (keys['KeyD'] || touchMoveActive.right) move.add(right);
    if (keys['KeyA'] || touchMoveActive.left) move.sub(right);

    const isMoving = move.lengthSq() > 0;
    let speed = moveSpeed * (window.__speedFactor || 1);

    if (isSprinting && isMoving && sprintStamina > 5) {
      speed *= 1.5;
      sprintStamina = Math.max(0, sprintStamina - dt * 20);
    } else {
      sprintStamina = Math.min(100, sprintStamina + dt * 12);
    }
    updateStaminaBar(sprintStamina);

    if (isMoving && isGrounded) {
      bobTime += dt * (isSprinting ? 12 : 8);
      camera.position.y = 1.7 + b.y + Math.sin(bobTime) * 0.06;
    } else {
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, 1.7 + b.y, dt * 8);
    }

    if (isMoving) {
      move.normalize().multiplyScalar(speed * dt);
      b.x += move.x; b.z += move.z;
      const distFromCenter = Math.hypot(b.x, b.z);
      if (distFromCenter > 58) { const s = 58 / distFromCenter; b.x *= s; b.z *= s; }
    }
    if (!isGrounded) {
      b.y += jumpVelocity * dt;
      jumpVelocity -= GRAVITY * dt;
      if (b.y <= 0) { b.y = 0; jumpVelocity = 0; isGrounded = true; spawnLandingDust(b.x, 0, b.z); }
    }
    rig.position.set(b.x, b.y, b.z);

    const myEntry = bodyMeshes.get(myBodyId);
    if (myEntry) myEntry.isMoving = isMoving;

    const now = performance.now();
    if (now - lastSent > 60) {
      lastSent = now;
      socket.emit('playerMove', { x: b.x, y: b.y, z: b.z, ry: yaw });
    }
    updateActionHint(b);
  }

  function updateActionHint(b) {
    const hint = document.getElementById('actionHint');
    const chest = room.chests.find(c => !c.opened && dist(b, c) < 2.5);
    const node = room.resources.find(n => n.available && dist(b, n) < 2.5);
    if (chest) { hint.textContent = '📦 Appuie sur E pour ouvrir le coffre'; hint.classList.remove('hidden'); }
    else if (node) { hint.textContent = `⛏️ Appuie sur E pour récolter (${node.type})`; hint.classList.remove('hidden'); }
    else if ((b.resources.bois || 0) >= 3 && (b.resources.pierre || 0) >= 2) { hint.textContent = '🪤 Appuie sur T pour poser un piège'; hint.classList.remove('hidden'); }
    else hint.classList.add('hidden');
  }

  function animateBodies(dt) {
    for (const [id, entry] of bodyMeshes) {
      if (id === myBodyId) continue;
      const target = bodyTargets.get(id);
      if (!target) continue;
      entry.group.position.lerp(new THREE.Vector3(target.x, target.y || 0, target.z), Math.min(1, dt * 10));
      entry.group.rotation.y = target.ry || 0;

      const prevX = entry._prevX || target.x;
      const prevZ = entry._prevZ || target.z;
      const moveDist = Math.hypot(target.x - prevX, target.z - prevZ);
      entry.isMoving = moveDist > 0.01;
      entry._prevX = target.x;
      entry._prevZ = target.z;

      if (entry.isMoving) {
        entry.walkPhase += dt * 8;
        const swing = Math.sin(entry.walkPhase) * 0.5;
        entry.armL.rotation.x = swing;
        entry.armR.rotation.x = -swing;
        entry.legL.rotation.x = -swing;
        entry.legR.rotation.x = swing;
        entry.group.position.y = Math.abs(Math.sin(entry.walkPhase * 2)) * 0.05;
      } else {
        entry.walkPhase = 0;
        entry.armL.rotation.x = THREE.MathUtils.lerp(entry.armL.rotation.x, 0, dt * 8);
        entry.armR.rotation.x = THREE.MathUtils.lerp(entry.armR.rotation.x, 0, dt * 8);
        entry.legL.rotation.x = THREE.MathUtils.lerp(entry.legL.rotation.x, 0, dt * 8);
        entry.legR.rotation.x = THREE.MathUtils.lerp(entry.legR.rotation.x, 0, dt * 8);
        entry.group.position.y = THREE.MathUtils.lerp(entry.group.position.y, 0, dt * 8);
      }
    }
  }

  // ---------------- MINIMAP ----------------
  const minimapCanvas = document.getElementById('minimapCanvas');
  const minimapCtx = minimapCanvas.getContext('2d');

  function drawMinimap() {
    if (!room) return;
    const size = 140;
    const range = 65;
    minimapCtx.clearRect(0, 0, size, size);

    const style = BIOME_STYLES[room.map] || BIOME_STYLES.jungle;
    minimapCtx.fillStyle = style.base;
    minimapCtx.fillRect(0, 0, size, size);

    minimapCtx.strokeStyle = style.accent;
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.arc(size / 2, size / 2, (58 / range) * (size / 2), 0, Math.PI * 2);
    minimapCtx.stroke();

    const b = myBody();
    if (!b) return;
    const cx = b.x, cz = b.z;

    for (const chest of room.chests) {
      if (chest.opened) continue;
      const mx = size / 2 + ((chest.x - cx) / range) * (size / 2);
      const my = size / 2 + ((chest.z - cz) / range) * (size / 2);
      minimapCtx.fillStyle = '#ffd24d';
      minimapCtx.fillRect(mx - 2, my - 2, 4, 4);
    }

    for (const node of room.resources) {
      if (!node.available) continue;
      const mx = size / 2 + ((node.x - cx) / range) * (size / 2);
      const my = size / 2 + ((node.z - cz) / range) * (size / 2);
      minimapCtx.fillStyle = node.type === 'bois' ? '#8a5a2a' : '#aaaabb';
      minimapCtx.fillRect(mx - 1.5, my - 1.5, 3, 3);
    }

    // [FIX] ownerId (et non ownerSocketId)
    for (const trap of room.traps) {
      if (trap.ownerId !== mySocketId) continue;
      const mx = size / 2 + ((trap.x - cx) / range) * (size / 2);
      const my = size / 2 + ((trap.z - cz) / range) * (size / 2);
      minimapCtx.fillStyle = '#ff5b6a';
      minimapCtx.beginPath();
      minimapCtx.arc(mx, my, 3, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    for (const [bid, entry] of bodyMeshes) {
      if (bid === myBodyId || !entry.group.visible) continue;
      const target = bodyTargets.get(bid);
      if (!target) continue;
      const mx = size / 2 + ((target.x - cx) / range) * (size / 2);
      const my = size / 2 + ((target.z - cz) / range) * (size / 2);
      if (mx < 0 || mx > size || my < 0 || my > size) continue;
      minimapCtx.fillStyle = '#ff5b5b';
      minimapCtx.beginPath();
      minimapCtx.arc(mx, my, 3, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    minimapCtx.fillStyle = '#4dff5b';
    minimapCtx.beginPath();
    minimapCtx.arc(size / 2, size / 2, 4, 0, Math.PI * 2);
    minimapCtx.fill();
    minimapCtx.strokeStyle = '#4dff5b';
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.moveTo(size / 2, size / 2);
    minimapCtx.lineTo(size / 2 + Math.sin(yaw) * 8, size / 2 + Math.cos(yaw) * 8);
    minimapCtx.stroke();
  }

  // ---------------- HUD ----------------
  function syncHUDFromBody(body) {
    const hpPct = Math.max(0, (body.hp / body.maxHp) * 100);
    document.getElementById('hpFill').style.width = hpPct + '%';
    document.getElementById('hpText').textContent = `${Math.round(body.hp)} / ${body.maxHp}`;
    document.getElementById('resBois').textContent = body.resources.bois || 0;
    document.getElementById('resPierre').textContent = body.resources.pierre || 0;
    document.getElementById('totemCount').textContent = body.totems || 0;
    document.getElementById('weaponName').textContent = capitalize(body.weapon);
    document.getElementById('weaponIcon').textContent = weaponIcon(body.weapon);
    const livesBox = document.getElementById('livesBox');
    const total = 3;
    const left = body.lives ?? total;
    livesBox.innerHTML = Array.from({ length: total }, (_, i) =>
      `<span class="${i < left ? 'heart' : 'heart lost'}">❤</span>`
    ).join('');
  }

  function weaponIcon(w) {
    return { poings: '✊', 'épée': '⚔️', arc: '🏹', 'hache de guerre': '🪓', 'arc renforcé': '🏹' }[w] || '✊';
  }

  function updateStaminaBar(stamina) {
    const bar = document.getElementById('staminaFill');
    if (bar) bar.style.width = stamina + '%';
  }

  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function pushNotif(type, text) {
    const el = document.createElement('div');
    el.className = 'notif ' + type;
    el.textContent = text;
    document.getElementById('notifStack').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
  }

  function flashCenter(text, ms = 1800) {
    const el = document.getElementById('centerMsg');
    el.textContent = text;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ---------------- CHAT ----------------
  const chatInput = document.getElementById('chatInput');
  chatInput.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && chatInput.value.trim()) {
      socket.emit('chatMessage', chatInput.value.trim());
      chatInput.value = '';
    }
  });
  chatInput.addEventListener('focus', () => { keys['__chatting'] = true; });
  chatInput.addEventListener('blur', () => { keys['__chatting'] = false; });

  socket.on('chatMessage', (msg) => {
    const log = document.getElementById('chatLog');
    const line = document.createElement('div');
    if (msg.system) { line.className = 'sys'; line.textContent = msg.text; }
    else {
      line.className = msg.username === myUsername ? 'me' : '';
      line.innerHTML = `<b>${escapeHtml(msg.username)}:</b> ${escapeHtml(msg.text)}`;
      if (msg.username !== myUsername) {
        const reportBtn = document.createElement('button');
        reportBtn.textContent = '⚠';
        reportBtn.title = 'Signaler le skin peint de ce joueur';
        reportBtn.style.cssText = 'margin-left:6px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;';
        reportBtn.addEventListener('click', () => reportSkin(msg.username));
        line.appendChild(reportBtn);
      }
    }
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  });

  async function reportSkin(username) {
    const res = await fetch((window.BACKEND || '') + '/api/profile/skin/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ username })
    }).then(r => r.json());
    pushNotif(res.error ? 'bad' : 'good', res.error || 'Signalement envoyé, merci.');
  }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  // ---------------- SOCKET EVENTS ----------------
  socket.on('connect_error', (err) => {
    console.error('Socket connect_error:', err);
    const t = document.getElementById('startTitle');
    const s = document.getElementById('startSub');
    if (t) t.textContent = '❌ Connexion impossible';
    if (s) s.textContent = 'Le serveur ne répond pas. Détail : ' + (err.message || 'inconnu');
  });

  socket.on('connect', () => {
    mySocketId = socket.id;
    socket.emit('authenticate', token, (res) => {
      if (!res || res.error) {
        const t = document.getElementById('startTitle');
        const s = document.getElementById('startSub');
        if (t) t.textContent = '🔒 Session expirée';
        if (s) s.textContent = (res && res.error) ? res.error + ' — Reconnecte-toi depuis le menu.' : 'Reconnecte-toi depuis le menu.';
        setTimeout(() => {
          if (!document.getElementById('btnReturnToMenu')) {
            const btn = document.createElement('button');
            btn.id = 'btnReturnToMenu';
            btn.className = 'btn primary';
            btn.textContent = '← Se reconnecter';
            btn.onclick = () => {
              try { localStorage.clear(); } catch(e) {}
              document.cookie = 'sod_token=; max-age=0';
              document.cookie = 'sod_user=; max-age=0';
              location.href = 'index.html';
            };
            document.getElementById('startOverlay').appendChild(btn);
          }
        }, 100);
        return;
      }
      startFlow();
    });
  });

  function startFlow() {
    const cb = (res) => {
      if (!res || res.error) { document.getElementById('startTitle').textContent = 'Erreur'; document.getElementById('startSub').textContent = res?.error || 'Connexion impossible.'; return; }
      onRoomReady(res.room);
    };
    if (joinIntent.mode === 'public') socket.emit('joinPublic', { token }, cb);
    else if (joinIntent.mode === 'private') socket.emit('joinPrivate', { token, code: joinIntent.code }, cb);
    else if (joinIntent.mode === 'create-private') socket.emit('createPrivate', { token, map: joinIntent.map, bots: joinIntent.bots || 0 }, cb);
    else if (joinIntent.mode === 'solo-admin') socket.emit('adminSoloTest', { token, map: joinIntent.map, bots: joinIntent.bots || 0 }, cb);
  }

  function onRoomReady(r) {
    room = r;
    buildWorld(room.map);
    syncBodies(); syncStatics();
    document.getElementById('topBar').classList.remove('hidden');
    document.getElementById('minimap').classList.remove('hidden');
    const modeLabels = { private: 'Salon ' + room.code, public: 'Partie publique', 'solo-test': 'Test solo (admin)' };
    document.getElementById('roomCodeLabel').textContent = modeLabels[room.mode] || room.mode;
    document.getElementById('roomMapLabel').textContent = { jungle: '🌴 Jungle', arctic: '❄️ Arctique', desert: '🏜️ Désert' }[room.map] || room.map;
    if (room.mode === 'private' && room.hostSocketId === mySocketId) {
      document.getElementById('hostControls').classList.remove('hidden');
    }
    const startTitles = { private: `Salon privé — code : ${room.code}`, public: 'Partie publique', 'solo-test': 'Test solo — carte chargée' };
    document.getElementById('startTitle').textContent = startTitles[room.mode] || room.mode;
    document.getElementById('startSub').textContent = room.mode === 'solo-test' ? '' : 'En attente du début de la partie…';
    if (room.phase === 'playing') {
      document.getElementById('startOverlay').classList.add('hidden');
      ['crosshair', 'hpWrap', 'weaponBox', 'chatBox', 'keyHints', 'staminaWrap'].forEach(id => document.getElementById(id).classList.remove('hidden'));
    }
  }

  document.getElementById('btnStartMatch').addEventListener('click', () => {
    socket.emit('startPrivateMatch', {}, (res) => { if (res && res.error) pushNotif('bad', res.error); });
  });

  socket.on('roomState', (r) => {
    room = r;
    syncBodies(); syncStatics();
    document.getElementById('roomPhaseLabel').textContent = ({
      lobby: `En attente de joueurs (${Object.keys(room.meta).length}/${room.minPlayers} min.)`,
      countdown: `Début dans ${room.countdown ?? '...'}s`,
      playing: `En cours — ${Object.keys(room.meta).length} joueurs`,
      ended: 'Terminé'
    })[room.phase] || room.phase;

    if (room.phase === 'playing') {
      document.getElementById('startOverlay').classList.add('hidden');
      ['crosshair', 'hpWrap', 'weaponBox', 'chatBox', 'keyHints', 'staminaWrap'].forEach(id => document.getElementById(id).classList.remove('hidden'));
    }
  });

  let lastSwapWarningAt = -1;
  socket.on('tick', ({ phase, countdown, timerSeconds }) => {
    document.getElementById('swapNum').textContent = phase === 'playing' ? timerSeconds : (countdown ?? '--');
    const swapTimer = document.getElementById('swapTimer');
    if (phase === 'playing' && timerSeconds <= 10) {
      swapTimer.classList.add('urgent');
    } else {
      swapTimer.classList.remove('urgent');
    }
    if (phase === 'playing' && timerSeconds <= 5 && timerSeconds >= 1 && timerSeconds !== lastSwapWarningAt) {
      lastSwapWarningAt = timerSeconds;
      SFX.swapWarning();
    }
    if (phase === 'playing' && timerSeconds > 5) lastSwapWarningAt = -1;
  });

  socket.on('bodyMoved', ({ bodyId, x, y, z, ry }) => {
    const t = bodyTargets.get(bodyId);
    if (t) { t.x = x; t.y = y; t.z = z; t.ry = ry; }
  });

  socket.on('bodyDamaged', ({ bodyId, hp, maxHp }) => {
    const b = room?.bodies.find(x => x.id === bodyId);
    if (b) { b.hp = hp; b.maxHp = maxHp; }
    if (bodyId === myBodyId) { syncHUDFromBody(b); SFX.damage(); }
    if (b) spawnHitParticles(b.x, 1.2, b.z, 0xff4444);
  });

  socket.on('chestOpened', ({ chestId, by, loot }) => {
    const chest = room?.chests.find(c => c.id === chestId);
    if (chest) chest.opened = true;
    if (by === mySocketId) { pushNotif('good', '🎁 ' + loot.label); SFX.chestOpen(); }
  });

  socket.on('resourceGathered', ({ nodeId, by }) => {
    const node = room?.resources.find(n => n.id === nodeId);
    if (node) node.available = false;
    if (by === mySocketId) SFX.gather();
  });

  socket.on('trapPlaced', (trap) => { room?.traps.push(trap); });
  socket.on('trapTriggered', ({ trapId }) => { if (room) room.traps = room.traps.filter(t => t.id !== trapId); });

  socket.on('bodyDied', ({ bodyId, livesLeft }) => {
    const b = room?.bodies.find(x => x.id === bodyId);
    if (b) { b.hp = b.maxHp; if (typeof livesLeft === 'number') b.lives = livesLeft; }
    if (bodyId === myBodyId && b) syncHUDFromBody(b);
  });

  socket.on('youDied', ({ attackerName, livesLeft }) => {
    flashCenter(attackerName ? `💀 Éliminé par ${attackerName}` : '💀 Tu es tombé...', 2200);
    if (typeof livesLeft === 'number') pushNotif('bad', `❤ Il te reste ${livesLeft} vie(s).`);
    SFX.death();
  });

  socket.on('bodyEliminated', ({ bodyId, victimName, attackerName }) => {
    const b = room?.bodies.find(x => x.id === bodyId);
    if (b) { b.alive = false; b.lives = 0; b.hp = 0; }
    if (bodyId === myBodyId) return;
    if (victimName) {
      pushNotif('bad', attackerName
        ? `☠️ ${victimName} a été éliminé par ${attackerName}.`
        : `☠️ ${victimName} a été éliminé.`);
    }
  });

  let iAmEliminated = false;
  socket.on('youAreEliminated', ({ attackerName }) => {
    iAmEliminated = true;
    flashCenter('☠️ ÉLIMINÉ', 2200);
    pushNotif('bad', attackerName ? `Éliminé définitivement par ${attackerName}.` : 'Éliminé définitivement.');
    document.getElementById('eliminatedBanner').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    SFX.elimination();
  });

  document.getElementById('btnLeaveAfterElim').addEventListener('click', () => {
    socket.emit('leaveRoom');
    location.href = 'index.html';
  });

  socket.on('matchEnded', ({ winner, finalStats }) => {
    if (document.pointerLockElement) document.exitPointerLock();
    const iWon = winner && winner.socketId === mySocketId;
    document.getElementById('matchEndTitle').textContent = winner
      ? (iWon ? '🏆 Victoire !' : `🏆 ${winner.username} a gagné`)
      : 'Partie terminée';
    document.getElementById('matchEndSub').textContent = iWon
      ? 'Tu es le dernier survivant !'
      : winner ? 'Meilleure chance la prochaine fois.' : 'Aucun survivant unique cette fois.';
    document.getElementById('matchEndStandings').innerHTML = (finalStats || [])
      .map(s => `<tr${s.winner ? ' style="color:var(--gold);font-weight:700;"' : ''}><td>${escapeHtml(s.username)}${s.winner ? ' 👑' : ''}</td><td>${s.kills}</td><td>${s.deaths}</td></tr>`)
      .join('');
    document.getElementById('matchEndOverlay').classList.remove('hidden');
    document.getElementById('eliminatedBanner').classList.add('hidden');
    if (iWon) SFX.victory();
  });

  socket.on('notification', ({ type, text }) => pushNotif(type, text));

  socket.on('globalSwapExecuted', ({ message, mapping }) => {
    const flash = document.getElementById('swapFlash');
    const vignette = document.getElementById('vignette');
    flash.style.background = 'radial-gradient(circle, rgba(180,120,255,0.6) 0%, rgba(100,60,200,0.3) 50%, transparent 80%)';
    flash.style.opacity = '1';
    vignette.style.opacity = '1';
    setTimeout(() => { flash.style.opacity = '0'; }, 300);
    setTimeout(() => { vignette.style.opacity = '0'; }, 1500);
    flashCenter('⚡ SWAP GLOBAL !', 1600);
    pushNotif('good', message);
    SFX.swapExecuted();
    const mine = mapping.find(m => m.socketId === mySocketId);
    if (mine) {
      isDragOwner = true;
      setTimeout(() => { isDragOwner = false; }, 50);
    }
  });

  socket.on('globalAnnouncement', ({ text }) => pushNotif('good', '📢 ' + text));
  socket.on('roomClosed', ({ reason }) => {
    if (window.showToast) showToast('Salon fermé : ' + reason, 'warning', 2600);
    setTimeout(() => { location.href = 'index.html'; }, window.showToast ? 1600 : 0);
  });

  document.getElementById('leaveBtn').addEventListener('click', () => {
    socket.emit('leaveRoom');
    location.href = 'index.html';
  });

  document.getElementById('btnAddBot').addEventListener('click', () => {
    socket.emit('addBots', { count: 1 }, (res) => {
      if (res && res.error) pushNotif('bad', res.error);
      else if (res && res.ok) pushNotif('good', `🤖 ${res.count} bot(s) ajouté(s) !`);
    });
  });

  // ---------------- CHAT VOCAL ----------------
  const voiceBtn = document.getElementById('voiceBtn');
  let voiceActive = false;
  voiceBtn.addEventListener('click', async () => {
    if (!window.SwapVoice) {
      pushNotif('bad', 'Chat vocal indisponible.');
      return;
    }
    voiceActive = !voiceActive;
    voiceBtn.classList.toggle('active', voiceActive);
    voiceBtn.textContent = voiceActive ? '🎙️ Voix active' : '🎙️ Voix';
    if (voiceActive) await window.SwapVoice.join(socket);
    else window.SwapVoice.leave(socket);
  });

  // ---------------- BOUCLE PRINCIPALE ----------------
  let lastT = performance.now();
  function loop() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (room && !keys['__chatting']) {
      updateCameraKeys(dt);
      updateMovement(dt);
    }
    updateWeaponAnim(dt);
    updateHitParticles(dt);
    updateFloatingTexts(dt);
    animateBodies(dt);
    updateParticles(dt);
    const chestTime = performance.now() / 1000;
    for (const [id, cm] of chestMeshes) {
      if (cm.userData) {
        const pulse = 0.5 + Math.sin(chestTime * 3) * 0.3;
        if (cm.userData.glow) cm.userData.glow.intensity = 0.5 + pulse * 0.6;
        if (cm.userData.beacon) cm.userData.beacon.material.opacity = 0.1 + pulse * 0.1;
      }
    }
    for (const deco of worldDecor) {
      if (deco.userData && deco.userData.isCrystal) {
        deco.rotation.y += dt * 0.5;
      }
    }
    if (room) drawMinimap();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();
})();
