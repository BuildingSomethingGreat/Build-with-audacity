# Build Audaciously

> "Build me a million dollar app. Make no mistaks."

Starter repo for the workshop. Pick one track:

| Track | What you build | Folder |
|---|---|---|
| **Earn** | An AI agent that writes a micro-book, puts it on sale with Stripe, and runs a Meta ad for it | [`earn/`](earn) |
| **Save** | A peer-to-peer replacement for Zoom, with shared notes, live captions and AI summaries | [`save/`](save) |

Both run on Node 20+, use almost no dependencies, and deploy to [Fly.io](https://fly.io) on the smallest machine with scale-to-zero, so they cost very little while idle.

## Quick start

```bash
git clone https://github.com/BuildingSomethingGreat/build-with-audacity && cd build-with-audacity

# Earn
cd earn && npm install && cp .env.example .env
npm run agent      # with no keys it runs in dry-run mode and still produces a book
npm start          # http://localhost:8080

# Save
cd ../save && npm install && npm start   # http://localhost:8080
```

## Workshop flow (11:30–2:30)

| Time | Block |
|---|---|
| 11:30 | The idea: audacity, delusion, and "why not?" |
| 12:00 | Pick a track, clone, run it locally |
| 12:30 | Make it yours: prompt the AI to change the niche, design, or features |
| 1:30 | Deploy to Fly |
| 2:15 | Show and tell |

## Deploy (either track)

```bash
brew install flyctl          # or: curl -L https://fly.io/install.sh | sh
fly auth login
fly launch --no-deploy       # accept the included fly.toml; pick a unique app name
fly secrets set KEY=value    # see each track's .env.example
fly deploy
```

## The rule of the room

The AI will make mistakes. You will too. Ask, run it, read the error, ask again. That loop is the whole skill.
