# Nexora — MongoDB AI chatbot

## Requirements
- Node.js 20 or newer
- MongoDB local server or MongoDB Atlas database
- OpenAI API key for live AI replies

## Setup
1. Copy `.env.example` to `.env`.
2. Set `MONGODB_URI` to your local or Atlas connection string.
3. Set `SESSION_SECRET` to a random secret of at least 32 characters. Example generation: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
4. Set `OPENAI_API_KEY` and choose a model available to your API account in `OPENAI_MODEL`.
5. Run `npm install`, then `npm start`.
6. Visit `http://localhost:3000`.

Never commit `.env` or expose the AI key in browser JavaScript. In MongoDB Atlas, create a database user and restrict Network Access to trusted IPs. Production deployments must use HTTPS and `NODE_ENV=production`.

## API
- `POST /api/auth/register` with `{ "name", "email", "password" }` (password 10+ characters)
- `POST /api/auth/login` with `{ "email", "password" }`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/chats`
- `POST /api/chats`
- `GET /api/chats/:id`
- `DELETE /api/chats/:id`
- `POST /api/chats/:id/messages` with `{ "message": "Your question" }`
- `GET /api/health`

Passwords are hashed with bcrypt, sessions are stored in MongoDB, and chat access is restricted to the authenticated owner. This is a starter, not a security audit. Before public deployment, add CSRF protection appropriate to your hosting setup, email verification, password recovery, monitoring, stronger abuse controls, privacy/retention policies, and review AI provider model availability and spending limits.
