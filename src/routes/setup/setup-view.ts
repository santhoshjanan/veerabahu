import { db, schema } from '$lib/server/db/index';
import { parseMasterKey } from '$lib/server/settings/crypto';
import { getSafeSettings } from '$lib/server/settings/store';

export async function getSetupView() {
  const settings = await getSafeSettings(
    db,
    schema,
    parseMasterKey(process.env.VB_MASTER_KEY ?? '')
  );
  return {
    step: Math.min((settings?.onboardingStep ?? 0) + 1, 5),
    settings
  };
}
