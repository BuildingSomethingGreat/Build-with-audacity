// Peer-to-peer mesh calling: every participant connects directly to every other.
const $ = (s) => document.querySelector(s);

// Room comes from the URL (/r/<id>); otherwise make one.
let roomId = location.pathname.match(/^\/r\/([\w-]+)/)?.[1];
if (!roomId) {
  roomId = Math.random().toString(36).slice(2, 8);
  history.replaceState(null, '', `/r/${roomId}`);
}
$('#roomLabel').textContent = `Room ${roomId}`;
$('#name').value = localStorage.getItem('meet:name') || '';

const config = await fetch('/config').then((r) => r.json());
const peers = new Map(); // id -> { pc, name, tile, makingOffer, polite }
let ws, myId, localStream, screenTrack = null, recognizer = null;

// ---------- Media ----------
try {
  localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: { echoCancellation: true, noiseSuppression: true } });
} catch {
  localStream = new MediaStream();
  toast('No camera or mic access. You can still join and take notes.');
}
$('#preview').srcObject = localStream;

// ---------- UI helpers ----------
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

function addTile(id, name, stream, isMe = false) {
  let tile = document.getElementById(`tile-${id}`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = `tile${isMe ? ' me' : ''}`;
    tile.id = `tile-${id}`;
    tile.dataset.initial = (name || '?')[0].toUpperCase();
    tile.innerHTML = `<video autoplay playsinline ${isMe ? 'muted' : ''}></video><span class="label glass"></span>`;
    $('#grid').append(tile);
  }
  tile.querySelector('.label').textContent = isMe ? `${name} (you)` : name;
  if (stream) tile.querySelector('video').srcObject = stream;
  watchVoice(tile, stream);
  return tile;
}

// Blue ring around whoever is talking.
function watchVoice(tile, stream) {
  if (!stream?.getAudioTracks().length || tile.dataset.voice) return;
  tile.dataset.voice = '1';
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  (function loop() {
    analyser.getByteFrequencyData(buf);
    const level = buf.reduce((a, b) => a + b, 0) / buf.length;
    tile.classList.toggle('speaking', level > 18);
    if (tile.isConnected) requestAnimationFrame(loop); else ctx.close();
  })();
}

// ---------- Signaling ----------
const send = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

function connectPeer(id, name, initiator) {
  const pc = new RTCPeerConnection({ iceServers: config.iceServers });
  const peer = { pc, name, makingOffer: false, polite: myId > id };
  peers.set(id, peer);

  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  if (screenTrack) pc.getSenders().find((s) => s.track?.kind === 'video')?.replaceTrack(screenTrack);

  pc.ontrack = ({ streams }) => (peer.tile = addTile(id, name, streams[0]));
  pc.onicecandidate = ({ candidate }) => candidate && send({ type: 'signal', to: id, data: { candidate } });
  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      send({ type: 'signal', to: id, data: { description: pc.localDescription } });
    } finally { peer.makingOffer = false; }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') pc.restartIce();
  };
  if (!initiator) addTile(id, name, null);
  return peer;
}

// "Perfect negotiation": handles offers crossing in both directions without glare.
async function onSignal(from, { description, candidate }) {
  const peer = peers.get(from);
  if (!peer) return;
  const { pc } = peer;
  if (description) {
    const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
    if (collision && !peer.polite) return;
    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      await pc.setLocalDescription();
      send({ type: 'signal', to: from, data: { description: pc.localDescription } });
    }
  } else if (candidate) {
    try { await pc.addIceCandidate(candidate); } catch {}
  }
}

function join() {
  const name = $('#name').value.trim() || 'Guest';
  localStorage.setItem('meet:name', name);
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => send({ type: 'join', room: roomId, name });
  ws.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);
    switch (msg.type) {
      case 'welcome':
        myId = msg.id;
        $('#lobby').hidden = true; $('#call').hidden = false;
        addTile(myId, name, localStream, true);
        $('#notes').value = msg.notes;
        msg.transcript.forEach(addTranscriptLine);
        msg.peers.forEach((p) => connectPeer(p.id, p.name, true));
        if (!msg.peers.length) toast('You’re the first one here. Copy the link to invite people.');
        break;
      case 'peer-joined': connectPeer(msg.id, msg.name, false); toast(`${msg.name} joined`); break;
      case 'peer-left': {
        const p = peers.get(msg.id);
        p?.pc.close(); document.getElementById(`tile-${msg.id}`)?.remove(); peers.delete(msg.id);
        if (p) toast(`${p.name} left`);
        break;
      }
      case 'signal': await onSignal(msg.from, msg.data); break;
      case 'notes': if (document.activeElement !== $('#notes')) $('#notes').value = msg.text; break;
      case 'caption': addTranscriptLine(msg.line); showCaption(msg.line); break;
      case 'state': document.getElementById(`tile-${msg.id}`)?.classList.toggle('cam-off', !msg.video); break;
      case 'full': toast('This room is full.'); break;
    }
  };
  ws.onclose = () => !$('#call').hidden && toast('Connection lost. Refresh to rejoin.');
}

// ---------- Controls ----------
const track = (kind) => localStream.getTracks().find((t) => t.kind === kind);
const shareState = () => send({ type: 'state', audio: track('audio')?.enabled, video: track('video')?.enabled });

function toggle(kind, btn) {
  const t = track(kind);
  if (!t) return toast(`No ${kind === 'audio' ? 'microphone' : 'camera'} found`);
  t.enabled = !t.enabled;
  btn.classList.toggle('off', !t.enabled);
  if (kind === 'video') document.getElementById(`tile-${myId}`)?.classList.toggle('cam-off', !t.enabled);
  shareState();
}

async function toggleShare() {
  const btn = $('#shareBtn');
  const swap = (t) => peers.forEach(({ pc }) => pc.getSenders().find((s) => s.track?.kind === 'video')?.replaceTrack(t));
  const myVideo = document.querySelector(`#tile-${myId} video`);
  if (screenTrack) {
    screenTrack.stop(); screenTrack = null;
    swap(track('video')); myVideo.srcObject = localStream;
    document.getElementById(`tile-${myId}`).classList.remove('screen'); btn.classList.remove('on');
    return;
  }
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenTrack = display.getVideoTracks()[0];
    swap(screenTrack); myVideo.srcObject = display;
    document.getElementById(`tile-${myId}`).classList.add('screen'); btn.classList.add('on');
    screenTrack.onended = () => screenTrack && toggleShare();
  } catch {}
}

// Live captions use the browser's built-in speech recognition (Chrome, Edge, Safari).
function toggleCaptions() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) return toast('Live captions need Chrome, Edge or Safari');
  const btn = $('#ccBtn');
  if (recognizer) { recognizer.onend = null; recognizer.stop(); recognizer = null; btn.classList.remove('on'); return; }
  recognizer = new Rec();
  recognizer.continuous = true; recognizer.interimResults = false;
  recognizer.onresult = (e) => {
    const text = e.results[e.results.length - 1][0].transcript.trim();
    if (!text) return;
    send({ type: 'caption', text });
    const line = `${$('#name').value || 'Me'}: ${text}`;
    addTranscriptLine(line); showCaption(line);
  };
  recognizer.onend = () => recognizer?.start(); // keep listening
  recognizer.start();
  btn.classList.add('on');
  toast('Captions on. Everyone sees what you say.');
}

function addTranscriptLine(line) {
  const p = document.createElement('p');
  const i = line.indexOf(':');
  p.innerHTML = `<b></b>`; p.firstChild.textContent = line.slice(0, i + 1);
  p.append(line.slice(i + 1));
  $('#transcript').append(p);
  $('#transcript').scrollTop = $('#transcript').scrollHeight;
}

function showCaption(line) {
  const bar = $('#captionBar');
  bar.textContent = line; bar.hidden = false;
  clearTimeout(showCaption.t); showCaption.t = setTimeout(() => (bar.hidden = true), 4000);
}

// Shared notes: last write wins, debounced.
let notesTimer;
$('#notes').addEventListener('input', () => {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => send({ type: 'notes', text: $('#notes').value }), 250);
});

document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('#notes').hidden = tab.dataset.tab !== 'notes';
    $('#transcript').hidden = tab.dataset.tab !== 'transcript';
  }),
);

$('#summarizeBtn').disabled = !config.ai;
$('#summarizeBtn').title = config.ai ? 'AI summary of notes + transcript' : 'Set ANTHROPIC_API_KEY on the server to enable';
$('#summarizeBtn').onclick = async () => {
  const btn = $('#summarizeBtn');
  btn.disabled = true; btn.textContent = 'Thinking…';
  try {
    const r = await fetch('/api/summarize', { method: 'POST', body: JSON.stringify({ room: roomId }) });
    if (!r.ok) throw new Error();
    const { summary } = await r.json();
    $('#notes').value = `${$('#notes').value.trim()}\n\n---\n## AI summary\n${summary}\n`.trim();
    send({ type: 'notes', text: $('#notes').value });
  } catch { toast('Summary failed'); }
  btn.disabled = false; btn.textContent = 'Summarize';
};

$('#exportBtn').onclick = () => {
  const md = `# Meeting ${roomId} · ${new Date().toLocaleString()}\n\n${$('#notes').value}\n\n## Transcript\n${$('#transcript').innerText}`;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: `meeting-${roomId}.md` });
  a.click();
};

$('#joinBtn').onclick = join;
$('#name').addEventListener('keydown', (e) => e.key === 'Enter' && join());
$('#micBtn').onclick = () => toggle('audio', $('#micBtn'));
$('#camBtn').onclick = () => toggle('video', $('#camBtn'));
$('#shareBtn').onclick = toggleShare;
$('#ccBtn').onclick = toggleCaptions;
$('#panelBtn').onclick = () => { $('#panel').hidden = !$('#panel').hidden; $('#panelBtn').classList.toggle('on', !$('#panel').hidden); };
$('#linkBtn').onclick = async () => { await navigator.clipboard.writeText(location.href); toast('Invite link copied'); };
$('#leaveBtn').onclick = () => { ws?.close(); localStream.getTracks().forEach((t) => t.stop()); location.href = '/'; };

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea') || $('#call').hidden) return;
  if (e.key === 'm') $('#micBtn').click();
  if (e.key === 'v') $('#camBtn').click();
  if (e.key === 'n') $('#panelBtn').click();
});
