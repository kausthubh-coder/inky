export interface DevelopmentUrlContext {
  readonly isPackaged: boolean;
  readonly switchValue: string;
}

export function getDevelopmentUrl(context: DevelopmentUrlContext): string | undefined {
  if (context.isPackaged) {
    return undefined;
  }

  const rawUrl = context.switchValue;
  if (!rawUrl) {
    return undefined;
  }

  const url = new URL(rawUrl);
  const isLocalHttp = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  const hasCredentials = url.username.length > 0 || url.password.length > 0;
  if (!isLocalHttp || hasCredentials) {
    throw new Error("Studi development URL must be a credential-free local HTTP URL");
  }

  return url.toString();
}
