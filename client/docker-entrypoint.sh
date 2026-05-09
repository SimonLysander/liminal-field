#!/bin/sh
# nginx 启动前确保 SSL 证书存在。
# 首次部署时 Let's Encrypt 证书尚未签发，自动生成自签名占位证书，
# 保证 nginx 能正常启动并响应 ACME 验证请求。
# certbot 签发真证书后 reload nginx 即可无缝切换。

CERT_DIR="/etc/letsencrypt/live/cert"
CERT_FILE="$CERT_DIR/fullchain.pem"
KEY_FILE="$CERT_DIR/privkey.pem"

if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "[entrypoint] 证书不存在，生成自签名占位证书..."
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -days 30 \
    -subj "/CN=placeholder" \
    -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    2>/dev/null
  echo "[entrypoint] 占位证书已生成，等待 certbot 签发正式证书后 reload nginx"
fi

exec nginx -g "daemon off;"
