import figlet from "figlet";
import doomFont from "figlet/fonts/Doom";
import { styleText } from "node:util";

const BRAND = "Oh My Trends";
const BRAND_FONT = "Doom";

let fontsLoaded = false;

export function renderBanner(): string {
  ensureFontsLoaded();
  const banner = figlet.textSync(BRAND, {
    font: BRAND_FONT,
    horizontalLayout: "fitted",
    verticalLayout: "default",
  }).replace(/\s+$/g, "");

  return styleText("green", banner, { validateStream: false });
}

function ensureFontsLoaded(): void {
  if (fontsLoaded) return;
  figlet.parseFont(BRAND_FONT, doomFont);
  fontsLoaded = true;
}
