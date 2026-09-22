// Plain-text email bodies (plan v3, Phase 2b step 12). Short, no images.
// Each returns subject + text; sending is worker/src/email.ts.

export type EmailContent = { subject: string; text: string; html?: string };

export function inviteEmail(opts: { inviterName: string | null; url: string; expiresDays: number; sharedChat?: boolean; baseUrl: string }): EmailContent {
  const who = opts.inviterName ? `${opts.inviterName} invited you to Lechuga.` : "You're invited to Lechuga.";
  // The words, once; the plain-text and the HTML versions are both made
  // from them. Each claim below is one the home page and the privacy page
  // already make; keep them in step. The Cloudflare ones were checked against
  // its docs on 2026-09-21: every model here is a Workers AI model (@cf/...),
  // which Cloudflare runs on its own GPUs; it doesn't train on what passes
  // through (Workers AI "Data usage"); and its mainland China network is a
  // separate one, run by JD Cloud, that offers neither Workers AI nor D1, so
  // nothing of Lechuga's is on it. Don't say "hosted in the US": replies are
  // computed wherever Cloudflare has a GPU free, usually near the person asking.
  const paragraphs: Paragraph[] = [
    { text: who, lead: true },
    ...(opts.sharedChat ? [{ text: "They've shared a chat with you. It'll be in your list once you've signed in." }] : []),
    { text: `Accept here (the link works once and expires in ${opts.expiresDays} days):`, link: opts.url, button: "Accept the invite" },
    { text: "What Lechuga is:", heading: true },
    {
      text: "You use it the way you'd use Claude or ChatGPT: ask it things, give it files and pictures, think out loud. The difference is what answers. Lechuga runs some of the best open source models, and they have become very good.",
    },
    {
      bullets: [
        "It's cheaper. Open source models cost far less to run, and you pay only for what you use: our cost, doubled, with the sums published. You start with some credits on us, and every reply shows what it cost.",
        "The models never phone home. Several of the best open source models come from labs in China, and many services that offer them send your chats to the model maker's own servers. Lechuga doesn't. Cloudflare, an American company, runs the models on its own machines, and none of it runs in China. Your chats never reach the company that trained the model.",
        "Your chats aren't used to train anything, by us or by Cloudflare. We don't sell them, and there are no ads or advertisers to share them with. Delete a chat and it's gone.",
      ],
    },
    {
      text: "It's an alpha: small, made by friends for friends, and we're still trying things out. Expect rough edges, and tell us about them. The newest experiment is sharing a chat with a friend, so you can both keep it going.",
    },
    {
      text: "Why Lechuga? It means lettuce in Spanish, and Cynthia was getting frustrated that she couldn't find a .ai domain the day she started this, so she bought the first one she found.",
    },
    { text: "If you weren't expecting this, ignore it and nothing happens.", small: true },
  ];
  return {
    subject: "You're invited to Lechuga (alpha)",
    text: asText(paragraphs),
    html: asHtml(paragraphs, opts.baseUrl),
  };
}

type Paragraph = { text?: string; bullets?: string[]; link?: string; button?: string; lead?: boolean; heading?: boolean; small?: boolean };

function asText(ps: Paragraph[]): string {
  return ps
    .map((p) => (p.bullets ? p.bullets.map((b) => `- ${b}`).join("\n") : p.link ? `${p.text}\n${p.link}` : p.text ?? ""))
    .join("\n\n");
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The invite in the home page's colours: the pale green, the name in script
// beside the logo, Georgia for the reading. Every style is inline and the
// layout is one table, because that's what mail clients honour; Gmail won't
// load the script font, and falls back to its own cursive.
function asHtml(ps: Paragraph[], baseUrl: string): string {
  const green = "#f1f4ee", ink = "#1e221b", dim = "#5f6659", accent = "#6fae3b";
  const body = ps
    .map((p) => {
      if (p.bullets)
        return `<ul style="margin:0 0 18px;padding-left:22px">${p.bullets.map((b) => `<li style="margin:0 0 10px;font-size:16px;line-height:1.55;color:${ink}">${escape(b)}</li>`).join("")}</ul>`;
      if (p.link)
        return (
          `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:${ink}">${escape(p.text ?? "")}</p>` +
          `<p style="margin:0 0 6px"><a href="${escape(p.link)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:${accent};color:#ffffff;font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none">${escape(p.button ?? p.link)}</a></p>` +
          `<p style="margin:0 0 26px;font-size:12px;line-height:1.5;color:${dim};word-break:break-all">${escape(p.link)}</p>`
        );
      if (p.heading) return `<h2 style="margin:26px 0 10px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${dim}">${escape(p.text ?? "")}</h2>`;
      const size = p.lead ? 19 : p.small ? 13 : 16;
      return `<p style="margin:0 0 18px;font-size:${size}px;line-height:1.55;color:${p.small ? dim : ink}">${escape(p.text ?? "")}</p>`;
    })
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link href="https://fonts.googleapis.com/css2?family=Allura&display=swap" rel="stylesheet">
<title>Lechuga</title></head>
<body style="margin:0;padding:0;background:${green}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${green}"><tr><td align="center" style="padding:36px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Georgia,'Times New Roman',serif">
<tr><td style="padding:0 0 26px">
  <img src="${baseUrl}/lechuga_logo.png" width="44" height="44" alt="" style="display:inline-block;vertical-align:middle;border-radius:50%;margin-right:10px">
  <span style="display:inline-block;vertical-align:middle;font-family:Allura,'Snell Roundhand','Brush Script MT',cursive;font-size:40px;line-height:1;color:${ink}">Lechuga</span>
  <span style="display:inline-block;vertical-align:top;margin:2px 0 0 6px;padding:1px 7px;border:1px solid ${dim};border-radius:999px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:11px;color:${dim}">alpha</span>
</td></tr>
<tr><td style="padding:28px 28px 16px;background:#ffffff;border-radius:16px">${body}</td></tr>
<tr><td style="padding:18px 4px 0;font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;color:${dim}">Lechuga is lettuce in Spanish. <a href="${baseUrl}" style="color:${dim}">lechuga.ai</a></td></tr>
</table></td></tr></table></body></html>`;
}

// To someone who already has an account, when a chat is shared with them.
export function chatSharedEmail(opts: { sharerName: string; title: string | null; url: string }): EmailContent {
  return {
    subject: `${opts.sharerName} shared a chat with you on Lechuga`,
    text: [
      `${opts.sharerName} shared a chat with you${opts.title ? `: "${opts.title}"` : ""}.`,
      "",
      "You can read all of it and keep it going. Replies in it come out of their credits, not yours.",
      "",
      opts.url,
    ].join("\n"),
  };
}

export function requestReceivedEmail(): EmailContent {
  return {
    subject: "We got your request",
    text: [
      "Thanks for asking about Lechuga. We read every request and reply from this address when there's news.",
      "",
      "Lechuga is invite only while it's small. If a friend already uses it, they can invite you directly.",
    ].join("\n"),
  };
}

export function adminReplyEmail(opts: { subject: string; body: string }): EmailContent {
  return {
    subject: opts.subject.trim() || "About your Lechuga request",
    text: opts.body.trim(),
  };
}

export function declinedEmail(opts: { message: string }): EmailContent {
  return {
    subject: "About your Lechuga request",
    text: opts.message.trim(),
  };
}
