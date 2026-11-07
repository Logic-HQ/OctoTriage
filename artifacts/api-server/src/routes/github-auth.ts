import { Router, type IRouter } from "express";
import {
  ExchangeGitHubOAuthCodeBody,
  ExchangeGitHubOAuthCodeResponse,
  GetGitHubOAuthConfigResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/auth/github/config", (_req, res): void => {
  const clientId = process.env.GITHUB_CLIENT_ID;

  if (!clientId) {
    res.status(503).json({ error: "GitHub OAuth is not configured." });
    return;
  }

  res.json(GetGitHubOAuthConfigResponse.parse({ clientId }));
});

router.post("/auth/github/exchange", async (req, res): Promise<void> => {
  const parsed = ExchangeGitHubOAuthCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid OAuth code and redirect URI are required." });
    return;
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: "GitHub OAuth is not configured." });
    return;
  }

  const origin = req.get("Origin");
  let redirectUri: URL;
  try {
    redirectUri = new URL(parsed.data.redirectUri);
  } catch {
    res.status(400).json({ error: "Invalid redirect URI." });
    return;
  }

  if (
    !origin ||
    redirectUri.origin !== origin ||
    redirectUri.pathname !== "/" ||
    redirectUri.search ||
    redirectUri.hash
  ) {
    res.status(400).json({ error: "The OAuth redirect URI must match this app." });
    return;
  }

  const allowedHosts = new Set(
    [
      process.env.SIGNED_DEV_DOMAIN,
      ...(process.env.SIGNED_DOMAINS ?? "").split(","),
      "localhost",
      "127.0.0.1",
    ]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );

  const isLocalHost = ["localhost", "127.0.0.1"].includes(
    redirectUri.hostname.toLowerCase(),
  );
  if (
    !allowedHosts.has(redirectUri.hostname.toLowerCase()) ||
    (!isLocalHost && redirectUri.protocol !== "https:")
  ) {
    res.status(400).json({ error: "This app domain is not allowed for OAuth." });
    return;
  }

  const githubResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: parsed.data.code,
      redirect_uri: parsed.data.redirectUri,
    }),
  });

  if (!githubResponse.ok) {
    req.log.warn(
      { status: githubResponse.status },
      "GitHub OAuth code exchange failed",
    );
    res.status(400).json({ error: "GitHub could not verify this sign-in code." });
    return;
  }

  const tokenPayload: unknown = await githubResponse.json();
  if (
    typeof tokenPayload !== "object" ||
    tokenPayload === null ||
    !("access_token" in tokenPayload) ||
    typeof tokenPayload.access_token !== "string" ||
    !tokenPayload.access_token ||
    !("token_type" in tokenPayload) ||
    typeof tokenPayload.token_type !== "string"
  ) {
    req.log.warn("GitHub returned an invalid OAuth token response");
    res.status(400).json({ error: "GitHub returned an invalid sign-in response." });
    return;
  }

  const result = ExchangeGitHubOAuthCodeResponse.parse({
    accessToken: tokenPayload.access_token,
    tokenType: tokenPayload.token_type,
    scope:
      "scope" in tokenPayload && typeof tokenPayload.scope === "string"
        ? tokenPayload.scope
        : "",
  });

  res.json(result);
});

export default router;
