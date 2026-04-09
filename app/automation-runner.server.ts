import prisma from "./db.server";
import {
  runFullDashboardScan,
  type DashboardScanPayload,
} from "./seo-dashboard-scan.server";

export type AutomationType = "seo_audit" | "broken_link_scan";

export interface AutomationResult {
  shop: string;
  type: AutomationType;
  success: boolean;
  summary: string;
}

function computeNextRunAt(frequency: string, from: Date = new Date()): Date {
  const next = new Date(from);
  switch (frequency) {
    case "daily":
      next.setDate(next.getDate() + 1);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      next.setDate(next.getDate() + 7);
  }
  return next;
}

export { computeNextRunAt };

async function runBrokenLinkScan(admin: any): Promise<{ brokenCount: number; scannedCount: number }> {
  const response = await admin.graphql(
    `#graphql
    query getContentForLinks {
      articles(first: 50) {
        edges { node { id title handle body } }
      }
      pages(first: 50) {
        edges { node { id title handle body } }
      }
      products(first: 100) {
        edges { node { handle } }
      }
    }`,
  );

  const json = await response.json();
  const articles = json.data.articles.edges.map((e: any) => e.node);
  const pages = json.data.pages.edges.map((e: any) => e.node);
  const productHandles = new Set(
    json.data.products.edges.map((e: any) => e.node.handle as string),
  );

  let brokenCount = 0;
  const regex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>/gi;

  const scanHtml = (html: string, sourceUrl: string) => {
    if (!html) return;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      const url = match[2];
      if (url.includes("/products/")) {
        const handle = url.split("/products/")[1]?.split("?")[0]?.replace(/\/$/, "");
        if (handle && !productHandles.has(handle)) {
          brokenCount++;
        }
      }
    }
    regex.lastIndex = 0;
  };

  for (const a of articles) scanHtml(a.body, `/blogs/news/${a.handle}`);
  for (const p of pages) scanHtml(p.body, `/pages/${p.handle}`);

  return { brokenCount, scannedCount: articles.length + pages.length };
}

export async function runAutomation(
  type: AutomationType,
  admin: any,
  shop: string,
): Promise<AutomationResult> {
  try {
    if (type === "seo_audit") {
      const payload: DashboardScanPayload = await runFullDashboardScan(admin);

      await prisma.dashboardSeoSnapshot.upsert({
        where: { shop },
        create: { shop, payload: JSON.parse(JSON.stringify(payload)) },
        update: { payload: JSON.parse(JSON.stringify(payload)) },
      });

      await prisma.auditHistory.create({
        data: {
          shop,
          score: payload.seoScore,
          metaIssuesCount: payload.metaIssuesCount,
          missingAltCount: payload.missingAltCount,
          brokenLinksCount: payload.brokenLinksCount,
          duplicateContentCount: payload.duplicateContentCount,
        },
      });

      return {
        shop,
        type,
        success: true,
        summary: `SEO audit complete. Score: ${payload.seoScore}/100, ${payload.pagesScanned} pages scanned, ${payload.totalIssueSignals} issues found.`,
      };
    }

    if (type === "broken_link_scan") {
      const { brokenCount, scannedCount } = await runBrokenLinkScan(admin);

      if (brokenCount > 0) {
        const existingLogs = await prisma.brokenLinkLog.findMany({
          where: { shop, fixed: false },
          select: { url: true },
        });
        const existingUrls = new Set(existingLogs.map((l) => l.url));

        if (!existingUrls.has(`auto-scan-${new Date().toISOString().slice(0, 10)}`)) {
          await prisma.brokenLinkLog.create({
            data: {
              shop,
              url: `auto-scan: ${brokenCount} broken link(s) found`,
              statusCode: 404,
            },
          });
        }
      }

      return {
        shop,
        type,
        success: true,
        summary: `Broken link scan complete. ${scannedCount} pages scanned, ${brokenCount} broken link(s) found.`,
      };
    }

    return { shop, type, success: false, summary: `Unknown automation type: ${type}` };
  } catch (e) {
    return {
      shop,
      type,
      success: false,
      summary: e instanceof Error ? e.message : "Automation failed",
    };
  }
}
