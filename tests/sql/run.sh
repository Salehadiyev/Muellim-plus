#!/usr/bin/env bash
# Müəllim+ baza sınaqları: təmiz bazada bütün miqrasiyalar iki dəfə, sonra yoxlamalar.
# İstifadə: PGHOST=... PGPORT=... PGUSER=... [PGPASSWORD=...] tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")"
export PGOPTIONS="-c client_min_messages=warning"
DB=${TEST_DB:-mp_test}
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
PSQL="psql -v ON_ERROR_STOP=1 -q -d $DB"
$PSQL -f setup.sql
MIG="../../supabase/schema.sql $(ls ../../supabase/0*.sql | sort | tr '\n' ' ')"
for round in 1 2; do
  for f in $MIG; do $PSQL -f "$f" > /dev/null || { echo "FAIL: $f (dövr $round)"; exit 1; }; done
done
echo "miqrasiyalar iki dəfə xətasız işlədi: $(echo $MIG | wc -w) fayl"
$PSQL -t -A -o /dev/null -f checks.sql
