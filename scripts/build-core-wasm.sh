#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/public/wasm"
mkdir -p "$OUT_DIR"

em++ "$ROOT_DIR/core/bitspace_core.cpp" \
  -std=c++17 \
  -O3 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=web,node \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_bs_core_version","_bs_plan_trajectory","_bs_find_path","_bs_visibility_spans","_bs_visibility_spans_from_grid","_bs_huck_rock_hull","_bs_render_visibility_checker_layer","_bs_render_storm_layer","_bs_render_storm_runs","_bs_render_storm_boundary_runs","_bs_storm_pattern_rows"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAP8","HEAPU8","HEAP32","HEAPU32","HEAPF32","HEAPF64"]' \
  -o "$OUT_DIR/bitspace_core.js"

echo "Built $OUT_DIR/bitspace_core.js"
