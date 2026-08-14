/**
 * Google OAuth and Drive, over `fetch`.
 *
 * No `googleapis`. That package is tens of megabytes and pulls a transitive tree, and what is needed
 * here is four HTTPS calls -- an auth URL, a code exchange, a token refresh, and two reads. This repo
 * has five runtime dependencies and the property is worth more than the convenience.
 *
 * **One-directional, onboarding only.** `drive.readonly` is the only scope asked for, so the product
 * cannot write to somebody's Drive even if a later bug tried. PRD A11: *Drive is the on-ramp, never
 * the backend.*
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/** Sheets are exported; a CSV already in Drive is downloaded. Anything else is not a roster. */
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const CSV_MIME = "text/csv";

/**
 * A ceiling on what we will read into memory. A serverless function has a fixed budget and a board
 * can point this at any file it owns; a 200MB video should be refused by size rather than by
 * whatever happens when the runtime runs out.
 */
const MAX_BYTES = 5_000_000;

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

export type DriveResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Configuration, or a stated absence -- the shape comms uses for `RESEND_API_KEY`. A deployment
 * without these cannot start the flow, rather than redirecting somebody to a Google error page.
 */
export const googleConfig = (): GoogleConfig | null => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!clientId || !clientSecret || !baseUrl) return null;
  return { clientId, clientSecret, redirectUri: `${baseUrl}/api/drive/callback` };
};

export const driveConfigured = (): boolean => googleConfig() !== null;

/**
 * `access_type=offline` with `prompt=consent` is what actually yields a refresh token: Google issues
 * one only on the first grant unless consent is forced, so a board that reconnects after a revoke
 * would otherwise complete the flow and hand us nothing to store.
 *
 * `state` is a CSRF token this caller has already put in a cookie, and `include_granted_scopes` is
 * deliberately absent -- we want exactly the scope we asked for and no accumulation.
 */
export const authUrl = (config: GoogleConfig, state: string): string => {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: `${DRIVE_SCOPE} email`,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

const postForm = async (body: Record<string, string>): Promise<DriveResult<TokenResponse>> => {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  } catch {
    return { ok: false, reason: "Could not reach Google. Try again in a moment." };
  }

  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || payload.error) {
    // Google's own `error_description` is written for a developer, not a board member, so it is
    // deliberately not surfaced -- the same reason a drizzle `message` is never shown to a treasurer.
    return { ok: false, reason: "Google refused that connection. Try connecting again." };
  }
  return { ok: true, value: payload };
};

export type ExchangedGrant = { refreshToken: string; accessToken: string; scope: string };

export const exchangeCode = async (
  config: GoogleConfig,
  code: string,
): Promise<DriveResult<ExchangedGrant>> => {
  const result = await postForm({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  if (!result.ok) return result;

  const { refresh_token: refreshToken, access_token: accessToken, scope } = result.value;
  if (!refreshToken || !accessToken) {
    return {
      ok: false,
      reason: "Google did not return a reusable connection. Disconnect the app in your Google account, then connect again.",
    };
  }

  // A person can untick a scope on the consent screen and still complete the flow. Refusing here
  // means a board learns at connect time rather than at import time, which is the difference
  // between a confusing failure and an actionable one.
  if (!(scope ?? "").split(" ").includes(DRIVE_SCOPE)) {
    return { ok: false, reason: "That connection was not given permission to read Drive files." };
  }

  return { ok: true, value: { refreshToken, accessToken, scope: scope ?? "" } };
};

export const refreshAccessToken = async (
  config: GoogleConfig,
  refreshToken: string,
): Promise<DriveResult<string>> => {
  const result = await postForm({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  if (!result.ok) return result;

  const accessToken = result.value.access_token;
  if (!accessToken) {
    return { ok: false, reason: "That Google connection has expired. Reconnect the account." };
  }
  return { ok: true, value: accessToken };
};

const getJson = async <T>(url: string, accessToken: string): Promise<DriveResult<T>> => {
  let response: Response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch {
    return { ok: false, reason: "Could not reach Google Drive. Try again in a moment." };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "That Google connection can no longer read this folder." };
  }
  if (response.status === 404) return { ok: false, reason: "No such folder in that Drive." };
  if (!response.ok) return { ok: false, reason: "Google Drive did not answer. Try again." };
  return { ok: true, value: (await response.json()) as T };
};

export const accountEmail = async (accessToken: string): Promise<DriveResult<string>> => {
  const result = await getJson<{ email?: string }>(USERINFO_ENDPOINT, accessToken);
  if (!result.ok) return result;
  return result.value.email
    ? { ok: true, value: result.value.email }
    : { ok: false, reason: "Google did not say which account that was." };
};

export type DriveFile = { id: string; name: string; mimeType: string };

/**
 * The importable files in one folder.
 *
 * The folder id is quoted into a Drive query, so it is validated first: Drive's `q` grammar is
 * string-delimited and an id containing a quote would let a caller rewrite the query. Real ids are
 * URL-safe, so anything else is refused rather than escaped -- refusing an id no Drive ever issued
 * costs nothing, and getting escaping subtly wrong costs everything.
 */
export const listImportable = async (
  accessToken: string,
  folderId: string,
): Promise<DriveResult<DriveFile[]>> => {
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(folderId)) {
    return { ok: false, reason: "That does not look like a Drive folder link." };
  }

  const query = `'${folderId}' in parents and trashed = false and (mimeType = '${SHEET_MIME}' or mimeType = '${CSV_MIME}')`;
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType)",
    pageSize: "100",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const result = await getJson<{ files?: DriveFile[] }>(
    `${DRIVE_FILES}?${params.toString()}`,
    accessToken,
  );
  if (!result.ok) return result;
  return { ok: true, value: result.value.files ?? [] };
};

/**
 * A file's contents as CSV. A Google Sheet is exported; a stored CSV is downloaded.
 *
 * The response is read as text with a size ceiling rather than streamed, because the parser is pure
 * and takes a string -- and because a board pointing this at the wrong file should get a refusal
 * rather than an exhausted function.
 */
export const readCsv = async (
  accessToken: string,
  file: DriveFile,
): Promise<DriveResult<string>> => {
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(file.id)) {
    return { ok: false, reason: "That file cannot be read." };
  }
  if (file.mimeType !== SHEET_MIME && file.mimeType !== CSV_MIME) {
    return { ok: false, reason: "Only a Google Sheet or a CSV can be imported." };
  }

  const url =
    file.mimeType === SHEET_MIME
      ? `${DRIVE_FILES}/${file.id}/export?mimeType=text%2Fcsv`
      : `${DRIVE_FILES}/${file.id}?alt=media&supportsAllDrives=true`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch {
    return { ok: false, reason: "Could not reach Google Drive. Try again in a moment." };
  }
  if (!response.ok) {
    return { ok: false, reason: "That file could not be read from Drive." };
  }

  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) {
    return { ok: false, reason: "That file is too large to import. Export just the roster tab." };
  }

  const text = await response.text();
  if (text.length > MAX_BYTES) {
    return { ok: false, reason: "That file is too large to import. Export just the roster tab." };
  }
  return { ok: true, value: text };
};

/**
 * A folder id out of whatever a board pasted -- a full Drive URL or the bare id.
 *
 * Pure, so it is tested without a network. A board copies the address bar, and telling them to
 * extract a 33-character substring themselves is the kind of friction that ends an onboarding call.
 */
export const folderIdFrom = (input: string): string | null => {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const patterns = [/\/folders\/([A-Za-z0-9_-]{5,200})/, /[?&]id=([A-Za-z0-9_-]{5,200})/];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }

  return /^[A-Za-z0-9_-]{5,200}$/.test(trimmed) ? trimmed : null;
};
