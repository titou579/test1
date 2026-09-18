// public/js/voice.js — Chat vocal en mesh WebRTC, signalé via Socket.io.
// PROTOTYPE : une architecture "mesh" (chaque joueur connecté directement à
// chaque autre) fonctionne bien jusqu'à ~6-8 joueurs simultanés en vocal.
// Au-delà (jusqu'à 15 joueurs), il faudrait un serveur SFU (ex: mediasoup,
// LiveKit) — voir la section correspondante du README.md.

window.SwapVoice = (function () {
  let localStream = null;
  const peers = new Map(); // socketId -> RTCPeerConnection

  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  async function join(socket) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alert("Impossible d'accéder au micro : " + e.message);
      return;
    }
    socket.emit('voice:join');

    socket.on('voice:peer-joined', ({ socketId }) => createPeer(socket, socketId, true));
    socket.on('voice:peer-left', ({ socketId }) => removePeer(socketId));
    socket.on('voice:signal', async ({ from, data }) => {
      let pc = peers.get(from);
      if (!pc) pc = createPeer(socket, from, false);
      if (data.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('voice:signal', { to: from, data: pc.localDescription });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data); } catch (e) { /* ignore */ }
      }
    });
  }

  function createPeer(socket, remoteId, isInitiator) {
    const pc = new RTCPeerConnection(rtcConfig);
    peers.set(remoteId, pc);
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('voice:signal', { to: remoteId, data: e.candidate }); };
    pc.ontrack = (e) => {
      let audioEl = document.getElementById('voice_' + remoteId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = 'voice_' + remoteId;
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = e.streams[0];
      audioEl.volume = window.SOD_SETTINGS ? window.SOD_SETTINGS.get().voiceVolume : 1;
    };

    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice:signal', { to: remoteId, data: pc.localDescription });
      };
    }
    return pc;
  }

  function removePeer(remoteId) {
    const pc = peers.get(remoteId);
    if (pc) { pc.close(); peers.delete(remoteId); }
    const audioEl = document.getElementById('voice_' + remoteId);
    if (audioEl) audioEl.remove();
  }

  function leave(socket) {
    socket.emit('voice:leave');
    for (const id of [...peers.keys()]) removePeer(id);
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  }

  return { join, leave };
})();
