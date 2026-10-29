#!/usr/bin/env bash
# full_schema.sql = schema.sql + bütün 0NN_*.sql miqrasiyaları (sıfırdan qurulum üçün bir fayl).
# İstifadə: supabase/build-full.sh          → faylı yenilə
#           supabase/build-full.sh --check  → fayl köhnədirsə xəta
set -euo pipefail
cd "$(dirname "$0")"
build() {
  echo "-- Müəllim+ · TAM SXEM (avtomatik yaradılıb: build-full.sh). Əl ilə dəyişməyin."
  echo "-- Yeni Supabase layihəsi üçün: SQL Editor → bu faylın hamısını yapışdır → Run. Təkrar işlətmək zərərsizdir."
  for f in schema.sql $(ls 0*.sql | sort); do echo; echo "-- ================= $f ================="; cat "$f"; done
}
if [ "${1:-}" = "--check" ]; then
  diff -q <(build) full_schema.sql > /dev/null || { echo "FAIL: supabase/full_schema.sql köhnədir — supabase/build-full.sh işlədin"; exit 1; }
else
  build > full_schema.sql; echo "full_schema.sql yeniləndi"
fi
