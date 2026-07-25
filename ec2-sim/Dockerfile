# Simulation of the Elastic Beanstalk / EC2 box the API actually runs on.
#
# Faithful to prod in: OS (Amazon Linux), CPU arch (x86_64), Node runtime,
# static ffmpeg installed the same way .ebextensions does it, no browser,
# no desktop keychain, no user session cookies.
#
# NOT faithful in one respect that matters: outbound traffic still leaves via
# the host's residential IP, not an AWS datacenter IP. See ec2-sim/README.md.
FROM amazonlinux:2023

# python3.11: Amazon Linux 2023 defaults to python3.9, but the yt-dlp zipapp
# that youtube-dl-exec installs requires 3.10+. The real EB box needs this too.
RUN dnf -y update && \
    dnf -y install nodejs20 nodejs20-npm tar xz findutils shadow-utils procps-ng \
                   ca-certificates python3.11 unzip && \
    ln -sf /usr/bin/python3.11 /usr/local/bin/python3 && \
    ln -sf /usr/bin/node-20 /usr/local/bin/node 2>/dev/null || true; \
    dnf clean all

RUN python3 --version

# Amazon Linux packages node as `node` once nodejs20 is the only stream.
RUN node --version && npm --version

# Same static ffmpeg approach as .ebextensions/00_ffmpeg_package.config,
# but a current release rather than the 3.4.2 pinned there.
RUN curl -fsSL -o /tmp/ffmpeg.tar.xz \
      https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
    mkdir -p /opt/ffmpeg && \
    tar xf /tmp/ffmpeg.tar.xz -C /opt/ffmpeg --strip-components=1 && \
    ln -sf /opt/ffmpeg/ffmpeg /usr/bin/ffmpeg && \
    ln -sf /opt/ffmpeg/ffprobe /usr/bin/ffprobe && \
    rm -f /tmp/ffmpeg.tar.xz && \
    ffmpeg -version | head -1

# Deno: yt-dlp needs a JavaScript runtime to run YouTube's player JS and solve
# signature/n-transform challenges. Without one it silently degrades to the
# android_vr client, which YouTube blocks within minutes. Node 20 is reported
# by yt-dlp as "unsupported", so Deno (its default runtime) is what we install.
RUN curl -fsSL -o /tmp/deno.zip \
      https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip && \
    unzip -oq /tmp/deno.zip -d /usr/local/bin && \
    chmod +x /usr/local/bin/deno && \
    rm -f /tmp/deno.zip && \
    deno --version

WORKDIR /var/app/current

# Dependencies are installed inside the image so native binaries (sharp,
# the yt-dlp binary youtube-dl-exec downloads) match linux/x64, not macOS.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY ec2-sim/*.js ./ec2-sim/

# Run as a non-root app user, like the EB platform does.
RUN useradd -m -s /bin/bash webapp && chown -R webapp:webapp /var/app
USER webapp

ENV NODE_ENV=production
# yt-dlp caches solved signature functions here; a writable path saves it from
# re-solving the player JS on every single request.
ENV XDG_CACHE_HOME=/home/webapp/.cache
EXPOSE 8000
CMD ["node", "src/index.js"]
