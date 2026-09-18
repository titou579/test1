// public/js/preview3d.js
//
// Petit moteur Three.js autonome pour afficher un aperçu 3D du personnage
// (utilisé dans la boutique et dans l'onglet Profil). Volontairement séparé
// de public/js/game.js (qui tourne uniquement sur game.html) : cette page-ci
// (index.html) n'a pas besoin du moteur de jeu complet, juste d'une petite
// scène de "vitrine".
//
// IMPORTANT : la fonction skinTextureFor() ci-dessous est une copie
// volontairement gardée identique à celle de public/js/game.js, pour que
// l'aperçu ressemble exactement à ce qu'on voit en jeu. Si tu changes l'une,
// pense à reporter le changement dans l'autre.

// polyfill : THREE.CapsuleGeometry n'existe qu'à partir de r132, or le jeu charge r128.
if (!THREE.CapsuleGeometry) {
  THREE.CapsuleGeometry = function (radius = 1, length = 1, capSegments = 4, radialSegments = 8) {
    const pts = [];
    for (let i = 0; i <= capSegments; i++) {
      const a = -Math.PI / 2 + (i / capSegments) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius - length / 2));
    }
    for (let i = 0; i <= capSegments; i++) {
      const a = (i / capSegments) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius + length / 2));
    }
    return new THREE.LatheGeometry(pts, radialSegments);
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
