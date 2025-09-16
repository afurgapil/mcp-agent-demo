import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

const SUPPORTED = ["en", "tr", "de"] as const;
type Supported = (typeof SUPPORTED)[number];

function pickLocale(acceptLanguage: string | null): Supported {
  if (!acceptLanguage) return "tr";
  const lower = acceptLanguage.toLowerCase();
  if (lower.includes("tr")) return "tr";
  if (lower.includes("de")) return "de";
  return "en";
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLocale = cookieStore.get("locale")?.value as
    | Supported
    | undefined;
  const headerLocale = pickLocale(headerStore.get("accept-language"));
  const locale: Supported =
    cookieLocale && SUPPORTED.includes(cookieLocale)
      ? cookieLocale
      : headerLocale;
  const messages = (await import(`@/messages/${locale}.json`)).default;
  return { locale, messages };
});
