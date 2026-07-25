#!/bin/bash
# EC2 bootstrap for the API. Mirrors ec2-sim/Dockerfile so the box that runs in
# production matches the one the fix was verified against.
set -xeuo pipefail

DEPLOY_BUCKET=__DEPLOY_BUCKET__
REGION=__REGION__

dnf -y update
# No ffmpeg in the AL2023 repos, so it comes from the static build below.
dnf -y install nodejs20 nodejs20-npm tar xz unzip python3.11

# python3.11: AL2023 ships 3.9, which the yt-dlp zipapp refuses to run on.
ln -sf /usr/bin/python3.11 /usr/local/bin/python3

# Deno: without a JS runtime yt-dlp silently degrades to the android_vr client
# and YouTube starts refusing it after a few minutes.
curl -fsSL -o /tmp/deno.zip \
  https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip
unzip -oq /tmp/deno.zip -d /usr/local/bin
chmod +x /usr/local/bin/deno
deno --version

# ffmpeg: static build, same as .ebextensions and the container sim use.
if ! command -v ffmpeg >/dev/null 2>&1; then
  curl -fsSL -o /tmp/ffmpeg.tar.xz \
    https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
  mkdir -p /opt/ffmpeg
  tar xf /tmp/ffmpeg.tar.xz -C /opt/ffmpeg --strip-components=1
  ln -sf /opt/ffmpeg/ffmpeg /usr/bin/ffmpeg
  ln -sf /opt/ffmpeg/ffprobe /usr/bin/ffprobe
fi
ffmpeg -version | head -1

id -u webapp >/dev/null 2>&1 || useradd -m -s /bin/bash webapp
mkdir -p /var/app/current
chown -R webapp:webapp /var/app

# Pull + install the app. Kept in its own script so redeploys can rerun it.
cat >/usr/local/bin/csl-deploy.sh <<DEPLOY
#!/bin/bash
set -xeuo pipefail
aws s3 cp s3://$DEPLOY_BUCKET/app.tar.gz /tmp/app.tar.gz --region $REGION
rm -rf /var/app/current
mkdir -p /var/app/current
tar xzf /tmp/app.tar.gz -C /var/app/current
cd /var/app/current
npm ci --omit=dev
chown -R webapp:webapp /var/app
systemctl restart csl-api || true
DEPLOY
chmod +x /usr/local/bin/csl-deploy.sh

cat >/etc/systemd/system/csl-api.service <<'UNIT'
[Unit]
Description=Cartagena Sound Library API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=webapp
WorkingDirectory=/var/app/current
Environment=NODE_ENV=production
# yt-dlp caches solved signature functions here; must be writable by webapp or
# the player JS is re-solved on every single request.
Environment=XDG_CACHE_HOME=/var/app/cache
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

mkdir -p /var/app/cache
chown -R webapp:webapp /var/app

/usr/local/bin/csl-deploy.sh

systemctl daemon-reload
systemctl enable --now csl-api
sleep 5
systemctl status csl-api --no-pager || true
echo "BOOTSTRAP COMPLETE"
