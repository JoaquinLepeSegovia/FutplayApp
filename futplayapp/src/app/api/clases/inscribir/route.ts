import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const TRIGGER_ERROR_MESSAGES: Record<string, string> = {
    "No tienes membresía activa": "No tienes una membresía activa para agendar esta clase",
    "No tienes tokens disponibles": "No tienes tokens disponibles para agendar esta clase",
    "Clase llena": "Esta clase ya está llena",
};

function traducirErrorInscripcion(message: string): string {
    return TRIGGER_ERROR_MESSAGES[message] ?? message;
}

export async function POST(request: Request) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return cookieStore.getAll(); },
                setAll() { },
            },
        }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { claseId } = await request.json();
    if (!claseId) {
        return NextResponse.json({ error: "claseId es requerido" }, { status: 400 });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
        return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
    }

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey
    );

    // Verificar cupo máximo y tipo de evento (service_role evita el filtro RLS
    // que solo dejaría ver al usuario sus propias inscripciones)
    const { data: clase } = await admin
        .from("clase")
        .select("cupo_maximo, tipo_evento")
        .eq("id", claseId)
        .single();

    if (!clase) {
        return NextResponse.json({ error: "Clase no encontrada" }, { status: 404 });
    }

    const { count } = await admin
        .from("clase_usuario")
        .select("*", { count: "exact", head: true })
        .eq("clase_id", claseId)
        .not("asistencia", "in", "('cancelado','cancelado_sin_reembolso')");

    if (count != null && count >= (clase.cupo_maximo ?? 15)) {
        return NextResponse.json({ error: "Esta clase ya está llena" }, { status: 400 });
    }

// Validar compatibilidad del plan del usuario con el tipo de clase.
    // Se usa la membresía ACTIVA por vigencia (misma regla del trigger
    // manejar_inscripcion_clase(): estado=true y fechas vigentes).
    const ahoraIso = new Date().toISOString();
    const { data: tipoPlanRow } = await supabase
        .from("membresia")
        .select("plan!inner(tipo_plan)")
        .eq("usuario_id", user.id)
        .or(`estado.eq.true,sin_tokens.eq.true`)
        .lte("fecha_inicio", ahoraIso)
        .gte("fecha_vencimiento", ahoraIso)
        .order("fecha_vencimiento", { ascending: false })
        .limit(1)
        .maybeSingle();

    const tipoPlan = (tipoPlanRow as unknown as { plan: { tipo_plan: "normal" | "familiar" | "kids" } } | null)?.plan?.tipo_plan ?? "normal";

    if (tipoPlan === "kids" && clase.tipo_evento !== "kids") {
        return NextResponse.json(
            { error: "Tu plan Kids solo permite reservar clases Kids" },
            { status: 403 },
        );
    }
    if (tipoPlan === "normal" && clase.tipo_evento === "kids") {
        return NextResponse.json(
            { error: "Esa clase es exclusiva para el plan Kids" },
            { status: 403 },
        );
    }

    // Re-inscripción: si el usuario ya tenía una inscripción cancelada para esta
    // clase, se elimina y se inserta una nueva (nuevo id) para que el scheduler
    // re-envíe los recordatorios. El trigger manejar_inscripcion_clase() valida
    // membresía vigente y descuenta token en el INSERT (kids/entrenamiento; el
    // partido no descuenta).
    const { data: existing } = await admin
        .from("clase_usuario")
        .select("id, asistencia")
        .eq("usuario_id", user.id)
        .eq("clase_id", claseId)
        .maybeSingle();

    if (existing && (existing.asistencia === "cancelado" || existing.asistencia === "cancelado_sin_reembolso")) {
        await admin.from("clase_usuario").delete().eq("id", existing.id);

        const { data, error } = await supabase
            .from("clase_usuario")
            .insert({ usuario_id: user.id, clase_id: claseId })
            .select("id")
            .single();

        if (error) {
            return NextResponse.json({ error: traducirErrorInscripcion(error.message) }, { status: 400 });
        }

        return NextResponse.json({ inscripcionId: data.id });
    }

    // Primera inscripción: el trigger descontará el token (si no es partido)
    const { data, error } = await supabase
        .from("clase_usuario")
        .insert({ usuario_id: user.id, clase_id: claseId })
        .select("id")
        .single();

    if (error) {
        if (error.code === "23505") {
            return NextResponse.json({ error: "Ya estás inscrito en esta clase" }, { status: 409 });
        }
        return NextResponse.json({ error: traducirErrorInscripcion(error.message) }, { status: 400 });
    }

    return NextResponse.json({ inscripcionId: data.id });
}
