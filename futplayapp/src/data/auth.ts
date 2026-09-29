import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import { getGoogleRedirectUri } from "@/lib/google-oauth";

export type Rol = "jugador" | "profesor" | "administrador";

export interface Usuario {
    id: string;
    nombre: string;
    rol: Rol;
    email?: string;
}

export async function getCurrentUser(): Promise<{ user: User | null; error: string | null }> {
    const supabase = createClient();
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        return { user, error: error?.message ?? null };
    } catch {
        return { user: null, error: "Error inesperado al obtener usuario" };
    }
}

export async function getUsuario(userId: string): Promise<Usuario | null> {
    const supabase = createClient();
    try {
        const { data, error } = await supabase
            .from("usuario")
            .select("id, nombre, rol")
            .eq("id", userId)
            .single();

        if (error) {
            console.error("Error al obtener usuario:", error.message);
            return null;
        }

        return data as Usuario;
    } catch {
        console.error("Error inesperado al obtener usuario");
        return null;
    }
}

export async function signOut(): Promise<void> {
    const supabase = createClient();
    await supabase.auth.signOut();
}

export async function signInWithGoogle(): Promise<{ error: string | null }> {
    try {
        const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!;
        const redirectUri = getGoogleRedirectUri();

        const state = crypto.randomUUID();
        localStorage.setItem("oauth_state", state);

        // Verificación de dominio: Google sólo acepta el redirect_uri exacto
        // registrado en el OAuth Client. Sin este chequeo, entrar por un host
        // alterno (preview de Vercel, www, IP) provoca 400 redirect_uri_mismatch.
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: "openid email profile",
            state,
        });

        window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
        return { error: null };
    } catch {
        return { error: "Error al iniciar sesión con Google" };
    }
}

export async function buscarUsuarioPorTelefono(
    telefono: string
): Promise<{ id: string; nombre: string; rol: Rol } | null> {
    const supabase = createClient();

    const { data } = await supabase
        .from("usuario")
        .select("id, nombre, rol")
        .or(`telefono.eq.${telefono},telefono.eq.+${telefono}`)
        .maybeSingle();

    return data as { id: string; nombre: string; rol: Rol } | null;
}

export function onAuthStateChange(
    callback: (user: User | null) => void
): { unsubscribe: () => void } {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
        callback(session?.user ?? null);
    });

    return { unsubscribe: () => subscription.unsubscribe() };
}
