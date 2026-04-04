/// <reference types="vite/client" />
/// <reference types="@remix-run/node" />

declare namespace NodeJS {
  interface ProcessEnv {
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
    GOOGLE_GENERATIVE_AI_API_KEY?: string;
    GOOGLE_AI_API_KEY?: string;
  }
}
