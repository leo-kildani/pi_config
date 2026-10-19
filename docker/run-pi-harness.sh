#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="pi-coding-agent"
CONTAINER_NAME="pi-coding-agent-container"
CONFIG_VOLUME="pi-global-config-data"

# 1. Build image if missing
docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1 || {
  echo "==> Building ${IMAGE_NAME}..."
  docker build -t "${IMAGE_NAME}" .
}

# 2. Remove existing container if present
if docker container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "==> Removing existing container '${CONTAINER_NAME}'..."
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

# 3. Collect volume mounts
MOUNTS=("-v" "${CONFIG_VOLUME}:/home/node/.pi/agent")

for target in "$@"; do
  if [[ ! -d "${target}" ]]; then
    echo "Warning: '${target}' is not a valid directory. Skipping." >&2
    continue
  fi

  ABS_PATH="$(cd "${target}" && pwd)"
  WORKSPACE="/workspace/$(basename "${ABS_PATH}")"
  MOUNTS+=("-v" "${ABS_PATH}:${WORKSPACE}:rw")
  echo "==> Mounting: ${ABS_PATH} -> ${WORKSPACE}"

  GUARD_FILE="${ABS_PATH}/.guard"
  if [[ -f "${GUARD_FILE}" ]]; then
    echo "    Masking guarded files..."
    MOUNTS+=("-v" "/dev/null:${WORKSPACE}/.guard:ro")

    # Read patterns, trim whitespace with pure bash, skip comments/empty lines
    while IFS= read -r pattern || [[ -n "${pattern}" ]]; do
      pattern="${pattern#"${pattern%%[![:space:]]*}"}" # strip leading space
      pattern="${pattern%"${pattern##*[![:space:]]}"}" # strip trailing space
      [[ -z "${pattern}" || "${pattern}" =~ ^# ]] && continue

      while IFS= read -r -d '' match; do
        REL="${match#"${ABS_PATH}/"}"
        MOUNTS+=("-v" "/dev/null:${WORKSPACE}/${REL}:ro")
        echo "    - Masked: ${WORKSPACE}/${REL}"
      done < <(find "${ABS_PATH}" -type f -name "${pattern}" -print0 2>/dev/null)
    done < "${GUARD_FILE}"
  fi
done

# 4. Run new container instance
exec docker run --rm -it \
  --name "${CONTAINER_NAME}" \
  "${MOUNTS[@]}" \
  -w /workspace \
  "${IMAGE_NAME}"
