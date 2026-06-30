// src/bot/toolRegistry.ts
import { aquavitaModule } from "../modules/aquavita/index";
import { ganemosModule } from "../modules/ganemos-net/index";

export const moduleRegistry = {
  aquavita: aquavitaModule,
  ganemos: ganemosModule,
  "ganemos-net": ganemosModule
};
