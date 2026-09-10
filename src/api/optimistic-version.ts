export const parseIfMatch = (header: string | string[] | undefined): number | null => {
  if (Array.isArray(header) || header === undefined) return null;
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version >= 1 ? version : null;
};
