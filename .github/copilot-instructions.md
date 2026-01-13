# Copilot Instructions for Bot-RialWay

## Project Overview
- **Purpose:** WhatsApp bot with AI (OpenAI Assistant) integration, automating conversations, custom flows, and connecting to Google Sheets/Calendar.
- **Main entrypoint:** `src/app.ts` (bot startup, config, and main event loop)
- **Flows:** Modular event-driven flows in `src/Flows/` (e.g., `idleFlow.ts`, `locationFlow.ts`, etc.)
- **API Integrations:**
  - Google Sheets: `src/Api-Google/`
  - Google Calendar: `src/Api-Google/calendarEvents.ts`
  - Railway API: `src/Api-RailWay/`
- **Providers:** WhatsApp session/provider logic in `src/providers/`
- **Utils:** Shared helpers in `src/utils/` and `src/utils-web/`

## Key Patterns & Conventions
- **Flows:** Each file in `src/Flows/` exports a function or object for a specific conversation flow. Flows are registered in the main app.
- **Session Management:** Sessions are stored in `bot_sessions/` and managed via `src/utils/sessionSync.ts`.
- **Environment Variables:** All secrets/configs are loaded from `.env` (see README for required vars).
- **Error Reporting:** Centralized in `src/utils/errorReporter.ts`.
- **Google API Auth:** Service account credentials via env vars; see `src/Api-Google/` for usage.
- **Custom Messages:** Message templates and timeouts are controlled by env vars (see README).

## Developer Workflows
- **Install:** `pnpm install` or `npm install`
- **Dev Run:** `pnpm run dev` (uses `nodemon.json` for hot reload)
- **Build:** `tsc` (TypeScript), config in `tsconfig.json`
- **Production:** Use `Dockerfile` or `docker-compose.yml` for containerized deploys (Railway uses port 8080)
- **Migrations:** SQL and migration scripts in `scripts/`
- **Testing:** No formal test suite; test flows by running the bot and interacting via WhatsApp

## Integration Points
- **OpenAI:** Text and image assistants, configured via env vars
- **Google Sheets/Calendar:** Service account required, see `src/Api-Google/`
- **Railway:** For deployment, see `railway.json` and Docker files

## Notable Files/Dirs
- `src/app.ts`: Main app logic
- `src/Flows/`: Conversation flows
- `src/Api-Google/`: Google integrations
- `src/Api-RailWay/`: Railway API logic
- `src/providers/`: WhatsApp provider
- `src/utils/`: Utilities (sessions, error handling, etc.)
- `scripts/`: DB and migration scripts
- `bot_sessions/`: Session storage

## Project-Specific Tips
- Add new flows by creating a file in `src/Flows/` and registering it in `src/app.ts`
- Use `src/utils/errorReporter.ts` for consistent error handling
- For Google API changes, update env vars and service account JSON
- When deploying to Railway, ensure `PORT=8080` is set

---
For more details, see [README.md](../README.md)
