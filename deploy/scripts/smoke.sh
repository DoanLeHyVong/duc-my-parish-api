#!/usr/bin/env sh
set -eu

API_URL="${API_URL:?API_URL is required}"
WEB_URL="${WEB_URL:?WEB_URL is required}"
curl --fail --silent --show-error "$API_URL/api/v1/health" >/dev/null
curl --fail --silent --show-error "$API_URL/api/v1/ready" >/dev/null
curl --fail --silent --show-error "$WEB_URL/" >/dev/null
printf 'Public smoke checks passed for API and Web.\n'
