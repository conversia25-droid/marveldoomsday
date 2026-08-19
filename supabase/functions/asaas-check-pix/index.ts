import { optionsResponse, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient, requireUser } from "../_shared/supabase.ts";
import { asaasRequest, paidByPix, refundedPayment } from "../_shared/asaas.ts";

type PurchaseRow = {
  id: string;
  user_id: string;
  provider_payment_id: string | null;
};

type AsaasPayment = {
  id: string;
  status?: string;
  value?: number;
  netValue?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Metodo nao permitido" }, 405);

  try {
    const user = await requireUser(req);
    const { purchaseId } = await req.json().catch(() => ({}));
    if (!purchaseId) return jsonResponse({ error: "Compra nao informada." }, 400);

    const admin = createAdminClient();
    const { data: purchase, error: purchaseError } = await admin
      .from("purchases")
      .select("id,user_id,provider_payment_id")
      .eq("id", purchaseId)
      .eq("user_id", user.id)
      .maybeSingle<PurchaseRow>();

    if (purchaseError) throw purchaseError;
    if (!purchase || !purchase.provider_payment_id) {
      return jsonResponse({ error: "Compra nao encontrada." }, 404);
    }

    const payment = await asaasRequest<AsaasPayment>(`/payments/${purchase.provider_payment_id}`);
    const status = payment.status || "PENDING";
    const paid = paidByPix(status);
    const refunded = refundedPayment(status);

    await admin.from("purchases").update({
      status,
      net_amount: payment.netValue || null,
      paid_at: paid ? new Date().toISOString() : null,
      raw_payment: payment,
    }).eq("id", purchase.id);

    if (paid) {
      await admin.from("profiles").update({
        premium_lifetime: true,
        premium_since: new Date().toISOString(),
        premium_source: "asaas_pix",
      }).eq("id", user.id);
    }

    if (refunded) {
      const { data: paidPurchases } = await admin
        .from("purchases")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "RECEIVED")
        .neq("id", purchase.id)
        .limit(1);

      if (!paidPurchases?.length) {
        await admin.from("profiles").update({
          premium_lifetime: false,
          premium_since: null,
          premium_source: null,
        }).eq("id", user.id);
      }
    }

    return jsonResponse({ paid, refunded, premium: paid, status });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Nao foi possivel verificar o Pix.";
    const status = message.includes("autenticado") ? 401 : 500;
    return jsonResponse({ error: message }, status);
  }
});
