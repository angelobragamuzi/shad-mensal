export interface PixPayloadInput {
  key: string;
  merchantName: string;
  merchantCity: string;
  amount?: string;
  description?: string;
  txid?: string;
}

function removeDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanUpperAscii(value: string): string {
  return removeDiacritics(value).toUpperCase();
}

function sanitizeMerchantName(value: string): string {
  const cleaned = cleanUpperAscii(value).replace(/[^A-Z0-9 ]/g, "");
  const normalized = normalizeSpaces(cleaned);
  return normalized.slice(0, 25) || "RECEBEDOR";
}

function sanitizeMerchantCity(value: string): string {
  const cleaned = cleanUpperAscii(value).replace(/[^A-Z0-9 ]/g, "");
  const normalized = normalizeSpaces(cleaned);
  return normalized.slice(0, 15) || "SAO PAULO";
}

function sanitizeDescription(value: string): string {
  const cleaned = removeDiacritics(value).replace(/[|]/g, "").trim();
  return cleaned.slice(0, 72);
}

function sanitizeTxid(value: string): string {
  const cleaned = cleanUpperAscii(value).replace(/[^A-Z0-9]/g, "");
  const normalized = cleaned.slice(0, 25);
  return normalized || "***";
}

function formatAmount(value?: string): string | null {
  if (!value) return null;
  const raw = value.replace(",", ".").trim();
  if (!raw) return null;

  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error("Valor PIX inválido. Use apenas números com até 2 casas decimais.");
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Valor PIX inválido.");
  }

  if (parsed > 999999999.99) {
    throw new Error("Valor PIX excede o limite permitido.");
  }

  return parsed.toFixed(2);
}

function tlv(id: string, value: string): string {
  const length = String(value.length).padStart(2, "0");
  return `${id}${length}${value}`;
}

function crc16Ccitt(payload: string): string {
  let crc = 0xffff;

  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;

    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildPixPayload(input: PixPayloadInput): string {
  const key = input.key.trim();
  if (key.length < 3 || key.length > 77) {
    throw new Error("Chave PIX inválida.");
  }

  const merchantName = sanitizeMerchantName(input.merchantName);
  const merchantCity = sanitizeMerchantCity(input.merchantCity);
  const txid = sanitizeTxid(input.txid ?? "");
  const amount = formatAmount(input.amount);
  const description = sanitizeDescription(input.description ?? "");

  const merchantAccountInfo =
    tlv("00", "BR.GOV.BCB.PIX") +
    tlv("01", key) +
    (description ? tlv("02", description) : "");

  let payload =
    tlv("00", "01") +
    tlv("26", merchantAccountInfo) +
    tlv("52", "0000") +
    tlv("53", "986");

  if (amount) {
    payload += tlv("54", amount);
  }

  payload +=
    tlv("58", "BR") +
    tlv("59", merchantName) +
    tlv("60", merchantCity) +
    tlv("62", tlv("05", txid));

  const payloadWithCrc = `${payload}6304`;
  return `${payloadWithCrc}${crc16Ccitt(payloadWithCrc)}`;
}
