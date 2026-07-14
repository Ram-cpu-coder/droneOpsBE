const escapeHtml = (value = "") => {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
};

const eyeIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
`;

const baseStyles = `
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  body {
    min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 28px; color: #f8fbff;
    background: radial-gradient(circle at 22% 18%, rgba(90,149,255,.25), transparent 32%), radial-gradient(circle at 78% 72%, rgba(67,231,205,.14), transparent 34%), linear-gradient(135deg, #08111f 0%, #111b2b 48%, #07101d 100%);
  }
  body::before { content: ""; position: fixed; inset: 0; opacity: .18; background-image: linear-gradient(rgba(120,154,199,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(120,154,199,.16) 1px, transparent 1px); background-size: 58px 58px; mask-image: radial-gradient(circle at center, #000, transparent 78%); }
  main { position: relative; width: min(100%, 560px); padding: 38px; border: 1px solid rgba(142,166,207,.22); border-radius: 28px; background: rgba(10, 20, 35, .9); box-shadow: 0 30px 90px rgba(0,0,0,.45); text-align: center; }
  .brand { margin: 0; font-size: clamp(34px, 8vw, 48px); line-height: 1; letter-spacing: 0; }
  .brand span { color: #5a95ff; }
  .tagline { margin: 12px 0 28px; color: #9eb0c8; font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  h2 { margin: 0 0 10px; font-size: clamp(27px, 6vw, 38px); line-height: 1.12; }
  p { margin: 0 auto 22px; max-width: 430px; color: #b8c5d8; font-size: 16px; line-height: 1.6; }
  form { display: grid; gap: 14px; margin-top: 24px; text-align: left; }
  label { display: grid; gap: 8px; color: #c9d5e8; font-size: 13px; font-weight: 800; }
  input { min-height: 52px; padding: 0 15px; color: #f8fbff; background: rgba(255,255,255,.05); border: 1px solid rgba(142,166,207,.24); border-radius: 10px; font: inherit; outline: none; }
  input:focus { border-color: #5a95ff; box-shadow: 0 0 0 4px rgba(90,149,255,.16); }
  .password-field { position: relative; display: block; }
  .password-field input { width: 100%; padding-right: 54px; }
  .toggle-password { position: absolute; right: 9px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: 36px; min-height: 36px; padding: 0; color: #a9bad2; background: transparent; border: 0; border-radius: 9px; box-shadow: none; }
  .toggle-password:hover { color: #ffffff; background: rgba(255,255,255,.08); }
  .toggle-password svg { width: 18px; height: 18px; pointer-events: none; }
  button, a { display: inline-flex; align-items: center; justify-content: center; min-height: 54px; width: 100%; padding: 0 22px; color: #fff; background: linear-gradient(135deg, #5a95ff, #2672ea); border: 0; border-radius: 12px; text-decoration: none; font-size: 16px; font-weight: 850; cursor: pointer; box-shadow: 0 18px 36px rgba(38,114,234,.28); }
  .status { display: inline-flex; justify-content: center; margin-bottom: 18px; padding: 9px 14px; border-radius: 999px; color: #96f2d7; background: rgba(21,185,132,.14); border: 1px solid rgba(21,185,132,.34); font-weight: 800; }
  .error { color: #ffd1a6; background: rgba(255,160,67,.14); border-color: rgba(255,160,67,.34); }
  .note { margin-top: 16px; color: #7f91ad; font-size: 13px; }
  @media (max-width: 560px) { body { padding: 16px; } main { padding: 28px 20px; border-radius: 22px; } }
`;

export const renderPasswordResetFormPage = ({ token }) => {
  const safeToken = escapeHtml(token);

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Reset password | DroneOps</title><style>${baseStyles}</style></head>
  <body>
    <main>
      <h1 class="brand">DRONE <span>OPS</span></h1>
      <div class="tagline">Secure operations portal</div>
      <h2>Reset password</h2>
      <p>Create a new password for your DroneOps account. Use at least 8 characters.</p>
      <form method="post" action="/api/v1/auth/reset-password/${safeToken}">
        <label>New password
          <span class="password-field">
            <input id="password" type="password" name="password" minlength="8" required autocomplete="new-password" />
            <button class="toggle-password" type="button" data-target="password" aria-label="Show password">${eyeIcon}</button>
          </span>
        </label>
        <label>Confirm password
          <span class="password-field">
            <input id="confirmPassword" type="password" name="confirmPassword" minlength="8" required autocomplete="new-password" />
            <button class="toggle-password" type="button" data-target="confirmPassword" aria-label="Show confirm password">${eyeIcon}</button>
          </span>
        </label>
        <button type="submit">Update password</button>
      </form>
    </main>
    <script>
      document.querySelectorAll(".toggle-password").forEach((button) => {
        button.addEventListener("click", () => {
          const input = document.getElementById(button.dataset.target);
          const isHidden = input.type === "password";
          input.type = isHidden ? "text" : "password";
          button.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
        });
      });
    </script>
  </body>
</html>`;
};

export const renderPasswordResetResultPage = ({ success, title, message, loginUrl }) => {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(title)} | DroneOps</title><style>${baseStyles}</style></head>
  <body>
    <main>
      <h1 class="brand">DRONE <span>OPS</span></h1>
      <div class="tagline">Secure operations portal</div>
      <div class="status${success ? "" : " error"}">${success ? "Password updated" : "Reset failed"}</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <a href="${escapeHtml(loginUrl)}">${success ? "Back to login" : "Return to DroneOps"}</a>
      <div class="note">You can close this tab after returning to the portal.</div>
    </main>
  </body>
</html>`;
};
