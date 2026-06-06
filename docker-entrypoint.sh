#!/bin/bash
echo "================================"
echo "  LeadForge AI - Starting Up    "
echo "================================"

mkdir -p /app/logs /app/data

# Install Playwright browser system dependencies (runs only once, cached after)
echo "Installing browser system libraries..."
apt-get update -qq 2>/dev/null
apt-get install -y --no-install-recommends \
  libglib2.0-0 libnss3 libnspr4 libdbus-1-3 \
  libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
  libx11-6 libxcomposite1 libxdamage1 libxext6 \
  libxfixes3 libxrandr2 libgbm1 libdrm2 \
  libxcb1 libxkbcommon0 libpango-1.0-0 \
  libcairo2 libasound2 libcups2 2>/dev/null || echo "Some browser deps may be missing"
rm -rf /var/lib/apt/lists/* 2>/dev/null
echo "Browser libraries installed."

echo "Starting services..."
exec "$@"
