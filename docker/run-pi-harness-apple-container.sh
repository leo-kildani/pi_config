#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="pi-coding-agent"
CONTAINER_NAME="pi-coding-agent-container"
CONFIG_VOLUME="pi-global-config-data"

# 1. Build image if missing
container image inspect "${IMAGE_NAME}" >/dev/null 2>&1 || {
  echo "==> Building ${IMAGE_NAME}..."
  container build -t "${IMAGE_NAME}" .
}

# 2. Ensure volume exists
container volume inspect "${CONFIG_VOLUME}" >/dev/null 2>&1 || container volume create "${CONFIG_VOLUME}" >/dev/null

# 3. Clean up stale container if still registered
if container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "==> Cleaning stale container '${CONTAINER_NAME}'..."
  container delete -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
fi

# 4. Collect volume mounts
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

    while IFS= read -r pattern || [[ -n "${pattern}" ]]; do
      pattern="${pattern#"${pattern%%[![:space:]]*}"}"
      pattern="${pattern%"${pattern##*[![:space:]]}"}"
      [[ -z "${pattern}" || "${pattern}" =~ ^# ]] && continue

      while IFS= read -r -d '' match; do
        REL="${match#"${ABS_PATH}/"}"
        MOUNTS+=("-v" "/dev/null:${WORKSPACE}/${REL}:ro")
        echo "    - Masked: ${WORKSPACE}/${REL}"
      done < <(find "${ABS_PATH}" -type f -name "${pattern}" -print0 2>/dev/null)
    done < "${GUARD_FILE}"
  fi
done

# 5. Run new container instance
exec container run --rm -it \
  --name "${CONTAINER_NAME}" \
  "${MOUNTS[@]}" \
  -w /workspace \
  "${IMAGE_NAME}"
