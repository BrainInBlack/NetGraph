// Build-time constants injected by Vite `define` (see vite.config.ts).
declare global {
  const __APP_VERSION__: string;
  /** True only in the deployed multi-file web build, where download/netgraph.html exists. */
  const __WEB_BUILD__: boolean;
}

export {};
