#!/bin/sh
# Uso: ./run.sh 'await page.goto(...); return 1'
curl -s -X POST --data-binary "$1" http://localhost:9333
