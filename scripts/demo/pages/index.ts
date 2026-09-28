/** The motion scenes by id: each returns the page HTML for a scene's timing. */
import type { PageId } from "../storyboard";
import { darkPage, sevenPage } from "./hook";
import { cloudPage } from "./cloud";
import { closePage } from "./close";
import { constraintPage, stakesPage } from "./story";
import type { PageTiming } from "./shell";

export const PAGES: Record<PageId, (timing: PageTiming) => string | Promise<string>> = {
  dark: darkPage,
  seven: sevenPage,
  stakes: stakesPage,
  constraint: constraintPage,
  cloud: cloudPage,
  close: closePage,
};
