// Philips HomeID cloud auth + device/MQTT API.
// Ported to Node from github.com/renaudallard/homeassistant_philips_homeid
// (BSD-2-Clause, see NOTICE.md next to this file).

import { createHash, randomBytes } from "node:crypto";

const GIGYA_API_KEY = "4_JGZWlP8eQHpEqkvQElolbA";
const GIGYA_API_URL = "https://cdc.accounts.home.id";
const OIDC_ISSUER = `${GIGYA_API_URL}/oidc/op/v1.0/${GIGYA_API_KEY}`;
const OIDC_TOKEN_ENDPOINT = `${OIDC_ISSUER}/token`;
const OIDC_AUTH_ENDPOINT = `${OIDC_ISSUER}/authorize`;
const OAUTH_CLIENT_ID = "-u6aTznrxp9_9e_0a57CpvEG";
const MOBILE_APP_REDIRECT_URI = "com.philips.ka.oneka.app.prod://oauthredirect";
const OAUTH_SCOPES = [
  "openid profile email offline_access",
  "DI.Account.read DI.AccountProfile.read DI.AccountProfile.write",
  "DI.AccountGeneralConsent.read DI.AccountGeneralConsent.write",
  "DI.GeneralConsent.read DI.GeneralConsent.write",
  "VoiceProvider.read VoiceProvider.write",
  "subscriptions consent profile_extended",
  "DI.AccountSubscription.write DI.AccountSubscription.read",
].join(" ");

export const FUSION_TENANT = "da";
export const FUSION_MQTT_HOST = "ats.prod.eu-da.iot.versuni.com";
const PLATFORM_REST_URL = "prod.eu-da.iot.versuni.com";
const IOT_BASE = `https://${PLATFORM_REST_URL}/api/${FUSION_TENANT}`;

export class CloudError extends Error {}
export class CloudAuthError extends CloudError {}
export class CloudConnectionError extends CloudError {}

// fetch rejects with a bare TypeError on DNS/TLS/socket failures; give the CLI a
// typed error so it can tell "cloud unreachable" from "credentials rejected".
async function request(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new CloudConnectionError(
      `${new URL(url).host}: ${err.cause?.code ?? err.cause?.message ?? err.message}`,
    );
  }
}

function b64urlNoPad(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pkce() {
  const verifier = b64urlNoPad(randomBytes(64));
  const challenge = b64urlNoPad(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function postForm(url, body) {
  const params = new URLSearchParams(body).toString();
  return request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params,
  });
}

async function parseJson(resp, what) {
  const text = await resp.text();
  try {
    return { status: resp.status, data: JSON.parse(text), text };
  } catch (err) {
    throw new CloudConnectionError(
      `${what}: non-JSON response (HTTP ${resp.status}): ${text.slice(0, 200)}`,
    );
  }
}

export async function requestOtp(email) {
  const resp = await postForm(`${GIGYA_API_URL}/accounts.auth.otp.email.sendCode`, {
    email,
    apiKey: GIGYA_API_KEY,
    format: "json",
  });
  const { status, data } = await parseJson(resp, "OTP send");
  if (status >= 500) throw new CloudConnectionError(`OTP send: HTTP ${status}`);
  const code = data.errorCode ?? -1;
  if (code !== 0) {
    throw new CloudAuthError(
      `OTP request failed: ${data.errorMessage ?? `errorCode=${code}`}`,
    );
  }
  if (!data.vToken) throw new CloudAuthError("No vToken in OTP response");
  return data.vToken;
}

export async function verifyOtp(email, code, vtoken) {
  const resp = await postForm(`${GIGYA_API_URL}/accounts.auth.otp.email.login`, {
    email,
    code,
    vToken: vtoken,
    apiKey: GIGYA_API_KEY,
    format: "json",
  });
  const { status, data } = await parseJson(resp, "OTP verify");
  if (status >= 500) throw new CloudConnectionError(`OTP verify: HTTP ${status}`);
  const err = data.errorCode ?? -1;
  if (err === 206001) {
    throw new CloudAuthError(
      "Account pending registration: finish signup in the Philips HomeID app first.",
    );
  }
  if (err !== 0) {
    throw new CloudAuthError(data.errorMessage ?? `OTP verify errorCode=${err}`);
  }
  const sessionToken = data.sessionInfo?.cookieValue;
  if (!sessionToken) throw new CloudAuthError("No session token in OTP response");
  return sessionToken;
}

async function fetchRedirectLocation(url, label) {
  // Node fetch follows 302s by default; disable it to read the Location header.
  const resp = await request(url, { redirect: "manual" });
  if (![301, 302, 303, 307, 308].includes(resp.status)) {
    if (resp.status >= 500) {
      throw new CloudConnectionError(`${label}: HTTP ${resp.status}`);
    }
    throw new CloudAuthError(
      `${label}: expected redirect, got HTTP ${resp.status}`,
    );
  }
  const location = resp.headers.get("location");
  if (!location) throw new CloudAuthError(`${label}: no Location header`);
  return location;
}

async function getGmidTicket() {
  const resp = await postForm(`${GIGYA_API_URL}/socialize.getIDs`, {
    APIKey: GIGYA_API_KEY,
    includeTicket: "true",
    format: "json",
  });
  const { data } = await parseJson(resp, "socialize.getIDs");
  if (!data.gmidTicket) {
    throw new CloudAuthError(
      `socialize.getIDs: no gmidTicket (${data.errorMessage ?? data.errorCode})`,
    );
  }
  return data.gmidTicket;
}

export async function getOidcTokens(sessionToken) {
  const { verifier, challenge } = pkce();
  const authParams = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    response_type: "code",
    redirect_uri: MOBILE_APP_REDIRECT_URI,
    scope: OAUTH_SCOPES,
    state: b64urlNoPad(randomBytes(16)),
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "none",
  });
  const authLocation = await fetchRedirectLocation(
    `${OIDC_AUTH_ENDPOINT}?${authParams}`,
    "/authorize",
  );
  const contextJwt = new URL(authLocation, OIDC_AUTH_ENDPOINT).searchParams.get(
    "context",
  );
  if (!contextJwt) {
    throw new CloudAuthError("/authorize: no 'context' in Location header");
  }

  const gmidTicket = await getGmidTicket();

  const contParams = new URLSearchParams({
    context: contextJwt,
    login_token: sessionToken,
    gmidTicket,
    client_id: OAUTH_CLIENT_ID,
  });
  const contLocation = await fetchRedirectLocation(
    `${OIDC_ISSUER}/authorize/continue?${contParams}`,
    "/authorize/continue",
  );
  const contQuery = new URL(contLocation, OIDC_ISSUER).searchParams;
  if (contQuery.get("errorMessage")) {
    throw new CloudAuthError(`/authorize/continue: ${contQuery.get("errorMessage")}`);
  }
  const authCode = contQuery.get("code");
  if (!authCode) throw new CloudAuthError("/authorize/continue: no 'code'");

  const tokenResp = await postForm(OIDC_TOKEN_ENDPOINT, {
    client_id: OAUTH_CLIENT_ID,
    grant_type: "authorization_code",
    code: authCode,
    redirect_uri: MOBILE_APP_REDIRECT_URI,
    code_verifier: verifier,
  });
  const { status, data, text } = await parseJson(tokenResp, "Token exchange");
  if (!data.access_token) {
    const errCode = data.error ?? "";
    const errMsg = data.error_description ?? errCode ?? `HTTP ${status}`;
    if (status === 401 || ["invalid_grant", "invalid_token"].includes(errCode)) {
      throw new CloudAuthError(`Token exchange rejected: ${errMsg}`);
    }
    throw new CloudConnectionError(
      `Token exchange failed (HTTP ${status}): ${errMsg} — ${text.slice(0, 200)}`,
    );
  }
  return data;
}

export async function refreshTokens(refreshToken) {
  const resp = await postForm(OIDC_TOKEN_ENDPOINT, {
    client_id: OAUTH_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const { status, data } = await parseJson(resp, "Token refresh");
  if (!data.access_token) {
    const errCode = data.error ?? "";
    const errMsg = data.error_description ?? errCode ?? `HTTP ${status}`;
    if (status === 401 || ["invalid_grant", "invalid_token"].includes(errCode)) {
      throw new CloudAuthError(`Token refresh rejected: ${errMsg}`);
    }
    throw new CloudConnectionError(`Token refresh failed (HTTP ${status}): ${errMsg}`);
  }
  return data;
}

export async function getDevices(accessToken) {
  const resp = await request(`${IOT_BASE}/user/self/device`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if ([401, 403].includes(resp.status)) {
    throw new CloudAuthError(`Device list rejected: HTTP ${resp.status}`);
  }
  if (resp.status !== 200) {
    throw new CloudConnectionError(`Device list failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    return data.devices ?? data.data ?? data.items ?? [];
  }
  return [];
}

export async function getMqttUserId(accessToken, idToken) {
  const resp = await request(`${IOT_BASE}/user/self/get-id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ idToken }),
  });
  if ([401, 403].includes(resp.status)) {
    throw new CloudAuthError(`MQTT get-id rejected: HTTP ${resp.status}`);
  }
  if (resp.status !== 200) {
    throw new CloudConnectionError(`MQTT get-id failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data?.userId ?? null;
}

export async function getMqttSignature(accessToken) {
  const resp = await request(`${IOT_BASE}/user/self/signature`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (resp.status === 401) {
    throw new CloudAuthError(`MQTT signature rejected: HTTP ${resp.status}`);
  }
  if (resp.status !== 200) {
    throw new CloudConnectionError(`MQTT signature failed: HTTP ${resp.status}`);
  }
  return resp.json();
}
