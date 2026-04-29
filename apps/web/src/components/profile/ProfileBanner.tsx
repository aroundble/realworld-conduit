import Link from "next/link";
import type { Profile } from "@/features/profiles/queries";
import { FollowButton } from "@/components/article/FollowButton";

type Props = {
  profile: Profile;
  // null = anonymous viewer; string = authed username (used to decide
  // self vs other — self sees "Edit Profile Settings" instead of follow).
  viewerUsername: string | null;
  // Separate from viewerUsername because anon viewers also get the
  // follow button; it just routes to /login instead of POSTing.
  authed: boolean;
};

// Profile page banner card (#20). Avatar + username + bio + one of
// three trailing controls: Edit Profile Settings (self), FollowButton
// (authed non-self), or a "Sign in to follow" link (anon).
export const ProfileBanner = ({ profile, viewerUsername, authed }: Props) => {
  const isSelf = viewerUsername === profile.username;

  return (
    <div className="user-info">
      <div className="container">
        <div className="row">
          <div className="col-xs-12 col-md-10 offset-md-1">
            {profile.image ? (
              // Tiny avatar bitmap, see Navbar / ArticlePreview for the
              // established <img> over next/image pattern.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.image}
                alt={`${profile.username} avatar`}
                className="user-img"
              />
            ) : null}
            <h4>{profile.username}</h4>
            {profile.bio ? <p>{profile.bio}</p> : null}
            <div className="profile-actions">
              {isSelf ? (
                <Link
                  href="/settings"
                  className="btn btn-sm btn-outline-secondary action-btn"
                >
                  <span aria-hidden="true">⚙</span> Edit Profile Settings
                </Link>
              ) : authed ? (
                <FollowButton
                  username={profile.username}
                  following={profile.following}
                />
              ) : (
                <Link
                  href="/login"
                  className="btn btn-sm btn-outline-secondary action-btn"
                >
                  <span aria-hidden="true">+</span> Follow {profile.username}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
