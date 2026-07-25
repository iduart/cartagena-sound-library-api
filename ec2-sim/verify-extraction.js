// Proves the YouTube -> ffmpeg half of createSound works on this host, with no
// S3 credentials involved. Run inside the EC2 simulation:
//
//   docker exec csl-api-ec2 node ec2-sim/verify-extraction.js [youtube-url]
const fs = require("fs");
const youtubedl = require("youtube-dl-exec");
const ffmpeg = require("fluent-ffmpeg");

const { YT_COOKIES_FILE, YT_PROXY, YT_PLAYER_CLIENTS } = process.env;

const url = process.argv[2] || "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const OUT = "/tmp/verify-segment.mp3";

const options = {
  dumpSingleJson: true,
  noWarnings: true,
  noPlaylist: true,
  retries: 3,
  socketTimeout: 30,
};
if (YT_COOKIES_FILE && fs.existsSync(YT_COOKIES_FILE)) options.cookies = YT_COOKIES_FILE;
if (YT_PROXY) options.proxy = YT_PROXY;
if (YT_PLAYER_CLIENTS) options.extractorArgs = `youtube:player_client=${YT_PLAYER_CLIENTS}`;

async function main() {
  console.log(`cookies=${options.cookies || "none"} proxy=${options.proxy || "none"}`);

  const info = await youtubedl(url, options);
  console.log(`title: ${info.title}`);

  const audio = (info.formats || []).filter(
    (f) => f.url && f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none")
  );
  const format = audio.find((f) => String(f.format_id) === "140") || audio.pop();
  if (!format) throw new Error("no audio-only format");
  console.log(`format: ${format.format_id} ${format.ext} ${format.abr}kbps`);
  console.log(`thumbnail: ${info.thumbnail}`);

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
      .save(OUT);
  });

  const bytes = fs.statSync(OUT).size;
  console.log(`wrote ${OUT} (${bytes} bytes)`);

  ffmpeg.ffprobe(OUT, (err, data) => {
    if (err) throw err;
    console.log(`probed duration: ${data.format.duration}s codec: ${data.streams[0].codec_name}`);
    console.log(bytes > 10000 ? "EXTRACTION OK" : "EXTRACTION SUSPECT (file too small)");
  });
}

main().catch((e) => {
  console.error("EXTRACTION FAILED:", e.stderr || e.message);
  process.exit(1);
});
