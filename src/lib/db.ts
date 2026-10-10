import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Security: query logging echoes every bound value (patient names, phone
// numbers, token hashes) into server logs, so it is dev-only. Production logs
// errors only (security hardening, "do not log sensitive data").
const isDev = process.env.NODE_ENV === 'development'

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isDev ? ['query', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
