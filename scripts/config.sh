#!/usr/bin/env bash

# Shared local deployment config. Individual shell env vars still override these.
: "${BITSPACE_DO_HOST:=root@142.93.122.18}"
: "${BITSPACE_DO_DOMAIN:=bitspace.freshman.dev}"
