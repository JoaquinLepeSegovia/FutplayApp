import { createClient } from "@/utils/supabase/client";
import { ahoraChile, membresiaActiva, fechaVencimientoDesde } from "@/lib/fechas";

type PlanRow = {
    id: string;
    nombre: string;
    tokens_mensuales: number;
    precio: number;
    dias: number;
    tipo_plan?: "normal" | "familiar" | "kids";
};

type MembresiaRow = {
    id: string;
    usuario_id: string;
    plan_id: string;
    boleta_id?: string;
    tokens_totales: number;
    tokens_usados: number;
    fecha_inicio: string;
    fecha_vencimiento: string;
    estado: boolean;
    congelada: boolean;
    sin_tokens?: boolean;
    fecha_congelamiento?: string | null;
};

export type MembresiaConPlan = {
    membresia_id: string;
    usuario_id: string;
    plan_id: string;
    plan_nombre: string;
    tokens_mensuales: number;
    precio: number;
    dias?: number;
    tipo_plan?: "normal" | "familiar" | "kids";
    tokens_totales: number;
    tokens_usados: number;
    tokens_restantes: number;
    fecha_inicio: string;
    fecha_vencimiento: string;
    estado: boolean;
    congelada: boolean;
    sin_tokens: boolean;
    fecha_congelamiento?: string | null;
};

export async function userHasMembresia(userId: string): Promise<boolean> {
    const supabase = createClient();

    const ahoraIso = ahoraChile().toISOString();

    // sin_tokens=true cuenta como "sin plan": el trigger ya cerró la membresía al
    // agotar el saldo y el alumno debe poder comprar el plan siguiente.
    const { data, error } = await supabase
        .from("membresia")
        .select("id")
        .eq("usuario_id", userId)
        .eq("estado", true)
        .eq("congelada", false)
        .eq("sin_tokens", false)
        .lte("fecha_inicio", ahoraIso)
        .gte("fecha_vencimiento", ahoraIso)
        .order("fecha_vencimiento", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("Error fetching membresia:", error.message);
        return false;
    }

    return data != null;
}

async function getPlanById(planId: string): Promise<PlanRow | null> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from("plan")
        .select("*")
        .eq("id", planId)
        .single();

    if (error) {
        console.error("Error fetching plan:", error.message);
        return null;
    }

    return data as PlanRow;
}

function buildMembresiaConPlan(m: MembresiaRow, plan: PlanRow | null): MembresiaConPlan {
    const sinTokens = m.sin_tokens === true;
    const activa =
        m.estado === true &&
        !sinTokens &&
        !m.congelada &&
        membresiaActiva(m.fecha_vencimiento);
    const tokensUsados = activa ? m.tokens_usados : m.tokens_totales;
    const restantes = activa ? m.tokens_totales - m.tokens_usados : 0;
    return {
        membresia_id: m.id,
        usuario_id: m.usuario_id,
        plan_id: m.plan_id,
        plan_nombre: plan?.nombre || "Sin plan",
        tokens_mensuales: plan?.tokens_mensuales || 0,
        precio: plan?.precio || 0,
        dias: plan?.dias,
        tipo_plan: plan?.tipo_plan,
        tokens_totales: m.tokens_totales,
        tokens_usados: tokensUsados,
        tokens_restantes: restantes,
        fecha_inicio: m.fecha_inicio,
        fecha_vencimiento: m.fecha_vencimiento,
        estado: m.estado,
        congelada: m.congelada === true,
        sin_tokens: sinTokens,
        fecha_congelamiento: m.fecha_congelamiento ?? null,
    };
}

export async function getMembresiaByUser(userId: string): Promise<MembresiaConPlan | null> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from("membresia")
        .select("*")
        .eq("usuario_id", userId)

        .order("fecha_inicio", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("Error fetching membresia:", error.message);
        return null;
    }

    if (!data) return null;

    const membresia = data as MembresiaRow;

    const plan = await getPlanById(membresia.plan_id);
    return buildMembresiaConPlan(membresia, plan);
}

export async function getAllMembresiasConPlan(): Promise<MembresiaConPlan[]> {
    const supabase = createClient();

    const { data: membresias, error } = await supabase
        .from("membresia")
        .select("*")

        .order("usuario_id");

    if (error) {
        console.error("Error fetching all membresias:", error.message);
        return [];
    }

    if (membresias.length === 0) {
        return [];
    }

    const planIds = [...new Set((membresias || []).map((m) => m.plan_id))];

    const { data: planes } = await supabase
        .from("plan")
        .select("*")
        .in("id", planIds);

    const planesMap = new Map((planes || []).map((p) => [p.id, p as PlanRow]));

    const resultMap = new Map<string, MembresiaConPlan>();

    for (const item of membresias || []) {
        const m = item as MembresiaRow;
        const existing = resultMap.get(m.usuario_id);
        const plan = planesMap.get(m.plan_id) || null;
        const built = buildMembresiaConPlan(m, plan);

        if (!existing || built.tokens_restantes > existing.tokens_restantes) {
            resultMap.set(m.usuario_id, built);
        }
    }

    return Array.from(resultMap.values());
}

export async function getAdminMembresias(): Promise<MembresiaConPlan[]> {
    try {
        const res = await fetch("/api/admin/membresias");
        if (!res.ok) {
            const body = await res.json();
            console.error("Error fetching admin membresias:", body.error);
            return [];
        }
        return await res.json();
    } catch (err) {
        console.error("Error calling admin membresias API:", err);
        return [];
    }
}

export async function createMembresia(
    userId: string,
    planId: string,
    tokensMensuales: number,
    dias: number,
    boletaId?: string
): Promise<boolean> {
    const supabase = createClient();

    const fecha_inicio = ahoraChile().toISOString();
    const fecha_vencimiento = fechaVencimientoDesde(fecha_inicio, dias).toISOString();

    const { error } = await supabase
        .from("membresia")
        .insert({
            usuario_id: userId,
            plan_id: planId,
            boleta_id: boletaId,
            fecha_inicio,
            fecha_vencimiento,
            tokens_totales: tokensMensuales,
            tokens_usados: 0,
            estado: true,
        });

    if (error) {
        console.error("Error creating membresia:", error.message);
        return false;
    }

    return true;
}

export async function devolverToken(userId: string): Promise<boolean> {
    const supabase = createClient();

    const { data: membresia } = await supabase
        .from("membresia")
        .select("id, tokens_usados")
        .eq("usuario_id", userId)

        .order("fecha_inicio", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!membresia || membresia.tokens_usados <= 0) return false;

    const { error } = await supabase
        .from("membresia")
        .update({ tokens_usados: membresia.tokens_usados - 1 })
        .eq("id", membresia.id);

    return !error;
}

// Type for admin gestion view
export type MembresiaGestion = {
  id: string;
  usuario_id: string;
  usuario_nombre: string;
  plan_id: string;
  plan_nombre: string;
  boleta_id?: string;
  tokens_totales: number;
  tokens_usados: number;
  fecha_inicio: string;
  fecha_vencimiento: string;
  estado: boolean;
  congelada: boolean;
  sin_tokens: boolean;
  fecha_congelamiento?: string | null;
};

type AccionCongelar = {
  ok: boolean;
  error?: string;
  fecha_vencimiento?: string;
};

export async function congelarMembresia(id: string): Promise<AccionCongelar> {
  try {
    const res = await fetch("/api/admin/membresias/freeze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membreciaId: id, accion: "congelar" }),
    });

    const body = await res.json();
    if (!res.ok) return { ok: false, error: body?.error || "Error al congelar la membresía" };
    return { ok: true };
  } catch (err) {
    console.error("Error calling congelar membresia API:", err);
    return { ok: false, error: "Error de red al congelar la membresía" };
  }
}

export async function reactivarMembresia(id: string): Promise<AccionCongelar> {
  try {
    const res = await fetch("/api/admin/membresias/freeze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membreciaId: id, accion: "reactivar" }),
    });

    const body = await res.json();
    if (!res.ok) return { ok: false, error: body?.error || "Error al reactivar la membresía" };
    return { ok: true, fecha_vencimiento: body?.fecha_vencimiento };
  } catch (err) {
    console.error("Error calling reactivar membresia API:", err);
    return { ok: false, error: "Error de red al reactivar la membresía" };
  }
}

export async function getMembresiasGestion(): Promise<MembresiaGestion[]> {
  try {
    const res = await fetch("/api/admin/membresias/gestion", { cache: "no-store" });
    if (!res.ok) {
      const body = await res.json();
      console.error("Error fetching membresias gestion:", body.error);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.error("Error calling admin membresias gestion API:", err);
    return [];
  }
}

export async function createMembresiaGestion(data: {
  usuario_id: string;
  plan_id: string;
  boleta_id?: string | null;
  tokens_totales: number;
  dias: number;
}): Promise<boolean> {
  try {
    const fecha_inicio = ahoraChile().toISOString();
    const fecha_vencimiento = fechaVencimientoDesde(fecha_inicio, data.dias).toISOString();

    const res = await fetch("/api/admin/membresias/gestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario_id: data.usuario_id,
        plan_id: data.plan_id,
        boleta_id: data.boleta_id ?? null,
        tokens_totales: data.tokens_totales,
        tokens_usados: 0,
        fecha_inicio,
        fecha_vencimiento,
        estado: true,
      }),
    });

    if (!res.ok) {
      const body = await res.json();
      console.error("Error creating membresia gestion:", body.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Error calling create membresia gestion API:", err);
    return false;
  }
}

export async function updateMembresiaGestion(
  id: string,
  data: Partial<{
    usuario_id: string;
    plan_id: string;
    boleta_id: string | null;
    tokens_totales: number;
    tokens_usados: number;
    fecha_inicio: string;
    fecha_vencimiento: string;
    estado: boolean;
  }>
): Promise<boolean> {
  try {
    const payload = { ...data, id };
    if (payload.boleta_id !== undefined) {
      payload.boleta_id = payload.boleta_id?.trim() ? payload.boleta_id : null;
    }
    const res = await fetch("/api/admin/membresias/gestion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return false;
    return true;
  } catch (err) {
    console.error("Error calling update membresia gestion API:", err);
    return false;
  }
}

export async function deleteMembresiaGestion(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin/membresias/gestion?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    if (!res.ok) return false;
    return true;
  } catch (err) {
    console.error("Error calling delete membresia gestion API:", err);
    return false;
  }
}
