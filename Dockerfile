FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV NODE_MAJOR=20

# Install Node.js + supervisor
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates supervisor && \
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Backend: install Node dependencies
COPY backend/package.json ./backend/
RUN cd backend && npm install --omit=dev

# Scraper: install Python dependencies
COPY scraper/requirements.txt ./scraper/
RUN pip install --no-cache-dir -r scraper/requirements.txt

# Copy all application code
COPY backend/ ./backend/
COPY scraper/ ./scraper/
COPY frontend/ ./frontend/
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

# Setup directories and permissions
RUN mkdir -p /app/logs /app/data && chmod +x /app/docker-entrypoint.sh

EXPOSE 7860

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
