import { prisma } from "../prisma/client.js";

// Adapted from gothinkster/node-express-prisma-v1-official-app @ 6ac99ea5
// (`src/app/routes/services/profile.service.ts`, attribution). Behaviour
// stays spec-conformant: getProfile returns the viewer-relative
// `following` boolean; follow/unfollow toggle the implicit many-to-many
// `UserFollows` relation via `connect`/`disconnect`.
//
// Redesign vs upstream: explicit self-follow guard — upstream silently
// accepts it, we reject with ProfileError("cannot follow yourself")
// because letting a user follow themselves corrupts the personalised
// feed (#11).

export type ProfileEnvelope = {
  username: string;
  bio: string | null;
  image: string | null;
  following: boolean;
};

export class ProfileError extends Error {
  constructor(
    public readonly field: string,
    public readonly detail: string,
    public readonly status: 404 | 422,
  ) {
    super(`${field}: ${detail}`);
    this.name = "ProfileError";
  }
}

const toEnvelope = (
  user: { username: string; bio: string | null; image: string | null },
  following: boolean,
): ProfileEnvelope => ({
  username: user.username,
  bio: user.bio,
  image: user.image,
  following,
});

// `viewerId === null` means "anonymous viewer" — `following` is always
// false. Otherwise we read the viewer's `following` relation and check
// whether the target user's id appears.
const isFollowing = async (
  viewerId: number | null,
  targetId: number,
): Promise<boolean> => {
  if (viewerId === null || viewerId === targetId) return false;
  const link = await prisma.user.findFirst({
    where: { id: viewerId, following: { some: { id: targetId } } },
    select: { id: true },
  });
  return link !== null;
};

export const getProfile = async (
  username: string,
  viewerId: number | null,
): Promise<ProfileEnvelope> => {
  const target = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, bio: true, image: true },
  });
  if (!target) {
    throw new ProfileError("profile", "not found", 404);
  }
  const following = await isFollowing(viewerId, target.id);
  return toEnvelope(target, following);
};

export const followUser = async (
  viewerId: number,
  username: string,
): Promise<ProfileEnvelope> => {
  const target = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, bio: true, image: true },
  });
  if (!target) {
    throw new ProfileError("profile", "not found", 404);
  }
  if (target.id === viewerId) {
    throw new ProfileError("profile", "cannot follow yourself", 422);
  }
  await prisma.user.update({
    where: { id: viewerId },
    data: { following: { connect: { id: target.id } } },
  });
  return toEnvelope(target, true);
};

export const unfollowUser = async (
  viewerId: number,
  username: string,
): Promise<ProfileEnvelope> => {
  const target = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, bio: true, image: true },
  });
  if (!target) {
    throw new ProfileError("profile", "not found", 404);
  }
  if (target.id === viewerId) {
    // Unfollowing yourself is a no-op — we never connected the edge, so
    // disconnect would be a noop anyway. Return the unchanged envelope
    // rather than 422: the spec leaves this undefined and returning 200
    // with following=false is the least-surprising behaviour.
    return toEnvelope(target, false);
  }
  await prisma.user.update({
    where: { id: viewerId },
    data: { following: { disconnect: { id: target.id } } },
  });
  return toEnvelope(target, false);
};
