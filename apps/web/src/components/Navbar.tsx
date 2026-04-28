import { cookies } from "next/headers";
import Link from "next/link";

// AUTH_COOKIE holds the username of the currently-signed-in user. Issue
// #4 / #5 will populate it from a server action after a real login; for
// now any caller that sets the cookie directly is treated as signed in
// so the layout shell's acceptance criteria can be exercised without
// the auth feature landing first.
const AUTH_COOKIE = "conduit-user";

type CurrentUser = { username: string; image?: string };

const readCurrentUser = async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const raw = jar.get(AUTH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as CurrentUser;
    if (typeof parsed.username !== "string" || parsed.username.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return { username: raw };
  }
};

export const Navbar = async () => {
  const user = await readCurrentUser();

  return (
    <nav className="navbar navbar-light">
      <div className="container">
        <Link className="navbar-brand" href="/">
          conduit
        </Link>
        <ul className="nav navbar-nav pull-xs-right">
          <li className="nav-item">
            <Link className="nav-link" href="/">
              Home
            </Link>
          </li>
          {user ? (
            <>
              <li className="nav-item">
                <Link className="nav-link" href="/editor">
                  <i className="ion-compose" />
                  &nbsp;New Article
                </Link>
              </li>
              <li className="nav-item">
                <Link className="nav-link" href="/settings">
                  <i className="ion-gear-a" />
                  &nbsp;Settings
                </Link>
              </li>
              <li className="nav-item">
                <Link
                  className="nav-link"
                  href={`/profile/${user.username}`}
                >
                  {user.image ? (
                    // User-supplied avatar URL; we can't allow-list
                    // arbitrary hosts in next.config, so staying on
                    // a plain <img>. Size is capped by `.user-pic`.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="user-pic"
                      src={user.image}
                      alt={`${user.username} avatar`}
                    />
                  ) : null}
                  @{user.username}
                </Link>
              </li>
            </>
          ) : (
            <>
              <li className="nav-item">
                <Link className="nav-link" href="/login">
                  Sign in
                </Link>
              </li>
              <li className="nav-item">
                <Link className="nav-link" href="/register">
                  Sign up
                </Link>
              </li>
            </>
          )}
        </ul>
      </div>
    </nav>
  );
};
