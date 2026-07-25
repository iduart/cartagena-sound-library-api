# EC2 simulation

Runs the API in a container that matches the Elastic Beanstalk / EC2 box, so
YouTube extraction failures that only appear in production can be reproduced
without deploying.

## What it matches

| | EC2 / Elastic Beanstalk | This container |
|---|---|---|
| OS | Amazon Linux | `amazonlinux:2023` |
| Arch | x86_64 | `linux/amd64` (emulated on Apple Silicon) |
| Node | 20 | 20 |
| ffmpeg | static build via `.ebextensions` | same static build, current release |
| Deno (yt-dlp JS runtime) | **must be installed — see below** | installed in the image |
| Python | 3.11 (3.9 is too old for yt-dlp) | 3.11 |
| Browser / desktop session cookies | none | none |
| Native modules (`sharp`, yt-dlp binary) | built for linux/x64 | built for linux/x64 inside the image |

## What it does NOT match

**Outbound IP.** Traffic still leaves through your home connection, not an AWS
datacenter range. YouTube's bot detection keys heavily on that, so a request
that succeeds here can still get "Sign in to confirm you're not a bot" on the
real EC2 box. If that happens in production, use `YT_COOKIES_FILE` or `YT_PROXY`
(below) — the code paths are already wired up.

## Run

```bash
docker compose -f ec2-sim/docker-compose.yml up -d --build
docker logs -f csl-api-ec2
```

The API listens on `0.0.0.0:8000` of the host, which is the same address the
Expo app already derives from its dev-server host — no app config change needed.

Verify just the YouTube -> ffmpeg half, with no S3 credentials involved:

```bash
docker exec csl-api-ec2 node ec2-sim/verify-extraction.js
docker exec csl-api-ec2 node ec2-sim/verify-extraction.js "https://youtu.be/<id>"
```

Exercise the real mutation:

```bash
curl -s -X POST http://localhost:8000/ -H 'Content-Type: application/json' -d '{
  "query": "mutation($input: createSoundInput!){ createSound(input:$input){ _id sound thumbnail } }",
  "variables": {"input": {"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "from":"00:00:10.00","to":"00:00:17.00","name":"test","author":"test",
    "deviceId":"ec2-sim-test","isPreview":true}}}'
```

## Why extraction used to die after a minute

yt-dlp needs a JavaScript runtime to execute YouTube's player JS and solve the
signature / n-transform challenges. When none is present it does **not** fail —
it silently falls back to the `android_vr` client, which returns working URLs
for a short while and then starts getting refused. That is the "worked for one
minute" symptom.

Node 20 does not qualify; yt-dlp reports it as `node-20.20.2 (unsupported)`.
Deno is yt-dlp's default runtime and the one to install.

The API logs which runtime it found at boot:

```
yt-dlp JS runtime available: deno-2.9.4          <- healthy
WARNING: yt-dlp has no supported JavaScript runtime ...   <- will degrade
```

### Installing Deno on the real EC2 / Elastic Beanstalk box

Add to `.ebextensions` (alongside the existing ffmpeg config):

```yaml
packages:
  yum:
    unzip: []
commands:
  01-deno:
    command: |
      curl -fsSL -o /tmp/deno.zip https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip
      unzip -oq /tmp/deno.zip -d /usr/local/bin
      chmod +x /usr/local/bin/deno
```

Use `deno-aarch64-unknown-linux-gnu.zip` instead on a Graviton instance.

`XDG_CACHE_HOME` must also point somewhere writable by the app user, or yt-dlp
re-solves the player JS on every request instead of caching it.

## Proving it stays working

```bash
docker exec csl-api-ec2 node ec2-sim/soak-extraction.js 12 30
```

Extracts and clips every 30s for 12 minutes and prints one line per attempt, so
a degradation that only appears after a few minutes is visible. Copy this script
to the EC2 box and run it there — a datacenter IP block cannot be reproduced
from a residential connection.

## Env vars for YouTube blocking

Set these in `.env`; they are read by `src/resources/sounds/resolvers/createSound.js`.

- `YT_COOKIES_FILE` — path to a Netscape `cookies.txt` exported from a browser
  logged into YouTube. Mount it into the container and point at the mounted
  path. This is what gets past "Sign in to confirm you're not a bot".
- `YT_PROXY` — e.g. `http://user:pass@host:port`. A residential proxy is the
  reliable fix for a datacenter IP being flagged; cookies alone can still fail.
- `YT_PLAYER_CLIENTS` — comma-separated `player_client` values, tried in order.
  Defaults to `default,tv,android_vr`. Each is attempted twice with a backoff
  before moving to the next, so one client being refused does not fail the
  request. Note that yt-dlp silently *skips* a client name it does not
  recognise, so a typo here behaves like `default` rather than erroring.

Of the clients available without a PO token, only `default`, `tv` and
`android_vr` return itag 140; `web_safari`, `mweb` and `ios` do not.

None are required when extraction already works, as it does from a residential IP.
