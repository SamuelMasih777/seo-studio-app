import { PrismaClient } from "@prisma/client";

type PrismaWithSnapshot = PrismaClient & {
  dashboardSeoSnapshot?: { findUnique?: unknown };
};

const globalForPrisma = globalThis as typeof globalThis & {
  __seoSuitePrisma?: PrismaClient;
};

let recoveredStaleDevClient = false;

function snapshotDelegateOk(client: PrismaClient): boolean {
  return (
    typeof (client as PrismaWithSnapshot).dashboardSeoSnapshot?.findUnique ===
    "function"
  );
}

function obtainClient(): PrismaClient {
  let client = globalForPrisma.__seoSuitePrisma;

  if (client && snapshotDelegateOk(client)) {
    return client;
  }

  if (
    client &&
    process.env.NODE_ENV !== "production" &&
    !recoveredStaleDevClient
  ) {
    recoveredStaleDevClient = true;
    void client.$disconnect().catch(() => {});
    globalForPrisma.__seoSuitePrisma = undefined;
    client = undefined;
  }

  if (!globalForPrisma.__seoSuitePrisma) {
    globalForPrisma.__seoSuitePrisma = new PrismaClient();
  }

  return globalForPrisma.__seoSuitePrisma;
}

/**
 * Lazy proxy so a long-running `shopify app dev` process picks up new Prisma
 * models after `prisma generate` without requiring a manual restart. If you
 * still see DB errors, stop dev, run `npx prisma generate`, then start again.
 */
const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const real = obtainClient();
    const value = Reflect.get(real as object, prop, real);
    if (typeof value === "function") {
      return (value as (...a: unknown[]) => unknown).bind(real);
    }
    return value;
  },
});

export default prisma;
