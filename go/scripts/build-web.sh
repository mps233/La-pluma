#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
rm -rf "$ROOT/web/dist"
mkdir -p "$ROOT/web/dist"
cp -R "$ROOT/../client/dist/." "$ROOT/web/dist/"
