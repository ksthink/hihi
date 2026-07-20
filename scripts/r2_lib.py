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


def cache_control_for(key):
    """key 확장자별 Cache-Control 기본값.

    ⚠️ 지정하지 않으면 R2 는 Cache-Control 을 아예 보내지 않는다. 그러면 클라이언트가
    휴리스틱 캐싱((now - Last-Modified) × 10%) 으로 몇 시간씩 옛 응답을 재사용한다.
    실제로 admin 에서 큐레이션을 바꿔도 iOS 앱에 반영되지 않는 버그가 이 때문이었다
    (2026-07-20). 웹은 fetch(..., {cache:"no-cache"}) 로 피해 갔으나 네이티브는 직격.

      *.json / *.geojson  → no-cache  (재배포로 자주 바뀜. 안 바뀌었으면 304 라 저렴)
      *.pmtiles           → 미지정     (수백 MB · Range 요청 · 재배포 드묾 →
                                        매 요청 재검증은 손해. 갱신 시 키를 바꾸거나
                                        클라이언트가 명시적으로 재다운로드한다)
    """
    return "no-cache" if key.endswith((".json", ".geojson")) else None


def upload_file(local, key, s3=None, content_type=None, callback=None,
                cache_control=...):
    """로컬 파일 → R2 key (멀티파트 자동). cache_control 미지정 시 확장자로 결정."""
    s3 = s3 or client()
    ct = content_type or content_type_for(key)
    cc = cache_control_for(key) if cache_control is ... else cache_control
    extra = {"ContentType": ct}
    if cc:
        extra["CacheControl"] = cc
    s3.upload_file(local, bucket(), key, ExtraArgs=extra, Config=_XFER, Callback=callback)
    return os.path.getsize(local)


def upload_bytes(content, key, s3=None, content_type=None, cache_control=...):
    """바이트 → R2 key. cache_control 미지정 시 확장자로 결정(cache_control_for)."""
    s3 = s3 or client()
    ct = content_type or content_type_for(key)
    cc = cache_control_for(key) if cache_control is ... else cache_control
    kw = {"Bucket": bucket(), "Key": key, "Body": content, "ContentType": ct}
    if cc:
        kw["CacheControl"] = cc
    s3.put_object(**kw)
    return len(content)


def delete_prefix(prefix, s3=None):
    """prefix 하위 객체 전부 삭제(예: packs/<산코드>/). 삭제한 개수 반환."""
    s3 = s3 or client()
    b, n, token = bucket(), 0, None
    while True:
        kw = {"Bucket": b, "Prefix": prefix}
        if token:
            kw["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kw)
        objs = [{"Key": o["Key"]} for o in resp.get("Contents", [])]
        if objs:
            s3.delete_objects(Bucket=b, Delete={"Objects": objs})
            n += len(objs)
        if resp.get("IsTruncated"):
            token = resp.get("NextContinuationToken")
        else:
            return n
