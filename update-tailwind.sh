#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSS_DIR="${ROOT_DIR}/assets/css"
CSS_FILE="${CSS_DIR}/tailwind.min.css"
mkdir -p "${CSS_DIR}"

SOURCES=(
  "https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/3.4.1/tailwind.min.css"
  "https://cdn.jsdelivr.net/npm/tailwindcss@3.4.1/tailwind.min.css"
  "https://unpkg.com/tailwindcss@3.4.1/tailwind.min.css"
)

DOWNLOADED=false
for url in "${SOURCES[@]}"; do
  echo "Attempting download from ${url}" >&2
  if command -v curl >/dev/null 2>&1; then
    if curl -fsSL "${url}" -o "${CSS_FILE}"; then
      DOWNLOADED=true
      break
    fi
  elif command -v wget >/dev/null 2>&1; then
    if wget -q "${url}" -O "${CSS_FILE}"; then
      DOWNLOADED=true
      break
    fi
  else
    echo "Error: Neither curl nor wget is available. Install one of them to download Tailwind CSS." >&2
    exit 1
  fi
done

if [ "${DOWNLOADED}" != true ]; then
  echo "Failed to download Tailwind CSS from all known sources." >&2
  exit 1
fi

echo "Tailwind CSS saved to ${CSS_FILE}" >&2
