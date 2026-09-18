// public/js/sfx.js
//
// Effets sonores générés à la volée avec l'API Web Audio (oscillateurs / bruit
// blanc filtré). Ça évite de devoir fournir des fichiers audio (poids,
// licences...) tout en donnant un vrai retour sonore au jeu. Respecte le
// réglage "volume du chat vocal" ? Non — un volume dédié est utilisé ici,
// simplement plafonné si l'utilisateur a coché "Réduire les effets" dans
// l'onglet Réglages.
window.SFX = (function () {
  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function masterVolume() {
    const reduced = window.SOD_SETTINGS && window.SOD_SETTINGS.get().reducedFx;
    return reduced ? 0.12 : 0.28;
  }

  function tone(freq, duration = 0.15, type = 'sine', delay = 0, gainMul = 1) {
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime + delay);
      gain.gain.setValueAtTime(0.0001, c.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(masterVolume() * gainMul, c.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + duration);
      osc.connect(gain).connect(c.destination);
      osc.start(c.currentTime + delay);
      osc.stop(c.currentTime + delay + duration + 0.02);
    } catch { /* Audio non disponible (ex: avant une interaction utilisateur) */ }
  }

  function noiseBurst(duration = 0.2, gainMul = 1) {
    try {
      const c = getCtx();
      const bufferSize = c.sampleRate * duration;
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      const src = c.createBufferSource();
      src.buffer = buffer;
      const gain = c.createGain();
      gain.gain.value = masterVolume() * gainMul;
      src.connect(gain).connect(c.destination);
      src.start();
    } catch { /* ignore */ }
  }

  return {
    hit() { tone(180, 0.12, 'square', 0, 1.2); },
    damage() { tone(140, 0.18, 'sawtooth', 0, 1); },
    gather() { tone(520, 0.08, 'sine'); },
    chestOpen() { tone(440, 0.1, 'triangle'); tone(660, 0.15, 'triangle', 0.09); },
    craft() { tone(300, 0.08, 'square'); tone(500, 0.1, 'square', 0.07); },
    swapWarning() { tone(220, 0.4, 'sawtooth', 0, 0.7); },
    swapExecuted() { noiseBurst(0.3, 1.3); tone(90, 0.5, 'sawtooth', 0, 1.2); },
    death() { tone(200, 0.3, 'sawtooth'); tone(100, 0.5, 'sawtooth', 0.15); },
    elimination() { tone(160, 0.5, 'sawtooth'); tone(80, 0.7, 'sawtooth', 0.25); },
    victory() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', i * 0.12, 0.9)); },
    levelUp() { [440, 554, 659].forEach((f, i) => tone(f, 0.18, 'sine', i * 0.09)); },
    click() { tone(700, 0.05, 'square', 0, 0.5); },
  };
})();
