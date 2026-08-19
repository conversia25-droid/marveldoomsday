export const LIFETIME_AMOUNT = 9.99;
export const PRODUCT_DESCRIPTION = "Acesso vitalicio Rota Doomsday";

function asaasApiKey() {
  const key = Deno.env.get("ASAAS_API_KEY") || "";
  if (!key) throw new Error("ASAAS_API_KEY nao configurada");
  return key;
}

export function asaasBaseUrl() {
  const env = (Deno.env.get("ASAAS_ENV") || "").toLowerCase();
  if (env === "production" || env === "prod") return "https://api.asaas.com/v3";
  if (env === "sandbox" || env === "hmlg" || env === "homologacao") return "https://api-sandbox.asaas.com/v3";

  return asaasApiKey().includes("_prod_")
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
}

function asaasErrorMessage(body: unknown) {
  if (body && typeof body === "object" && "errors" in body && Array.isArray((body as { errors: unknown[] }).errors)) {
    return (body as { errors: Array<{ description?: string; code?: string }> }).errors
      .map((error) => error.description || error.code)
      .filter(Boolean)
      .join("; ");
  }
  if (body && typeof body === "object" && "message" in body) return String((body as { message: unknown }).message);
  return "";
}

export async function asaasRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${asaasBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "RotaDoomsday/1.0 (Supabase Edge Function)",
      "access_token": asaasApiKey(),
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = asaasErrorMessage(body) || `Asaas retornou HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function paidByPix(status: string, eventName = "") {
  return status === "RECEIVED" || eventName === "PAYMENT_RECEIVED";
}

export function refundedPayment(status: string, eventName = "") {
  return status === "REFUNDED" || eventName === "PAYMENT_REFUNDED";
}
