import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  runAutomation,
  computeNextRunAt,
  type AutomationType,
  type AutomationResult,
} from "../automation-runner.server";

const CRON_SECRET = process.env.CRON_SECRET || "";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret") || request.headers.get("x-cron-secret") || "";

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const dueJobs = await prisma.scheduledAutomation.findMany({
    where: {
      status: "active",
      OR: [
        { nextRunAt: null },
        { nextRunAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  if (dueJobs.length === 0) {
    return json({ message: "No jobs due", results: [] });
  }

  const results: AutomationResult[] = [];

  for (const job of dueJobs) {
    const shop = job.shop;

    let admin: any;
    try {
      const ctx = await unauthenticated.admin(shop);
      admin = ctx.admin;
    } catch (e) {
      results.push({
        shop,
        type: job.type as AutomationType,
        success: false,
        summary: `Could not get admin session for ${shop}: ${e instanceof Error ? e.message : String(e)}`,
      });

      await prisma.scheduledAutomation.update({
        where: { id: job.id },
        data: { nextRunAt: computeNextRunAt(job.frequency, now) },
      });
      continue;
    }

    const result = await runAutomation(job.type as AutomationType, admin, shop);
    results.push(result);

    await prisma.scheduledAutomation.update({
      where: { id: job.id },
      data: {
        lastRunAt: now,
        nextRunAt: computeNextRunAt(job.frequency, now),
      },
    });
  }

  return json({
    message: `Processed ${results.length} job(s)`,
    results,
  });
};
