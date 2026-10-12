#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="pi-coding-agent"
CONTAINER_NAME="pi-coding-agent-container"
VOLUME_NAME="pi-root-data"

# 1. Build only if the image doesn't exist locally
if ! docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1; then
  echo "==> Image '${IMAGE_NAME}' not found. Building..."
  docker build -t "${IMAGE_NAME}" .
else
  echo "==> Image '${IMAGE_NAME}' already exists. Skipping build."
fi

# 2. Ensure the named volume exists
if ! docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
  echo "==> Creating volume '${VOLUME_NAME}'..."
  docker volume create "${VOLUME_NAME}" >/dev/null
fi

# 3. Inspect existing container state
CONTAINER_STATUS=$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || true)

case "${CONTAINER_STATUS}" in
  "running")
    echo "==> Container is already running. Attaching new interactive shell..."
    exec docker exec -it "${CONTAINER_NAME}" /bin/bash
    ;;

  "exited"|"created"|"paused")
    echo "==> Container exists (status: ${CONTAINER_STATUS}). Starting and attaching..."
    docker start "${CONTAINER_NAME}" >/dev/null
    exec docker attach "${CONTAINER_NAME}"
    ;;

  *)
    echo "==> Container does not exist. Creating and starting a new instance..."
    exec docker run -it \
      --name "${CONTAINER_NAME}" \
      -v "${VOLUME_NAME}:/root" \
      "${IMAGE_NAME}"
    ;;
esac

