/**
 * @file The HTML template for the Vite dev-server login page rendered by `cloudflareAccessPlugin`
 * (./plugin.ts). A pure HTML-string builder with no dependency on `auth-internal` or any other
 * runtime module.
 */

/** A selectable identity rendered on the dev login form. */
export interface DevLoginUser {
  /** Email address used as the JWT `email` claim. */
  email: string;
  /** Optional human-friendly display name. */
  name?: string;
  /**
   * Optional subject claim to pin for this identity.
   *
   * When provided it is used **verbatim** as the JWT `sub` so the identity has a stable,
   * realistic subject across logins. When omitted a random UUID is generated each time the user
   * signs in (matching the shape of a real Cloudflare Access `sub`).
   */
  sub?: string;
}

/**
 * Render a self-contained HTML page with a dev login form.
 *
 * @param loginPath - The path the form submits to (handled by the plugin).
 * @param redirectTo - The URL the user is returned to after login.
 * @param users - Optional selectable identities. When provided the form shows a radio list plus
 *   a "custom email" option; when empty it falls back to a single email input.
 * @param error - Optional error message to display.
 * @returns A complete `<!DOCTYPE html>` document as a string.
 */
export function renderViteLoginPage(
  loginPath: string,
  redirectTo: string,
  users: DevLoginUser[] = [],
  error?: string
): string {
  const errorHtml = error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : "";

  const hasUsers = users.length > 0;
  const usersHtml = hasUsers ? renderUserChoices(users) : renderEmailInput();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Developer Login</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    body{
      margin:0;font-family:system-ui,-apple-system,sans-serif;
      display:flex;align-items:center;justify-content:center;
      min-height:100vh;background:#f4f4f5;color:#18181b;
    }
    .card{
      background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);
      padding:2.5rem;width:100%;max-width:420px;
    }
    h1{margin:0 0 .25rem;font-size:1.5rem}
    p.subtitle{margin:0 0 1.5rem;color:#52525b;font-size:.875rem}
    fieldset{border:none;margin:0;padding:0}
    legend{font-size:.875rem;font-weight:500;margin-bottom:.5rem;padding:0}
    label{display:block;font-size:.875rem;font-weight:500;margin-bottom:.375rem}
    .user-option{
      display:flex;align-items:center;gap:.625rem;
      padding:.625rem .75rem;border:1px solid #71717a;border-radius:8px;
      margin-bottom:.5rem;cursor:pointer;
    }
    .user-option:focus-within{border-color:#1d4ed8;box-shadow:0 0 0 3px rgba(29,78,216,.15)}
    .user-option input{margin:0}
    .user-option .meta{display:flex;flex-direction:column}
    .user-option .name{font-weight:500}
    .user-option .email{color:#52525b;font-size:.8125rem}
    input[type="email"]{
      width:100%;padding:.625rem .75rem;border:1px solid #71717a;
      border-radius:8px;font-size:1rem;outline:none;
      transition:border-color .15s;
    }
    input[type="email"]:focus{border-color:#1d4ed8;box-shadow:0 0 0 3px rgba(29,78,216,.15)}
    button{
      margin-top:1rem;width:100%;padding:.625rem;border:none;
      border-radius:8px;background:#1d4ed8;color:#fff;
      font-size:1rem;font-weight:500;cursor:pointer;
      transition:background .15s;
    }
    button:hover{background:#1e40af}
    .error{
      background:#fef2f2;color:#991b1b;border:1px solid #fecaca;
      padding:.75rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:.875rem;
    }
    .badge{
      display:inline-block;background:#fef3c7;color:#92400e;
      font-size:.75rem;font-weight:600;padding:.125rem .5rem;
      border-radius:9999px;margin-bottom:1rem;
    }
  </style>
</head>
<body>
  <main class="card">
    <span class="badge">LOCAL DEV</span>
    <h1>Developer Login</h1>
    <p class="subtitle">Simulates Cloudflare Access in front of your Vite dev server.</p>
    ${errorHtml}
    <form method="POST" action="${escapeHtml(loginPath)}">
      <input type="hidden" name="redirect" value="${escapeHtml(redirectTo)}" />
      ${usersHtml}
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

/** Single email input (no pre-configured users). */
function renderEmailInput(): string {
  return `<label for="email">Email address</label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autocomplete="email"
        placeholder="you@example.com"
        autofocus
      />`;
}

/** Radio list of selectable identities plus a custom-email field. */
function renderUserChoices(users: DevLoginUser[]): string {
  const options = users
    .map((user, index) => {
      const id = `user-${index}`;
      const nameHtml =
        user.name ?
          `<span class="name">${escapeHtml(user.name)}</span>`
        : `<span class="name">${escapeHtml(user.email)}</span>`;
      const emailHtml = user.name ? `<span class="email">${escapeHtml(user.email)}</span>` : "";
      const checked = index === 0 ? " checked" : "";
      return `<label class="user-option" for="${id}">
        <input type="radio" id="${id}" name="email" value="${escapeHtml(user.email)}"${checked} />
        <span class="meta">${nameHtml}${emailHtml}</span>
      </label>`;
    })
    .join("\n      ");

  return `<fieldset>
      <legend>Choose an identity</legend>
      ${options}
    </fieldset>
    <label for="custom-email">Or enter a custom email address</label>
    <input
      id="custom-email"
      name="custom-email"
      type="email"
      autocomplete="email"
      placeholder="you@example.com"
    />`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal HTML-entity escaping for untrusted values injected into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
