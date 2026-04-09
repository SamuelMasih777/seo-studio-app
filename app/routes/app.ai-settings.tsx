import { useState, useEffect, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  InlineStack,
  Badge,
  TextField,
  Modal,
  Banner,
  IndexTable,
  Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const templates = await prisma.aIPromptTemplate.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  return { templates };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const intent = formData.get("intent") as string;

  if (intent === "create" || intent === "update") {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const template = formData.get("template") as string;
    const tone = formData.get("tone") as string;

    if (intent === "update" && id) {
      await prisma.aIPromptTemplate.update({
        where: { id, shop },
        data: { name, description, template, tone },
      });
    } else {
      await prisma.aIPromptTemplate.create({
        data: { shop, name, description, template, tone },
      });
    }
    return { success: true };
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await prisma.aIPromptTemplate.delete({
      where: { id, shop },
    });
    return { success: true };
  }

  if (intent === "set_default") {
    const id = formData.get("id") as string;

    await prisma.aIPromptTemplate.updateMany({
      where: { shop, isDefault: true },
      data: { isDefault: false },
    });

    await prisma.aIPromptTemplate.update({
      where: { id, shop },
      data: { isDefault: true },
    });

    return { success: true };
  }

  if (intent === "clear_default") {
    await prisma.aIPromptTemplate.updateMany({
      where: { shop, isDefault: true },
      data: { isDefault: false },
    });
    return { success: true };
  }

  return null;
};

export default function AISettingsPage() {
  const { templates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [activeModal, setActiveModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("");
  const [tone, setTone] = useState("professional");

  const toggleModal = useCallback(() => setActiveModal((active) => !active), []);

  useEffect(() => {
    if (fetcher.data?.success) {
      setActiveModal(false);
    }
  }, [fetcher.data]);

  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setName("");
    setDescription("");
    setTemplate(
      "Write a {{tone}} description for {{product_title}}. Focus on its features: {{product_description}}",
    );
    setTone("professional");
    setActiveModal(true);
  };

  const handleOpenEdit = (tpl: any) => {
    setEditingTemplate(tpl);
    setName(tpl.name);
    setDescription(tpl.description || "");
    setTemplate(tpl.template);
    setTone(tpl.tone);
    setActiveModal(true);
  };

  const handleSave = () => {
    fetcher.submit(
      {
        intent: editingTemplate ? "update" : "create",
        id: editingTemplate?.id || "",
        name,
        description,
        template,
        tone,
      },
      { method: "POST" },
    );
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this template?")) {
      fetcher.submit({ intent: "delete", id }, { method: "POST" });
    }
  };

  const handleSetDefault = (id: string) => {
    fetcher.submit({ intent: "set_default", id }, { method: "POST" });
  };

  const handleClearDefault = () => {
    fetcher.submit({ intent: "clear_default" }, { method: "POST" });
  };

  const isSubmitting = fetcher.state === "submitting";
  const currentDefault = templates.find((t: any) => t.isDefault);

  const rowMarkup = templates.map((tpl: any, index: number) => (
    <IndexTable.Row id={tpl.id} key={tpl.id} position={index}>
      <IndexTable.Cell>
        <InlineStack gap="200" blockAlign="center">
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {tpl.name}
          </Text>
          {tpl.isDefault && <Badge tone="success">Default</Badge>}
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>{tpl.description || "—"}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="info">{tpl.tone}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Button size="micro" onClick={() => handleOpenEdit(tpl)}>
            Edit
          </Button>
          {!tpl.isDefault ? (
            <Button size="micro" onClick={() => handleSetDefault(tpl.id)}>
              Set Default
            </Button>
          ) : (
            <Button size="micro" tone="critical" onClick={handleClearDefault}>
              Unset Default
            </Button>
          )}
          <Button size="micro" tone="critical" onClick={() => handleDelete(tpl.id)}>
            Delete
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      <TitleBar title="AI Prompt Templates">
        <button variant="primary" onClick={handleOpenCreate}>
          Create Template
        </button>
      </TitleBar>

      <BlockStack gap="500">
        {currentDefault && (
          <Banner tone="success">
            <Text as="p">
              Active default template: <strong>{currentDefault.name}</strong> ({currentDefault.tone}).
              All AI-generated content will use this template's instructions.
            </Text>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card padding="0">
              <BlockStack gap="400">
                <div style={{ padding: "16px 16px 0 16px" }}>
                  <Text as="h2" variant="headingLg">
                    Custom AI Prompts
                  </Text>
                  <Text as="p" tone="subdued">
                    Create and manage custom instructions that control how the AI writes your content.
                    Set one template as the default to use it across all AI features.
                  </Text>
                </div>

                {templates.length === 0 ? (
                  <div style={{ padding: "16px" }}>
                    <Banner tone="info" title="No templates found">
                      <p>
                        Click "Create Template" to create your first custom prompt.
                        Until then, built-in prompts are used for AI generation.
                      </p>
                    </Banner>
                  </div>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "template", plural: "templates" }}
                    itemCount={templates.length}
                    headings={[
                      { title: "Name" },
                      { title: "Description" },
                      { title: "Tone" },
                      { title: "Actions" },
                    ]}
                    selectable={false}
                  >
                    {rowMarkup}
                  </IndexTable>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  Available Variables
                </Text>
                <Text as="p" tone="subdued">
                  Use these in your prompt templates. They are automatically replaced
                  with real data when generating content.
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    <code>{`{{product_title}}`}</code> -- Product name
                  </Text>
                  <Text as="p" variant="bodySm">
                    <code>{`{{product_description}}`}</code> -- Existing description
                  </Text>
                  <Text as="p" variant="bodySm">
                    <code>{`{{shop_name}}`}</code> -- Your store name
                  </Text>
                  <Text as="p" variant="bodySm">
                    <code>{`{{tone}}`}</code> -- Writing tone
                  </Text>
                  <Text as="p" variant="bodySm">
                    <code>{`{{keyword}}`}</code> -- Target SEO keyword
                  </Text>
                  <Text as="p" variant="bodySm">
                    <code>{`{{topic}}`}</code> -- Blog topic (blog writer)
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>

            <div style={{ marginTop: 16 }}>
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">How it works</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Mark one template as "Default" and it will be used whenever
                    AI generates product descriptions, alt text, or blog content.
                    If no default is set, the built-in prompts are used.
                  </Text>
                </BlockStack>
              </Card>
            </div>
          </Layout.Section>
        </Layout>
      </BlockStack>

      <Modal
        open={activeModal}
        onClose={toggleModal}
        title={editingTemplate ? "Edit Template" : "Create Template"}
        primaryAction={{
          content: "Save Template",
          onAction: handleSave,
          loading: isSubmitting,
        }}
        secondaryActions={[{ content: "Cancel", onAction: toggleModal }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Template Name"
              value={name}
              onChange={setName}
              autoComplete="off"
              placeholder="e.g. Winter Sale Product Description"
            />
            <TextField
              label="Description (Internal)"
              value={description}
              onChange={setDescription}
              autoComplete="off"
              placeholder="What is this template used for?"
            />
            <Select
              label="Writing Tone"
              options={[
                { label: "Professional", value: "professional" },
                { label: "Casual", value: "casual" },
                { label: "Persuasive", value: "persuasive" },
                { label: "Humorous", value: "humorous" },
                { label: "Urgent", value: "urgent" },
                { label: "Friendly", value: "friendly" },
                { label: "Informative", value: "informative" },
              ]}
              value={tone}
              onChange={setTone}
            />
            <TextField
              label="Prompt Template"
              value={template}
              onChange={setTemplate}
              multiline={6}
              autoComplete="off"
              helpText="Use {{variables}} like {{product_title}}, {{tone}}, etc. They are replaced with real data at generation time."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
