export interface Config {
  baseUrl: string;
  token: string;
}

export function loadConfig(): Config {
  const token = process.env.TODORANT_TOKEN;
  if (!token) {
    throw new Error(
      "TODORANT_TOKEN environment variable is required. " +
        "Get it from your browser's localStorage on https://todorant.com " +
        "(key: 'user' -> 'token') or via OAuth flow."
    );
  }

  const baseUrl = process.env.TODORANT_BASE_URL ?? "https://backend.todorant.com";

  return { baseUrl, token };
}
