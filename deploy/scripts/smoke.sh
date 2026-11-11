#!/usr/bin/env sh
set -eu

API_URL="${API_URL:?API_URL is required}"
WEB_URL="${WEB_URL:?WEB_URL is required}"
EXPECTED_API_URL="${EXPECTED_API_URL:?EXPECTED_API_URL is required}"
CURL_ARGS="--connect-timeout 5 --max-time 30 --location --max-redirs 3 --fail --silent --show-error"
curl $CURL_ARGS "$API_URL/api/v1/health" >/dev/null
curl $CURL_ARGS "$API_URL/api/v1/ready" >/dev/null
WEB_HTML="$(curl $CURL_ARGS "$WEB_URL/")"
WEB_ASSET_PATH="$(printf '%s' "$WEB_HTML" | sed -n 's/.*<script[^>]*src="\([^"]*\.js\)".*/\1/p' | head -n 1)"
[ -n "$WEB_ASSET_PATH" ]
case "$WEB_ASSET_PATH" in
  http://*|https://*) WEB_ASSET_URL="$WEB_ASSET_PATH" ;;
  /*) WEB_ASSET_URL="$WEB_URL$WEB_ASSET_PATH" ;;
  *) WEB_ASSET_URL="$WEB_URL/$WEB_ASSET_PATH" ;;
esac
curl $CURL_ARGS "$WEB_ASSET_URL" | grep -F "$EXPECTED_API_URL" >/dev/null
curl $CURL_ARGS "$WEB_ASSET_URL" | grep -F "$WEB_URL" >/dev/null
curl $CURL_ARGS "$WEB_URL/sitemap.xml" | grep -F "$WEB_URL" >/dev/null
curl $CURL_ARGS "$WEB_URL/robots.txt" | grep -F "$WEB_URL/sitemap.xml" >/dev/null
printf 'Public smoke checks passed for API and Web.\n'
