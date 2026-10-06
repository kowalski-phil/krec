#!/usr/bin/env bash
# Krec AWS setup. Run once in AWS CloudShell (it is already logged in to your account).
#
# Creates:
#   - a private S3 bucket for videos (no public access at all)
#   - a CloudFront distribution that serves the bucket over HTTPS (the share links)
#   - an IAM user "krec-uploader-*" that can only write to that bucket, plus its access key
# Then prints one "krec1:..." setup code to paste into Krec > Settings.
#
# Usage:  bash aws-setup.sh [region]      (default region: eu-central-1, Frankfurt)
# Running it again creates a second, independent set; nothing existing is changed.
set -euo pipefail

REGION="${1:-eu-central-1}"
SUFFIX="$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="krec-${ACCOUNT}-${SUFFIX}"
USER_NAME="krec-uploader-${SUFFIX}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

step() { printf '\n==> %s\n' "$*"; }

step "Creating private S3 bucket ${BUCKET} in ${REGION}"
if [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGION" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

step "Creating CloudFront origin access control"
cat > "$WORK/oac.json" <<EOF
{
  "Name": "krec-${SUFFIX}",
  "Description": "Krec: CloudFront reads the private video bucket",
  "SigningProtocol": "sigv4",
  "SigningBehavior": "always",
  "OriginAccessControlOriginType": "s3"
}
EOF
OAC_ID="$(aws cloudfront create-origin-access-control \
  --origin-access-control-config "file://$WORK/oac.json" \
  --query 'OriginAccessControl.Id' --output text)"

step "Creating CloudFront distribution (the share-link domain)"
# 658327ea-... is AWS's managed "CachingOptimized" cache policy.
cat > "$WORK/distribution.json" <<EOF
{
  "CallerReference": "krec-${SUFFIX}",
  "Comment": "Krec share links",
  "Enabled": true,
  "PriceClass": "PriceClass_100",
  "HttpVersion": "http2and3",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "krec-s3",
        "DomainName": "${BUCKET}.s3.${REGION}.amazonaws.com",
        "OriginAccessControlId": "${OAC_ID}",
        "S3OriginConfig": { "OriginAccessIdentity": "" }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "krec-s3",
    "ViewerProtocolPolicy": "redirect-to-https",
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "Compress": true,
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
    }
  }
}
EOF
# Command substitution (not < <(...)) so a failure here stops the script under set -e.
DIST="$(aws cloudfront create-distribution \
  --distribution-config "file://$WORK/distribution.json" \
  --query 'Distribution.[Id,DomainName,ARN]' --output text)"
read -r DIST_ID DIST_DOMAIN DIST_ARN <<< "$DIST"

step "Allowing only that distribution to read the bucket"
cat > "$WORK/bucket-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${BUCKET}/*",
      "Condition": { "StringEquals": { "AWS:SourceArn": "${DIST_ARN}" } }
    }
  ]
}
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --region "$REGION" --policy "file://$WORK/bucket-policy.json"

step "Creating upload-only IAM user ${USER_NAME}"
cat > "$WORK/user-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "KrecWriteVideos",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::${BUCKET}/*"
    },
    {
      "Sid": "KrecClearCacheOnDelete",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "${DIST_ARN}"
    }
  ]
}
EOF
aws iam create-user --user-name "$USER_NAME" >/dev/null
aws iam put-user-policy --user-name "$USER_NAME" --policy-name krec-upload \
  --policy-document "file://$WORK/user-policy.json"
KEY="$(aws iam create-access-key --user-name "$USER_NAME" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)"
read -r KEY_ID KEY_SECRET <<< "$KEY"

CODE_JSON="$(printf '{"region":"%s","bucket":"%s","accessKeyId":"%s","secretAccessKey":"%s","cdnDomain":"%s","distributionId":"%s"}' \
  "$REGION" "$BUCKET" "$KEY_ID" "$KEY_SECRET" "$DIST_DOMAIN" "$DIST_ID")"

cat <<EOF

============================================================
 Done. Bucket:       ${BUCKET}
       Links domain: https://${DIST_DOMAIN}
       CloudFront takes about 5 to 15 minutes to go live.

 Copy the whole next line into Krec > Settings > Setup code.
 It contains a secret key: do not share it.
============================================================
krec1:$(printf '%s' "$CODE_JSON" | base64 -w0)

EOF
