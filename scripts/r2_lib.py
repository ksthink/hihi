"""Cloudflare R2(S3 호환) 공용 헬퍼. 자격증명은 .env / 환경변수에서만.

.env 필요 키:
  R2_ENDPOINT      = https://<account>.r2.cloudflarestorage.com
  R2_ACCESS_KEY_ID = ...
  R2_SECRET_KEY    = ...        # ⚠️ 비밀! 커밋 금지
  R2_BUCKET        = hihi
  R2_PUBLIC        = https://pub-<hash>.r2.dev   # (선택) 공개 URL 베이스

사용처: scripts/r2_upload.py, scripts/publish_pack.py, scripts/migrate_packs_to_r2.py
"""
import os

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PUBLIC_DEFAULT = "https://pub-cfc2302f77a446c1a0fdff6d0ae4e451.r2.dev"


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def bucket():
    return os.environ.get("R2_BUCKET", "hihi")


def public_base():
    return (os.environ.get("R2_PUBLIC") or _PUBLIC_DEFAULT).rstrip("/")


def client():
    load_env()
    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
    )


_XFER = TransferConfig(multipart_threshold=64 * 1024 * 1024,
                       multipart_chunksize=64 * 1024 * 1024,
                       max_concurrency=4, use_threads=True)


def content_type_for(key):
    if key.endswith(".pmtiles"):
        return "application/octet-stream"
    if key.endswith(".geojson") or key.endswith(".json"):
        return "application/geo+json"
    return "application/octet-stream"


def upload_file(local, key, s3=None, content_type=None, callback=None):
    """로컬 파일 → R2 key (멀티파트 자동)."""
    s3 = s3 or client()
    ct = content_type or content_type_for(key)
    s3.upload_file(local, bucket(), key,
                   ExtraArgs={"ContentType": ct}, Config=_XFER, Callback=callback)
    return os.path.getsize(local)


def upload_bytes(content, key, s3=None, content_type=None):
    """바이트 → R2 key."""
    s3 = s3 or client()
    ct = content_type or content_type_for(key)
    s3.put_object(Bucket=bucket(), Key=key, Body=content, ContentType=ct)
    return len(content)
