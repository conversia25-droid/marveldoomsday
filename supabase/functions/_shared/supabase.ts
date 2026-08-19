import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function firstJsonSecret(envName: string): string {
  const raw = Deno.env.get(envName);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.default || Object.values(parsed)[0] || "";
  } catch {
    return "";
  }
}

function requiredEnv(name: string, fallback = ""): string {
  const value = Deno.env.get(name) || fallback;
  if (!value) throw new Error(`${name} nao configurado`);
  return value;
}

export function getSupabaseUrl() {
  return requiredEnv("SUPABASE_URL");
}

export function getAnonKey() {
  return requiredEnv("SUPABASE_ANON_KEY", firstJsonSecret("SUPABASE_PUBLISHABLE_KEYS"));
}

export function getServiceKey() {
  return requiredEnv("SUPABASE_SERVICE_ROLE_KEY", firstJsonSecret("SUPABASE_SECRET_KEYS"));
}

export function createAdminClient() {
  return createClient(getSupabaseUrl(), getServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    throw new Error("Usuario nao autenticado");
  }

  const client = createClient(getSupabaseUrl(), getAnonKey(), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Usuario nao autenticado");
  return data.user;
}
