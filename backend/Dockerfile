FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    READVIBE_STORAGE_DIR=/data/storage \
    READVIBE_DATABASE_URL=sqlite:////data/readvibe.db

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN useradd --create-home readvibe && mkdir -p /data && chown readvibe /data
USER readvibe
VOLUME ["/data"]
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.getenv(\"PORT\", \"5000\")}/api/health')"
# Hosts like Render/Railway inject $PORT; default to 5000 locally.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-5000} --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 75"]
