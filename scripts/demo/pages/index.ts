/** The motion scenes by id: each returns the page HTML for a scene's timing. */
import type { PageId } from "../storyboard";
import { darkPage, sevenPage } from "./hook";
import { checksPage } from "./checks";
import { cloudPage } from "./cloud";
import { comparePage } from "./compare";
import { nextPage } from "./next";
import { closePage } from "./close";
import { constraintPage, stakesPage } from "./story";
import type { PageTiming } from "./shell";

export const PAGES: Record<PageId, (timing: PageTiming) => string | Promise<string>> = {
  dark: darkPage,
  seven: sevenPage,
  stakes: stakesPage,
  constraint: constraintPage,
  checks: checksPage,
  cloud: cloudPage,
  compare: comparePage,
  next: nextPage,
  close: closePage,
};
