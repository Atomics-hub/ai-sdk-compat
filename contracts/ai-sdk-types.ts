import type {
  LanguageModelUsage as LanguageModelUsage7,
  UIMessage as UIMessage7,
} from "ai";
import type {
  LanguageModelUsage as LanguageModelUsage6,
  UIMessage as UIMessage6,
} from "ai-v6";
import { migrateLanguageModelUsage, migrateUIMessage } from "../src/index.js";

declare const persisted: unknown;
declare const usage: unknown;

const message6: UIMessage6 = migrateUIMessage<UIMessage6>(persisted).value;
const message7: UIMessage7 = migrateUIMessage<UIMessage7>(persisted).value;
const usage6: LanguageModelUsage6 =
  migrateLanguageModelUsage<LanguageModelUsage6>(usage).value;
const usage7: LanguageModelUsage7 =
  migrateLanguageModelUsage<LanguageModelUsage7>(usage).value;

export const contracts = [message6, message7, usage6, usage7];
