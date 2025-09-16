export const locales = ["en", "tr"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "tr";

export async function getMessages(locale: Locale) {
  const messages = await import(`./messages/${locale}.json`);
  return messages.default;
}
