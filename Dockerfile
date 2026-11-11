# VoltIQ – single-container website (React build served by FastAPI)
# Build:  docker build -t voltiq .
# Run:    docker run -p 8000:8000 -v voltiq-data:/data voltiq
# Put a CSV at seed/ev_charging.csv before building to preload it when the database is empty.

FROM node:24-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VOLTIQ_DATA_DIR=/data
# Non-root user (uid 1000, as required by Hugging Face Spaces and good practice elsewhere)
RUN useradd -m -u 1000 user && mkdir -p /data && chown user:user /data
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY seed/ seed/
COPY --from=web /app/frontend/dist frontend/dist
USER user
EXPOSE 8000
WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
