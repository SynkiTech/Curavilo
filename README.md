# Curavilo

A configurable, multi-tenant, AI-powered healthcare operating platform.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables:
   Copy `.env.local.example` to `.env.local` and fill in your Supabase credentials.

3. Initialize the database:
   ```bash
   npx prisma migrate dev
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

## Project Structure

- `src/app` - Next.js pages and layout
- `src/modules` - Domain modules (auth, organizations, facilities, etc.)
- `src/lib` - Shared libraries (supabase client)
- `prisma` - Prisma schema and migrations
- `docs` - Documentation

## Technology Stack

- **Framework**: Next.js 14+ App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui (Radix UI primitives)
- **ORM**: Prisma PostgreSQL
- **Database**: Supabase PostgreSQL
- **Authentication**: Supabase Auth

## License

MIT