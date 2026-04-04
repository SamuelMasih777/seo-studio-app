import { useState, useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  Badge,
  Modal,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  // Fetch current schema configuration from Shop Metafields
  const response = await admin.graphql(
    `#graphql
    query getShopSchemaSettings {
      shop {
        id
        metafield(namespace: "seo_suite", key: "schema_config") {
          value
        }
      }
    }`
  );

  const json = await response.json();
  let schemaConfig = {
    product: "active",
    breadcrumb: "active",
    faq: "inactive",
    article: "inactive"
  };

  if (json.data.shop.metafield?.value) {
    try {
      schemaConfig = JSON.parse(json.data.shop.metafield.value);
    } catch (e) {
      console.error("Failed to parse schema config", e);
    }
  }

  return { schemaConfig };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const schemaId = formData.get("schemaId") as string;
  const actionType = formData.get("actionType") as string; // 'inject' or 'remove'
  const currentConfigString = formData.get("currentConfig") as string;
  
  let currentConfig = {};
  try {
    currentConfig = JSON.parse(currentConfigString);
  } catch (e) {
    currentConfig = { product: "active", breadcrumb: "active", faq: "inactive", article: "inactive" };
  }

  // Update the config state
  currentConfig[schemaId] = actionType === 'inject' ? 'active' : 'inactive';

  // Get the Shop ID first
  const shopQuery = await admin.graphql(`{ shop { id } }`);
  const shopQueryJson = await shopQuery.json();
  const shopId = shopQueryJson.data.shop.id;

  // Save back to Shop Metafields
  const response = await admin.graphql(
    `#graphql
    mutation shopMetafieldUpdate($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: "seo_suite",
            key: "schema_config",
            type: "json",
            value: JSON.stringify(currentConfig)
          }
        ]
      }
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 800));

  return { success: true, schemaId, actionType, currentConfig };
};

export default function SchemaMarkupPage() {
  const { schemaConfig } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [activeModal, setActiveModal] = useState(false);
  const [selectedSchema, setSelectedSchema] = useState("");
  const [showBanner, setShowBanner] = useState<{show: boolean, type: string, id: string}>({show: false, type: "", id: ""});

  const [schemas, setSchemas] = useState([
    {
      id: "product",
      title: "Product Schema",
      description: "Helps Google display price, availability, and review ratings in search results.",
      status: schemaConfig.product,
      pages: "All Product Pages",
    },
    {
      id: "breadcrumb",
      title: "Breadcrumb Schema",
      description: "Shows the page's position in the site hierarchy, helping users navigate.",
      status: schemaConfig.breadcrumb,
      pages: "Storewide",
    },
    {
      id: "faq",
      title: "FAQ Schema",
      description: "Allows Google to show your Frequently Asked Questions directly in the SERP.",
      status: schemaConfig.faq,
      pages: "FAQ Page",
    },
    {
      id: "article",
      title: "Article Schema",
      description: "Enhances blog posts to appear in Google News and top stories carousels.",
      status: schemaConfig.article,
      pages: "All Blog Posts",
    },
  ]);

  useEffect(() => {
    if (fetcher.data?.success) {
      const { schemaId, actionType } = fetcher.data;
      
      // Update local state to reflect the injection/removal
      setSchemas(prev => prev.map(s => 
        s.id === schemaId ? { ...s, status: actionType === 'inject' ? 'active' : 'inactive' } : s
      ));

      setShowBanner({ show: true, type: actionType, id: schemaId });
      setActiveModal(false);
    }
  }, [fetcher.data]);

  const toggleModal = useCallback(() => setActiveModal((active) => !active), []);

  const handleConfigure = (id: string) => {
    setSelectedSchema(id);
    toggleModal();
  };

  const handleInject = () => {
    fetcher.submit(
      { schemaId: selectedSchema, actionType: "inject", currentConfig: JSON.stringify(schemaConfig) },
      { method: "POST" }
    );
  };

  const handleRemove = () => {
    fetcher.submit(
      { schemaId: selectedSchema, actionType: "remove", currentConfig: JSON.stringify(schemaConfig) },
      { method: "POST" }
    );
  };

  const isSubmitting = fetcher.state === "submitting";
  const selectedSchemaObj = schemas.find(s => s.id === selectedSchema);

  return (
    <Page>
      <TitleBar title="Schema Markup Generator" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            {showBanner.show && (
              <div style={{ paddingBottom: '16px' }}>
                <Banner 
                  tone="success" 
                  title={`${schemas.find(s => s.id === showBanner.id)?.title} has been ${showBanner.type === 'inject' ? 'injected into' : 'removed from'} your theme.`} 
                  onDismiss={() => setShowBanner({show: false, type: "", id: ""})} 
                />
              </div>
            )}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Rich Snippets (JSON-LD)
                  </Text>
                  <Text as="p" tone="subdued">
                    Schema markup helps search engines understand your content better and can result in rich snippets (like star ratings and prices) appearing directly in Google search results.
                  </Text>
                </BlockStack>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
                  {schemas.map((schema) => (
                    <Card key={schema.id} background="bg-surface-secondary">
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="start">
                          <Text as="h3" variant="headingMd">
                            {schema.title}
                          </Text>
                          <Badge tone={schema.status === "active" ? "success" : "new"}>
                            {schema.status === "active" ? "Injected" : "Not Configured"}
                          </Badge>
                        </InlineStack>
                        
                        <Text as="p" tone="subdued">
                          {schema.description}
                        </Text>
                        
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" fontWeight="bold">Applies to:</Text>
                          <Text as="span" variant="bodySm">{schema.pages}</Text>
                        </InlineStack>

                        <InlineStack align="end">
                          <Button 
                            variant={schema.status === "active" ? "plain" : "primary"}
                            onClick={() => handleConfigure(schema.id)}
                          >
                            {schema.status === "active" ? "Manage Settings" : "Configure & Inject"}
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  ))}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  Validation
                </Text>
                <Text as="p" tone="subdued">
                  After injecting schema, always validate it using Google's Rich Results Test tool to ensure there are no syntax errors.
                </Text>
                <Button url="https://search.google.com/test/rich-results" external target="_blank">
                  Open Google Rich Results Test
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      <Modal
        open={activeModal}
        onClose={toggleModal}
        title={`Configure ${selectedSchemaObj?.title || 'Schema'}`}
        primaryAction={{
          content: selectedSchemaObj?.status === 'active' ? 'Re-Inject JSON-LD' : 'Inject JSON-LD into Theme',
          onAction: handleInject,
          loading: isSubmitting && fetcher.formData?.get("actionType") === "inject",
        }}
        secondaryActions={[
          ...(selectedSchemaObj?.status === 'active' ? [{
            content: 'Remove from Theme',
            destructive: true,
            onAction: handleRemove,
            loading: isSubmitting && fetcher.formData?.get("actionType") === "remove",
          }] : []),
          {
            content: 'Cancel',
            onAction: toggleModal,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              {selectedSchemaObj?.status === 'active' 
                ? "This schema is currently active on your store. You can remove it or re-inject it if you've made theme changes."
                : "This will automatically generate and inject the required JSON-LD script tags into your active Shopify theme's <head> section."}
            </Text>
            
            <Text as="h4" variant="headingSm">Preview of generated schema structure:</Text>
            <div style={{ backgroundColor: "#1a1a1a", color: "#a9dc76", padding: "16px", borderRadius: "8px", fontFamily: "monospace", fontSize: "12px", overflowX: "auto" }}>
              <pre style={{ margin: 0 }}>
{`{
  "@context": "https://schema.org/",
  "@type": "${selectedSchema === 'product' ? 'Product' : selectedSchema === 'faq' ? 'FAQPage' : selectedSchema === 'article' ? 'Article' : 'BreadcrumbList'}",
  // Dynamic fields will be injected here
  // based on the specific page content
}`}
              </pre>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}