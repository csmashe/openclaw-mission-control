import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const AUTH_DIR = path.join(os.homedir(), ".mission-control", "openclaw");
const AUTH_FILE = path.join(AUTH_DIR, "device-auth.json");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface GatewayDeviceAuth {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  deviceToken?: string;
}

interface StoredGatewayDeviceAuth extends GatewayDeviceAuth {
  version: 1;
  createdAtMs: number;
  updatedAtMs?: number;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = crypto
    .createPublicKey(publicKeyPem)
    .export({ type: "spki", format: "der" });

  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }

  return spki;
}

function fingerprintPublicKey(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generateIdentity(): GatewayDeviceAuth {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const privateKeyPem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();

  return {
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
  };
}

function writeAuthFile(payload: StoredGatewayDeviceAuth): void {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function loadOrCreateGatewayDeviceAuth(): GatewayDeviceAuth {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const raw = fs.readFileSync(AUTH_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredGatewayDeviceAuth>;

      if (
        parsed?.version === 1 &&
        parsed.publicKeyPem &&
        parsed.privateKeyPem
      ) {
        return {
          deviceId: fingerprintPublicKey(parsed.publicKeyPem),
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem,
          deviceToken: parsed.deviceToken,
        };
      }
    }
  } catch {
    // ignore parse/read errors and regenerate a fresh identity
  }

  const identity = generateIdentity();
  writeAuthFile({
    version: 1,
    ...identity,
    createdAtMs: Date.now(),
  });
  return identity;
}

export function persistGatewayDeviceToken(deviceToken: string): void {
  const current = loadOrCreateGatewayDeviceAuth();

  let createdAtMs = Date.now();
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const parsed = JSON.parse(
        fs.readFileSync(AUTH_FILE, "utf8")
      ) as Partial<StoredGatewayDeviceAuth>;
      if (typeof parsed.createdAtMs === "number") {
        createdAtMs = parsed.createdAtMs;
      }
    }
  } catch {
    // ignore read/parse errors and keep fallback timestamp
  }

  writeAuthFile({
    version: 1,
    ...current,
    deviceToken,
    createdAtMs,
    updatedAtMs: Date.now(),
  });
}

export function publicKeyRawBase64Url(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

export function signDevicePayload(
  privateKeyPem: string,
  payload: string
): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), key));
}

export function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce?: string;
}): string {
  const version = params.nonce ? "v2" : "v1";
  const scopeStr = params.scopes.join(",");
  const token = params.token ?? "";
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopeStr,
    String(params.signedAtMs),
    token,
  ];

  if (version === "v2") {
    base.push(params.nonce ?? "");
  }

  return base.join("|");
}
