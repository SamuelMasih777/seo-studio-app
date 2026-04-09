import prisma from "./db.server";

export interface PromptVariables {
  product_title?: string;
  product_description?: string;
  shop_name?: string;
  tone?: string;
  keyword?: string;
  topic?: string;
}

/**
 * Load an AIPromptTemplate for a shop, substitute variables, and return
 * the resolved prompt string. Returns null when no template applies
 * (callers fall back to their built-in prompt).
 *
 * Resolution order:
 *  1. If `templateId` is provided and not empty/"none", load that specific template
 *  2. Otherwise load the shop's default template (`isDefault = true`)
 *  3. If neither exists, return null
 */
export async function resolvePromptForShop(
  shop: string,
  variables: PromptVariables,
  templateId?: string | null,
): Promise<string | null> {
  try {
    let template: { template: string; tone: string } | null = null;

    if (templateId && templateId !== "none") {
      template = await prisma.aIPromptTemplate.findFirst({
        where: { id: templateId, shop },
        select: { template: true, tone: true },
      });
    }

    if (!template) {
      template = await prisma.aIPromptTemplate.findFirst({
        where: { shop, isDefault: true },
        orderBy: { updatedAt: "desc" },
        select: { template: true, tone: true },
      });
    }

    if (!template) return null;

    return substituteVariables(template.template, {
      ...variables,
      tone: variables.tone || template.tone,
    });
  } catch {
    return null;
  }
}

function substituteVariables(
  template: string,
  vars: PromptVariables,
): string {
  return template
    .replace(/\{\{product_title\}\}/gi, vars.product_title || "")
    .replace(/\{\{product_description\}\}/gi, vars.product_description || "")
    .replace(/\{\{shop_name\}\}/gi, vars.shop_name || "")
    .replace(/\{\{tone\}\}/gi, vars.tone || "professional")
    .replace(/\{\{keyword\}\}/gi, vars.keyword || "")
    .replace(/\{\{topic\}\}/gi, vars.topic || "");
}
