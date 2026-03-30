#!/bin/bash
mkdir -p logs
pm2 start ./ecosystem.config.cjs --time
