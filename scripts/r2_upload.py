#!/usr/bin/env python3
"""R2(S3 호환)로 대용량 PMTiles 업로드 (멀티파트). 자격증명은 .env / 환경변수에서만.

.env 필요 키:
  R2_ENDPOINT        = https://<account>.r2.cloudflarestorage.com
  R2_ACCESS_KEY_ID   = ...
  R2_SECRET_KEY      = ...      # ⚠️ 비밀! 커밋 금지
  R2_BUCKET          = hihi

사용: python3 scripts/r2_upload.py <로컬파일> <버킷내_키>
  예) python3 scripts/r2_upload.py data/tiles/kr-base.pmtiles kr-base.pmtiles
"""
import os
import sys

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def main():
    if len(sys.argv) < 3:
        sys.exit("사용: r2_upload.py <로컬파일> <키>")
    src, key = sys.argv[1], sys.argv[2]
    load_env()
    endpoint = os.environ["R2_ENDPOINT"]
    bucket = os.environ.get("R2_BUCKET", "hihi")
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
    )
    size = os.path.getsize(src)
    cfg = TransferConfig(multipart_threshold=64 * 1024 * 1024,
                         multipart_chunksize=64 * 1024 * 1024,
                         max_concurrency=4, use_threads=True)
    seen = {"pct": -1}

    def cb(n):
        cb.done = getattr(cb, "done", 0) + n
        pct = int(cb.done * 100 / size)
        if pct != seen["pct"]:
            seen["pct"] = pct
            sys.stdout.write(f"\r업로드 {pct}%  ({cb.done//1048576}/{size//1048576} MiB)")
            sys.stdout.flush()

    print(f"→ {bucket}/{key}  ({size//1048576} MiB) 업로드 시작")
    s3.upload_file(src, bucket, key, ExtraArgs={"ContentType": "application/octet-stream"}, Config=cfg, Callback=cb)
    print("\n완료. HEAD 확인:")
    h = s3.head_object(Bucket=bucket, Key=key)
    print(f"  size={h['ContentLength']//1048576} MiB  type={h.get('ContentType')}  etag={h['ETag']}")


if __name__ == "__main__":
    main()
