import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useNavigation } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

const SexyLoader = () => (
  <div style={{
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999999,
  }}>
    <div className="loader-container">
      <div className="spinner"></div>
      <div className="spinner-inner"></div>
    </div>
    <div style={{ 
      marginTop: '24px', 
      fontSize: '14px', 
      fontWeight: '700', 
      color: '#1a1a1a',
      letterSpacing: '4px',
      textTransform: 'uppercase',
      animation: 'pulseText 1.5s ease-in-out infinite'
    }}>
      Loading
    </div>
    <style>{`
      .loader-container {
        position: relative;
        width: 80px;
        height: 80px;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .spinner {
        position: absolute;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        border: 3px solid transparent;
        border-top-color: #000;
        border-bottom-color: #000;
        animation: spin 1.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite;
      }
      .spinner-inner {
        position: absolute;
        width: 70%;
        height: 70%;
        border-radius: 50%;
        border: 3px solid transparent;
        border-left-color: #2c6ecb;
        border-right-color: #2c6ecb;
        animation: spinReverse 1s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite;
      }
      @keyframes spin { 
        0% { transform: rotate(0deg); } 
        100% { transform: rotate(360deg); } 
      }
      @keyframes spinReverse { 
        0% { transform: rotate(360deg); } 
        100% { transform: rotate(0deg); } 
      }
      @keyframes pulseText { 
        0% { opacity: 0.4; transform: translateY(0); } 
        50% { opacity: 1; transform: translateY(-2px); text-shadow: 0 4px 8px rgba(0,0,0,0.1); } 
        100% { opacity: 0.4; transform: translateY(0); } 
      }
    `}</style>
  </div>
);

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      {isLoading && <SexyLoader />}
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/seo-audit">SEO Audit</Link>
        <Link to="/app/meta-tags">Meta Tags</Link>
        <Link to="/app/image-optimization">Image Alt Text</Link>
        <Link to="/app/image-compression">Image Compression</Link>
        <Link to="/app/content-optimization">AI Content</Link>
        <Link to="/app/llms-seo">LLMs SEO</Link>
        <Link to="/app/schema-markup">Schema</Link>
        <Link to="/app/internal-linking">Internal Links</Link>
        <Link to="/app/broken-links">Broken Links</Link>
        <Link to="/app/sitemap-robots">Sitemap & Robots</Link>
        <Link to="/app/bulk-editor">Bulk Editor</Link>
        <Link to="/app/automations">Automations</Link>
        <Link to="/app/ai-settings">AI Settings</Link>
        <Link to="/app/pricing">Pricing</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
