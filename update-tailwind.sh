#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSS_DIR="${ROOT_DIR}/assets/css"
CSS_FILE="${CSS_DIR}/tailwind.min.css"
TAILWIND_URL="https://cdn.jsdelivr.net/npm/tailwindcss@3.4.1/dist/tailwind.min.css"

mkdir -p "${CSS_DIR}"

echo "Downloading Tailwind CSS from ${TAILWIND_URL}" >&2
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "${TAILWIND_URL}" -o "${CSS_FILE}"
elif command -v wget >/dev/null 2>&1; then
  wget -q "${TAILWIND_URL}" -O "${CSS_FILE}"
else
  echo "Error: Neither curl nor wget is available. Install one of them to download Tailwind CSS." >&2
  exit 1
fi

echo "Tailwind CSS saved to ${CSS_FILE}" >&2
