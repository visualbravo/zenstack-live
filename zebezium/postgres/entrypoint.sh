#!/usr/bin/env bash
set -euo pipefail

urldecode() {
  local s="${1//+/ }"
  printf '%b' "${s//%/\\x}"
}

# Splits a URL into URL_SCHEME, URL_USER, URL_PASSWORD, URL_HOST, URL_PORT, URL_PATH and URL_QUERY.
parse_url() {
  local url="$1" rest authority userinfo hostport
  URL_SCHEME="${url%%://*}"
  rest="${url#*://}"

  URL_QUERY=""
  if [[ "$rest" == *\?* ]]; then
    URL_QUERY="${rest#*\?}"
    rest="${rest%%\?*}"
  fi

  URL_PATH=""
  authority="$rest"
  if [[ "$rest" == */* ]]; then
    URL_PATH="${rest#*/}"
    authority="${rest%%/*}"
  fi

  URL_USER=""
  URL_PASSWORD=""
  hostport="$authority"
  if [[ "$authority" == *@* ]]; then
    userinfo="${authority%@*}"
    hostport="${authority##*@}"
    if [[ "$userinfo" == *:* ]]; then
      URL_USER="$(urldecode "${userinfo%%:*}")"
      URL_PASSWORD="$(urldecode "${userinfo#*:}")"
    else
      URL_USER="$(urldecode "$userinfo")"
    fi
  fi

  URL_HOST="$hostport"
  URL_PORT=""
  if [[ "$hostport" =~ ^(\[[^]]+\]|[^:]+):([0-9]+)$ ]]; then
    URL_HOST="${BASH_REMATCH[1]}"
    URL_PORT="${BASH_REMATCH[2]}"
  fi
  URL_HOST="${URL_HOST#[}"
  URL_HOST="${URL_HOST%]}"
}

query_param() {
  local pair
  for pair in ${URL_QUERY//&/ }; do
    if [[ "${pair%%=*}" == "$1" ]]; then
      urldecode "${pair#*=}"
      return
    fi
  done
}

if [[ -n "${POSTGRES_URL:-}" ]]; then
  parse_url "$POSTGRES_URL"

  export DEBEZIUM_SOURCE_DATABASE_HOSTNAME="$URL_HOST"
  export DEBEZIUM_SOURCE_DATABASE_PORT="${URL_PORT:-5432}"
  [[ -n "$URL_USER" ]] && export DEBEZIUM_SOURCE_DATABASE_USER="$URL_USER"
  [[ -n "$URL_PASSWORD" ]] && export DEBEZIUM_SOURCE_DATABASE_PASSWORD="$URL_PASSWORD"
  [[ -n "$URL_PATH" ]] && export DEBEZIUM_SOURCE_DATABASE_DBNAME="$(urldecode "$URL_PATH")"

  sslmode="$(query_param sslmode)"
  [[ -n "$sslmode" ]] && export DEBEZIUM_SOURCE_DATABASE_SSLMODE="$sslmode"
fi

if [[ -n "${REDIS_URL:-}" ]]; then
  parse_url "$REDIS_URL"

  address="$URL_HOST:${URL_PORT:-6379}"
  ssl="false"
  [[ "$URL_SCHEME" == "rediss" ]] && ssl="true"

  # The sink, offset storage and schema history each have their own Redis connection settings.
  for prefix in DEBEZIUM_SINK_REDIS DEBEZIUM_SOURCE_OFFSET_STORAGE_REDIS DEBEZIUM_SOURCE_SCHEMA_HISTORY_INTERNAL_REDIS; do
    export "${prefix}_ADDRESS=$address"
    export "${prefix}_SSL_ENABLED=$ssl"
    [[ -n "$URL_USER" ]] && export "${prefix}_USER=$URL_USER"
    [[ -n "$URL_PASSWORD" ]] && export "${prefix}_PASSWORD=$URL_PASSWORD"
  done
fi

missing=()
[[ -n "${DEBEZIUM_SOURCE_DATABASE_HOSTNAME:-}" ]] || missing+=(POSTGRES_URL)
[[ -n "${DEBEZIUM_SINK_REDIS_ADDRESS:-}" ]] || missing+=(REDIS_URL)
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "zebezium: missing required environment variables: ${missing[*]}" >&2
  exit 1
fi

exec /debezium/run.sh "$@"
