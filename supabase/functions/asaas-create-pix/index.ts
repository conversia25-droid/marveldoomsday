import { optionsResponse, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient, requireUser } from "../_shared/supabase.ts";
import { asaasRequest, LIFETIME_AMOUNT, PRODUCT_DESCRIPTION } from "../_shared/asaas.ts";

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  asaas_customer_id: string | null;
  premium_lifetime: boolean | null;
};

type AsaasCustomer = { id: string };
type AsaasPayment = {
  id: string;
  status?: string;
  invoiceUrl?: string;
  value?: number;
  netValue?: number;
};
type AsaasPixQrCode = {
  encodedImage?: string;
  payload?: string;
  expirationDate?: string;
};

function onlyDigits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function cleanName(value: unknown, fallback: string) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
  return name || fallback;
}

function tomorrowDueDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Metodo nao permitido" }, 405);

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const cpfCnpj = onlyDigits(body.cpfCnpj || body.cpf_cnpj);
    if (![11, 14].includes(cpfCnpj.length)) {
      return jsonResponse({ error: "Informe um CPF ou CNPJ valido para gerar o Pix." }, 400);
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id,email,display_name,asaas_customer_id,premium_lifetime")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>();

    if (profile?.premium_lifetime) {
      return jsonResponse({ premium: true, message: "Acesso vitalicio ja ativo." });
    }

    const payerName = cleanName(
      body.payerName || body.name,
      profile?.display_name || user.user_metadata?.full_name || user.email || "Cliente Rota Doomsday",
    );
    const email = user.email || profile?.email || undefined;

    let customerId = profile?.asaas_customer_id || "";
    if (!customerId) {
      const customer = await asaasRequest<AsaasCustomer>("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: payerName,
          cpfCnpj,
          email,
          externalReference: user.id,
          notificationDisabled: true,
        }),
      });
      customerId = customer.id;

      await admin.from("profiles").upsert({
        id: user.id,
        email,
        display_name: profile?.display_name || payerName,
        asaas_customer_id: customerId,
      }, { onConflict: "id" });
    }

    const purchaseId = crypto.randomUUID();
    const { error: purchaseError } = await admin.from("purchases").insert({
      id: purchaseId,
      user_id: user.id,
      provider: "asaas",
      provider_customer_id: customerId,
      external_reference: purchaseId,
      status: "CREATING",
      amount: LIFETIME_AMOUNT,
      billing_type: "PIX",
    });
    if (purchaseError) throw purchaseError;

    const payment = await asaasRequest<AsaasPayment>("/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customerId,
        billingType: "PIX",
        value: LIFETIME_AMOUNT,
        dueDate: tomorrowDueDate(),
        description: PRODUCT_DESCRIPTION,
        externalReference: purchaseId,
      }),
    });

    const pix = await asaasRequest<AsaasPixQrCode>(`/payments/${payment.id}/pixQrCode`);

    await admin.from("purchases").update({
      provider_payment_id: payment.id,
      provider_customer_id: customerId,
      status: payment.status || "PENDING",
      invoice_url: payment.invoiceUrl || null,
      net_amount: payment.netValue || null,
      raw_payment: payment,
    }).eq("id", purchaseId);

    return jsonResponse({
      premium: false,
      purchase_id: purchaseId,
      payment_id: payment.id,
      status: payment.status || "PENDING",
      amount: LIFETIME_AMOUNT,
      invoice_url: payment.invoiceUrl || null,
      pix: {
        encodedImage: pix.encodedImage || "",
        payload: pix.payload || "",
        expirationDate: pix.expirationDate || "",
      },
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Nao foi possivel gerar o Pix.";
    const status = message.includes("autenticado") ? 401 : 500;
    return jsonResponse({ error: message }, status);
  }
});
