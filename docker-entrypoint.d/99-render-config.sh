#!/bin/sh
set -eu

: "${SUPABASE_URL:=${NEXT_PUBLIC_SUPABASE_URL:-}}"
: "${SUPABASE_ANON_KEY:=${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"
export SUPABASE_URL SUPABASE_ANON_KEY

if [ -n "$SUPABASE_URL" ] || [ -n "$SUPABASE_ANON_KEY" ]; then
  envsubst '${SUPABASE_URL} ${SUPABASE_ANON_KEY}' \
    < /usr/share/nginx/html/config.template.js \
    > /usr/share/nginx/html/config.js
fi
