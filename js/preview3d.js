// public/js/preview3d.js
//
// Petit moteur Three.js autonome pour afficher un aperçu 3D du personnage
// (utilisé dans la boutique et dans l'onglet Profil). Volontairement séparé
// de public/js/game.js (qui tourne uniquement sur game.html).
//
// IMPORTANT : la fonction skinTextureFor() ci-dessous est une copie
// volontairement gardée identique à celle de public/js/game.js, pour que
// l'aperçu ressemble exactement à ce qu'on voit en jeu.

// [FIX] Polyfill CapsuleGeometry correct (cylindre + 2 demi-sphères)
// L'ancienne version utilisait LatheGeometry avec un profil qui produisait
// un fuseau étrange. Ici on construit un vrai mesh capsule en BufferGeometry.
if (!THREE.CapsuleGeometry) {
  THREE.CapsuleGeometry = function (radius = 1, length = 1, capSegments = 4, radialSegments = 8) {
    // Sécurité : bornes minimales pour éviter les géométries dégénérées
    radius = Math.max(0.0001, radius);
    length = Math.max(0, length);
    capSegments = Math.max(1, Math.floor(capSegments));
    radialSegments = Math.max(3, Math.floor(radialSegments));

    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    const halfLength = length / 2;

    // Nombre total d'anneaux :
    //   capSegments en haut (hémisphère supérieur)
    //   1 anneau au niveau du raccord haut (y = +halfLength)
    //   1 anneau au niveau du raccord bas  (y = -halfLength)
    //   capSegments en bas (hémisphère inférieur)
    // On génère les anneaux du HAUT vers le BAS pour simplifier les index.
    const rings = [];

    // Hémisphère supérieur : de theta = 0 (pôle nord) à theta = PI/2 (raccord haut)
    for (let i = 0; i <= capSegments; i++) {
      const theta = (i / capSegments) * (Math.PI / 2);
      const y = halfLength + Math.cos(theta) * radius;
      const r = Math.sin(theta) * radius;
      rings.push({ y, r, ny: Math.cos(theta), nr: Math.sin(theta) });
    }

    // Hémisphère inférieur : de theta = PI/2 (raccord bas) à theta = PI (pôle sud)
    for (let i = 1; i <= capSegments; i++) {
      const theta = Math.PI / 2 + (i / capSegments) * (Math.PI / 2);
      const y = -halfLength + Math.cos(theta) * radius;
      const r = Math.sin(theta) * radius;
      rings.push({ y, r, ny: Math.cos(theta), nr: Math.sin(theta) });
    }

    // Générer les sommets anneau par anneau
    const totalRings = rings.length;
    for (let y = 0; y < totalRings; y++) {
      const ring = rings[y];
      // Cas particulier : pôle (rayon ~0) → un seul sommet
      if (ring.r < 0.0001) {
        vertices.push(0, ring.y, 0);
        normals.push(0, ring.ny, 0);
        uvs.push(0.5, 1 - y / (totalRings - 1));
      } else {
        for (let x = 0; x <= radialSegments; x++) {
          const u = x / radialSegments;
          const phi = u * Math.PI * 2;
          const cx = Math.cos(phi);
          const cz = Math.sin(phi);
          vertices.push(ring.r * cx, ring.y, ring.r * cz);
          normals.push(ring.nr * cx, ring.ny, ring.nr * cz);
          uvs.push(u, 1 - y / (totalRings - 1));
        }
      }
    }

    // Générer les indices en reliant anneaux adjacents
    // Note : les pôles n'ont qu'un sommet → on gère deux cas.
    // On calcule l'offset de chaque anneau dans le tableau de vertices.
    const ringOffsets = [];
    let vCursor = 0;
    for (let y = 0; y < totalRings; y++) {
      ringOffsets.push(vCursor);
      const ring = rings[y];
      vCursor += (ring.r < 0.0001) ? 1 : (radialSegments + 1);
    }

    for (let y = 0; y < totalRings - 1; y++) {
      const ringA = rings[y];
      const ringB = rings[y + 1];
      const offA = ringOffsets[y];
      const offB = ringOffsets[y + 1];
      const aIsPole = ringA.r < 0.0001;
      const bIsPole = ringB.r < 0.0001;

      if (aIsPole && !bIsPole) {
        // Triangle fan depuis le pôle supérieur
        const apex = offA;
        for (let x = 0; x < radialSegments; x++) {
          indices.push(apex, offB + x, offB + x + 1);
        }
      } else if (!aIsPole && bIsPole) {
        // Triangle fan vers le pôle inférieur
        const apex = offB;
        for (let x = 0; x < radialSegments; x++) {
          indices.push(offA + x, apex, offA + x + 1);
        }
      } else {
        // Quad classique entre 2 anneaux
        for (let x = 0; x < radialSegments; x++) {
          const a = offA + x;
          const b = offA + x + 1;
          const c = offB + x;
          const d = offB + x + 1;
          indices.push(a, c, b);
          indices.push(b, c, d);
        }
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    return geometry;
  };
}

function skinTextureFor(color, pattern) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 128);
  ctx.globalAlpha = 0.35;
  if (pattern === 'stripes') {
    ctx.fillStyle = '#000000';
    for (let x = 0; x < 128; x += 24) ctx.fillRect(x, 0, 10, 128);
  } else if (pattern === 'camo') {
    ctx.fillStyle = '#00000055';
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      ctx.ellipse(Math.random() * 128, Math.random() * 128, 20 + Math.random() * 20, 12 + Math.random() * 14, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'scales') {
    ctx.fillStyle = '#ffffff33';
    for (let y = 0; y < 128; y += 18) {
      for (let x = 0; x < 128; x += 18) {
        ctx.beginPath();
        ctx.arc(x + (y / 18 % 2 ? 9 : 0), y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(canvas);
}

// Crée une vitrine 3D dans le <canvas> fourni. Retourne des setters pour
// changer l'apparence sans reconstruire toute la scène, et un destroy().
function createCharacterPreview(canvasEl) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(0, 1.15, 4.2);
  camera.lookAt(0, 0.9, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6fd7ff, 0.4);
  rim.position.set(-3, 2, -2);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  let bodyMat = new THREE.MeshStandardMaterial({ color: 0x4da3ff });
  let headMat = new THREE.MeshStandardMaterial({ color: 0x4da3ff });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.95, 4, 8), bodyMat);
  torso.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), headMat);
  head.position.y = 1.78;
  group.add(torso, head);

  const trailRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.05, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85 })
  );
  trailRing.rotation.x = Math.PI / 2;
  trailRing.position.y = 0.05;
  trailRing.visible = false;
  group.add(trailRing);

  let autoRotate = true;
  let dragging = false;
  let lastX = 0;
  let resumeTimer = null;

  function onDown(e) {
    dragging = true;
    autoRotate = false;
    lastX = (e.touches ? e.touches[0].clientX : e.clientX);
    clearTimeout(resumeTimer);
  }
  function onMove(e) {
    if (!dragging) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    group.rotation.y += (x - lastX) * 0.01;
    lastX = x;
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    resumeTimer = setTimeout(() => { autoRotate = true; }, 1800);
  }
  canvasEl.addEventListener('mousedown', onDown);
  canvasEl.addEventListener('touchstart', onDown, { passive: true });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);
  canvasEl.style.cursor = 'grab';

  let running = true;
  function resize() {
    const w = canvasEl.clientWidth || 200;
    const h = canvasEl.clientHeight || 220;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvasEl);
  resize();

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    if (autoRotate) group.rotation.y += 0.012;
    renderer.render(scene, camera);
  }
  loop();

  return {
    setSkin(color, pattern) {
      const tex = skinTextureFor(color || '#4da3ff', pattern || 'plain');
      bodyMat.map = tex; bodyMat.needsUpdate = true;
      if (!head.userData.customLocked) { headMat.map = tex; headMat.needsUpdate = true; }
    },
    setCustomHead(dataUrl) {
      if (!dataUrl) { head.userData.customLocked = false; return; }
      head.userData.customLocked = true;
      const tex = new THREE.TextureLoader().load(dataUrl);
      headMat.map = tex; headMat.needsUpdate = true;
    },
    setTrail(color) {
      trailRing.visible = !!color;
      if (color) trailRing.material.color.set(color);
    },
    destroy() {
      running = false;
      ro.disconnect();
      canvasEl.removeEventListener('mousedown', onDown);
      canvasEl.removeEventListener('touchstart', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
      renderer.dispose();
    },
  };
}
