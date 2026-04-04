/**
 * Resolve Product `Image` GID + URL to `MediaImage` GID for media mutations.
 */

const PRODUCT_MEDIA_FOR_ALT_QUERY = `#graphql
  query getProductMediaForAlt($id: ID!) {
    product(id: $id) {
      media(first: 250) {
        edges {
          node {
            ... on MediaImage {
              id
              image {
                id
                url
              }
            }
          }
        }
      }
    }
  }
`;

function normalizeImageUrlForMatch(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return url.split("?")[0]?.replace(/\/$/, "").toLowerCase() ?? null;
  }
}

export type ShopifyAdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function resolveMediaImageForProduct(
  admin: ShopifyAdminClient,
  productId: string,
  imageId: string,
  imageUrl?: string,
): Promise<{ mediaId: string } | { error: string }> {
  const mediaRes = await admin.graphql(PRODUCT_MEDIA_FOR_ALT_QUERY, {
    variables: { id: productId },
  });
  const mediaJson = await mediaRes.json();
  const edges = mediaJson.data?.product?.media?.edges ?? [];

  const nodes: { id: string; image?: { id?: string; url?: string } }[] = [];
  for (const edge of edges) {
    const node = edge?.node;
    if (node?.image?.id) {
      nodes.push(node);
    }
  }

  let match = nodes.find((n) => n.image?.id === imageId);
  if (!match && imageUrl) {
    const want = normalizeImageUrlForMatch(imageUrl);
    if (want) {
      match = nodes.find((n) => {
        const got = normalizeImageUrlForMatch(n.image?.url);
        return got != null && got === want;
      });
    }
  }

  if (!match) {
    return {
      error:
        "Could not match this image to product media (ID not in media list, URL mismatch, or product has more than 250 media files).",
    };
  }

  return { mediaId: match.id };
}
