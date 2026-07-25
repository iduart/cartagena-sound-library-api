// Repeatedly extracts and clips audio for N minutes, reporting every attempt,
// to catch the "worked for a minute then stopped" failure mode.
//
//   node ec2-sim/soak-extraction.js [minutes] [intervalSeconds] [url]
//
// Run it on the real EC2 box too -- that is the only place a datacenter IP
// block will actually show up.
const fs = require("fs");
const path = require("path");
const youtubedl = require("youtube-dl-exec");
const ffmpeg = require("fluent-ffmpeg");

const { YT_COOKIES_FILE, YT_PROXY, YT_PLAYER_CLIENTS } = process.env;

const minutes = Number(process.argv[2] || 10);
const intervalSeconds = Number(process.argv[3] || 30);
const url = process.argv[4] || "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const clients = YT_PLAYER_CLIENTS
  ? YT_PLAYER_CLIENTS.split(",").map((c) => c.trim()).filter(Boolean)
  : ["default", "tv", "android_vr"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function optionsFor(client) {
  const options = {
    dumpSingleJson: true,
    noWarnings: true,
    noPlaylist: true,
    retries: 3,
    socketTimeout: 30,
    extractorArgs: `youtube:player_client=${client}`,
  };
  if (YT_COOKIES_FILE && fs.existsSync(YT_COOKIES_FILE)) options.cookies = YT_COOKIES_FILE;
  if (YT_PROXY) options.proxy = YT_PROXY;
  return options;
}

function audioFormat(info) {
  const audio = ((info && info.formats) || []).filter(
    (f) => f.url && f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none")
  );
  if (!audio.length) return null;
  return audio.find((f) => String(f.format_id) === "140") || audio.pop();
}

async function extractOnce(i) {
  for (const client of clients) {
    try {
      const info = await youtubedl(url, optionsFor(client));
      const format = audioFormat(info);
      if (!format) throw new Error("no playable audio format");

      const out = path.join("/tmp", `soak-${i}.mp3`);
      const headerLines = Object.entries(format.http_headers || {})
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join("");

      await new Promise((resolve, reject) => {
        const cmd = ffmpeg(format.url);
        if (headerLines) cmd.inputOptions(["-headers", headerLines]);
        cmd
          .setStartTime("00:00:10.00")
          .setDuration(7)
          .format("mp3")
          .audioCodec("libmp3lame")
          .on("end", resolve)
          .on("error", reject)
          .save(out);
      });

      const bytes = fs.statSync(out).size;
      fs.unlinkSync(out);
      if (bytes < 10000) throw new Error(`clip too small (${bytes} bytes)`);
      return { ok: true, client, format: format.format_id, bytes };
    } catch (err) {
      const details = (err.stderr || err.message || String(err)).replace(/\s+/g, " ").slice(0, 160);
      if (client === clients[clients.length - 1]) return { ok: false, details };
      console.log(`    client "${client}" failed, trying next: ${details}`);
    }
  }
}

async function main() {
  const started = Date.now();
  const deadline = started + minutes * 60 * 1000;
  let attempt = 0;
  let failures = 0;

  console.log(`soak: ${minutes}min every ${intervalSeconds}s, clients=[${clients.join(", ")}]`);
  console.log(`cookies=${YT_COOKIES_FILE || "none"} proxy=${YT_PROXY || "none"}\n`);

  while (Date.now() < deadline) {
    attempt += 1;
    const elapsed = Math.round((Date.now() - started) / 1000);
    const t0 = Date.now();
    const result = await extractOnce(attempt);
    const took = ((Date.now() - t0) / 1000).toFixed(1);

    if (result.ok) {
      console.log(
        `[t+${elapsed}s] #${attempt} OK  client=${result.client} fmt=${result.format} ${result.bytes}B (${took}s)`
      );
    } else {
      failures += 1;
      console.log(`[t+${elapsed}s] #${attempt} FAIL (${took}s) ${result.details}`);
    }

    if (Date.now() < deadline) await sleep(intervalSeconds * 1000);
  }

  console.log(`\nsoak done: ${attempt - failures}/${attempt} succeeded over ${minutes} minutes`);
  process.exit(failures ? 1 : 0);
}

main();
