const { execFile } = require("child_process");
const youtubedl = require("youtube-dl-exec");

// Without a JavaScript runtime yt-dlp cannot solve YouTube's signature
// challenges. It does not fail outright: it quietly falls back to the
// android_vr client, which works for a few minutes on a datacenter IP and then
// starts getting refused. That silent degradation is hard to spot in logs, so
// check for it once at boot and say so plainly.
function checkYtdlpRuntime() {
  const binary = youtubedl.constants
    ? youtubedl.constants.YOUTUBE_DL_PATH
    : null;

  const run = (cmd, args) =>
    new Promise((resolve) =>
      execFile(cmd, args, { timeout: 20000 }, (err, stdout, stderr) =>
        resolve(`${stdout || ""}${stderr || ""}`)
      )
    );

  return run(binary || "yt-dlp", ["-v", "--simulate", "--skip-download", "--playlist-items", "0", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"])
    .then((output) => {
      const match = output.match(/JS runtimes:\s*(.+)/);
      const runtimes = match ? match[1].trim() : "";

      if (!runtimes || /unsupported|none/i.test(runtimes)) {
        console.warn(
          "WARNING: yt-dlp has no supported JavaScript runtime " +
            `(reported: ${runtimes || "none"}). YouTube extraction will degrade to ` +
            "the android_vr client and start failing within minutes. Install Deno " +
            "on this host: https://github.com/yt-dlp/yt-dlp/wiki/EJS"
        );
      } else {
        console.log(`yt-dlp JS runtime available: ${runtimes}`);
      }
    })
    .catch((err) => {
      console.warn(`Could not run yt-dlp preflight: ${err.message}`);
    });
}

module.exports = checkYtdlpRuntime;
