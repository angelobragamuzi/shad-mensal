import { buildPixPayload } from "@/lib/shad-manager/pix";

export interface PixPaymentOption {
  key: string;
  merchantName: string;
  merchantCity: string;
  description: string;
  txid: string;
  savedPayload: string | null;
  savedQrCodeDataUrl: string | null;
}

function readStringField(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  return typeof value === "string" ? value.trim() : "";
}

export function parsePixPaymentOption(row: Record<string, unknown> | null | undefined): PixPaymentOption | null {
  if (!row) return null;

  const enabled = row.pix_payment_enabled === true;
  const key = readStringField(row, "pix_key");
  if (!enabled || !key) return null;

  return {
    key,
    merchantName: readStringField(row, "pix_merchant_name") || "Shad Manager",
    merchantCity: readStringField(row, "pix_merchant_city") || "Sao Paulo",
    description: readStringField(row, "pix_description"),
    txid: readStringField(row, "pix_txid") || "SHADMENSAL",
    savedPayload: readStringField(row, "pix_saved_payload") || null,
    savedQrCodeDataUrl: readStringField(row, "pix_saved_qr_image_data_url") || null,
  };
}

function formatAmountFromCents(valueCents: number): string {
  return (valueCents / 100).toFixed(2);
}

export function buildPixPayloadFromOption(
  option: PixPaymentOption,
  amountCents?: number | null
): string {
  const safeAmountCents =
    Number.isFinite(amountCents) && Number(amountCents) > 0 ? Math.round(Number(amountCents)) : null;

  return buildPixPayload({
    key: option.key,
    merchantName: option.merchantName,
    merchantCity: option.merchantCity,
    description: option.description,
    txid: option.txid,
    amount: safeAmountCents ? formatAmountFromCents(safeAmountCents) : undefined,
  });
}

export async function buildPixQrCodeDataUrl(payload: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(payload, {
    width: 512,
    margin: 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#111111",
      light: "#FFFFFF",
    },
  });
}
