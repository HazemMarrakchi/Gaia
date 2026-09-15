#!/usr/bin/env bash
# ------------------------------------------------------------------
# GAIA — submits the streaming aggregator to the Flink cluster.
# Idempotent: if the job is already RUNNING it exits without re-submitting.
# ------------------------------------------------------------------
set -euo pipefail

JOBMANAGER=${FLINK_JOBMANAGER_HOST:-flink-jobmanager}
JOB_PORT=${FLINK_JOBMANAGER_PORT:-8081}
TARGET="${JOBMANAGER}:${JOB_PORT}"
JAR=${GAIA_JOB_JAR:-/opt/flink/usrlib/gaia-streaming.jar}
MAIN=com.gaia.streaming.AggregatorJob
JOB_NAME=gaia-streaming-aggregator

echo "GAIA streaming: waiting for Flink JobManager at ${TARGET} ..."
until (echo > "/dev/tcp/${JOBMANAGER}/${JOB_PORT}") 2>/dev/null; do
  sleep 2
done

if flink list -r -m "${TARGET}" 2>/dev/null | grep -q "${JOB_NAME}"; then
  echo "GAIA streaming: ${JOB_NAME} already RUNNING, nothing to do."
  exit 0
fi

echo "GAIA streaming: submitting ${MAIN} ..."
flink run -d -m "${TARGET}" -c "${MAIN}" "${JAR}"
echo "GAIA streaming: submitted (Flink UI: http://localhost:8381)."