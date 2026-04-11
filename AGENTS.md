# Repository Agent Guide

## Scope
- This file applies to the entire repository under `c:\data\code\AIvideoShortTheminer`.

## Project Overview
- This repository hosts static web tools plus a React + Vite video editing tool.
- The React app source lives under `src/video-edit-app`.
- Production build output is generated into `tools/video_edit`.

## Environment
- Use Node.js 24.x.
- Use PowerShell examples by default on this repository.
- When performing file CRUD operations, explicitly use UTF-8 encoding.

## Common Commands
- Install dependencies: `npm install`
- Start dev server: `npm run dev`
- Run unit tests: `npm run test`
- Create production build: `npm run build`
- Serve the static site locally: `py -m http.server 8123`

## Change Rules
- Prefer changing source files under `src/` and only update generated output under `tools/video_edit` when the task requires a production build.
- Keep the static top page and the built video editor consistent when a change affects published behavior.
- Before concluding any debugging task, collect and review the relevant runtime logs.

## Testing Expectations
- Run the narrowest relevant verification first.
- If behavior changes in the React app, prefer at least `npm run test`.
- If the task affects shipped static output, run `npm run build` when feasible and report whether it succeeded.
