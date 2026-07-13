// src/bot/toolRegistry.ts
import { aquavitaModule } from "../modules/aquavita/index";
import { ganemosModule } from "../modules/ganemos-net/index";
import { casEpcModule } from "../modules/cas-epc/index";

export const moduleRegistry = {
  aquavita: aquavitaModule,
  ganemos: ganemosModule,
  "ganemos-net": ganemosModule,
  "cas-epc": casEpcModule,
  "casepc": casEpcModule
};
