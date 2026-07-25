// Verifies the .env credentials can actually write a publicly readable object
// to each bucket, which is the exact thing createSound needs. Run from the repo
// root: node scripts/check-aws.js
require("dotenv").config();

const https = require("https");
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const {
  TEMP_BUCKET,
  SOUNDS_BUCKET,
  THUMBNAILS_BUCKET,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  S3_USE_ACL,
} = process.env;

const region = AWS_REGION || "us-east-2";
const client = new S3Client({
  region,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

const buckets = [
  ["SOUNDS_BUCKET", SOUNDS_BUCKET],
  ["THUMBNAILS_BUCKET", THUMBNAILS_BUCKET],
  ["TEMP_BUCKET", TEMP_BUCKET],
];

const httpStatus = (url) =>
  new Promise((resolve) => {
    https
      .get(url, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", () => resolve(0));
  });

async function checkBucket(label, bucket) {
  if (!bucket) {
    console.log(`FAIL ${label}: not set in .env`);
    return false;
  }

  const key = `__healthcheck-${Date.now()}.txt`;
  const params = {
    Bucket: bucket,
    Key: key,
    Body: "ok",
    ContentType: "text/plain",
  };
  if (S3_USE_ACL === "true") params.ACL = "public-read";

  try {
    await client.send(new PutObjectCommand(params));
  } catch (err) {
    console.log(`FAIL ${label} (${bucket}): write rejected -- ${err.name}: ${err.message}`);
    if (err.name === "AccessControlListNotSupported") {
      console.log("     -> remove S3_USE_ACL=true from .env; this bucket has ACLs disabled");
    }
    if (err.name === "AccessDenied") {
      console.log("     -> the IAM user is missing s3:PutObject on this bucket");
    }
    return false;
  }

  const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  const status = await httpStatus(url);

  await client
    .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    .catch(() => {}); // cleanup is best-effort; the IAM policy may not allow it

  if (status === 200) {
    console.log(`OK   ${label} (${bucket}): write + public read`);
    return true;
  }

  console.log(`FAIL ${label} (${bucket}): wrote the object but public read returned HTTP ${status}`);
  console.log("     -> the bucket needs a public-read bucket policy and BlockPublicPolicy=false");
  return false;
}

async function main() {
  console.log(`region: ${region}  key: ${AWS_ACCESS_KEY_ID || "(unset)"}\n`);

  let ok = true;
  for (const [label, bucket] of buckets) {
    // Sequential so the output reads in a predictable order.
    // eslint-disable-next-line no-await-in-loop
    ok = (await checkBucket(label, bucket)) && ok;
  }

  console.log(ok ? "\nAll buckets ready." : "\nSome checks failed -- see above.");
  process.exit(ok ? 0 : 1);
}

main();
