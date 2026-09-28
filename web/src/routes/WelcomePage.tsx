import { SideNavPage } from "../components/SideNavPage";
import { HOME_SECTIONS, HomeSectionBody } from "./HomePage";
import { AboutTeam } from "./StaticPages";
import { HELP_NAV } from "./GettingStartedPage";

// /welcome, "About Lechuga" in the Help pages' nav: what the signed-out home
// page and the About page say, for anyone who signed in before reading it.
export function WelcomePage() {
  return (
    <SideNavPage title="About Lechuga" nav={HELP_NAV}>
      {HOME_SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="tips-section">
          <h2>{s.title}</h2>
          <HomeSectionBody section={s} />
        </section>
      ))}
      <section id="who-we-are" className="tips-section">
        <h2>Who we are</h2>
        <AboutTeam />
      </section>
    </SideNavPage>
  );
}
