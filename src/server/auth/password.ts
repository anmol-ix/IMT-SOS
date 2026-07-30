import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const PASSWORD_FORMAT = "scrypt-v1";

export const MINIMUM_PASSWORD_LENGTH = 12;

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: typeof SCRYPT_OPTIONS,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function requireStrongPassword(password: string): string {
  if (password.length < MINIMUM_PASSWORD_LENGTH || password.length > 200) {
    throw new Error(
      `Password must be between ${MINIMUM_PASSWORD_LENGTH} and 200 characters.`,
    );
  }
  return password;
}

export async function hashPassword(password: string): Promise<string> {
  requireStrongPassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return [
    PASSWORD_FORMAT,
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [format, n, r, p, saltValue, hashValue, extra] = storedHash.split("$");
  if (
    format !== PASSWORD_FORMAT
    || extra !== undefined
    || !saltValue
    || !hashValue
  ) {
    return false;
  }

  const options = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_OPTIONS.maxmem,
  };
  if (
    options.N !== SCRYPT_OPTIONS.N
    || options.r !== SCRYPT_OPTIONS.r
    || options.p !== SCRYPT_OPTIONS.p
  ) {
    return false;
  }

  try {
    const expected = Buffer.from(hashValue, "base64url");
    if (expected.length !== KEY_LENGTH) return false;
    const actual = await scrypt(
      password,
      Buffer.from(saltValue, "base64url"),
      expected.length,
      options,
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
