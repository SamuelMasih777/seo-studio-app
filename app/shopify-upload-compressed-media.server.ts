import type { ShopifyAdminClient } from "./shopify-product-media.server";

/**
 * Staged upload → `productCreateMedia` → remove previous `MediaImage`.
 * Create runs before delete so a failed upload does not remove the original.
 */
export async function replaceProductMediaWithStagedUpload(
  admin: ShopifyAdminClient,
  options: {
    productId: string;
    oldMediaId: string;
    buffer: Buffer;
    mimeType: string;
    filename: string;
    alt?: string | null;
  },
): Promise<
  | { kind: "ok" }
  | { kind: "failed"; error: string }
  | { kind: "partial"; warning: string }
> {
  const { productId, oldMediaId, buffer, mimeType, filename, alt } = options;

  const stagedRes = await admin.graphql(
    `#graphql
    mutation stagedUploadsCreateImage($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          message
        }
      }
    }`,
    {
      variables: {
        input: [
          {
            filename,
            mimeType,
            resource: "IMAGE",
            httpMethod: "POST",
          },
        ],
      },
    },
  );

  const stagedJson = await stagedRes.json();
  const stagedErrors = stagedJson.data?.stagedUploadsCreate?.userErrors ?? [];
  if (stagedErrors.length > 0) {
    return { kind: "failed", error: stagedErrors[0].message || "Staged upload failed." };
  }

  const target = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) {
    return { kind: "failed", error: "No staged upload target returned." };
  }

  const uploadFormData = new FormData();
  for (const p of target.parameters ?? []) {
    uploadFormData.append(p.name, p.value);
  }
  uploadFormData.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    filename,
  );

  const uploadRes = await fetch(target.url, {
    method: "POST",
    body: uploadFormData,
  });

  if (!uploadRes.ok) {
    return {
      kind: "failed",
      error: `Upload to Shopify storage failed (${uploadRes.status}).`,
    };
  }

  const createRes = await admin.graphql(
    `#graphql
    mutation productCreateCompressedMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          ... on MediaImage {
            id
            image {
              url
            }
          }
        }
        mediaUserErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        productId,
        media: [
          {
            originalSource: target.resourceUrl,
            mediaContentType: "IMAGE",
            alt: alt?.trim() || "",
          },
        ],
      },
    },
  );

  const createJson = await createRes.json();
  const mediaErrors = createJson.data?.productCreateMedia?.mediaUserErrors ?? [];
  if (mediaErrors.length > 0) {
    return {
      kind: "failed",
      error: mediaErrors.map((e: { message?: string }) => e.message).join("; "),
    };
  }

  const deleteRes = await admin.graphql(
    `#graphql
    mutation productDeleteOldMedia($productId: ID!, $mediaIds: [ID!]!) {
      productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
        deletedMediaIds
        mediaUserErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        productId,
        mediaIds: [oldMediaId],
      },
    },
  );

  const deleteJson = await deleteRes.json();
  const delErrors = deleteJson.data?.productDeleteMedia?.mediaUserErrors ?? [];
  if (delErrors.length > 0) {
    return {
      kind: "partial",
      warning: `Compressed image was added, but the old image could not be removed: ${delErrors
        .map((e: { message?: string }) => e.message)
        .join("; ")}. Delete the duplicate in Shopify admin if needed.`,
    };
  }

  return { kind: "ok" };
}
