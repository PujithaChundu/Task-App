# TaskFlow Hub

TaskFlow Hub is a web-based task management system built with HTML, CSS, JavaScript, Express, Netlify Functions, and Supabase.

## Features

- Cookie-based login with role-based access control
- Seeded default admin account: `admin` / `admin123`
- Admin-only user access management
- Manager task creation, editing, deletion, and employee assignment
- Employee-only visibility into assigned tasks with status updates
- Shared server-side persistence through Supabase Postgres
- Dashboard cards, filters, reports, departments, tracking, and export tools
- Export support for CSV, PDF, and Word-compatible `.doc`

## Local Run

1. Create a Supabase project.
2. Open the SQL Editor in Supabase and run [`supabase/schema.sql`](./supabase/schema.sql).
3. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
4. Install dependencies and start the app:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Netlify Deploy

1. Push this project to GitHub.
2. In Netlify, create a new site from that repository.
3. Set these environment variables in Netlify:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
4. Deploy.

The static UI is published from `public`, and API requests are routed to the Netlify Function defined in [`netlify/functions/api.js`](./netlify/functions/api.js).

## Free Tier Notes

- Netlify Free uses monthly credits and is suitable for demos or light internal usage.
- Supabase Free projects can be paused after inactivity.
- This setup is good for getting started without paying, but it is not as reliable as a paid production deployment.
