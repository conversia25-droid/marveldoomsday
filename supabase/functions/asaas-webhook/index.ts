import { optionsResponse, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { paidByPix, refundedPayment } from "../_shared/asaas.ts";

type PurchaseRow = {
  id: string;
  user_id: string;
  status: string | null;
};

function webhookToken() {
  const token = Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "";
  if (!token) throw new Error("ASAAS_WEBHOOK_TOKEN nao configurado");
  return token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return jsonResponse({ error: "Metodo nao permitido" }, 405);

  try {
    const expectedToken = webhookToken();
    const receivedToken = req.headers.get("asaas-access-token") || req.headers.get("asaas_access_token") || "";
    if (receivedToken !== expectedToken) return jsonResponse({ error: "Token invalido" }, 401);

    const payload = await req.json();
    const eventId = payload.id || crypto.randomUUID();
    const eventName = String(payload.event || "");
    const payment = payload.payment || {};
    const paymentId = payment.id || null;
    const externalReference = payment.externalReference || null;
    const status = String(payment.status || (eventName.startsWith("PAYMENT_") ? eventName.replace("PAYMENT_", "") : "UNKNOWN"));

    const admin = createAdminClient();
    const { error: eventError } = await admin.from("payment_events").insert({
      id: eventId,
      provider: "asaas",
      event_name: eventName || "UNKNOWN",
      provider_payment_id: paymentId,
      payload,
    });
    if (eventError?.code === "23505") return jsonResponse({ ok: true, duplicate: true });
    if (eventError) throw eventError;

    if (!paymentId && !externalReference) {
      await admin.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("id", eventId);
      return jsonResponse({ ok: true, ignored: true });
    }

    let query = admin.from("purchases").select("id,user_id,status").limit(1);
    query = paymentId ? query.eq("provider_payment_id", paymentId) : query.eq("external_reference", externalReference);
    const { data: rows, error: purchaseError } = await query.returns<PurchaseRow[]>();
    if (purchaseError) throw purchaseError;

    const purchase = rows?.[0];
    if (!purchase) {
      await admin.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("id", eventId);
      return jsonResponse({ ok: true, ignored: true });
    }

    const paid = paidByPix(status, eventName);
    const refunded = refundedPayment(status, eventName);
    const keepPaidStatus = purchase.status === "RECEIVED" && !paid && !refunded;
    const paymentUpdate: Record<string, unknown> = {
      status: keepPaidStatus ? purchase.status : status,
      net_amount: typeof payment.netValue === "number" ? payment.netValue : null,
      raw_payment: payment,
    };

    if (paid) paymentUpdate.paid_at = new Date().toISOString();
    if (refunded) paymentUpdate.paid_at = null;

    await admin.from("purchases").update(paymentUpdate).eq("id", purchase.id);

    if (paid) {
      await admin.from("profiles").update({
        premium_lifetime: true,
        premium_since: new Date().toISOString(),
        premium_source: "asaas_pix",
      }).eq("id", purchase.user_id);
    }

    if (refunded) {
      const { data: paidPurchases } = await admin
        .from("purchases")
        .select("id")
        .eq("user_id", purchase.user_id)
        .eq("status", "RECEIVED")
        .neq("id", purchase.id)
        .limit(1);

      if (!paidPurchases?.length) {
        await admin.from("profiles").update({
          premium_lifetime: false,
          premium_since: null,
          premium_source: null,
        }).eq("id", purchase.user_id);
      }
    }

    await admin.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("id", eventId);
    return jsonResponse({ ok: true, paid, refunded });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Erro ao processar webhook.";
    return jsonResponse({ error: message }, 500);
  }
});
