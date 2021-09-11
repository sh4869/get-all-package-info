#!/bin/env bash
yarn tsc
all-the-package-names/script/build
node dist/main.js
