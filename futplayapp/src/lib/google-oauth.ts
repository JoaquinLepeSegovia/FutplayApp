// Redirect URI canónico del flujo OAuth de Google.
//
// Google exige coincidencia EXACTA (esquema + host + puerto + path) contra
// los "Authorized redirect URIs" del OAuth Client en Google Cloud Console.
// Derivarlo de `window.location.origin` rompe en cuanto el usuario entra por
// un host no registrado (preview de Vercel, www, IP, etc.) y Google responde
// 400 redirect_uri_mismatch. Por eso el valor es fijo y configurable.
import { getBaseUrl } from "@/lib/base-url";

export const GOOGLE_CALLBACK_PATH = "/auth/callback";

const LOCAL_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

function stripTrailingSlash(value: string): string {
    return value.replace(/\/+$/, "");
}

// En desarrollo el redirect URI puede vivir en localhost, que no debe quedar
// bloqueado por el valor canónico de producción.
function getLocalDevOrigin(): string | null {
    if (typeof window === "undefined") return null;
    const { hostname, origin } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
        return origin;
    }
    return null;
}

export function getGoogleRedirectUri(request?: Request): string {
    const devOrigin = getLocalDevOrigin();
    if (devOrigin) {
        return `${devOrigin}${GOOGLE_CALLBACK_PATH}`;
    }
    const envUri = process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI?.trim();
    if (envUri) {
        return stripTrailingSlash(envUri);
    }
    return `${getBaseUrl(request)}${GOOGLE_CALLBACK_PATH}`;
}

// Allowlist de redirect URIs aceptados por /api/auth/google/exchange: el
// cliente no puede elegir un destino arbitrario para el authorization code.
export function isAllowedGoogleRedirectUri(
    candidate: unknown,
    request?: Request
): boolean {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
        return false;
    }

    const normalized = stripTrailingSlash(candidate.trim());
    const allowed = new Set<string>([
        getGoogleRedirectUri(request),
        ...LOCAL_DEV_ORIGINS.map((origin) => `${origin}${GOOGLE_CALLBACK_PATH}`),
    ]);

    return allowed.has(normalized);
}
