// Static files + WebSocket signaling + shared notes + optional AI summary.
// Video and audio never touch this server: they flow peer to peer over WebRTC.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = path.resolve('public');
const MAX_PEERS = 6; // mesh calls work best with a handful of people
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const ICE = process.env.ICE_SERVERS
  ? JSON.parse(process.env.ICE_SERVERS)
  : [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/** rooms: roomId -> { peers: Map<id, {ws, name}>, notes: string, transcript: string[] } */
const rooms = new Map();

const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c)).on('end', () => resolve(d));
  });

async function summarize(notes, transcript) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `Summarize this meeting in Markdown with sections: Summary (3 bullets), Decisions, Action items (owner if known).\n\nNOTES:\n${notes}\n\nTRANSCRIPT:\n${transcript.slice(-400).join('\n')}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).content.map((c) => c.text || '').join('');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/health') return res.end('ok');
  if (url.pathname === '/config') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ iceServers: ICE, ai: Boolean(process.env.ANTHROPIC_API_KEY) }));
  }

  if (url.pathname === '/api/summarize' && req.method === 'POST') {
    if (!process.env.ANTHROPIC_API_KEY) return res.writeHead(501).end('AI not configured');
    const { room } = JSON.parse((await readBody(req)) || '{}');
    const r = rooms.get(room);
    if (!r) return res.writeHead(404).end('no room');
    try {
      const summary = await summarize(r.notes, r.transcript);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ summary }));
    } catch (e) {
      console.error(e);
      return res.writeHead(502).end('summary failed');
    }
  }

  // Static files; any unknown path (like /r/abc) serves the app.
  let file = path.join(PUBLIC, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(PUBLIC, 'index.html');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

wss.on('connection', (ws) => {
  const id = crypto.randomUUID().slice(0, 8);
  let room = null;

  const others = () => [...room.peers].filter(([pid]) => pid !== id);
  const broadcast = (msg) => others().forEach(([, p]) => p.ws.send(JSON.stringify(msg)));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join' && !room) {
      const roomId = String(msg.room || '').slice(0, 64);
      if (!roomId) return;
      if (!rooms.has(roomId)) rooms.set(roomId, { peers: new Map(), notes: '', transcript: [] });
      room = rooms.get(roomId);
      room.id = roomId;
      if (room.peers.size >= MAX_PEERS) {
        ws.send(JSON.stringify({ type: 'full' }));
        return ws.close();
      }
      const name = String(msg.name || 'Guest').slice(0, 40);
      // Newcomer gets the current peers and calls each of them.
      ws.send(JSON.stringify({
        type: 'welcome', id,
        peers: [...room.peers].map(([pid, p]) => ({ id: pid, name: p.name })),
        notes: room.notes, transcript: room.transcript,
      }));
      room.peers.set(id, { ws, name });
      broadcast({ type: 'peer-joined', id, name });
      return;
    }
    if (!room) return;

    switch (msg.type) {
      case 'signal': { // SDP offers/answers and ICE candidates, relayed to one peer
        const target = room.peers.get(msg.to);
        if (target) target.ws.send(JSON.stringify({ type: 'signal', from: id, data: msg.data }));
        break;
      }
      case 'notes':
        room.notes = String(msg.text || '').slice(0, 100_000);
        broadcast({ type: 'notes', text: room.notes, from: id });
        break;
      case 'caption': {
        const line = `${room.peers.get(id).name}: ${String(msg.text || '').slice(0, 500)}`;
        room.transcript.push(line);
        if (room.transcript.length > 2000) room.transcript.shift();
        broadcast({ type: 'caption', line });
        break;
      }
      case 'state': // mute/camera indicators
        broadcast({ type: 'state', id, audio: !!msg.audio, video: !!msg.video });
        break;
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.peers.delete(id);
    broadcast({ type: 'peer-left', id });
    if (room.peers.size === 0) rooms.delete(room.id); // nothing is stored after the call ends
  });
});

server.listen(PORT, () => console.log(`meet on :${PORT}`));
