"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { getGoogleRedirectUri } from "@/lib/google-oauth";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const router = useRouter();
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    const fallback = setTimeout(() => {
      window.location.href = "/login?error=timeout";
    }, 15000);

    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const error = params.get("error");
      const state = params.get("state");

      if (error || !code) {
        clearTimeout(fallback);
        window.location.href = "/login?error=auth";
        return;
      }

      const savedState = localStorage.getItem("oauth_state");
      localStorage.removeItem("oauth_state");
      if (!savedState || state !== savedState) {
        clearTimeout(fallback);
        window.location.href = "/login?error=csrf";
        return;
      }

      try {
        const redirectUri = getGoogleRedirectUri();

        const res = await fetch("/api/auth/google/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, redirectUri }),
        });

        if (!res.ok) {
          throw new Error("Token exchange failed");
        }

        const { idToken } = await res.json();

        const supabase = createClient();
        const { error: signInError } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: idToken,
        });

        if (signInError) {
          console.error("Supabase signInWithIdToken error:", signInError.message);
          clearTimeout(fallback);
          window.location.href = "/login?error=auth";
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          clearTimeout(fallback);
          window.location.href = "/login?error=session";
          return;
        }

        let { data: usuario } = await supabase
          .from("usuario")
          .select("rol")
          .eq("id", user.id)
          .single();

        // Si no se encontró por id (el auth.users ID puede diferir del
        // registrado en usuario para cuentas Google Workspace), buscar
        // por email mediante API route con service role.
        if (!usuario && user.email) {
          try {
            const linkRes = await fetch("/api/auth/link-usuario", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: user.email,
                id: user.id,
                nombre: user.user_metadata?.full_name || undefined,
              }),
            });
            if (linkRes.ok) {
              const linkData = await linkRes.json();
              usuario = linkData.usuario;
            }
          } catch {
            // fallback a /home
          }
        }

        clearTimeout(fallback);
        const role = usuario?.rol;
        if (role === "administrador") {
          window.location.href = "/admin";
        } else if (role === "profesor") {
          window.location.href = "/profesor";
        } else if (role === "jugador") {
          window.location.href = "/dashboard";
        } else {
          window.location.href = "/home";
        }
      } catch (e) {
        console.error("Auth callback error:", e);
        clearTimeout(fallback);
        window.location.href = "/login?error=auth";
      }
    };

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-[#f59e0b]" />
        <p className="text-gray-400 text-sm">Iniciando sesión...</p>
      </div>
    </div>
  );
}