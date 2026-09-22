import { SiteFooter } from "./SiteFooter";

type Props = { page: "terms" | "privacy" };

// The terms and privacy pages. People accept the terms on the username step,
// and worker/config.json's terms_version records which text that was: bump it
// whenever the meaning here changes, along with the "last updated" line.
// (Asking people on an older version to accept again isn't built yet.)
export function Legal({ page }: Props) {
  const title = page === "terms" ? "Terms of service" : "Privacy";
  return (
    // doc-page paints the whole page in the public sage; without it the
    // text sits on whatever is behind (the signed-out shell is dark).
    <div className="doc-page">
      <div className="legal">
        <a href="/" className="admin-back">
          ← Lechuga
        </a>
        <h1>{title}</h1>
        <p className="legal-draft">Last updated September 20, 2026.</p>
        {page === "terms" ? (
          <>
            <p>
              Lechuga is a small chat app, a side project run by a couple of people rather than a company. By using it
              you agree to a few plain things.
            </p>

            <h2>Using it</h2>
            <p>
              Lechuga is provided as is, with no warranty. Replies come from AI models, and models make mistakes. Don't
              rely on them for medical, legal, financial or safety decisions, and check anything that matters.
            </p>
            <p>
              Be a person, not a bot. Don't use Lechuga for anything illegal, to harm or harass anyone, or to break or
              overload the service. We can suspend accounts that do, and we decide what counts.
            </p>

            <h2>Accounts</h2>
            <p>
              Lechuga is invite only for now. Your username is yours, and you can't change it later; we can change it if
              it turns out to be a problem. Invites you send are your responsibility, so invite people you'd vouch for.
              You can delete your account at any time, and your chats go with it.
            </p>

            <h2>Sharing a chat</h2>
            <p>
              You can share a chat with other people here. Everyone you add can read all of it, from the first message,
              and can keep it going. Only you can share it, remove someone, or delete it, and deleting it takes it away
              from everyone in it. Someone you remove loses sight of it; what they already wrote stays where it is.
            </p>
            <p>
              Every reply in a chat you started is charged to you, whoever asked for it. So share with people you trust,
              and keep an eye on your balance. Share a chat and you're responsible for what's in it: don't put someone
              else's private information into one, and don't share one with somebody it wasn't meant for.
            </p>

            <h2>Credits and payment</h2>
            <p>
              Credits you buy pay for the models that answer you. What a reply cost is shown under it. Credits don't
              expire. A monthly subscription adds credits each month until you cancel; cancel whenever you like and keep
              what's left.
            </p>
            <p>
              Credits aren't refundable, except when we decide a refund is fair, and we try to be fair: if something went
              wrong, write to us. A refund takes back the credits it paid for. On the website, payments are handled by
              Stripe; we never see your card. If you buy credits through an app store instead, see "Mobile apps" below:
              the store handles that payment and its own refunds, not us.
            </p>

            <h2>Mobile apps</h2>
            <p>
              If you use Lechuga through the App Store or Google Play, we license the app to you for personal,
              non-commercial use on your own devices; we don't sell it to you, and you can't copy, resell, or take it
              apart. We can update or discontinue the app, and a store may remove it, without that ending your website
              account or your credits.
            </p>
            <p>
              A purchase made inside the app is billed and refunded by Apple or Google under their own terms, not ours;
              a purchase made on the website is billed and refunded by us as described above, regardless of which one
              you use day to day.
            </p>

            <h2>No warranty, and what we're liable for</h2>
            <p>
              Lechuga is provided as is, with no warranty of any kind, including that it will be uninterrupted,
              error-free, or fit for a particular purpose. To the extent the law lets us limit it, our liability to you
              for anything related to Lechuga is capped at what you paid us in the twelve months before the claim, and
              we're not liable for indirect or consequential losses. Nothing here limits liability the law doesn't let
              us limit, such as for our own gross negligence, or affects consumer rights you can't sign away, including
              those of EU, UK, and California residents.
            </p>

            <h2>Governing law</h2>
            <p>
              These terms are governed by the laws of the United States and the State of California, without regard to
              conflict-of-law rules. If you're an EU, UK, or other consumer with local rights that would otherwise
              apply, this doesn't take those away.
            </p>

            <h2>Changes</h2>
            <p>
              We can change prices, change these terms, or stop running Lechuga. If prices change, credits you already
              hold keep their value in credits. If we stop, we'll do right by unused paid credits. If the terms change in a
              way that matters, we'll tell you.
            </p>

            <p>
              Questions, or something gone wrong: <a href="mailto:hello@lechuga.ai">hello@lechuga.ai</a>.
            </p>
          </>
        ) : (
          <>
            <p>
              Your messages are stored in our database on Cloudflare so you can come back to them. They are not used to
              train anything. We don't sell them, we don't read them, and we don't have advertisers to share them with.
              Delete a chat and it's gone. Delete your account and everything goes with it.
            </p>

            <h2>What we keep, and why</h2>
            <ul>
              <li>Your email and username, to sign you in and to send you mail you asked for.</li>
              <li>Your chats and messages, so you can come back to them.</li>
              <li>
                The name and photo on your profile, if you set one, and who is in each shared chat. Your name and photo
                are shown to the people you share chats with; your email address never is.
              </li>
              <li>
                Token counts and the credits each reply cost, for billing. The model's reasoning is shown to you while it
                happens but never stored.
              </li>
              <li>Who invited whom, so invites can be counted and abuse traced.</li>
              <li>Notes and access requests you send us, so we can answer them.</li>
            </ul>

            <h2>Sharing a chat</h2>
            <p>
              A shared chat is visible in full to everyone in it, from its first message, including any files or
              pictures in it. So share one only with people you'd show all of it to. The person who started the chat
              can remove someone at any time, which takes the chat away from them; what they wrote stays in it, under
              their name, for the people still there. If the person who started it deletes it, it goes for everyone.
            </p>

            <h2>The free chat on the home page</h2>
            <p>
              It isn't stored by us at all. It stays in your browser, and joins your account only if you sign up. To limit
              it to one a day we keep a scrambled form of your network address for that day, which can't be turned back
              into the address.
            </p>

            <h2>On the iOS and Android apps</h2>
            <p>
              The app doesn't ask for your camera, photos, or location; Lechuga doesn't use any of them. If you allow
              push notifications, we use them for things like a magic-link sign-in or a reply finishing, and you can
              turn them off in your device settings at any time. The store you installed from (Apple or Google) also
              collects its own device and diagnostic information under its own privacy policy, separately from ours.
            </p>

            <h2>Who else is involved</h2>
            <p>
              Requests are processed by Cloudflare, a US company, and the models run on Cloudflare's infrastructure too:
              your chats never go to the company that trained the model. Sign-in and invite emails are sent through Resend.
              If you pay on the website, Stripe handles the payment and sees what it needs to for that and nothing of
              your chats. If you pay through an app store instead, Apple or Google handles it and tells us only that you
              paid, not your payment details. We don't run ads or trackers.
            </p>

            <h2>Your rights</h2>
            <p>
              Wherever you are, you can ask us to see, export, correct, or delete what we hold about you, and we'll do
              it the same way for everyone: delete a chat and it's gone, delete your account and everything goes with
              it. If you're in the EU, UK, or California, this covers the access, deletion, and correction rights those
              laws give you; write to us and say which you'd like.
            </p>

            <p>
              Questions about any of this: <a href="mailto:hello@lechuga.ai">hello@lechuga.ai</a>.
            </p>
          </>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
