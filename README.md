
# Flicksy Download

A modular movie and TV series archive discovery and download module.

## Architecture

- `apps/download/worker`: Cloudflare Worker API
- `apps/download/web`: Frontend (planned)
- Provider-based archive integration
- Direct downloads from external sources
- No media proxying through the Worker

## Current Status

Project initialization.

## API

- `GET /api/v1/health`

## Deployment

The API is designed to run on Cloudflare Workers.
