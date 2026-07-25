#!/usr/bin/env bash
# Provisions a single EC2 instance running this API, and deploys the current
# working tree to it.
#
#   ./scripts/deploy-ec2.sh            # provision + deploy
#   ./scripts/deploy-ec2.sh redeploy   # push code again to the existing box
#
# Design notes:
#  - Access is via SSM Session Manager, so there is no SSH key to manage and
#    port 22 stays shut.
#  - S3 credentials come from the instance role, not static keys in .env.
#  - An Elastic IP keeps the address stable, because it has to be registered in
#    the MongoDB Atlas access list and a stop/start would otherwise change it.
set -euo pipefail

REGION="${AWS_REGION:-us-east-2}"
NAME="csl-api"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.micro}"

SOUNDS_BUCKET="${SOUNDS_BUCKET:-csl-sounds}"
THUMBNAILS_BUCKET="${THUMBNAILS_BUCKET:-csl-thumbnails}"
TEMP_BUCKET="${TEMP_BUCKET:-csl-previews}"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
DEPLOY_BUCKET="csl-deploy-$ACCOUNT"
ROLE="$NAME-role"
PROFILE="$NAME-profile"
SG="$NAME-sg"

aws() { command aws --region "$REGION" "$@"; }

log() { echo "==> $*"; }

# ---------------------------------------------------------------- deploy bundle
build_bundle() {
  local tmp
  tmp=$(mktemp -d)
  mkdir -p "$tmp/app"

  cp -R src package.json package-lock.json "$tmp/app/"
  mkdir -p "$tmp/app/ec2-sim"
  cp ec2-sim/*.js "$tmp/app/ec2-sim/" 2>/dev/null || true

  # Runtime env for the instance. Deliberately no AWS_ACCESS_KEY_ID /
  # AWS_SECRET_ACCESS_KEY: the instance role provides them.
  # Mongo points at Atlas, read from the commented prod block in local .env.
  python3 - "$tmp/app/.env" <<'PY'
import re, sys
src = open(".env").read()

def commented(key):
    m = re.search(rf"^#\s*{key}=(.+)$", src, re.M)
    return m.group(1).strip() if m else None

def active(key):
    m = re.search(rf"^{key}=(.*)$", src, re.M)
    return m.group(1).strip() if m else None

# Whatever is uncommented in .env wins; a commented block is only a fallback
# for when the local file is pointed at a local mongod instead.
host = active("MONGO_HOST") or commented("MONGO_HOST")
user = active("MONGO_USER") or commented("MONGO_USER")
pw   = active("MONGO_PASSWORD") or commented("MONGO_PASSWORD")

if not (host and user and pw):
    sys.exit("could not find Mongo credentials in .env")

# A local host would leave the instance pointing at a mongod that is not there,
# and the app would crash-loop on boot. Refuse to build such a bundle.
if host in ("localhost", "127.0.0.1") or "." not in host:
    sys.exit(
        f"MONGO_HOST is {host!r}, which the EC2 instance cannot reach. "
        "Point .env at the Atlas cluster before deploying."
    )

import os

lines = [
    "PORT=8000",
    f"MONGO_HOST={host}",
    f"MONGO_USER={user}",
    f"MONGO_PASSWORD={pw}",
    "MONGO_DATABASE=cartagena-sound-library",
    f"AWS_REGION={os.environ.get('REGION','us-east-2')}",
    f"TEMP_BUCKET={os.environ.get('TEMP_BUCKET','csl-previews')}",
    f"SOUNDS_BUCKET={os.environ.get('SOUNDS_BUCKET','csl-sounds')}",
    f"THUMBNAILS_BUCKET={os.environ.get('THUMBNAILS_BUCKET','csl-thumbnails')}",
]

# Optional tuning carried over from the local .env. Without this the proxy
# credentials and rate limits would silently never reach the instance.
for key in (
    "YT_PROXY",
    "YT_COOKIES_FILE",
    "YT_PLAYER_CLIENTS",
    "RATE_LIMIT_DEVICE_PER_MINUTE",
    "RATE_LIMIT_DEVICE_PER_HOUR",
    "RATE_LIMIT_IP_PER_HOUR",
    "MAX_CONCURRENT_EXTRACTIONS",
):
    value = active(key)
    if value:
        lines.append(f"{key}={value}")

open(sys.argv[1], "w").write("\n".join(lines) + "\n")
print("built .env for instance:", ", ".join(
    k for k in ("YT_PROXY", "YT_COOKIES_FILE") if active(k)) or "no proxy/cookies configured")
PY

  tar -czf /tmp/csl-app.tar.gz -C "$tmp/app" .
  rm -rf "$tmp"
  log "bundle: $(du -h /tmp/csl-app.tar.gz | cut -f1)"
}

upload_bundle() {
  if ! aws s3api head-bucket --bucket "$DEPLOY_BUCKET" 2>/dev/null; then
    log "creating private deploy bucket $DEPLOY_BUCKET"
    aws s3api create-bucket --bucket "$DEPLOY_BUCKET" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
    aws s3api put-public-access-block --bucket "$DEPLOY_BUCKET" \
      --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" >/dev/null
  fi
  aws s3 cp /tmp/csl-app.tar.gz "s3://$DEPLOY_BUCKET/app.tar.gz" >/dev/null
  log "bundle uploaded to s3://$DEPLOY_BUCKET/app.tar.gz"
}

# ---------------------------------------------------------------------- redeploy
if [ "${1:-}" = "redeploy" ]; then
  build_bundle
  upload_bundle
  ID=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=running" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text)
  [ "$ID" = "None" ] && { echo "no running $NAME instance"; exit 1; }
  log "redeploying to $ID"
  CMD=$(aws ssm send-command --instance-ids "$ID" \
    --document-name AWS-RunShellScript --timeout-seconds 900 \
    --parameters 'commands=["/usr/local/bin/csl-deploy.sh"]' \
    --query 'Command.CommandId' --output text)
  echo "  ssm command: $CMD"

  # Block until it finishes. Returning early invites testing against the old
  # code while npm ci is still swapping node_modules underneath it.
  for _ in $(seq 1 120); do
    STATUS=$(aws ssm get-command-invocation --command-id "$CMD" \
      --instance-id "$ID" --query Status --output text 2>/dev/null || echo Pending)
    case "$STATUS" in
      Success) echo "  deploy complete"; break;;
      Failed|TimedOut|Cancelled)
        echo "  deploy $STATUS"
        aws ssm get-command-invocation --command-id "$CMD" --instance-id "$ID" \
          --query 'StandardErrorContent' --output text | tail -20
        exit 1;;
    esac
    sleep 5
  done

  # And wait for the service to actually answer before handing back control.
  for _ in $(seq 1 60); do
    if curl -s -m 5 -o /dev/null "http://localhost:8000/" 2>/dev/null; then break; fi
    sleep 2
  done
  exit 0
fi

# ------------------------------------------------------------------------- IAM
log "IAM role"
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]
  }' >/dev/null
fi
aws iam attach-role-policy --role-name "$ROLE" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null

aws iam put-role-policy --role-name "$ROLE" --policy-name "$NAME-s3" \
  --policy-document "{
    \"Version\":\"2012-10-17\",
    \"Statement\":[
      {\"Effect\":\"Allow\",
       \"Action\":[\"s3:PutObject\",\"s3:DeleteObject\",\"s3:AbortMultipartUpload\",\"s3:ListMultipartUploadParts\"],
       \"Resource\":[\"arn:aws:s3:::$SOUNDS_BUCKET/*\",\"arn:aws:s3:::$THUMBNAILS_BUCKET/*\",\"arn:aws:s3:::$TEMP_BUCKET/*\"]},
      {\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\"],
       \"Resource\":\"arn:aws:s3:::$DEPLOY_BUCKET/*\"}
    ]
  }" >/dev/null

if ! aws iam get-instance-profile --instance-profile-name "$PROFILE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$PROFILE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE" --role-name "$ROLE" >/dev/null
  log "waiting for instance profile to propagate"
  sleep 15
fi

# ------------------------------------------------------------- security group
MY_IP=$(curl -s -m 15 https://checkip.amazonaws.com | tr -d '\n')
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)

log "security group (port 8000 from $MY_IP only)"
SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$SG" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")
if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  SG_ID=$(aws ec2 create-security-group --group-name "$SG" \
    --description "cartagena sound library api" --vpc-id "$VPC" \
    --query GroupId --output text)
fi
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 8000 --cidr "$MY_IP/32" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------- launch
build_bundle
upload_bundle

AMI=$(aws ssm get-parameter \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query Parameter.Value --output text)
SUBNET=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true \
  --query 'Subnets[0].SubnetId' --output text)

log "launching $INSTANCE_TYPE from $AMI"
USER_DATA=$(sed "s|__DEPLOY_BUCKET__|$DEPLOY_BUCKET|g; s|__REGION__|$REGION|g" scripts/ec2-userdata.sh | base64)

ID=$(aws ec2 run-instances \
  --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
  --subnet-id "$SUBNET" --security-group-ids "$SG_ID" \
  --iam-instance-profile "Name=$PROFILE" \
  --user-data "$USER_DATA" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
  --query 'Instances[0].InstanceId' --output text)

log "instance $ID starting"
aws ec2 wait instance-running --instance-ids "$ID"

# --------------------------------------------------------------- elastic ip
log "allocating Elastic IP (stable across restarts, for the Atlas allowlist)"
ALLOC=$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)
aws ec2 associate-address --instance-id "$ID" --allocation-id "$ALLOC" >/dev/null
EIP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)

cat <<EOF

============================================================
  Instance : $ID
  Public IP: $EIP

  Add this to MongoDB Atlas -> Network Access -> IP Access List:

      $EIP/32

  The bootstrap takes a few minutes (node, deno, ffmpeg, npm ci).
  Watch it:  aws ssm start-session --target $ID --region $REGION
             sudo tail -f /var/log/cloud-init-output.log
============================================================
EOF
