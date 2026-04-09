import prisma from "./db.server";

export type PlanTier = "free" | "pro" | "premium";

const PROMO_ENABLED = process.env.PROMO_ENABLED !== "false";
const PROMO_MAX_INSTALLS = parseInt(process.env.PROMO_MAX_INSTALLS || "500", 10);
const PROMO_HONOR_EXISTING = process.env.PROMO_HONOR_EXISTING !== "false";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface PlanLimits {
  aiGenerationsPerMonth: number;
  imageCompressionsPerMonth: number;
  blogPostsPerMonth: number;
  canBulkEdit: boolean;
  canAutomate: boolean;
  canUseCustomPrompts: boolean;
  canOneClickFix: boolean;
}

export function getPlanLimits(plan: PlanTier): PlanLimits {
  switch (plan) {
    case "premium":
      return {
        aiGenerationsPerMonth: Infinity,
        imageCompressionsPerMonth: Infinity,
        blogPostsPerMonth: Infinity,
        canBulkEdit: true,
        canAutomate: true,
        canUseCustomPrompts: true,
        canOneClickFix: true,
      };
    case "pro":
      return {
        aiGenerationsPerMonth: 100,
        imageCompressionsPerMonth: 50,
        blogPostsPerMonth: 5,
        canBulkEdit: true,
        canAutomate: true,
        canUseCustomPrompts: false,
        canOneClickFix: false,
      };
    default:
      return {
        aiGenerationsPerMonth: 150,
        imageCompressionsPerMonth: 150,
        blogPostsPerMonth: 0,
        canBulkEdit: false,
        canAutomate: false,
        canUseCustomPrompts: false,
        canOneClickFix: false,
      };
  }
}

function mapSubscriptionToPlan(name: string): PlanTier {
  const low = name.toLowerCase();
  if (low === "premium") return "premium";
  if (low === "pro") return "pro";
  return "free";
}

export interface ResolvedPlan {
  plan: PlanTier;
  isEarlyAdopter: boolean;
  limits: PlanLimits;
  earlyAdopterSlotsLeft: number | null;
}

/**
 * Check if the Prisma client knows about the earlyAdopter field.
 * Returns false when `prisma generate` hasn't run after schema migration.
 */
function clientHasEarlyAdopterField(): boolean {
  try {
    const fields = (prisma.storeSettings as any).fields;
    if (fields && typeof fields === "object") {
      return "earlyAdopter" in fields;
    }
  } catch { /* ignore */ }
  return false;
}

export async function resolveShopPlan(
  shop: string,
  billingCheck?: {
    hasActivePayment: boolean;
    appSubscriptions: { name: string }[];
  },
): Promise<ResolvedPlan> {
  const hasEaField = clientHasEarlyAdopterField();

  let settings: any = await prisma.storeSettings.findUnique({ where: { shop } });

  if (!settings) {
    let grantEarlyAdopter = false;

    if (PROMO_ENABLED && hasEaField) {
      try {
        const currentEarlyAdopters = await prisma.storeSettings.count({
          where: { earlyAdopter: true } as any,
        });
        if (currentEarlyAdopters < PROMO_MAX_INSTALLS) {
          grantEarlyAdopter = true;
        }
      } catch {
        /* stale client – skip early-adopter grant */
      }
    }

    const createData: Record<string, unknown> = {
      shop,
      plan: grantEarlyAdopter ? "pro" : "free",
    };
    if (hasEaField) {
      createData.earlyAdopter = grantEarlyAdopter;
      createData.earlyAdopterGrantedAt = grantEarlyAdopter ? new Date() : null;
    }

    try {
      settings = await prisma.storeSettings.create({ data: createData as any });
    } catch {
      settings = await prisma.storeSettings.create({ data: { shop } as any });
    }
  }

  const isEarlyAdopter = hasEaField && !!settings.earlyAdopter;

  if (isEarlyAdopter && PROMO_HONOR_EXISTING) {
    const earlyAdopterSlotsLeft = await getEarlyAdopterSlotsLeft();
    return {
      plan: "pro",
      isEarlyAdopter: true,
      limits: getPlanLimits("pro"),
      earlyAdopterSlotsLeft,
    };
  }

  let plan: PlanTier = "free";
  if (billingCheck?.hasActivePayment && billingCheck.appSubscriptions.length) {
    plan = mapSubscriptionToPlan(billingCheck.appSubscriptions[0].name);
  }

  if (plan !== settings.plan) {
    try {
      await prisma.storeSettings.update({
        where: { shop },
        data: { plan },
      });
    } catch { /* ignore stale client errors */ }
  }

  return {
    plan,
    isEarlyAdopter: false,
    limits: getPlanLimits(plan),
    earlyAdopterSlotsLeft: null,
  };
}

export async function getEarlyAdopterSlotsLeft(): Promise<number> {
  try {
    const count = await prisma.storeSettings.count({
      where: { earlyAdopter: true } as any,
    });
    return Math.max(0, PROMO_MAX_INSTALLS - count);
  } catch {
    return PROMO_MAX_INSTALLS;
  }
}

type UsageField = "aiUsageCount" | "compressionCount" | "blogPostCount";

function limitForField(limits: PlanLimits, field: UsageField): number {
  switch (field) {
    case "aiUsageCount":
      return limits.aiGenerationsPerMonth;
    case "compressionCount":
      return limits.imageCompressionsPerMonth;
    case "blogPostCount":
      return limits.blogPostsPerMonth;
  }
}

export interface UsageCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
}

export async function checkAndIncrementUsage(
  shop: string,
  field: UsageField,
  plan: PlanTier,
  incrementBy = 1,
): Promise<UsageCheckResult> {
  const limits = getPlanLimits(plan);
  const max = limitForField(limits, field);

  if (!Number.isFinite(max)) {
    return { allowed: true, used: 0, limit: max };
  }

  try {
    let settings: any = await prisma.storeSettings.findUnique({ where: { shop } });
    if (!settings) {
      settings = await prisma.storeSettings.create({ data: { shop } as any });
    }

    const resetAt = settings.usageResetAt;
    if (resetAt && new Date().getTime() - new Date(resetAt).getTime() > THIRTY_DAYS_MS) {
      settings = await prisma.storeSettings.update({
        where: { shop },
        data: {
          aiUsageCount: 0,
          compressionCount: 0,
          blogPostCount: 0,
          usageResetAt: new Date(),
        } as any,
      });
    }

    const currentUsed = (settings[field] as number) ?? 0;

    if (currentUsed + incrementBy > max) {
      return { allowed: false, used: currentUsed, limit: max };
    }

    await prisma.storeSettings.update({
      where: { shop },
      data: { [field]: currentUsed + incrementBy } as any,
    });

    return { allowed: true, used: currentUsed + incrementBy, limit: max };
  } catch {
    return { allowed: true, used: 0, limit: max };
  }
}
