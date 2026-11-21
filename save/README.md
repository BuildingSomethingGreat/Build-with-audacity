# Save: replace Zoom

A video calling app you own. It has calls, screen sharing, shared notes, live captions, and AI meeting summaries, with no per-seat fees.

```
browser ⇄ browser   video + audio go directly peer to peer (WebRTC)
   ↘     ↙
  tiny server       only introduces people (WebSocket signaling) and syncs notes
```

Because the video never passes through your server, the server stays tiny. The smallest Fly machine is enough.

## Run it

```bash
npm install
npm start            # http://localhost:8080
```

Open the link in two browser tabs (or send it to a friend) to test a call.

## Features

- Calls for up to 6 people with no account and no install. Share the link and people join.
- Mute, camera, and screen share. The tile of whoever is speaking is highlighted.
- **Shared notes** that everyone edits live.
- **Live captions** using the browser's built-in speech recognition, saved to a transcript.
- **✨ Summarize** (optional): AI turns the notes and transcript into a summary, decisions, and action items. Set `ANTHROPIC_API_KEY` to enable it.
- Export the notes and transcript as Markdown.
- Nothing is stored after the last person leaves.

## Honest limits

- **Mesh calls.** Every person sends video to every other person, so quality drops past about 6 people. Bigger calls need a media server (that's what Zoom and LiveKit sell).
- **Strict firewalls.** Most networks connect fine with the free STUN servers. Some corporate networks need a TURN relay. Add one with `ICE_SERVERS`.
- **Notes sync** is "last edit wins". That's fine for one note-taker at a time.

## Deploy

```bash
fly launch --no-deploy
fly secrets set ANTHROPIC_API_KEY=…   # optional
fly deploy
```

## Make it yours (workshop prompts)

- "Add a waiting room so the host approves each person."
- "Add emoji reactions that float up over the video."
- "Add text chat over the WebRTC data channel."
- "Record the call locally with MediaRecorder."
- "Rebrand it with my company's colors and logo."
