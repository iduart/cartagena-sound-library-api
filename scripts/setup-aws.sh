#!/usr/bin/env bash
# Provisions the S3 buckets and IAM user this API needs.
#
# Run once against a fresh AWS account, with the AWS CLI authenticated as an
# admin (`aws configure` or SSO). It is safe to re-run: every step is skipped
# if it already exists.
#
#   ./scripts/setup-aws.sh
#
# Prints the AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY to put in .env at the end.
set -euo pipefail

REGION="${AWS_REGION:-us-east-2}"
IAM_USER="${IAM_USER:-cartagena-sound-library-api}"

# The original cartagena-sound-library-* names were deleted along with the old
# AWS account and are still inside AWS's post-deletion reservation window, so
# they cannot be recreated. Existing Mongo records point at those old hostnames
# and will 404 regardless, because their objects are gone too.
TEMP_BUCKET="${TEMP_BUCKET:-csl-previews}"
SOUNDS_BUCKET="${SOUNDS_BUCKET:-csl-sounds}"
THUMBNAILS_BUCKET="${THUMBNAILS_BUCKET:-csl-thumbnails}"

PUBLIC_BUCKETS=("$SOUNDS_BUCKET" "$THUMBNAILS_BUCKET" "$TEMP_BUCKET")

echo "Region: $REGION"
echo

create_bucket() {
  local bucket="$1"

  if aws s3api head-bucket --bucket "$bucket" 2>/dev/null; then
    echo "  bucket $bucket already exists"
    return
  fi

  echo "  creating $bucket"
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$bucket" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$bucket" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
}

make_public() {
  local bucket="$1"

  # The app streams these URLs directly, so objects must be world-readable.
  # Two of the four Block Public Access switches have to come off for a public
  # bucket policy to take effect; the two ACL-related ones stay on, because the
  # API no longer uses ACLs.
  aws s3api put-public-access-block --bucket "$bucket" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false" \
    >/dev/null

  aws s3api put-bucket-policy --bucket "$bucket" --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"PublicReadObjects\",
      \"Effect\": \"Allow\",
      \"Principal\": \"*\",
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::$bucket/*\"
    }]
  }" >/dev/null

  echo "  $bucket is publicly readable"
}

echo "Buckets:"
for bucket in "${PUBLIC_BUCKETS[@]}"; do
  create_bucket "$bucket"
  make_public "$bucket"
done

# Previews are throwaway: expire them so they do not accumulate cost forever.
echo
echo "Lifecycle rule on $TEMP_BUCKET (expire previews after 1 day):"
aws s3api put-bucket-lifecycle-configuration --bucket "$TEMP_BUCKET" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "expire-previews",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "Expiration": {"Days": 1}
    }]
  }' >/dev/null
echo "  done"

echo
echo "IAM user $IAM_USER:"
if aws iam get-user --user-name "$IAM_USER" >/dev/null 2>&1; then
  echo "  already exists"
else
  aws iam create-user --user-name "$IAM_USER" >/dev/null
  echo "  created"
fi

RESOURCES=$(printf '"arn:aws:s3:::%s/*",' "${PUBLIC_BUCKETS[@]}")
RESOURCES=${RESOURCES%,}

aws iam put-user-policy --user-name "$IAM_USER" \
  --policy-name cartagena-sound-library-s3-write \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [\"s3:PutObject\", \"s3:DeleteObject\", \"s3:AbortMultipartUpload\", \"s3:ListMultipartUploadParts\"],
      \"Resource\": [$RESOURCES]
    }]
  }" >/dev/null
echo "  write policy attached"

echo
echo "Access key:"
EXISTING=$(aws iam list-access-keys --user-name "$IAM_USER" \
  --query 'AccessKeyMetadata[].AccessKeyId' --output text)

if [ -n "$EXISTING" ]; then
  echo "  user already has key(s): $EXISTING"
  echo "  delete one first if you need a fresh secret:"
  echo "    aws iam delete-access-key --user-name $IAM_USER --access-key-id <id>"
else
  KEY_JSON=$(aws iam create-access-key --user-name "$IAM_USER")
  ACCESS_KEY=$(echo "$KEY_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["AccessKey"]["AccessKeyId"])')
  SECRET_KEY=$(echo "$KEY_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["AccessKey"]["SecretAccessKey"])')

  cat <<EOF

  Put these in .env (the secret is shown only once):

    AWS_REGION=$REGION
    AWS_ACCESS_KEY_ID=$ACCESS_KEY
    AWS_SECRET_ACCESS_KEY=$SECRET_KEY
    TEMP_BUCKET=$TEMP_BUCKET
    SOUNDS_BUCKET=$SOUNDS_BUCKET
    THUMBNAILS_BUCKET=$THUMBNAILS_BUCKET
EOF
fi

echo
echo "Done. Verify with: node scripts/check-aws.js"
