# Technical Documentation: SEO Suite DFD (Shopify App)

## 1. System Architecture
The application is structured as a modular Shopify application, consisting of a React-based frontend embedded in the Shopify Admin and an Express/Node.js backend handling API requests, Shopify integrations, and background tasks.

### 1.1 Tech Stack
- **Frontend:** React, TypeScript, Vite, Tailwind CSS (Polaris-styled or utilizing @shopify/polaris components), Zustand for state management.
- **Backend:** Node.js, Express, TypeScript.
- **Database:** Supabase (PostgreSQL) for storing app settings, user metadata, audit histories, and generated content.
- **AI Integration:** OpenAI API for automated meta tags, alt text, and content optimization.
- **Shopify API:** Shopify Admin REST & GraphQL APIs, Storefront API.

### 1.2 Modular Design
The system supports enabling/disabling 12 core modules. The backend tracks module states per store. Frontend routes dynamically render active modules based on store configuration.

## 2. Database Schema (Supabase)

### `shops`
- `id` (UUID, Primary Key)
- `shopify_domain` (String, Unique)
- `access_token` (String, Encrypted)
- `plan` (Enum: 'free', 'basic', 'pro', 'advanced')
- `created_at` (Timestamp)

### `module_settings`
- `id` (UUID, Primary Key)
- `shop_id` (UUID, Foreign Key)
- `module_name` (String)
- `is_active` (Boolean)
- `config` (JSONB - module specific settings)

### `seo_audits`
- `id` (UUID, Primary Key)
- `shop_id` (UUID, Foreign Key)
- `score` (Integer)
- `issues_count` (JSONB)
- `created_at` (Timestamp)

### `ai_templates`
- `id` (UUID, Primary Key)
- `shop_id` (UUID, Foreign Key)
- `type` (String - meta, alt_text, etc)
- `prompt` (Text)

## 3. Shopify Integration Details

### Permissions (Scopes)
`read_products, write_products, read_content, write_content, read_themes, write_themes, read_script_tags, write_script_tags`

### Webhooks
- `app/uninstalled`
- `products/update`
- `products/create`

## 4. API Endpoints (Express Backend)

### `/api/modules`
- `GET /api/modules` - List all modules and their active states for the shop
- `POST /api/modules/toggle` - Enable/Disable a module

### `/api/audit`
- `POST /api/audit/scan` - Trigger a full store scan
- `GET /api/audit/history` - Retrieve previous audit scores

### `/api/ai`
- `POST /api/ai/generate-meta` - Generate meta tags via OpenAI
- `POST /api/ai/generate-alt` - Generate alt text for an image
- `POST /api/ai/optimize-content` - Rewrite product description

## 5. Security & Performance
- JWT-based authentication for the React app communicating with Express.
- Shopify Session Token validation.
- Redis (or in-memory cache) for caching frequent API responses to maintain < 2s dashboard load times.
- API rate-limiting handling (handling 429 errors gracefully).
- Secure storage of Shopify Access Tokens and OpenAI keys.

## 6. AI Integration Specifications
- Uses OpenAI `gpt-4o-mini` or similar cost-effective model for content generation.
- Prompt parameters include: Target Keyword, Brand Voice, Product Details, Character constraints.
