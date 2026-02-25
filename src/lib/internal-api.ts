function resolveConfiguredBase(): string | null {
  const configured =
    process.env.MISSION_CONTROL_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_MISSION_CONTROL_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    "";

  if (configured) {
    const hasProtocol = /^https?:\/\//i.test(configured);
    return `${hasProtocol ? "" : "http://"}${configured}`.replace(/\/+$/, "");
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    const hasProtocol = /^https?:\/\//i.test(vercelUrl);
    return `${hasProtocol ? "" : "https://"}${vercelUrl}`.replace(/\/+$/, "");
  }

  return null;
}

export function resolveInternalApiUrl(pathname: string, requestUrl?: string): string {
  if (requestUrl) {
    return new URL(pathname, requestUrl).toString();
  }

  const configuredBase = resolveConfiguredBase();
  if (configuredBase) {
    return new URL(pathname, configuredBase).toString();
  }

  const localhostBase = `http://127.0.0.1:${process.env.PORT || 3000}`;
  return new URL(pathname, localhostBase).toString();
}
