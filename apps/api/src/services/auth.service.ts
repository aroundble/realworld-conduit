import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { User } from "@prisma/client";
import { config } from "../config.js";
import { authFailuresTotal } from "../middleware/metrics.js";
import { prisma } from "../prisma/client.js";

// RealWorld user envelope — what the spec returns in the `user` key for
// register, login, getCurrentUser, and updateUser responses.
export type UserEnvelope = {
  email: string;
  token: string;
  username: string;
  bio: string | null;
  image: string | null;
};

export type JwtPayload = {
  id: number;
  email: string;
  username: string;
};

export class AuthError extends Error {
  constructor(
    public readonly field: string,
    public readonly detail: string,
    public readonly status: 401 | 409 | 422,
  ) {
    super(`${field}: ${detail}`);
    this.name = "AuthError";
    // Observability: every AuthError creation is an auth failure,
    // regardless of whether the route handler re-throws or catches
    // it locally. Incrementing in the constructor guarantees the
    // metric counts actual incidents, not rethrow decisions. (#139)
    authFailuresTotal.inc({ reason: authFailureReasonOf(field) });
  }
}

// Bound set of reason labels for auth_failures_total (#139). The
// raw `field+detail` pair is too fine-grained for a Prom label
// (risk: high cardinality if detail strings diverge). We map the
// field → a stable reason token the dashboard can pivot on.
const authFailureReasonOf = (field: string): string => {
  if (field === "credentials") return "invalid_credentials";
  if (field === "token") return "missing_or_expired_token";
  if (field === "email") return "email_conflict";
  if (field === "username") return "username_conflict";
  return "other";
};

const signToken = (user: Pick<User, "id" | "email" | "username">): string => {
  const payload: JwtPayload = {
    id: user.id,
    email: user.email,
    username: user.username,
  };
  const options: SignOptions = {
    algorithm: "HS256",
    expiresIn: config.jwtTtlSeconds,
    // jti makes every issued token unique even when two signs happen
    // within the same `iat` second — load-bearing for the #6 AC that
    // a password-change response returns a *different* JWT from the
    // one on the previous cookie. Also a hook for future revocation.
    jwtid: randomUUID(),
  };
  return jwt.sign(payload, config.jwtSecret, options);
};

export const verifyToken = (token: string): JwtPayload => {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
      clockTolerance: config.jwtClockSkewSeconds,
    });
  } catch {
    // Expired / malformed / signature-mismatch — treated the same as
    // "no token" for the purposes of the 401 envelope. The spec's
    // Bruno collection treats unparseable tokens as missing-credential
    // (see errors-auth/10 etc.), and the shape is
    // `{"errors":{"token":["is missing"]}}`.
    throw new AuthError("token", "is missing", 401);
  }
  if (typeof decoded === "string") {
    throw new AuthError("token", "is missing", 401);
  }
  const { id, email, username } = decoded as Record<string, unknown>;
  if (typeof id !== "number" || typeof email !== "string" || typeof username !== "string") {
    throw new AuthError("token", "is missing", 401);
  }
  return { id, email, username };
};

const toEnvelope = (user: User, token: string): UserEnvelope => ({
  email: user.email,
  token,
  username: user.username,
  bio: user.bio,
  // Schema defaults `image` to the RealWorld smiley avatar. The spec's
  // register-response example shows `image: null`, so echo null when the
  // user hasn't customised it by leaving the default in place.
  image: user.image,
});

export type RegisterInput = {
  username: string;
  email: string;
  password: string;
};

export const registerUser = async (input: RegisterInput): Promise<UserEnvelope> => {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { username: input.username }] },
    select: { email: true, username: true },
  });
  if (existing) {
    // Duplicate on register is a state conflict — the client's intent
    // can never succeed without re-choosing an identifier. 409 per
    // RealWorld spec / canonical Bruno `errors-auth/05` + `06`.
    // Update-user clashes (line ~170) stay 422 because there the
    // caller is already authenticated and the payload is a field
    // validation, not a registration attempt.
    if (existing.email === input.email) {
      throw new AuthError("email", "has already been taken", 409);
    }
    throw new AuthError("username", "has already been taken", 409);
  }

  const passwordHash = await bcrypt.hash(input.password, config.bcryptCost);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      username: input.username,
      password: passwordHash,
      // `image` defaults to the smiley avatar in the schema; clear it on
      // register so the envelope returns `null` until the user sets one
      // via settings (matches the canonical RealWorld register response).
      image: null,
    },
  });
  return toEnvelope(user, signToken(user));
};

export type LoginInput = {
  email: string;
  password: string;
};

export const loginUser = async (input: LoginInput): Promise<UserEnvelope> => {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    // Spec envelope for wrong email/password: `{"errors":{"credentials":["invalid"]}}`
    // at 401 — matches upstream Bruno `errors-auth/09-login-wrong-password.bru`.
    // Both "unknown email" and "wrong password" collapse to the same
    // envelope so a caller can't distinguish the two (enumeration
    // defence).
    throw new AuthError("credentials", "invalid", 401);
  }
  const ok = await bcrypt.compare(input.password, user.password);
  if (!ok) {
    throw new AuthError("credentials", "invalid", 401);
  }
  return toEnvelope(user, signToken(user));
};

export const getUserById = async (id: number): Promise<UserEnvelope | null> => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return null;
  return toEnvelope(user, signToken(user));
};

export type UpdateUserInput = {
  email?: string;
  username?: string;
  password?: string;
  bio?: string | null;
  image?: string | null;
};

export const updateUser = async (
  id: number,
  patch: UpdateUserInput,
): Promise<UserEnvelope> => {
  if (patch.email !== undefined) {
    const clash = await prisma.user.findFirst({
      where: { email: patch.email, NOT: { id } },
      select: { id: true },
    });
    if (clash) throw new AuthError("email", "has already been taken", 422);
  }
  if (patch.username !== undefined) {
    const clash = await prisma.user.findFirst({
      where: { username: patch.username, NOT: { id } },
      select: { id: true },
    });
    if (clash) throw new AuthError("username", "has already been taken", 422);
  }

  const data: Partial<User> = {};
  if (patch.email !== undefined) data.email = patch.email;
  if (patch.username !== undefined) data.username = patch.username;
  if (patch.bio !== undefined) data.bio = patch.bio;
  if (patch.image !== undefined) data.image = patch.image;
  if (patch.password !== undefined) {
    data.password = await bcrypt.hash(patch.password, config.bcryptCost);
  }

  const user = await prisma.user.update({ where: { id }, data });
  return toEnvelope(user, signToken(user));
};
