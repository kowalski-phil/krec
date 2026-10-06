#!/usr/bin/env bash
# Krec AWS teardown. Removes everything scripts/aws-setup.sh created, including ALL
# uploaded videos (every share link stops working). Run in AWS CloudShell.
#
# Usage:  bash aws-teardown.sh <bucket-name>
#   The bucket name is shown in Krec > Settings ("Connected: bucket krec-...").
#
# Order: upload user first (nothing new can arrive), then the bucket with its videos,
# then the CloudFront distribution (must be disabled and fully deployed before it can be
# deleted, which takes AWS 5 to 15 minutes), then its origin access control.
set -euo pipefail

BUCKET="${1:-}"
if [[ ! "$BUCKET" =~ ^krec-[0-9]{12}-[0-9a-f]{8}$ ]]; then
  echo "Usage: bash aws-teardown.sh krec-<account>-<suffix>   (see Krec > Settings)" >&2
  exit 1
fi
SUFFIX="${BUCKET##*-}"
USER_NAME="krec-uploader-${SUFFIX}"
OAC_NAME="krec-${SUFFIX}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

step() { printf '\n==> %s\n' "$*"; }

echo "This permanently deletes bucket ${BUCKET} with ALL its videos, the CloudFront"
echo "distribution in front of it and the IAM user ${USER_NAME}. Share links stop working."
read -r -p "Type the bucket name to confirm: " CONFIRM
[ "$CONFIRM" = "$BUCKET" ] || { echo "Cancelled."; exit 1; }

step "Deleting upload user ${USER_NAME}"
if aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  for KEY_ID in $(aws iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
    aws iam delete-access-key --user-name "$USER_NAME" --access-key-id "$KEY_ID"
  done
  aws iam delete-user-policy --user-name "$USER_NAME" --policy-name krec-upload 2>/dev/null || true
  aws iam delete-user --user-name "$USER_NAME"
else
  echo "(already gone)"
fi

step "Deleting bucket ${BUCKET} and all videos in it"
if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  REGION="$(aws s3api get-bucket-location --bucket "$BUCKET" --query LocationConstraint --output text)"
  [ "$REGION" = "None" ] && REGION="us-east-1"
  aws s3 rb "s3://${BUCKET}" --force --region "$REGION" >/dev/null
else
  echo "(already gone)"
fi

step "Disabling the CloudFront distribution"
DIST_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?starts_with(Origins.Items[0].DomainName, '${BUCKET}.s3.')].Id | [0]" \
  --output text)"
if [ -n "$DIST_ID" ] && [ "$DIST_ID" != "None" ]; then
  aws cloudfront get-distribution-config --id "$DIST_ID" --output json > "$WORK/dist.json"
  ETAG="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ETag"])' "$WORK/dist.json")"
  python3 - "$WORK/dist.json" "$WORK/config.json" <<'PY'
import json, sys
config = json.load(open(sys.argv[1]))["DistributionConfig"]
config["Enabled"] = False
json.dump(config, open(sys.argv[2], "w"))
PY
  aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
    --distribution-config "file://$WORK/config.json" >/dev/null
  step "Waiting for AWS to finish disabling it (usually 5 to 15 minutes)"
  aws cloudfront wait distribution-deployed --id "$DIST_ID"
  ETAG="$(aws cloudfront get-distribution --id "$DIST_ID" --query ETag --output text)"
  aws cloudfront delete-distribution --id "$DIST_ID" --if-match "$ETAG"
  echo "Deleted distribution ${DIST_ID}"
else
  echo "(already gone)"
fi

step "Deleting origin access control ${OAC_NAME}"
OAC_ID="$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='${OAC_NAME}'].Id | [0]" --output text)"
if [ -n "$OAC_ID" ] && [ "$OAC_ID" != "None" ]; then
  ETAG="$(aws cloudfront get-origin-access-control --id "$OAC_ID" --query ETag --output text)"
  aws cloudfront delete-origin-access-control --id "$OAC_ID" --if-match "$ETAG"
else
  echo "(already gone)"
fi

printf '\nDone. Everything Krec created in AWS is removed. Videos on your PC are untouched.\n'
