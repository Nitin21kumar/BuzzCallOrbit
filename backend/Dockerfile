FROM python:3.11-slim

WORKDIR /app

# System deps (certifi/pymongo need certs; keep image slim)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render injects $PORT at runtime; default to 8000 for local/docker-compose use
ENV PORT=8000
EXPOSE 8000

# --workers 4: without this, uvicorn runs a single worker process, which
# becomes a bottleneck when Sarv fetches the campaign/TTS audio_url for many
# simultaneously-answered bulk calls at once - some of those parallel fetches
# get delayed/timed out and Sarv connects the call with no audio. Multiple
# workers let those concurrent audio downloads be served in parallel instead
# of queueing behind a single process. Bump this further if you run larger
# bulk batches and still see silent calls; Render's plan CPU is the real ceiling.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 4"]
