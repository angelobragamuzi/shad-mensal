import PixCopyClient from "./pix-copy-client";

interface PixCopyPageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

function pickFirstValue(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
    return value[0].trim();
  }
  return "";
}

export default async function PixCopyPage({ searchParams }: PixCopyPageProps) {
  const resolvedSearchParams = searchParams ? await Promise.resolve(searchParams) : {};
  const initialCode = pickFirstValue(resolvedSearchParams.code);

  return <PixCopyClient initialCode={initialCode} />;
}
