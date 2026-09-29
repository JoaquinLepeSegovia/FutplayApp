import { NextResponse } from "next/server";
import { getGoogleRedirectUri, isAllowedGoogleRedirectUri } from "@/lib/google-oauth";

export async function POST(request: Request) {
  const { code, redirectUri } = await request.json();

  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  // No confiamos en el redirect_uri del cliente: debe coincidir exactamente
  // con el canónico, o Google responde 400 redirect_uri_mismatch.
  if (!isAllowedGoogleRedirectUri(redirectUri, request)) {
    return NextResponse.json({ error: "Invalid redirect_uri" }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenResponse.json();

  if (!tokenResponse.ok) {
    console.error("Google token exchange error:", tokens);
    return NextResponse.json({ error: "Failed to exchange code" }, { status: 400 });
  }

  return NextResponse.json({ idToken: tokens.id_token });
}
