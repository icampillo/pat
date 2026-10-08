#!/bin/bash
set -euo pipefail
# Only a new temporary cluster, without host volumes or production credentials.
PG_BIN=$(dirname "$(find /usr/lib/postgresql -path '*/bin/initdb' -print -quit)")
TEST_CLUSTER=$(mktemp -d /tmp/pat-zerion-db.XXXXXX)
trap '"$PG_BIN/pg_ctl" -D "$TEST_CLUSTER" -m fast -w stop >/dev/null 2>&1 || true' EXIT
"$PG_BIN/initdb" -D "$TEST_CLUSTER" --auth=trust --encoding=UTF8 --locale=C >/dev/null
"$PG_BIN/pg_ctl" -D "$TEST_CLUSTER" -l "$TEST_CLUSTER/server.log" -o '-h 127.0.0.1 -p 55439' -w start
"$PG_BIN/createdb" -h 127.0.0.1 -p 55439 zerion_validation_test
pnpm exec prisma validate
pnpm db:deploy
pnpm exec prisma migrate status
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
pnpm db:deploy
pnpm test:integration
