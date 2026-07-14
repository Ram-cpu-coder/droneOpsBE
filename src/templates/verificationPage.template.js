const escapeHtml = (value = "") => {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
};

const droneMark = `
  <svg width="86" height="58" viewBox="0 0 86 58" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M20 9L31 26M66 9L55 26M29 31H57M15 44L29 34M71 44L57 34" stroke="#5A95FF" stroke-width="7" stroke-linecap="round"/>
    <path d="M31 24C35 18 51 18 55 24L52 36H34L31 24Z" fill="#5A95FF"/>
    <path d="M38 27H48" stroke="#0E1828" stroke-width="4" stroke-linecap="round"/>
    <circle cx="18" cy="8" r="5" fill="#5A95FF"/>
    <circle cx="68" cy="8" r="5" fill="#5A95FF"/>
  </svg>
`;

export const renderVerificationPage = ({ status, title, message, user, loginUrl }) => {
  const isSuccess = status === "success";
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeName = escapeHtml(user?.name ?? "DroneOps user");
  const safeEmail = escapeHtml(user?.email ?? "");
  const safeLoginUrl = escapeHtml(loginUrl);
  const badgeText = isSuccess ? "Account verified" : "Verification failed";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${safeTitle} | DroneOps</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 28px;
        color: #f8fbff;
        background:
          radial-gradient(circle at 22% 18%, rgba(90,149,255,.25), transparent 32%),
          radial-gradient(circle at 78% 72%, rgba(67,231,205,.14), transparent 34%),
          linear-gradient(135deg, #08111f 0%, #111b2b 48%, #07101d 100%);
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        opacity: .22;
        background-image:
          linear-gradient(rgba(120,154,199,.16) 1px, transparent 1px),
          linear-gradient(90deg, rgba(120,154,199,.16) 1px, transparent 1px);
        background-size: 58px 58px;
        mask-image: radial-gradient(circle at center, #000, transparent 78%);
      }
      main {
        position: relative;
        width: min(100%, 620px);
        padding: 40px;
        border: 1px solid rgba(142,166,207,.22);
        border-radius: 28px;
        background: rgba(10, 20, 35, .88);
        box-shadow: 0 30px 90px rgba(0,0,0,.45);
        text-align: center;
        overflow: hidden;
      }
      main::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(135deg, rgba(255,255,255,.08), transparent 40%);
      }
      .content { position: relative; z-index: 1; }
      .mark { display: grid; place-items: center; margin-bottom: 18px; }
      .brand {
        margin: 0;
        font-size: clamp(34px, 8vw, 48px);
        line-height: 1;
        letter-spacing: 0;
      }
      .brand span { color: #5a95ff; }
      .tagline {
        margin: 12px 0 28px;
        color: #9eb0c8;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        padding: 0 14px;
        border-radius: 999px;
        color: ${isSuccess ? "#96f2d7" : "#ffd1a6"};
        background: ${isSuccess ? "rgba(21,185,132,.14)" : "rgba(255,160,67,.14)"};
        border: 1px solid ${isSuccess ? "rgba(21,185,132,.34)" : "rgba(255,160,67,.34)"};
        font-weight: 800;
      }
      h2 {
        margin: 22px 0 10px;
        font-size: clamp(28px, 6vw, 40px);
        line-height: 1.1;
      }
      p {
        margin: 0 auto;
        max-width: 470px;
        color: #b8c5d8;
        font-size: 17px;
        line-height: 1.6;
      }
      .account {
        display: grid;
        gap: 8px;
        margin: 28px 0;
        padding: 18px;
        border-radius: 18px;
        background: rgba(255,255,255,.06);
        border: 1px solid rgba(142,166,207,.18);
        text-align: left;
      }
      .account small {
        color: #8ea0bb;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 1.4px;
        text-transform: uppercase;
      }
      .account strong { font-size: 18px; }
      .account span { color: #aebbd0; overflow-wrap: anywhere; }
      a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 54px;
        width: 100%;
        max-width: 360px;
        padding: 0 22px;
        color: #fff;
        background: linear-gradient(135deg, #5a95ff, #2672ea);
        border-radius: 12px;
        text-decoration: none;
        font-size: 17px;
        font-weight: 850;
        box-shadow: 0 18px 36px rgba(38,114,234,.28);
      }
      .note {
        margin-top: 18px;
        color: #7f91ad;
        font-size: 13px;
      }
      @media (max-width: 560px) {
        body { padding: 16px; }
        main { padding: 28px 20px; border-radius: 22px; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="content">
        <div class="mark">${droneMark}</div>
        <h1 class="brand">DRONE <span>OPS</span></h1>
        <div class="tagline">Intelligent. Autonomous. Connected.</div>
        <div class="status">${badgeText}</div>
        <h2>${safeTitle}</h2>
        <p>${safeMessage}</p>
        ${user ? `
          <div class="account">
            <small>Verified account</small>
            <strong>${safeName}</strong>
            <span>${safeEmail}</span>
          </div>
        ` : ""}
        <a href="${safeLoginUrl}">${isSuccess ? "Continue to DroneOps" : "Back to DroneOps"}</a>
        <div class="note">You can close this tab after opening the operations portal.</div>
      </div>
    </main>
  </body>
</html>`;
};
